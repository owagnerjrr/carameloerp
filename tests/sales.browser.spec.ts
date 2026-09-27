import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildApp } from "../apps/api/src/app.js";
import { testDatabase, stockFixture } from "./stock-fixture.js";
const requireWeb = createRequire(resolve("apps/web/package.json")),
  db = testDatabase(),
  origin = "http://localhost:5174";
let fixture: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  vite: ViteDevServer,
  book: string;
test.use({ baseURL: origin });
test.beforeAll(async () => {
  fixture = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 2000 });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      company: fixture.company.slug,
      email: fixture.users[0]!.user.email,
      password: fixture.password,
    },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const r = await app.inject({
    method: "POST",
    url: "/api/products",
    headers: { origin, cookie },
    payload: {
      code: "DEMO-PDV",
      barcode: "DEMO-PDV-0001",
      description: "Livro Teste Caramelo",
      author: "Autor Teste",
      publisher: "Editora Teste",
      price: "50",
      cost: "20",
      minStock: "1",
    },
  });
  expect(r.statusCode).toBe(201);
  book = r.json().id;
  const entry = await app.inject({
    method: "POST",
    url: "/api/stock/entries",
    headers: { origin, cookie },
    payload: {
      requestKey: randomUUID(),
      warehouseId: fixture.wa.id,
      supplierId: fixture.supplier.id,
      receivedAt: "2026-09-26",
      items: [{ productId: book, quantity: 10, unitCost: "20" }],
    },
  });
  expect(entry.statusCode).toBe(201);
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
  await fixture?.cleanup();
  await db.$disconnect();
});
test("PDV real: leitor, cliente, PIX, troco, crédito, misto e cancelamento 10→8→7→6→4→6", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[name=company]").fill(fixture.company.slug);
  await page.locator("input[name=email]").fill(fixture.users[0]!.user.email);
  await page.locator("input[name=password]").fill(fixture.password);
  await page.getByRole("button", { name: "Entrar no Caramelo" }).click();
  await expect(
    page.getByRole("heading", { name: "Olá, Admin." }),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("button", { name: "PDV / Vendas", exact: true }).click();
  await page.getByLabel("Filial do PDV").selectOption(fixture.wa.id);
  const scan = page.getByLabel("Leitor do PDV", { exact: true }),
    qty = page.getByLabel("Quantidade de Livro Teste Caramelo", {
      exact: true,
    });
  const balance = async () =>
    String(
      (
        await db.stockBalance.findUniqueOrThrow({
          where: {
            companyId_warehouseId_productId: {
              companyId: fixture.company.id,
              warehouseId: fixture.wa.id,
              productId: book,
            },
          },
        })
      ).quantity,
    );
  async function read(n = 1) {
    for (let i = 1; i <= n; i++) {
      await scan.pressSequentially("DEMO-PDV-0001");
      await scan.press("Enter");
      await expect(qty).toHaveValue(String(i));
      await expect(scan).toHaveValue("");
      await expect(scan).toBeFocused();
    }
  }
  async function finish() {
    await page
      .getByRole("button", { name: "Finalizar venda", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
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
    await expect(scan).toBeFocused();
  }
  await read(2);
  expect(await balance()).toBe("10");
  await expect(page.getByLabel("Total da venda")).toContainText("100,00");
  // Creating a customer uses the real catalog endpoint and keeps the pending cart.
  await page
    .getByRole("button", { name: "Cadastrar cliente", exact: true })
    .click();
  await page.locator("input[name=name]").fill("Cliente fictício PDV");
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(qty).toHaveValue("2");
  await expect(
    page.getByText("Cliente fictício PDV", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("100");
  await page
    .getByLabel("Recebimento externo confirmado 1", { exact: true })
    .check();
  mkdirSync("../outputs", { recursive: true });
  await page.screenshot({
    path: `../outputs/pdv-carrinho-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await finish();
  expect(await balance()).toBe("8");
  const pix = await db.sale.findFirstOrThrow({
    where: { companyId: fixture.company.id },
    include: { payments: true, financialEntries: true, movements: true },
  });
  expect(pix.total.toString()).toBe("100");
  expect(pix.customerId).not.toBeNull();
  expect(pix.payments[0]!.method).toBe("PIX");
  expect(pix.financialEntries[0]!.amount.toString()).toBe("100");
  expect(pix.movements[0]!.quantity.toString()).toBe("-2");
  await next();
  await read();
  await page
    .getByLabel("Forma de pagamento 1", { exact: true })
    .selectOption("CASH");
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("50");
  await page.getByLabel("Valor recebido 1", { exact: true }).fill("100");
  await finish();
  expect(await balance()).toBe("7");
  await expect(page.getByText(/Troco: R\$\s*50,00/)).toBeVisible();
  await next();
  await read();
  await page
    .getByLabel("Forma de pagamento 1", { exact: true })
    .selectOption("CREDIT_CARD");
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("50");
  await page.getByLabel("Parcelas 1", { exact: true }).selectOption("2");
  await page
    .getByLabel("Recebimento externo confirmado 1", { exact: true })
    .check();
  await finish();
  expect(await balance()).toBe("6");
  await next();
  await read(2);
  await page.getByLabel("Valor do pagamento 1", { exact: true }).fill("40");
  await page
    .getByLabel("Recebimento externo confirmado 1", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Adicionar pagamento", exact: true })
    .click();
  await page
    .getByLabel("Forma de pagamento 2", { exact: true })
    .selectOption("DEBIT_CARD");
  await page.getByLabel("Valor do pagamento 2", { exact: true }).fill("60");
  await page
    .getByLabel("Recebimento externo confirmado 2", { exact: true })
    .check();
  await finish();
  expect(await balance()).toBe("4");
  await page.getByRole("button", { name: "Ver venda", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancelar venda", exact: true })
    .click();
  await page
    .getByLabel("Motivo do cancelamento", { exact: true })
    .fill("Cancelamento demonstrativo solicitado pelo cliente");
  await page.getByRole("checkbox", { name: /Confirmo que tratei/ }).check();
  await page
    .getByRole("button", { name: "Confirmar cancelamento", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("CANCELADA", { exact: true }),
  ).toBeVisible();
  expect(await balance()).toBe("6");
  await page.screenshot({
    path: `../outputs/pdv-cancelamento-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await next();
  await page
    .getByRole("button", { name: "Adicionar livro", exact: true })
    .click();
  await page
    .getByLabel("Título, autor, ISBN, editora ou SKU", { exact: true })
    .fill("Autor Teste");
  await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Livro Teste Caramelo — Autor Teste",
      exact: true,
    })
    .click();
  await expect(qty).toHaveValue("1");
  await page
    .getByRole("button", { name: "Aumentar Livro Teste Caramelo", exact: true })
    .click();
  await expect(qty).toHaveValue("2");
  await page
    .getByRole("button", { name: "Diminuir Livro Teste Caramelo", exact: true })
    .click();
  await expect(qty).toHaveValue("1");
  await page
    .getByLabel("Tipo de Desconto de Livro Teste Caramelo", { exact: true })
    .selectOption("PERCENT");
  await page
    .getByLabel("Desconto de Livro Teste Caramelo", { exact: true })
    .fill("10");
  await expect(page.getByLabel("Total da venda")).toContainText("45,00");
  await qty.fill("7");
  await page
    .getByRole("button", { name: "Finalizar venda", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Estoque insuficiente.");
  expect(await balance()).toBe("6");
  await page
    .getByRole("button", { name: "Remover Livro Teste Caramelo", exact: true })
    .click();
  await expect(qty).not.toBeVisible();
  await page
    .getByRole("button", { name: "Histórico de vendas", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Cancelada", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "7 dias", exact: true }).click();
  await expect(page.getByText("4 registros", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
  writeFileSync(
    `../outputs/pdv-evidencias-${info.project.name}.json`,
    JSON.stringify(
      {
        environment: "PostgreSQL local isolado _test",
        stockChain: [10, 8, 7, 6, 4, 6],
        pixTotal: 100,
        cashChange: 50,
        creditInstallments: 2,
        mixed: { PIX: 40, DEBIT_CARD: 60 },
        cancelled: true,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
});
