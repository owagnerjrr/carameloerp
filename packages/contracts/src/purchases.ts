import { z } from "zod";
const money = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "Valor monetário inválido");
const notes = z.string().trim().max(2000).default("");
const date = z.iso.date();
const quantity = z.number().int().min(1).max(100000);
export const purchaseNames: Record<string, string> = {
  DRAFT: "Rascunho",
  PENDING: "Aguardando aprovação",
  APPROVED: "Aprovado",
  ORDERED: "Enviado",
  PARTIALLY_RECEIVED: "Recebido parcialmente",
  RECEIVED: "Recebido",
  CANCELLED: "Cancelado",
};
export const purchaseFields = z
  .object({
    branchId: z.uuid(),
    supplierId: z.uuid(),
    buyerId: z.uuid(),
    orderedAt: date,
    expectedAt: date.nullable().optional(),
    notes,
    freight: money.default("0"),
    expenses: money.default("0"),
    items: z
      .array(
        z
          .object({
            productId: z.uuid(),
            quantity,
            unitCost: money,
            unitDiscount: money.default("0"),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => !v.expectedAt || v.expectedAt >= v.orderedAt,
    "Previsão anterior ao pedido",
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    "Livro repetido no pedido",
  );
export const purchaseSaveSchema = z
  .object({ requestKey: z.uuid(), order: purchaseFields })
  .strict();
export const purchaseStateSchema = z
  .object({
    requestKey: z.uuid(),
    action: z.enum(["SUBMIT", "APPROVE", "ORDER", "CANCEL"]),
    notes,
  })
  .strict();
export const divergenceTypes = [
  "MISSING",
  "EXCESS",
  "UNORDERED",
  "DAMAGED",
  "EDITION",
  "ISBN",
] as const;
export const divergenceNames: Record<string, string> = {
  MISSING: "Faltante",
  EXCESS: "Excedente",
  UNORDERED: "Não solicitado",
  DAMAGED: "Danificado",
  EDITION: "Edição diferente",
  ISBN: "ISBN divergente",
};
export const purchaseReceiveSchema = z
  .object({
    requestKey: z.uuid(),
    warehouseId: z.uuid(),
    receivedAt: date,
    notes,
    freight: money.default("0"),
    expenses: money.default("0"),
    excessReason: notes,
    items: z
      .array(
        z.object({ orderItemId: z.uuid(), quantity, unitCost: money }).strict(),
      )
      .max(100),
    divergences: z
      .array(
        z
          .object({
            productId: z.uuid(),
            type: z.enum(divergenceTypes),
            quantity,
            notes: z.string().trim().min(8).max(2000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .refine(
    (v) => v.items.length > 0 || v.divergences.length > 0,
    "Informe a conferência",
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.orderItemId)).size === v.items.length,
    "Item repetido",
  );
