import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import { stockEntrySchema, stockAdjustmentSchema } from "@caramelo/contracts";
import { type AuthContext, type Transaction, HttpError } from "../context.js";
import type { z } from "zod";
export async function warehouseAccess(
  tx: Transaction,
  auth: AuthContext,
  id: string,
) {
  const warehouse = await tx.warehouse.findFirst({
    where: {
      id,
      companyId: auth.companyId,
      ...(auth.branchId ? { branchId: auth.branchId } : {}),
    },
  });
  if (!warehouse) throw new HttpError(404, "Depósito/filial indisponível.");
  return warehouse;
}
async function lock(tx: Transaction, key: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
/** Must run inside the caller transaction. All balance mutations use this service. */
export async function moveStock(
  tx: Transaction,
  auth: AuthContext,
  input: {
    warehouseId: string;
    productId: string;
    delta: Prisma.Decimal;
    documentId: string;
    reason: string;
    type: "IN" | "OUT" | "ADJUSTMENT";
  },
) {
  await warehouseAccess(tx, auth, input.warehouseId);
  await lock(tx, auth.companyId + ":warehouse:" + input.warehouseId);
  const key = {
    companyId: auth.companyId,
    warehouseId: input.warehouseId,
    productId: input.productId,
  };
  const balance = await tx.stockBalance.findUnique({
    where: { companyId_warehouseId_productId: key },
  });
  const before = balance?.quantity ?? new Prisma.Decimal(0),
    after = before.plus(input.delta);
  if (after.isNegative())
    throw new HttpError(409, "Saldo insuficiente para a operação.");
  if (input.delta.isZero())
    throw new HttpError(400, "A operação não altera o saldo.");
  await tx.stockBalance.upsert({
    where: { companyId_warehouseId_productId: key },
    create: { ...key, quantity: after },
    update: { quantity: after },
  });
  return tx.stockMovement.create({
    data: {
      ...key,
      actorId: auth.membershipId,
      type: input.type,
      quantity: input.delta,
      beforeQuantity: before,
      afterQuantity: after,
      documentId: input.documentId,
      reason: input.reason,
    },
  });
}
type Entry = z.infer<typeof stockEntrySchema>;
type Adjustment = z.infer<typeof stockAdjustmentSchema>;
export async function confirmStock(
  db: Database,
  auth: AuthContext,
  kind: "ENTRY" | "ADJUSTMENT",
  input: Entry | Adjustment,
) {
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, input }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      const warehouse = await warehouseAccess(tx, auth, input.warehouseId);
      await lock(tx, auth.companyId + ":request:" + input.requestKey);
      const old = await tx.stockDocument.findUnique({
        where: {
          companyId_requestKey: {
            companyId: auth.companyId,
            requestKey: input.requestKey,
          },
        },
        include: { items: true, movements: true },
      });
      if (old) {
        if (old.requestHash !== hash)
          throw new HttpError(
            409,
            "Esta confirmação já foi utilizada com outros dados.",
          );
        return old;
      }
      await lock(tx, auth.companyId + ":warehouse:" + warehouse.id);
      const entry = kind === "ENTRY" ? (input as Entry) : null,
        adjust = kind === "ADJUSTMENT" ? (input as Adjustment) : null;
      if (
        entry &&
        !(await tx.supplier.findFirst({
          where: {
            id: entry.supplierId,
            companyId: auth.companyId,
            active: true,
          },
        }))
      )
        throw new HttpError(400, "Fornecedor indisponível.");
      const document = await tx.stockDocument.create({
        data: {
          companyId: auth.companyId,
          warehouseId: warehouse.id,
          actorId: auth.membershipId,
          kind,
          requestKey: input.requestKey,
          requestHash: hash,
          supplierId: entry?.supplierId,
          documentNumber: entry?.documentNumber,
          invoiceNumber: entry?.invoiceNumber,
          receivedAt: new Date(
            entry?.receivedAt ?? new Date().toISOString().slice(0, 10),
          ),
          notes: entry?.notes ?? adjust?.reason,
        },
      });
      const lines = entry?.items ?? [
        {
          productId: adjust!.productId,
          quantity: adjust!.quantity,
          unitCost: "0",
        },
      ];
      for (const line of [...lines].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      )) {
        const product = await tx.product.findFirst({
          where: {
            id: line.productId,
            companyId: auth.companyId,
            active: true,
          },
        });
        if (!product)
          throw new HttpError(400, "Livro inativo ou indisponível.");
        let delta = new Prisma.Decimal(line.quantity);
        if (adjust) {
          const balance = await tx.stockBalance.findUnique({
            where: {
              companyId_warehouseId_productId: {
                companyId: auth.companyId,
                warehouseId: warehouse.id,
                productId: product.id,
              },
            },
          });
          const before = balance?.quantity ?? new Prisma.Decimal(0);
          if (!before.equals(adjust.expectedQuantity))
            throw new HttpError(
              409,
              "O saldo mudou. Atualize a consulta e confira a contagem.",
            );
          delta = delta.minus(before);
        }
        if (delta.isZero())
          throw new HttpError(400, "A contagem informada não altera o saldo.");
        await tx.stockDocumentItem.create({
          data: {
            companyId: auth.companyId,
            documentId: document.id,
            productId: product.id,
            title: product.description,
            quantity: delta,
            unitCost: adjust ? product.cost : line.unitCost,
          },
        });
        await moveStock(tx, auth, {
          warehouseId: warehouse.id,
          productId: product.id,
          delta,
          documentId: document.id,
          reason: adjust?.reason ?? "Entrada de livros",
          type: adjust ? "ADJUSTMENT" : "IN",
        });
      }
      for (const action of ["CREATE", kind === "ENTRY" ? "CONFIRM" : "ADJUST"])
        await tx.auditLog.create({
          data: {
            companyId: auth.companyId,
            actorId: auth.membershipId,
            action,
            module: "stock",
            recordId: document.id,
            metadata: {
              branchId: warehouse.branchId,
              warehouseId: warehouse.id,
              kind,
            },
          },
        });
      return tx.stockDocument.findUniqueOrThrow({
        where: { id: document.id },
        include: { items: true, movements: true },
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
