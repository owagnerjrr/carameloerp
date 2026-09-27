import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { openTestCash } from "./cash-fixture.js";
const db = testDatabase(),
  origin = "http://localhost:5174",
  requireWeb = createRequire(resolve("apps/web/package.json"));
let f: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  vite: ViteDevServer,
  creditId: string;
test.use({ baseURL: origin });
test.beforeAll(async () => {
  f = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 3000 });
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
    app.inject({
      method: "POST",
      url: "/api" + url,
      headers: { cookie, origin },
      payload,
    });
  const session = await openTestCash(app, cookie, f.a.id, origin, "200");
  const customer = (
    await post("/customers", { name: "Cliente Vale Fictício" })
  ).json();
  let source = "";
  for (const [code, price] of [
    ["VALE-ORIGEM", "100"],
    ["VALE-40", "40"],
    ["VALE-100", "100"],
  ]) {
    const b = await post("/products", {
      code,
      barcode: code,
      description: code,
      price,
      cost: "1",
      minStock: "0",
    });
    expect(b.statusCode, b.body).toBe(201);
    if (code === "VALE-ORIGEM") source = b.json().id;
    expect(
      (
        await post("/stock/entries", {
          requestKey: randomUUID(),
          warehouseId: f.wa.id,
          supplierId: f.supplier.id,
          receivedAt: "2026-09-27",
          items: [{ productId: b.json().id, quantity: 10, unitCost: "1" }],
        })
      ).statusCode,
    ).toBe(201);
  }
  const sale = await post("/sales", {
    requestKey: randomUUID(),
    cashSessionId: session.id,
    cart: {
      warehouseId: f.wa.id,
      customerId: customer.id,
      items: [{ productId: source, quantity: 1, expectedUnitPrice: "100" }],
    },
    payments: [{ method: "PIX", amount: "100", confirmed: true }],
  });
  expect(sale.statusCode, sale.body).toBe(201);
  const ret = await post("/returns", {
    requestKey: randomUUID(),
    originalSaleId: sale.json().id,
    cashSessionId: session.id,
    reason: "Devolução fictícia para vale",
    items: [{ saleItemId: sale.json().items[0].id, quantity: 1 }],
  });
  expect(ret.statusCode, ret.body).toBe(201);
  creditId = ret.json().credit.id;
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
test("vale no PDV: saldo100, uso40, vale60+PIX40, cancelamento e histórico", async ({
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
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("button", { name: "PDV / Vendas", exact: true }).click();
  await page.getByLabel("Filial do PDV").selectOption(f.wa.id);
  async function identify() {
    await page
      .getByRole("button", { name: "Selecionar cliente", exact: true })
      .click();
    await page
      .getByLabel("Nome, CPF/CNPJ, telefone ou e-mail", { exact: true })
      .fill("Cliente Vale Fictício");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Cliente Vale Fictício — Sem documento",
        exact: true,
      })
      .click();
  }
  async function read(code: string) {
    const scanner = page.getByLabel("Leitor do PDV", { exact: true });
    await scanner.fill(code);
    await scanner.press("Enter");
    await expect(page.getByLabel("Quantidade de " + code)).toHaveValue("1");
  }
  async function finish() {
    await page
      .getByRole("button", { name: "Finalizar venda", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmar venda", exact: true })
      .click();
    await expect(
      page.getByText("VENDA CONCLUÍDA", { exact: true }),
    ).toBeVisible();
  }
  async function next() {
    await page
      .getByRole("button", { name: "Nova venda", exact: true })
      .last()
      .click();
  }
  await identify();
  await expect(
    page.getByText(/Vale-crédito disponível nesta filial: R\$\s*100,00/),
  ).toBeVisible();
  await read("VALE-40");
  await page
    .getByLabel("Forma de pagamento 1", { exact: true })
    .selectOption("STORE_CREDIT");
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("40");
  await expect(
    page.getByLabel("Recebimento externo confirmado 1", { exact: true }),
  ).not.toBeVisible();
  await finish();
  expect(
    String(
      (await db.customerCredit.findUniqueOrThrow({ where: { id: creditId } }))
        .balance,
    ),
  ).toBe("60");
  await next();
  await identify();
  await expect(
    page.getByText(/Vale-crédito disponível nesta filial: R\$\s*60,00/),
  ).toBeVisible();
  await read("VALE-100");
  await page
    .getByLabel("Forma de pagamento 1", { exact: true })
    .selectOption("STORE_CREDIT");
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("60");
  await page
    .getByRole("button", { name: "Adicionar pagamento", exact: true })
    .click();
  await page.getByLabel("Valor do pagamento 2", { exact: true }).fill("40");
  await page
    .getByLabel("Recebimento externo confirmado 2", { exact: true })
    .check();
  await finish();
  expect(
    (await db.customerCredit.findUniqueOrThrow({ where: { id: creditId } }))
      .status,
  ).toBe("USED");
  await page.getByRole("button", { name: "Ver venda", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancelar venda", exact: true })
    .click();
  await page
    .getByLabel("Motivo do cancelamento", { exact: true })
    .fill("Cancelamento para testar restauração");
  await page.getByRole("checkbox", { name: /Confirmo que tratei/ }).check();
  await page
    .getByRole("button", { name: "Confirmar cancelamento", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("CANCELADA", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await next();
  await identify();
  await expect(
    page.getByText(/Vale-crédito disponível nesta filial: R\$\s*60,00/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver vales e histórico", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Emissão", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Utilização", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("cell", { name: "Restauração", exact: true }),
  ).toBeVisible();
  mkdirSync("../outputs", { recursive: true });
  await page.screenshot({
    path: `../outputs/vale-historico-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
