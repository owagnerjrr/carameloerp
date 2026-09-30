import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import {
  purchaseSaveSchema,
  purchaseStateSchema,
  purchaseReceiveSchema,
} from "@caramelo/contracts";
import type { z } from "zod";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock, moveStock, warehouseAccess } from "./stock.js";
type Save = z.infer<typeof purchaseSaveSchema>;
type State = z.infer<typeof purchaseStateSchema>;
type Receive = z.infer<typeof purchaseReceiveSchema>;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const bounded = (v: Prisma.Decimal) => {
  if (v.isNegative() || v.greaterThan("999999999999.99"))
    throw new HttpError(400, "Valor fora do limite.");
  return v;
};
export async function purchaseAccess(
  tx: Transaction,
  a: AuthContext,
  id: string,
) {
  const row = await tx.purchaseOrder.findFirst({
    where: {
      id,
      companyId: a.companyId,
      ...(a.branchId ? { branchId: a.branchId } : {}),
    },
    include: { items: true },
  });
  if (!row) throw new HttpError(404, "Pedido indisponível.");
  return row;
}
async function record(
  tx: Transaction,
  a: AuthContext,
  action: string,
  orderId: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      companyId: a.companyId,
      actorId: a.membershipId,
      module: "purchases",
      action,
      recordId: orderId,
      metadata,
    },
  });
}
async function priceOrder(
  tx: Transaction,
  a: AuthContext,
  input: Save["order"],
) {
  if (a.branchId && a.branchId !== input.branchId)
    throw new HttpError(404, "Filial indisponível.");
  if (
    !(await tx.branch.findFirst({
      where: { id: input.branchId, companyId: a.companyId },
    }))
  )
    throw new HttpError(404, "Filial indisponível.");
  if (
    !(await tx.supplier.findFirst({
      where: { id: input.supplierId, companyId: a.companyId, active: true },
    }))
  )
    throw new HttpError(400, "Fornecedor indisponível.");
  if (
    !(await tx.membership.findFirst({
      where: {
        id: input.buyerId,
        companyId: a.companyId,
        active: true,
        user: { active: true },
        OR: [{ branchId: null }, { branchId: input.branchId }],
      },
    }))
  )
    throw new HttpError(400, "Responsável incompatível com a filial.");
  let subtotal = D(0),
    discount = D(0);
  const items = [];
  for (const line of input.items) {
    const p = await tx.product.findFirst({
      where: { id: line.productId, companyId: a.companyId, active: true },
    });
    if (!p) throw new HttpError(400, "Livro indisponível.");
    const unitCost = D(line.unitCost),
      unitDiscount = D(line.unitDiscount);
    if (unitDiscount.gt(unitCost))
      throw new HttpError(400, "Desconto superior ao custo.");
    const gross = unitCost.mul(line.quantity),
      off = unitDiscount.mul(line.quantity);
    subtotal = subtotal.plus(gross);
    discount = discount.plus(off);
    items.push({
      productId: p.id,
      title: p.description,
      isbn: p.isbn13 ?? p.isbn10,
      author: p.author,
      publisher: p.publisher,
      quantity: line.quantity,
      unitCost,
      unitDiscount,
      subtotal: bounded(gross.minus(off)),
    });
  }
  return {
    branchId: input.branchId,
    supplierId: input.supplierId,
    buyerId: input.buyerId,
    orderedAt: new Date(input.orderedAt),
    expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
    notes: input.notes,
    subtotal: bounded(subtotal),
    discount: bounded(discount),
    freight: D(input.freight),
    expenses: D(input.expenses),
    total: bounded(
      subtotal.minus(discount).plus(input.freight).plus(input.expenses),
    ),
    items,
  };
}
export async function purchaseCommand(
  db: Database,
  a: AuthContext,
  kind: "CREATE" | "UPDATE" | "STATE" | "RECEIVE",
  id: string | null,
  input: Save | State | Receive,
) {
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, id, input }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":request:" + input.requestKey);
      if (id) {
        await purchaseAccess(tx, a, id);
        await lock(tx, a.companyId + ":purchase:" + id);
      }
      const old = await tx.purchaseAction.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
      });
      if (old) {
        await purchaseAccess(tx, a, old.orderId);
        if (old.requestHash !== hash)
          throw new HttpError(409, "Chave já utilizada com outros dados.");
        return old.result;
      }
      let orderId = id!,
        action = "",
        notes = "",
        receiptId: string | null = null,
        status = "DRAFT";
      if (kind === "CREATE" || kind === "UPDATE") {
        const save = input as Save;
        if (
          kind === "UPDATE" &&
          (await purchaseAccess(tx, a, id!)).status !== "DRAFT"
        )
          throw new HttpError(409, "Somente rascunhos podem ser editados.");
        const { items, ...data } = await priceOrder(tx, a, save.order);
        if (kind === "CREATE") {
          await lock(tx, a.companyId + ":purchase:number");
          const max = await tx.purchaseOrder.aggregate({
            where: { companyId: a.companyId },
            _max: { number: true },
          });
          const order = await tx.purchaseOrder.create({
            data: {
              ...data,
              companyId: a.companyId,
              createdById: a.membershipId,
              number: (max._max.number ?? 0) + 1,
              items: { create: items },
            },
          });
          orderId = order.id;
          action = "PURCHASE_ORDER_CREATED";
        } else {
          await tx.purchaseOrderItem.deleteMany({
            where: { companyId: a.companyId, orderId },
          });
          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: { ...data, items: { create: items } },
          });
          action = "PURCHASE_ORDER_UPDATED";
        }
      } else if (kind === "STATE") {
        const order = await purchaseAccess(tx, a, orderId),
          state = input as State;
        notes = state.notes;
        const allowed: Record<string, string[]> = {
          SUBMIT: ["DRAFT"],
          APPROVE: ["PENDING"],
          ORDER: ["APPROVED"],
          CANCEL: [
            "DRAFT",
            "PENDING",
            "APPROVED",
            "ORDERED",
            "PARTIALLY_RECEIVED",
          ],
        };
        if (!allowed[state.action]!.includes(order.status))
          throw new HttpError(409, "Transição inválida para este pedido.");
        if (state.action === "CANCEL" && notes.length < 8)
          throw new HttpError(
            400,
            "Informe o motivo do cancelamento (8 caracteres).",
          );
        status = (
          {
            SUBMIT: "PENDING",
            APPROVE: "APPROVED",
            ORDER: "ORDERED",
            CANCEL: "CANCELLED",
          } as const
        )[state.action];
        await tx.purchaseOrder.update({
          where: { id: orderId },
          data: {
            status,
            ...(state.action === "APPROVE"
              ? { approvedAt: new Date(), approvedById: a.membershipId }
              : {}),
            ...(state.action === "ORDER" ? { sentAt: new Date() } : {}),
            ...(state.action === "CANCEL"
              ? { cancelledAt: new Date(), cancelReason: notes }
              : {}),
          },
        });
        action = (
          {
            SUBMIT: "PURCHASE_ORDER_SUBMITTED",
            APPROVE: "PURCHASE_ORDER_APPROVED",
            ORDER: "PURCHASE_ORDER_ORDERED",
            CANCEL: "PURCHASE_ORDER_CANCELLED",
          } as const
        )[state.action];
      } else {
        const order = await purchaseAccess(tx, a, orderId),
          r = input as Receive;
        if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status))
          throw new HttpError(409, "Este pedido não permite recebimento.");
        const warehouse = await warehouseAccess(tx, a, r.warehouseId);
        if (warehouse.branchId !== order.branchId)
          throw new HttpError(
            400,
            "Depósito deve pertencer à filial do pedido.",
          );
        if (r.receivedAt < order.orderedAt.toISOString().slice(0, 10))
          throw new HttpError(400, "Recebimento anterior ao pedido.");
        if (
          !(await tx.supplier.findFirst({
            where: {
              id: order.supplierId,
              companyId: a.companyId,
              active: true,
            },
          }))
        )
          throw new HttpError(400, "Fornecedor inativo.");
        const warehouses = await tx.warehouse.findMany({
          where: { companyId: a.companyId },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        for (const w of warehouses)
          await lock(tx, a.companyId + ":warehouse:" + w.id);
        for (const line of r.items)
          if (!order.items.some((i) => i.id === line.orderItemId))
            throw new HttpError(400, "Item não pertence ao pedido.");
        const lines = [...r.items].sort((x, y) =>
          order.items
            .find((i) => i.id === x.orderItemId)!
            .productId.localeCompare(
              order.items.find((i) => i.id === y.orderItemId)!.productId,
            ),
        );
        const divergences = [...r.divergences];
        for (const line of lines) {
          const oi = order.items.find((i) => i.id === line.orderItemId)!;
          const excess =
            line.quantity - Math.max(0, oi.quantity - oi.receivedQuantity);
          if (excess > 0) {
            if (!a.permissions.includes("purchases:excess"))
              throw new HttpError(
                403,
                "Quantidade acima do pedido exige permissão.",
              );
            if (r.excessReason.length < 8)
              throw new HttpError(400, "Justifique a aceitação do excedente.");
            divergences.push({
              type: "EXCESS",
              productId: oi.productId,
              quantity: excess,
              notes: r.excessReason,
            });
          }
        }
        for (const divergence of divergences) {
          if (
            !(await tx.product.findFirst({
              where: { id: divergence.productId, companyId: a.companyId },
            }))
          )
            throw new HttpError(400, "Livro da divergência indisponível.");
          if (
            divergence.type === "EXCESS" &&
            !a.permissions.includes("purchases:excess")
          )
            throw new HttpError(403, "Excedente exige permissão.");
        }
        const charges = D(r.freight).plus(r.expenses),
          count = lines.reduce((s, l) => s + l.quantity, 0);
        if (!count && !charges.isZero())
          throw new HttpError(400, "Encargos exigem itens recebidos.");
        const total = bounded(
          lines.reduce(
            (s, l) => s.plus(D(l.unitCost).mul(l.quantity)),
            charges,
          ),
        );
        const document = await tx.stockDocument.create({
          data: {
            companyId: a.companyId,
            warehouseId: warehouse.id,
            actorId: a.membershipId,
            supplierId: order.supplierId,
            kind: "ENTRY",
            requestKey: r.requestKey,
            requestHash: hash,
            documentNumber: "COMPRA-" + order.number,
            receivedAt: new Date(r.receivedAt),
            notes: r.notes,
          },
        });
        const receipt = await tx.purchaseReceipt.create({
          data: {
            companyId: a.companyId,
            orderId,
            documentId: document.id,
            freight: r.freight,
            expenses: r.expenses,
            total,
            excessReason: r.excessReason,
            divergences: {
              create: divergences,
            },
          },
        });
        receiptId = receipt.id;
        notes = r.notes;
        let allocated = D(0);
        for (const [index, line] of lines.entries()) {
          const oi = order.items.find((i) => i.id === line.orderItemId)!;
          await tx.$queryRaw`SELECT id FROM "Product" WHERE "companyId"=${a.companyId}::uuid AND id=${oi.productId}::uuid FOR UPDATE`;
          const p = await tx.product.findFirst({
            where: { id: oi.productId, companyId: a.companyId, active: true },
          });
          if (!p) throw new HttpError(400, "Livro inativo ou indisponível.");
          const aggregate = await tx.stockBalance.aggregate({
              where: { companyId: a.companyId, productId: p.id },
              _sum: { quantity: true },
            }),
            before = aggregate._sum.quantity ?? D(0);
          const apportioned =
            index === lines.length - 1
              ? charges.minus(allocated)
              : charges
                  .mul(line.quantity)
                  .div(count)
                  .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
          allocated = allocated.plus(apportioned);
          const amount = D(line.unitCost).mul(line.quantity).plus(apportioned);
          const resulting = bounded(
            before
              .mul(p.cost)
              .plus(amount)
              .div(before.plus(line.quantity))
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          );
          await tx.purchaseReceiptItem.create({
            data: {
              companyId: a.companyId,
              receiptId: receipt.id,
              orderItemId: oi.id,
              quantity: line.quantity,
              unitCost: line.unitCost,
              allocatedCharges: apportioned,
              total: amount,
              previousCost: p.cost,
              resultingCost: resulting,
            },
          });
          await tx.stockDocumentItem.create({
            data: {
              companyId: a.companyId,
              documentId: document.id,
              productId: p.id,
              title: oi.title,
              quantity: line.quantity,
              unitCost: line.unitCost,
            },
          });
          await moveStock(tx, a, {
            warehouseId: warehouse.id,
            productId: p.id,
            delta: D(line.quantity),
            documentId: document.id,
            reason: "Recebimento do pedido " + order.number,
            type: "IN",
          });
          await tx.product.update({
            where: { id: p.id },
            data: { cost: resulting },
          });
          await tx.purchaseOrderItem.update({
            where: { id: oi.id },
            data: { receivedQuantity: { increment: line.quantity } },
          });
        }
        const updated = await tx.purchaseOrderItem.findMany({
          where: { companyId: a.companyId, orderId },
        });
        status = updated.every((i) => i.receivedQuantity >= i.quantity)
          ? "RECEIVED"
          : updated.some((i) => i.receivedQuantity > 0)
            ? "PARTIALLY_RECEIVED"
            : "ORDERED";
        await tx.purchaseOrder.update({
          where: { id: orderId },
          data: { status },
        });
        if (divergences.length)
          await record(tx, a, "PURCHASE_DIVERGENCE_RECORDED", orderId, {
            receiptId,
            divergences,
          });
        action = "PURCHASE_RECEIVED";
      }
      const result = { orderId, receiptId, status };
      await tx.purchaseAction.create({
        data: {
          companyId: a.companyId,
          orderId,
          actorId: a.membershipId,
          kind: action,
          notes,
          requestKey: input.requestKey,
          requestHash: hash,
          result,
        },
      });
      const final = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      await record(tx, a, action, orderId, {
        ...result,
        branchId: final.branchId,
        supplierId: final.supplierId,
        notes,
      });
      return result;
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
