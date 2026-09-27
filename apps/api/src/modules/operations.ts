import type { FastifyInstance } from "fastify";
import type { Database } from "@caramelo/database";
import { z } from "zod";
import {
  cashOpenSchema,
  cashMoveSchema,
  cashCloseSchema,
  returnSchema,
} from "@caramelo/contracts";
import { requirePermission, HttpError } from "../context.js";
import {
  cashInclude,
  cashSummary,
  sessionAccess,
  openCash,
  moveCash,
  closeCash,
} from "../services/cash.js";
import {
  completeReturn,
  quoteReturn,
  returnInclude,
} from "../services/returns.js";
const id = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
export async function operationRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/cash/options", async (req) => {
    const a = requirePermission(req, "cash:read"),
      scope = {
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
      };
    return {
      registers: await db.cashRegister.findMany({
        where: { ...scope, branchId: a.branchId ?? { not: null } },
        include: { branch: true },
        orderBy: { name: "asc" },
      }),
      branches: await db.branch.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { id: a.branchId } : {}),
        },
      }),
      sessions: await db.cashSession.findMany({
        where: { ...scope, status: "OPEN" },
        include: {
          cashRegister: true,
          openedBy: { select: { user: { select: { name: true } } } },
        },
        orderBy: { openedAt: "desc" },
      }),
    };
  });
  app.post("/api/cash/registers", async (req, reply) => {
    const a = requirePermission(req, "cash:manage"),
      data = z
        .object({ branchId: z.uuid(), name: z.string().trim().min(2).max(80) })
        .strict()
        .parse(req.body);
    if (
      (a.branchId && a.branchId !== data.branchId) ||
      !(await db.branch.findFirst({
        where: { companyId: a.companyId, id: data.branchId },
      }))
    )
      throw new HttpError(404, "Filial indisponível.");
    return reply.code(201).send(
      await db.$transaction(async (tx) => {
        const r = await tx.cashRegister.create({
          data: { ...data, companyId: a.companyId },
        });
        await tx.auditLog.create({
          data: {
            companyId: a.companyId,
            actorId: a.membershipId,
            module: "cash",
            action: "REGISTER_CREATED",
            recordId: r.id,
            metadata: { branchId: r.branchId },
          },
        });
        return r;
      }),
    );
  });
  app.get("/api/cash/sessions", async (req) => {
    const a = requirePermission(req, "cash:read"),
      q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          status: z.enum(["OPEN", "CLOSED"]).optional(),
        })
        .parse(req.query),
      where = {
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
        ...(q.status ? { status: q.status } : {}),
      };
    const [items, total] = await db.$transaction([
      db.cashSession.findMany({
        where,
        include: {
          cashRegister: true,
          branch: true,
          openedBy: { select: { user: { select: { name: true } } } },
        },
        orderBy: { openedAt: "desc" },
        take: 25,
        skip: (q.page - 1) * 25,
      }),
      db.cashSession.count({ where }),
    ]);
    return { items, total, page: q.page, limit: 25 };
  });
  app.get("/api/cash/sessions/:id", async (req) => {
    const a = requirePermission(req, "cash:read"),
      key = id(req.params);
    return db.$transaction(async (tx) => {
      await sessionAccess(tx, a, key);
      const session = await tx.cashSession.findUniqueOrThrow({
        where: { id: key },
        include: cashInclude,
      });
      return {
        ...session,
        summary:
          session.status === "CLOSED"
            ? session.closingSummary
            : await cashSummary(tx, a, key),
      };
    });
  });
  app.post("/api/cash/sessions", async (req, reply) =>
    reply
      .code(201)
      .send(
        await openCash(
          db,
          requirePermission(req, "cash:operate"),
          cashOpenSchema.parse(req.body),
        ),
      ),
  );
  app.post("/api/cash/sessions/:id/movements", async (req, reply) =>
    reply
      .code(201)
      .send(
        await moveCash(
          db,
          requirePermission(req, "cash:operate"),
          id(req.params),
          cashMoveSchema.parse(req.body),
        ),
      ),
  );
  app.post("/api/cash/sessions/:id/close", async (req) =>
    closeCash(
      db,
      requirePermission(req, "cash:operate"),
      id(req.params),
      cashCloseSchema.parse(req.body),
    ),
  );
  app.post("/api/returns/quote", async (req) => {
    const a = requirePermission(req, "returns:create"),
      input = returnSchema.parse(req.body);
    return db.$transaction(async (tx) => {
      const q = await quoteReturn(tx, a, input);
      return {
        items: q.items,
        returnedAmount: q.returnedAmount,
        newAmount: q.newAmount,
        difference: q.difference,
        credit: q.credit,
      };
    });
  });
  app.post("/api/returns", async (req, reply) =>
    reply
      .code(201)
      .send(
        await completeReturn(
          db,
          requirePermission(req, "returns:create"),
          returnSchema.parse(req.body),
        ),
      ),
  );
  app.get("/api/returns", async (req) => {
    const a = requirePermission(req, "sales:read"),
      q = z
        .object({
          saleId: z.uuid().optional(),
          page: z.coerce.number().int().min(1).default(1),
        })
        .parse(req.query),
      where = {
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
        ...(q.saleId ? { originalSaleId: q.saleId } : {}),
      };
    const [items, total] = await db.$transaction([
      db.returnOperation.findMany({
        where,
        include: returnInclude,
        orderBy: { createdAt: "desc" },
        take: 25,
        skip: (q.page - 1) * 25,
      }),
      db.returnOperation.count({ where }),
    ]);
    return { items, total, page: q.page, limit: 25 };
  });
  app.get("/api/returns/:id", async (req) => {
    const a = requirePermission(req, "sales:read");
    const r = await db.returnOperation.findFirst({
      where: {
        id: id(req.params),
        companyId: a.companyId,
        ...(a.branchId ? { branchId: a.branchId } : {}),
      },
      include: returnInclude,
    });
    if (!r) throw new HttpError(404, "Troca/devolução indisponível.");
    return r;
  });
  app.get("/api/credits", async (req) => {
    const a = requirePermission(req, "sales:read"),
      q = z.object({ customerId: z.uuid() }).parse(req.query);
    return db.customerCredit.findMany({
      where: {
        companyId: a.companyId,
        customerId: q.customerId,
        ...(a.branchId ? { returnOperation: { branchId: a.branchId } } : {}),
      },
      include: {
        returnOperation: { select: { number: true, originalSaleId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  });
}
