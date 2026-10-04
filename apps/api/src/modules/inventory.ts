import type { FastifyInstance } from "fastify";
import { type Database } from "@caramelo/database";
import { z } from "zod";
import { identifier, csvCell } from "@caramelo/contracts";
import { requirePermission } from "../context.js";
import {
  inventoryAccess,
  inventoryCommand,
  inventoryPermission,
  inventoryScope,
  inventoryView,
  type InventoryCommand,
} from "../services/inventory.js";
export async function inventoryRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/inventory/options", async (req) => {
    const a = requirePermission(req, "inventory:read");
    const [warehouses, responsibles] = await Promise.all([
      db.warehouse.findMany({
        where: { ...inventoryScope(a), kind: "STANDARD" },
        include: { branch: { select: { name: true } } },
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
    return { warehouses, responsibles };
  });
  app.get("/api/inventory/books", async (req) => {
    const a = requirePermission(req, "inventory:read");
    const f = z
      .object({
        q: z.string().trim().max(160).default(""),
        code: z.string().trim().max(160).optional(),
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
                { author: { contains: f.q, mode: "insensitive" } },
                { publisher: { contains: f.q, mode: "insensitive" } },
                { location: { contains: f.q, mode: "insensitive" } },
                { category: { name: { contains: f.q, mode: "insensitive" } } },
                { isbn13: { contains: identifier(f.q) } },
              ],
            }),
      },
      select: { id: true, description: true, code: true, isbn13: true },
      orderBy: { description: "asc" },
      take: 50,
    });
  });
  app.get("/api/inventory", async (req) => {
    const a = requirePermission(req, "inventory:read");
    const f = z
      .object({
        q: z.string().trim().max(160).default(""),
        status: z
          .enum([
            "DRAFT",
            "COUNTING",
            "RECOUNT_REQUIRED",
            "UNDER_REVIEW",
            "APPROVED",
            "CLOSED",
            "CANCELLED",
          ])
          .optional(),
        branchId: z.uuid().optional(),
        warehouseId: z.uuid().optional(),
        responsibleId: z.uuid().optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .strict()
      .refine((v) => !v.from || !v.to || v.from <= v.to, "Período inválido")
      .parse(req.query);
    const where = {
      ...inventoryScope(a),
      ...(a.branchId ? {} : { branchId: f.branchId }),
      warehouseId: f.warehouseId,
      responsibleId: f.responsibleId,
      status: f.status,
      code: { contains: f.q, mode: "insensitive" as const },
      createdAt: {
        gte: f.from ? new Date(f.from + "T03:00:00Z") : undefined,
        lt: f.to
          ? new Date(new Date(f.to + "T03:00:00Z").getTime() + 86400000)
          : undefined,
      },
    };
    const items = await db.inventory.findMany({
      where,
      select: {
        id: true,
        code: true,
        description: true,
        status: true,
        createdAt: true,
        warehouse: { select: { name: true } },
        branch: { select: { name: true } },
        responsible: { select: { user: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * 25,
      take: 25,
    });
    const total = await db.inventory.count({ where });
    const groups = await db.inventory.groupBy({
      by: ["status"],
      where,
      orderBy: { status: "asc" },
      _count: true,
    });
    const divergent = a.permissions.includes("inventory:review")
      ? (
          await db.inventory.findMany({
            where,
            select: {
              items: {
                select: {
                  systemQuantity: true,
                  currentRound: true,
                  counts: { select: { round: true, quantity: true } },
                },
              },
            },
          })
        ).filter((v) =>
          v.items.some((i) => {
            const c = i.counts.find((c) => c.round === i.currentRound);
            return c && !i.systemQuantity.equals(c.quantity);
          }),
        ).length
      : null;
    return { items, total, groups, divergent, page: f.page };
  });
  app.get("/api/inventory/:id/export", async (req, reply) => {
    const a = requirePermission(req, "inventory:review"),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    const v = await db.$transaction((tx) => inventoryAccess(tx, a, id), {
      isolationLevel: "RepeatableRead",
    });
    const lines: unknown[][] = [
      [
        "Inventário",
        "Filial",
        "Depósito",
        "Livro",
        "ISBN",
        "SKU",
        "Sistema inicial",
        "Referência da rodada",
        "Contado",
        "Diferença inicial",
        "Ajuste",
        "Custo unitário",
        "Rodada",
        "Operador",
        "Motivo",
        "Observação",
      ],
    ];
    for (const i of v.items) {
      const c = i.counts.find((c) => c.round === i.currentRound);
      lines.push([
        v.code,
        v.branch.name,
        v.warehouse.name,
        i.title,
        i.isbn,
        i.sku,
        String(i.systemQuantity),
        c ? String(c.referenceQuantity) : "",
        c?.quantity ?? "",
        c ? c.quantity - Number(i.systemQuantity) : "",
        c ? c.quantity - Number(c.referenceQuantity) : "",
        String(i.unitCost),
        i.currentRound,
        c?.actor.user.name,
        i.reason,
        i.justification,
      ]);
    }
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="inventario.csv"')
      .send(
        "\ufeff" + lines.map((row) => row.map(csvCell).join(";")).join("\r\n"),
      );
  });
  app.get("/api/inventory/:id", async (req) => {
    const a = requirePermission(req, "inventory:read"),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    return db.$transaction(
      async (tx) => {
        const v = await inventoryAccess(tx, a, id);
        const history = a.permissions.includes("inventory:review")
          ? await tx.auditLog.findMany({
              where: {
                companyId: a.companyId,
                module: "inventory",
                recordId: id,
              },
              orderBy: { createdAt: "asc" },
            })
          : [];
        const documents = a.permissions.includes("inventory:review")
          ? await tx.stockDocument.findMany({
              where: { companyId: a.companyId, inventoryId: id },
              include: { items: true, movements: true },
            })
          : [];
        return { ...inventoryView(v, a), history, documents };
      },
      { isolationLevel: "RepeatableRead" },
    );
  });
  app.post("/api/inventory", async (req, reply) =>
    reply
      .code(201)
      .send(
        await inventoryCommand(
          db,
          requirePermission(req, "inventory:create"),
          "CREATE",
          null,
          req.body,
        ),
      ),
  );
  for (const kind of Object.keys(inventoryPermission).filter(
    (v) => v !== "CREATE",
  ) as InventoryCommand[])
    app.post("/api/inventory/:id/" + kind.toLowerCase(), async (req) =>
      inventoryCommand(
        db,
        requirePermission(req, inventoryPermission[kind]),
        kind,
        z.object({ id: z.uuid() }).parse(req.params).id,
        req.body,
      ),
    );
}
