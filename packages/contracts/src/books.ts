import { z } from "zod";
export const cleanIsbn = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();
export function validIsbn10(s: string) {
  const v = cleanIsbn(s);
  return (
    /^\d{9}[\dX]$/.test(v) &&
    [...v].reduce(
      (sum, c, i) => sum + (c === "X" ? 10 : Number(c)) * (10 - i),
      0,
    ) %
      11 ===
      0
  );
}
export function validEan13(s: string) {
  const v = cleanIsbn(s);
  return (
    /^\d{13}$/.test(v) &&
    [...v].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10 ===
      0
  );
}
export function isbn10to13(s: string) {
  const first = "978" + cleanIsbn(s).slice(0, 9);
  return (
    first +
    ((10 -
      ([...first].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) %
        10)) %
      10)
  );
}
export function identifier(s: string) {
  const clean = cleanIsbn(s);
  if (validIsbn10(clean)) return isbn10to13(clean);
  return /^\d{13}$/.test(clean) ? clean : s.trim().toUpperCase();
}
const text = (n: number) =>
  z
    .string()
    .trim()
    .max(n)
    .optional()
    .nullable()
    .transform((v) => v || null);
const integer = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : Number(v)),
    z.number().int().positive().max(max).nullable(),
  );
export const bookFields = {
  subtitle: text(200),
  isbn10: text(20)
    .refine((v) => !v || validIsbn10(v), "ISBN-10 inválido")
    .transform((v) => (v ? cleanIsbn(v) : null)),
  isbn13: text(25)
    .refine(
      (v) => !v || (/^(978|979)/.test(cleanIsbn(v)) && validEan13(v)),
      "ISBN-13 inválido",
    )
    .transform((v) => (v ? cleanIsbn(v) : null)),
  author: text(200),
  coauthor: text(300),
  publisher: text(160),
  imprint: text(160),
  edition: text(40),
  publicationYear: integer(2200),
  language: text(50),
  genre: text(100),
  pages: integer(100000),
  format: text(80),
  coverType: text(80),
  weightGrams: integer(100000),
  dimensions: text(100),
  coverUrl: text(2000).refine(
    (v) => !v || /^https:\/\//.test(v),
    "Use uma URL HTTPS de capa",
  ),
  synopsis: text(10000),
};
export const stockEntrySchema = z
  .object({
    requestKey: z.uuid(),
    warehouseId: z.uuid(),
    supplierId: z.uuid(),
    documentNumber: text(80),
    invoiceNumber: text(80),
    receivedAt: z.iso.date(),
    notes: text(2000),
    items: z
      .array(
        z
          .object({
            productId: z.uuid(),
            quantity: z.number().int().min(1).max(1000000),
            unitCost: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    "Agrupe as quantidades do mesmo livro",
  );
export const stockAdjustmentSchema = z
  .object({
    requestKey: z.uuid(),
    warehouseId: z.uuid(),
    productId: z.uuid(),
    quantity: z.number().int().min(0).max(1000000),
    expectedQuantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/),
    reason: z.string().trim().min(8).max(2000),
  })
  .strict();
export function addScanned<T extends { id: string }>(
  rows: Array<{ book: T; quantity: number; unitCost: string }>,
  book: T,
  cost: string,
) {
  const old = rows.find((r) => r.book.id === book.id);
  return old
    ? rows.map((r) => (r === old ? { ...r, quantity: r.quantity + 1 } : r))
    : [...rows, { book, quantity: 1, unitCost: cost }];
}
