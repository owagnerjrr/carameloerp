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
  categoryId: string,
  purchaseId: string;
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
  const category = await post("/payables/categories", {
    name: "Despesas administrativas",
  });
  expect(category.statusCode, category.body).toBe(201);
  categoryId = category.json().id;
  const book = await post("/products", {
    code: "FIN-BROWSER",
    description: "Livro financeiro navegador",
    cost: "100",
    price: "150",
    minStock: "0",
  });
  expect(book.statusCode).toBe(201);
  const order = await post("/purchases", {
    requestKey: randomUUID(),
    order: {
      branchId: f.a.id,
      supplierId: f.supplier.id,
      buyerId: f.users[0]!.member.id,
      orderedAt: "2026-01-01",
      items: [{ productId: book.json().id, quantity: 10, unitCost: "100" }],
    },
  });
  expect(order.statusCode, order.body).toBe(201);
  purchaseId = order.json().orderId;
  for (const action of ["SUBMIT", "APPROVE", "ORDER"]) {
    const r = await post("/purchases/" + purchaseId + "/state", {
      requestKey: randomUUID(),
      action,
    });
    expect(r.statusCode, r.body).toBe(200);
  }
  const detail = await app.inject({
    url: "/api/purchases/" + purchaseId,
    headers: { cookie },
  });
  const r = await post("/purchases/" + purchaseId + "/receipts", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    receivedAt: "2026-01-02",
    items: [
      { orderItemId: detail.json().items[0].id, quantity: 6, unitCost: "100" },
    ],
  });
  expect(r.statusCode, r.body).toBe(201);
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
test("contas a pagar: despesa, pagamento parcial/total, compra, filtros e dashboard", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const navigate = async (name: string) => {
    if (info.project.name === "mobile")
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    await page.getByRole("button", { name, exact: true }).click();
  };
  await page.goto("/");
  await page.locator("input[name=company]").fill(f.company.slug);
  await page.locator("input[name=email]").fill(f.users[0]!.user.email);
  await page.locator("input[name=password]").fill(f.password);
  await page.getByRole("button", { name: "Entrar no Caramelo" }).click();
  await expect(
    page.getByRole("heading", { name: "Olá, Admin." }),
  ).toBeVisible();
  await navigate("Financeiro");
  await expect(
    page.getByRole("heading", { name: "Contas a Pagar", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("F2");
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Nova conta a pagar" }),
  ).toBeVisible();
  await dialog.getByLabel("Filial", { exact: true }).selectOption(f.a.id);
  await dialog
    .getByLabel("Categoria", { exact: true })
    .selectOption(categoryId);
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Aluguel navegador");
  await dialog.getByLabel("Valor original", { exact: true }).fill("1000");
  await dialog.getByLabel("Vencimento 1/1", { exact: true }).fill("2099-10-10");
  await page.keyboard.press("Control+Enter");
  await expect(
    dialog.getByRole("heading", { name: "Detalhes da conta" }),
  ).toBeVisible();
  await expect(dialog).toContainText("1.000,00");
  await page.keyboard.press("F8");
  await expect(
    dialog.getByRole("heading", { name: "Registrar pagamento" }),
  ).toBeVisible();
  await dialog.getByLabel("Valor do pagamento").fill("400");
  await dialog.getByLabel("Forma de pagamento").selectOption("PIX");
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Detalhes da conta" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Parcial");
  await expect(dialog).toContainText("600,00");
  await dialog
    .getByRole("button", { name: "Registrar pagamento", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Detalhes da conta" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Paga");
  await expect(
    dialog.getByRole("button", { name: "Registrar pagamento", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("PAID");
  await expect(
    page.getByRole("row").filter({ hasText: "Aluguel navegador" }),
  ).toHaveCount(1);
  await page.keyboard.press("F4");
  await expect(page.getByLabel("Pesquisar", { exact: true })).toBeFocused();
  await page.getByLabel("Pesquisar", { exact: true }).fill("inexistente xyz");
  await expect(page.getByText("Nenhuma conta encontrada.")).toBeVisible();
  await page.getByLabel("Pesquisar", { exact: true }).fill("");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar CSV" }).click();
  expect((await download).suggestedFilename()).toBe("contas-a-pagar.csv");
  await navigate("Compras");
  await page
    .getByRole("button", { name: "Abrir pedido", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Contas a pagar da compra" }).click();
  await expect(
    page.getByRole("heading", { name: "Contas a Pagar", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nova conta", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Recebimento da compra").selectOption({ index: 1 });
  await dialog
    .getByLabel("Categoria", { exact: true })
    .selectOption(categoryId);
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Compra navegador recebimento 6");
  await expect(
    dialog.getByLabel("Valor original", { exact: true }),
  ).toHaveValue("600");
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Detalhes da conta" }),
  ).toBeVisible();
  await expect(dialog).toContainText("600,00");
  await dialog.getByRole("button", { name: /Abrir compra #/ }).click();
  await expect(page.getByRole("heading", { name: /Pedido #/ })).toBeVisible();
  await navigate("Visão geral");
  const panel = page.getByRole("region", {
    name: "Financeiro de fornecedores e despesas",
  });
  await expect(panel).toContainText("600,00");
  await expect(panel).toContainText("1.000,00");
  await panel.getByRole("button", { name: "Abrir Contas a Pagar" }).click();
  await expect(
    page.getByRole("heading", { name: "Contas a Pagar", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/payables-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const obligations = await db.financialObligation.findMany({
    where: { companyId: f.company.id },
    include: { entries: { include: { settlements: true } } },
  });
  expect(obligations).toHaveLength(2);
  const rent = obligations.find((o) => o.origin === "MANUAL")!;
  expect(String(rent.entries[0]!.settledAmount)).toBe("1000");
  expect(rent.entries[0]!.settlements).toHaveLength(2);
  expect(
    obligations.find((o) => o.origin === "PURCHASE")!.purchaseOrderId,
  ).toBe(purchaseId);
});
