import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import { payableFiltersSchema, cents, reais } from "@caramelo/contracts";
import { requirePermission, HttpError, type AuthContext } from "../context.js";
import {
  payableCommand,
  payableScope,
  entryAmounts,
  financialToday,
} from "../services/payables.js";
const idFrom = (v: unknown) => z.object({ id: z.uuid() }).parse(v).id;
const include = {
  obligation: {
    include: {
      branch: true,
      supplier: true,
      category: true,
      purchaseOrder: { select: { id: true, number: true } },
      actor: { select: { user: { select: { name: true } } } },
    },
  },
} as const;
async function rows(
  db: Database,
  a: AuthContext,
  query: unknown,
  paginated = false,
) {
  const f = payableFiltersSchema.parse(query);
  if (a.branchId && f.branchId && a.branchId !== f.branchId)
    throw new HttpError(404, "Filial indisponível.");
  const where: Prisma.FinancialEntryWhereInput = {
    ...payableScope(a),
    ...(f.branchId ? { branchId: f.branchId } : {}),
    dueDate: {
      gte: f.from ? new Date(f.from) : undefined,
      lte: f.to ? new Date(f.to) : undefined,
    },
    obligation: {
      purchaseOrderId: f.purchaseOrderId,
      supplierId: f.supplierId,
      categoryId: f.categoryId,
      origin: f.origin,
      issuedAt: {
        gte: f.issuedFrom ? new Date(f.issuedFrom) : undefined,
        lte: f.issuedTo ? new Date(f.issuedTo) : undefined,
      },
      documentNumber: { contains: f.documentNumber, mode: "insensitive" },
      OR: [
        { description: { contains: f.q, mode: "insensitive" } },
        { supplier: { name: { contains: f.q, mode: "insensitive" } } },
        { documentNumber: { contains: f.q, mode: "insensitive" } },
      ],
    },
  };
  const day = new Date(financialToday());
  if (f.status)
    where.AND =
      f.status === "CANCELLED"
        ? { status: "CANCELLED" }
        : f.status === "PAID"
          ? { status: "SETTLED" }
          : f.status === "OVERDUE"
            ? { status: "OPEN", dueDate: { lt: day } }
            : {
                status: "OPEN",
                dueDate: { gte: day },
                settledAmount: f.status === "PARTIAL" ? { gt: 0 } : 0,
              };
  const total = await db.financialEntry.count({ where });
  if (!paginated && total > 10000)
    throw new HttpError(
      400,
      "Restrinja os filtros a até 10.000 contas para relatório/exportação.",
    );
  const items = (
    await db.financialEntry.findMany({
      where,
      include,
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      ...(paginated ? { take: 25, skip: (f.page - 1) * 25 } : {}),
    })
  ).map((e) => ({ ...e, ...entryAmounts(e) }));
  return { items, f, total, where };
}

export async function payableIndicators(db: Database, a: AuthContext) {
  const today = financialToday(),
    seven = new Date(new Date(today).getTime() + 7 * 86400000)
      .toISOString()
      .slice(0, 10),
    month = today.slice(0, 7) + "-01";
  const sum = async (dueDate?: Prisma.DateTimeFilter) => {
    const r = await db.financialEntry.aggregate({
      where: { ...payableScope(a), status: "OPEN", dueDate },
      _sum: {
        amount: true,
        interest: true,
        penalty: true,
        discount: true,
        settledAmount: true,
      },
    });
    return new Prisma.Decimal(r._sum.amount ?? 0)
      .plus(r._sum.interest ?? 0)
      .plus(r._sum.penalty ?? 0)
      .minus(r._sum.discount ?? 0)
      .minus(r._sum.settledAmount ?? 0)
      .toFixed(2);
  };
  const [open, overdue, dueToday, next7] = await Promise.all([
    sum(),
    sum({ lt: new Date(today) }),
    sum({ equals: new Date(today) }),
    sum({ gt: new Date(today), lte: new Date(seven) }),
  ]);
  const paid = await db.financialSettlement.aggregate({
    where: {
      companyId: a.companyId,
      entry: payableScope(a),
      paidAt: { gte: new Date(month), lte: new Date(today) },
    },
    _sum: { amount: true },
  });
  return {
    open,
    overdue,
    today: dueToday,
    next7,
    paidMonth: String(paid._sum.amount ?? 0),
  };
}
export async function payableRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/payables/options", async (req) => {
    const a = requirePermission(req, "payables:read");
    const [branches, suppliers, categories, receipts] = await Promise.all([
      db.branch.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { id: a.branchId } : {}),
        },
        orderBy: { name: "asc" },
      }),
      db.supplier.findMany({
        where: { companyId: a.companyId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.financialCategory.findMany({
        where: { companyId: a.companyId, active: true },
        orderBy: { name: "asc" },
      }),
      db.purchaseReceipt.findMany({
        where: {
          companyId: a.companyId,
          total: { gt: 0 },
          order: a.branchId ? { branchId: a.branchId } : undefined,
        },
        include: {
          order: {
            select: {
              id: true,
              number: true,
              branchId: true,
              supplierId: true,
            },
          },
          financialObligations: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      company: { id: a.companyId, name: a.companyName },
      branches,
      suppliers,
      categories,
      receipts,
    };
  });
  app.post("/api/payables/categories", async (req, reply) => {
    const a = requirePermission(req, "payables:edit"),
      v = z
        .object({ name: z.string().trim().min(2).max(80) })
        .strict()
        .parse(req.body);
    const c = await db.$transaction(async (tx) => {
      const row = await tx.financialCategory.create({
        data: { companyId: a.companyId, name: v.name },
      });
      await tx.auditLog.create({
        data: {
          companyId: a.companyId,
          actorId: a.membershipId,
          module: "payables",
          action: "PAYABLE_CATEGORY_CREATED",
          recordId: row.id,
          metadata: { name: v.name },
        },
      });
      return row;
    });
    return reply.code(201).send(c);
  });
  app.get("/api/payables/indicators", async (req) =>
    payableIndicators(db, requirePermission(req, "payables:read")),
  );
  app.get("/api/payables", async (req) => {
    const { items, f, total } = await rows(
      db,
      requirePermission(req, "payables:read"),
      req.query,
      true,
    );
    return {
      items,
      total,
      page: f.page,
    };
  });
  app.get("/api/payables/reports", async (req) => {
    const a = requirePermission(req, "payables:read"),
      { items, f, where } = await rows(db, a, req.query);
    const group = (key: "supplier" | "category" | "branch") => {
      const groups = new Map<
        string,
        { name: string; original: bigint; paid: bigint; balance: bigint }
      >();
      for (const e of items) {
        if (e.status === "CANCELLED") continue;
        const ref = e.obligation![key],
          id = ref?.id ?? "none",
          g = groups.get(id) ?? {
            name: ref?.name ?? "Sem fornecedor",
            original: 0n,
            paid: 0n,
            balance: 0n,
          };
        g.original += cents(String(e.amount));
        g.paid += cents(e.paid);
        g.balance += cents(e.balance);
        groups.set(id, g);
      }
      return [...groups.entries()].map(([id, g]) => ({
        id,
        name: g.name,
        original: reais(g.original),
        paid: reais(g.paid),
        balance: reais(g.balance),
      }));
    };
    const payments = await db.financialSettlement.findMany({
      where: {
        companyId: a.companyId,
        entry: { ...where, dueDate: undefined },
        paidAt: {
          gte: f.from ? new Date(f.from) : undefined,
          lte: f.to ? new Date(f.to) : undefined,
        },
      },
      include: { entry: { select: { description: true, obligationId: true } } },
      orderBy: { paidAt: "desc" },
      take: 10001,
    });
    if (payments.length > 10000)
      throw new HttpError(400, "Restrinja o período a até 10.000 pagamentos.");
    return {
      suppliers: group("supplier"),
      categories: group("category"),
      branches: group("branch"),
      payments,
      purchases: items
        .filter((e) => e.obligation!.origin === "PURCHASE")
        .map((e) => ({
          entryId: e.id,
          purchaseOrderId: e.obligation!.purchaseOrderId,
          purchaseReceiptId: e.obligation!.purchaseReceiptId,
          amount: String(e.amount),
          balance: e.balance,
        })),
      overdue: items.filter((e) => e.situation === "OVERDUE"),
      due: items.map((e) => ({
        id: e.id,
        dueDate: e.dueDate,
        description: e.description,
        balance: e.balance,
      })),
    };
  });
  app.get("/api/payables/export", async (req, reply) => {
    const { items } = await rows(
      db,
      requirePermission(req, "payables:read"),
      req.query,
    );
    const cell = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const lines = [
      [
        "Vencimento",
        "Descrição",
        "Fornecedor",
        "Filial",
        "Categoria",
        "Original",
        "Juros",
        "Multa",
        "Desconto",
        "Pago",
        "Saldo",
        "Situação",
        "Origem",
        "Documento",
        "Parcela",
        "Compra",
        "Recebimento",
      ],
      ...items.map((e) => [
        e.dueDate.toISOString().slice(0, 10),
        e.description,
        e.obligation!.supplier?.name,
        e.obligation!.branch.name,
        e.obligation!.category.name,
        String(e.amount),
        String(e.interest),
        String(e.penalty),
        String(e.discount),
        e.paid,
        e.balance,
        e.situation,
        e.obligation!.origin,
        e.obligation!.documentNumber,
        e.installment,
        e.obligation!.purchaseOrder?.number,
        e.obligation!.purchaseReceiptId,
      ]),
    ];
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="contas-a-pagar.csv"',
      )
      .send(
        "\ufeff" + lines.map((row) => row.map(cell).join(";")).join("\r\n"),
      );
  });
  app.get("/api/payables/:id", async (req) => {
    const a = requirePermission(req, "payables:read"),
      id = idFrom(req.params);
    const e = await db.financialEntry.findFirst({
      where: { ...payableScope(a), id },
      include: {
        ...include,
        settlements: {
          include: { actor: { select: { user: { select: { name: true } } } } },
          orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!e) throw new HttpError(404, "Conta indisponível.");
    const [installments, history] = await Promise.all([
      db.financialEntry.findMany({
        where: { companyId: a.companyId, obligationId: e.obligationId },
        orderBy: { installment: "asc" },
      }),
      db.auditLog.findMany({
        where: {
          companyId: a.companyId,
          module: "payables",
          OR: [
            { recordId: e.obligationId! },
            {
              recordId: {
                in: (
                  await db.financialEntry.findMany({
                    where: {
                      companyId: a.companyId,
                      obligationId: e.obligationId,
                    },
                    select: { id: true },
                  })
                ).map((r) => r.id),
              },
            },
          ],
        },
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { user: { select: { name: true } } } } },
      }),
    ]);
    return {
      ...e,
      ...entryAmounts(e),
      installments: installments.map((i) => ({ ...i, ...entryAmounts(i) })),
      history,
    };
  });
  app.post("/api/payables", async (req, reply) =>
    reply
      .code(201)
      .send(
        await payableCommand(
          db,
          requirePermission(req, "payables:create"),
          "CREATE",
          null,
          req.body,
        ),
      ),
  );
  for (const [path, kind, permission] of [
    ["payments", "PAY", "payables:pay"],
    ["edit", "EDIT", "payables:edit"],
    ["cancel", "CANCEL", "payables:cancel"],
  ] as const)
    app.post(`/api/payables/:id/${path}`, async (req) =>
      payableCommand(
        db,
        requirePermission(req, permission),
        kind,
        idFrom(req.params),
        req.body,
      ),
    );
}
