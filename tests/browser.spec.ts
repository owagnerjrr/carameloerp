import { test, expect } from "@playwright/test";
import { config } from "dotenv";
config({ quiet: true });
test("login, dashboard, cadastros, administração e logout", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("admin@caramelo.example");
  await page
    .getByLabel("Senha", { exact: true })
    .fill(process.env.SEED_DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Entrar no Caramelo" }).click();
  await expect(
    page.getByRole("heading", { name: "Olá, Administrador." }),
  ).toBeVisible();
  await expect(page.getByText("Fluxo de caixa", { exact: true })).toBeVisible();
  await expect(
    page.getByText("R$ 0,00", { exact: true }).first(),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "30 dias", exact: true }).click();
  await expect(page.getByText("Fluxo de caixa", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `.local/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  async function nav(name: string) {
    if (testInfo.project.name === "mobile")
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  await nav("Clientes");
  await expect(
    page.getByRole("heading", { name: "Clientes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Pesquisar clientes" })
    .fill("Aurora");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(
    page.getByRole("cell").filter({ hasText: "Mercado Aurora" }),
  ).toBeVisible();
  await nav("Produtos");
  await expect(
    page.getByRole("heading", { name: "Produtos", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await nav("Usuários e perfis");
  await expect(
    page.getByRole("heading", { name: "Usuários e perfis", exact: true }),
  ).toBeVisible();
  await nav("Auditoria");
  await expect(
    page.getByRole("heading", { name: "Auditoria", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bom ter você por aqui." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
