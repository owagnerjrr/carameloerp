import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
const db = testDatabase(),
  origin = "http://localhost:5173";
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  operator = "",
  outsider = "";
const post = (path: string, payload: object, auth = cookie) =>
  app.inject({
    method: "POST",
    url: "/api" + path,
    headers: { origin, cookie: auth },
    payload,
  });
const get = (path: string, auth = cookie) =>
  app.inject({ url: "/api" + path, headers: { cookie: auth } });
const put = (path: string, payload: object, auth = cookie) =>
  app.inject({
    method: "PUT",
    url: "/api" + path,
    headers: { origin, cookie: auth },
    payload,
  });
async function book(cost = "40", quantity = 0) {
  const p = await post("/products", {
    code: "PC-" + randomUUID().slice(0, 20),
    description: "Livro fictício de compras",
    author: "Autora Compras",
    publisher: "Editora Compras",
    cost,
    price: "80",
    minStock: "10",
  });
  expect(p.statusCode, p.body).toBe(201);
  const id = p.json().id as string;
  if (quantity) {
    const r = await post("/stock/entries", {
      requestKey: randomUUID(),
      warehouseId: f.wa.id,
      supplierId: f.supplier.id,
      receivedAt: "2026-09-29",
      items: [{ productId: id, quantity, unitCost: cost }],
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  return id;
}
const fields = (
  p: string,
  quantity = 10,
  unitCost = "50",
  branchId = f.a.id,
) => ({
  branchId,
  supplierId: f.supplier.id,
  buyerId: f.users[0]!.member.id,
  orderedAt: "2026-09-29",
  expectedAt: "2026-10-10",
  items: [{ productId: p, quantity, unitCost }],
});
async function change(id: string, action: string, notes = "") {
  const r = await post(`/purchases/${id}/state`, {
    requestKey: randomUUID(),
    action,
    notes,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r;
}
async function order(
  p: string,
  quantity = 10,
  cost = "50",
  ready = true,
  branchId = f.a.id,
) {
  const r = await post("/purchases", {
    requestKey: randomUUID(),
    order: fields(p, quantity, cost, branchId),
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().orderId as string;
  if (ready)
    for (const action of ["SUBMIT", "APPROVE", "ORDER"])
      await change(id, action);
  const detail = await get("/purchases/" + id);
  expect(detail.statusCode).toBe(200);
  return detail.json() as {
    id: string;
    status: string;
    items: { id: string; receivedQuantity: number; quantity: number }[];
  };
}
const receipt = (
  o: Awaited<ReturnType<typeof order>>,
  quantity: number,
  cost = "50",
  key = randomUUID(),
) => ({
  requestKey: key,
  warehouseId: f.wa.id,
  receivedAt: "2026-09-29",
  items: [{ orderItemId: o.items[0]!.id, quantity, unitCost: cost }],
});
const receive = (
  o: Awaited<ReturnType<typeof order>>,
  quantity: number,
  extra: object = {},
  auth = cookie,
) =>
  post(
    `/purchases/${o.id}/receipts`,
    { ...receipt(o, quantity), ...extra },
    auth,
  );
async function qty(p: string, w = f.wa.id) {
  return Number(
    (
      await db.stockBalance.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: f.company.id,
            warehouseId: w,
            productId: p,
          },
        },
      })
    )?.quantity ?? 0,
  );
}
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
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("recebimentos concorrentes de pedidos distintos preservam custo médio global", async () => {
  const p = await book("40", 10),
    a = await order(p, 10, "50"),
    b = await order(p, 10, "60");
  const result = await Promise.all([
    post(`/purchases/${a.id}/receipts`, receipt(a, 10, "50")),
    post(`/purchases/${b.id}/receipts`, receipt(b, 10, "60")),
  ]);
  expect(result.map((r) => r.statusCode)).toEqual([201, 201]);
  expect(await qty(p)).toBe(30);
  expect(
    String((await db.product.findUniqueOrThrow({ where: { id: p } })).cost),
  ).toBe("50");
});
it("compra não recebe em evento/trânsito e reposição desconsidera esses saldos", async () => {
  const p = await book("40", 6),
    o = await order(p);
  for (const kind of ["EVENT", "EVENT_TRANSIT"]) {
    const w = await db.warehouse.create({
      data: {
        companyId: f.company.id,
        branchId: f.a.id,
        name: "Depósito fictício " + kind,
        kind,
      },
    });
    await db.stockBalance.create({
      data: {
        companyId: f.company.id,
        warehouseId: w.id,
        productId: p,
        quantity: 100,
      },
    });
    expect((await receive(o, 1, { warehouseId: w.id })).statusCode).toBe(409);
  }
  const row = (await get("/purchases/replenishment?branchId=" + f.a.id))
    .json()
    .items.find((i: { id: string }) => i.id === p);
  expect(Number(row.quantity)).toBe(6);
  expect(row.suggested).toBe(4);
  expect(await qty(p)).toBe(6);
});
it("edição de rascunho mantém número, totais e histórico, com retry protegido", async () => {
  const p = await book(),
    o = await order(p, 10, "50", false);
  const payload = { requestKey: randomUUID(), order: fields(p, 7, "42") };
  const updated = await put("/purchases/" + o.id, payload);
  expect(updated.statusCode, updated.body).toBe(200);
  expect((await put("/purchases/" + o.id, payload)).json()).toEqual(
    updated.json(),
  );
  const detail = (await get("/purchases/" + o.id)).json();
  expect(detail.total).toBe("294");
  expect(detail.items[0].quantity).toBe(7);
  expect(
    detail.actions.filter(
      (a: { kind: string }) => a.kind === "PURCHASE_ORDER_UPDATED",
    ),
  ).toHaveLength(1);
});
it("evolui fornecedor, normaliza documento, bloqueia duplicata e pesquisa contato", async () => {
  const supplier = {
    name: "Editora Teste Compras",
    tradeName: "Fantasia Compras",
    type: "PUBLISHER",
    document: "123.456.789-09",
    city: "Cidade Fictícia",
    contact: "Comercial fictício",
    deliveryDays: 5,
    paymentTerms: "30 dias",
  };
  const r = await post("/suppliers", supplier);
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().document).toBe("12345678909");
  expect(
    (await post("/suppliers", { ...supplier, document: "12345678909" }))
      .statusCode,
  ).toBe(409);
  for (const q of [
    "Fantasia",
    "123.456.789-09",
    "12345678909",
    "Cidade Fictícia",
    "Comercial fictício",
  ])
    expect(
      (await get("/suppliers?q=" + encodeURIComponent(q)))
        .json()
        .items.some((s: { id: string }) => s.id === r.json().id),
    ).toBe(true);
  expect(
    (await post("/suppliers", { name: "Sem permissão" }, operator)).statusCode,
  ).toBe(403);
});
it("excedentes sucessivos registram apenas o adicional e rateio preserva centavos", async () => {
  const p = await book(),
    second = await book();
  const created = await post("/purchases", {
    requestKey: randomUUID(),
    order: {
      ...fields(p, 5),
      items: [
        { productId: p, quantity: 5, unitCost: "50" },
        { productId: second, quantity: 5, unitCost: "50" },
      ],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().orderId;
  for (const action of ["SUBMIT", "APPROVE", "ORDER"]) await change(id, action);
  const detail = (await get("/purchases/" + id)).json();
  const firstItem = detail.items.find(
      (i: { productId: string }) => i.productId === p,
    ),
    secondItem = detail.items.find(
      (i: { productId: string }) => i.productId === second,
    );
  const r = await post(`/purchases/${id}/receipts`, {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    receivedAt: "2026-09-29",
    freight: "0.01",
    excessReason: "Aceitação explícita do excedente",
    items: [
      { orderItemId: firstItem.id, quantity: 6, unitCost: "50" },
      { orderItemId: secondItem.id, quantity: 1, unitCost: "50" },
    ],
  });
  expect(r.statusCode, r.body).toBe(201);
  const again = await post(`/purchases/${id}/receipts`, {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    receivedAt: "2026-09-29",
    excessReason: "Novo excedente autorizado",
    items: [{ orderItemId: firstItem.id, quantity: 2, unitCost: "50" }],
  });
  expect(again.statusCode, again.body).toBe(201);
  const final = (await get("/purchases/" + id)).json();
  expect(
    final.receipts[0].items
      .map((i: { allocatedCharges: string }) => i.allocatedCharges)
      .sort(),
  ).toEqual(["0", "0.01"]);
  expect(
    final.receipts.map(
      (r: { divergences: { quantity: number }[] }) =>
        r.divergences[0]!.quantity,
    ),
  ).toEqual([1, 2]);
  expect(await qty(p)).toBe(8);
});
it("recebe 6 + 4: estoque 10, parcial e depois concluído, documentos e auditoria", async () => {
  const p = await book(),
    o = await order(p);
  let r = await receive(o, 6);
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().status).toBe("PARTIALLY_RECEIVED");
  expect(await qty(p)).toBe(6);
  let detail = (await get("/purchases/" + o.id)).json();
  expect(detail.items[0].receivedQuantity).toBe(6);
  expect(detail.items[0].quantity - detail.items[0].receivedQuantity).toBe(4);
  r = await receive(o, 4);
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().status).toBe("RECEIVED");
  expect(await qty(p)).toBe(10);
  detail = (await get("/purchases/" + o.id)).json();
  expect(detail.receipts).toHaveLength(2);
  expect(detail.actions.map((a: { kind: string }) => a.kind)).toEqual([
    "PURCHASE_ORDER_CREATED",
    "PURCHASE_ORDER_SUBMITTED",
    "PURCHASE_ORDER_APPROVED",
    "PURCHASE_ORDER_ORDERED",
    "PURCHASE_RECEIVED",
    "PURCHASE_RECEIVED",
  ]);
  expect(
    await db.stockMovement.count({
      where: { companyId: f.company.id, productId: p, type: "IN" },
    }),
  ).toBe(2);
});
it("rejeita receber 6 de 5 sem permissão e preserva saldo/pedido", async () => {
  const p = await book(),
    o = await order(p, 5);
  const r = await receive(o, 6, {}, operator);
  expect(r.statusCode, r.body).toBe(403);
  expect(await qty(p)).toBe(0);
  expect(
    (await get("/purchases/" + o.id)).json().items[0].receivedQuantity,
  ).toBe(0);
});
it("excedente exige justificativa mesmo para administrador e registra ocorrência", async () => {
  const p = await book(),
    o = await order(p, 5);
  expect((await receive(o, 6)).statusCode).toBe(400);
  const r = await receive(o, 6, {
    excessReason: "Aceito lote extra autorizado",
  });
  expect(r.statusCode, r.body).toBe(201);
  expect(await qty(p)).toBe(6);
  expect(
    (await get("/purchases/" + o.id)).json().receipts[0].divergences[0],
  ).toMatchObject({ type: "EXCESS", quantity: 1 });
});
it("concorrência: 8 recebidos de 10, duas tentativas de 2, uma aprovação", async () => {
  const p = await book(),
    o = await order(p);
  expect((await receive(o, 8)).statusCode).toBe(201);
  const r = await Promise.all([receive(o, 2), receive(o, 2)]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([201, 409]);
  expect(await qty(p)).toBe(10);
  expect((await get("/purchases/" + o.id)).json().receipts).toHaveLength(2);
});
it("idempotência concorrente: mesmo requestKey entra uma vez e payload alterado rejeita", async () => {
  const p = await book(),
    o = await order(p);
  const payload = receipt(o, 4);
  const r = await Promise.all([
    post(`/purchases/${o.id}/receipts`, payload),
    post(`/purchases/${o.id}/receipts`, payload),
  ]);
  expect(r.map((x) => x.statusCode)).toEqual([201, 201]);
  expect(r[0]!.json()).toEqual(r[1]!.json());
  expect(await qty(p)).toBe(4);
  expect(
    (
      await post(`/purchases/${o.id}/receipts`, {
        ...payload,
        items: [{ ...payload.items[0], quantity: 5 }],
      })
    ).statusCode,
  ).toBe(409);
});
it("rollback após StockMovement preserva custo, saldo, pedido, documentos e auditoria", async () => {
  const p = await book("40", 10),
    o = await order(p),
    before = await db.auditLog.count({ where: { companyId: f.company.id } }),
    docs = await db.stockDocument.count({ where: { companyId: f.company.id } });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION purchase_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId" = '${p}'::uuid THEN RAISE EXCEPTION 'falha controlada compras'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER purchase_test_failure AFTER INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION purchase_test_failure()`,
  );
  try {
    const r = await receive(o, 10);
    expect(r.statusCode).toBe(500);
    expect(await qty(p)).toBe(10);
    expect(
      String((await db.product.findUniqueOrThrow({ where: { id: p } })).cost),
    ).toBe("40");
    const detail = (await get("/purchases/" + o.id)).json();
    expect(detail.status).toBe("ORDERED");
    expect(detail.items[0].receivedQuantity).toBe(0);
    expect(detail.receipts).toHaveLength(0);
    expect(
      await db.auditLog.count({ where: { companyId: f.company.id } }),
    ).toBe(before);
    expect(
      await db.stockDocument.count({ where: { companyId: f.company.id } }),
    ).toBe(docs);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER purchase_test_failure ON "StockMovement"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION purchase_test_failure()`);
  }
});
it("filial A não recebe no depósito B; operador B/empresa externa não acessam", async () => {
  const p = await book(),
    a = await order(p),
    b = await order(p, 10, "50", true, f.b.id);
  expect((await receive(a, 1, { warehouseId: f.wb.id })).statusCode).toBe(400);
  expect((await get("/purchases/" + b.id, operator)).statusCode).toBe(404);
  expect(
    (await receive(b, 1, { warehouseId: f.wb.id }, operator)).statusCode,
  ).toBe(404);
  expect((await get("/purchases/" + a.id, outsider)).statusCode).toBe(404);
  expect((await receive(a, 1, {}, outsider)).statusCode).toBe(404);
  expect(await qty(p)).toBe(0);
});
it("custo médio ponderado: 10×40 + 10×50 = 45 e histórico permanece", async () => {
  const p = await book("40", 10),
    o = await order(p);
  expect((await receive(o, 10)).statusCode).toBe(201);
  expect(
    String((await db.product.findUniqueOrThrow({ where: { id: p } })).cost),
  ).toBe("45");
  const history = (await get("/purchases/cost-history?productId=" + p)).json();
  expect(history.items[0]).toMatchObject({
    quantity: 10,
    unitCost: "50",
    previousCost: "40",
    resultingCost: "45",
  });
  expect(await qty(p)).toBe(20);
  expect(
    String(
      (
        await db.stockDocumentItem.findFirstOrThrow({
          where: { productId: p, unitCost: 40 },
        })
      ).unitCost,
    ),
  ).toBe("40");
});
it("custo considera estoque da outra filial e rateia frete sem perder centavos", async () => {
  const p = await book("40", 10);
  await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wb.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-29",
    items: [{ productId: p, quantity: 10, unitCost: "40" }],
  });
  const o = await order(p);
  expect((await receive(o, 10, { freight: "50" })).statusCode).toBe(201);
  expect(
    String((await db.product.findUniqueOrThrow({ where: { id: p } })).cost),
  ).toBe("45");
  const r = (await get("/purchases/" + o.id)).json().receipts[0];
  expect(r.items[0].allocatedCharges).toBe("50");
  expect(r.total).toBe("550");
});
it("cancelamento parcial preserva estoque e impede novos recebimentos", async () => {
  const p = await book(),
    o = await order(p);
  await receive(o, 6);
  await change(o.id, "CANCEL", "Fornecedor não entregará saldo");
  expect(await qty(p)).toBe(6);
  expect((await receive(o, 4)).statusCode).toBe(409);
  expect(
    (await get("/purchases/" + o.id)).json().items[0].receivedQuantity,
  ).toBe(6);
});
it("lifecycle, aprovação, edição e cancelamento de recebido são protegidos", async () => {
  const p = await book(),
    o = await order(p, 2, "50", false);
  expect((await receive(o, 1)).statusCode).toBe(409);
  expect(
    (
      await post(`/purchases/${o.id}/state`, {
        requestKey: randomUUID(),
        action: "APPROVE",
      })
    ).statusCode,
  ).toBe(409);
  await change(o.id, "SUBMIT");
  expect(
    (
      await post(
        `/purchases/${o.id}/state`,
        { requestKey: randomUUID(), action: "APPROVE" },
        operator,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await put("/purchases/" + o.id, {
        requestKey: randomUUID(),
        order: fields(p),
      })
    ).statusCode,
  ).toBe(409);
  await change(o.id, "APPROVE");
  await change(o.id, "ORDER");
  await receive(o, 2);
  expect(
    (
      await post(`/purchases/${o.id}/state`, {
        requestKey: randomUUID(),
        action: "CANCEL",
        notes: "Não pode cancelar recebido",
      })
    ).statusCode,
  ).toBe(409);
});
it("divergências sem itens aceitos não movimentam estoque", async () => {
  const p = await book(),
    o = await order(p);
  const r = await post(`/purchases/${o.id}/receipts`, {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    receivedAt: "2026-09-29",
    items: [],
    divergences: [
      {
        productId: p,
        type: "DAMAGED",
        quantity: 2,
        notes: "Duas capas danificadas na entrega",
      },
    ],
  });
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().status).toBe("ORDERED");
  expect(await qty(p)).toBe(0);
  expect(
    (await get("/purchases/" + o.id)).json().receipts[0].divergences,
  ).toHaveLength(1);
  expect(
    await db.auditLog.count({
      where: { recordId: o.id, action: "PURCHASE_DIVERGENCE_RECORDED" },
    }),
  ).toBe(1);
});
it("validação rejeita itens duplicados, desconhecidos, custo negativo e data inválida", async () => {
  const p = await book(),
    o = await order(p);
  for (const payload of [
    {
      ...receipt(o, 1),
      items: [...receipt(o, 1).items, ...receipt(o, 1).items],
    },
    {
      ...receipt(o, 1),
      items: [{ orderItemId: randomUUID(), quantity: 1, unitCost: "50" }],
    },
    {
      ...receipt(o, 1),
      items: [{ orderItemId: o.items[0]!.id, quantity: 1, unitCost: "-1" }],
    },
    { ...receipt(o, 1), receivedAt: "2026-02-31" },
  ])
    expect(
      (await post(`/purchases/${o.id}/receipts`, payload)).statusCode,
    ).toBe(400);
  expect(await qty(p)).toBe(0);
});
it("reposição somente depósitos comuns, sugestões e filtros de pedido", async () => {
  const p = await book("40", 6),
    o = await order(p);
  const suggested = (await get("/purchases/replenishment?branchId=" + f.a.id))
    .json()
    .items.find((i: { id: string }) => i.id === p);
  expect(suggested).toMatchObject({
    quantity: "6.000",
    minimum: "10.000",
    suggested: 4,
  });
  for (const filter of [
    `branchId=${f.a.id}`,
    `supplierId=${f.supplier.id}`,
    `buyerId=${f.users[0]!.member.id}`,
    "status=ORDERED",
    "from=2026-09-29&to=2026-09-29",
    "q=Autora%20Compras",
  ]) {
    const result = await get("/purchases?" + filter);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().items.some((r: { id: string }) => r.id === o.id)).toBe(
      true,
    );
  }
  expect(
    (await get("/purchases/replenishment?branchId=" + f.b.id, operator))
      .statusCode,
  ).toBe(404);
});
it("retry da criação e alteração não duplica pedido; totais usam desconto unitário", async () => {
  const p = await book(),
    data = {
      requestKey: randomUUID(),
      order: {
        ...fields(p, 3, "12.34"),
        freight: "2.01",
        expenses: "0.02",
        items: [
          {
            productId: p,
            quantity: 3,
            unitCost: "12.34",
            unitDiscount: "0.34",
          },
        ],
      },
    };
  const first = await post("/purchases", data),
    retry = await post("/purchases", data);
  expect(first.statusCode).toBe(201);
  expect(retry.json()).toEqual(first.json());
  const d = (await get("/purchases/" + first.json().orderId)).json();
  expect(d).toMatchObject({
    subtotal: "37.02",
    discount: "1.02",
    total: "38.03",
  });
  expect(
    (
      await post("/purchases", {
        ...data,
        order: { ...data.order, notes: "Mudou" },
      })
    ).statusCode,
  ).toBe(409);
});
