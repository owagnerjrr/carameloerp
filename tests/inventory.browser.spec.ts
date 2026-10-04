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
  first: string,
  second: string;
test.use({ baseURL: origin });
test.beforeAll(async () => {
  f = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 5000 });
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
  for (const [code, title, isbn, quantity] of [
    ["INV-BROWSER-A", "Livro inventariado A", "9788535914849", 6],
    ["INV-BROWSER-B", "Livro inventariado B", "9788535902778", 2],
  ] as const) {
    const p = await post("/products", {
      code,
      description: title,
      isbn13: isbn,
      price: "50",
      cost: "10",
      minStock: "0",
    });
    expect(p.statusCode, p.body).toBe(201);
    if (code.endsWith("A")) first = p.json().id;
    else second = p.json().id;
    const r = await post("/stock/entries", {
      requestKey: randomUUID(),
      warehouseId: f.wa.id,
      supplierId: f.supplier.id,
      receivedAt: "2026-10-04",
      items: [{ productId: p.json().id, quantity, unitCost: "10" }],
    });
    expect(r.statusCode, r.body).toBe(201);
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
test("inventário real: scanner, zero, recontagem, justificativa, aprovação, fechamento e histórico", async ({
  page,
}, info) => {
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
  await page.getByRole("button", { name: "Inventários", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inventários", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("F2");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Filial / depósito").selectOption(f.wa.id);
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Balanço físico navegador");
  await dialog
    .getByLabel("Responsável", { exact: true })
    .selectOption(f.users[0]!.member.id);
  await dialog.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Rascunho/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Iniciar contagem" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Em contagem/ }),
  ).toBeVisible();
  await page.keyboard.press("F4");
  const reader = page.getByLabel("Leitor de inventário");
  await expect(reader).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await reader.fill("9788535914849");
    await reader.press("Enter");
  }
  await expect(
    page.getByLabel("Quantidade Livro inventariado A", { exact: true }),
  ).toHaveValue("5");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Concluir contagem" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Zerar Livro inventariado B" })
    .click();
  await expect(
    page.getByLabel("Quantidade Livro inventariado B", { exact: true }),
  ).toHaveValue("0");
  expect(
    Number(
      (
        await db.stockBalance.findUniqueOrThrow({
          where: {
            companyId_warehouseId_productId: {
              companyId: f.company.id,
              warehouseId: f.wa.id,
              productId: first,
            },
          },
        })
      ).quantity,
    ),
  ).toBe(6);
  await page.getByRole("button", { name: "Concluir contagem" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Em revisão/ }),
  ).toBeVisible();
  await page.keyboard.press("F8");
  await page
    .getByRole("button", { name: "Recontar Livro inventariado A", exact: true })
    .click();
  await dialog
    .getByLabel("Observação / motivo")
    .fill("Recontagem independente de conferência");
  await dialog.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Recontagem necessária/ }),
  ).toBeVisible();
  await page.getByLabel("Exibir itens").selectOption("ALL");
  await page
    .getByLabel("Quantidade Livro inventariado A", { exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "Salvar Livro inventariado A", exact: true })
    .click();
  await expect(
    page.getByLabel("Quantidade Livro inventariado A", { exact: true }),
  ).toHaveValue("4");
  await expect(
    page.getByRole("button", { name: "Concluir contagem" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Concluir contagem" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Em revisão/ }),
  ).toBeVisible();
  for (const title of ["Livro inventariado A", "Livro inventariado B"]) {
    await page
      .getByRole("button", { name: "Justificar " + title, exact: true })
      .click();
    await dialog
      .getByLabel("Motivo", { exact: true })
      .selectOption("COUNT_ERROR");
    await dialog
      .getByLabel("Observação / motivo")
      .fill("Contagem física confirmada na revisão");
    await dialog.getByRole("button", { name: "Confirmar operação" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.getByRole("button", { name: "Aprovar inventário" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Aprovado/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Fechar inventário", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Finalizado/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Relatório e histórico" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fechar inventário", exact: true }),
  ).toHaveCount(0);
  const inv = await db.inventory.findFirstOrThrow({
    where: { companyId: f.company.id },
    include: {
      items: { include: { counts: { orderBy: { round: "asc" } } } },
      documents: { include: { movements: true } },
    },
  });
  expect(inv.status).toBe("CLOSED");
  expect(
    inv.items.find((i) => i.productId === first)?.counts.map((c) => c.quantity),
  ).toEqual([5, 4]);
  expect(
    inv.items.find((i) => i.productId === second)?.counts[0]?.quantity,
  ).toBe(0);
  expect(inv.documents).toHaveLength(1);
  expect(inv.documents[0]!.movements).toHaveLength(2);
  for (const [p, q] of [
    [first, 4],
    [second, 0],
  ] as const)
    expect(
      Number(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              companyId_warehouseId_productId: {
                companyId: f.company.id,
                warehouseId: f.wa.id,
                productId: p,
              },
            },
          })
        ).quantity,
      ),
    ).toBe(q);
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await page.getByLabel("Número", { exact: true }).fill(inv.code);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Abrir " + inv.code, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /INV-.*Finalizado/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
