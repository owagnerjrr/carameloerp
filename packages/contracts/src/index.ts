import { z } from "zod";
export const permissions = [
  "dashboard:read",
  "customers:read",
  "customers:write",
  "products:read",
  "products:write",
  "users:manage",
  "audit:read",
] as const;
export type PermissionCode = (typeof permissions)[number];
export const rolePermissions: Record<string, readonly PermissionCode[]> = {
  Administrador: permissions,
  Gerente: [
    "dashboard:read",
    "customers:read",
    "customers:write",
    "products:read",
    "products:write",
    "audit:read",
  ],
  Financeiro: ["dashboard:read", "customers:read"],
  Vendedor: ["customers:read", "customers:write", "products:read"],
  Estoque: ["products:read", "products:write"],
  Fiscal: ["customers:read", "products:read"],
};
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);
function validDocument(value: string) {
  if (/^(\d)\1+$/.test(value)) return false;
  const digits = [...value].map((character) => character.charCodeAt(0) - 48);
  if (/^\d{11}$/.test(value)) {
    return [9, 10].every((n) => {
      const sum = digits
        .slice(0, n)
        .reduce((s, d, i) => s + d * (n + 1 - i), 0);
      return ((sum * 10) % 11) % 10 === digits[n];
    });
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(value)) {
    return [12, 13].every((n) => {
      const sum = digits
        .slice(0, n)
        .reduce((s, d, i) => s + d * (((n - i - 1) % 8) + 2), 0);
      const rest = sum % 11;
      return (rest < 2 ? 0 : 11 - rest) === digits[n];
    });
  }
  return false;
}
export const customerSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    document: optionalText(18)
      .transform((v) => v?.toUpperCase().replace(/[./\s-]/g, "") || null)
      .refine((v) => !v || validDocument(v), "CPF/CNPJ inválido"),
    registration: optionalText(30),
    phone: optionalText(25),
    whatsapp: optionalText(25),
    email: z
      .union([z.email().max(200), z.literal(""), z.null()])
      .optional()
      .transform((v) => v || null),
    postalCode: optionalText(9).refine(
      (v) => !v || /^\d{5}-?\d{3}$/.test(v),
      "CEP inválido",
    ),
    street: optionalText(),
    number: optionalText(20),
    complement: optionalText(),
    district: optionalText(100),
    city: optionalText(100),
    state: optionalText(2).refine(
      (v) =>
        !v ||
        [
          "AC",
          "AL",
          "AP",
          "AM",
          "BA",
          "CE",
          "DF",
          "ES",
          "GO",
          "MA",
          "MT",
          "MS",
          "MG",
          "PA",
          "PB",
          "PR",
          "PE",
          "PI",
          "RJ",
          "RN",
          "RS",
          "RO",
          "RR",
          "SC",
          "SP",
          "SE",
          "TO",
        ].includes(v),
      "UF inválida",
    ),
    notes: optionalText(2000),
    active: z.boolean().default(true),
  })
  .strict();
const money = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    "Use um valor positivo com até 2 casas decimais",
  );
const fiscalCode = (length: number) =>
  optionalText(length).refine(
    (v) => !v || new RegExp(`^\\d{${length}}$`).test(v),
    "Código fiscal inválido",
  );
export const productSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    barcode: optionalText(40),
    description: z.string().trim().min(2).max(200),
    categoryId: z.uuid().nullable().optional(),
    supplierId: z.uuid().nullable().optional(),
    brand: optionalText(80),
    unit: z
      .enum(["UN", "KG", "G", "L", "ML", "M", "M2", "CX", "PC"])
      .default("UN"),
    cost: money,
    price: money,
    minStock: z.string().regex(/^\d{1,10}(\.\d{1,3})?$/),
    location: optionalText(80),
    ncm: fiscalCode(8),
    cest: fiscalCode(7),
    cfop: fiscalCode(4),
    origin: optionalText(1).refine((v) => !v || /^[0-8]$/.test(v)),
    cst: fiscalCode(2),
    csosn: fiscalCode(3),
    active: z.boolean().default(true),
  })
  .strict();
export const loginSchema = z
  .object({
    company: z.string().trim().min(1).max(80),
    email: z
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    roleId: z.uuid(),
  })
  .strict();
export const updateUserSchema = z
  .object({ roleId: z.uuid(), active: z.boolean() })
  .strict();
export const listSchema = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const periodSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(
    (v) =>
      v.from <= v.to &&
      (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 366,
    "Informe um período de até 366 dias",
  );
export type CustomerInput = z.input<typeof customerSchema>;
export type ProductInput = z.input<typeof productSchema>;
