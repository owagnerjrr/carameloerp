import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { openTestCash } from "./cash-fixture.js";
import { financialToday } from "../apps/api/src/services/payables.js";
const db = testDatabase(),
  origin = "http://localhost:5173",
  today = financialToday();
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  outsider = "",
  operator = "",
  productId = "",
  sessionId = "";
const post = (path: string, payload: object, auth = cookie) =>
  app.inject({
    method: "POST",
    url: "/api" + path,
    headers: { origin, cookie: auth },
    payload,
  });
const get = (path: string, auth = cookie) =>
  app.inject({ url: "/api" + path, headers: { cookie: auth } });
async function sale(method = "CREDIT_CARD", amount = "100", installments = 1) {
  const input = {
    requestKey: randomUUID(),
    cashSessionId: sessionId,
    cart: {
      warehouseId: f.wa.id,
      items: [{ productId, quantity: 1, expectedUnitPrice: amount }],
    },
    payments: [
      {
        method,
        amount,
        installments,
        confirmed: true,
        ...(method === "CASH" ? { receivedAmount: amount } : {}),
      },
    ],
  };
  await db.product.update({
    where: { id: productId },
    data: { price: amount },
  });
  const r = await post("/sales", input);
  expect(r.statusCode, r.body).toBe(201);
  const row = r.json();
  const saleId = row.saleId ?? row.id;
  const entries = await db.financialEntry.findMany({
    where: { companyId: f.company.id, saleId },
    orderBy: { installment: "asc" },
  });
  expect(entries.length).toBe(installments);
  return { id: saleId as string, entryId: entries[0]!.id, entries, input };
}
const receive = (
  id: string,
  amount: string,
  key = randomUUID(),
  auth = cookie,
) =>
  post(
    `/receivables/${id}/receipts`,
    { requestKey: key, amount, receivedAt: today },
    auth,
  );
const detail = async (id: string) => (await get("/receivables/" + id)).json();
const cancel = (id: string, key = randomUUID()) =>
  post(`/sales/${id}/cancel`, {
    requestKey: key,
    reason: "Cancelamento financeiro de teste",
    refundConfirmed: true,
  });
beforeAll(async () => {
  f = await stockFixture(db);
  other = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 10000 });
  for (const [fixture, index, name] of [
    [f, 0, "admin"],
    [f, 1, "operator"],
    [other, 0, "other"],
  ] as const) {
    const r = await post(
      "/auth/login",
      {
        company: fixture.company.slug,
        email: fixture.users[index]!.user.email,
        password: fixture.password,
      },
      "",
    );
    expect(r.statusCode).toBe(200);
    const c = String(r.headers["set-cookie"]).split(";")[0]!;
    if (name === "admin") cookie = c;
    else if (name === "operator") operator = c;
    else outsider = c;
  }
  sessionId = (await openTestCash(app, cookie, f.a.id, origin, "1000")).id;
  const p = await post("/products", {
    code: "RECEIVABLE",
    description: "Livro recebíveis teste",
    cost: "10",
    price: "100",
    minStock: "0",
  });
  expect(p.statusCode, p.body).toBe(201);
  productId = p.json().id;
  const stock = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: today,
    items: [{ productId, quantity: 100, unitCost: "10" }],
  });
  expect(stock.statusCode, stock.body).toBe(201);
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("dinheiro é realizado e não fica pendente", async () => {
  const s = await sale("CASH");
  const d = await detail(s.entryId);
  expect([d.situation, d.balance, d.settlements.length]).toEqual([
    "PAID",
    "0.00",
    1,
  ]);
  expect(d.settlements[0].kind).toBe("RECEIPT");
});
it("PIX manual é realizado sem duplicar lançamento", async () => {
  const s = await sale("PIX");
  const d = await detail(s.entryId);
  expect([d.paid, d.balance, d.settlements.length]).toEqual([
    "100.00",
    "0.00",
    1,
  ]);
});
it("débito gera previsão e fica aberto", async () => {
  const s = await sale("DEBIT_CARD");
  const d = await detail(s.entryId);
  expect(d.situation).toBe("PENDING");
  expect(d.settlements).toHaveLength(0);
  expect(d.dueDate.slice(0, 10)).toBe(
    new Date(new Date(today).getTime() + 86400000).toISOString().slice(0, 10),
  );
});
it("crédito 100/3 preserva centavos e vínculo da venda", async () => {
  const s = await sale("CREDIT_CARD", "100", 3);
  expect(s.entries.map((e) => String(e.amount))).toEqual([
    "33.34",
    "33.33",
    "33.33",
  ]);
  expect(s.entries.every((e) => e.saleId === s.id)).toBe(true);
  expect(new Set(s.entries.map((e) => e.dueDate.toISOString())).size).toBe(3);
});
it("baixa total zera saldo", async () => {
  const s = await sale();
  expect((await receive(s.entryId, "100")).statusCode).toBe(200);
  const d = await detail(s.entryId);
  expect([d.situation, d.balance, d.paid]).toEqual(["PAID", "0.00", "100.00"]);
});
it("baixa parcial 40 + 60 preserva valor original", async () => {
  const s = await sale();
  expect((await receive(s.entryId, "40")).statusCode).toBe(200);
  let d = await detail(s.entryId);
  expect([d.situation, d.balance]).toEqual(["PARTIAL", "60.00"]);
  expect((await receive(s.entryId, "60")).statusCode).toBe(200);
  d = await detail(s.entryId);
  expect([
    d.situation,
    d.balance,
    String(d.amount),
    d.settlements.length,
  ]).toEqual(["PAID", "0.00", "100", 2]);
});
it("rejeita excedente e zero", async () => {
  const s = await sale();
  expect((await receive(s.entryId, "101")).statusCode).toBe(400);
  expect((await receive(s.entryId, "0")).statusCode).toBe(400);
  expect((await detail(s.entryId)).balance).toBe("100.00");
});
it("retry concorrente retorna a mesma baixa uma vez", async () => {
  const s = await sale(),
    key = randomUUID();
  const r = await Promise.all([
    receive(s.entryId, "40", key),
    receive(s.entryId, "40", key),
  ]);
  expect(r.map((x) => x.statusCode)).toEqual([200, 200]);
  expect(r[0]!.json()).toEqual(r[1]!.json());
  expect((await detail(s.entryId)).settlements).toHaveLength(1);
});
it("requestKey com outro conteúdo rejeita", async () => {
  const s = await sale(),
    key = randomUUID();
  await receive(s.entryId, "40", key);
  expect((await receive(s.entryId, "41", key)).statusCode).toBe(409);
});
it("concorrência não baixa o mesmo saldo duas vezes", async () => {
  const s = await sale();
  const r = await Promise.all([
    receive(s.entryId, "100"),
    receive(s.entryId, "100"),
  ]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  expect((await detail(s.entryId)).settlements).toHaveLength(1);
});
it("cancelamento sem baixa cancela previsão", async () => {
  const s = await sale();
  const r = await cancel(s.id);
  expect(r.statusCode, r.body).toBe(200);
  const d = await detail(s.entryId);
  expect([d.situation, d.balance, d.settlements.length]).toEqual([
    "CANCELLED",
    "0.00",
    0,
  ]);
  expect((await receive(s.entryId, "100")).statusCode).toBe(409);
});
it("cancelamento após baixa parcial preserva e reverte histórico", async () => {
  const s = await sale();
  await receive(s.entryId, "40");
  const key = randomUUID();
  expect((await cancel(s.id, key)).statusCode).toBe(200);
  expect((await cancel(s.id, key)).statusCode).toBe(200);
  const d = await detail(s.entryId);
  expect(d.settlements.map((x: { kind: string }) => x.kind).sort()).toEqual([
    "RECEIPT",
    "REVERSAL",
  ]);
  expect(d.paid).toBe("40.00");
  expect(
    d.history.some(
      (h: { action: string }) => h.action === "RECEIVABLE_REVERSED",
    ),
  ).toBe(true);
});
it("baixa versus cancelamento concorrente termina consistente", async () => {
  const s = await sale();
  const r = await Promise.all([receive(s.entryId, "100"), cancel(s.id)]);
  expect(r[1]!.statusCode).toBe(200);
  expect([200, 409]).toContain(r[0]!.statusCode);
  const d = await detail(s.entryId);
  expect(d.situation).toBe("CANCELLED");
  expect(
    d.settlements.filter((x: { kind: string }) => x.kind === "RECEIPT").length,
  ).toBe(
    d.settlements.filter((x: { kind: string }) => x.kind === "REVERSAL").length,
  );
});
it("falha intermediária faz rollback de baixa e auditoria", async () => {
  const s = await sale(),
    key = randomUUID();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION receivable_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entryId"='${s.entryId}'::uuid THEN RAISE EXCEPTION 'rollback test'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER receivable_test_failure AFTER INSERT ON "FinancialSettlement" FOR EACH ROW EXECUTE FUNCTION receivable_test_failure()',
  );
  try {
    expect((await receive(s.entryId, "40", key)).statusCode).toBe(500);
    const d = await detail(s.entryId);
    expect(d.balance).toBe("100.00");
    expect(d.settlements).toHaveLength(0);
    expect(d.history).toHaveLength(1);
    expect(await db.financialAction.count({ where: { requestKey: key } })).toBe(
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER receivable_test_failure ON "FinancialSettlement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION receivable_test_failure()");
  }
  expect((await receive(s.entryId, "40", key)).statusCode).toBe(200);
});
it("outra empresa não consulta nem baixa", async () => {
  const s = await sale();
  expect((await get("/receivables/" + s.entryId, outsider)).statusCode).toBe(
    404,
  );
  expect(
    (await receive(s.entryId, "40", randomUUID(), outsider)).statusCode,
  ).toBe(404);
});
it("perfil estoque não opera financeiro", async () => {
  const s = await sale();
  expect((await get("/receivables", operator)).statusCode).toBe(403);
  expect(
    (await receive(s.entryId, "40", randomUUID(), operator)).statusCode,
  ).toBe(403);
});
it("filial limita consulta e alteração mesmo com permissão financeira", async () => {
  const s = await sale();
  const member = await db.membership.findUniqueOrThrow({
    where: { id: f.users[1]!.member.id },
  });
  for (const permissionCode of [
    "receivables:read",
    "receivables:receive",
    "finance:read",
  ])
    await db.rolePermission.create({
      data: { roleId: member.roleId, permissionCode },
    });
  await db.membership.update({
    where: { id: member.id },
    data: { branchId: f.b.id },
  });
  try {
    expect((await get("/receivables/" + s.entryId, operator)).statusCode).toBe(
      404,
    );
    expect(
      (await receive(s.entryId, "40", randomUUID(), operator)).statusCode,
    ).toBe(404);
    expect(
      (await get("/finance?branchId=" + f.a.id, operator)).statusCode,
    ).toBe(404);
    expect((await get("/receivables", operator)).json().total).toBe(0);
  } finally {
    await db.membership.update({
      where: { id: member.id },
      data: { branchId: f.a.id },
    });
  }
});
it("financeiro separa realizado de previsão e não duplica dinheiro", async () => {
  const before = await get(`/finance?from=${today}&to=2099-01-01`);
  expect(before.statusCode).toBe(400);
  const query = `/finance?from=${today}&to=${today}`,
    a = (await get(query)).json();
  await sale("PIX", "50");
  const b = (await get(query)).json();
  expect(Number(b.received) - Number(a.received)).toBe(50);
  expect(Number(b.realized) - Number(a.realized)).toBe(50);
  expect(Number(b.receivable) - Number(a.receivable)).toBe(0);
});
it("recebíveis abertos entram na previsão", async () => {
  const a = (await get("/finance")).json();
  await sale("DEBIT_CARD", "75");
  const b = (await get("/finance")).json();
  expect(Number(b.forecastIn) - Number(a.forecastIn)).toBe(75);
  expect(Number(b.received) - Number(a.received)).toBe(0);
});
it("contas a pagar geram saída prevista e pagamento vira realizado", async () => {
  const cat = await post("/payables/categories", {
    name: "Receivables integration",
  });
  const a = (await get("/finance")).json();
  const c = await post("/payables", {
    requestKey: randomUUID(),
    branchId: f.a.id,
    categoryId: cat.json().id,
    origin: "MANUAL",
    description: "Despesa integrada",
    issuedAt: today,
    competence: today,
    amount: "80",
    dueDates: [today],
  });
  expect(c.statusCode, c.body).toBe(201);
  const b = (await get("/finance")).json();
  expect(Number(b.forecastOut) - Number(a.forecastOut)).toBe(80);
  await post("/payables/" + c.json().entryIds[0] + "/payments", {
    requestKey: randomUUID(),
    amount: "30",
    paidAt: today,
    method: "PIX",
  });
  const d = (await get("/finance")).json();
  expect(Number(d.paid) - Number(b.paid)).toBe(30);
  expect(Number(d.forecastOut) - Number(b.forecastOut)).toBe(-30);
});
it("filtros de filial forma origem texto status e período", async () => {
  const s = await sale("DEBIT_CARD");
  const d = await detail(s.entryId);
  const r = await get(
    `/receivables?branchId=${f.a.id}&method=DEBIT_CARD&origin=SALE&status=PENDING&q=${encodeURIComponent(d.description)}&from=${d.dueDate.slice(0, 10)}&to=${d.dueDate.slice(0, 10)}`,
  );
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().items.map((x: { id: string }) => x.id)).toEqual([s.entryId]);
});
it("previsão editável com auditoria, original preservado e bloqueio após parcial", async () => {
  const s = await sale();
  const payload = {
    requestKey: randomUUID(),
    expectedDate: "2099-01-01",
    reason: "Ajuste de previsão acordada",
    notes: "Teste",
  };
  expect(
    (await post(`/receivables/${s.entryId}/forecast`, payload)).statusCode,
  ).toBe(200);
  expect(
    (await post(`/receivables/${s.entryId}/forecast`, payload)).statusCode,
  ).toBe(200);
  let d = await detail(s.entryId);
  expect(d.expectedDate.slice(0, 10)).toBe("2099-01-01");
  expect(d.dueDate).toBe(s.entries[0]!.dueDate.toISOString());
  await receive(s.entryId, "40");
  expect(
    (
      await post(`/receivables/${s.entryId}/forecast`, {
        ...payload,
        requestKey: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  d = await detail(s.entryId);
  expect(
    d.history.some(
      (h: { action: string }) => h.action === "RECEIVABLE_UPDATED",
    ),
  ).toBe(true);
});
it("vencido é derivado e deixa de estar vencido após baixa", async () => {
  const s = await sale();
  await db.financialEntry.update({
    where: { id: s.entryId },
    data: { dueDate: new Date("2020-01-01") },
  });
  expect((await detail(s.entryId)).situation).toBe("OVERDUE");
  await receive(s.entryId, "100");
  expect((await detail(s.entryId)).situation).toBe("PAID");
});
it("retry da venda não duplica parcelas e histórico automático", async () => {
  const s = await sale("CASH");
  const r = await post("/sales", s.input);
  expect(r.statusCode, r.body).toBe(201);
  expect(await db.financialEntry.count({ where: { saleId: s.id } })).toBe(1);
  expect((await detail(s.entryId)).settlements).toHaveLength(1);
});
it("data futura de recebimento é rejeitada", async () => {
  const s = await sale();
  const r = await post(`/receivables/${s.entryId}/receipts`, {
    requestKey: randomUUID(),
    amount: "100",
    receivedAt: "2099-01-01",
  });
  expect(r.statusCode).toBe(400);
});
it("devolução com vale mantém recebível e vale não vira nova entrada", async () => {
  const s = await sale("CREDIT_CARD", "100");
  const customer = await post("/customers", {
    name: "Cliente financeiro fictício",
  });
  expect(customer.statusCode).toBe(201);
  const item = await db.saleItem.findFirstOrThrow({
    where: { companyId: f.company.id, saleId: s.id },
  });
  const returned = await post("/returns", {
    requestKey: randomUUID(),
    originalSaleId: s.id,
    cashSessionId: sessionId,
    customerId: customer.json().id,
    reason: "Devolução com vale financeiro",
    items: [{ saleItemId: item.id, quantity: 1 }],
    payments: [],
  });
  expect(returned.statusCode, returned.body).toBe(201);
  expect((await detail(s.entryId)).balance).toBe("100.00");
  const before = (await get("/finance")).json();
  const replacement = await post("/sales", {
    requestKey: randomUUID(),
    cashSessionId: sessionId,
    cart: {
      warehouseId: f.wa.id,
      customerId: customer.json().id,
      items: [{ productId, quantity: 1, expectedUnitPrice: "100" }],
    },
    payments: [{ method: "STORE_CREDIT", amount: "100", installments: 1 }],
  });
  expect(replacement.statusCode, replacement.body).toBe(201);
  const after = (await get("/finance")).json();
  expect(after.received).toBe(before.received);
  expect(after.receivable).toBe(before.receivable);
  expect(after.payable).toBe(before.payable);
  expect(
    await db.financialEntry.count({
      where: { saleId: replacement.json().id, type: "RECEIVABLE" },
    }),
  ).toBe(0);
});
it("falha na reversão reverte cancelamento da venda e estoque", async () => {
  const s = await sale("PIX");
  const before = await db.stockBalance.findFirstOrThrow({
    where: { companyId: f.company.id, warehouseId: f.wa.id, productId },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reversal_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entryId"='${s.entryId}'::uuid AND NEW.kind='REVERSAL' THEN RAISE EXCEPTION 'rollback cancellation'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER reversal_test_failure AFTER INSERT ON "FinancialSettlement" FOR EACH ROW EXECUTE FUNCTION reversal_test_failure()',
  );
  try {
    expect((await cancel(s.id)).statusCode).toBe(500);
    const d = await detail(s.entryId);
    expect(d.situation).toBe("PAID");
    expect(d.settlements).toHaveLength(1);
    expect(
      (await db.sale.findUniqueOrThrow({ where: { id: s.id } })).status,
    ).toBe("COMPLETED");
    expect(
      String(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              companyId_warehouseId_productId: {
                companyId: f.company.id,
                warehouseId: f.wa.id,
                productId,
              },
            },
          })
        ).quantity,
      ),
    ).toBe(String(before.quantity));
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER reversal_test_failure ON "FinancialSettlement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION reversal_test_failure()");
  }
});
