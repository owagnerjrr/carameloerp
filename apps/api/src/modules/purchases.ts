import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import {
  supplierSchema,
  documentSearch,
  identifier,
  listSchema,
  purchaseSaveSchema,
  purchaseStateSchema,
  purchaseReceiveSchema,
} from "@caramelo/contracts";
import { requirePermission, HttpError, audit } from "../context.js";
import { purchaseAccess, purchaseCommand } from "../services/purchases.js";
const idFrom = (v: unknown) => z.object({ id: z.uuid() }).parse(v).id;
const filters = z
  .object({
    q: z.string().trim().max(160).default(""),
    supplierId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    buyerId: z.uuid().optional(),
    status: z
      .enum([
        "DRAFT",
        "PENDING",
        "APPROVED",
        "ORDERED",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "CANCELLED",
        "LATE",
      ])
      .optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict()
  .refine((f) => !f.from || !f.to || f.from <= f.to, "Período inválido");
export async function purchaseRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/suppliers", async (req) => {
    const a = requirePermission(req, "suppliers:read"),
      f = listSchema.parse(req.query);
    const where: Prisma.SupplierWhereInput = {
      companyId: a.companyId,
      OR: [
        ...(["name", "tradeName", "city", "contact"] as const).map((k) => ({
          [k]: { contains: f.q, mode: "insensitive" },
        })),
        { document: { contains: documentSearch(f.q) } },
      ],
    };
    const [items, total] = await db.$transaction([
      db.supplier.findMany({
        where,
        orderBy: { name: "asc" },
        take: f.limit,
        skip: (f.page - 1) * f.limit,
      }),
      db.supplier.count({ where }),
    ]);
    return { items, total, page: f.page, limit: f.limit };
  });
  for (const method of ["post", "put"] as const)
    app[method](
      "/api/suppliers" + (method === "put" ? "/:id" : ""),
      async (req, reply) => {
        const a = requirePermission(req, "suppliers:write"),
          data = supplierSchema.parse(req.body),
          id = method === "put" ? idFrom(req.params) : null;
        const row = await db.$transaction(async (tx) => {
          if (
            id &&
            !(await tx.supplier.findFirst({
              where: { id, companyId: a.companyId },
            }))
          )
            throw new HttpError(404, "Fornecedor indisponível.");
          const result = id
            ? await tx.supplier.update({
                where: { companyId_id: { companyId: a.companyId, id } },
                data,
              })
            : await tx.supplier.create({
                data: { ...data, companyId: a.companyId },
              });
          await audit(tx, a, id ? "UPDATE" : "CREATE", "suppliers", result.id);
          return result;
        });
        return reply.code(id ? 200 : 201).send(row);
      },
    );
  app.get("/api/purchases/options", async (req) => {
    const a = requirePermission(req, "purchases:read"),
      scope = {
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
      };
    return {
      branches: await db.branch.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { id: a.branchId } : {}),
        },
        orderBy: { name: "asc" },
      }),
      warehouses: await db.warehouse.findMany({
        where: { ...scope, kind: "STANDARD" },
        select: { id: true, branchId: true, name: true },
      }),
      suppliers: await db.supplier.findMany({
        where: { companyId: a.companyId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      buyers: await db.membership.findMany({
        where: {
          companyId: a.companyId,
          active: true,
          user: { active: true },
          ...(a.branchId
            ? { OR: [{ branchId: null }, { branchId: a.branchId }] }
            : {}),
        },
        select: { id: true, branchId: true, user: { select: { name: true } } },
      }),
    };
  });
  app.get("/api/purchases/books", async (req) => {
    const a = requirePermission(req, "purchases:read"),
      f = z
        .object({
          q: z.string().trim().max(160).default(""),
          code: z.string().trim().min(1).max(80).optional(),
        })
        .strict()
        .parse(req.query);
    return db.product.findMany({
      where: {
        companyId: a.companyId,
        active: true,
        ...(f.code
          ? { identifiers: { some: { value: identifier(f.code) } } }
          : {
              OR: (
                [
                  "description",
                  "code",
                  "isbn13",
                  "isbn10",
                  "barcode",
                  "author",
                  "publisher",
                ] as const
              ).map((k) => ({ [k]: { contains: f.q, mode: "insensitive" } })),
            }),
      },
      select: {
        id: true,
        description: true,
        isbn13: true,
        author: true,
        publisher: true,
        cost: true,
      },
      orderBy: { description: "asc" },
      take: 30,
    });
  });
  app.get("/api/purchases/replenishment", async (req) => {
    const a = requirePermission(req, "purchases:read"),
      f = z
        .object({
          branchId: z.uuid(),
          q: z.string().max(160).default(""),
          page: z.coerce.number().int().min(1).default(1),
        })
        .strict()
        .parse(req.query);
    if (
      (a.branchId && f.branchId !== a.branchId) ||
      !(await db.branch.findFirst({
        where: { id: f.branchId, companyId: a.companyId },
      }))
    )
      throw new HttpError(404, "Filial indisponível.");
    const items = await db.$queryRaw<Array<Record<string, unknown>>>`
   WITH balances AS (
    SELECT p.id,p.description,p."isbn13",p.author,p.publisher,p.cost::text,p."supplierId",s.name AS "supplierName",
     SUM(COALESCE(b.quantity,0)) AS quantity,SUM(COALESCE(b."minStock",p."minStock")) AS minimum
    FROM "Product" p JOIN "Warehouse" w ON w."companyId"=p."companyId" AND w."branchId"=${f.branchId}::uuid AND w.kind='STANDARD'
    LEFT JOIN "StockBalance" b ON b."companyId"=p."companyId" AND b."warehouseId"=w.id AND b."productId"=p.id
    LEFT JOIN "Supplier" s ON s."companyId"=p."companyId" AND s.id=p."supplierId"
    WHERE p."companyId"=${a.companyId}::uuid AND p.active AND (p.description ILIKE ${"%" + f.q + "%"} OR p."isbn13" ILIKE ${"%" + f.q + "%"})
    GROUP BY p.id,s.name
   ) SELECT *,quantity::text AS quantity,minimum::text AS minimum,GREATEST(1,CEIL(minimum-quantity))::int AS suggested,COUNT(*) OVER()::int AS "resultCount"
   FROM balances WHERE quantity<=minimum ORDER BY description,id LIMIT 50 OFFSET ${(f.page - 1) * 50}`;
    return {
      items,
      total: Number(items[0]?.resultCount ?? 0),
      page: f.page,
      limit: 50,
    };
  });
  app.get("/api/purchases/cost-history", async (req) => {
    const a = requirePermission(req, "purchases:read"),
      f = z
        .object({
          productId: z.uuid(),
          page: z.coerce.number().int().min(1).default(1),
        })
        .strict()
        .parse(req.query);
    const where: Prisma.PurchaseReceiptItemWhereInput = {
      companyId: a.companyId,
      orderItem: { productId: f.productId },
      receipt: { order: { ...(a.branchId ? { branchId: a.branchId } : {}) } },
    };
    const [items, total] = await db.$transaction([
      db.purchaseReceiptItem.findMany({
        where,
        include: {
          orderItem: { select: { title: true, isbn: true } },
          receipt: {
            include: {
              order: {
                select: {
                  id: true,
                  number: true,
                  supplier: { select: { name: true } },
                  branch: { select: { name: true } },
                },
              },
              document: {
                select: {
                  receivedAt: true,
                  actor: { select: { user: { select: { name: true } } } },
                },
              },
            },
          },
        },
        orderBy: [{ receipt: { createdAt: "desc" } }, { id: "desc" }],
        take: 50,
        skip: (f.page - 1) * 50,
      }),
      db.purchaseReceiptItem.count({ where }),
    ]);
    return { items, total, page: f.page, limit: 50 };
  });
  app.get("/api/purchases", async (req) => {
    const a = requirePermission(req, "purchases:read"),
      f = filters.parse(req.query);
    if (a.branchId && f.branchId && a.branchId !== f.branchId)
      throw new HttpError(404, "Filial indisponível.");
    const scope: Prisma.PurchaseOrderWhereInput = {
      companyId: a.companyId,
      ...(a.branchId || f.branchId
        ? { branchId: a.branchId ?? f.branchId }
        : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.buyerId ? { buyerId: f.buyerId } : {}),
      ...(f.from || f.to
        ? {
            orderedAt: {
              ...(f.from ? { gte: new Date(f.from) } : {}),
              ...(f.to ? { lte: new Date(f.to) } : {}),
            },
          }
        : {}),
      ...(f.q
        ? {
            OR: [
              ...(/^\d+$/.test(f.q) && f.q.length < 10
                ? [{ number: Number(f.q) }]
                : []),
              {
                items: {
                  some: {
                    OR: (["title", "isbn", "author", "publisher"] as const).map(
                      (k) => ({ [k]: { contains: f.q, mode: "insensitive" } }),
                    ),
                  },
                },
              },
            ],
          }
        : {}),
    };
    const late = {
      status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] },
      expectedAt: { lt: new Date(new Date().toISOString().slice(0, 10)) },
    };
    const where = {
      ...scope,
      ...(f.status === "LATE" ? late : f.status ? { status: f.status } : {}),
    };
    const [items, total, counts, overdue] = await db.$transaction([
      db.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { name: true } },
          branch: { select: { name: true } },
          buyer: { select: { user: { select: { name: true } } } },
        },
        orderBy: { number: "desc" },
        take: 25,
        skip: (f.page - 1) * 25,
      }),
      db.purchaseOrder.count({ where }),
      db.purchaseOrder.groupBy({
        by: ["status"],
        where: scope,
        orderBy: { status: "asc" },
        _count: true,
      }),
      db.purchaseOrder.count({ where: { ...scope, ...late } }),
    ]);
    return { items, total, page: f.page, limit: 25, counts, overdue };
  });
  app.get("/api/purchases/:id", async (req) => {
    const a = requirePermission(req, "purchases:read"),
      id = idFrom(req.params);
    return db.$transaction(
      async (tx) => {
        await purchaseAccess(tx, a, id);
        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id },
          include: {
            supplier: { select: { id: true, name: true } },
            branch: { select: { name: true } },
            buyer: { select: { user: { select: { name: true } } } },
            createdBy: { select: { user: { select: { name: true } } } },
            approvedBy: { select: { user: { select: { name: true } } } },
            items: true,
            actions: {
              orderBy: { createdAt: "asc" },
              include: {
                actor: { select: { user: { select: { name: true } } } },
              },
            },
            receipts: {
              orderBy: { createdAt: "asc" },
              include: {
                document: {
                  include: {
                    actor: { select: { user: { select: { name: true } } } },
                    warehouse: true,
                  },
                },
                items: { include: { orderItem: true } },
                divergences: {
                  include: { product: { select: { description: true } } },
                },
              },
            },
          },
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  });
  app.post("/api/purchases", async (req, reply) =>
    reply
      .code(201)
      .send(
        await purchaseCommand(
          db,
          requirePermission(req, "purchases:create"),
          "CREATE",
          null,
          purchaseSaveSchema.parse(req.body),
        ),
      ),
  );
  app.put("/api/purchases/:id", async (req) =>
    purchaseCommand(
      db,
      requirePermission(req, "purchases:edit"),
      "UPDATE",
      idFrom(req.params),
      purchaseSaveSchema.parse(req.body),
    ),
  );
  app.post("/api/purchases/:id/state", async (req) => {
    const data = purchaseStateSchema.parse(req.body);
    const permission =
      data.action === "APPROVE"
        ? "purchases:approve"
        : data.action === "CANCEL"
          ? "purchases:cancel"
          : "purchases:edit";
    return purchaseCommand(
      db,
      requirePermission(req, permission),
      "STATE",
      idFrom(req.params),
      data,
    );
  });
  app.post("/api/purchases/:id/receipts", async (req, reply) =>
    reply
      .code(201)
      .send(
        await purchaseCommand(
          db,
          requirePermission(req, "purchases:receive"),
          "RECEIVE",
          idFrom(req.params),
          purchaseReceiveSchema.parse(req.body),
        ),
      ),
  );
}
