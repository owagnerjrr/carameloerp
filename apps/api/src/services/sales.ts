import { reverseReceivables } from "./receivables.js";
import { restoreCredits } from "./credits.js";
import { openSessionFor, cashSummary } from "./cash.js";
import { validatePayments, recordPayments } from "./payments.js";
import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import {
  cents,
  reais,
  discountCents,
  MAX_CENTS,
  type SaleCart,
  type Checkout,
  type cancelSaleSchema,
} from "@caramelo/contracts";
import type { z } from "zod";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock, moveStock, warehouseAccess } from "./stock.js";
const saleInclude = {
  items: { include: { returns: true } },
  cashSession: { include: { cashRegister: true } },
  returns: { include: { items: true, credit: true } },
  exchangeOrigin: true,
  payments: {
    include: { financialEntries: true },
    orderBy: [{ method: "desc" }, { id: "asc" }],
  },
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
export async function operator(
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
      publisher: p.publisher,
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
      return writeSale(tx, a, input, requestHash);
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
      if (sale.returns.length || sale.exchangeOrigin)
        throw new HttpError(
          409,
          "Venda vinculada a troca/devolução não admite cancelamento integral. Use devolução de itens.",
        );
      const session = await openSessionFor(tx, a, sale.branchId);
      const refund = sale.payments
        .filter((p) => p.method === "CASH")
        .reduce((n, p) => n + cents(String(p.amount)), 0n);
      if (refund > cents((await cashSummary(tx, a, session.id)).expected))
        throw new HttpError(
          409,
          "Dinheiro insuficiente na sessão atual para cancelar esta venda.",
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
      await restoreCredits(tx, a, sale);
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
      await reverseReceivables(tx, a, sale.id, now);
      for (const movement of sale.cashMovements.filter(
        (m) => m.kind === "RECEIPT",
      ))
        await tx.cashMovement.create({
          data: {
            companyId: a.companyId,
            cashRegisterId: session.cashRegisterId,
            cashSessionId: session.id,
            actorId: a.membershipId,
            method:
              movement.method ??
              sale.payments.find((p) => p.id === movement.paymentId)?.method,
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

export async function writeSale(
  tx: Transaction,
  a: AuthContext,
  input: Checkout,
  requestHash: string,
  options: { returnId?: string; exchangeCredit?: bigint } = {},
) {
  const warehouse = await warehouseAccess(tx, a, input.cart.warehouseId);
  const session = await openSessionFor(
    tx,
    a,
    warehouse.branchId,
    input.cashSessionId,
  );
  const credit = options.exchangeCredit ?? 0n;
  await lock(tx, a.companyId + ":warehouse:" + input.cart.warehouseId);
  const priced = await priceCart(tx, a, input.cart);
  const total = cents(priced.total);
  const payments = validatePayments(input, total - credit);
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
      cashSessionId: session.id,
      exchangeCredit: reais(credit),
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
      ...(options.returnId
        ? { returnId: options.returnId }
        : { saleId: sale.id }),
      reason: options.returnId
        ? `Saída por troca — reposição venda #${sale.number}`
        : `Saída por venda #${sale.number}`,
      type: "OUT",
    });
  }
  await recordPayments(tx, a, sale, session, payments);
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
        cashSessionId: session.id,
        returnId: options.returnId ?? null,
      },
    },
  });
  return tx.sale.findUniqueOrThrow({
    where: { id: sale.id },
    include: saleInclude,
  });
}
