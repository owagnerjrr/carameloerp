import { z } from "zod";
const money = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/);
export const receivableReceiveSchema = z
  .object({
    requestKey: z.uuid(),
    amount: money,
    receivedAt: z.iso.date(),
    notes: z.string().trim().max(1000).default(""),
    reference: z.string().trim().max(160).default(""),
  })
  .strict();
export const receivableEditSchema = z
  .object({
    requestKey: z.uuid(),
    expectedDate: z.iso.date(),
    notes: z.string().trim().max(1000).default(""),
    reference: z.string().trim().max(160).default(""),
    reason: z.string().trim().min(8).max(1000),
  })
  .strict();
export const financeFiltersSchema = z
  .object({
    branchId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z
      .enum(["PENDING", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"])
      .optional(),
    origin: z
      .enum(["SALE", "PURCHASE", "MANUAL", "OTHER", "LEGACY"])
      .optional(),
    method: z
      .enum([
        "CASH",
        "PIX",
        "DEBIT_CARD",
        "CREDIT_CARD",
        "BANK_SLIP",
        "TRANSFER",
        "OTHER",
      ])
      .optional(),
    q: z.string().trim().max(200).default(""),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Período inválido");
