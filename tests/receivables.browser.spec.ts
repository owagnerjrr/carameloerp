import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { openTestCash } from "./cash-fixture.js";
import { financialToday } from "../apps/api/src/services/payables.js";
const db = testDatabase(),
  origin = "http://localhost:5174",
  requireWeb = createRequire(resolve("apps/web/package.json"));
let f: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  vite: ViteDevServer;
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
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const post = (url: string, payload: object) =>
    app.inject({
      method: "POST",
      url: "/api" + url,
      headers: { origin, cookie },
      payload,
    });
  const session = await openTestCash(app, cookie, f.a.id, origin);
  const book = await post("/products", {
    code: "RECEIVE-BROWSER",
    description: "Livro recebíveis navegador",
    cost: "20",
    price: "100",
    minStock: "0",
  });
  expect(book.statusCode).toBe(201);
  const stock = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: financialToday(),
    items: [{ productId: book.json().id, quantity: 5, unitCost: "20" }],
  });
  expect(stock.statusCode, stock.body).toBe(201);
  const sale = await post("/sales", {
    requestKey: randomUUID(),
    cashSessionId: session.id,
    cart: {
      warehouseId: f.wa.id,
      items: [
        { productId: book.json().id, quantity: 1, expectedUnitPrice: "100" },
      ],
    },
    payments: [
      {
        method: "CREDIT_CARD",
        amount: "100",
        installments: 1,
        confirmed: true,
      },
    ],
  });
  expect(sale.statusCode, sale.body).toBe(201);
  const cat = await post("/payables/categories", {
    name: "Financeiro navegador",
  });
  expect(cat.statusCode).toBe(201);
  const expense = await post("/payables", {
    requestKey: randomUUID(),
    branchId: f.a.id,
    categoryId: cat.json().id,
    origin: "MANUAL",
    description: "Despesa prevista navegador",
    issuedAt: financialToday(),
    competence: financialToday(),
    amount: "25",
    dueDates: [financialToday()],
  });
  expect(expense.statusCode).toBe(201);
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
test("recebíveis: baixa parcial/total, filtros e fluxo realizado/previsto", async ({
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
  await page.getByRole("button", { name: "Financeiro", exact: true }).click();
  await page
    .getByRole("button", { name: "Contas a Receber", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Contas a Receber", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Forma financeira", { exact: true })
    .selectOption("CREDIT_CARD");
  await expect(
    page.getByRole("button", { name: "Ver recebível", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Ver recebível", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Saldo: R$ 100,00");
  await dialog
    .getByRole("button", { name: "Registrar recebimento", exact: true })
    .click();
  await dialog.getByLabel("Valor recebido", { exact: true }).fill("40");
  await dialog
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(dialog).toContainText("Saldo: R$ 60,00");
  await expect(dialog).toContainText("Parcial");
  await dialog
    .getByRole("button", { name: "Registrar recebimento", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(dialog).toContainText("Saldo: R$ 0,00");
  await expect(
    dialog.getByRole("button", { name: "Registrar recebimento", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("RECEIVABLE_RECEIVED");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByLabel("Status financeiro", { exact: true })
    .selectOption("PAID");
  await expect(
    page.getByRole("button", { name: "Ver recebível", exact: true }),
  ).toHaveCount(1);
  await page.getByLabel("Pesquisar recebíveis").fill("inexistente");
  await expect(
    page.getByRole("button", { name: "Ver recebível", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fluxo de Caixa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fluxo de Caixa", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  await expect(
    page.locator("article").filter({ hasText: "Recebido no período" }),
  ).toContainText("100,00");
  await expect(
    page.locator("article").filter({ hasText: "Saídas previstas" }),
  ).toContainText("25,00");
  await expect(
    page.locator("article").filter({ hasText: "Resultado realizado" }),
  ).toContainText("100,00");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(".local", `receivables-${info.project.name}.png`),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
