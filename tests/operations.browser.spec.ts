import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
const db = testDatabase(),
  origin = "http://localhost:5174",
  requireWeb = createRequire(resolve("apps/web/package.json"));
let f: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  vite: ViteDevServer,
  a: string,
  b: string,
  register: string;
test.use({ baseURL: origin });
test.beforeAll(async () => {
  f = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 2000 });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      company: f.company.slug,
      email: f.users[0]!.user.email,
      password: f.password,
    },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const post = (url: string, payload: object) =>
    app.inject({ method: "POST", url, headers: { cookie, origin }, payload });
  register = (
    await post("/api/cash/registers", { branchId: f.a.id, name: "Caixa 01" })
  ).json().id;
  for (const [code, price, quantity] of [
    ["DEMO-TROCA-A", "50", 10],
    ["DEMO-TROCA-B", "70", 5],
  ] as const) {
    const r = await post("/api/products", {
      code,
      barcode: code + "-EAN",
      description:
        code === "DEMO-TROCA-A" ? "Livro A de teste" : "Livro B de teste",
      author: "Autor fictício",
      publisher: "Editora fictícia",
      price,
      cost: "10",
      minStock: "1",
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id;
    if (code === "DEMO-TROCA-A") a = id;
    else b = id;
    expect(
      (
        await post("/api/stock/entries", {
          requestKey: randomUUID(),
          warehouseId: f.wa.id,
          supplierId: f.supplier.id,
          receivedAt: "2026-09-27",
          items: [{ productId: id, quantity, unitCost: "10" }],
        })
      ).statusCode,
    ).toBe(201);
  }
  await app.listen({ host: "127.0.0.1", port: 3335 });
  vite = await createServer({
    configFile: false,
    root: resolve("apps/web"),
    plugins: [
      requireWeb("@vitejs/plugin-react").default(),
      requireWeb("@tailwindcss/vite").default(),
    ],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": { target: "http://127.0.0.1:3335", changeOrigin: false },
      },
    },
  });
  await vite.listen();
});
test.afterAll(async () => {
  await vite?.close();
  await app?.close();
  await f?.cleanup();
  await db.$disconnect();
});
test("abre caixa, vende, localiza sem data, troca com leitor/PIX20 e fecha conferência", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[name=company]").fill(f.company.slug);
  await page.locator("input[name=email]").fill(f.users[0]!.user.email);
  await page.locator("input[name=password]").fill(f.password);
  await page.getByRole("button", { name: "Entrar no Caramelo" }).click();
  await expect(
    page.getByRole("heading", { name: "Olá, Admin." }),
  ).toBeVisible();
  async function nav(name: string) {
    if (info.project.name === "mobile")
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  const balance = async (productId: string) =>
    String(
      (
        await db.stockBalance.findUniqueOrThrow({
          where: {
            companyId_warehouseId_productId: {
              companyId: f.company.id,
              warehouseId: f.wa.id,
              productId,
            },
          },
        })
      ).quantity,
    );
  await nav("Caixa");
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page
    .getByLabel("Terminal / filial", { exact: true })
    .selectOption(register);
  await page.getByLabel("Fundo inicial", { exact: true }).fill("200");
  await page
    .getByRole("button", { name: "Confirmar abertura", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Caixa 01 · CAIXA ABERTO/ }),
  ).toBeVisible();
  for (const [name, amount, reason] of [
    ["Suprimento", "50", "Reforço de troco"],
    ["Sangria", "50", "Retirada para cofre"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByLabel("Valor", { exact: true }).fill(amount!);
    await page.getByLabel("Motivo", { exact: true }).fill(reason!);
    await page
      .getByRole("button", { name: "Confirmar operação", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await nav("PDV / Vendas");
  await page.getByLabel("Filial do PDV").selectOption(f.wa.id);
  await page.getByLabel("Leitor do PDV").pressSequentially("DEMO-TROCA-A-EAN");
  await page.getByLabel("Leitor do PDV").press("Enter");
  await expect(page.getByLabel("Quantidade de Livro A de teste")).toHaveValue(
    "1",
  );
  for (const key of ["F2", "F3"]) {
    await page.keyboard.press(key);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page.keyboard.press("F4");
  await expect(
    page.getByLabel("Desconto da venda", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("F8");
  await expect(
    page.getByLabel("Valor do pagamento 1", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Forma de pagamento 1", { exact: true })
    .selectOption("CASH");
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("50");
  await page.getByLabel("Valor recebido 1", { exact: true }).fill("50");
  await page.keyboard.press("F10");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar venda", exact: true })
    .click();
  await expect(
    page.getByText("VENDA CONCLUÍDA", { exact: true }),
  ).toBeVisible();
  expect(await balance(a)).toBe("9");
  const original = await db.sale.findFirstOrThrow({
    where: { companyId: f.company.id },
  });
  await page
    .getByRole("button", { name: "Histórico de vendas", exact: true })
    .click();
  await page
    .getByLabel("Número da venda / pedido", { exact: true })
    .fill(String(original.number));
  await page
    .getByRole("button", { name: "Filtrar vendas", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Ver venda #" + original.number,
      exact: true,
    }),
  ).toBeVisible();
  for (const [name, column] of [
    ["Itens", "Valor pago com rateio"],
    ["Caixas", "Vendido líquido"],
    ["Por operador", "Ticket médio"],
    ["Por forma de pagamento", "Pagamentos não estornados"],
    ["Por horário", "Hora"],
    ["Períodos do dia", "Período do dia"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("columnheader", { name: column, exact: true }),
    ).toBeVisible();
  }
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("caramelo-periods.csv");
  expect(await download.failure()).toBeNull();
  await nav("Trocas / Devoluções");
  await page
    .getByLabel("Número da venda / pedido", { exact: true })
    .fill(String(original.number));
  await page
    .getByRole("button", { name: "Filtrar vendas", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Trocar / devolver #" + original.number,
      exact: true,
    })
    .click();
  await page.getByLabel("Devolver Livro A de teste").fill("1");
  const scanner = page.getByLabel("Leitor da troca", { exact: true });
  await scanner.pressSequentially("DEMO-TROCA-B-EAN");
  await scanner.press("Enter");
  await expect(page.getByLabel("Nova quantidade Livro B de teste")).toHaveValue(
    "1",
  );
  await scanner.pressSequentially("DEMO-TROCA-B-EAN");
  await scanner.press("Enter");
  await expect(page.getByLabel("Nova quantidade Livro B de teste")).toHaveValue(
    "2",
  );
  await page.getByLabel("Nova quantidade Livro B de teste").fill("1");
  await scanner.focus();
  await expect(scanner).toHaveValue("");
  await expect(scanner).toBeFocused();
  await page
    .getByLabel("Motivo", { exact: true })
    .fill("Cliente solicitou livro diferente");
  await page
    .getByRole("button", { name: "Calcular e revisar troca", exact: true })
    .click();
  await expect(page.getByText(/Diferença a pagar: R\$\s*20,00/)).toBeVisible();
  await page
    .getByRole("button", { name: "Adicionar pagamento", exact: true })
    .click();
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("20");
  await page
    .getByLabel("Recebimento externo confirmado 1", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Confirmar troca / devolução", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Troca #1", exact: true }),
  ).toBeVisible();
  expect(await balance(a)).toBe("10");
  expect(await balance(b)).toBe("4");
  mkdirSync("../outputs", { recursive: true });
  await page.screenshot({
    path: `../outputs/troca-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await nav("Caixa");
  await page.getByRole("button", { name: "Ver caixa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /CAIXA ABERTO/ }),
  ).toBeVisible();
  await expect(page.locator(".cash-detail .pdv-grand-total")).toContainText(
    "250,00",
  );
  await page.getByRole("button", { name: "Fechar caixa", exact: true }).click();
  await page.getByLabel("Dinheiro contado", { exact: true }).fill("245");
  await page
    .getByLabel("Observação da conferência", { exact: true })
    .fill("Diferença de cinco reais registrada");
  await page
    .getByRole("button", { name: "Confirmar fechamento", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /CAIXA FECHADO/ }),
  ).toBeVisible();
  const saved = await db.cashSession.findFirstOrThrow({
    where: { companyId: f.company.id },
  });
  expect(saved.status).toBe("CLOSED");
  expect(String(saved.difference)).toBe("-5");
  await page.screenshot({
    path: `../outputs/caixa-fechado-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  writeFileSync(
    `../outputs/caixa-troca-${info.project.name}.json`,
    JSON.stringify(
      {
        database: "isolated_test",
        stockA: [9, 10],
        stockB: [5, 4],
        pixDifference: 20,
        expectedCash: 250,
        countedCash: 245,
        difference: -5,
        errors,
      },
      null,
      2,
    ),
  );
});
