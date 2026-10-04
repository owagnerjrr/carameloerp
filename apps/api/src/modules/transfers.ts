import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import { identifier, transferFiltersSchema } from "@caramelo/contracts";
import { requirePermission } from "../context.js";
import {
  transferAccess,
  transferScope,
  transferInclude,
  transferCommand,
  transferPermission,
  type TransferCommand,
} from "../services/transfers.js";
export async function transferRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/transfers/options", async (req) => {
    const a = requirePermission(req, "transfers:read");
    const [warehouses, responsibles] = await Promise.all([
      db.warehouse.findMany({
        where: { companyId: a.companyId, kind: "STANDARD" },
        select: {
          id: true,
          name: true,
          branchId: true,
          branch: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.membership.findMany({
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
    ]);
    return {
      company: a.companyName,
      branchId: a.branchId ?? null,
      warehouses,
      responsibles,
    };
  });
  app.get("/api/transfers/books", async (req) => {
    const a = requirePermission(req, "transfers:read"),
      f = z
        .object({
          code: z.string().trim().min(1).max(160).optional(),
          q: z.string().trim().max(160).default(""),
        })
        .strict()
        .parse(req.query);
    return db.product.findMany({
      where: {
        companyId: a.companyId,
        ...(f.code
          ? { identifiers: { some: { value: identifier(f.code) } } }
          : {
              OR: [
                { description: { contains: f.q, mode: "insensitive" } },
                { code: { contains: f.q, mode: "insensitive" } },
                { isbn13: { contains: f.q } },
              ],
            }),
      },
      select: {
        id: true,
        description: true,
        code: true,
        isbn13: true,
        active: true,
      },
      take: 30,
      orderBy: { description: "asc" },
    });
  });
  app.get("/api/transfers", async (req) => {
    const a = requirePermission(req, "transfers:read"),
      f = transferFiltersSchema.parse(req.query);
    const where: Prisma.StockTransferWhereInput = {
      ...transferScope(a),
      code: { contains: f.q, mode: "insensitive" },
      originWarehouseId: f.originId,
      destinationWarehouseId: f.destinationId,
      responsibleId: f.responsibleId,
      status: f.status,
      createdAt: {
        gte: f.from ? new Date(f.from + "T03:00:00Z") : undefined,
        lt: f.to
          ? new Date(new Date(f.to + "T03:00:00Z").getTime() + 86400000)
          : undefined,
      },
      ...(f.book
        ? {
            items: {
              some: {
                product: {
                  OR: [
                    { description: { contains: f.book, mode: "insensitive" } },
                    { code: { contains: f.book, mode: "insensitive" } },
                    { isbn13: { contains: identifier(f.book) } },
                    { isbn10: { contains: identifier(f.book) } },
                    { barcode: { contains: f.book } },
                  ],
                },
              },
            },
          }
        : {}),
    };
    const [items, total, groups, divergent] = await db.$transaction([
      db.stockTransfer.findMany({
        where,
        include: transferInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 25,
        skip: (f.page - 1) * 25,
      }),
      db.stockTransfer.count({ where }),
      db.stockTransfer.groupBy({
        by: ["status"],
        orderBy: { status: "asc" },
        where,
        _count: true,
      }),
      db.stockTransfer.count({
        where: {
          AND: [where, { documents: { some: { divergences: { some: {} } } } }],
        },
      }),
    ]);
    return { items, total, page: f.page, groups, divergent };
  });
  app.get("/api/transfers/:id", async (req) => {
    const a = requirePermission(req, "transfers:read"),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    return db.$transaction(
      async (tx) => {
        const t = await transferAccess(tx, a, id);
        const documents = await tx.stockDocument.findMany({
          where: { companyId: a.companyId, transferId: id },
          include: {
            items: true,
            divergences: true,
            movements: true,
            actor: { select: { user: { select: { name: true } } } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const history = await tx.auditLog.findMany({
          where: { companyId: a.companyId, module: "transfers", recordId: id },
          orderBy: { createdAt: "asc" },
        });
        const transit = await tx.stockBalance.findMany({
          where: { companyId: a.companyId, warehouseId: t.transitWarehouseId },
        });
        return { ...t, documents, history, transitBalances: transit };
      },
      { isolationLevel: "RepeatableRead" },
    );
  });
  app.post("/api/transfers", async (req, reply) =>
    reply
      .code(201)
      .send(
        await transferCommand(
          db,
          requirePermission(req, "transfers:create"),
          "CREATE",
          null,
          req.body,
        ),
      ),
  );
  for (const kind of [
    "EDIT",
    "PREPARE",
    "SEND",
    "RECEIVE",
    "RETURN",
    "CANCEL",
    "DIVERGENCE",
  ] as TransferCommand[])
    app.post("/api/transfers/:id/" + kind.toLowerCase(), async (req) =>
      transferCommand(
        db,
        requirePermission(req, transferPermission[kind]),
        kind,
        z.object({ id: z.uuid() }).parse(req.params).id,
        req.body,
      ),
    );
}
