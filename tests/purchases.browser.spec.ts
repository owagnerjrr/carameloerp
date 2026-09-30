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
      headers: { origin, cookie },
      payload,
    });
  const book = await post("/products", {
    code: "COMPRA-ISBN",
    isbn13: "9788535914849",
    description: "Livro de compras fictício",
    author: "Autora de teste",
    publisher: "Editora de teste",
    price: "80",
    cost: "40",
    minStock: "0",
  });
  expect(book.statusCode, book.body).toBe(201);
  productId = book.json().id;
  const entry = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-29",
    items: [{ productId, quantity: 10, unitCost: "40" }],
  });
  expect(entry.statusCode, entry.body).toBe(201);
  const low = await post("/products", {
    code: "REP-COMPRA",
    description: "Livro para reposição fictício",
    price: "20",
    cost: "10",
    minStock: "5",
  });
  expect(low.statusCode, low.body).toBe(201);
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
test("compras: fornecedor, pedido, aprovação, scanner 5x, recebimento 6+4, custo e reposição", async ({
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
  await page.getByRole("button", { name: "Compras", exact: true }).click();
  await page.getByRole("button", { name: "Fornecedores", exact: true }).click();
  await page
    .getByRole("button", { name: "Novo fornecedor", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Razão social", { exact: true })
    .fill("Distribuidora fictícia do navegador");
  await dialog
    .getByLabel("Nome fantasia", { exact: true })
    .fill("Distribuidora Browser");
  await dialog
    .getByLabel("Contato comercial", { exact: true })
    .fill("Contato fictício");
  await dialog
    .getByRole("combobox", { name: "Tipo", exact: true })
    .selectOption("DISTRIBUTOR");
  await dialog.getByRole("button", { name: "Salvar fornecedor" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: /Distribuidora fictícia do navegador/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await page.keyboard.press("F2");
  await expect(
    dialog.getByRole("heading", { name: "Novo pedido de compra" }),
  ).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Filial de destino", exact: true })
    .selectOption(f.a.id);
  await dialog
    .getByRole("combobox", { name: "Fornecedor", exact: true })
    .selectOption({ label: "Distribuidora fictícia do navegador" });
  await dialog
    .getByRole("combobox", { name: "Comprador", exact: true })
    .selectOption(f.users[0]!.member.id);
  const scanner = dialog.getByLabel("Ler ISBN / código de barras", {
    exact: true,
  });
  await page.keyboard.press("F4");
  await expect(scanner).toBeFocused();
  await scanner.fill("9788535914849");
  await scanner.press("Enter");
  await expect(
    dialog.getByLabel("Quantidade Livro de compras fictício", { exact: true }),
  ).toHaveValue("1");
  await dialog
    .getByLabel("Quantidade Livro de compras fictício", { exact: true })
    .fill("10");
  await dialog
    .getByLabel("Custo Livro de compras fictício", { exact: true })
    .fill("50");
  await page.keyboard.press("Control+Enter");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Pedido #\d+ · Rascunho/ }),
  ).toBeVisible();
  for (const name of [
    "Solicitar aprovação",
    "Aprovar pedido",
    "Marcar como enviado",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await dialog.getByRole("button", { name: "Confirmar alteração" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.keyboard.press("F8");
  await expect(
    dialog.getByRole("heading", { name: /Receber pedido/ }),
  ).toBeVisible();
  for (let n = 0; n < 5; n++) {
    await scanner.fill("9788535914849");
    await scanner.press("Enter");
  }
  const counted = dialog.getByLabel("Conferido Livro de compras fictício", {
    exact: true,
  });
  await expect(counted).toHaveValue("5");
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await counted.fill("11");
  await expect(dialog.getByLabel("Justificativa do excedente")).toHaveAttribute(
    "required",
    "",
  );
  await counted.fill("6");
  await page.screenshot({
    path: `.local/compras-conferencia-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Pedido #\d+ · Recebido parcialmente/ }),
  ).toBeVisible();
  const item = page.locator("table").first().locator("tbody tr");
  await expect(item.locator("td").nth(2)).toHaveText("6");
  await expect(item.locator("td").nth(3)).toHaveText("4");
  await page.getByRole("button", { name: "Receber mercadoria" }).click();
  for (let n = 0; n < 4; n++) {
    await scanner.fill("9788535914849");
    await scanner.press("Enter");
  }
  await expect(counted).toHaveValue("4");
  await dialog.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Pedido #\d+ · Recebido$/ }),
  ).toBeVisible();
  await expect(item.locator("td").nth(2)).toHaveText("10");
  await expect(item.locator("td").nth(3)).toHaveText("0");
  const product = await db.product.findUniqueOrThrow({
    where: { id: productId },
  });
  expect(String(product.cost)).toBe("45");
  const stock = await db.stockBalance.findUniqueOrThrow({
    where: {
      companyId_warehouseId_productId: {
        companyId: f.company.id,
        warehouseId: f.wa.id,
        productId,
      },
    },
  });
  expect(String(stock.quantity)).toBe("20");
  await page.getByRole("button", { name: "Preços de compra" }).click();
  await expect(dialog.locator("tbody tr")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.screenshot({
    path: `.local/compras-recebido-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Reposição", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Filial da reposição", exact: true })
    .selectOption(f.a.id);
  await page
    .getByRole("checkbox", { name: "Selecionar Livro para reposição fictício" })
    .check();
  await page
    .getByRole("button", { name: "Criar pedido com selecionados" })
    .click();
  await expect(
    dialog.getByLabel("Quantidade Livro para reposição fictício"),
  ).toHaveValue("5");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  expect(errors).toEqual([]);
});
