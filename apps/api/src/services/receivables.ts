import { createHash } from "node:crypto";
import { Prisma, type Database, type FinancialEntry } from "@caramelo/database";
import {
  cents,
  reais,
  receivableReceiveSchema,
  receivableEditSchema,
} from "@caramelo/contracts";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock } from "./stock.js";
import { financialToday, entryAmounts } from "./payables.js";
export const receivableScope = (
  a: AuthContext,
): Prisma.FinancialEntryWhereInput => ({
  companyId: a.companyId,
  type: "RECEIVABLE",
  ...(a.branchId ? { branchId: a.branchId } : {}),
});
export function receivableAmounts(e: FinancialEntry) {
  const v = entryAmounts(e);
  return {
    ...v,
    balance: e.status === "CANCELLED" ? "0.00" : v.balance,
    origin: e.saleId ? "SALE" : "LEGACY",
    expectedDate: e.expectedDate ?? e.dueDate,
  };
}
export async function receivableAudit(
  tx: Transaction,
  a: AuthContext,
  action: string,
  e: Pick<FinancialEntry, "id" | "branchId" | "saleId" | "paymentId">,
  metadata: Prisma.InputJsonObject = {},
) {
  await tx.auditLog.create({
    data: {
      companyId: a.companyId,
      actorId: a.membershipId,
      module: "receivables",
      action,
      recordId: e.id,
      metadata: {
        branchId: e.branchId,
        saleId: e.saleId,
        paymentId: e.paymentId,
        ...metadata,
      },
    },
  });
}
export async function reverseReceivables(
  tx: Transaction,
  a: AuthContext,
  saleId: string,
  now: Date,
) {
  const entries = await tx.financialEntry.findMany({
    where: { companyId: a.companyId, saleId, type: "RECEIVABLE" },
    orderBy: { id: "asc" },
    include: { settlements: true },
  });
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  for (const e of entries) {
    await tx.$queryRaw`SELECT id FROM "FinancialEntry" WHERE id=${e.id}::uuid AND "companyId"=${a.companyId}::uuid FOR UPDATE`;
    for (const s of e.settlements.filter((s) => s.kind === "RECEIPT")) {
      await tx.financialSettlement.create({
        data: {
          companyId: a.companyId,
          entryId: e.id,
          actorId: a.membershipId,
          amount: s.amount,
          paidAt: new Date(day),
          method: s.method,
          kind: "REVERSAL",
          originalSettlementId: s.id,
          sourceKey: `cancel:${s.id}`,
          notes:
            "Reversão administrativa por cancelamento da venda; sem integração bancária.",
        },
      });
      await receivableAudit(tx, a, "RECEIVABLE_REVERSED", e, {
        originalSettlementId: s.id,
        amount: String(s.amount),
      });
    }
    await tx.financialEntry.update({
      where: { id: e.id },
      data: { status: "CANCELLED", settledAt: null },
    });
    await receivableAudit(tx, a, "RECEIVABLE_CANCELLED", e, {
      received: String(e.settledAmount),
    });
  }
}
export async function receivableCommand(
  db: Database,
  a: AuthContext,
  kind: "RECEIVE" | "FORECAST",
  id: string,
  raw: unknown,
) {
  const input =
    kind === "RECEIVE"
      ? receivableReceiveSchema.parse(raw)
      : receivableEditSchema.parse(raw);
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, id, input }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":receivable-request:" + input.requestKey);
      const accessible = await tx.financialEntry.findFirst({
        where: { ...receivableScope(a), id },
      });
      if (!accessible) throw new HttpError(404, "Recebível indisponível.");
      const previous = await tx.financialAction.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
      });
      if (previous) {
        if (previous.entryId !== id || previous.requestHash !== hash)
          throw new HttpError(409, "Chave já utilizada com outro conteúdo.");
        return previous.result;
      }
      if (!accessible.saleId || !accessible.paymentId)
        throw new HttpError(
          409,
          "Registro legado sem origem operacional; regularização exige análise específica.",
        );
      await lock(tx, a.companyId + ":sale:" + accessible.saleId);
      await tx.$queryRaw`SELECT id FROM "FinancialEntry" WHERE id=${id}::uuid AND "companyId"=${a.companyId}::uuid FOR UPDATE`;
      const e = await tx.financialEntry.findFirstOrThrow({
        where: { ...receivableScope(a), id },
        include: { sale: true, payment: true },
      });
      if (e.status !== "OPEN" || e.sale?.status !== "COMPLETED")
        throw new HttpError(409, "Recebível não está aberto.");
      let result: Prisma.InputJsonObject;
      if (kind === "RECEIVE") {
        const v = receivableReceiveSchema.parse(input),
          amount = cents(v.amount),
          balance = cents(String(e.amount)) - cents(String(e.settledAmount));
        const saleDay = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(e.sale.createdAt);
        if (amount <= 0n || amount > balance)
          throw new HttpError(
            400,
            "Recebimento deve ser positivo e não pode ultrapassar o saldo.",
          );
        if (v.receivedAt < saleDay || v.receivedAt > financialToday())
          throw new HttpError(400, "Data deve estar entre a venda e hoje.");
        const settlement = await tx.financialSettlement.create({
          data: {
            companyId: a.companyId,
            entryId: id,
            actorId: a.membershipId,
            kind: "RECEIPT",
            amount: reais(amount),
            paidAt: new Date(v.receivedAt),
            method: e.payment!.method,
            reference: v.reference,
            notes: v.notes,
          },
        });
        const paid = cents(String(e.settledAmount)) + amount;
        const last = await tx.financialSettlement.aggregate({
          where: { companyId: a.companyId, entryId: id, kind: "RECEIPT" },
          _max: { paidAt: true },
        });
        await tx.financialEntry.update({
          where: { id },
          data: {
            settledAmount: reais(paid),
            status: amount === balance ? "SETTLED" : "OPEN",
            settledAt: amount === balance ? last._max.paidAt : null,
          },
        });
        result = {
          entryId: id,
          settlementId: settlement.id,
          received: reais(paid),
          balance: reais(balance - amount),
        };
        await receivableAudit(
          tx,
          a,
          amount === balance
            ? "RECEIVABLE_RECEIVED"
            : "RECEIVABLE_PARTIALLY_RECEIVED",
          e,
          {
            ...result,
            amount: reais(amount),
            receivedAt: v.receivedAt,
            reference: v.reference,
          },
        );
      } else {
        const v = receivableEditSchema.parse(input);
        if (cents(String(e.settledAmount)) > 0n)
          throw new HttpError(
            409,
            "Previsão bloqueada após recebimento parcial.",
          );
        await tx.financialEntry.update({
          where: { id },
          data: {
            expectedDate: new Date(v.expectedDate),
            notes: v.notes,
            externalReference: v.reference,
          },
        });
        result = { entryId: id, expectedDate: v.expectedDate };
        await receivableAudit(tx, a, "RECEIVABLE_UPDATED", e, {
          ...result,
          previousDate: (e.expectedDate ?? e.dueDate)
            .toISOString()
            .slice(0, 10),
          reason: v.reason,
        });
      }
      await tx.financialAction.create({
        data: {
          companyId: a.companyId,
          entryId: id,
          actorId: a.membershipId,
          kind,
          requestKey: input.requestKey,
          requestHash: hash,
          result,
        },
      });
      return result;
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
