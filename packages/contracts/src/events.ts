import { z } from "zod";
export const eventStatuses = [
  "DRAFT",
  "PREPARING",
  "IN_TRANSIT",
  "OPEN",
  "CLOSING",
  "CLOSED",
  "CANCELLED",
] as const;
export const eventNames: Record<string, string> = {
  DRAFT: "Rascunho",
  PREPARING: "Em preparação",
  IN_TRANSIT: "Em trânsito",
  OPEN: "Aberto",
  CLOSING: "Em retorno",
  CLOSED: "Encerrado",
  CANCELLED: "Cancelado",
};
const text = z.string().trim().max(2000).default("");
export const eventFields = z
  .object({
    name: z.string().trim().min(3).max(160),
    description: text,
    type: z.enum([
      "FEIRA",
      "ESCOLA",
      "UNIVERSIDADE",
      "CONGRESSO",
      "EXPOSICAO",
      "OUTRO",
    ]),
    branchId: z.uuid(),
    responsibleId: z.uuid(),
    startsAt: z.iso.date(),
    endsAt: z.iso.date(),
    location: z.string().trim().min(2).max(200),
    city: z.string().trim().min(2).max(100),
    state: z.enum([
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
    ]),
    notes: text,
  })
  .strict()
  .refine((v) => v.endsAt >= v.startsAt, {
    message: "Data final anterior à inicial",
    path: ["endsAt"],
  });
export const eventSaveSchema = z
  .object({ requestKey: z.uuid(), event: eventFields })
  .strict();
const items = z
  .array(
    z
      .object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(100000),
      })
      .strict(),
  )
  .min(1)
  .max(200)
  .refine(
    (v) => new Set(v.map((x) => x.productId)).size === v.length,
    "Livros duplicados",
  );
export const eventMoveSchema = z
  .object({ requestKey: z.uuid(), warehouseId: z.uuid(), notes: text, items })
  .strict();
export const eventReceiveSchema = z
  .object({
    requestKey: z.uuid(),
    dispatchId: z.uuid(),
    notes: text,
    items: z
      .array(
        z
          .object({
            productId: z.uuid(),
            quantity: z.number().int().min(0).max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine(
        (v) => new Set(v.map((x) => x.productId)).size === v.length,
        "Livros duplicados",
      ),
  })
  .strict();
export const eventTransitionSchema = z
  .object({
    requestKey: z.uuid(),
    action: z.enum(["PREPARE", "CLOSING", "CLOSE", "CANCEL"]),
    notes: text,
  })
  .strict();
