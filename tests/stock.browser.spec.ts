import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildApp } from "../apps/api/src/app.js";
import { testDatabase, stockFixture } from "./stock-fixture.js";
const requireWeb = createRequire(resolve("apps/web/package.json"));
const db = testDatabase();
let fixture: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  vite: ViteDevServer;
test.use({ baseURL: "http://localhost:5174" });
test.beforeAll(async () => {
  fixture = await stockFixture(db);
  app = await buildApp({
    db,
    origin: "http://localhost:5174",
    rateLimitMax: 1000,
  });
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
test("livro, leitura USB simulada, 0 → 10 → 15, filial B5, histórico e cadastro sem perder entrada", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[name=company]").fill(fixture.company.slug);
  await page.locator("input[name=email]").fill(fixture.users[0]!.user.email);
  await page.locator("input[name=password]").fill(fixture.password);
  await page.getByRole("button", { name: "Entrar no Caramelo" }).click();
  async function nav(name: string) {
    if (info.project.name === "mobile")
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  await nav("Livros");
  await page.getByRole("button", { name: "Novo livro", exact: true }).click();
  for (const [name, value] of Object.entries({
    code: "DEMO-LIVRO-TESTE",
    barcode: "DEMO-CARAMELO-0001",
    description: "Livro Teste Caramelo",
    author: "Autor de demonstração",
    publisher: "Editora de demonstração",
    cost: "20",
    price: "50",
    minStock: "2",
  }))
    await page.locator(`input[name=${name}]`).fill(value);
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const book = await db.product.findFirstOrThrow({
    where: { companyId: fixture.company.id, code: "DEMO-LIVRO-TESTE" },
  });
  const saldo = async (warehouseId = fixture.wa.id) =>
    String(
      (
        await db.stockBalance.findUnique({
          where: {
            companyId_warehouseId_productId: {
              companyId: fixture.company.id,
              warehouseId,
              productId: book.id,
            },
          },
        })
      )?.quantity ?? 0,
    );
  expect(await saldo()).toBe("0");
  await nav("Estoque");
  await page
    .getByRole("button", { name: "Entrada de Livros", exact: true })
    .click();
  await page.getByLabel("Filial da entrada").selectOption(fixture.wa.id);
  await page
    .getByLabel("Fornecedor da entrada")
    .selectOption(fixture.supplier.id);
  const scan = page.getByLabel("Leitura ISBN/EAN/SKU", { exact: true });
  for (let i = 1; i <= 3; i++) {
    await scan.pressSequentially("DEMO-CARAMELO-0001");
    await scan.press("Enter");
    await expect(
      page.getByLabel("Quantidade de Livro Teste Caramelo", { exact: true }),
    ).toHaveValue(String(i));
    await expect(scan).toHaveValue("");
    await expect(scan).toBeFocused();
  }
  await page
    .getByLabel("Quantidade de Livro Teste Caramelo", { exact: true })
    .fill("10");
  async function confirm() {
    await page
      .getByRole("button", { name: "Confirmar entrada", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Resumo da entrada" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.getByText(/Entrada confirmada e persistida/),
    ).toBeVisible();
  }
  await confirm();
  expect(await saldo()).toBe("10");
  await scan.pressSequentially("DEMO-CARAMELO-0001");
  await scan.press("Enter");
  await expect(
    page.getByLabel("Quantidade de Livro Teste Caramelo", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByLabel("Quantidade de Livro Teste Caramelo", { exact: true })
    .fill("5");
  await confirm();
  expect(await saldo()).toBe("15");
  const movements = await db.stockMovement.findMany({
    where: {
      companyId: fixture.company.id,
      warehouseId: fixture.wa.id,
      productId: book.id,
    },
    orderBy: { createdAt: "asc" },
  });
  expect(
    movements.map((m) => [
      String(m.quantity),
      String(m.beforeQuantity),
      String(m.afterQuantity),
    ]),
  ).toEqual([
    ["10", "0", "10"],
    ["5", "10", "15"],
  ]);
  await page.getByLabel("Filial da entrada").selectOption(fixture.wb.id);
  await scan.fill("DEMO-CARAMELO-0001");
  await scan.press("Enter");
  await expect(
    page.getByLabel("Quantidade de Livro Teste Caramelo", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByLabel("Quantidade de Livro Teste Caramelo", { exact: true })
    .fill("5");
  await confirm();
  expect(await saldo()).toBe("15");
  expect(await saldo(fixture.wb.id)).toBe("5");
  await page
    .getByRole("button", { name: "Consultar estoque", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rede e histórico", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Total autorizado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("20", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("+10", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("button", { name: "Entrada de Livros", exact: true })
    .click();
  await page.getByRole("button", { name: "Adicionar manualmente" }).click();
  await page
    .getByRole("dialog")
    .locator("input[name=q]")
    .fill("Autor de demonstração");
  await page.getByRole("button", { name: "Buscar livro" }).click();
  await page
    .getByRole("button", {
      name: "Livro Teste Caramelo — Autor de demonstração",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Quantidade de Livro Teste Caramelo", { exact: true }),
  ).toHaveValue("1");
  await scan.fill("DEMO-NAO-CADASTRADO");
  await scan.press("Enter");
  await page.getByRole("button", { name: "Cadastrar livro" }).click();
  await expect(page.locator("input[name=barcode]")).toHaveValue(
    "DEMO-NAO-CADASTRADO",
  );
  for (const [name, value] of Object.entries({
    code: "DEMO-NOVO",
    description: "Livro novo na entrada",
    cost: "10",
    price: "30",
    minStock: "0",
  }))
    await page.locator(`input[name=${name}]`).fill(value);
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByLabel("Quantidade de Livro Teste Caramelo", { exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByLabel("Quantidade de Livro novo na entrada", { exact: true }),
  ).toHaveValue("1");
  await expect(scan).toBeFocused();
  await page.screenshot({
    path: `.local/stock-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  mkdirSync("work", { recursive: true });
  writeFileSync(
    `work/stock-e2e-${info.project.name}.json`,
    JSON.stringify(
      {
        book: book.description,
        initial: 0,
        afterFirst: 10,
        afterSecond: 15,
        branchA: await saldo(),
        branchB: await saldo(fixture.wb.id),
        networkTotal: 20,
        movements: movements.map((m) => ({
          quantity: String(m.quantity),
          before: String(m.beforeQuantity),
          after: String(m.afterQuantity),
          documentId: m.documentId,
          actorId: m.actorId,
        })),
        scannerThreeReads: true,
        manual: true,
        unknownCreatePreservesEntry: true,
      },
      null,
      2,
    ),
  );
});
