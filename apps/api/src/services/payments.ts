import { redeemCredits } from "./credits.js";
import { cents, reais, splitCents, type Checkout } from "@caramelo/contracts";
import type { CashSession, Sale } from "@caramelo/database";
import { HttpError, type Transaction, type AuthContext } from "../context.js";
function commercialDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
function dueMonth(day: string, month: number) {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m! - 1 + month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y!, m! - 1 + month, Math.min(d!, last)));
}

export function validatePayments(
  input: Pick<Checkout, "payments">,
  total: bigint,
) {
  if (input.payments.filter((p) => p.method === "STORE_CREDIT").length > 1)
    throw new HttpError(400, "Agrupe vale-crédito em um único pagamento.");
  if (input.payments.filter((p) => p.method === "CASH").length > 1)
    throw new HttpError(400, "Agrupe dinheiro em um único pagamento.");
  const payments = input.payments.map((p) => {
    const amount = cents(p.amount);
    if (amount <= 0n)
      throw new HttpError(400, "Pagamento deve ter valor positivo.");
    if (p.method !== "CASH" && p.method !== "STORE_CREDIT" && !p.confirmed)
      throw new HttpError(400, "Confirme o recebimento externo do PIX/cartão.");
    if (p.method !== "CREDIT_CARD" && p.installments !== 1)
      throw new HttpError(400, "Parcelas somente para crédito.");
    if (p.method !== "CASH" && p.receivedAmount !== undefined)
      throw new HttpError(400, "Valor recebido/troco somente em dinheiro.");
    const received =
      p.method === "CASH" ? cents(p.receivedAmount ?? "0") : null;
    if (received !== null && received < amount)
      throw new HttpError(400, "Valor recebido em dinheiro insuficiente.");
    if (amount < BigInt(p.installments))
      throw new HttpError(400, "Valor insuficiente para o número de parcelas.");
    return {
      ...p,
      amount: reais(amount),
      receivedAmount: received === null ? null : reais(received),
      change: reais(received === null ? 0n : received - amount),
    };
  });
  if (payments.reduce((n, p) => n + cents(p.amount), 0n) !== total)
    throw new HttpError(
      400,
      "A soma dos pagamentos deve ser igual ao total da venda.",
    );

  return payments;
}
export async function recordPayments(
  tx: Transaction,
  a: AuthContext,
  sale: Sale,
  session: CashSession,
  payments: ReturnType<typeof validatePayments>,
) {
  const day = commercialDate(sale.createdAt);
  for (const p of payments) {
    const immediate = p.method === "CASH" || p.method === "PIX";
    const payment = await tx.payment.create({
      data: {
        companyId: a.companyId,
        saleId: sale.id,
        method: p.method,
        amount: p.amount,
        receivedAmount: p.receivedAmount,
        change: p.change,
        installments: p.installments,
        cardBrand: p.cardBrand,
        reference: p.reference,
        paidAt: sale.createdAt,
      },
    });
    if (p.method === "STORE_CREDIT") await redeemCredits(tx, a, sale, p.amount);
    const parts =
      p.method === "STORE_CREDIT"
        ? []
        : splitCents(cents(p.amount), p.installments);
    for (const [i, value] of parts.entries()) {
      const due =
        p.method === "CREDIT_CARD"
          ? dueMonth(day, i + 1)
          : new Date(day + "T00:00:00Z");
      if (p.method === "DEBIT_CARD") due.setUTCDate(due.getUTCDate() + 1);
      await tx.financialEntry.create({
        data: {
          companyId: a.companyId,
          branchId: sale.branchId,
          saleId: sale.id,
          paymentId: payment.id,
          customerId: sale.customerId,
          type: "RECEIVABLE",
          status: immediate ? "SETTLED" : "OPEN",
          description: `Venda #${sale.number} — ${p.method} — ${i + 1}/${parts.length}`,
          amount: reais(value),
          settledAmount: immediate ? reais(value) : "0",
          dueDate: due,
          settledAt: immediate ? sale.createdAt : null,
          installment: i + 1,
        },
      });
    }
    {
      await tx.cashMovement.create({
        data: {
          companyId: a.companyId,
          cashRegisterId: session.cashRegisterId,
          cashSessionId: session.id,
          actorId: a.membershipId,
          method: p.method,
          saleId: sale.id,
          paymentId: payment.id,
          kind: "RECEIPT",
          amount: p.amount,
          description: `Venda #${sale.number} — ${p.method}`,
        },
      });
    }
  }
}
