import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { openTestCash } from "./cash-fixture.js";
import { csvCell } from "@caramelo/contracts";
const db = testDatabase(),
  origin = "http://localhost:5173";
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  restricted: string,
  session: string,
  customer: string;
const post = (url: string, payload: object, auth = cookie) =>
  app.inject({
    method: "POST",
    url,
    headers: { cookie: auth, origin },
    payload,
  });
const get = (url: string, auth = cookie) =>
  app.inject({ url, headers: { cookie: auth } });
const pay = (amount: string, method = "PIX", extra = {}) => ({
  method,
  amount,
  confirmed: true,
  installments: 1,
  ...extra,
});
async function book(price = "50", quantity = 10) {
  const r = await post("/api/products", {
    code: "DEMO-" + randomUUID().slice(0, 30),
    description: "Livro operação teste",
    author: "Autor fictício",
    publisher: "Editora fictícia",
    price,
    cost: "10",
    minStock: "1",
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().id as string;
  const e = await post("/api/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-27",
    items: [{ productId: id, quantity, unitCost: "10" }],
  });
  expect(e.statusCode, e.body).toBe(201);
  return { id, price };
}
const cart = (b: { id: string; price: string }, quantity = 1) => ({
  warehouseId: f.wa.id,
  items: [{ productId: b.id, quantity, expectedUnitPrice: b.price }],
  customerId: customer,
});
const saleInput = (b: { id: string; price: string }, quantity = 1) => ({
  requestKey: randomUUID(),
  cashSessionId: session,
  cart: cart(b, quantity),
  payments: [pay(String(Number(b.price) * quantity))],
});
async function sale(b: { id: string; price: string }, quantity = 1) {
  const r = await post("/api/sales", saleInput(b, quantity));
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
const balance = async (id: string) =>
  String(
    (
      await db.stockBalance.findUniqueOrThrow({
        where: {
          companyId_warehouseId_productId: {
            companyId: f.company.id,
            warehouseId: f.wa.id,
            productId: id,
          },
        },
      })
    ).quantity,
  );
const returnInput = (
  saleId: string,
  itemId: string,
  replacement?: { id: string; price: string },
  amount?: string,
) => ({
  requestKey: randomUUID(),
  originalSaleId: saleId,
  cashSessionId: session,
  customerId: customer,
  reason: "Cliente solicitou troca de teste",
  items: [{ saleItemId: itemId, quantity: 1 }],
  ...(replacement ? { replacement: cart(replacement) } : {}),
  payments: amount ? [pay(amount)] : [],
});
beforeAll(async () => {
  f = await stockFixture(db);
  other = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 3000 });
  for (const [i, u] of f.users.entries()) {
    const r = await post(
      "/api/auth/login",
      { company: f.company.slug, email: u.user.email, password: f.password },
      "",
    );
    const c = String(r.headers["set-cookie"]).split(";")[0]!;
    if (i === 0) cookie = c;
    else restricted = c;
  }
  customer = (
    await post("/api/customers", { name: "Cliente fictício de trocas" })
  ).json().id;
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("caixa: 200 + dinheiro100 + suprimento50 - sangria100 = 250; PIX50 separado; contado245 diferença-5", async () => {
  const b = await book();
  expect((await post("/api/sales", saleInput(b))).statusCode).toBe(409);
  const opened = await openTestCash(app, cookie, f.a.id, origin, "200");
  session = opened.id;
  const input = saleInput(b, 2);
  input.payments = [pay("100", "CASH", { receivedAmount: "150" })];
  const cash = await post("/api/sales", input);
  expect(cash.statusCode, cash.body).toBe(201);
  expect(cash.json().cashSessionId).toBe(session);
  expect(cash.json().payments[0].change).toBe("50");
  await sale(b);
  const supply = {
    requestKey: randomUUID(),
    kind: "SUPPLY",
    amount: "50",
    reason: "Reforço de troco",
  };
  expect(
    (await post("/api/cash/sessions/" + session + "/movements", supply))
      .statusCode,
  ).toBe(201);
  expect(
    (await post("/api/cash/sessions/" + session + "/movements", supply))
      .statusCode,
  ).toBe(201);
  expect(
    (
      await post("/api/cash/sessions/" + session + "/movements", {
        requestKey: randomUUID(),
        kind: "WITHDRAWAL",
        amount: "100",
        reason: "Retirada para cofre",
      })
    ).statusCode,
  ).toBe(201);
  const summary = (await get("/api/cash/sessions/" + session)).json().summary;
  expect(summary).toMatchObject({
    opening: "200.00",
    totalSold: "150.00",
    expected: "250.00",
    sales: { CASH: "100.00", PIX: "50.00" },
    supplies: "50.00",
    withdrawals: "100.00",
  });
  const close = {
    requestKey: randomUUID(),
    expectedAmount: "250",
    countedAmount: "245",
    notes: "Diferença de cinco reais na conferência",
  };
  expect(
    (await post("/api/cash/sessions/" + session + "/close", close)).statusCode,
  ).toBe(200);
  expect(
    (await post("/api/cash/sessions/" + session + "/close", close)).statusCode,
  ).toBe(200);
  const saved = await db.cashSession.findUniqueOrThrow({
    where: { id: session },
  });
  expect(saved.status).toBe("CLOSED");
  expect(String(saved.difference)).toBe("-5");
  expect(saved.closedById).toBe(f.users[0]!.member.id);
  expect(saved.closingSummary).toMatchObject({ expected: "250.00" });
  expect((await post("/api/sales", saleInput(b))).statusCode).toBe(409);
  for (const kind of ["SUPPLY", "WITHDRAWAL"])
    expect(
      (
        await post("/api/cash/sessions/" + session + "/movements", {
          requestKey: randomUUID(),
          kind,
          amount: "1",
          reason: "Movimento em caixa fechado",
        })
      ).statusCode,
    ).toBe(409);
  session = (await openTestCash(app, cookie, f.a.id, origin, "200")).id;
});
it("troca A50 por B70: A9→10, B5→4, PIX20, auditoria e estoque associados", async () => {
  const a = await book(),
    b = await book("70", 5),
    s = await sale(a);
  expect(await balance(a.id)).toBe("9");
  const input = returnInput(s.id, s.items[0].id, b, "20");
  const r = await post("/api/returns", input);
  expect(r.statusCode, r.body).toBe(201);
  const op = r.json();
  expect(op).toMatchObject({
    kind: "EXCHANGE",
    returnedAmount: "50",
    newAmount: "70",
    difference: "20",
  });
  expect(op.replacementSale.payments[0].amount).toBe("20");
  expect(op.replacementSale.exchangeCredit).toBe("50");
  expect(await balance(a.id)).toBe("10");
  expect(await balance(b.id)).toBe("4");
  expect(
    op.movements.map((m: { quantity: string }) => m.quantity).sort(),
  ).toEqual(["-1", "1"]);
  expect(
    await db.auditLog.count({
      where: { recordId: op.id, action: "EXCHANGE_COMPLETED" },
    }),
  ).toBe(1);
  const repeated = await post("/api/returns", input);
  expect(repeated.statusCode).toBe(201);
  expect(repeated.json().id).toBe(op.id);
  expect(await balance(b.id)).toBe("4");
  expect(
    (await post("/api/returns", { ...input, reason: "Outro motivo diferente" }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await post("/api/sales/" + s.id + "/cancel", {
        requestKey: randomUUID(),
        reason: "Não pode cancelar devolvida",
        refundConfirmed: true,
      })
    ).statusCode,
  ).toBe(409);
});
it("troca de mesmo valor não cria pagamento artificial", async () => {
  const a = await book(),
    c = await book(),
    s = await sale(a);
  const r = await post("/api/returns", returnInput(s.id, s.items[0].id, c));
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().difference).toBe("0");
  expect(r.json().replacementSale.payments).toEqual([]);
  expect(r.json().replacementSale.financialEntries).toEqual([]);
  expect(await balance(a.id)).toBe("10");
  expect(await balance(c.id)).toBe("9");
});
it("troca negativa gera vale20 do cliente e obrigação, sem estorno externo", async () => {
  const a = await book("70"),
    c = await book(),
    s = await sale(a);
  const r = await post("/api/returns", returnInput(s.id, s.items[0].id, c));
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().credit).toMatchObject({
    amount: "20",
    balance: "20",
    status: "AVAILABLE",
    customerId: customer,
  });
  expect(r.json().replacementSale.payments).toEqual([]);
  expect(
    await db.financialEntry.count({
      where: { returnId: r.json().id, type: "PAYABLE", amount: 20 },
    }),
  ).toBe(1);
});
it("devolução parcial só recompõe uma unidade e bloqueia excesso acumulado", async () => {
  const x = await book(),
    s = await sale(x, 2);
  const input = returnInput(s.id, s.items[0].id);
  expect((await post("/api/returns", input)).statusCode).toBe(201);
  expect(await balance(x.id)).toBe("9");
  const bad = {
    ...input,
    requestKey: randomUUID(),
    items: [{ saleItemId: s.items[0].id, quantity: 2 }],
  };
  expect((await post("/api/returns", bad)).statusCode).toBe(409);
  expect(await balance(x.id)).toBe("9");
  const second = await post("/api/returns", {
    ...input,
    requestKey: randomUUID(),
  });
  expect(second.statusCode, second.body).toBe(201);
  expect(second.json().credit.amount).toBe("50");
  expect(await balance(x.id)).toBe("10");
});
it("duas trocas disputam a última unidade sem saldo negativo", async () => {
  const a = await book(),
    b = await book("70", 1),
    s1 = await sale(a),
    s2 = await sale(a);
  const responses = await Promise.all([
    post("/api/returns", returnInput(s1.id, s1.items[0].id, b, "20")),
    post("/api/returns", returnInput(s2.id, s2.items[0].id, b, "20")),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(responses.find((r) => r.statusCode === 409)!.json().message).toBe(
    "Estoque insuficiente.",
  );
  expect(await balance(b.id)).toBe("0");
  expect(await balance(a.id)).toBe("9");
});
it("concorrência na quantidade devolvida da mesma venda permite só um retorno", async () => {
  const a = await book(),
    s = await sale(a);
  const rs = await Promise.all([
    post("/api/returns", returnInput(s.id, s.items[0].id)),
    post("/api/returns", returnInput(s.id, s.items[0].id)),
  ]);
  expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(await balance(a.id)).toBe("10");
});
it("rollback após retorno/saída intermediários reverte troca, pagamento, financeiro e auditoria", async () => {
  const a = await book(),
    b = await book("70", 5),
    s = await sale(a),
    input = returnInput(s.id, s.items[0].id, b, "20"),
    where = { companyId: f.company.id };
  const counts = async () =>
    Promise.all([
      db.returnOperation.count({ where }),
      db.returnItem.count({ where }),
      db.sale.count({ where }),
      db.payment.count({ where }),
      db.stockMovement.count({ where }),
      db.financialEntry.count({ where }),
      db.auditLog.count({ where }),
      db.cashMovement.count({ where }),
    ]);
  const before = await counts();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION return_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId"='${f.company.id}' THEN RAISE EXCEPTION 'TEST_RETURN_ROLLBACK'; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      'CREATE TRIGGER return_test_failure BEFORE INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION return_test_failure()',
    );
    expect((await post("/api/returns", input)).statusCode).toBe(500);
    expect(await balance(a.id)).toBe("9");
    expect(await balance(b.id)).toBe("5");
    expect(await counts()).toEqual(before);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS return_test_failure ON "Payment"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS return_test_failure()");
  }
  expect((await post("/api/returns", input)).statusCode).toBe(201);
});
it("rateia descontos e centavos sem devolver mais do que o valor pago", async () => {
  const b = await book(),
    input = saleInput(b, 3);
  const discounted = {
    ...input,
    cart: { ...input.cart, discount: { type: "AMOUNT", value: "0.01" } },
    payments: [pay("149.99")],
  };
  const r = await post("/api/sales", discounted);
  expect(r.statusCode, r.body).toBe(201);
  const s = r.json();
  const amounts = [];
  for (let i = 0; i < 3; i++) {
    const ret = await post("/api/returns", returnInput(s.id, s.items[0].id));
    expect(ret.statusCode, ret.body).toBe(201);
    amounts.push(ret.json().returnedAmount);
  }
  expect(amounts).toEqual(["49.99", "50", "50"]);
});
it("autoriza caixa e trocas por perfil/filial/empresa e bloqueia referência externa", async () => {
  expect((await get("/api/cash/options", restricted)).statusCode).toBe(403);
  const b = await book(),
    s = await sale(b);
  expect(
    (await post("/api/returns", returnInput(s.id, s.items[0].id), restricted))
      .statusCode,
  ).toBe(403);
  const login = await post(
    "/api/auth/login",
    {
      company: other.company.slug,
      email: other.users[0]!.user.email,
      password: other.password,
    },
    "",
  );
  const auth = String(login.headers["set-cookie"]).split(";")[0]!;
  expect((await get("/api/cash/sessions/" + session, auth)).statusCode).toBe(
    404,
  );
  expect(
    (await post("/api/returns", returnInput(s.id, s.items[0].id), auth))
      .statusCode,
  ).toBe(404);
  const role = await db.role.findFirstOrThrow({
    where: { companyId: f.company.id, name: "Estoque" },
  });
  for (const permissionCode of ["cash:read", "cash:operate", "returns:create"])
    await db.rolePermission.create({
      data: { roleId: role.id, permissionCode },
    });
  await db.membership.update({
    where: { id: f.users[1]!.member.id },
    data: { branchId: f.b.id },
  });
  expect(
    (await get("/api/cash/sessions/" + session, restricted)).statusCode,
  ).toBe(404);
  expect(
    (await post("/api/returns", returnInput(s.id, s.items[0].id), restricted))
      .statusCode,
  ).toBe(404);
});
it("consulta sem data, visões operacionais e CSV seguro", async () => {
  const b = await book(),
    s = await sale(b);
  const r = await get("/api/sales?number=" + s.number);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().total).toBe(1);
  for (const view of [
    "sales",
    "items",
    "cash",
    "operators",
    "payments",
    "hours",
    "periods",
  ]) {
    const res = await get("/api/sales/analysis?view=" + view);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().columns.length).toBeGreaterThan(2);
    expect(res.json().items.length).toBeGreaterThan(0);
  }
  const csv = await get("/api/sales/analysis?view=sales&csv=true");
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.body).toContain("Venda/pedido");
  expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
});
it("serializa abertura de terminal e fechamento concorrente com suprimento", async () => {
  const register = (
    await post("/api/cash/registers", {
      branchId: f.a.id,
      name: "Concorrência " + randomUUID().slice(0, 8),
    })
  ).json();
  const payload = {
    requestKey: randomUUID(),
    cashRegisterId: register.id,
    openingAmount: "200",
  };
  const opens = await Promise.all([
    post("/api/cash/sessions", payload),
    post("/api/cash/sessions", { ...payload, requestKey: randomUUID() }),
  ]);
  expect(opens.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  const id = opens.find((r) => r.statusCode === 201)!.json().id;
  const [close, move] = await Promise.all([
    post("/api/cash/sessions/" + id + "/close", {
      requestKey: randomUUID(),
      expectedAmount: "200",
      countedAmount: "200",
      notes: "",
    }),
    post("/api/cash/sessions/" + id + "/movements", {
      requestKey: randomUUID(),
      kind: "SUPPLY",
      amount: "50",
      reason: "Reforço concorrente",
    }),
  ]);
  expect([close.statusCode, move.statusCode].sort()).toEqual(
    close.statusCode === 200 ? [200, 409] : [201, 409],
  );
  const detail = (await get("/api/cash/sessions/" + id)).json();
  expect(detail.summary.expected).toBe(
    close.statusCode === 200 ? "200.00" : "250.00",
  );
  if (close.statusCode === 200)
    await expect(
      db.cashSession.update({
        where: { id },
        data: { notes: "Tentativa de alteração" },
      }),
    ).rejects.toThrow();
});
it("troca vários itens e retry simultâneo mantém uma operação; filtros de itens são exatos", async () => {
  const a = await book("50"),
    b = await book("30"),
    c = await book("60"),
    d = await book("40");
  await db.product.update({
    where: { id: a.id },
    data: { description: "Livro filtro exclusivo" },
  });
  const original = await post("/api/sales", {
    requestKey: randomUUID(),
    cashSessionId: session,
    cart: { ...cart(a), items: [...cart(a).items, ...cart(b).items] },
    payments: [pay("80")],
  });
  expect(original.statusCode, original.body).toBe(201);
  const s = original.json();
  const payload = {
    ...returnInput(s.id, s.items[0].id, c, "20"),
    items: s.items.map((i: { id: string }) => ({
      saleItemId: i.id,
      quantity: 1,
    })),
    replacement: { ...cart(c), items: [...cart(c).items, ...cart(d).items] },
  };
  const rs = await Promise.all([
    post("/api/returns", payload),
    post("/api/returns", payload),
  ]);
  expect(rs.map((r) => r.statusCode)).toEqual([201, 201]);
  expect(rs[0]!.json().id).toBe(rs[1]!.json().id);
  expect(rs[0]!.json().movements).toHaveLength(4);
  for (const i of [a, b]) expect(await balance(i.id)).toBe("10");
  for (const i of [c, d]) expect(await balance(i.id)).toBe("9");
  const query = await get(
    "/api/sales/analysis?view=items&number=" + s.number + "&book=exclusivo",
  );
  expect(query.statusCode, query.body).toBe(200);
  expect(query.json().total).toBe(1);
  expect(query.json().items[0].book).toBe("Livro filtro exclusivo");
  const filtered = await get(
    "/api/sales/analysis?operation=EXCHANGE&number=" +
      s.number +
      "&publisher=Editora&author=Autor&method=PIX&branchId=" +
      f.a.id,
  );
  expect(filtered.json().total).toBe(1);
});
