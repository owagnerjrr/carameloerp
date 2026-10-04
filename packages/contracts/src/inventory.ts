import { z } from "zod";
export const inventoryPermissions = [
  "inventory:read",
  "inventory:create",
  "inventory:count",
  "inventory:review",
  "inventory:approve",
  "inventory:close",
  "inventory:cancel",
] as const;
export const inventorySaveSchema = z
  .object({
    requestKey: z.uuid(),
    warehouseId: z.uuid(),
    responsibleId: z.uuid(),
    description: z.string().trim().min(3).max(200),
    scheduledAt: z.iso.date(),
    scope: z.enum(["FULL", "PARTIAL"]),
    blind: z.boolean().default(true),
    blindRecount: z.boolean().default(true),
    productIds: z.array(z.uuid()).max(2000).default([]),
  })
  .strict()
  .refine(
    (v) => v.scope !== "PARTIAL" || v.productIds.length > 0,
    "Selecione livros para o inventário parcial",
  )
  .refine(
    (v) => new Set(v.productIds).size === v.productIds.length,
    "Livros repetidos",
  );
export const inventoryOperationSchema = z
  .object({
    requestKey: z.uuid(),
    productId: z.uuid().optional(),
    code: z.string().trim().min(1).max(160).optional(),
    mode: z.enum(["ADD", "SET"]).optional(),
    quantity: z.number().int().min(0).max(1000000).optional(),
    source: z.enum(["SCANNER", "MANUAL"]).default("MANUAL"),
    productIds: z.array(z.uuid()).min(1).max(2000).optional(),
    reason: z
      .enum([
        "LOSS",
        "DAMAGED",
        "THEFT",
        "OPERATIONAL",
        "UNREGISTERED_IN",
        "UNREGISTERED_OUT",
        "COUNT_ERROR",
        "LOCATION",
        "OTHER",
      ])
      .optional(),
    notes: z.string().trim().max(1000).default(""),
  })
  .strict();
export const inventoryNames: Record<string, string> = {
  DRAFT: "Rascunho",
  COUNTING: "Em contagem",
  RECOUNT_REQUIRED: "Recontagem necessária",
  UNDER_REVIEW: "Em revisão",
  APPROVED: "Aprovado",
  CLOSED: "Finalizado",
  CANCELLED: "Cancelado",
};
