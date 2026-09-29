import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import {
  eventSaveSchema,
  eventMoveSchema,
  eventReceiveSchema,
  eventTransitionSchema,
  identifier,
} from "@caramelo/contracts";
import { requirePermission, HttpError } from "../context.js";
import { eventAccess, eventCommand } from "../services/events.js";
const id = (v: unknown) => z.object({ id: z.uuid() }).parse(v).id;
export async function eventRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/events/options", async (req) => {
    const a = requirePermission(req, "events:read");
    return {
      branches: await db.branch.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { id: a.branchId } : {}),
        },
        select: { id: true, name: true },
      }),
      warehouses: await db.warehouse.findMany({
        where: {
          companyId: a.companyId,
          kind: "STANDARD",
          ...(a.branchId ? { branchId: a.branchId } : {}),
        },
        select: { id: true, name: true, branchId: true },
      }),
      responsibles: await db.membership.findMany({
        where: {
          companyId: a.companyId,
          active: true,
          user: { active: true },
          ...(a.branchId
            ? { OR: [{ branchId: a.branchId }, { branchId: null }] }
            : {}),
        },
        select: { id: true, branchId: true, user: { select: { name: true } } },
      }),
    };
  });
  app.get("/api/events/books", async (req) => {
    const a = requirePermission(req, "events:read"),
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
        ...(f.code
          ? { identifiers: { some: { value: identifier(f.code) } } }
          : {
              OR: [
                "description",
                "author",
                "publisher",
                "isbn13",
                "isbn10",
                "barcode",
                "code",
              ].map((k) => ({ [k]: { contains: f.q, mode: "insensitive" } })),
            }),
      },
      select: {
        id: true,
        description: true,
        isbn13: true,
        isbn10: true,
        barcode: true,
        author: true,
        publisher: true,
        active: true,
      },
      take: 30,
      orderBy: { description: "asc" },
    });
  });
  app.get("/api/events", async (req) => {
    const a = requirePermission(req, "events:read"),
      f = z
        .object({
          view: z.enum(["ACTIVE", "UPCOMING", "CLOSED"]).default("ACTIVE"),
          q: z.string().max(160).default(""),
          page: z.coerce.number().int().min(1).default(1),
        })
        .strict()
        .parse(req.query);
    const where: Prisma.EventWhereInput = {
      companyId: a.companyId,
      ...(a.branchId ? { branchId: a.branchId } : {}),
      status:
        f.view === "CLOSED"
          ? { in: ["CLOSED", "CANCELLED"] }
          : { notIn: ["CLOSED", "CANCELLED"] },
      ...(f.view === "UPCOMING"
        ? { startsAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } }
        : {}),
      OR: [
        { name: { contains: f.q, mode: "insensitive" } },
        { code: { contains: f.q, mode: "insensitive" } },
      ],
    };
    const [items, total] = await db.$transaction([
      db.event.findMany({
        where,
        include: {
          branch: { select: { name: true } },
          responsible: { select: { user: { select: { name: true } } } },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 25,
        skip: (f.page - 1) * 25,
      }),
      db.event.count({ where }),
    ]);
    return { items, total, page: f.page, limit: 25 };
  });
  app.get("/api/events/:id", async (req) =>
    db.$transaction(
      async (tx) => {
        const a = requirePermission(req, "events:read"),
          event = await eventAccess(tx, a, id(req.params));
        const documents = await tx.eventDocument.findMany({
          where: { companyId: a.companyId, eventId: event.id },
          include: {
            items: true,
            actor: { select: { user: { select: { name: true } } } },
            warehouse: { select: { name: true } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 5001,
        });
        if (documents.length > 5000)
          throw new HttpError(
            409,
            "Evento excede o limite de consulta de 5.000 documentos.",
          );
        const balances = await tx.stockBalance.findMany({
          where: {
            companyId: a.companyId,
            warehouseId: { in: [event.warehouseId, event.transitWarehouseId] },
          },
        });
        const stock = new Map<
          string,
          {
            productId: string;
            title: string;
            isbn: string | null;
            author: string | null;
            publisher: string | null;
            sent: number;
            received: number;
            returned: number;
            current: number;
            transit: number;
          }
        >();
        for (const d of documents)
          for (const i of d.items) {
            const row = stock.get(i.productId) ?? {
              productId: i.productId,
              title: i.title,
              isbn: i.isbn,
              author: i.author,
              publisher: i.publisher,
              sent: 0,
              received: 0,
              returned: 0,
              current: 0,
              transit: 0,
            };
            if (d.kind === "DISPATCH") row.sent += i.quantity;
            if (d.kind === "RECEIVE") row.received += i.quantity;
            if (d.kind === "RETURN") row.returned += i.quantity;
            stock.set(i.productId, row);
          }
        for (const b of balances) {
          const row = stock.get(b.productId);
          if (row) {
            if (b.warehouseId === event.warehouseId)
              row.current = Number(b.quantity);
            else row.transit = Number(b.quantity);
          }
        }
        const items = [...stock.values()];
        return {
          ...event,
          documents,
          stock: items,
          summary: {
            titles: items.filter((i) => i.current > 0).length,
            sent: items.reduce((n, i) => n + i.sent, 0),
            received: items.reduce((n, i) => n + i.received, 0),
            returned: items.reduce((n, i) => n + i.returned, 0),
            current: items.reduce((n, i) => n + i.current, 0),
            transit: items.reduce((n, i) => n + i.transit, 0),
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    ),
  );
  app.post("/api/events", async (req, reply) =>
    reply
      .code(201)
      .send(
        await eventCommand(
          db,
          requirePermission(req, "events:create"),
          "CREATE",
          null,
          eventSaveSchema.parse(req.body),
        ),
      ),
  );
  app.put("/api/events/:id", async (req) =>
    eventCommand(
      db,
      requirePermission(req, "events:manage"),
      "UPDATE",
      id(req.params),
      eventSaveSchema.parse(req.body),
    ),
  );
  app.post("/api/events/:id/state", async (req) =>
    eventCommand(
      db,
      requirePermission(req, "events:manage"),
      "STATE",
      id(req.params),
      eventTransitionSchema.parse(req.body),
    ),
  );
  for (const [path, kind] of [
    ["dispatches", "DISPATCH"],
    ["returns", "RETURN"],
  ] as const)
    app.post("/api/events/:id/" + path, async (req, reply) =>
      reply
        .code(201)
        .send(
          await eventCommand(
            db,
            requirePermission(req, "events:stock"),
            kind,
            id(req.params),
            eventMoveSchema.parse(req.body),
          ),
        ),
    );
  app.post("/api/events/:id/receipts", async (req, reply) =>
    reply
      .code(201)
      .send(
        await eventCommand(
          db,
          requirePermission(req, "events:stock"),
          "RECEIVE",
          id(req.params),
          eventReceiveSchema.parse(req.body),
        ),
      ),
  );
}
