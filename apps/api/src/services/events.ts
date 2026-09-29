import { createHash } from "node:crypto";
import { Prisma, type Database } from "@caramelo/database";
import {
  eventSaveSchema,
  eventMoveSchema,
  eventReceiveSchema,
  eventTransitionSchema,
} from "@caramelo/contracts";
import type { z } from "zod";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock, moveStock, warehouseAccess } from "./stock.js";
const include = {
  items: true,
  actor: { select: { user: { select: { name: true } } } },
  warehouse: { select: { name: true } },
  receipts: { include: { items: true } },
} satisfies Prisma.EventDocumentInclude;
export async function eventAccess(tx: Transaction, a: AuthContext, id: string) {
  const event = await tx.event.findFirst({
    where: {
      id,
      companyId: a.companyId,
      ...(a.branchId ? { branchId: a.branchId } : {}),
    },
  });
  if (!event) throw new HttpError(404, "Evento indisponível.");
  return event;
}
async function number(tx: Transaction, a: AuthContext, prefix: string) {
  await lock(tx, a.companyId + ":event-number");
  const year = new Date().getUTCFullYear(),
    start = prefix + "-" + year + "-";
  const last =
    prefix === "FEIRA"
      ? await tx.event.findFirst({
          where: { companyId: a.companyId, code: { startsWith: start } },
          orderBy: { code: "desc" },
        })
      : await tx.eventDocument.findFirst({
          where: { companyId: a.companyId, code: { startsWith: start } },
          orderBy: { code: "desc" },
        });
  const n = last ? Number(last.code.split("-").at(-1)) + 1 : 1;
  if (n > 99999)
    throw new HttpError(409, "Limite anual de numeração atingido.");
  return start + String(n).padStart(5, "0");
}
type Save = z.infer<typeof eventSaveSchema>;
type Move = z.infer<typeof eventMoveSchema>;
type Receive = z.infer<typeof eventReceiveSchema>;
type Transition = z.infer<typeof eventTransitionSchema>;
export async function eventCommand(
  db: Database,
  a: AuthContext,
  kind: "CREATE" | "UPDATE" | "DISPATCH" | "RECEIVE" | "RETURN" | "STATE",
  id: string | null,
  input: Save | Move | Receive | Transition,
) {
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, id, input }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lock(tx, a.companyId + ":event-request:" + input.requestKey);
      const old = await tx.eventDocument.findUnique({
        where: {
          companyId_requestKey: {
            companyId: a.companyId,
            requestKey: input.requestKey,
          },
        },
        include,
      });
      if (old) {
        await eventAccess(tx, a, old.eventId);
        if (old.requestHash !== hash)
          throw new HttpError(409, "Chave já utilizada com outros dados.");
        return old;
      }
      if (id) await lock(tx, a.companyId + ":event:" + id);
      let event = id ? await eventAccess(tx, a, id) : null;
      let action = kind as string,
        warehouseId: string | undefined,
        dispatchId: string | undefined;
      const lines: Array<{
        productId: string;
        quantity: number;
        expectedQuantity?: number;
      }> = [];
      let from: string | undefined, to: string | undefined;
      if (kind === "CREATE" || kind === "UPDATE") {
        const data = (input as Save).event;
        if (a.branchId && a.branchId !== data.branchId)
          throw new HttpError(403, "Filial não autorizada.");
        if (
          !(await tx.branch.findFirst({
            where: { id: data.branchId, companyId: a.companyId },
          }))
        )
          throw new HttpError(400, "Filial indisponível.");
        if (
          !(await tx.membership.findFirst({
            where: {
              id: data.responsibleId,
              companyId: a.companyId,
              active: true,
              user: { active: true },
              OR: [{ branchId: null }, { branchId: data.branchId }],
            },
          }))
        )
          throw new HttpError(
            400,
            "Responsável indisponível para esta filial.",
          );
        const dates = {
          startsAt: new Date(data.startsAt),
          endsAt: new Date(data.endsAt),
        };
        if (event) {
          if (
            !["DRAFT", "PREPARING"].includes(event.status) ||
            event.branchId !== data.branchId
          )
            throw new HttpError(
              409,
              "Cadastro só pode ser editado antes do envio, sem mudar a filial.",
            );
          event = await tx.event.update({
            where: { id: event.id },
            data: { ...data, ...dates },
          });
        } else {
          const code = await number(tx, a, "FEIRA");
          const w = await tx.warehouse.create({
            data: {
              companyId: a.companyId,
              branchId: data.branchId,
              name: code + " — " + data.name,
              kind: "EVENT",
            },
          });
          const transit = await tx.warehouse.create({
            data: {
              companyId: a.companyId,
              branchId: data.branchId,
              name: code + " — Em trânsito",
              kind: "EVENT_TRANSIT",
            },
          });
          event = await tx.event.create({
            data: {
              ...data,
              ...dates,
              companyId: a.companyId,
              code,
              warehouseId: w.id,
              transitWarehouseId: transit.id,
            },
          });
        }
      } else {
        if (!event) throw new HttpError(404, "Evento indisponível.");
        if (["CLOSED", "CANCELLED"].includes(event.status))
          throw new HttpError(409, "Evento encerrado ou cancelado.");
        if (kind === "STATE") {
          const state = (input as Transition).action;
          action = state;
          const allowed: Record<string, string[]> = {
            PREPARE: ["DRAFT"],
            CLOSING: ["OPEN"],
            CLOSE: ["CLOSING"],
            CANCEL: ["DRAFT", "PREPARING"],
          };
          if (!allowed[state]!.includes(event.status))
            throw new HttpError(409, "Mudança de status inválida.");
          if (
            state === "CANCEL" &&
            (input as Transition).notes.trim().length < 8
          )
            throw new HttpError(400, "Justifique o cancelamento.");
          if (state === "CLOSE") {
            if (
              (await tx.stockBalance.count({
                where: {
                  companyId: a.companyId,
                  warehouseId: {
                    in: [event.warehouseId, event.transitWarehouseId],
                  },
                  quantity: { not: 0 },
                },
              })) ||
              (await tx.eventDocument.count({
                where: {
                  eventId: event.id,
                  companyId: a.companyId,
                  kind: "DISPATCH",
                  status: { not: "RECEIVED" },
                },
              }))
            )
              throw new HttpError(
                409,
                "Retorne o estoque e resolva os envios em trânsito antes de encerrar.",
              );
          }
          const next = {
            PREPARE: "PREPARING",
            CLOSING: "CLOSING",
            CLOSE: "CLOSED",
            CANCEL: "CANCELLED",
          }[state];
          event = await tx.event.update({
            where: { id: event.id },
            data: { status: next },
          });
        } else if (kind === "DISPATCH" || kind === "RETURN") {
          const data = input as Move;
          if (
            !(
              kind === "DISPATCH"
                ? ["PREPARING", "IN_TRANSIT", "OPEN"]
                : ["OPEN", "CLOSING"]
            ).includes(event.status)
          )
            throw new HttpError(
              409,
              "Operação incompatível com o status do evento.",
            );
          const w = await warehouseAccess(tx, a, data.warehouseId);
          if (w.branchId !== event.branchId)
            throw new HttpError(
              400,
              "Depósito deve pertencer à filial do evento.",
            );
          warehouseId = w.id;
          lines.push(...data.items);
          from = kind === "DISPATCH" ? w.id : event.warehouseId;
          to = kind === "DISPATCH" ? event.transitWarehouseId : w.id;
          event = await tx.event.update({
            where: { id: event.id },
            data: {
              status:
                kind === "RETURN"
                  ? "CLOSING"
                  : event.status === "OPEN"
                    ? "OPEN"
                    : "IN_TRANSIT",
            },
          });
        } else if (kind === "RECEIVE") {
          if (!["IN_TRANSIT", "OPEN", "CLOSING"].includes(event.status))
            throw new HttpError(409, "Evento não admite recebimento.");
          const data = input as Receive;
          const dispatch = await tx.eventDocument.findFirst({
            where: {
              id: data.dispatchId,
              eventId: event.id,
              companyId: a.companyId,
              kind: "DISPATCH",
            },
            include: { items: true, receipts: { include: { items: true } } },
          });
          if (!dispatch || dispatch.status === "RECEIVED")
            throw new HttpError(409, "Envio indisponível ou já recebido.");
          if (
            data.items.length !== dispatch.items.length ||
            data.items.some(
              (i) => !dispatch.items.some((d) => d.productId === i.productId),
            )
          )
            throw new HttpError(400, "Confira todos os itens do envio.");
          let remaining = 0,
            divergence = false;
          for (const item of dispatch.items) {
            const received = dispatch.receipts.reduce(
              (n, r) =>
                n +
                (r.items.find((i) => i.productId === item.productId)
                  ?.quantity ?? 0),
              0,
            );
            const expected = item.quantity - received,
              quantity = data.items.find(
                (i) => i.productId === item.productId,
              )!.quantity;
            if (quantity > expected)
              throw new HttpError(
                409,
                "Recebimento acima do enviado pendente.",
              );
            if (quantity !== expected) divergence = true;
            remaining += expected - quantity;
            lines.push({
              productId: item.productId,
              quantity,
              expectedQuantity: expected,
            });
          }
          if (divergence && data.notes.trim().length < 8)
            throw new HttpError(
              400,
              "Justifique a divergência de recebimento (mínimo 8 caracteres).",
            );
          if (!lines.some((l) => l.quantity > 0) && dispatch.receipts.length)
            throw new HttpError(
              409,
              "Recebimento complementar deve conferir alguma unidade.",
            );
          dispatchId = dispatch.id;
          from = event.transitWarehouseId;
          to = event.warehouseId;
          await tx.eventDocument.update({
            where: { id: dispatch.id },
            data: { status: remaining ? "PARTIAL" : "RECEIVED" },
          });
          event = await tx.event.update({
            where: { id: event.id },
            data: {
              status:
                event.status === "CLOSING"
                  ? "CLOSING"
                  : lines.some((l) => l.quantity > 0)
                    ? "OPEN"
                    : event.status,
            },
          });
        }
      }
      if (!event) throw new HttpError(404, "Evento indisponível.");
      if (from && to)
        for (const w of [from, to].sort())
          await lock(tx, a.companyId + ":warehouse:" + w);
      const code = await number(
        tx,
        a,
        kind === "DISPATCH"
          ? "ENV"
          : kind === "RECEIVE"
            ? "REC"
            : kind === "RETURN"
              ? "RET"
              : "EVT",
      );
      const notes =
        "notes" in input ? input.notes : (input as Save).event.notes;
      const doc = await tx.eventDocument.create({
        data: {
          companyId: a.companyId,
          eventId: event.id,
          actorId: a.membershipId,
          warehouseId,
          dispatchId,
          code,
          kind: action,
          status: kind === "DISPATCH" ? "SENT" : "CONFIRMED",
          notes,
          requestKey: input.requestKey,
          requestHash: hash,
        },
      });
      for (const line of [...lines].sort((x, y) =>
        x.productId.localeCompare(y.productId),
      )) {
        const p = await tx.product.findFirst({
          where: {
            id: line.productId,
            companyId: a.companyId,
            ...(kind === "DISPATCH" ? { active: true } : {}),
          },
        });
        if (!p) throw new HttpError(400, "Livro indisponível.");
        await tx.eventDocumentItem.create({
          data: {
            ...line,
            companyId: a.companyId,
            documentId: doc.id,
            title: p.description,
            isbn: p.isbn13 ?? p.isbn10 ?? p.barcode,
            author: p.author,
            publisher: p.publisher,
          },
        });
        if (line.quantity && from && to) {
          await moveStock(tx, a, {
            warehouseId: from,
            productId: p.id,
            delta: new Prisma.Decimal(-line.quantity),
            eventDocumentId: doc.id,
            type: "OUT",
            reason: code + " — " + event.code,
          });
          await moveStock(tx, a, {
            warehouseId: to,
            productId: p.id,
            delta: new Prisma.Decimal(line.quantity),
            eventDocumentId: doc.id,
            type: "IN",
            reason: code + " — " + event.code,
          });
        }
      }
      const actions: Record<string, string> = {
        CREATE: "CREATED",
        UPDATE: "UPDATED",
        DISPATCH: "DISPATCHED",
        RECEIVE: "RECEIVED",
        RETURN: "RETURNED",
        PREPARE: "PREPARING",
        CLOSING: "CLOSING",
        CLOSE: "CLOSED",
        CANCEL: "CANCELLED",
      };
      await tx.auditLog.create({
        data: {
          companyId: a.companyId,
          actorId: a.membershipId,
          module: "events",
          recordId: event.id,
          action: "EVENT_" + actions[action],
          metadata: {
            branchId: event.branchId,
            eventId: event.id,
            documentId: doc.id,
            code,
            status: event.status,
            responsibleId: event.responsibleId,
            from: from ?? null,
            to: to ?? null,
            items: lines,
            ...(kind === "CREATE" || kind === "UPDATE"
              ? { registration: (input as Save).event }
              : {}),
          },
        },
      });
      return tx.eventDocument.findUniqueOrThrow({
        where: { id: doc.id },
        include,
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
}
