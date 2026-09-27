import { createHash } from "node:crypto";
import { type Database, type Prisma } from "@caramelo/database";
import {
  cents,
  reais,
  type cashOpenSchema,
  type cashMoveSchema,
  type cashCloseSchema,
} from "@caramelo/contracts";
import type { z } from "zod";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock } from "./stock.js";
export const hashInput = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
export const cashInclude = {
  cashRegister: true,
  branch: true,
  openedBy: { select: { user: { select: { name: true } } } },
  closedBy: { select: { user: { select: { name: true } } } },
  movements: {
    orderBy: { createdAt: "asc" as const },
    include: {
      actor: { select: { user: { select: { name: true } } } },
      sale: { select: { number: true } },
    },
  },
} satisfies Prisma.CashSessionInclude;
export async function sessionAccess(
  tx: Transaction,
  a: AuthContext,
  id: string,
  operate = false,
) {
  const s = await tx.cashSession.findFirst({
    where: {
      id,
      companyId: a.companyId,
      ...(a.branchId ? { branchId: a.branchId } : {}),
    },
  });
  if (!s) throw new HttpError(404, "Sessão de caixa indisponível.");
  if (
    operate &&
    s.openedById !== a.membershipId &&
    !a.permissions.includes("cash:manage")
  )
    throw new HttpError(403, "Este caixa pertence a outro operador.");
  return s;
}
export async function openSessionFor(
  tx: Transaction,
  a: AuthContext,
  branchId: string,
  id?: string,
) {
  const matches = id
    ? [await sessionAccess(tx, a, id, true)]
    : await tx.cashSession.findMany({
        where: {
          companyId: a.companyId,
          branchId,
          openedById: a.membershipId,
          status: "OPEN",
        },
        take: 2,
      });
  if (matches.length !== 1)
    throw new HttpError(
      409,
      "Selecione um caixa aberto do operador para esta filial.",
    );
  const s = matches[0]!;
  await lock(tx, a.companyId + ":cash-session:" + s.id);
  const fresh = await sessionAccess(tx, a, s.id, true);
  if (fresh.status !== "OPEN" || fresh.branchId !== branchId)
    throw new HttpError(
      409,
      "Caixa fechado ou de outra filial. Abra um caixa antes de operar.",
    );
  return fresh;
}
export async function cashSummary(tx: Transaction, a: AuthContext, id: string) {
  const session = await sessionAccess(tx, a, id);
  const movements = await tx.cashMovement.findMany({
    where: { companyId: a.companyId, cashSessionId: id },
  });
  const sums = {
    CASH: 0n,
    PIX: 0n,
    DEBIT_CARD: 0n,
    CREDIT_CARD: 0n,
    OTHER: 0n,
    STORE_CREDIT: 0n,
  };
  let supplies = 0n,
    withdrawals = 0n,
    reversals = 0n;
  for (const m of movements) {
    const n = BigInt(m.amount.mul(100).toFixed(0));
    if (m.kind === "SUPPLY") supplies += n;
    else if (m.kind === "WITHDRAWAL") withdrawals -= n;
    else if (m.kind === "RECEIPT" || m.kind === "REVERSAL") {
      const k =
        m.method && m.method in sums
          ? (m.method as keyof typeof sums)
          : "OTHER";
      sums[k] += n;
      if (m.kind === "REVERSAL") reversals -= n;
    }
  }
  const issued = await tx.customerCredit.aggregate({
    where: { companyId: a.companyId, returnOperation: { cashSessionId: id } },
    _sum: { amount: true },
  });
  const sold =
      Object.values(sums).reduce((n, x) => n + x, 0n) -
      cents(String(issued._sum.amount ?? 0)),
    expected =
      cents(String(session.openingAmount)) + sums.CASH + supplies - withdrawals;
  return {
    creditIssued: String(issued._sum.amount ?? 0),
    opening: session.openingAmount.toFixed(2),
    sales: Object.fromEntries(
      Object.entries(sums).map(([k, v]) => [k, reais(v)]),
    ),
    supplies: reais(supplies),
    withdrawals: reais(withdrawals),
    reversals: reais(reversals),
    totalSold: reais(sold),
    expected: reais(expected),
  };
}
async function auditCash(
  tx: Transaction,
  a: AuthContext,
  id: string,
  action: string,
  branchId: string,
  metadata: Prisma.InputJsonObject = {},
) {
  await tx.auditLog.create({
    data: {
      companyId: a.companyId,
      actorId: a.membershipId,
      module: "cash",
      action,
      recordId: id,
      metadata: { branchId, cashSessionId: id, ...metadata },
    },
  });
}
export async function openCash(
  db: Database,
  a: AuthContext,
  input: z.infer<typeof cashOpenSchema>,
) {
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":cash-request:" + input.requestKey);
      const old = await tx.cashSession.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
      });
      if (old) {
        await sessionAccess(tx, a, old.id, true);
        if (old.requestHash !== hashInput(input))
          throw new HttpError(409, "Chave de abertura já utilizada.");
        return old;
      }
      const terminal = await tx.cashRegister.findFirst({
        where: {
          id: input.cashRegisterId,
          companyId: a.companyId,
          ...(a.branchId ? { branchId: a.branchId } : {}),
        },
      });
      if (!terminal?.branchId)
        throw new HttpError(404, "Terminal/filial indisponível.");
      await lock(tx, a.companyId + ":cash-terminal:" + terminal.id);
      if (
        await tx.cashSession.findFirst({
          where: {
            companyId: a.companyId,
            cashRegisterId: terminal.id,
            status: "OPEN",
          },
        })
      )
        throw new HttpError(409, "Este terminal já possui caixa aberto.");
      const s = await tx.cashSession.create({
        data: {
          companyId: a.companyId,
          branchId: terminal.branchId,
          cashRegisterId: terminal.id,
          openedById: a.membershipId,
          openingAmount: input.openingAmount,
          openingNotes: input.notes,
          requestKey: input.requestKey,
          requestHash: hashInput(input),
        },
      });
      await tx.cashMovement.create({
        data: {
          companyId: a.companyId,
          cashSessionId: s.id,
          cashRegisterId: terminal.id,
          actorId: a.membershipId,
          method: "CASH",
          kind: "OPENING",
          amount: input.openingAmount,
          description: "Fundo inicial",
        },
      });
      await auditCash(tx, a, s.id, "CASH_OPENED", s.branchId, {
        opening: input.openingAmount,
        openingNotes: input.notes ?? null,
      });
      return s;
    },
    { timeout: 20000 },
  );
}
export async function moveCash(
  db: Database,
  a: AuthContext,
  id: string,
  input: z.infer<typeof cashMoveSchema>,
) {
  return db.$transaction(
    async (tx) => {
      const visible = await sessionAccess(tx, a, id, true);
      await lock(tx, a.companyId + ":cash-request:" + input.requestKey);
      const old = await tx.cashMovement.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
      });
      if (old) {
        if (old.cashSessionId !== id || old.requestHash !== hashInput(input))
          throw new HttpError(409, "Chave de movimento já utilizada.");
        return old;
      }
      const s = await openSessionFor(tx, a, visible.branchId, id);
      const value = cents(input.amount);
      if (value <= 0n) throw new HttpError(400, "Informe um valor positivo.");
      const summary = await cashSummary(tx, a, id);
      if (input.kind === "WITHDRAWAL" && value > cents(summary.expected))
        throw new HttpError(
          409,
          "Sangria excede o dinheiro esperado na gaveta.",
        );
      const m = await tx.cashMovement.create({
        data: {
          companyId: a.companyId,
          cashSessionId: id,
          cashRegisterId: s.cashRegisterId,
          actorId: a.membershipId,
          method: "CASH",
          kind: input.kind,
          amount: reais(input.kind === "WITHDRAWAL" ? -value : value),
          description: input.reason,
          requestKey: input.requestKey,
          requestHash: hashInput(input),
        },
      });
      await auditCash(tx, a, id, "CASH_" + input.kind, s.branchId, {
        amount: input.amount,
        reason: input.reason,
      });
      return m;
    },
    { timeout: 20000 },
  );
}
export async function closeCash(
  db: Database,
  a: AuthContext,
  id: string,
  input: z.infer<typeof cashCloseSchema>,
) {
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":cash-session:" + id);
      const s = await sessionAccess(tx, a, id, true);
      if (s.status === "CLOSED") {
        if (
          s.closeRequestKey === input.requestKey &&
          s.closeRequestHash === hashInput(input)
        )
          return s;
        throw new HttpError(409, "Caixa já fechado.");
      }
      const summary = await cashSummary(tx, a, id);
      if (cents(summary.expected) !== cents(input.expectedAmount))
        throw new HttpError(
          409,
          "O caixa mudou. Atualize o resumo e confira novamente.",
        );
      const difference = cents(input.countedAmount) - cents(summary.expected);
      if (difference !== 0n && input.notes.trim().length < 8)
        throw new HttpError(
          400,
          "Informe uma observação para a diferença de conferência.",
        );
      const closed = await tx.cashSession.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: a.membershipId,
          expectedAmount: summary.expected,
          countedAmount: input.countedAmount,
          difference: reais(difference),
          closingSummary: summary,
          closingNotes: input.notes,
          closeRequestKey: input.requestKey,
          closeRequestHash: hashInput(input),
        },
      });
      await auditCash(tx, a, id, "CASH_CLOSED", s.branchId, {
        ...summary,
        counted: input.countedAmount,
        difference: reais(difference),
        notes: input.notes,
      });
      return closed;
    },
    { timeout: 20000 },
  );
}
