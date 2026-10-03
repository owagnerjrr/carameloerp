import { z } from "zod";
const money = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/);
const text = z.string().trim().max(1000).default("");
export const payableMethods = [
  "CASH",
  "PIX",
  "BANK_SLIP",
  "TRANSFER",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "OTHER",
] as const;
export const payableCreateSchema = z
  .object({
    requestKey: z.uuid(),
    branchId: z.uuid(),
    supplierId: z.uuid().nullable().default(null),
    categoryId: z.uuid(),
    origin: z.enum(["MANUAL", "OTHER", "PURCHASE"]),
    purchaseReceiptId: z.uuid().optional(),
    description: z.string().trim().min(3).max(200),
    documentNumber: z.string().trim().max(100).default(""),
    issuedAt: z.iso.date(),
    competence: z.iso.date(),
    amount: money,
    dueDates: z.array(z.iso.date()).min(1).max(60),
    notes: text,
  })
  .strict()
  .refine(
    (v) =>
      v.origin === "PURCHASE" ? !!v.purchaseReceiptId : !v.purchaseReceiptId,
    "Origem incompatível",
  );
export const payablePaySchema = z
  .object({
    requestKey: z.uuid(),
    amount: money,
    paidAt: z.iso.date(),
    method: z.enum(payableMethods),
    reference: z.string().trim().max(160).default(""),
    notes: text,
  })
  .strict();
export const payableEditSchema = z
  .object({
    requestKey: z.uuid(),
    dueDate: z.iso.date(),
    amount: money,
    interest: money,
    penalty: money,
    discount: money,
    reason: z.string().trim().min(8).max(1000),
  })
  .strict();
export const payableCancelSchema = z
  .object({ requestKey: z.uuid(), reason: z.string().trim().min(8).max(1000) })
  .strict();
export const payableFiltersSchema = z
  .object({
    purchaseOrderId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    origin: z.enum(["MANUAL", "OTHER", "PURCHASE"]).optional(),
    status: z
      .enum(["PENDING", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"])
      .optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    issuedFrom: z.iso.date().optional(),
    issuedTo: z.iso.date().optional(),
    q: z.string().trim().max(160).default(""),
    documentNumber: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict()
  .refine(
    (v) =>
      (!v.from || !v.to || v.from <= v.to) &&
      (!v.issuedFrom || !v.issuedTo || v.issuedFrom <= v.issuedTo),
    "Período inválido",
  );
