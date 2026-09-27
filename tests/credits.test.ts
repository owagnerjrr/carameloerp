import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { openTestCash } from "./cash-fixture.js";
const db = testDatabase(),
  origin = "http://localhost:5173";
let f: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string = "",
  session: string,
  secondSession: string,
  secondWarehouse: string;
const post = (url: string, payload: object) =>
  app.inject({
    method: "POST",
    url: "/api" + url,
    headers: { cookie, origin },
    payload,
  });
const get = (url: string) =>
  app.inject({ url: "/api" + url, headers: { cookie } });
const pay = (amount: string, method = "STORE_CREDIT") => ({
  method,
  amount,
  installments: 1,
  confirmed: method !== "STORE_CREDIT",
  ...(method === "CASH" ? { receivedAmount: amount } : {}),
});
async function customer() {
  return (
    await post("/customers", {
      name: "Cliente vale fictício " + randomUUID().slice(0, 8),
    })
  ).json().id as string;
}
async function book(price = "50", warehouseId = f.wa.id) {
  const r = await post("/products", {
    code: "DEMO-" + randomUUID().slice(0, 24),
    description: "Livro vale fictício",
    price,
    cost: "1",
    minStock: "0",
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().id as string;
  const e = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-27",
    items: [{ productId: id, quantity: 20, unitCost: "1" }],
  });
  expect(e.statusCode, e.body).toBe(201);
  return { id, price, warehouseId };
}
function checkout(
  b: Awaited<ReturnType<typeof book>>,
  customerId: string | null,
  amount = b.price,
  method = "STORE_CREDIT",
  sessionId = session,
) {
  return {
    requestKey: randomUUID(),
    cashSessionId: sessionId,
    cart: {
      warehouseId: b.warehouseId,
      customerId,
      items: [{ productId: b.id, quantity: 1, expectedUnitPrice: b.price }],
    },
    payments: [pay(amount, method)],
  };
}
async function issue(customerId: string, amount = "50") {
  const b = await book(amount),
    s = await post("/sales", checkout(b, customerId, amount, "PIX"));
  expect(s.statusCode, s.body).toBe(201);
  const r = await post("/returns", {
    requestKey: randomUUID(),
    originalSaleId: s.json().id,
    cashSessionId: session,
    reason: "Emissão fictícia por devolução",
    items: [{ saleItemId: s.json().items[0].id, quantity: 1 }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().credit as { id: string; returnId: string };
}
const credit = (id: string) =>
  db.customerCredit.findUniqueOrThrow({ where: { id } });
const balance = async (b: Awaited<ReturnType<typeof book>>) =>
  String(
    (
      await db.stockBalance.findUniqueOrThrow({
        where: {
          companyId_warehouseId_productId: {
            companyId: f.company.id,
            warehouseId: b.warehouseId,
            productId: b.id,
          },
        },
      })
    ).quantity,
  );
beforeAll(async () => {
  f = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 4000 });
  const login = await post("/auth/login", {
    company: f.company.slug,
    email: f.users[0]!.user.email,
    password: f.password,
  });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  session = (await openTestCash(app, cookie, f.a.id, origin, "200")).id;
  secondSession = (await openTestCash(app, cookie, f.a.id, origin, "200")).id;
  secondWarehouse = (
    await db.warehouse.create({
      data: {
        companyId: f.company.id,
        branchId: f.a.id,
        name: "Segundo depósito para concorrência",
      },
    })
  ).id;
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await db.$disconnect();
});
it("vale total 50→0 USED, ISSUE/REDEEM e sem recebível externo artificial", async () => {
  const c = await customer(),
    v = await issue(c),
    b = await book(),
    r = await post("/sales", checkout(b, c));
  expect(r.statusCode, r.body).toBe(201);
  expect(String((await credit(v.id)).balance)).toBe("0");
  expect((await credit(v.id)).status).toBe("USED");
  expect(await balance(b)).toBe("19");
  expect(r.json().payments.map((p: { method: string }) => p.method)).toEqual([
    "STORE_CREDIT",
  ]);
  expect(r.json().financialEntries).toEqual([]);
  expect(
    r
      .json()
      .cashMovements.every(
        (m: { method: string }) => m.method === "STORE_CREDIT",
      ),
  ).toBe(true);
  const history = await db.customerCreditMovement.findMany({
    where: { creditId: v.id },
    orderBy: { createdAt: "asc" },
  });
  expect(
    history.map((m) => [
      m.kind,
      String(m.amount),
      String(m.beforeBalance),
      String(m.afterBalance),
    ]),
  ).toEqual([
    ["ISSUE", "50", "0", "50"],
    ["REDEEM", "-50", "50", "0"],
  ]);
  const title = await db.financialEntry.findFirstOrThrow({
    where: { returnId: v.returnId },
  });
  expect(title.status).toBe("SETTLED");
  expect(String(title.settledAmount)).toBe("50");
});
it("vale parcial 100→60 AVAILABLE e obrigação original preservada", async () => {
  const c = await customer(),
    v = await issue(c, "100"),
    r = await post("/sales", checkout(await book("40"), c));
  expect(r.statusCode, r.body).toBe(201);
  expect(String((await credit(v.id)).balance)).toBe("60");
  expect((await credit(v.id)).status).toBe("AVAILABLE");
  const title = await db.financialEntry.findFirstOrThrow({
    where: { returnId: v.returnId },
  });
  expect([
    String(title.amount),
    String(title.settledAmount),
    title.status,
  ]).toEqual(["100", "40", "OPEN"]);
});
it("FIFO usa 20 + 20 de dois vales 20/30; segundo conserva10", async () => {
  const c = await customer(),
    a = await issue(c, "20"),
    b = await issue(c, "30");
  await db.customerCredit.update({
    where: { id: a.id },
    data: { createdAt: new Date("2020-01-01") },
  });
  const r = await post("/sales", checkout(await book("40"), c));
  expect(r.statusCode, r.body).toBe(201);
  expect([
    String((await credit(a.id)).balance),
    (await credit(a.id)).status,
    String((await credit(b.id)).balance),
    (await credit(b.id)).status,
  ]).toEqual(["0", "USED", "10", "AVAILABLE"]);
});
it.each(["PIX", "CASH", "DEBIT_CARD", "CREDIT_CARD"])(
  "vale30 + %s70 conclui venda100 e mantém gaveta correta",
  async (method) => {
    const c = await customer(),
      v = await issue(c, "30"),
      b = await book("100");
    const before = (await get("/cash/sessions/" + session)).json().summary
      .expected;
    const input = checkout(b, c, "30");
    input.payments.push(pay("70", method));
    const r = await post("/sales", input);
    expect(r.statusCode, r.body).toBe(201);
    expect(String((await credit(v.id)).balance)).toBe("0");
    expect(r.json().payments.map((p: { amount: string }) => p.amount)).toEqual([
      "30",
      "70",
    ]);
    expect(r.json().financialEntries).toHaveLength(1);
    expect(r.json().financialEntries[0].amount).toBe("70");
    const after = (await get("/cash/sessions/" + session)).json().summary
      .expected;
    expect(Number(after) - Number(before)).toBe(method === "CASH" ? 70 : 0);
  },
);
it("rejeita cliente ausente, outro cliente, saldo insuficiente e crédito de outra filial", async () => {
  const c = await customer(),
    v = await issue(c, "20"),
    b = await book("30");
  for (const client of [null, await customer(), c]) {
    const r = await post("/sales", checkout(b, client));
    expect([400, 409]).toContain(r.statusCode);
    expect(await balance(b)).toBe("20");
  }
  const sb = (await openTestCash(app, cookie, f.b.id, origin)).id;
  const bb = await book("20", f.wb.id);
  expect(
    (await post("/sales", checkout(bb, c, "20", "STORE_CREDIT", sb)))
      .statusCode,
  ).toBe(409);
  expect(String((await credit(v.id)).balance)).toBe("20");
  const leaked = (
    await get("/credits?customerId=" + c + "&branchId=" + f.b.id)
  ).json();
  expect(leaked).toEqual([]);
});
it("dois caixas e depósitos distintos disputam vale50: somente uma venda e saldo0", async () => {
  const c = await customer(),
    v = await issue(c),
    a = await book(),
    b = await book("50", secondWarehouse);
  const rs = await Promise.all([
    post("/sales", checkout(a, c)),
    post("/sales", checkout(b, c, "50", "STORE_CREDIT", secondSession)),
  ]);
  expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(rs.find((r) => r.statusCode === 409)!.json().message).toContain(
    "Saldo de vale-crédito insuficiente",
  );
  expect(String((await credit(v.id)).balance)).toBe("0");
  expect(Number(await balance(a)) + Number(await balance(b))).toBe(39);
});
it("retry simultâneo da mesma venda consome vale e estoque uma única vez", async () => {
  const c = await customer(),
    v = await issue(c),
    b = await book(),
    input = checkout(b, c);
  const rs = await Promise.all([post("/sales", input), post("/sales", input)]);
  expect(rs.map((r) => r.statusCode)).toEqual([201, 201]);
  expect(rs[0]!.json().id).toBe(rs[1]!.json().id);
  expect(
    await db.customerCreditMovement.count({
      where: { creditId: v.id, kind: "REDEEM" },
    }),
  ).toBe(1);
  expect(await balance(b)).toBe("19");
});
it("falha após consumo do vale reverte saldo, título, venda, estoque e histórico", async () => {
  const c = await customer(),
    v = await issue(c),
    b = await book();
  const where = { companyId: f.company.id };
  const counts = async () =>
    Promise.all([
      db.sale.count({ where }),
      db.payment.count({ where }),
      db.customerCreditMovement.count({ where }),
      db.cashMovement.count({ where }),
      db.stockMovement.count({ where }),
      db.auditLog.count({ where }),
    ]);
  const before = await counts();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION credit_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId"='${f.company.id}' AND NEW.action='SALE_COMPLETED' THEN RAISE EXCEPTION 'TEST_CREDIT_ROLLBACK'; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      'CREATE TRIGGER credit_test_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION credit_test_failure()',
    );
    expect((await post("/sales", checkout(b, c))).statusCode).toBe(500);
    expect(String((await credit(v.id)).balance)).toBe("50");
    expect(await balance(b)).toBe("20");
    expect(await counts()).toEqual(before);
    expect(
      String(
        (
          await db.financialEntry.findFirstOrThrow({
            where: { returnId: v.returnId },
          })
        ).settledAmount,
      ),
    ).toBe("0");
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS credit_test_failure ON "AuditLog"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS credit_test_failure()");
  }
});
it("cancelamento idempotente restaura50 e registra REDEEM-30/RESTORE+30", async () => {
  const c = await customer(),
    v = await issue(c),
    b = await book("30"),
    r = await post("/sales", checkout(b, c));
  expect(r.statusCode, r.body).toBe(201);
  expect(String((await credit(v.id)).balance)).toBe("20");
  const closed = await db.cashSession.findUniqueOrThrow({
    where: { id: secondSession },
  });
  await db.cashSession.update({
    where: { id: closed.id },
    data: { openedById: f.users[1]!.member.id },
  });
  const input = {
    requestKey: randomUUID(),
    reason: "Cancelamento fictício do vale",
    refundConfirmed: true,
  };
  for (let i = 0; i < 2; i++)
    expect(
      (await post("/sales/" + r.json().id + "/cancel", input)).statusCode,
    ).toBe(200);
  expect(String((await credit(v.id)).balance)).toBe("50");
  expect(await balance(b)).toBe("20");
  expect(
    await db.customerCreditMovement.count({
      where: { creditId: v.id, kind: "RESTORE" },
    }),
  ).toBe(1);
  const history = (
    await get("/credits?customerId=" + c + "&branchId=" + f.a.id)
  ).json();
  expect(
    history[0].creditMovements.map((m: { kind: string }) => m.kind),
  ).toEqual(["ISSUE", "REDEEM", "RESTORE"]);
});
it("preserva observação de abertura e de fechamento separadamente", async () => {
  const reg = (
    await post("/cash/registers", {
      branchId: f.a.id,
      name: "Notas " + randomUUID().slice(0, 8),
    })
  ).json();
  const opened = await post("/cash/sessions", {
    requestKey: randomUUID(),
    cashRegisterId: reg.id,
    openingAmount: "200",
    notes: "Fundo inicial conferido",
  });
  const id = opened.json().id;
  expect(
    (
      await post("/cash/sessions/" + id + "/close", {
        requestKey: randomUUID(),
        expectedAmount: "200",
        countedAmount: "195",
        notes: "Diferença registrada no fechamento",
      })
    ).statusCode,
  ).toBe(200);
  const detail = (await get("/cash/sessions/" + id)).json();
  expect(detail.openingNotes).toBe("Fundo inicial conferido");
  expect(detail.closingNotes).toBe("Diferença registrada no fechamento");
  expect(detail.difference).toBe("-5");
});
it("CPF/CNPJ com e sem pontuação localizam cliente e venda sem alterar documento", async () => {
  for (const [stored, formatted] of [
    ["12345678900", "123.456.789-00"],
    ["12ABC34501DE35", "12.abc.345/01de-35"],
  ]) {
    const c = await db.customer.create({
      data: {
        companyId: f.company.id,
        name: "Cliente legado fictício",
        document: stored,
      },
    });
    const r = await post("/sales", checkout(await book(), c.id, "50", "PIX"));
    expect(r.statusCode, r.body).toBe(201);
    for (const value of [stored, formatted]) {
      expect(
        (await get("/customers?q=" + encodeURIComponent(value!)))
          .json()
          .items.some((i: { id: string }) => i.id === c.id),
      ).toBe(true);
      expect(
        (
          await get(
            "/sales/analysis?customerQuery=" + encodeURIComponent(value!),
          )
        )
          .json()
          .items.some((i: { id: string }) => i.id === r.json().id),
      ).toBe(true);
    }
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).document,
    ).toBe(stored);
  }
});
it("ranking líquido 10 vendidos - 3 devolvidos = 7 no período", async () => {
  const c = await customer(),
    b = await book("10"),
    input = checkout(b, c, "100", "PIX");
  input.cart.items[0]!.quantity = 10;
  const s = await post("/sales", input);
  expect(s.statusCode, s.body).toBe(201);
  const ret = await post("/returns", {
    requestKey: randomUUID(),
    originalSaleId: s.json().id,
    cashSessionId: session,
    reason: "Retorno de três unidades",
    items: [{ saleItemId: s.json().items[0].id, quantity: 3 }],
  });
  expect(ret.statusCode, ret.body).toBe(201);
  await db.sale.update({
    where: { id: s.json().id },
    data: { createdAt: new Date("2099-01-10T12:00:00Z") },
  });
  await db.returnOperation.update({
    where: { id: ret.json().id },
    data: { createdAt: new Date("2099-01-11T12:00:00Z") },
  });
  const d = await get("/dashboard?from=2099-01-01&to=2099-01-31");
  expect(d.statusCode, d.body).toBe(200);
  expect(d.json().topProducts[0].quantity).toBe("7");
  expect(d.json()).toMatchObject({
    grossRevenue: "100",
    returnsAmount: "30",
    revenue: "70",
    salesCount: 1,
    averageTicket: "70.00",
  });
});
it("retorno posterior entra pela data; reposição não duplica contagem/ticket", async () => {
  const c = await customer(),
    a = await book(),
    b = await book("70"),
    s = await post("/sales", checkout(a, c, "50", "PIX"));
  const r = await post("/returns", {
    requestKey: randomUUID(),
    originalSaleId: s.json().id,
    cashSessionId: session,
    reason: "Troca em outro período",
    items: [{ saleItemId: s.json().items[0].id, quantity: 1 }],
    replacement: {
      warehouseId: f.wa.id,
      customerId: c,
      items: [{ productId: b.id, quantity: 1, expectedUnitPrice: "70" }],
    },
    payments: [pay("20", "PIX")],
  });
  expect(r.statusCode, r.body).toBe(201);
  await db.sale.update({
    where: { id: s.json().id },
    data: { createdAt: new Date("2099-03-31T12:00:00Z") },
  });
  await db.sale.update({
    where: { id: r.json().replacementSale.id },
    data: { createdAt: new Date("2099-04-01T12:00:00Z") },
  });
  await db.returnOperation.update({
    where: { id: r.json().id },
    data: { createdAt: new Date("2099-04-01T12:00:00Z") },
  });
  for (const [from, to, gross, returns, net, count] of [
    ["2099-03-01", "2099-03-31", "50", "0", "50", 1],
    ["2099-04-01", "2099-04-30", "70", "50", "20", 0],
    ["2099-03-01", "2099-04-30", "120", "50", "70", 1],
  ] as const) {
    const d = (await get("/dashboard?from=" + from + "&to=" + to)).json();
    expect(d).toMatchObject({
      grossRevenue: gross,
      returnsAmount: returns,
      revenue: net,
      salesCount: count,
    });
    if (!count) expect(d.averageTicket).toBeNull();
    const q = (
      await get("/sales/analysis?view=operators&from=" + from + "&to=" + to)
    ).json();
    expect(q.items[0].count).toBe(count);
    expect(Number(q.items[0].total)).toBe(Number(net));
  }
});
