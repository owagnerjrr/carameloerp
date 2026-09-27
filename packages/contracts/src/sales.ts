import { z } from "zod";
export const moneyInput = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Informe reais com até duas casas decimais");
export const discountSchema = z
  .object({ type: z.enum(["AMOUNT", "PERCENT"]), value: moneyInput })
  .strict()
  .default({ type: "AMOUNT", value: "0" });
export type Discount = z.infer<typeof discountSchema>;
export const quoteSchema = z
  .object({
    warehouseId: z.uuid(),
    customerId: z.uuid().nullable().optional(),
    discount: discountSchema,
    items: z
      .array(
        z
          .object({
            productId: z.uuid(),
            quantity: z.number().int().min(1).max(100000),
            expectedUnitPrice: moneyInput,
            discount: discountSchema,
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    "Agrupe o mesmo livro em uma linha",
  );
export const salePaymentSchema = z
  .object({
    method: z.enum([
      "CASH",
      "PIX",
      "DEBIT_CARD",
      "CREDIT_CARD",
      "STORE_CREDIT",
    ]),
    amount: moneyInput,
    receivedAmount: moneyInput.optional(),
    installments: z.number().int().min(1).max(12).default(1),
    cardBrand: z.string().trim().max(60).optional(),
    reference: z.string().trim().max(200).optional(),
    confirmed: z.boolean().default(false),
  })
  .strict();
export const checkoutSchema = z
  .object({
    requestKey: z.uuid(),
    cashSessionId: z.uuid().optional(),
    cart: quoteSchema,
    payments: z.array(salePaymentSchema).max(8),
  })
  .strict();
export const cancelSaleSchema = z
  .object({
    requestKey: z.uuid(),
    reason: z.string().trim().min(8).max(2000),
    refundConfirmed: z.literal(true),
  })
  .strict();
export type SaleCart = z.infer<typeof quoteSchema>;
export type Checkout = z.infer<typeof checkoutSchema>;
export const MAX_CENTS = 99999999999999n;
export function cents(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value))
    throw new Error("Valor monetário inválido");
  const [i, d = ""] = value.split(".");
  return BigInt(i!) * 100n + BigInt(d.padEnd(2, "0"));
}
export function reais(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  return sign + n / 100n + "." + String(n % 100n).padStart(2, "0");
}
export function discountCents(base: bigint, discount: Discount) {
  const v = cents(discount.value);
  if (discount.type === "PERCENT") {
    if (v > 10000n) throw Error("Percentual deve estar entre 0 e 100");
    return (base * v + 5000n) / 10000n;
  }
  return v;
}
export function splitCents(total: bigint, count: number) {
  if (count < 1 || !Number.isInteger(count) || total < BigInt(count))
    throw Error("Valor insuficiente para o número de parcelas");
  const base = total / BigInt(count),
    extra = Number(total % BigInt(count));
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1n : 0n));
}
export const paymentNames = {
  STORE_CREDIT: "Vale-crédito",
  CASH: "Dinheiro",
  PIX: "PIX manual",
  DEBIT_CARD: "Débito manual",
  CREDIT_CARD: "Crédito manual",
};
