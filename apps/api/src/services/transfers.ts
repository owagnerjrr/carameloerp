import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import {
  transferSaveSchema,
  transferOperationSchema,
} from "@caramelo/contracts";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock, moveStock } from "./stock.js";
export const transferInclude = {
  origin: { include: { branch: true } },
  destination: { include: { branch: true } },
  transit: true,
  responsible: { select: { id: true, user: { select: { name: true } } } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          description: true,
          code: true,
          isbn13: true,
          barcode: true,
        },
      },
    },
  },
} as const;
export const transferScope = (
  a: AuthContext,
): Prisma.StockTransferWhereInput => ({
  companyId: a.companyId,
  ...(a.branchId
    ? {
        OR: [
          { origin: { branchId: a.branchId } },
          { destination: { branchId: a.branchId } },
        ],
      }
    : {}),
});
export async function transferAccess(
  tx: Transaction,
  a: AuthContext,
  id: string,
) {
  const t = await tx.stockTransfer.findFirst({
    where: { ...transferScope(a), id },
    include: transferInclude,
  });
  if (!t) throw new HttpError(404, "Transferência indisponível.");
  return t;
}
export const transferPermission = {
  CREATE: "transfers:create",
  EDIT: "transfers:create",
  PREPARE: "transfers:send",
  SEND: "transfers:send",
  RECEIVE: "transfers:receive",
  RETURN: "transfers:return",
  CANCEL: "transfers:cancel",
  DIVERGENCE: "transfers:receive",
} as const;
export type TransferCommand = keyof typeof transferPermission;
export async function transferCommand(
  db: Database,
  a: AuthContext,
  kind: TransferCommand,
  id: string | null,
  raw: unknown,
) {
  if (!a.permissions.includes(transferPermission[kind]))
    throw new HttpError(403, "Operação não autorizada.");
  const input =
    kind === "CREATE" || kind === "EDIT"
      ? transferSaveSchema.parse(raw)
      : transferOperationSchema.parse(raw);
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, id, input }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":request:" + input.requestKey);
      const old = await tx.stockDocument.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
        include: { items: true, divergences: true },
      });
      if (old) {
        if (!old.transferId) throw new HttpError(409, "Chave já utilizada.");
        const previous = await transferAccess(tx, a, old.transferId);
        const branch = ["RECEIVE", "DIVERGENCE"].includes(kind)
          ? previous.destination.branchId
          : previous.origin.branchId;
        if (a.branchId && a.branchId !== branch)
          throw new HttpError(403, "Filial não autorizada para esta operação.");
        if (old.requestHash !== hash)
          throw new HttpError(409, "Chave já utilizada com outros dados.");
        return old;
      }
      if (id) await lock(tx, a.companyId + ":transfer:" + id);
      let t = id ? await transferAccess(tx, a, id) : null;
      const v = transferOperationSchema.safeParse(input);
      if (t) {
        const branch = ["RECEIVE", "DIVERGENCE"].includes(kind)
          ? t.destination.branchId
          : t.origin.branchId;
        if (a.branchId && a.branchId !== branch)
          throw new HttpError(403, "Filial não autorizada para esta operação.");
      }
      if (kind === "CREATE" || kind === "EDIT") {
        const data = transferSaveSchema.parse(input);
        const origin = await tx.warehouse.findFirst({
          where: {
            id: data.originWarehouseId,
            companyId: a.companyId,
            kind: "STANDARD",
            ...(a.branchId ? { branchId: a.branchId } : {}),
          },
        });
        const destination = await tx.warehouse.findFirst({
          where: {
            id: data.destinationWarehouseId,
            companyId: a.companyId,
            kind: "STANDARD",
          },
        });
        if (!origin || !destination)
          throw new HttpError(404, "Depósitos indisponíveis.");
        if (origin.branchId === destination.branchId)
          throw new HttpError(
            400,
            "Origem e destino devem ser filiais diferentes.",
          );
        if (
          !(await tx.membership.findFirst({
            where: {
              id: data.responsibleId,
              companyId: a.companyId,
              active: true,
              user: { active: true },
              OR: [{ branchId: null }, { branchId: origin.branchId }],
            },
          }))
        )
          throw new HttpError(400, "Responsável indisponível para a origem.");
        if (
          (await tx.product.count({
            where: {
              id: { in: data.items.map((i) => i.productId) },
              companyId: a.companyId,
              active: true,
            },
          })) !== data.items.length
        )
          throw new HttpError(400, "Produto inativo ou de outra empresa.");
        if (t) {
          if (
            t.status !== "DRAFT" ||
            t.originWarehouseId !== origin.id ||
            t.destinationWarehouseId !== destination.id
          )
            throw new HttpError(
              409,
              "Somente rascunhos podem ser editados, preservando origem e destino.",
            );
          await tx.stockTransferItem.deleteMany({
            where: { companyId: a.companyId, transferId: t.id },
          });
          await tx.stockTransfer.update({
            where: { id: t.id },
            data: {
              responsibleId: data.responsibleId,
              notes: data.notes,
            },
          });
        } else {
          await lock(tx, a.companyId + ":transfer-number");
          const n = await tx.stockTransfer.count({
            where: { companyId: a.companyId },
          });
          const code = "TRF-" + String(n + 1).padStart(8, "0");
          const transit = await tx.warehouse.create({
            data: {
              companyId: a.companyId,
              branchId: origin.branchId,
              kind: "TRANSFER_TRANSIT",
              name: code + " — Em trânsito",
            },
          });
          const created = await tx.stockTransfer.create({
            data: {
              companyId: a.companyId,
              code,
              originWarehouseId: origin.id,
              destinationWarehouseId: destination.id,
              transitWarehouseId: transit.id,
              responsibleId: data.responsibleId,
              notes: data.notes,
            },
          });
          id = created.id;
        }
        await tx.stockTransferItem.createMany({
          data: data.items.map((i) => ({
            ...i,
            companyId: a.companyId,
            transferId: id!,
          })),
        });
        t = await transferAccess(tx, a, id!);
      }
      if (!t) throw new HttpError(404, "Transferência indisponível.");
      if (["RECEIVED", "CLOSED_RETURNED", "CANCELLED"].includes(t.status))
        throw new HttpError(409, "Transferência encerrada.");
      const op = v.success ? v.data : null;
      if (!["CREATE", "EDIT"].includes(kind) && !op)
        throw new HttpError(400, "Operação inválida.");
      if (op && !["RECEIVE", "RETURN"].includes(kind) && op.items)
        throw new HttpError(400, "Itens não permitidos nesta operação.");
      if (op && kind !== "DIVERGENCE" && op.divergence)
        throw new HttpError(400, "Use o registro de divergência.");
      const allowed: Partial<Record<TransferCommand, string[]>> = {
        PREPARE: ["DRAFT"],
        SEND: ["READY"],
        CANCEL: ["DRAFT", "READY"],
        RECEIVE: ["IN_TRANSIT", "PARTIALLY_RECEIVED"],
        RETURN: ["IN_TRANSIT", "PARTIALLY_RECEIVED"],
        DIVERGENCE: ["IN_TRANSIT", "PARTIALLY_RECEIVED"],
      };
      if (allowed[kind] && !allowed[kind]!.includes(t.status))
        throw new HttpError(409, "Transição inválida.");
      if (["CANCEL", "RETURN"].includes(kind) && op!.notes.length < 8)
        throw new HttpError(
          400,
          "Informe justificativa com pelo menos 8 caracteres.",
        );
      if (kind === "DIVERGENCE" && !op!.divergence)
        throw new HttpError(400, "Informe a divergência.");
      let lines =
        kind === "CREATE" || kind === "EDIT" || kind === "SEND"
          ? t.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            }))
          : (op?.items ?? []);
      if (["RECEIVE", "RETURN"].includes(kind) && !lines.length)
        throw new HttpError(400, "Informe quantidades conferidas.");
      for (const l of lines) {
        const item = t.items.find((i) => i.productId === l.productId);
        if (!item)
          throw new HttpError(
            400,
            "ISBN/produto inesperado. Registre uma divergência.",
          );
        if (
          ["RECEIVE", "RETURN"].includes(kind) &&
          l.quantity > item.quantity - item.received - item.returned
        )
          throw new HttpError(409, "Quantidade acima do saldo em trânsito.");
      }
      if (
        kind === "RECEIVE" &&
        t.items.some(
          (i) =>
            (lines.find((l) => l.productId === i.productId)?.quantity ?? 0) <
            i.quantity - i.received - i.returned,
        ) &&
        op!.notes.length < 8
      )
        throw new HttpError(
          400,
          "Recebimento parcial/divergente exige justificativa.",
        );
      const from = kind === "SEND" ? t.originWarehouseId : t.transitWarehouseId,
        to =
          kind === "RECEIVE"
            ? t.destinationWarehouseId
            : kind === "RETURN"
              ? t.originWarehouseId
              : t.transitWarehouseId;
      const moving = ["SEND", "RECEIVE", "RETURN"].includes(kind);
      if (moving)
        for (const w of [from, to].sort())
          await lock(tx, a.companyId + ":warehouse:" + w);
      if (
        kind === "SEND" &&
        (await tx.product.count({
          where: {
            companyId: a.companyId,
            id: { in: lines.map((l) => l.productId) },
            active: true,
          },
        })) !== lines.length
      )
        throw new HttpError(409, "Há produto inativo na transferência.");
      const doc = await tx.stockDocument.create({
        data: {
          companyId: a.companyId,
          warehouseId:
            kind === "RECEIVE" ? t.destinationWarehouseId : t.originWarehouseId,
          actorId: a.membershipId,
          transferId: t.id,
          kind: "TRANSFER_" + kind,
          requestKey: input.requestKey,
          requestHash: hash,
          documentNumber: t.code,
          receivedAt: new Date(
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Sao_Paulo",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
          ),
          notes: input.notes,
        },
      });
      lines = [...lines].sort((a, b) => a.productId.localeCompare(b.productId));
      for (const l of lines) {
        const product = await tx.product.findUniqueOrThrow({
          where: { companyId_id: { companyId: a.companyId, id: l.productId } },
        });
        await tx.stockDocumentItem.create({
          data: {
            companyId: a.companyId,
            documentId: doc.id,
            productId: l.productId,
            title: product.description,
            quantity: l.quantity,
            unitCost: product.cost,
          },
        });
        if (moving) {
          await moveStock(tx, a, {
            warehouseId: from,
            productId: l.productId,
            delta: new Prisma.Decimal(-l.quantity),
            documentId: doc.id,
            reason: t.code + " " + kind,
            type: "TRANSFER",
            transferGroup: doc.id,
          });
          await moveStock(tx, a, {
            warehouseId: to,
            productId: l.productId,
            delta: new Prisma.Decimal(l.quantity),
            documentId: doc.id,
            reason: t.code + " " + kind,
            type: "TRANSFER",
            transferGroup: doc.id,
          });
        }
        if (kind === "RECEIVE" || kind === "RETURN")
          await tx.stockTransferItem.update({
            where: {
              companyId_transferId_productId: {
                companyId: a.companyId,
                transferId: t.id,
                productId: l.productId,
              },
            },
            data:
              kind === "RECEIVE"
                ? { received: { increment: l.quantity } }
                : { returned: { increment: l.quantity } },
          });
      }
      if (kind === "RECEIVE")
        for (const i of t.items) {
          const expected = i.quantity - i.received - i.returned,
            observed =
              lines.find((l) => l.productId === i.productId)?.quantity ?? 0;
          if (observed < expected)
            await tx.transferDivergence.create({
              data: {
                companyId: a.companyId,
                documentId: doc.id,
                code: i.product.code,
                kind: "MISSING",
                expected,
                observed,
                reason: op!.notes,
              },
            });
        }
      if (kind === "DIVERGENCE")
        await tx.transferDivergence.create({
          data: {
            companyId: a.companyId,
            documentId: doc.id,
            ...op!.divergence!,
          },
        });
      let status = t.status;
      if (kind === "PREPARE") status = "READY";
      if (kind === "SEND") status = "IN_TRANSIT";
      if (kind === "CANCEL") status = "CANCELLED";
      if (kind === "RECEIVE" || kind === "RETURN") {
        const items = await tx.stockTransferItem.findMany({
          where: { companyId: a.companyId, transferId: t.id },
        });
        status = items.every((i) => i.received + i.returned === i.quantity)
          ? items.some((i) => i.returned > 0)
            ? "CLOSED_RETURNED"
            : "RECEIVED"
          : items.some((i) => i.received > 0)
            ? "PARTIALLY_RECEIVED"
            : "IN_TRANSIT";
      }
      await tx.stockTransfer.update({ where: { id: t.id }, data: { status } });
      const divergences = await tx.transferDivergence.findMany({
        where: { companyId: a.companyId, documentId: doc.id },
      });
      for (const action of [
        "TRANSFER_" + kind,
        ...(divergences.length && kind !== "DIVERGENCE"
          ? ["TRANSFER_DIVERGENCE"]
          : []),
        ...(kind === "RECEIVE" && status === "PARTIALLY_RECEIVED"
          ? ["TRANSFER_PARTIALLY_RECEIVED"]
          : []),
        ...(["RECEIVED", "CLOSED_RETURNED"].includes(status)
          ? ["TRANSFER_CLOSED"]
          : []),
      ])
        await tx.auditLog.create({
          data: {
            companyId: a.companyId,
            actorId: a.membershipId,
            module: "transfers",
            action,
            recordId: t.id,
            metadata: {
              documentId: doc.id,
              originBranchId: t.origin.branchId,
              destinationBranchId: t.destination.branchId,
              status,
              lines,
              divergenceIds: divergences.map((d) => d.id),
            },
          },
        });
      return tx.stockDocument.findUniqueOrThrow({
        where: { id: doc.id },
        include: { items: true, divergences: true },
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
