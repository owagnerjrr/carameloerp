import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
const db = testDatabase(),
  origin = "http://localhost:5174",
  requireWeb = createRequire(resolve("apps/web/package.json"));
let f: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  vite: ViteDevServer,
  productId: string;
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
      headers: { cookie, origin },
      payload,
    });
  const p = await post("/products", {
    code: "TRF-BROWSER",
    description: "Livro transferido navegador",
    isbn13: "9788535914849",
    price: "50",
    cost: "10",
    minStock: "0",
  });
  expect(p.statusCode).toBe(201);
  productId = p.json().id;
  const stock = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-01-01",
    items: [{ productId, quantity: 20, unitCost: "10" }],
  });
  expect(stock.statusCode, stock.body).toBe(201);
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
test("transferência: scanner 5x, envio, trânsito, parcial 3+2, destino e histórico", async ({
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
  await page.getByRole("button", { name: "Estoque", exact: true }).click();
  await page
    .getByRole("button", { name: "Transferências entre filiais", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Transferências entre filiais",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("F2");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Nova transferência" }),
  ).toBeVisible();
  await dialog.getByLabel("Depósito de origem").selectOption(f.wa.id);
  await dialog.getByLabel("Depósito de destino").selectOption(f.wb.id);
  await dialog
    .getByLabel("Responsável pela transferência")
    .selectOption(f.users[0]!.member.id);
  await page.keyboard.press("F4");
  const reader = dialog.getByLabel("Leitor de transferência");
  await expect(reader).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await reader.fill("9788535914849");
    await reader.press("Enter");
  }
  await expect(
    dialog.getByLabel("Quantidade Livro transferido navegador"),
  ).toHaveValue("5");
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await page.keyboard.press("Control+Enter");
  await expect(
    dialog.getByRole("heading", { name: "Rascunho", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Preparar transferência", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Preparada", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Enviar transferência", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Em trânsito", exact: true }),
  ).toBeVisible();
  const t = await db.stockTransfer.findFirstOrThrow({
    where: { companyId: f.company.id },
  });
  const quantity = async (warehouseId: string) =>
    Number(
      (
        await db.stockBalance.findUnique({
          where: {
            companyId_warehouseId_productId: {
              companyId: f.company.id,
              warehouseId,
              productId,
            },
          },
        })
      )?.quantity ?? 0,
    );
  expect([
    await quantity(f.wa.id),
    await quantity(t.transitWarehouseId),
    await quantity(f.wb.id),
  ]).toEqual([15, 5, 0]);
  await page.keyboard.press("F8");
  await expect(
    dialog.getByRole("heading", { name: "Receber transferência", exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await dialog.getByLabel("Leitor de transferência").fill("9788535914849");
    await dialog.getByLabel("Leitor de transferência").press("Enter");
  }
  await expect(
    dialog.getByLabel("Quantidade Livro transferido navegador"),
  ).toHaveValue("3");
  await dialog
    .getByLabel("Observações da operação")
    .fill("Dois exemplares chegam no próximo volume");
  await dialog
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Recebida parcialmente", exact: true }),
  ).toBeVisible();
  expect([
    await quantity(t.transitWarehouseId),
    await quantity(f.wb.id),
  ]).toEqual([2, 3]);
  await expect(dialog).toContainText("Divergência MISSING");
  await dialog
    .getByRole("button", { name: "Receber transferência", exact: true })
    .click();
  await dialog.getByLabel("Quantidade Livro transferido navegador").fill("2");
  await dialog
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Recebida", exact: true }),
  ).toBeVisible();
  expect([
    await quantity(f.wa.id),
    await quantity(t.transitWarehouseId),
    await quantity(f.wb.id),
  ]).toEqual([15, 0, 5]);
  await expect(dialog).toContainText("TRANSFER_CLOSED");
  await expect(
    dialog.getByRole("button", { name: "Receber transferência", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(".local", `transfers-detail-${info.project.name}.png`),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByLabel("Status da transferência", { exact: true })
    .selectOption("RECEIVED");
  await expect(
    page.getByRole("button", { name: "Ver transferência", exact: true }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(".local", `transfers-${info.project.name}.png`),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
