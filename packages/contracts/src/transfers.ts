import { z } from "zod";
const line = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(1000000),
  })
  .strict();
const lines = z
  .array(line)
  .min(1)
  .max(300)
  .refine(
    (v) => new Set(v.map((x) => x.productId)).size === v.length,
    "Agrupe os produtos repetidos",
  );
export const transferSaveSchema = z
  .object({
    requestKey: z.uuid(),
    originWarehouseId: z.uuid(),
    destinationWarehouseId: z.uuid(),
    responsibleId: z.uuid(),
    notes: z.string().trim().max(1000).default(""),
    items: lines,
  })
  .strict();
export const transferOperationSchema = z
  .object({
    requestKey: z.uuid(),
    notes: z.string().trim().max(1000).default(""),
    items: lines.optional(),
    divergence: z
      .object({
        code: z.string().trim().min(1).max(160),
        kind: z.enum(["MISSING", "DAMAGED", "WRONG", "EXCESS", "UNEXPECTED"]),
        expected: z.number().int().min(0).max(1000000),
        observed: z.number().int().min(0).max(1000000),
        reason: z.string().trim().min(8).max(1000),
      })
      .strict()
      .optional(),
  })
  .strict();
export const transferFiltersSchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    originId: z.uuid().optional(),
    destinationId: z.uuid().optional(),
    responsibleId: z.uuid().optional(),
    book: z.string().trim().max(200).default(""),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z
      .enum([
        "DRAFT",
        "READY",
        "IN_TRANSIT",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "CLOSED_RETURNED",
        "CANCELLED",
      ])
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Período inválido");
export const transferNames: Record<string, string> = {
  DRAFT: "Rascunho",
  READY: "Preparada",
  IN_TRANSIT: "Em trânsito",
  PARTIALLY_RECEIVED: "Recebida parcialmente",
  RECEIVED: "Recebida",
  CLOSED_RETURNED: "Encerrada com retorno",
  CANCELLED: "Cancelada",
};
