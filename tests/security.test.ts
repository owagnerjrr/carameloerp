import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
} from "../apps/api/src/security.js";
import {
  customerSchema,
  productSchema,
  periodSchema,
} from "@caramelo/contracts";
describe("Segurança e validação", () => {
  it("aceita CNPJ alfanumérico e valida ambos os dígitos verificadores", () => {
    // Exemplo público do manual de DV da Receita Federal/Serpro.
    const result = customerSchema.parse({
      name: "Exemplo técnico",
      document: "12.abc.345/01de-35",
    });
    expect(result.document).toBe("12ABC34501DE35");
    expect(
      customerSchema.safeParse({
        name: "Exemplo técnico",
        document: "12ABC34501DE36",
      }).success,
    ).toBe(false);
    expect(
      customerSchema.safeParse({
        name: "Exemplo técnico",
        document: "12ABC34501DE3A",
      }).success,
    ).toBe(false);
  });
  it("gera hashes com salt e verifica a senha sem armazenar texto puro", async () => {
    const a = await hashPassword("example-secure-password");
    const b = await hashPassword("example-secure-password");
    expect(a).not.toBe(b);
    expect(a).not.toContain("example-secure-password");
    expect(await verifyPassword("example-secure-password", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("wrong", "invalid")).toBe(false);
  });
  it("gera tokens aleatórios e hashes irreversíveis de comprimento fixo", () => {
    const token = newToken();
    expect(token).not.toBe(newToken());
    expect(tokenHash(token)).toHaveLength(64);
    expect(tokenHash(token)).not.toBe(token);
  });
  it("rejeita campos de tenant e CPF inválido no contrato de cliente", () => {
    expect(
      customerSchema.safeParse({
        name: "Teste",
        companyId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      customerSchema.safeParse({ name: "Teste", document: "11111111111" })
        .success,
    ).toBe(false);
  });
  it("rejeita valores negativos, estoque arbitrário e precisão monetária inválida", () => {
    const base = {
      code: "P1",
      description: "Produto",
      cost: "1.00",
      price: "2.00",
      minStock: "0",
    };
    expect(productSchema.safeParse(base).success).toBe(true);
    expect(productSchema.safeParse({ ...base, price: "-1" }).success).toBe(
      false,
    );
    expect(productSchema.safeParse({ ...base, price: "1.999" }).success).toBe(
      false,
    );
    expect(productSchema.safeParse({ ...base, stock: 200 }).success).toBe(
      false,
    );
  });
  it("limita a amplitude e a ordem do período", () => {
    expect(
      periodSchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success,
    ).toBe(true);
    expect(
      periodSchema.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success,
    ).toBe(false);
    expect(
      periodSchema.safeParse({ from: "2020-01-01", to: "2026-01-01" }).success,
    ).toBe(false);
  });
});
