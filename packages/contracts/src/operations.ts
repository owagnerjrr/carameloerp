import { z } from "zod";
import { moneyInput, quoteSchema, salePaymentSchema } from "./sales.js";
export const cashOpenSchema = z
  .object({
    requestKey: z.uuid(),
    cashRegisterId: z.uuid(),
    openingAmount: moneyInput,
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const cashMoveSchema = z
  .object({
    requestKey: z.uuid(),
    kind: z.enum(["SUPPLY", "WITHDRAWAL"]),
    amount: moneyInput,
    reason: z.string().trim().min(8).max(2000),
  })
  .strict();
export const cashCloseSchema = z
  .object({
    requestKey: z.uuid(),
    countedAmount: moneyInput,
    expectedAmount: moneyInput,
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
export const returnSchema = z
  .object({
    requestKey: z.uuid(),
    originalSaleId: z.uuid(),
    cashSessionId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    reason: z.string().trim().min(8).max(2000),
    items: z
      .array(
        z
          .object({
            saleItemId: z.uuid(),
            quantity: z.number().int().min(1).max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    replacement: quoteSchema.optional(),
    payments: z.array(salePaymentSchema).max(8).default([]),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.saleItemId)).size === v.items.length,
    "Agrupe cada item devolvido em uma linha",
  );
export const commercialPeriods = [
  { name: "Madrugada", start: 0, end: 6 },
  { name: "Manhã", start: 6, end: 12 },
  { name: "Tarde", start: 12, end: 18 },
  { name: "Noite", start: 18, end: 24 },
];
export function commercialHour(date: Date) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
