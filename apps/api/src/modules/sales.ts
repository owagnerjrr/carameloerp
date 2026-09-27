import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import {
  checkoutSchema,
  quoteSchema,
  cancelSaleSchema,
  identifier,
} from "@caramelo/contracts";
import { requirePermission, HttpError } from "../context.js";
import { warehouseAccess } from "../services/stock.js";
import {
  priceCart,
  completeSale,
  cancelSale,
  saleInclude,
} from "../services/sales.js";
const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
const filter = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    branchId: z.uuid().optional(),
    operatorId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    customerQuery: z.string().trim().max(100).optional(),
    status: z
      .enum(["COMPLETED", "CANCELLED", "QUOTE", "ORDER", "RETURNED"])
      .optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(
    (v) =>
      v.from <= v.to &&
      (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 366,
    "Informe um período válido de até 366 dias",
  );
export async function salesRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/sales/options", async (req) => {
    const a = requirePermission(req, "sales:read");
    return {
      warehouses: await db.warehouse.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { branchId: a.branchId } : {}),
        },
        include: { branch: true },
        orderBy: { name: "asc" },
      }),
      operators: await db.membership.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId
            ? {
                OR: [
                  { branchId: a.branchId },
                  { branchId: null },
                  { role: { name: "Administrador" } },
                ],
              }
            : {}),
        },
        select: { id: true, user: { select: { name: true } } },
      }),
    };
  });
  app.get("/api/sales/lookup", async (req) => {
    const a = requirePermission(req, "sales:create");
    const q = z
      .object({
        warehouseId: z.uuid(),
        code: z.string().trim().min(1).max(80).optional(),
        productId: z.uuid().optional(),
      })
      .strict()
      .refine((v) => !!v.code !== !!v.productId)
      .parse(req.query);
    return db.$transaction(async (tx) => {
      await warehouseAccess(tx, a, q.warehouseId);
      const p = q.productId
        ? await tx.product.findFirst({
            where: { id: q.productId, companyId: a.companyId, active: true },
          })
        : (
            await tx.productIdentifier.findUnique({
              where: {
                companyId_value: {
                  companyId: a.companyId,
                  value: identifier(q.code!),
                },
              },
              include: { product: true },
            })
          )?.product;
      if (!p || !p.active) throw new HttpError(404, "Livro não encontrado.");
      const balance = await tx.stockBalance.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: a.companyId,
            warehouseId: q.warehouseId,
            productId: p.id,
          },
        },
      });
      return {
        id: p.id,
        description: p.description,
        isbn: p.isbn13 ?? p.barcode ?? p.isbn10,
        author: p.author,
        publisher: p.publisher,
        code: p.code,
        price: String(p.price),
        available: String(balance?.quantity ?? 0),
      };
    });
  });
  app.post("/api/sales/quote", async (req) => {
    const a = requirePermission(req, "sales:create"),
      cart = quoteSchema.parse(req.body);
    const result = await db.$transaction((tx) => priceCart(tx, a, cart));
    return {
      ...result,
      items: result.items.map(({ unitCost: _, ...item }) => {
        void _;
        return item;
      }),
    };
  });
  app.post("/api/sales", async (req, reply) =>
    reply
      .code(201)
      .send(
        await completeSale(
          db,
          requirePermission(req, "sales:create"),
          checkoutSchema.parse(req.body),
        ),
      ),
  );
  app.post("/api/sales/:id/cancel", async (req) =>
    cancelSale(
      db,
      requirePermission(req, "sales:cancel"),
      id(req.params),
      cancelSaleSchema.parse(req.body),
    ),
  );
  app.get("/api/sales", async (req) => {
    const a = requirePermission(req, "sales:read"),
      f = filter.parse(req.query);
    if (a.branchId && f.branchId && a.branchId !== f.branchId)
      return { items: [], total: 0, page: f.page, limit: 25 };
    const where: Prisma.SaleWhereInput = {
      companyId: a.companyId,
      createdAt: {
        gte: new Date(f.from + "T00:00:00-03:00"),
        lt: new Date(Date.parse(f.to + "T00:00:00-03:00") + 86400000),
      },
      ...(a.branchId || f.branchId
        ? { branchId: a.branchId ?? f.branchId }
        : {}),
      ...(f.operatorId ? { sellerId: f.operatorId } : {}),
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.customerQuery
        ? {
            customer: {
              OR: [
                { name: { contains: f.customerQuery, mode: "insensitive" } },
                { document: { contains: f.customerQuery } },
                { phone: { contains: f.customerQuery } },
                { email: { contains: f.customerQuery, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      ...(f.status ? { status: f.status } : {}),
    };
    const [items, total] = await db.$transaction([
      db.sale.findMany({
        where,
        include: {
          branch: true,
          customer: { select: { name: true } },
          seller: { select: { user: { select: { name: true } } } },
          items: { select: { quantity: true } },
          payments: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        skip: (f.page - 1) * 25,
      }),
      db.sale.count({ where }),
    ]);
    return { items, total, page: f.page, limit: 25 };
  });
  app.get("/api/sales/:id", async (req) => {
    const a = requirePermission(req, "sales:read");
    const sale = await db.sale.findFirst({
      where: {
        id: id(req.params),
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
      },
      include: saleInclude,
    });
    if (!sale) throw new HttpError(404, "Venda indisponível.");
    return sale;
  });
}
