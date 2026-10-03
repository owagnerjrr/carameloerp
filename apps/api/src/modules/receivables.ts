import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { z } from "zod";
import { cents, reais, financeFiltersSchema } from "@caramelo/contracts";
import {
  requirePermission,
  HttpError,
  type AuthContext,
  type Transaction,
} from "../context.js";
import {
  receivableScope,
  receivableAmounts,
  receivableCommand,
} from "../services/receivables.js";
import { financialToday, entryAmounts } from "../services/payables.js";
const related = {
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  payment: true,
  sale: { select: { id: true, number: true, createdAt: true } },
  obligation: {
    include: { supplier: { select: { id: true, name: true } }, category: true },
  },
} as const;
async function entries(
  db: Database | Transaction,
  a: AuthContext,
  raw: unknown,
  receivablesOnly = false,
) {
  const f = financeFiltersSchema.parse(raw);
  if (a.branchId && f.branchId && a.branchId !== f.branchId)
    throw new HttpError(404, "Filial indisponível.");
  const where: Prisma.FinancialEntryWhereInput = {
    companyId: a.companyId,
    branchId: a.branchId ?? f.branchId,
    ...(receivablesOnly
      ? { type: "RECEIVABLE" }
      : {
          OR: [
            { type: "RECEIVABLE" },
            { type: "PAYABLE", obligationId: { not: null } },
          ],
        }),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.supplierId ? { obligation: { supplierId: f.supplierId } } : {}),
    ...(f.q ? { description: { contains: f.q, mode: "insensitive" } } : {}),
  };
  const rows = await db.financialEntry.findMany({
    where,
    include: related,
    take: 10001,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  if (rows.length > 10000)
    throw new HttpError(400, "Restrinja os filtros a até 10.000 registros.");
  const items = rows
    .map((e) => ({
      ...e,
      ...(e.type === "RECEIVABLE"
        ? receivableAmounts(e)
        : {
            ...entryAmounts(e),
            balance:
              e.status === "CANCELLED" ? "0.00" : entryAmounts(e).balance,
            expectedDate: e.dueDate,
            origin: e.obligation?.origin ?? "OTHER",
          }),
    }))
    .filter(
      (e) =>
        (!f.origin || e.origin === f.origin) &&
        (!f.status || e.situation === f.status),
    );
  return { f, items };
}
export async function receivableRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/receivables/options", async (req) => {
    const a = requirePermission(
      req,
      req.auth?.permissions.includes("receivables:read")
        ? "receivables:read"
        : "finance:read",
    );
    const [branches, customers, suppliers] = await Promise.all([
      db.branch.findMany({
        where: {
          companyId: a.companyId,
          ...(a.branchId ? { id: a.branchId } : {}),
        },
        select: { id: true, name: true },
      }),
      db.customer.findMany({
        where: { companyId: a.companyId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      a.permissions.includes("finance:read")
        ? db.supplier.findMany({
            where: { companyId: a.companyId },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);
    return {
      company: { id: a.companyId, name: a.companyName },
      branches,
      customers,
      suppliers,
    };
  });
  app.get("/api/receivables", async (req) => {
    const { f, items } = await entries(
      db,
      requirePermission(req, "receivables:read"),
      req.query,
      true,
    );
    const filtered = items.filter(
      (e) =>
        (!f.method || e.payment?.method === f.method) &&
        (!f.from || e.dueDate.toISOString().slice(0, 10) >= f.from) &&
        (!f.to || e.dueDate.toISOString().slice(0, 10) <= f.to),
    );
    return {
      items: filtered.slice((f.page - 1) * 25, f.page * 25),
      total: filtered.length,
      page: f.page,
    };
  });
  app.get("/api/receivables/:id", async (req) => {
    const a = requirePermission(req, "receivables:read"),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    const e = await db.financialEntry.findFirst({
      where: { ...receivableScope(a), id },
      include: {
        ...related,
        settlements: {
          include: { actor: { select: { user: { select: { name: true } } } } },
          orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!e) throw new HttpError(404, "Recebível indisponível.");
    const history = await db.auditLog.findMany({
      where: { companyId: a.companyId, module: "receivables", recordId: id },
      orderBy: { createdAt: "asc" },
    });
    const installments = e.paymentId
      ? await db.financialEntry.findMany({
          where: { ...receivableScope(a), paymentId: e.paymentId },
          orderBy: { installment: "asc" },
        })
      : [];
    return {
      ...e,
      ...receivableAmounts(e),
      history,
      installments: installments.map((v) => ({
        ...v,
        ...receivableAmounts(v),
      })),
    };
  });
  for (const [path, kind, permission] of [
    ["receipts", "RECEIVE", "receivables:receive"],
    ["forecast", "FORECAST", "receivables:edit"],
  ] as const)
    app.post(`/api/receivables/:id/${path}`, async (req) =>
      receivableCommand(
        db,
        requirePermission(req, permission),
        kind,
        z.object({ id: z.uuid() }).parse(req.params).id,
        req.body,
      ),
    );
  app.get("/api/finance", async (req) => {
    const auth = requirePermission(req, "finance:read");
    return db.$transaction(
      async (tx) => {
        const a = auth,
          { f, items } = await entries(tx, a, req.query);
        const today = financialToday(),
          from = f.from ?? today,
          to =
            f.to ??
            new Date(new Date(today).getTime() + 30 * 86400000)
              .toISOString()
              .slice(0, 10);
        if (
          (new Date(to).getTime() - new Date(from).getTime()) / 86400000 >
          366
        )
          throw new HttpError(400, "Selecione até 366 dias.");
        const settlements = await tx.financialSettlement.findMany({
          where: {
            companyId: a.companyId,
            entryId: { in: items.map((e) => e.id) },
            paidAt: { gte: new Date(from), lte: new Date(to) },
            method: f.method,
          },
          take: 10001,
          orderBy: [{ paidAt: "asc" }, { id: "asc" }],
        });
        if (settlements.length > 10000)
          throw new HttpError(400, "Restrinja o período de liquidações.");
        const daily = new Map<
          string,
          {
            received: bigint;
            paid: bigint;
            reversed: bigint;
            forecastIn: bigint;
            forecastOut: bigint;
          }
        >();
        for (
          let day = new Date(from);
          day <= new Date(to);
          day.setUTCDate(day.getUTCDate() + 1)
        )
          daily.set(day.toISOString().slice(0, 10), {
            received: 0n,
            paid: 0n,
            reversed: 0n,
            forecastIn: 0n,
            forecastOut: 0n,
          });
        for (const s of settlements) {
          const d = daily.get(s.paidAt.toISOString().slice(0, 10))!;
          d[
            s.kind === "RECEIPT"
              ? "received"
              : s.kind === "REVERSAL"
                ? "reversed"
                : "paid"
          ] += cents(String(s.amount));
        }
        let receivable = 0n,
          payable = 0n,
          overdueIn = 0n,
          overdueOut = 0n;
        for (const e of items) {
          if (
            e.status !== "OPEN" ||
            (f.method && e.payment?.method !== f.method)
          )
            continue;
          const balance = cents(e.balance),
            day = e.expectedDate.toISOString().slice(0, 10),
            d = daily.get(day);
          if (e.type === "RECEIVABLE") {
            receivable += balance;
            if (e.dueDate.toISOString().slice(0, 10) < today)
              overdueIn += balance;
            if (d) d.forecastIn += balance;
          } else {
            payable += balance;
            if (e.dueDate.toISOString().slice(0, 10) < today)
              overdueOut += balance;
            if (d) d.forecastOut += balance;
          }
        }
        const days = [...daily].map(([date, d]) => ({
          date,
          ...Object.fromEntries(
            Object.entries(d).map(([k, v]) => [k, reais(v)]),
          ),
          realized: reais(d.received - d.paid - d.reversed),
          forecast: reais(d.forecastIn - d.forecastOut),
        }));
        const sum = (
          key: "received" | "paid" | "reversed" | "forecastIn" | "forecastOut",
        ) => [...daily.values()].reduce((n, d) => n + d[key], 0n);
        return {
          from,
          to,
          company: a.companyName,
          receivable: reais(receivable),
          payable: reais(payable),
          overdueIn: reais(overdueIn),
          overdueOut: reais(overdueOut),
          received: reais(sum("received")),
          paid: reais(sum("paid")),
          reversed: reais(sum("reversed")),
          realized: reais(sum("received") - sum("paid") - sum("reversed")),
          forecastIn: reais(sum("forecastIn")),
          forecastOut: reais(sum("forecastOut")),
          forecast: reais(sum("forecastIn") - sum("forecastOut")),
          days,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  });
}
