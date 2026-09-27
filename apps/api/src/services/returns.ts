import { randomUUID } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import { cents, reais, type returnSchema } from "@caramelo/contracts";
import type { z } from "zod";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { operator, priceCart, writeSale, saleInclude } from "./sales.js";
import { openSessionFor, hashInput } from "./cash.js";
import { lock, moveStock, warehouseAccess } from "./stock.js";
type Input = z.infer<typeof returnSchema>;
export const returnInclude = {
  originalSale: { select: { id: true, number: true } },
  replacementSale: { include: saleInclude },
  items: { include: { saleItem: true } },
  movements: true,
  credit: true,
  customer: true,
  branch: true,
  actor: { select: { user: { select: { name: true } } } },
  cashSession: { include: { cashRegister: true } },
} satisfies Prisma.ReturnOperationInclude;
/** Stable proportional allocation of the header discount, retaining every cent. */
export function originalItemValues(sale: {
  total: Prisma.Decimal;
  discount: Prisma.Decimal;
  items: Array<{
    id: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discount: Prisma.Decimal;
  }>;
}) {
  const sorted = [...sale.items].sort((a, b) => a.id.localeCompare(b.id)),
    base = sorted.reduce(
      (sum, i) =>
        sum +
        BigInt(i.quantity.mul(i.unitPrice).mul(100).toFixed(0)) -
        cents(String(i.discount)),
      0n,
    ),
    off = cents(String(sale.discount));
  let cumulative = 0n,
    allocated = 0n;
  const values = new Map<string, bigint>();
  for (const item of sorted) {
    const line =
      BigInt(item.quantity.mul(item.unitPrice).mul(100).toFixed(0)) -
      cents(String(item.discount));
    cumulative += line;
    const next = base === 0n ? 0n : (off * cumulative) / base;
    values.set(item.id, line - (next - allocated));
    allocated = next;
  }
  return values;
}
export async function quoteReturn(
  tx: Transaction,
  a: AuthContext,
  input: Input,
) {
  const sale = await tx.sale.findFirst({
    where: {
      id: input.originalSaleId,
      companyId: a.companyId,
      ...(a.branchId ? { branchId: a.branchId } : {}),
    },
    include: { items: { include: { returns: true } } },
  });
  if (
    !sale ||
    sale.status !== "COMPLETED" ||
    !sale.warehouseId ||
    !sale.requestKey
  )
    throw new HttpError(
      400,
      "Venda indisponível para troca/devolução operacional.",
    );
  await warehouseAccess(tx, a, sale.warehouseId);
  if (input.replacement && input.replacement.warehouseId !== sale.warehouseId)
    throw new HttpError(400, "A troca deve usar o depósito original da venda.");
  const customerId = input.customerId ?? sale.customerId;
  if (
    customerId &&
    !(await tx.customer.findFirst({
      where: { id: customerId, companyId: a.companyId, active: true },
    }))
  )
    throw new HttpError(400, "Cliente indisponível.");
  const values = originalItemValues(sale);
  let returned = 0n;
  const items = input.items.map((line) => {
    const i = sale.items.find((i) => i.id === line.saleItemId);
    if (!i || !i.quantity.isInteger())
      throw new HttpError(400, "Item original inválido.");
    const qty = Number(i.quantity),
      already = i.returns.reduce((n, r) => n + r.quantity, 0);
    if (line.quantity > qty - already)
      throw new HttpError(
        409,
        "Quantidade devolvida excede o saldo disponível da venda.",
      );
    const net = values.get(i.id)!;
    const amount =
      (net * BigInt(already + line.quantity)) / BigInt(qty) -
      (net * BigInt(already)) / BigInt(qty);
    returned += amount;
    return {
      saleItemId: i.id,
      productId: i.productId,
      description: i.description,
      quantity: line.quantity,
      amount: reais(amount),
    };
  });
  // Stock availability is checked before mutation; returned stock is not used to mask shortage.
  const replacement = input.replacement
    ? await priceCart(tx, a, { ...input.replacement, customerId })
    : null;
  const newAmount = cents(replacement?.total ?? "0"),
    difference = newAmount - returned;
  if (difference < 0n && !customerId)
    throw new HttpError(400, "Identifique o cliente para gerar vale-crédito.");
  if (difference <= 0n && input.payments.length)
    throw new HttpError(
      400,
      "Não informe pagamento quando não existe diferença a pagar.",
    );
  return {
    sale,
    customerId,
    items,
    returnedAmount: reais(returned),
    newAmount: reais(newAmount),
    difference: reais(difference),
    credit: reais(difference < 0n ? -difference : 0n),
  };
}
export async function completeReturn(
  db: Database,
  auth: AuthContext,
  input: Input,
) {
  return db.$transaction(
    async (tx) => {
      const a = await operator(tx, auth, "returns:create");
      await lock(tx, a.companyId + ":return-request:" + input.requestKey);
      const old = await tx.returnOperation.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
        include: returnInclude,
      });
      if (old) {
        await warehouseAccess(tx, a, old.warehouseId);
        if (old.requestHash !== hashInput(input))
          throw new HttpError(409, "Chave já utilizada com outra troca.");
        return old;
      }
      await lock(tx, a.companyId + ":sale:" + input.originalSaleId);
      const original = await tx.sale.findFirst({
        where: {
          id: input.originalSaleId,
          companyId: a.companyId,
          ...(a.branchId ? { branchId: a.branchId } : {}),
        },
      });
      if (!original?.warehouseId)
        throw new HttpError(404, "Venda original indisponível.");
      const session = await openSessionFor(
        tx,
        a,
        original.branchId,
        input.cashSessionId,
      );
      await lock(tx, a.companyId + ":warehouse:" + original.warehouseId);
      const q = await quoteReturn(tx, a, input);
      await lock(tx, a.companyId + ":return-number");
      const number =
        ((
          await tx.returnOperation.aggregate({
            where: { companyId: a.companyId },
            _max: { number: true },
          })
        )._max.number ?? 0) + 1;
      const op = await tx.returnOperation.create({
        data: {
          companyId: a.companyId,
          branchId: original.branchId,
          warehouseId: original.warehouseId,
          cashSessionId: session.id,
          originalSaleId: original.id,
          customerId: q.customerId,
          actorId: a.membershipId,
          number,
          kind: input.replacement ? "EXCHANGE" : "RETURN",
          reason: input.reason,
          returnedAmount: q.returnedAmount,
          newAmount: q.newAmount,
          difference: q.difference,
          requestKey: input.requestKey,
          requestHash: hashInput(input),
        },
      });
      for (const item of q.items) {
        await tx.returnItem.create({
          data: {
            companyId: a.companyId,
            returnId: op.id,
            saleItemId: item.saleItemId,
            quantity: item.quantity,
            amount: item.amount,
          },
        });
        await moveStock(tx, a, {
          warehouseId: op.warehouseId,
          productId: item.productId,
          delta: new Prisma.Decimal(item.quantity),
          returnId: op.id,
          type: "IN",
          reason: `Retorno por ${input.replacement ? "troca" : "devolução"} #${number} — venda #${original.number}`,
        });
      }
      if (input.replacement) {
        const credit =
          cents(q.returnedAmount) < cents(q.newAmount)
            ? cents(q.returnedAmount)
            : cents(q.newAmount);
        const sale = await writeSale(
          tx,
          a,
          {
            requestKey: randomUUID(),
            cashSessionId: session.id,
            cart: { ...input.replacement, customerId: q.customerId },
            payments: input.payments,
          },
          hashInput(input),
          { returnId: op.id, exchangeCredit: credit },
        );
        await tx.returnOperation.update({
          where: { id: op.id },
          data: { replacementSaleId: sale.id },
        });
      }
      if (cents(q.credit) > 0n) {
        await tx.customerCredit.create({
          data: {
            companyId: a.companyId,
            customerId: q.customerId!,
            returnId: op.id,
            amount: q.credit,
            balance: q.credit,
          },
        });
        await tx.financialEntry.create({
          data: {
            companyId: a.companyId,
            branchId: op.branchId,
            customerId: q.customerId,
            returnId: op.id,
            type: "PAYABLE",
            status: "OPEN",
            amount: q.credit,
            dueDate: new Date(),
            description: `Vale-crédito da ${op.kind === "RETURN" ? "devolução" : "troca"} #${number} — obrigação com cliente`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: a.companyId,
          actorId: a.membershipId,
          module: "returns",
          action: input.replacement ? "EXCHANGE_COMPLETED" : "RETURN_COMPLETED",
          recordId: op.id,
          metadata: {
            branchId: op.branchId,
            cashSessionId: session.id,
            originalSaleId: op.originalSaleId,
            reason: op.reason,
            returnedAmount: q.returnedAmount,
            newAmount: q.newAmount,
            difference: q.difference,
            items: q.items,
          },
        },
      });
      return tx.returnOperation.findUniqueOrThrow({
        where: { id: op.id },
        include: returnInclude,
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
