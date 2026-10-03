import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { financialToday } from "../apps/api/src/services/payables.js";
const db = testDatabase(),
  origin = "http://localhost:5173",
  today = financialToday();
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  operator = "",
  outsider = "",
  categoryId = "";
const post = (path: string, payload: object, auth = cookie) =>
  app.inject({
    method: "POST",
    url: "/api" + path,
    headers: { origin, cookie: auth },
    payload,
  });
const get = (path: string, auth = cookie) =>
  app.inject({ url: "/api" + path, headers: { cookie: auth } });
const createData = (amount = "1000", extra: object = {}) => ({
  requestKey: randomUUID(),
  branchId: f.a.id,
  categoryId,
  origin: "MANUAL",
  description: "Despesa financeira de teste",
  issuedAt: "2026-01-01",
  competence: "2026-01-01",
  amount,
  dueDates: ["2099-10-10"],
  ...extra,
});
async function create(amount = "1000", extra: object = {}) {
  const r = await post("/payables", createData(amount, extra));
  expect(r.statusCode, r.body).toBe(201);
  return r.json().entryIds[0] as string;
}
const payData = (amount: string, key = randomUUID()) => ({
  requestKey: key,
  amount,
  paidAt: today,
  method: "PIX",
  reference: "Teste administrativo",
});
const pay = (id: string, amount: string, key = randomUUID(), auth = cookie) =>
  post(`/payables/${id}/payments`, payData(amount, key), auth);
const detail = async (id: string) => (await get("/payables/" + id)).json();
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
    expect(r.statusCode, r.body).toBe(200);
    const c = String(r.headers["set-cookie"]).split(";")[0]!;
    if (name === "admin") cookie = c;
    else if (name === "operator") operator = c;
    else outsider = c;
  }
  const cat = await post("/payables/categories", { name: "Despesas de teste" });
  expect(cat.statusCode).toBe(201);
  categoryId = cat.json().id;
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("A: conta manual Aluguel de 3000 começa pendente com saldo integral", async () => {
  const id = await create("3000", { description: "Aluguel" });
  const d = await detail(id);
  expect(d.situation).toBe("PENDING");
  expect(d.balance).toBe("3000.00");
  expect(d.paid).toBe("0.00");
});
it("B: pagamentos 400 + 600 preservam original e concluem 1000", async () => {
  const id = await create();
  expect((await pay(id, "400")).statusCode).toBe(200);
  let d = await detail(id);
  expect([d.paid, d.balance, d.situation]).toEqual([
    "400.00",
    "600.00",
    "PARTIAL",
  ]);
  expect((await pay(id, "600")).statusCode).toBe(200);
  d = await detail(id);
  expect([
    d.paid,
    d.balance,
    d.situation,
    String(d.amount),
    d.settlements.length,
  ]).toEqual(["1000.00", "0.00", "PAID", "1000", 2]);
});
it("C: duas baixas simultâneas de 500 aprovam somente uma", async () => {
  const id = await create("500");
  const r = await Promise.all([pay(id, "500"), pay(id, "500")]);
  expect(r.map((v) => v.statusCode).sort()).toEqual([200, 409]);
  expect((await detail(id)).settlements).toHaveLength(1);
});
it("D: retry concorrente gera um pagamento e payload divergente é rejeitado", async () => {
  const id = await create("500"),
    key = randomUUID();
  const r = await Promise.all([pay(id, "200", key), pay(id, "200", key)]);
  expect(r.map((v) => v.statusCode)).toEqual([200, 200]);
  expect(r[0]!.json()).toEqual(r[1]!.json());
  expect((await pay(id, "201", key)).statusCode).toBe(409);
  const d = await detail(id);
  expect(d.balance).toBe("300.00");
  expect(d.settlements).toHaveLength(1);
});
it("E: falha após criar pagamento reverte saldo, histórico, ação e auditoria", async () => {
  const id = await create("500"),
    key = randomUUID();
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION payable_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entryId"='${id}'::uuid THEN RAISE EXCEPTION 'rollback test'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER payable_test_failure AFTER INSERT ON "FinancialSettlement" FOR EACH ROW EXECUTE FUNCTION payable_test_failure()',
  );
  try {
    expect((await pay(id, "100", key)).statusCode).toBe(500);
    const d = await detail(id);
    expect(d.balance).toBe("500.00");
    expect(d.situation).toBe("PENDING");
    expect(d.settlements).toHaveLength(0);
    expect(await db.financialAction.count({ where: { requestKey: key } })).toBe(
      0,
    );
    expect(
      await db.auditLog.count({
        where: { recordId: id, action: "PAYABLE_PAYMENT_REGISTERED" },
      }),
    ).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER payable_test_failure ON "FinancialSettlement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION payable_test_failure()");
  }
  expect((await pay(id, "100", key)).statusCode).toBe(200);
});
it("F: parcelamento 100/3 resulta 33,33 + 33,33 + 33,34 e retry não duplica", async () => {
  const data = createData("100", {
    dueDates: ["2099-10-10", "2099-11-10", "2099-12-10"],
  });
  const first = await post("/payables", data),
    retry = await post("/payables", data);
  expect(first.statusCode).toBe(201);
  expect(retry.json()).toEqual(first.json());
  const d = await detail(first.json().entryIds[0]);
  expect(
    d.installments.map((i: { amount: string }) => String(i.amount)),
  ).toEqual(["33.33", "33.33", "33.34"]);
  expect(
    d.installments.map((i: { installment: number }) => i.installment),
  ).toEqual([1, 2, 3]);
});
async function purchase() {
  const p = await post("/products", {
    code: "FIN-" + randomUUID().slice(0, 15),
    description: "Livro financeiro teste",
    cost: "100",
    price: "150",
    minStock: "0",
  });
  expect(p.statusCode, p.body).toBe(201);
  const r = await post("/purchases", {
    requestKey: randomUUID(),
    order: {
      branchId: f.a.id,
      supplierId: f.supplier.id,
      buyerId: f.users[0]!.member.id,
      orderedAt: "2026-01-01",
      items: [{ productId: p.json().id, quantity: 10, unitCost: "100" }],
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().orderId;
  for (const action of ["SUBMIT", "APPROVE", "ORDER"]) {
    const state = await post(`/purchases/${id}/state`, {
      requestKey: randomUUID(),
      action,
    });
    expect(state.statusCode, state.body).toBe(200);
  }
  const d = (await get("/purchases/" + id)).json();
  return { id, itemId: d.items[0].id };
}
async function receive(
  o: Awaited<ReturnType<typeof purchase>>,
  quantity: number,
) {
  const r = await post(`/purchases/${o.id}/receipts`, {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    receivedAt: "2026-01-02",
    items: [{ orderItemId: o.itemId, quantity, unitCost: "100" }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return await db.purchaseReceipt.findFirstOrThrow({
    where: { companyId: f.company.id, orderId: o.id },
    orderBy: { createdAt: "desc" },
  });
}
it("G/H: confirmação explícita 6+4 gera 600+400, vínculos corretos e origem única", async () => {
  const o = await purchase();
  expect(
    await db.financialObligation.count({ where: { purchaseOrderId: o.id } }),
  ).toBe(0);
  const r6 = await receive(o, 6);
  expect(
    await db.financialObligation.count({ where: { purchaseOrderId: o.id } }),
  ).toBe(0);
  const data = createData("600", {
    origin: "PURCHASE",
    purchaseReceiptId: r6.id,
    supplierId: f.supplier.id,
  });
  const first = await post("/payables", data);
  expect(first.statusCode, first.body).toBe(201);
  expect((await post("/payables", data)).json()).toEqual(first.json());
  expect(
    (await post("/payables", { ...data, requestKey: randomUUID() })).statusCode,
  ).toBe(409);
  const r4 = await receive(o, 4);
  const id = await create("400", {
    origin: "PURCHASE",
    purchaseReceiptId: r4.id,
    supplierId: f.supplier.id,
  });
  const d = await detail(id);
  expect(d.obligation.purchaseOrderId).toBe(o.id);
  expect(d.obligation.purchaseReceiptId).toBe(r4.id);
  expect(d.obligation.supplierId).toBe(f.supplier.id);
  expect(d.branchId).toBe(f.a.id);
  const sum = await db.financialObligation.aggregate({
    where: { purchaseOrderId: o.id },
    _sum: { originalAmount: true },
    _count: true,
  });
  expect(String(sum._sum.originalAmount)).toBe("1000");
  expect(sum._count).toBe(2);
});
it("origem de compra rejeita adulteração de fornecedor, valor e duplicação concorrente", async () => {
  const o = await purchase(),
    r = await receive(o, 10),
    data = createData("1000", {
      origin: "PURCHASE",
      purchaseReceiptId: r.id,
      supplierId: f.supplier.id,
    });
  expect((await post("/payables", { ...data, amount: "999" })).statusCode).toBe(
    400,
  );
  expect(
    (await post("/payables", { ...data, supplierId: null })).statusCode,
  ).toBe(400);
  const results = await Promise.all([
    post("/payables", data),
    post("/payables", { ...data, requestKey: randomUUID() }),
  ]);
  expect(results.map((x) => x.statusCode).sort()).toEqual([201, 409]);
});
it("I: juros e multa separados totalizam 1030 e podem ser integralmente pagos", async () => {
  const id = await create();
  const r = await post(`/payables/${id}/edit`, {
    requestKey: randomUUID(),
    amount: "1000",
    interest: "10",
    penalty: "20",
    discount: "0",
    dueDate: "2099-10-10",
    reason: "Ajuste autorizado teste",
  });
  expect(r.statusCode, r.body).toBe(200);
  expect((await detail(id)).total).toBe("1030.00");
  expect((await pay(id, "1030")).statusCode).toBe(200);
  const d = await detail(id);
  expect(d.balance).toBe("0.00");
  expect(
    d.history.some((h: { action: string }) => h.action === "PAYABLE_UPDATED"),
  ).toBe(true);
});
it("desconto 50 reduz total a 950 e desconto excessivo é rejeitado", async () => {
  const id = await create(),
    payload = {
      requestKey: randomUUID(),
      amount: "1000",
      interest: "0",
      penalty: "0",
      discount: "50",
      dueDate: "2099-10-10",
      reason: "Desconto negociado teste",
    };
  expect((await post(`/payables/${id}/edit`, payload)).statusCode).toBe(200);
  expect((await detail(id)).total).toBe("950.00");
  expect(
    (
      await post(`/payables/${id}/edit`, {
        ...payload,
        requestKey: randomUUID(),
        discount: "1001",
      })
    ).statusCode,
  ).toBe(400);
});
it("desconto integral encerra saldo sem criar pagamento fictício", async () => {
  const id = await create("50");
  const r = await post(`/payables/${id}/edit`, {
    requestKey: randomUUID(),
    amount: "50",
    interest: "0",
    penalty: "0",
    discount: "50",
    dueDate: "2099-10-10",
    reason: "Abatimento integral teste",
  });
  expect(r.statusCode, r.body).toBe(200);
  const d = await detail(id);
  expect(d.situation).toBe("PAID");
  expect(d.settlements).toHaveLength(0);
  expect((await pay(id, "1")).statusCode).toBe(409);
});
it("J: empresa e perfil operacional não podem acessar/baixar obrigação", async () => {
  const id = await create();
  expect((await get("/payables/" + id, outsider)).statusCode).toBe(404);
  expect((await pay(id, "10", randomUUID(), outsider)).statusCode).toBe(404);
  expect((await get("/payables", operator)).statusCode).toBe(403);
  expect((await pay(id, "10", randomUUID(), operator)).statusCode).toBe(403);
});
it("J: permissão financeira restrita à filial não libera filial B", async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { id: f.users[1]!.member.id },
  });
  for (const permissionCode of ["payables:read", "payables:pay"])
    await db.rolePermission.create({
      data: { roleId: member.roleId, permissionCode },
    });
  const id = await create("50", { branchId: f.b.id });
  expect((await get("/payables/" + id, operator)).statusCode).toBe(404);
  expect((await pay(id, "10", randomUUID(), operator)).statusCode).toBe(404);
  expect((await get("/payables?branchId=" + f.b.id, operator)).statusCode).toBe(
    404,
  );
  expect((await post("/payables", createData(), operator)).statusCode).toBe(
    403,
  );
});
it("K: vencimento é derivado e conta paga deixa consulta de vencidas", async () => {
  const id = await create("50", { dueDates: ["2026-01-02"] });
  expect((await detail(id)).situation).toBe("OVERDUE");
  expect(
    (await get("/payables?status=OVERDUE"))
      .json()
      .items.some((i: { id: string }) => i.id === id),
  ).toBe(true);
  expect((await pay(id, "50")).statusCode).toBe(200);
  expect((await detail(id)).situation).toBe("PAID");
  expect(
    (await get("/payables?status=OVERDUE"))
      .json()
      .items.some((i: { id: string }) => i.id === id),
  ).toBe(false);
});
it("cancelamento exige motivo, é idempotente e impede pagamento", async () => {
  const id = await create("50"),
    payload = {
      requestKey: randomUUID(),
      reason: "Obrigação registrada indevidamente",
    };
  expect(
    (await post(`/payables/${id}/cancel`, { ...payload, reason: "x" }))
      .statusCode,
  ).toBe(400);
  expect((await post(`/payables/${id}/cancel`, payload)).statusCode).toBe(200);
  expect((await post(`/payables/${id}/cancel`, payload)).statusCode).toBe(200);
  expect((await detail(id)).situation).toBe("CANCELLED");
  expect((await pay(id, "1")).statusCode).toBe(409);
  expect(
    await db.auditLog.count({
      where: { recordId: id, action: "PAYABLE_CANCELLED" },
    }),
  ).toBe(1);
});
it("pagamento bloqueia edição e cancelamento de toda obrigação parcelada", async () => {
  const id = await create("100", { dueDates: ["2099-10-10", "2099-11-10"] });
  expect((await pay(id, "10")).statusCode).toBe(200);
  const d = await detail(id),
    otherId = d.installments[1].id;
  expect(
    (
      await post(`/payables/${otherId}/cancel`, {
        requestKey: randomUUID(),
        reason: "Tentativa após pagamento",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await post(`/payables/${id}/edit`, {
        requestKey: randomUUID(),
        amount: "50",
        interest: "0",
        penalty: "0",
        discount: "1",
        dueDate: "2099-10-10",
        reason: "Tentativa após pagamento",
      })
    ).statusCode,
  ).toBe(409);
});
it("valores, datas, centavos e referências são validados no backend", async () => {
  for (const extra of [
    { amount: "0" },
    { amount: "1.001" },
    { amount: "-1" },
    { amount: "0.01", dueDates: ["2099-01-01", "2099-02-01"] },
    { dueDates: ["2099-02-01", "2099-01-01"] },
    { dueDates: ["2025-01-01"] },
    { categoryId: randomUUID() },
    { supplierId: other.supplier.id },
    { branchId: other.a.id },
  ]) {
    const r = await post("/payables", createData("100", extra));
    expect([400, 404], r.body).toContain(r.statusCode);
  }
  const id = await create("50");
  expect((await pay(id, "51")).statusCode).toBe(409);
  expect(
    (
      await post(`/payables/${id}/payments`, {
        ...payData("1"),
        paidAt: "2099-01-01",
      })
    ).statusCode,
  ).toBe(400);
});
it("obrigações legadas de vale não são acessíveis pelas novas ações", async () => {
  const legacy = await db.financialEntry.create({
    data: {
      companyId: f.company.id,
      branchId: f.a.id,
      type: "PAYABLE",
      description: "Obrigação legada preservada",
      amount: "50",
      dueDate: new Date(today),
    },
  });
  expect((await get("/payables/" + legacy.id)).statusCode).toBe(404);
  expect((await pay(legacy.id, "10")).statusCode).toBe(404);
});
it("filtros, relatórios, CSV e indicadores respeitam dados e pagamentos", async () => {
  const id = await create("3000", {
    description: "Aluguel filtro exclusivo",
    documentNumber: "DOC-TEST-FIN",
    dueDates: [today],
  });
  expect((await pay(id, "100")).statusCode).toBe(200);
  const list = await get(
    "/payables?documentNumber=DOC-TEST-FIN&supplierId=" + f.supplier.id,
  );
  expect(list.json().total).toBe(0);
  const found = await get("/payables?q=Aluguel%20filtro%20exclusivo");
  expect(found.json().total).toBe(1);
  const csv = await get("/payables/export?documentNumber=DOC-TEST-FIN");
  expect(csv.statusCode).toBe(200);
  expect(csv.body).toContain("DOC-TEST-FIN");
  expect(csv.body).toContain("2900.00");
  const report = (
    await get("/payables/reports?documentNumber=DOC-TEST-FIN")
  ).json();
  expect(report.categories[0].balance).toBe("2900.00");
  const stats = (await get("/payables/indicators")).json();
  expect(Number(stats.today)).toBeGreaterThanOrEqual(2900);
  expect(Number(stats.paidMonth)).toBeGreaterThanOrEqual(100);
});
it("edição manual antes de pagamento atualiza total do grupo e mantém valores auditados", async () => {
  const id = await create("100"),
    payload = {
      requestKey: randomUUID(),
      amount: "120",
      interest: "0",
      penalty: "0",
      discount: "0",
      dueDate: "2099-11-10",
      reason: "Correção do aluguel negociado",
    };
  const r = await post(`/payables/${id}/edit`, payload);
  expect(r.statusCode, r.body).toBe(200);
  expect((await post(`/payables/${id}/edit`, payload)).statusCode).toBe(200);
  const d = await detail(id);
  expect(d.balance).toBe("120.00");
  expect(String(d.obligation.originalAmount)).toBe("120");
  const audit = d.history.find(
    (h: { action: string }) => h.action === "PAYABLE_UPDATED",
  );
  expect(audit.metadata.before.amount).toBe("100");
  expect(audit.metadata.after.amount).toBe("120");
});
it("falha depois de saldo e auditoria também reverte a transação inteira", async () => {
  const id = await create("500"),
    key = randomUUID();
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION payable_action_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestKey"='${key}'::uuid THEN RAISE EXCEPTION 'rollback action'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER payable_action_failure AFTER INSERT ON "FinancialAction" FOR EACH ROW EXECUTE FUNCTION payable_action_failure()',
  );
  try {
    expect((await pay(id, "100", key)).statusCode).toBe(500);
    const d = await detail(id);
    expect(d.balance).toBe("500.00");
    expect(d.paid).toBe("0.00");
    expect(d.settlements).toHaveLength(0);
    expect(
      d.history.filter(
        (h: { action: string }) => h.action === "PAYABLE_PAYMENT_REGISTERED",
      ),
    ).toHaveLength(0);
    expect(await db.financialAction.count({ where: { requestKey: key } })).toBe(
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER payable_action_failure ON "FinancialAction"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION payable_action_failure()");
  }
});
it("CSV neutraliza fórmulas e relatórios não vazam dados de outra empresa", async () => {
  await create("10", {
    description: "=TESTE-FORMULA-FIN",
    documentNumber: "FORMULA-FIN",
  });
  const csv = await get("/payables/export?documentNumber=FORMULA-FIN");
  expect(csv.body).toContain("'=TESTE-FORMULA-FIN");
  const external = await get(
    "/payables/reports?documentNumber=FORMULA-FIN",
    outsider,
  );
  expect(external.json().categories).toEqual([]);
});
