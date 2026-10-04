import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import {
  inventoryOperationSchema,
  inventorySaveSchema,
  identifier,
} from "@caramelo/contracts";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock, moveStock, warehouseAccess } from "./stock.js";

export const inventoryPermission = {
  CREATE: "inventory:create",
  EDIT: "inventory:create",
  START: "inventory:count",
  COUNT: "inventory:count",
  COMPLETE: "inventory:count",
  RESTART: "inventory:count",
  RECOUNT: "inventory:review",
  JUSTIFY: "inventory:review",
  APPROVE: "inventory:approve",
  CLOSE: "inventory:close",
  CANCEL: "inventory:cancel",
} as const;
export type InventoryCommand = keyof typeof inventoryPermission;
export const inventoryInclude = {
  warehouse: { select: { name: true } },
  branch: { select: { name: true } },
  responsible: { select: { user: { select: { name: true } } } },
  approver: { select: { user: { select: { name: true } } } },
  items: {
    include: {
      counts: {
        include: { actor: { select: { user: { select: { name: true } } } } },
        orderBy: { round: "asc" as const },
      },
    },
    orderBy: { title: "asc" as const },
  },
} as const;
export function inventoryScope(a: AuthContext) {
  return {
    companyId: a.companyId,
    ...(a.branchId ? { branchId: a.branchId } : {}),
  };
}
export async function inventoryAccess(
  tx: Transaction,
  a: AuthContext,
  id: string,
) {
  const v = await tx.inventory.findFirst({
    where: { ...inventoryScope(a), id },
    include: inventoryInclude,
  });
  if (!v) throw new HttpError(404, "Inventário indisponível.");
  await warehouseAccess(tx, a, v.warehouseId);
  return v;
}
export function inventoryView(
  v: Awaited<ReturnType<typeof inventoryAccess>>,
  a: AuthContext,
) {
  const review = a.permissions.includes("inventory:review");
  const items = v.items.map((item) => {
    const current = item.counts.find((c) => c.round === item.currentRound);
    const hidden =
      !review && (v.blind || (v.blindRecount && item.currentRound > 1));
    return {
      id: item.id,
      productId: item.productId,
      title: item.title,
      isbn: item.isbn,
      sku: item.sku,
      currentRound: item.currentRound,
      countedQuantity: current?.quantity ?? null,
      accepted: !!current?.acceptedAt,
      ...(hidden
        ? {}
        : {
            systemQuantity: item.systemQuantity,
            unitCost: item.unitCost,
            referenceQuantity: current?.referenceQuantity ?? null,
            difference: current
              ? new Prisma.Decimal(current.quantity).minus(item.systemQuantity)
              : null,
            adjustment: current
              ? new Prisma.Decimal(current.quantity).minus(
                  current.referenceQuantity,
                )
              : null,
            reason: item.reason,
            justification: item.justification,
          }),
      counts: hidden
        ? current
          ? [
              {
                round: current.round,
                quantity: current.quantity,
                source: current.source,
                updatedAt: current.updatedAt,
                actor: current.actor,
              },
            ]
          : []
        : item.counts,
    };
  });
  return { ...v, items };
}
async function stockReference(
  tx: Transaction,
  a: AuthContext,
  w: string,
  p: string,
) {
  const balance = await tx.stockBalance.findUnique({
    where: {
      companyId_warehouseId_productId: {
        companyId: a.companyId,
        warehouseId: w,
        productId: p,
      },
    },
  });
  const movementCount = await tx.stockMovement.count({
    where: { companyId: a.companyId, warehouseId: w, productId: p },
  });
  return {
    referenceQuantity: balance?.quantity ?? new Prisma.Decimal(0),
    movementCount,
  };
}
export async function inventoryCommand(
  db: Database,
  a: AuthContext,
  kind: InventoryCommand,
  id: string | null,
  raw: unknown,
) {
  if (!a.permissions.includes(inventoryPermission[kind]))
    throw new HttpError(403, "Operação não autorizada.");
  const input =
    kind === "CREATE" || kind === "EDIT"
      ? inventorySaveSchema.parse(raw)
      : inventoryOperationSchema.parse(raw);
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, id, input }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":inventory-request:" + input.requestKey);
      const old = await tx.inventoryAction.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
      });
      if (old) {
        await inventoryAccess(tx, a, old.inventoryId);
        if (old.requestHash !== hash)
          throw new HttpError(409, "Chave já utilizada com outros dados.");
        return old.result;
      }
      if (id) await lock(tx, a.companyId + ":inventory:" + id);
      let v = id ? await inventoryAccess(tx, a, id) : null;
      const before = v?.status ?? null;
      if (v && ["CLOSED", "CANCELLED"].includes(v.status))
        throw new HttpError(409, "Inventário encerrado ou cancelado.");
      const op = inventoryOperationSchema.safeParse(input);
      const notes = op.success ? op.data.notes : "";
      let documentId: string | undefined;
      let productId: string | undefined;
      let countAudit: Prisma.InputJsonObject = {};
      if (kind === "CREATE" || kind === "EDIT") {
        const data = inventorySaveSchema.parse(input);
        const w = await warehouseAccess(tx, a, data.warehouseId);
        if (v && (v.status !== "DRAFT" || v.warehouseId !== w.id))
          throw new HttpError(
            409,
            "Edite somente o rascunho, sem mudar o depósito.",
          );
        const member = await tx.membership.findFirst({
          where: {
            companyId: a.companyId,
            id: data.responsibleId,
            active: true,
            user: { active: true },
            OR: [{ branchId: null }, { branchId: w.branchId }],
          },
        });
        if (!member) throw new HttpError(400, "Responsável indisponível.");
        if (
          data.scope === "PARTIAL" &&
          (await tx.product.count({
            where: { companyId: a.companyId, id: { in: data.productIds } },
          })) !== data.productIds.length
        )
          throw new HttpError(400, "Livros indisponíveis.");
        const fields = {
          description: data.description,
          responsibleId: data.responsibleId,
          scope: data.scope,
          selectedIds: data.scope === "PARTIAL" ? data.productIds : [],
          blind: data.blind,
          blindRecount: data.blindRecount,
          scheduledAt: new Date(data.scheduledAt),
        };
        if (v) await tx.inventory.update({ where: { id: v.id }, data: fields });
        else {
          await lock(tx, a.companyId + ":inventory-number");
          const n = await tx.inventory.count({
            where: { companyId: a.companyId },
          });
          const created = await tx.inventory.create({
            data: {
              ...fields,
              companyId: a.companyId,
              branchId: w.branchId,
              warehouseId: w.id,
              code: "INV-" + String(n + 1).padStart(6, "0"),
            },
          });
          v = await inventoryAccess(tx, a, created.id);
        }
      } else {
        if (!v || !op.success) throw new HttpError(400, "Operação inválida.");
        const data = op.data;
        await lock(tx, a.companyId + ":warehouse:" + v.warehouseId);
        if (kind === "START") {
          if (v.status !== "DRAFT")
            throw new HttpError(409, "Inventário já iniciado.");
          if (
            await tx.inventory.count({
              where: {
                companyId: a.companyId,
                warehouseId: v.warehouseId,
                status: {
                  in: [
                    "COUNTING",
                    "RECOUNT_REQUIRED",
                    "UNDER_REVIEW",
                    "APPROVED",
                  ],
                },
              },
            })
          )
            throw new HttpError(
              409,
              "Já existe inventário ativo neste depósito.",
            );
          const ids = v.selectedIds as string[];
          const products = await tx.product.findMany({
            where: {
              companyId: a.companyId,
              ...(v.scope === "PARTIAL" ? { id: { in: ids } } : {}),
            },
            orderBy: { id: "asc" },
          });
          if (!products.length)
            throw new HttpError(409, "Nenhum livro no escopo.");
          const balances = await tx.stockBalance.findMany({
            where: { companyId: a.companyId, warehouseId: v.warehouseId },
          });
          const quantities = new Map(
            balances.map((b) => [b.productId, b.quantity]),
          );
          const inventoryId = v.id;
          for (let offset = 0; offset < products.length; offset += 1000) {
            await tx.inventoryItem.createMany({
              data: products.slice(offset, offset + 1000).map((p) => ({
                companyId: a.companyId,
                inventoryId,
                productId: p.id,
                title: p.description,
                sku: p.code,
                isbn: p.isbn13,
                unitCost: p.cost,
                systemQuantity: quantities.get(p.id) ?? new Prisma.Decimal(0),
              })),
            });
          }
          await tx.inventory.update({
            where: { id: v.id },
            data: { status: "COUNTING", startedAt: new Date() },
          });
        } else if (kind === "COUNT") {
          if (!["COUNTING", "RECOUNT_REQUIRED"].includes(v.status))
            throw new HttpError(409, "Contagem indisponível nesta etapa.");
          if (
            data.quantity === undefined ||
            !data.mode ||
            (!data.productId && !data.code)
          )
            throw new HttpError(400, "Informe livro e quantidade.");
          const p = await tx.product.findFirst({
            where: {
              companyId: a.companyId,
              ...(data.code
                ? { identifiers: { some: { value: identifier(data.code) } } }
                : { id: data.productId }),
            },
          });
          if (!p) throw new HttpError(404, "Código/livro não encontrado.");
          productId = p.id;
          const item = v.items.find((x) => x.productId === p.id);
          if (!item)
            throw new HttpError(
              409,
              "Livro fora do escopo. Edite o rascunho antes de iniciar.",
            );
          const current = item.counts.find(
            (c) => c.round === item.currentRound,
          );
          if (current?.acceptedAt)
            throw new HttpError(409, "Rodada concluída. Solicite recontagem.");
          const qty =
            data.mode === "ADD"
              ? (current?.quantity ?? 0) + data.quantity
              : data.quantity;
          countAudit = {
            quantityBefore: current?.quantity ?? null,
            quantityAfter: qty,
            round: item.currentRound,
            source: data.source,
          };
          if (qty > 1000000)
            throw new HttpError(400, "Quantidade fora do limite.");
          if (current)
            await tx.inventoryCount.update({
              where: { id: current.id },
              data: {
                quantity: qty,
                actorId: a.membershipId,
                source: data.source,
                notes,
              },
            });
          else {
            const ref = await stockReference(tx, a, v.warehouseId, p.id);
            await tx.inventoryCount.create({
              data: {
                companyId: a.companyId,
                itemId: item.id,
                round: item.currentRound,
                actorId: a.membershipId,
                quantity: qty,
                source: data.source,
                notes,
                ...ref,
              },
            });
          }
        } else if (kind === "COMPLETE") {
          if (!["COUNTING", "RECOUNT_REQUIRED"].includes(v.status))
            throw new HttpError(409, "Etapa de contagem indisponível.");
          for (const item of v.items) {
            const c = item.counts.find((x) => x.round === item.currentRound);
            if (!c)
              throw new HttpError(
                409,
                "Existem livros não contados. Confirme zero quando aplicável.",
              );
            if (c.acceptedAt) continue;
            const ref = await stockReference(
              tx,
              a,
              v.warehouseId,
              item.productId,
            );
            if (
              ref.movementCount !== c.movementCount ||
              !ref.referenceQuantity.equals(c.referenceQuantity)
            )
              throw new HttpError(
                409,
                "Livro movimentado durante a rodada: " +
                  item.title +
                  ". Reinicie sua contagem.",
              );
            await tx.inventoryCount.update({
              where: { id: c.id },
              data: { acceptedAt: new Date() },
            });
          }
          await tx.inventory.update({
            where: { id: v.id },
            data: { status: "UNDER_REVIEW" },
          });
        } else if (kind === "RECOUNT" || kind === "RESTART") {
          const allowed =
            kind === "RECOUNT"
              ? ["UNDER_REVIEW", "APPROVED"]
              : ["COUNTING", "RECOUNT_REQUIRED"];
          if (
            !allowed.includes(v.status) ||
            !data.productIds?.length ||
            notes.length < 3
          )
            throw new HttpError(
              409,
              "Informe itens e motivo para a nova rodada.",
            );
          for (const p of data.productIds) {
            const item = v.items.find((x) => x.productId === p);
            if (!item) throw new HttpError(400, "Livro fora do inventário.");
            if (
              kind === "RESTART" &&
              item.counts.some(
                (c) => c.round === item.currentRound && c.acceptedAt,
              )
            )
              throw new HttpError(409, "Rodada aceita exige revisão.");
            await tx.inventoryItem.update({
              where: { id: item.id },
              data: {
                currentRound: { increment: 1 },
                reason: null,
                justification: null,
              },
            });
          }
          await tx.inventory.update({
            where: { id: v.id },
            data: {
              status: "RECOUNT_REQUIRED",
              approvedById: null,
              approvedAt: null,
            },
          });
        } else if (kind === "JUSTIFY") {
          if (
            v.status !== "UNDER_REVIEW" ||
            !data.productId ||
            !data.reason ||
            (data.reason === "OTHER" && notes.length < 3)
          )
            throw new HttpError(
              400,
              "Informe item, motivo e descrição para Outro durante a revisão.",
            );
          const item = v.items.find((x) => x.productId === data.productId);
          if (!item) throw new HttpError(400, "Livro fora do inventário.");
          productId = item.productId;
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: { reason: data.reason, justification: notes },
          });
        } else if (kind === "APPROVE") {
          if (v.status !== "UNDER_REVIEW")
            throw new HttpError(409, "Inventário não está em revisão.");
          for (const item of v.items) {
            const c = item.counts.find((x) => x.round === item.currentRound);
            if (!c?.acceptedAt)
              throw new HttpError(409, "Rodada não concluída.");
            if (
              (!new Prisma.Decimal(c.quantity).equals(c.referenceQuantity) ||
                !new Prisma.Decimal(c.quantity).equals(item.systemQuantity)) &&
              !item.reason
            )
              throw new HttpError(
                409,
                "Justifique todas as diferenças antes de aprovar.",
              );
          }
          await tx.inventory.update({
            where: { id: v.id },
            data: {
              status: "APPROVED",
              approvedById: a.membershipId,
              approvedAt: new Date(),
            },
          });
        } else if (kind === "CLOSE") {
          if (v.status !== "APPROVED")
            throw new HttpError(
              409,
              "Aprovação obrigatória antes do fechamento.",
            );
          const doc = await tx.stockDocument.create({
            data: {
              companyId: a.companyId,
              warehouseId: v.warehouseId,
              actorId: a.membershipId,
              inventoryId: v.id,
              kind: "INVENTORY_ADJUSTMENT",
              requestKey: input.requestKey,
              requestHash: hash,
              documentNumber: v.code,
              receivedAt: new Date(new Date().toISOString().slice(0, 10)),
              notes,
            },
          });
          documentId = doc.id;
          for (const item of [...v.items].sort((x, y) =>
            x.productId.localeCompare(y.productId),
          )) {
            const c = item.counts.find((x) => x.round === item.currentRound);
            if (!c?.acceptedAt)
              throw new HttpError(409, "Contagem não aprovada.");
            const delta = new Prisma.Decimal(c.quantity).minus(
              c.referenceQuantity,
            );
            if (delta.isZero()) continue;
            await tx.stockDocumentItem.create({
              data: {
                companyId: a.companyId,
                documentId: doc.id,
                productId: item.productId,
                title: item.title,
                quantity: delta,
                unitCost: item.unitCost,
              },
            });
            await moveStock(tx, a, {
              warehouseId: v.warehouseId,
              productId: item.productId,
              delta,
              type: "ADJUSTMENT",
              documentId: doc.id,
              reason: `${v.code} / item ${item.id} / rodada ${c.round} / ${item.reason}: ${item.justification ?? ""}`,
            });
          }
          await tx.inventory.update({
            where: { id: v.id },
            data: { status: "CLOSED", closedAt: new Date() },
          });
        } else if (kind === "CANCEL") {
          if (notes.length < 8)
            throw new HttpError(
              400,
              "Informe motivo de pelo menos 8 caracteres.",
            );
          await tx.inventory.update({
            where: { id: v.id },
            data: {
              status: "CANCELLED",
              cancelledAt: new Date(),
              cancelReason: notes,
            },
          });
        }
      }
      if (!v) throw new HttpError(400, "Inventário indisponível.");
      const state = await tx.inventory.findUniqueOrThrow({
        where: { id: v.id },
      });
      const result = {
        inventoryId: v.id,
        status: state.status,
        ...(documentId ? { documentId } : {}),
        ...(productId ? { productId } : {}),
      };
      await tx.inventoryAction.create({
        data: {
          companyId: a.companyId,
          inventoryId: v.id,
          actorId: a.membershipId,
          kind,
          requestKey: input.requestKey,
          requestHash: hash,
          result,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: a.companyId,
          actorId: a.membershipId,
          module: "inventory",
          recordId: v.id,
          action: kind,
          metadata: {
            branchId: state.branchId,
            warehouseId: state.warehouseId,
            before,
            status: state.status,
            productId: productId ?? null,
            documentId: documentId ?? null,
            notes,
            ...countAudit,
            ...(op.success
              ? {
                  productIds: op.data.productIds ?? [],
                  reason: op.data.reason ?? null,
                }
              : {}),
          },
        },
      });
      return result;
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
