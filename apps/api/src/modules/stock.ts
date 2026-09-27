import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import { stockEntrySchema, stockAdjustmentSchema } from "@caramelo/contracts";
import { requirePermission, HttpError } from "../context.js";
import { confirmStock } from "../services/stock.js";
const query = z
  .object({
    branchId: z.uuid().optional(),
    productId: z.uuid().optional(),
    q: z.string().max(200).default(""),
    publisher: z.string().max(160).default(""),
    categoryId: z.uuid().optional(),
    status: z.enum(["NORMAL", "LOW", "ZERO"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();
export async function stockRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/stock/options", async (req) => {
    const a = requirePermission(req, "stock:read");
    return {
      warehouses: await db.warehouse.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { branchId: a.branchId } : {}),
        },
        include: { branch: true },
        orderBy: { name: "asc" },
      }),
      suppliers: await db.supplier.findMany({
        where: { companyId: a.companyId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      categories: await db.category.findMany({
        where: { companyId: a.companyId },
        select: { id: true, name: true },
      }),
    };
  });
  app.post("/api/stock/entries", async (req, reply) =>
    reply
      .code(201)
      .send(
        await confirmStock(
          db,
          requirePermission(req, "stock:receive"),
          "ENTRY",
          stockEntrySchema.parse(req.body),
        ),
      ),
  );
  app.post("/api/stock/adjustments", async (req, reply) =>
    reply
      .code(201)
      .send(
        await confirmStock(
          db,
          requirePermission(req, "stock:adjust"),
          "ADJUSTMENT",
          stockAdjustmentSchema.parse(req.body),
        ),
      ),
  );
  app.get("/api/stock", async (req) => {
    const a = requirePermission(req, "stock:read"),
      f = query.parse(req.query);
    // Include zero balances via CROSS JOIN; do not hide books without StockBalance rows.
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
  SELECT p.id AS "productId",p.description,p.barcode,p."isbn13",p.author,p.publisher,p.code,p.active,
  w.id AS "warehouseId",w.name AS "warehouseName",b.id AS "branchId",b.name AS "branchName",
  COALESCE(s.quantity,0)::text AS quantity,COALESCE(s."minStock",p."minStock")::text AS "minStock",COALESCE(s.location,p.location) AS location,
  CASE WHEN COALESCE(s.quantity,0)=0 THEN 'ZERO' WHEN COALESCE(s.quantity,0)<=COALESCE(s."minStock",p."minStock") THEN 'LOW' ELSE 'NORMAL' END AS status,
  COUNT(*) OVER()::int AS "resultCount"
  FROM "Product" p CROSS JOIN "Warehouse" w JOIN "Branch" b ON b.id=w."branchId" AND b."companyId"=w."companyId"
  LEFT JOIN "StockBalance" s ON s."companyId"=p."companyId" AND s."productId"=p.id AND s."warehouseId"=w.id
  WHERE p."companyId"=${a.companyId}::uuid AND w."companyId"=p."companyId"
  ${a.branchId ? Prisma.sql`AND b.id=${a.branchId}::uuid` : Prisma.empty}
  ${f.branchId ? Prisma.sql`AND b.id=${f.branchId}::uuid` : Prisma.empty}
  ${f.productId ? Prisma.sql`AND p.id=${f.productId}::uuid` : Prisma.empty}
  AND (p.description ILIKE ${"%" + f.q + "%"} OR p.code ILIKE ${"%" + f.q + "%"} OR p.author ILIKE ${"%" + f.q + "%"} OR p.barcode ILIKE ${"%" + f.q + "%"} OR p."isbn13" ILIKE ${"%" + f.q + "%"} OR p."isbn10" ILIKE ${"%" + f.q + "%"})
  AND COALESCE(p.publisher,'') ILIKE ${"%" + f.publisher + "%"}
  ${f.categoryId ? Prisma.sql`AND p."categoryId"=${f.categoryId}::uuid` : Prisma.empty}
  ${f.status === "ZERO" ? Prisma.sql`AND COALESCE(s.quantity,0)=0` : f.status === "LOW" ? Prisma.sql`AND COALESCE(s.quantity,0)>0 AND COALESCE(s.quantity,0)<=COALESCE(s."minStock",p."minStock")` : f.status === "NORMAL" ? Prisma.sql`AND COALESCE(s.quantity,0)>COALESCE(s."minStock",p."minStock")` : Prisma.empty}
  ORDER BY p.description,p.id,b.name,w.id LIMIT 100 OFFSET ${(f.page - 1) * 100}`;
    return {
      items: rows,
      total: Number(rows[0]?.resultCount ?? 0),
      page: f.page,
      limit: 100,
    };
  });
  app.get("/api/stock/books/:id", async (req) => {
    const a = requirePermission(req, "stock:read"),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    if (
      !(await db.product.findFirst({ where: { id, companyId: a.companyId } }))
    )
      throw new HttpError(404, "Livro não encontrado.");
    const warehouses = await db.warehouse.findMany({
      where: {
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
      },
      include: { branch: true, balances: { where: { productId: id } } },
    });
    const branches = new Map<
      string,
      { id: string; name: string; quantity: Prisma.Decimal }
    >();
    for (const w of warehouses) {
      const item = branches.get(w.branchId) ?? {
        id: w.branchId,
        name: w.branch.name,
        quantity: new Prisma.Decimal(0),
      };
      item.quantity = item.quantity.plus(w.balances[0]?.quantity ?? 0);
      branches.set(w.branchId, item);
    }
    const items = [...branches.values()];
    return {
      branches: items,
      total: items.reduce((n, b) => n.plus(b.quantity), new Prisma.Decimal(0)),
      scope: a.branchId ? "filial" : "empresa",
    };
  });
  app.get("/api/stock/movements", async (req) => {
    const a = requirePermission(req, "stock:read"),
      f = query.parse(req.query);
    const where = {
      companyId: a.companyId,
      ...(f.productId ? { productId: f.productId } : {}),
      warehouse: {
        ...(f.branchId ? { branchId: f.branchId } : {}),
        ...(a.branchId ? { branchId: a.branchId } : {}),
      },
    };
    if (a.branchId && f.branchId && a.branchId !== f.branchId)
      return { items: [], total: 0, page: f.page, limit: 100 };
    const [items, total] = await db.$transaction([
      db.stockMovement.findMany({
        where,
        include: {
          sale: { select: { id: true, number: true, status: true } },
          returnOperation: { select: { id: true, number: true, kind: true } },
          warehouse: { include: { branch: true } },
          actor: { include: { user: { select: { name: true } } } },
          document: { select: { id: true, kind: true, documentNumber: true } },
          product: { select: { description: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        skip: (f.page - 1) * 100,
      }),
      db.stockMovement.count({ where }),
    ]);
    return { items, total, page: f.page, limit: 100 };
  });
}
