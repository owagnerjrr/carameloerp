import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
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
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const post = (url: string, payload: object) =>
    app.inject({
      method: "POST",
      url: "/api" + url,
      headers: { cookie, origin },
      payload,
    });
  const b = await post("/products", {
    code: "EVENTO-LIVRO",
    isbn13: "9788535914849",
    description: "Livro da feira fictícia",
    author: "Autora Exemplo",
    publisher: "Editora Exemplo",
    price: "10",
    cost: "1",
    minStock: "0",
  });
  expect(b.statusCode, b.body).toBe(201);
  productId = b.json().id;
  const entry = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-28",
    items: [{ productId, quantity: 20, unitCost: "1" }],
  });
  expect(entry.statusCode, entry.body).toBe(201);
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
test("evento: cadastro, ISBN repetido, trânsito, divergência, retorno parcial e encerramento", async ({
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
  await page
    .getByRole("button", { name: "Feiras / Eventos", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo evento", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nome do evento", { exact: true })
    .fill("Feira da Escola Fictícia");
  await dialog.getByLabel("Data inicial").fill("2026-10-10");
  await dialog.getByLabel("Data final").fill("2026-10-15");
  await dialog.getByLabel("Local", { exact: true }).fill("Escola Exemplo");
  await dialog.getByLabel("Cidade", { exact: true }).fill("Varginha");
  await dialog.getByLabel("Filial responsável").selectOption(f.a.id);
  await dialog
    .getByRole("combobox", { name: "Responsável", exact: true })
    .selectOption(f.users[1]!.member.id);
  await dialog.getByRole("button", { name: "Salvar evento" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Abrir evento" }).click();
  await page.getByRole("button", { name: "Iniciar preparação" }).click();
  await dialog.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Envios", exact: true }).click();
  await page
    .getByRole("button", { name: "Enviar livros", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await dialog
      .getByLabel("ISBN/EAN/SKU", { exact: true })
      .fill("9788535914849");
    await dialog.getByLabel("ISBN/EAN/SKU", { exact: true }).press("Enter");
  }
  await expect(
    dialog.getByLabel("Quantidade Livro da feira fictícia"),
  ).toHaveValue("3");
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await dialog.getByLabel("Quantidade Livro da feira fictícia").fill("10");
  if (info.project.name === "desktop") {
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        dialog.getByLabel("ISBN/EAN/SKU", { exact: true }),
      ).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
  }
  mkdirSync("../outputs", { recursive: true });
  await page.screenshot({
    path: `../outputs/evento-leitor-${info.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Revisar movimentação" }).click();
  await dialog.getByRole("button", { name: "Confirmar envio" }).click();
  await expect(dialog).not.toBeVisible();
  const event = await db.event.findFirstOrThrow({
    where: { companyId: f.company.id },
  });
  const quantity = async (warehouseId: string) =>
    Number(
      (
        await db.stockBalance.findUniqueOrThrow({
          where: {
            companyId_warehouseId_productId: {
              companyId: f.company.id,
              warehouseId,
              productId,
            },
          },
        })
      ).quantity,
    );
  expect(await quantity(f.wa.id)).toBe(10);
  expect(await quantity(event.transitWarehouseId)).toBe(10);
  await page.getByRole("button", { name: "Conferir recebimento" }).click();
  await dialog.getByLabel("Recebido Livro da feira fictícia").fill("9");
  await expect(
    dialog.getByLabel("Justificativa do recebimento"),
  ).toHaveAttribute("required", "");
  await dialog
    .getByLabel("Justificativa do recebimento")
    .fill("Uma unidade ainda na transportadora");
  await dialog.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/diferença -1/)).toBeVisible();
  expect(await quantity(event.warehouseId)).toBe(9);
  expect(await quantity(event.transitWarehouseId)).toBe(1);
  await page
    .getByRole("button", { name: "Estoque", exact: true })
    .last()
    .click();
  await page.getByLabel("Pesquisar estoque do evento").fill("Autora Exemplo");
  await expect(
    page.getByRole("cell", { name: /Livro da feira fictícia/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Envios", exact: true }).click();
  await page.getByRole("button", { name: "Conferir recebimento" }).click();
  await expect(
    dialog.getByLabel("Recebido Livro da feira fictícia"),
  ).toHaveValue("1");
  await dialog.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(dialog).not.toBeVisible();
  async function returnBooks(n: number) {
    await page.getByRole("button", { name: "Retornos", exact: true }).click();
    await page
      .getByRole("button", { name: "Retornar livros", exact: true })
      .click();
    await dialog
      .getByLabel("ISBN/EAN/SKU", { exact: true })
      .fill("9788535914849");
    await dialog.getByLabel("ISBN/EAN/SKU", { exact: true }).press("Enter");
    await expect(
      dialog.getByLabel("Quantidade Livro da feira fictícia"),
    ).toHaveValue("1");
    await dialog
      .getByLabel("Quantidade Livro da feira fictícia")
      .fill(String(n));
    await dialog.getByRole("button", { name: "Revisar movimentação" }).click();
    await dialog.getByRole("button", { name: "Confirmar retorno" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await returnBooks(7);
  expect(await quantity(event.warehouseId)).toBe(3);
  expect(await quantity(f.wa.id)).toBe(17);
  await returnBooks(3);
  expect(await quantity(event.warehouseId)).toBe(0);
  expect(await quantity(f.wa.id)).toBe(20);
  await page.getByRole("button", { name: "Resumo", exact: true }).click();
  await page.getByRole("button", { name: "Encerrar evento" }).click();
  await dialog.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Feira da Escola Fictícia.*Encerrado/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(page.getByText("Encerramento", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `../outputs/evento-historico-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
