import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import {
  cents,
  reais,
  discountCents,
  splitCents,
  MAX_CENTS,
  type SaleCart,
  type Checkout,
  type cancelSaleSchema,
} from "@caramelo/contracts";
import type { z } from "zod";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock, moveStock, warehouseAccess } from "./stock.js";
const saleInclude = {
  items: true,
  payments: { include: { financialEntries: true } },
  warehouse: { include: { branch: true } },
  branch: true,
  seller: { select: { user: { select: { name: true } } } },
  customer: { select: { name: true, document: true } },
  movements: { orderBy: { createdAt: "asc" as const } },
  financialEntries: true,
  cashMovements: true,
} satisfies Prisma.SaleInclude;
export { saleInclude };
function requireMoneyRange(value: bigint) {
  if (value < 0n || value > MAX_CENTS)
    throw new HttpError(400, "Total fora do limite monetário permitido.");
}
async function operator(
  tx: Transaction,
  auth: AuthContext,
  permission: string,
) {
  const m = await tx.membership.findFirst({
    where: {
      id: auth.membershipId,
      companyId: auth.companyId,
      active: true,
      user: { active: true },
      company: { active: true },
    },
    include: { role: { include: { permissions: true } } },
  });
  if (!m || !m.role.permissions.some((p) => p.permissionCode === permission))
    throw new HttpError(403, "Acesso à operação revogado.");
  return {
    ...auth,
    branchId: m.role.name === "Administrador" ? null : m.branchId,
    role: m.role.name,
    permissions: m.role.permissions.map((p) => p.permissionCode),
  };
}
export async function priceCart(
  tx: Transaction,
  auth: AuthContext,
  cart: SaleCart,
) {
  const warehouse = await warehouseAccess(tx, auth, cart.warehouseId);
  if (
    cart.customerId &&
    !(await tx.customer.findFirst({
      where: { id: cart.customerId, companyId: auth.companyId, active: true },
    }))
  )
    throw new HttpError(400, "Cliente indisponível.");
  const products = await tx.product.findMany({
    where: {
      companyId: auth.companyId,
      id: { in: cart.items.map((i) => i.productId) },
      active: true,
    },
    include: { balances: { where: { warehouseId: warehouse.id } } },
  });
  let subtotal = 0n,
    itemDiscount = 0n;
  const items = cart.items.map((line) => {
    const p = products.find((p) => p.id === line.productId);
    if (!p) throw new HttpError(400, "Livro inativo ou indisponível.");
    const price = cents(String(p.price));
    if (price !== cents(line.expectedUnitPrice))
      throw new HttpError(
        409,
        `O preço de ${p.description} mudou. Atualize o carrinho.`,
      );
    if (
      (p.balances[0]?.quantity ?? new Prisma.Decimal(0)).lessThan(line.quantity)
    )
      throw new HttpError(409, "Estoque insuficiente.");
    const gross = price * BigInt(line.quantity);
    requireMoneyRange(gross);
    let discount: bigint;
    try {
      discount = discountCents(gross, line.discount);
    } catch {
      throw new HttpError(400, "Desconto inválido.");
    }
    if (discount > gross)
      throw new HttpError(400, "Desconto do item excede o subtotal.");
    subtotal += gross;
    itemDiscount += discount;
    return {
      productId: p.id,
      description: p.description,
      isbn: p.isbn13 ?? p.barcode ?? p.isbn10,
      author: p.author,
      quantity: line.quantity,
      unitPrice: reais(price),
      unitCost: String(p.cost),
      discount: reais(discount),
      subtotal: reais(gross - discount),
    };
  });
  let discount: bigint;
  try {
    discount = discountCents(subtotal - itemDiscount, cart.discount);
  } catch {
    throw new HttpError(400, "Desconto total inválido.");
  }
  const total = subtotal - itemDiscount - discount;
  requireMoneyRange(subtotal);
  requireMoneyRange(total);
  const allDiscount = itemDiscount + discount;
  if (allDiscount > 0n) {
    if (!auth.permissions.includes("sales:discount"))
      throw new HttpError(403, "Seu perfil não permite desconto.");
    const max =
      auth.role === "Administrador"
        ? 10000n
        : auth.role === "Gerente"
          ? 2000n
          : auth.role === "Vendedor"
            ? 500n
            : 0n;
    if (allDiscount * 10000n > subtotal * max)
      throw new HttpError(
        403,
        `Desconto excede o limite do perfil (${max / 100n}%).`,
      );
  }
  return {
    warehouse,
    items,
    subtotal: reais(subtotal),
    itemDiscount: reais(itemDiscount),
    discount: reais(discount),
    total: reais(total),
  };
}
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
export async function completeSale(
  db: Database,
  auth: AuthContext,
  input: Checkout,
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      const a = await operator(tx, auth, "sales:create");
      await warehouseAccess(tx, a, input.cart.warehouseId);
      await lock(tx, a.companyId + ":sale-request:" + input.requestKey);
      const old = await tx.sale.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
        include: saleInclude,
      });
      if (old) {
        if (old.requestHash !== requestHash)
          throw new HttpError(
            409,
            "Chave de confirmação já usada para outra venda.",
          );
        return old;
      }
      await lock(tx, a.companyId + ":warehouse:" + input.cart.warehouseId);
      const priced = await priceCart(tx, a, input.cart);
      const total = cents(priced.total);
      if (input.payments.filter((p) => p.method === "CASH").length > 1)
        throw new HttpError(400, "Agrupe dinheiro em um único pagamento.");
      const payments = input.payments.map((p) => {
        const amount = cents(p.amount);
        if (amount <= 0n)
          throw new HttpError(400, "Pagamento deve ter valor positivo.");
        if (p.method !== "CASH" && !p.confirmed)
          throw new HttpError(
            400,
            "Confirme o recebimento externo do PIX/cartão.",
          );
        if (p.method !== "CREDIT_CARD" && p.installments !== 1)
          throw new HttpError(400, "Parcelas somente para crédito.");
        if (p.method !== "CASH" && p.receivedAmount !== undefined)
          throw new HttpError(400, "Valor recebido/troco somente em dinheiro.");
        const received =
          p.method === "CASH" ? cents(p.receivedAmount ?? "0") : null;
        if (received !== null && received < amount)
          throw new HttpError(400, "Valor recebido em dinheiro insuficiente.");
        if (amount < BigInt(p.installments))
          throw new HttpError(
            400,
            "Valor insuficiente para o número de parcelas.",
          );
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
      await lock(tx, a.companyId + ":sale-number");
      const number =
        (
          await tx.sale.aggregate({
            where: { companyId: a.companyId },
            _max: { number: true },
          })
        )._max.number ?? 0;
      const sale = await tx.sale.create({
        data: {
          companyId: a.companyId,
          branchId: priced.warehouse.branchId,
          warehouseId: priced.warehouse.id,
          sellerId: a.membershipId,
          customerId: input.cart.customerId,
          number: number + 1,
          status: "COMPLETED",
          subtotal: priced.subtotal,
          total: priced.total,
          discount: priced.discount,
          requestKey: input.requestKey,
          requestHash,
        },
      });
      for (const item of priced.items) {
        const { subtotal: _, ...data } = item;
        void _;
        await tx.saleItem.create({
          data: { ...data, companyId: a.companyId, saleId: sale.id },
        });
        await moveStock(tx, a, {
          warehouseId: priced.warehouse.id,
          productId: item.productId,
          delta: new Prisma.Decimal(item.quantity).negated(),
          saleId: sale.id,
          reason: `Saída por venda #${sale.number}`,
          type: "OUT",
        });
      }
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
        const parts = splitCents(cents(p.amount), p.installments);
        for (const [i, value] of parts.entries()) {
          const due =
            p.method === "CREDIT_CARD"
              ? dueMonth(day, i + 1)
              : new Date(day + "T00:00:00Z");
          if (p.method === "DEBIT_CARD") due.setUTCDate(due.getUTCDate() + 1);
          await tx.financialEntry.create({
            data: {
              companyId: a.companyId,
              branchId: priced.warehouse.branchId,
              saleId: sale.id,
              paymentId: payment.id,
              customerId: input.cart.customerId,
              type: "RECEIVABLE",
              status: immediate ? "SETTLED" : "OPEN",
              description: `Venda #${sale.number} — ${p.method} — ${i + 1}/${parts.length}`,
              amount: reais(value),
              dueDate: due,
              settledAt: immediate ? sale.createdAt : null,
              installment: i + 1,
            },
          });
        }
        if (immediate) {
          const cash = await tx.cashRegister.upsert({
            where: {
              companyId_branchId: {
                companyId: a.companyId,
                branchId: priced.warehouse.branchId,
              },
            },
            create: {
              companyId: a.companyId,
              branchId: priced.warehouse.branchId,
              name: "Caixa de vendas da filial",
            },
            update: {},
          });
          await tx.cashMovement.create({
            data: {
              companyId: a.companyId,
              cashRegisterId: cash.id,
              saleId: sale.id,
              paymentId: payment.id,
              kind: "RECEIPT",
              amount: p.amount,
              description: `Venda #${sale.number} — ${p.method}`,
            },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          companyId: a.companyId,
          actorId: a.membershipId,
          action: "SALE_COMPLETED",
          module: "sales",
          recordId: sale.id,
          metadata: {
            branchId: sale.branchId,
            warehouseId: sale.warehouseId,
            total: sale.total.toString(),
            itemDiscount: priced.itemDiscount,
            discount: priced.discount,
            manualPayments: true,
          },
        },
      });
      return tx.sale.findUniqueOrThrow({
        where: { id: sale.id },
        include: saleInclude,
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
export async function cancelSale(
  db: Database,
  auth: AuthContext,
  id: string,
  input: z.infer<typeof cancelSaleSchema>,
) {
  return db.$transaction(
    async (tx) => {
      const a = await operator(tx, auth, "sales:cancel");
      await lock(tx, a.companyId + ":sale:" + id);
      const sale = await tx.sale.findFirst({
        where: {
          id,
          companyId: a.companyId,
          ...(a.branchId ? { branchId: a.branchId } : {}),
        },
        include: saleInclude,
      });
      if (!sale) throw new HttpError(404, "Venda indisponível.");
      if (sale.status === "CANCELLED") {
        if (
          sale.cancelRequestKey !== input.requestKey ||
          sale.cancelReason !== input.reason
        )
          throw new HttpError(409, "Venda já cancelada.");
        return sale;
      }
      if (sale.status !== "COMPLETED" || !sale.warehouseId || !sale.requestKey)
        throw new HttpError(
          400,
          "Somente vendas operacionais concluídas nesta versão podem ser canceladas.",
        );
      await warehouseAccess(tx, a, sale.warehouseId);
      await lock(tx, a.companyId + ":warehouse:" + sale.warehouseId);
      for (const item of sale.items)
        await moveStock(tx, a, {
          warehouseId: sale.warehouseId,
          productId: item.productId,
          delta: item.quantity,
          saleId: sale.id,
          reason: `Cancelamento da venda #${sale.number}: ${input.reason}`,
          type: "IN",
        });
      const now = new Date();
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelledById: a.membershipId,
          cancelReason: input.reason,
          cancelRequestKey: input.requestKey,
        },
      });
      await tx.payment.updateMany({
        where: { companyId: a.companyId, saleId: sale.id },
        data: { reversedAt: now },
      });
      await tx.financialEntry.updateMany({
        where: { companyId: a.companyId, saleId: sale.id },
        data: { status: "CANCELLED", settledAt: null },
      });
      for (const movement of sale.cashMovements.filter(
        (m) => m.kind === "RECEIPT",
      ))
        await tx.cashMovement.create({
          data: {
            companyId: a.companyId,
            cashRegisterId: movement.cashRegisterId,
            saleId: sale.id,
            paymentId: movement.paymentId,
            kind: "REVERSAL",
            amount: movement.amount.negated(),
            description: `Cancelamento #${sale.number}: ${input.reason}`,
          },
        });
      await tx.auditLog.create({
        data: {
          companyId: a.companyId,
          actorId: a.membershipId,
          action: "SALE_CANCELLED",
          module: "sales",
          recordId: sale.id,
          metadata: {
            branchId: sale.branchId,
            warehouseId: sale.warehouseId,
            reason: input.reason,
            refundConfirmed: true,
          },
        },
      });
      return tx.sale.findUniqueOrThrow({
        where: { id: sale.id },
        include: saleInclude,
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
