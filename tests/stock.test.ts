import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { testDatabase, stockFixture } from "./stock-fixture.js";
import {
  validIsbn10,
  validEan13,
  isbn10to13,
  identifier,
  productSchema,
  addScanned,
} from "@caramelo/contracts";
const db = testDatabase();
let fixture: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  restricted: string,
  book: string;
const origin = "http://localhost:5173";
const post = (url: string, payload: unknown, session = cookie) =>
  app.inject({
    method: "POST",
    url,
    headers: { origin, cookie: session },
    payload: payload as object,
  });
const get = (url: string, session = cookie) =>
  app.inject({ method: "GET", url, headers: { cookie: session } });
const entry = (
  quantity: number,
  warehouseId = fixture.wa.id,
  productId = book,
) => ({
  requestKey: randomUUID(),
  warehouseId,
  supplierId: fixture.supplier.id,
  receivedAt: "2026-09-26",
  items: [{ productId, quantity, unitCost: "20.00" }],
});
const balance = async (warehouseId = fixture.wa.id, productId = book) =>
  String(
    (
      await db.stockBalance.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: fixture.company.id,
            warehouseId,
            productId,
          },
        },
      })
    )?.quantity ?? 0,
  );
beforeAll(async () => {
  fixture = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 1000 });
  for (const [i, u] of fixture.users.entries()) {
    const r = await post(
      "/api/auth/login",
      {
        company: fixture.company.slug,
        email: u.user.email,
        password: fixture.password,
      },
      "",
    );
    expect(r.statusCode).toBe(200);
    const value = String(r.headers["set-cookie"]).split(";")[0]!;
    if (i === 0) cookie = value;
    else restricted = value;
  }
  const r = await post("/api/products", {
    code: "DEMO-LIVRO-TESTE",
    barcode: "DEMO-CARAMELO-0001",
    description: "Livro Teste Caramelo",
    author: "Autor de demonstração",
    publisher: "Editora de demonstração",
    price: "50.00",
    cost: "20.00",
    minStock: "2",
  });
  expect(r.statusCode).toBe(201);
  book = r.json().id;
});
afterAll(async () => {
  await app?.close();
  await fixture?.cleanup();
  await db.$disconnect();
});
it("valida ISBN sem atribuir ISBN real a livros de demonstração", () => {
  expect(validIsbn10("0-306-40615-2")).toBe(true);
  expect(isbn10to13("0306406152")).toBe("9780306406157");
  expect(validEan13("9780306406157")).toBe(true);
  expect(identifier("0-306-40615-2")).toBe("9780306406157");
  expect(validIsbn10("0306406153")).toBe(false);
  expect(validEan13("9780306406158")).toBe(false);
  expect(
    productSchema.safeParse({
      code: "X",
      description: "Livro teste",
      cost: "20",
      price: "50",
      minStock: "0",
      isbn13: "9780306406158",
    }).success,
  ).toBe(false);
});
it("localiza código exato e pesquisa por autor; bloqueia código duplicado", async () => {
  expect(
    (await get("/api/products/lookup?code=demo-caramelo-0001")).json().id,
  ).toBe(book);
  expect(
    (await get("/api/products?q=Autor%20de%20demonstra%C3%A7%C3%A3o")).json()
      .items[0].id,
  ).toBe(book);
  expect((await get("/api/products/lookup?code=INEXISTENTE")).statusCode).toBe(
    404,
  );
  expect(
    (
      await post("/api/products", {
        code: "OUTRO",
        barcode: "demo-caramelo-0001",
        description: "Outro livro",
        cost: "1",
        price: "2",
        minStock: "0",
      })
    ).statusCode,
  ).toBe(409);
});
it("leitura repetida acumula três exemplares", () => {
  const b = { id: "test" };
  let rows: Array<{ book: typeof b; quantity: number; unitCost: string }> = [];
  for (let i = 0; i < 3; i++) rows = addScanned(rows, b, "20");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.quantity).toBe(3);
});
it("persiste 0 → 10 → 15 e histórico +10/+5, com idempotência", async () => {
  expect(await balance()).toBe("0");
  const first = entry(10);
  expect((await post("/api/stock/entries", first)).statusCode).toBe(201);
  expect(await balance()).toBe("10");
  expect((await post("/api/stock/entries", first)).statusCode).toBe(201);
  expect(await balance()).toBe("10");
  expect(
    (
      await post("/api/stock/entries", {
        ...first,
        items: [{ ...first.items[0], quantity: 12 }],
      })
    ).statusCode,
  ).toBe(409);
  expect((await post("/api/stock/entries", entry(5))).statusCode).toBe(201);
  expect(await balance()).toBe("15");
  const m = await db.stockMovement.findMany({
    where: { companyId: fixture.company.id, productId: book },
    orderBy: { createdAt: "asc" },
  });
  expect(
    m.map((x) => [
      String(x.quantity),
      String(x.beforeQuantity),
      String(x.afterQuantity),
    ]),
  ).toEqual([
    ["10", "0", "10"],
    ["5", "10", "15"],
  ]);
  expect(
    m.every((x) => x.actorId === fixture.users[0]!.member.id && x.documentId),
  ).toBe(true);
});
it("mantém A15 e B5 independentes e total20; restringe leitura/escrita por filial", async () => {
  expect(
    (await post("/api/stock/entries", entry(5, fixture.wb.id))).statusCode,
  ).toBe(201);
  expect(await balance()).toBe("15");
  expect(await balance(fixture.wb.id)).toBe("5");
  expect((await get("/api/stock/books/" + book)).json().total).toBe("20");
  expect((await get("/api/stock/books/" + book, restricted)).json().total).toBe(
    "15",
  );
  expect(
    (await post("/api/stock/entries", entry(1, fixture.wb.id), restricted))
      .statusCode,
  ).toBe(404);
  expect(
    (await get("/api/stock?branchId=" + fixture.b.id, restricted)).json().items,
  ).toHaveLength(0);
  expect((await get("/api/products", restricted)).json().items[0].stock).toBe(
    15,
  );
  expect(
    (await get("/api/stock/movements", restricted))
      .json()
      .items.every(
        (x: { warehouse: { branchId: string } }) =>
          x.warehouse.branchId === fixture.a.id,
      ),
  ).toBe(true);
});
it("rollback após saldo atualizado quando outro item falha", async () => {
  const before = await db.stockDocument.count({
    where: { companyId: fixture.company.id },
  });
  const r = await post("/api/stock/entries", {
    ...entry(7),
    items: [
      { productId: book, quantity: 7, unitCost: "20" },
      {
        productId: "ffffffff-ffff-4fff-afff-ffffffffffff",
        quantity: 1,
        unitCost: "10",
      },
    ],
  });
  expect(r.statusCode).toBe(400);
  expect(await balance()).toBe("15");
  expect(
    await db.stockDocument.count({ where: { companyId: fixture.company.id } }),
  ).toBe(before);
  expect(
    await db.stockMovement.count({ where: { companyId: fixture.company.id } }),
  ).toBe(3);
});
it("serializa entradas concorrentes e repetição concorrente sem perder saldo", async () => {
  const other = (
    await post("/api/products", {
      code: "DEMO-CONC",
      description: "Livro concorrência",
      cost: "1",
      price: "2",
      minStock: "0",
    })
  ).json().id;
  const payload = entry(10, fixture.wa.id, other);
  const requests = await Promise.all([
    post("/api/stock/entries", payload),
    post("/api/stock/entries", payload),
    post("/api/stock/entries", entry(5, fixture.wa.id, other)),
  ]);
  expect(requests.map((r) => r.statusCode)).toEqual([201, 201, 201]);
  expect(await balance(fixture.wa.id, other)).toBe("15");
  expect(
    await db.stockMovement.count({
      where: { companyId: fixture.company.id, productId: other },
    }),
  ).toBe(2);
});
it("ajusta contagem 10 → 8 com movimento -2 e rejeita saldo desatualizado", async () => {
  const other = (
    await post("/api/products", {
      code: "DEMO-AJUSTE",
      description: "Livro ajuste",
      cost: "1",
      price: "2",
      minStock: "0",
    })
  ).json().id;
  await post("/api/stock/entries", entry(10, fixture.wa.id, other));
  const payload = {
    requestKey: randomUUID(),
    warehouseId: fixture.wa.id,
    productId: other,
    expectedQuantity: "10",
    quantity: 8,
    reason: "Divergência encontrada no inventário.",
  };
  const r = await post("/api/stock/adjustments", payload);
  expect(r.statusCode).toBe(201);
  expect(await balance(fixture.wa.id, other)).toBe("8");
  expect(r.json().movements[0]).toMatchObject({
    quantity: "-2",
    beforeQuantity: "10",
    afterQuantity: "8",
  });
  expect(
    (
      await post("/api/stock/adjustments", {
        ...payload,
        requestKey: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await post("/api/stock/adjustments", {
        ...payload,
        requestKey: randomUUID(),
        expectedQuantity: "8",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    await db.auditLog.count({
      where: { companyId: fixture.company.id, action: "ADJUST" },
    }),
  ).toBe(1);
});
it("valida entrada e não permite dados de outra empresa", async () => {
  expect(
    (await post("/api/stock/entries", { ...entry(1), companyId: randomUUID() }))
      .statusCode,
  ).toBe(400);
  expect((await post("/api/stock/entries", entry(-1))).statusCode).toBe(400);
  expect(
    (
      await post("/api/stock/entries", {
        ...entry(1),
        supplierId: randomUUID(),
      })
    ).statusCode,
  ).toBe(400);
  expect((await get("/api/stock/books/" + randomUUID())).statusCode).toBe(404);
  expect((await post("/api/stock/entries", entry(1), "")).statusCode).toBe(401);
});
