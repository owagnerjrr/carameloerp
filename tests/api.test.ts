import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createDatabase, type Database } from "@caramelo/database";
import { buildApp } from "../apps/api/src/app.js";
import { hashPassword, tokenHash } from "../apps/api/src/security.js";
import { permissions, rolePermissions } from "@caramelo/contracts";
import type { FastifyInstance } from "fastify";
config({ quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error(
    "Configure TEST_DATABASE_URL em um banco separado terminado em _test e aplique as migrations.",
  );
const origin = "http://localhost:5173";
const password = "Integration-Password-Only-2026";
let db: Database,
  app: FastifyInstance,
  companyA: string,
  companyB: string,
  adminA: string,
  adminB: string,
  sellerCookie: string,
  financeCookie: string,
  customerB: string,
  productB: string,
  categoryB: string,
  roleA: string,
  sellerId: string,
  adminCookie: string;
const cookie = (response: { headers: Record<string, unknown> }) =>
  String(response.headers["set-cookie"]).split(";")[0]!;
const login = (company: string, email: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { company, email, password },
  });
const get = (path: string, session = adminCookie) =>
  app.inject({
    method: "GET",
    url: `/api${path}`,
    headers: { cookie: session },
  });
const mutate = (
  method: "POST" | "PUT" | "PATCH",
  path: string,
  payload: unknown,
  session = adminCookie,
) =>
  app.inject({
    method,
    url: `/api${path}`,
    headers: { cookie: session, origin },
    payload: payload as object,
  });
beforeAll(async () => {
  db = createDatabase(url!);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Company", "User", "Permission" CASCADE',
  );
  const passwordHash = await hashPassword(password);
  for (const code of permissions)
    await db.permission.create({ data: { code, description: code } });
  for (const slug of ["tenant-a", "tenant-b"]) {
    const company = await db.company.create({ data: { slug, name: slug } });
    const companyId = company.id;
    if (slug === "tenant-a") companyA = companyId;
    else companyB = companyId;
    for (const name of ["Administrador", "Vendedor", "Financeiro"]) {
      const role = await db.role.create({
        data: {
          companyId,
          name,
          permissions: {
            create: rolePermissions[name]!.map((permissionCode) => ({
              permissionCode,
            })),
          },
        },
      });
      const user = await db.user.create({
        data: {
          name,
          email: `${name.toLowerCase()}@${slug}.example`,
          passwordHash,
        },
      });
      const member = await db.membership.create({
        data: { companyId, userId: user.id, roleId: role.id },
      });
      if (slug === "tenant-a" && name === "Administrador") {
        adminA = member.id;
        roleA = role.id;
      }
      if (slug === "tenant-b" && name === "Administrador") adminB = member.id;
      if (slug === "tenant-a" && name === "Vendedor") sellerId = member.id;
    }
  }
  const ca = await db.customer.create({
    data: { companyId: companyA, name: "Cliente A" },
  });
  customerB = (
    await db.customer.create({
      data: { companyId: companyB, name: "Cliente B confidencial" },
    })
  ).id;
  categoryB = (
    await db.category.create({
      data: { companyId: companyB, name: "Categoria B" },
    })
  ).id;
  const productA = await db.product.create({
    data: {
      companyId: companyA,
      code: "A",
      description: "Produto A",
      cost: 10,
      price: 25,
      minStock: 5,
    },
  });
  productB = (
    await db.product.create({
      data: {
        companyId: companyB,
        code: "B",
        description: "Produto B confidencial",
        cost: 10,
        price: 100,
      },
    })
  ).id;
  const branch = await db.branch.create({
    data: { companyId: companyA, name: "Matriz" },
  });
  await db.sale.create({
    data: {
      companyId: companyA,
      branchId: branch.id,
      customerId: ca.id,
      sellerId: adminA,
      number: 1,
      total: 50,
      status: "COMPLETED",
      createdAt: new Date("2026-09-10T15:00:00Z"),
      items: {
        create: {
          productId: productA.id,
          description: productA.description,
          unitPrice: 25,
          unitCost: 10,
          quantity: 2,
        },
      },
    },
  });
  const register = await db.cashRegister.create({
    data: { companyId: companyA, name: "Caixa" },
  });
  await db.cashMovement.createMany({
    data: [
      {
        companyId: companyA,
        cashRegisterId: register.id,
        amount: 50,
        description: "Recebimento",
        createdAt: new Date("2026-09-10T15:00:00Z"),
      },
      {
        companyId: companyA,
        cashRegisterId: register.id,
        amount: -15,
        description: "Despesa",
        createdAt: new Date("2026-09-10T16:00:00Z"),
      },
    ],
  });
  app = await buildApp({ db, origin, rateLimitMax: 10000 });
  adminCookie = cookie(
    await login("tenant-a", "administrador@tenant-a.example"),
  );
  sellerCookie = cookie(await login("tenant-a", "vendedor@tenant-a.example"));
  financeCookie = cookie(
    await login("tenant-a", "financeiro@tenant-a.example"),
  );
});
afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});
describe("API com PostgreSQL real", () => {
  it("verifica a disponibilidade do banco", async () => {
    expect((await app.inject("/api/health")).json()).toEqual({ status: "ok" });
  });
  it("protege rotas sem sessão", async () => {
    expect((await app.inject("/api/customers")).statusCode).toBe(401);
  });
  it("usa cookie HttpOnly/SameSite e armazena somente hash", async () => {
    const res = await login("tenant-a", "administrador@tenant-a.example");
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toContain("HttpOnly");
    expect(res.headers["set-cookie"]).toContain("SameSite=Lax");
    const token = cookie(res).split("=")[1]!;
    expect(
      await db.session.findUnique({ where: { tokenHash: token } }),
    ).toBeNull();
    expect(
      await db.session.findUnique({ where: { tokenHash: tokenHash(token) } }),
    ).not.toBeNull();
  });
  it("não aceita senha inválida ou empresa diferente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: {
        company: "tenant-b",
        email: "administrador@tenant-a.example",
        password,
      },
    });
    expect(res.statusCode).toBe(401);
  });
  it("não retorna segredos no perfil", async () => {
    const res = await get("/auth/me");
    expect(res.json().companyId).toBe(companyA);
    expect(res.body).not.toMatch(/passwordHash|tokenHash/);
  });
  it("isola listagens de clientes e produtos", async () => {
    expect((await get("/customers")).body).not.toContain("confidencial");
    expect((await get("/products")).body).not.toContain("confidencial");
  });
  it("não permite alterar cliente de outra empresa por ID", async () => {
    const res = await mutate("PUT", `/customers/${customerB}`, {
      name: "Invadido",
    });
    expect(res.statusCode).toBe(404);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customerB } })).name,
    ).toBe("Cliente B confidencial");
  });
  it("não permite alterar produto de outra empresa por ID", async () => {
    expect(
      (
        await mutate("PUT", `/products/${productB}`, {
          code: "B",
          description: "Invadido",
          cost: "1",
          price: "2",
          minStock: "0",
        })
      ).statusCode,
    ).toBe(404);
  });
  it("rejeita tenant enviado no corpo", async () => {
    expect(
      (
        await mutate("POST", "/customers", {
          name: "Invasor",
          companyId: companyB,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("rejeita categoria de outra empresa", async () => {
    expect(
      (
        await mutate("POST", "/products", {
          code: "BAD",
          description: "Produto",
          cost: "1",
          price: "2",
          minStock: "0",
          categoryId: categoryB,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("impede relações cruzadas no próprio banco", async () => {
    await expect(
      db.product.create({
        data: {
          companyId: companyA,
          code: "CROSS",
          description: "Inválido",
          cost: 0,
          price: 1,
          categoryId: categoryB,
        },
      }),
    ).rejects.toThrow();
  });
  it("impede valores negativos no próprio banco", async () => {
    await expect(
      db.product.create({
        data: {
          companyId: companyA,
          code: "NEG",
          description: "Inválido",
          cost: -1,
          price: 1,
        },
      }),
    ).rejects.toThrow();
  });
  it("vendedor não acessa administração nem indicadores financeiros", async () => {
    expect((await get("/users", sellerCookie)).statusCode).toBe(403);
    expect(
      (await get("/dashboard?from=2026-09-01&to=2026-09-30", sellerCookie))
        .statusCode,
    ).toBe(403);
  });
  it("financeiro não altera produtos", async () => {
    expect(
      (
        await mutate(
          "POST",
          "/products",
          {
            code: "F",
            description: "Produto",
            cost: "1",
            price: "2",
            minStock: "0",
          },
          financeCookie,
        )
      ).statusCode,
    ).toBe(403);
  });
  it("cria cliente com auditoria na mesma operação", async () => {
    const response = await mutate("POST", "/customers", {
      name: "Cliente criado",
      email: "novo@exemplo.invalid",
    });
    expect(response.statusCode).toBe(201);
    const row = response.json();
    expect(row.companyId).toBe(companyA);
    expect(
      await db.auditLog.findFirst({
        where: { companyId: companyA, recordId: row.id, action: "CREATE" },
      }),
    ).not.toBeNull();
  });
  it("edita e inativa um cliente", async () => {
    const row = (
      await mutate("POST", "/customers", { name: "Cliente edição" })
    ).json();
    const res = await mutate("PUT", `/customers/${row.id}`, {
      name: "Cliente atualizado",
      active: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);
  });
  it("cria produto, preserva decimais e detecta código duplicado", async () => {
    const payload = {
      code: "NEW",
      description: "Novo produto",
      cost: "12.25",
      price: "25.90",
      minStock: "2",
    };
    const res = await mutate("POST", "/products", payload);
    expect(res.statusCode).toBe(201);
    expect(res.json().price).toBe("25.9");
    expect((await mutate("POST", "/products", payload)).statusCode).toBe(409);
  });
  it("valida corpo e limites de paginação", async () => {
    expect((await mutate("POST", "/customers", { name: "" })).statusCode).toBe(
      400,
    );
    expect((await get("/products?limit=999")).statusCode).toBe(400);
  });
  it("protege mutações contra origem externa e ausente", async () => {
    for (const headers of [
      { cookie: adminCookie },
      { cookie: adminCookie, origin: "https://evil.example" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/customers",
            headers,
            payload: { name: "CSRF" },
          })
        ).statusCode,
      ).toBe(403);
  });
  it("calcula dashboard, caixa e ranking a partir do banco", async () => {
    const response = await get("/dashboard?from=2026-09-01&to=2026-09-30");
    expect(response.statusCode).toBe(200);
    const d = response.json();
    expect(d.revenue).toBe("50");
    expect(d.balance).toBe("35");
    expect(d.salesCount).toBe(1);
    expect(d.topProducts[0].quantity).toBe("2");
    expect(
      d.series.find((r: { date: string }) => r.date === "2026-09-10"),
    ).toEqual({ date: "2026-09-10", income: "50", expense: "15" });
    expect(d.lowStock.some((p: { id: string }) => p.id === productB)).toBe(
      false,
    );
  });
  it("filtro de período exclui vendas e rejeita datas inválidas", async () => {
    expect(
      (await get("/dashboard?from=2026-08-01&to=2026-08-31")).json().revenue,
    ).toBe("0");
    expect(
      (await get("/dashboard?from=2026-10-01&to=2026-09-01")).statusCode,
    ).toBe(400);
  });
  it("cria usuário sem retornar senha ou hash", async () => {
    const res = await mutate("POST", "/users", {
      name: "Novo usuário",
      email: "novo@tenant-a.example",
      password,
      roleId: roleA,
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("password");
    expect((await get("/users")).body).not.toContain("passwordHash");
  });
  it("impede alteração do próprio administrador e do acesso de outra empresa", async () => {
    expect(
      (
        await mutate("PATCH", `/users/${adminA}`, {
          roleId: roleA,
          active: false,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await mutate("PATCH", `/users/${adminB}`, {
          roleId: roleA,
          active: false,
        })
      ).statusCode,
    ).toBe(404);
  });
  it("revoga sessões ao desativar acesso", async () => {
    expect(
      (
        await mutate("PATCH", `/users/${sellerId}`, {
          roleId: roleA,
          active: false,
        })
      ).statusCode,
    ).toBe(200);
    expect((await get("/customers", sellerCookie)).statusCode).toBe(401);
  });
  it("sessões expiradas são rejeitadas", async () => {
    const token = "expired-session-for-test";
    await db.session.create({
      data: {
        membershipId: adminA,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (await get("/customers", `caramelo_session=${token}`)).statusCode,
    ).toBe(401);
  });
  it("logout revoga a sessão no servidor", async () => {
    const session = cookie(
      await login("tenant-b", "administrador@tenant-b.example"),
    );
    expect((await mutate("POST", "/auth/logout", {}, session)).statusCode).toBe(
      200,
    );
    expect((await get("/customers", session)).statusCode).toBe(401);
  });
  it("aplica rate limit ao login", async () => {
    let status = 0;
    for (let i = 0; i < 9; i++)
      status = (await login("tenant-a", "nonexistent@example.invalid"))
        .statusCode;
    expect(status).toBe(429);
  });
});
