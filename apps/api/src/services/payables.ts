import { createHash } from "node:crypto";
import { Prisma, type Database, type FinancialEntry } from "@caramelo/database";
import {
  cents,
  reais,
  payableCreateSchema,
  payablePaySchema,
  payableEditSchema,
  payableCancelSchema,
} from "@caramelo/contracts";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock } from "./stock.js";
export function financialToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function entryAmounts(
  e: Pick<
    FinancialEntry,
    | "amount"
    | "interest"
    | "penalty"
    | "discount"
    | "settledAmount"
    | "status"
    | "dueDate"
  >,
) {
  const total =
    cents(String(e.amount)) +
    cents(String(e.interest)) +
    cents(String(e.penalty)) -
    cents(String(e.discount));
  const paid = cents(String(e.settledAmount)),
    balance = total - paid;
  return {
    total: reais(total),
    paid: reais(paid),
    balance: reais(balance),
    situation:
      e.status === "CANCELLED"
        ? "CANCELLED"
        : balance === 0n
          ? "PAID"
          : e.dueDate.toISOString().slice(0, 10) < financialToday()
            ? "OVERDUE"
            : paid > 0n
              ? "PARTIAL"
              : "PENDING",
  };
}
export const payableScope = (
  a: AuthContext,
): Prisma.FinancialEntryWhereInput => ({
  companyId: a.companyId,
  type: "PAYABLE",
  obligationId: { not: null },
  ...(a.branchId ? { branchId: a.branchId } : {}),
});
async function access(tx: Transaction, a: AuthContext, id: string) {
  const e = await tx.financialEntry.findFirst({
    where: { ...payableScope(a), id },
    include: { obligation: true },
  });
  if (!e || !e.obligation) throw new HttpError(404, "Conta indisponível.");
  return e;
}
const validateBound = (v: bigint) => {
  if (v < 0n || v > 99999999999999n)
    throw new HttpError(400, "Valor financeiro fora do limite.");
  return v;
};
async function log(
  tx: Transaction,
  a: AuthContext,
  action: string,
  id: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      companyId: a.companyId,
      actorId: a.membershipId,
      module: "payables",
      action,
      recordId: id,
      metadata,
    },
  });
}
export async function payableCommand(
  db: Database,
  a: AuthContext,
  kind: "CREATE" | "PAY" | "EDIT" | "CANCEL",
  id: string | null,
  raw: unknown,
) {
  const input =
    kind === "CREATE"
      ? payableCreateSchema.parse(raw)
      : kind === "PAY"
        ? payablePaySchema.parse(raw)
        : kind === "EDIT"
          ? payableEditSchema.parse(raw)
          : payableCancelSchema.parse(raw);
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, id, input }))
    .digest("hex");
  return db.$transaction(async (tx) => {
    await lock(tx, a.companyId + ":payable-request:" + input.requestKey);
    const previous = await tx.financialAction.findUnique({
      where: {
        companyId_requestKey: {
          companyId: a.companyId,
          requestKey: input.requestKey,
        },
      },
      include: { obligation: true },
    });
    if (previous) {
      if (a.branchId && previous.obligation.branchId !== a.branchId)
        throw new HttpError(404, "Conta indisponível.");
      if (previous.requestHash !== hash)
        throw new HttpError(409, "Chave já utilizada com outro conteúdo.");
      return previous.result;
    }
    let obligationId: string, result: Prisma.InputJsonObject;
    if (kind === "CREATE") {
      const v = payableCreateSchema.parse(input);
      const amount = cents(v.amount);
      if (a.branchId && a.branchId !== v.branchId)
        throw new HttpError(404, "Filial indisponível.");
      if (
        !(await tx.branch.findFirst({
          where: { id: v.branchId, companyId: a.companyId },
        }))
      )
        throw new HttpError(404, "Filial indisponível.");
      if (
        !(await tx.financialCategory.findFirst({
          where: { id: v.categoryId, companyId: a.companyId, active: true },
        }))
      )
        throw new HttpError(400, "Categoria indisponível.");
      if (
        v.supplierId &&
        !(await tx.supplier.findFirst({
          where: { id: v.supplierId, companyId: a.companyId, active: true },
        }))
      )
        throw new HttpError(400, "Fornecedor indisponível.");
      let purchaseOrderId: string | null = null;
      if (v.purchaseReceiptId) {
        await lock(tx, a.companyId + ":payable-receipt:" + v.purchaseReceiptId);
        const receipt = await tx.purchaseReceipt.findFirst({
          where: {
            id: v.purchaseReceiptId,
            companyId: a.companyId,
            order: { branchId: v.branchId },
          },
          include: { order: true },
        });
        if (!receipt) throw new HttpError(404, "Recebimento indisponível.");
        if (
          receipt.order.supplierId !== v.supplierId ||
          cents(String(receipt.total)) !== amount
        )
          throw new HttpError(
            400,
            "Fornecedor/valor deve corresponder ao recebimento.",
          );
        if (
          await tx.financialObligation.findUnique({
            where: {
              companyId_purchaseReceiptId: {
                companyId: a.companyId,
                purchaseReceiptId: v.purchaseReceiptId,
              },
            },
          })
        )
          throw new HttpError(
            409,
            "Este recebimento já possui confirmação financeira.",
          );
        purchaseOrderId = receipt.orderId;
      }
      validateBound(amount);
      if (amount < BigInt(v.dueDates.length))
        throw new HttpError(400, "Cada parcela deve ser positiva.");
      if (
        v.dueDates.some(
          (d, i) => d < v.issuedAt || (i > 0 && d <= v.dueDates[i - 1]!),
        )
      )
        throw new HttpError(
          400,
          "Vencimentos devem ser crescentes e posteriores à emissão.",
        );
      const obligation = await tx.financialObligation.create({
        data: {
          companyId: a.companyId,
          branchId: v.branchId,
          supplierId: v.supplierId,
          categoryId: v.categoryId,
          actorId: a.membershipId,
          purchaseOrderId,
          purchaseReceiptId: v.purchaseReceiptId,
          origin: v.origin,
          description: v.description,
          documentNumber: v.documentNumber,
          issuedAt: new Date(v.issuedAt),
          competence: new Date(v.competence),
          notes: v.notes,
          originalAmount: reais(amount),
        },
      });
      obligationId = obligation.id;
      const n = BigInt(v.dueDates.length),
        part = amount / n,
        entryIds: string[] = [];
      for (const [i, due] of v.dueDates.entries()) {
        const value =
          i === v.dueDates.length - 1 ? amount - part * (n - 1n) : part;
        const e = await tx.financialEntry.create({
          data: {
            companyId: a.companyId,
            branchId: v.branchId,
            supplierId: v.supplierId,
            type: "PAYABLE",
            obligationId,
            installment: i + 1,
            description: v.description,
            amount: reais(value),
            dueDate: new Date(due),
          },
        });
        entryIds.push(e.id);
      }
      result = { obligationId, entryIds };
      const metadata = {
        branchId: v.branchId,
        origin: v.origin,
        purchaseOrderId,
        purchaseReceiptId: v.purchaseReceiptId ?? null,
        amount: reais(amount),
        entryIds,
        requestKey: v.requestKey,
      };
      await log(tx, a, "PAYABLE_CREATED", obligationId, metadata);
      if (v.origin === "PURCHASE")
        await log(
          tx,
          a,
          "PAYABLE_CREATED_FROM_PURCHASE",
          obligationId,
          metadata,
        );
      if (v.dueDates.length > 1)
        await log(
          tx,
          a,
          "PAYABLE_INSTALLMENTS_CREATED",
          obligationId,
          metadata,
        );
    } else {
      let e = await access(tx, a, id!);
      obligationId = e.obligationId!;
      await tx.$queryRaw`SELECT id FROM "FinancialObligation" WHERE "companyId"=${a.companyId}::uuid AND id=${obligationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancialEntry" WHERE "companyId"=${a.companyId}::uuid AND id=${id}::uuid FOR UPDATE`;
      e = await access(tx, a, id!);
      if (e.status === "CANCELLED")
        throw new HttpError(409, "Conta cancelada.");
      const before = entryAmounts(e);
      if (kind === "PAY") {
        const v = payablePaySchema.parse(input),
          value = cents(v.amount);
        if (value <= 0n || value > cents(before.balance))
          throw new HttpError(
            409,
            "Pagamento deve ser positivo e não pode exceder o saldo.",
          );
        if (
          v.paidAt > financialToday() ||
          v.paidAt < e.obligation!.issuedAt.toISOString().slice(0, 10)
        )
          throw new HttpError(400, "Data de pagamento inválida.");
        const settlement = await tx.financialSettlement.create({
          data: {
            companyId: a.companyId,
            entryId: e.id,
            actorId: a.membershipId,
            amount: reais(value),
            paidAt: new Date(v.paidAt),
            method: v.method,
            reference: v.reference,
            notes: v.notes,
          },
        });
        const paid = cents(before.paid) + value,
          complete = value === cents(before.balance);
        const latestPayment = await tx.financialSettlement.aggregate({
          where: { companyId: a.companyId, entryId: e.id },
          _max: { paidAt: true },
        });
        await tx.financialEntry.update({
          where: { id: e.id },
          data: {
            settledAmount: reais(paid),
            status: complete ? "SETTLED" : "OPEN",
            settledAt: complete ? latestPayment._max.paidAt : null,
          },
        });
        result = {
          obligationId,
          entryId: e.id,
          settlementId: settlement.id,
          paid: reais(paid),
          balance: reais(cents(before.balance) - value),
        };
        await log(tx, a, "PAYABLE_PAYMENT_REGISTERED", e.id, {
          ...result,
          branchId: e.branchId,
          origin: e.obligation!.origin,
          amount: reais(value),
          method: v.method,
          paidAt: v.paidAt,
          reference: v.reference,
          notes: v.notes,
          requestKey: v.requestKey,
        });
      } else {
        const payments = await tx.financialSettlement.count({
          where: { companyId: a.companyId, entry: { obligationId } },
        });
        if (payments || cents(before.paid) > 0n)
          throw new HttpError(
            409,
            "Obrigação com pagamentos: edição/cancelamento simples bloqueado.",
          );
        if (kind === "CANCEL") {
          const v = payableCancelSchema.parse(input);
          await tx.financialEntry.update({
            where: { id: e.id },
            data: { status: "CANCELLED", settledAt: null },
          });
          result = { obligationId, entryId: e.id };
          await log(tx, a, "PAYABLE_CANCELLED", e.id, {
            ...result,
            branchId: e.branchId,
            origin: e.obligation!.origin,
            amount: String(e.amount),
            balance: before.balance,
            reason: v.reason,
            requestKey: v.requestKey,
          });
        } else {
          const v = payableEditSchema.parse(input),
            amount = cents(v.amount),
            interest = cents(v.interest),
            penalty = cents(v.penalty),
            discount = cents(v.discount);
          if (amount <= 0n)
            throw new HttpError(400, "Valor original deve ser positivo.");
          validateBound(amount + interest + penalty - discount);
          if (v.dueDate < e.obligation!.issuedAt.toISOString().slice(0, 10))
            throw new HttpError(400, "Vencimento anterior à emissão.");
          if (
            e.obligation!.origin === "PURCHASE" &&
            amount !== cents(String(e.amount))
          )
            throw new HttpError(
              409,
              "Valor de compra deve preservar o total do recebimento; utilize ajustes explícitos.",
            );
          const siblings = await tx.financialEntry.findMany({
            where: { companyId: a.companyId, obligationId, id: { not: e.id } },
          });
          if (
            siblings.some((i) =>
              i.installment! < e.installment!
                ? i.dueDate >= new Date(v.dueDate)
                : i.dueDate <= new Date(v.dueDate),
            )
          )
            throw new HttpError(
              400,
              "Preserve a ordem dos vencimentos das parcelas.",
            );
          const originalAmount = validateBound(
            cents(String(e.obligation!.originalAmount)) +
              amount -
              cents(String(e.amount)),
          );
          await tx.financialObligation.update({
            where: { id: obligationId },
            data: { originalAmount: reais(originalAmount) },
          });
          const total = amount + interest + penalty - discount;
          await tx.financialEntry.update({
            where: { id: e.id },
            data: {
              amount: reais(amount),
              dueDate: new Date(v.dueDate),
              interest: reais(interest),
              penalty: reais(penalty),
              discount: reais(discount),
              status: total === 0n ? "SETTLED" : "OPEN",
              settledAt: total === 0n ? new Date() : null,
            },
          });
          result = { obligationId, entryId: e.id };
          await log(tx, a, "PAYABLE_UPDATED", e.id, {
            ...result,
            branchId: e.branchId,
            before: {
              amount: String(e.amount),
              dueDate: e.dueDate.toISOString().slice(0, 10),
              interest: String(e.interest),
              penalty: String(e.penalty),
              discount: String(e.discount),
            },
            after: {
              amount: v.amount,
              dueDate: v.dueDate,
              interest: v.interest,
              penalty: v.penalty,
              discount: v.discount,
            },
            reason: v.reason,
            requestKey: v.requestKey,
          });
        }
      }
    }
    await tx.financialAction.create({
      data: {
        companyId: a.companyId,
        obligationId,
        actorId: a.membershipId,
        kind,
        requestKey: input.requestKey,
        requestHash: hash,
        result,
      },
    });
    return result;
  });
}
