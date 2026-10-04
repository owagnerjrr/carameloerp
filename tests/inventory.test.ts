import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { openTestCash } from "./cash-fixture.js";
const db = testDatabase(),
  origin = "http://localhost:5173";
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  operator = "",
  outsider = "";
const created: string[] = [];
const post = (path: string, payload: object, session = cookie) =>
  app.inject({
    method: "POST",
    url: "/api" + path,
    headers: { origin, cookie: session },
    payload,
  });
const get = (path: string, session = cookie) =>
  app.inject({ url: "/api" + path, headers: { cookie: session } });
const command = (
  id: string,
  kind: string,
  extra: object = {},
  session = cookie,
) =>
  post(
    `/inventory/${id}/${kind}`,
    { requestKey: randomUUID(), ...extra },
    session,
  );
async function ok(
  id: string,
  kind: string,
  extra: object = {},
  session = cookie,
) {
  const r = await command(id, kind, extra, session);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function book(q = 10) {
  const r = await post("/products", {
    code: "INV-" + randomUUID(),
    description: "Livro inventário fictício " + randomUUID().slice(0, 6),
    price: "50",
    cost: "10",
    minStock: "0",
  });
  expect(r.statusCode, r.body).toBe(201);
  const p = r.json().id as string;
  if (q > 0) {
    const s = await post("/stock/entries", {
      requestKey: randomUUID(),
      warehouseId: f.wa.id,
      supplierId: f.supplier.id,
      receivedAt: "2026-10-04",
      items: [{ productId: p, quantity: q, unitCost: "10" }],
    });
    expect(s.statusCode, s.body).toBe(201);
  }
  return p;
}
function input(ids: string[], extra: object = {}) {
  return {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    responsibleId: f.users[0]!.member.id,
    description: "Inventário de teste",
    scheduledAt: "2026-10-04",
    scope: "PARTIAL",
    productIds: ids,
    ...extra,
  };
}
async function create(ids: string[], extra: object = {}) {
  const r = await post("/inventory", input(ids, extra));
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().inventoryId as string;
  created.push(id);
  return id;
}
async function detail(id: string, session = cookie) {
  const r = await get("/inventory/" + id, session);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function balance(p: string) {
  return Number(
    (
      await db.stockBalance.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: f.company.id,
            warehouseId: f.wa.id,
            productId: p,
          },
        },
      })
    )?.quantity ?? 0,
  );
}
const count = (
  id: string,
  p: string,
  q: number,
  extra: object = {},
  session = cookie,
) =>
  ok(
    id,
    "count",
    { productId: p, quantity: q, mode: "SET", ...extra },
    session,
  );
async function ready(p: string, q: number) {
  const id = await create([p]);
  await ok(id, "start");
  await count(id, p, q);
  await ok(id, "complete");
  await ok(id, "justify", {
    productId: p,
    reason: "COUNT_ERROR",
    notes: "Conferência física de teste",
  });
  await ok(id, "approve");
  return id;
}
async function sale(p: string) {
  return post("/sales", {
    requestKey: randomUUID(),
    cart: {
      warehouseId: f.wa.id,
      discount: { type: "AMOUNT", value: "0" },
      items: [
        {
          productId: p,
          quantity: 1,
          expectedUnitPrice: "50",
          discount: { type: "AMOUNT", value: "0" },
        },
      ],
    },
    payments: [
      { method: "PIX", amount: "50", installments: 1, confirmed: true },
    ],
  });
}
beforeAll(async () => {
  f = await stockFixture(db);
  other = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 10000 });
  for (const [fixture, i, name] of [
    [f, 0, "admin"],
    [f, 1, "operator"],
    [other, 0, "other"],
  ] as const) {
    const r = await post(
      "/auth/login",
      {
        company: fixture.company.slug,
        email: fixture.users[i]!.user.email,
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
  await openTestCash(app, cookie, f.a.id);
});
afterEach(async () => {
  for (const id of created.splice(0)) {
    const v = await db.inventory.findUnique({ where: { id } });
    if (v && !["CLOSED", "CANCELLED"].includes(v.status))
      await ok(id, "cancel", { notes: "Encerramento da fixture de teste" });
  }
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("inventário completo: 10/5/8 permanece até fechar e gera -1/+2/nenhum", async () => {
  const a = await book(10),
    b = await book(5),
    c = await book(8),
    id = await create([], { scope: "FULL" });
  expect((await detail(id)).items).toHaveLength(0);
  await ok(id, "start");
  const d = await detail(id);
  expect(d.items).toHaveLength(3);
  expect(
    d.items.find((i: { productId: string }) => i.productId === a)
      .systemQuantity,
  ).toBe("10");
  await count(id, a, 9);
  await count(id, b, 7);
  await count(id, c, 8);
  expect(await Promise.all([balance(a), balance(b), balance(c)])).toEqual([
    10, 5, 8,
  ]);
  await ok(id, "complete");
  await ok(id, "justify", { productId: a, reason: "LOSS" });
  await ok(id, "justify", { productId: b, reason: "UNREGISTERED_IN" });
  await ok(id, "approve");
  expect(await Promise.all([balance(a), balance(b), balance(c)])).toEqual([
    10, 5, 8,
  ]);
  await ok(id, "close");
  expect(await Promise.all([balance(a), balance(b), balance(c)])).toEqual([
    9, 7, 8,
  ]);
  const done = await detail(id);
  expect(done.status).toBe("CLOSED");
  expect(done.documents).toHaveLength(1);
  const m = done.documents[0].movements as Array<{
    productId: string;
    quantity: string;
  }>;
  expect(m).toHaveLength(2);
  expect(m.find((x) => x.productId === a)?.quantity).toBe("-1");
  expect(m.find((x) => x.productId === b)?.quantity).toBe("2");
  expect(m.some((x) => x.productId === c)).toBe(false);
  expect(
    done.history.some((h: { action: string }) => h.action === "CLOSE"),
  ).toBe(true);
});
it("parcial congela somente os livros selecionados", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  expect(
    (await detail(id)).items.map((i: { productId: string }) => i.productId),
  ).toEqual([p]);
});
it("rascunho não congela saldo: snapshot ocorre em START", async () => {
  const p = await book(),
    id = await create([p]);
  const s = await sale(p);
  expect(s.statusCode, s.body).toBe(201);
  await ok(id, "start");
  expect((await detail(id)).items[0].systemQuantity).toBe("9");
});
it("edita escopo do rascunho e rejeita edição após início", async () => {
  const p = await book(),
    p2 = await book(),
    id = await create([p]);
  await ok(id, "edit", input([p2]));
  await ok(id, "start");
  expect((await detail(id)).items[0].productId).toBe(p2);
  expect((await command(id, "edit", input([p]))).statusCode).toBe(409);
});
it("ISBN/EAN/SKU repetido cinco vezes incrementa uma única linha", async () => {
  const p = await book(0),
    id = await create([p]);
  const product = await db.product.findUniqueOrThrow({ where: { id: p } });
  await ok(id, "start");
  for (let i = 0; i < 5; i++)
    await ok(id, "count", {
      code: product.code,
      quantity: 1,
      mode: "ADD",
      source: "SCANNER",
    });
  const d = await detail(id);
  expect(d.items).toHaveLength(1);
  expect(d.items[0].countedQuantity).toBe(5);
  expect(d.items[0].counts[0].source).toBe("SCANNER");
});
it("não contado é null e zero confirmado gera falta", async () => {
  const p = await book(3),
    id = await create([p]);
  await ok(id, "start");
  expect((await detail(id)).items[0].countedQuantity).toBeNull();
  expect((await command(id, "complete")).statusCode).toBe(409);
  await count(id, p, 0);
  expect((await detail(id)).items[0].countedQuantity).toBe(0);
  await ok(id, "complete");
  expect((await detail(id)).items[0].difference).toBe("-3");
});
it("físico positivo com sistema zero entra como ajuste", async () => {
  const p = await book(0),
    id = await ready(p, 2);
  await ok(id, "close");
  expect(await balance(p)).toBe(2);
});
it("falta gera saída de ajuste formal", async () => {
  const p = await book(),
    id = await ready(p, 8);
  await ok(id, "close");
  expect(await balance(p)).toBe(8);
  expect((await detail(id)).documents[0].movements[0].type).toBe("ADJUSTMENT");
});
it("sem divergência fecha sem movimento", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 10);
  await ok(id, "complete");
  await ok(id, "approve");
  await ok(id, "close");
  expect((await detail(id)).documents[0].movements).toHaveLength(0);
  expect(await balance(p)).toBe(10);
});
it("recontagem preserva 8 na primeira rodada e 9 na segunda", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 8);
  await ok(id, "complete");
  await ok(id, "recount", { productIds: [p], notes: "Conferir novamente" });
  expect((await detail(id)).items[0].countedQuantity).toBeNull();
  await count(id, p, 9);
  await ok(id, "complete");
  expect(
    (await detail(id)).items[0].counts.map(
      (c: { quantity: number }) => c.quantity,
    ),
  ).toEqual([8, 9]);
});
it("contagem cega não entrega saldo, diferença, custo ou histórico ao operador", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 8, {}, operator);
  const d = await detail(id, operator);
  for (const key of [
    "systemQuantity",
    "referenceQuantity",
    "difference",
    "adjustment",
    "unitCost",
  ])
    expect(d.items[0]).not.toHaveProperty(key);
  expect(d.history).toEqual([]);
  expect(d.documents).toEqual([]);
  expect(JSON.stringify(d)).not.toContain("movementCount");
});
it("recontagem cega oculta a primeira rodada mesmo com primeira contagem aberta", async () => {
  const p = await book(),
    id = await create([p], { blind: false, blindRecount: true });
  await ok(id, "start");
  await count(id, p, 8);
  await ok(id, "complete");
  await ok(id, "recount", {
    productIds: [p],
    notes: "Recontagem independente",
  });
  const d = await detail(id, operator);
  expect(d.items[0].counts).toEqual([]);
  expect(d.items[0]).not.toHaveProperty("systemQuantity");
  await count(id, p, 9, {}, operator);
  expect(
    (await detail(id, operator)).items[0].counts.map(
      (c: { round: number }) => c.round,
    ),
  ).toEqual([2]);
});
it("Outro exige descrição e todas as diferenças exigem motivo", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 8);
  await ok(id, "complete");
  expect((await command(id, "approve")).statusCode).toBe(409);
  expect(
    (await command(id, "justify", { productId: p, reason: "OTHER" }))
      .statusCode,
  ).toBe(400);
  await ok(id, "justify", {
    productId: p,
    reason: "OTHER",
    notes: "Ocorrência documentada",
  });
  await ok(id, "approve");
});
it("avaria é motivo documentado sem estoque paralelo", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 9);
  await ok(id, "complete");
  const n = await db.warehouse.count({ where: { companyId: f.company.id } });
  await ok(id, "justify", {
    productId: p,
    reason: "DAMAGED",
    notes: "Um exemplar avariado excluído do disponível",
  });
  expect(await db.warehouse.count({ where: { companyId: f.company.id } })).toBe(
    n,
  );
  expect(await balance(p)).toBe(10);
});
it("fechamento exige aprovação", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 10);
  await ok(id, "complete");
  expect((await command(id, "close")).statusCode).toBe(409);
});
it("cancela antes de fechar sem movimento e exige motivo", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 8);
  expect((await command(id, "cancel", { notes: "x" })).statusCode).toBe(400);
  await ok(id, "cancel", { notes: "Contagem interrompida" });
  expect(await balance(p)).toBe(10);
  expect((await detail(id)).status).toBe("CANCELLED");
  expect((await detail(id)).documents).toEqual([]);
});
it("fechado imutável bloqueia contagem, revisão, cancelamento e novo fechamento", async () => {
  const p = await book(),
    id = await ready(p, 9);
  await ok(id, "close");
  for (const k of [
    "count",
    "recount",
    "justify",
    "cancel",
    "close",
    "start",
    "edit",
  ])
    expect(
      (
        await command(
          id,
          k,
          k === "edit" ? input([p]) : { notes: "Tentativa após fechamento" },
        )
      ).statusCode,
    ).toBe(409);
});
it("outra empresa não consulta nem opera", async () => {
  const p = await book(),
    id = await create([p]);
  expect((await get("/inventory/" + id, outsider)).statusCode).toBe(404);
  expect((await command(id, "start", {}, outsider)).statusCode).toBe(404);
  expect(
    (await post("/inventory", input([p], { warehouseId: other.wa.id })))
      .statusCode,
  ).toBe(404);
});
it("operador da filial A não inventaria depósito B", async () => {
  const p = await book();
  expect(
    (await post("/inventory", input([p], { warehouseId: f.wb.id }), operator))
      .statusCode,
  ).toBe(404);
  const id = await create([p], { warehouseId: f.wb.id });
  expect((await get("/inventory/" + id, operator)).statusCode).toBe(404);
  expect((await command(id, "start", {}, operator)).statusCode).toBe(404);
});
for (const kind of ["EVENT", "EVENT_TRANSIT", "TRANSFER_TRANSIT"])
  it("rejeita depósito técnico " + kind, async () => {
    const p = await book();
    const w = await db.warehouse.create({
      data: {
        companyId: f.company.id,
        branchId: f.a.id,
        name: "Técnico " + kind,
        kind,
      },
    });
    expect(
      (await post("/inventory", input([p], { warehouseId: w.id }))).statusCode,
    ).toBe(409);
  });
it("Estoque conta, mas não revisa/aprova/fecha/cancela", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start", {}, operator);
  await count(id, p, 10, {}, operator);
  await ok(id, "complete", {}, operator);
  for (const k of ["recount", "justify", "approve", "close", "cancel"])
    expect(
      (await command(id, k, { notes: "Tentativa sem permissão" }, operator))
        .statusCode,
    ).toBe(403);
});
it("quantidade negativa, fracionária e código desconhecido são rejeitados", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  for (const quantity of [-1, 1.5])
    expect(
      (await command(id, "count", { productId: p, quantity, mode: "SET" }))
        .statusCode,
    ).toBe(400);
  expect(
    (
      await command(id, "count", {
        code: "DESCONHECIDO",
        quantity: 1,
        mode: "ADD",
      })
    ).statusCode,
  ).toBe(404);
});
it("livro fora do escopo parcial não entra silenciosamente", async () => {
  const p = await book(),
    p2 = await book(),
    id = await create([p]);
  await ok(id, "start");
  expect(
    (await command(id, "count", { productId: p2, quantity: 1, mode: "ADD" }))
      .statusCode,
  ).toBe(409);
});
it("retry de criação e contagem não duplica operações", async () => {
  const p = await book(),
    body = input([p]);
  const a = await post("/inventory", body),
    b = await post("/inventory", body);
  expect(a.statusCode).toBe(201);
  expect(b.json()).toEqual(a.json());
  const id = a.json().inventoryId;
  created.push(id);
  await ok(id, "start");
  const q = {
    requestKey: randomUUID(),
    productId: p,
    quantity: 1,
    mode: "ADD",
  };
  expect((await command(id, "count", q)).statusCode).toBe(200);
  expect((await command(id, "count", q)).statusCode).toBe(200);
  expect((await detail(id)).items[0].countedQuantity).toBe(1);
  expect((await command(id, "count", { ...q, quantity: 2 })).statusCode).toBe(
    409,
  );
});
it("retry de fechamento retorna documento original, chave diferente não reaplica", async () => {
  const p = await book(),
    id = await ready(p, 9),
    key = randomUUID();
  const a = await command(id, "close", { requestKey: key }),
    b = await command(id, "close", { requestKey: key });
  expect(a.statusCode, a.body).toBe(200);
  expect(b.json()).toEqual(a.json());
  expect(await balance(p)).toBe(9);
  expect((await detail(id)).documents).toHaveLength(1);
  expect(
    (await command(id, "close", { requestKey: key, notes: "Dados diferentes" }))
      .statusCode,
  ).toBe(409);
});
it("dois fechamentos concorrentes aplicam somente uma vez", async () => {
  const p = await book(),
    id = await ready(p, 9);
  const r = await Promise.all([command(id, "close"), command(id, "close")]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  expect(await balance(p)).toBe(9);
  expect((await detail(id)).documents).toHaveLength(1);
});
it("duas contagens ADD concorrentes não perdem atualização", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  const r = await Promise.all(
    Array.from({ length: 10 }, () =>
      command(id, "count", { productId: p, quantity: 1, mode: "ADD" }),
    ),
  );
  expect(r.every((x) => x.statusCode === 200)).toBe(true);
  expect((await detail(id)).items[0].countedQuantity).toBe(10);
});
it("venda após rodada aceita permanece: referência 10 físico 9 venda 1 saldo final 8", async () => {
  const p = await book(),
    id = await ready(p, 9);
  const r = await sale(p);
  expect(r.statusCode, r.body).toBe(201);
  expect(await balance(p)).toBe(9);
  await ok(id, "close");
  expect(await balance(p)).toBe(8);
  expect(
    await db.sale.findUnique({ where: { id: r.json().id } }),
  ).not.toBeNull();
  expect(
    await db.stockMovement.count({
      where: { saleId: r.json().id, type: "OUT" },
    }),
  ).toBe(1);
});
it("venda antes da rodada não é descontada novamente", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  expect((await sale(p)).statusCode).toBe(201);
  await count(id, p, 9);
  await ok(id, "complete");
  await ok(id, "justify", {
    productId: p,
    reason: "OPERATIONAL",
    notes: "Venda entre snapshot e contagem",
  });
  await ok(id, "approve");
  await ok(id, "close");
  expect(await balance(p)).toBe(9);
  expect((await detail(id)).documents[0].movements).toHaveLength(0);
});
it("venda durante rodada bloqueia conclusão e exige nova referência", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 10);
  expect((await sale(p)).statusCode).toBe(201);
  expect((await command(id, "complete")).statusCode).toBe(409);
  await ok(id, "restart", {
    productIds: [p],
    notes: "Venda durante a contagem",
  });
  await count(id, p, 9);
  await ok(id, "complete");
  expect(
    (await detail(id)).items[0].counts.map(
      (c: { quantity: number }) => c.quantity,
    ),
  ).toEqual([10, 9]);
});
it("movimentos compensatórios durante rodada também exigem recontagem", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 10);
  const s = await sale(p);
  expect(s.statusCode).toBe(201);
  const r = await post(`/sales/${s.json().id}/cancel`, {
    requestKey: randomUUID(),
    reason: "Cancelamento de teste físico",
    refundConfirmed: true,
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(await balance(p)).toBe(10);
  expect((await command(id, "complete")).statusCode).toBe(409);
});
it("venda concorrente ao fechamento preserva saldo e origem", async () => {
  const p = await book(),
    id = await ready(p, 9);
  const [close, s] = await Promise.all([command(id, "close"), sale(p)]);
  expect(close.statusCode, close.body).toBe(200);
  expect(s.statusCode, s.body).toBe(201);
  expect(await balance(p)).toBe(8);
});
it("não permite dois inventários ativos no mesmo depósito", async () => {
  const p = await book(),
    a = await create([p]),
    b = await create([p]);
  const r = await Promise.all([command(a, "start"), command(b, "start")]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
});
it("rollback em segundo ajuste reverte saldo, documento, movimentos, estado e auditoria", async () => {
  const a = await book(),
    b = await book(),
    id = await create([a, b]);
  await ok(id, "start");
  await count(id, a, 9);
  await count(id, b, 9);
  await ok(id, "complete");
  for (const p of [a, b])
    await ok(id, "justify", { productId: p, reason: "LOSS" });
  await ok(id, "approve");
  const last = [a, b].sort().at(-1)!;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION inventory_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId"='${last}'::uuid AND NEW.type='ADJUSTMENT' THEN RAISE EXCEPTION 'Inventory rollback test'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER inventory_test_failure BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION inventory_test_failure()',
  );
  try {
    expect((await command(id, "close")).statusCode).toBe(500);
    expect(await Promise.all([balance(a), balance(b)])).toEqual([10, 10]);
    expect((await detail(id)).status).toBe("APPROVED");
    expect((await detail(id)).documents).toEqual([]);
    expect(
      await db.inventoryAction.count({
        where: { inventoryId: id, kind: "CLOSE" },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({ where: { recordId: id, action: "CLOSE" } }),
    ).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER inventory_test_failure ON "StockMovement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION inventory_test_failure()");
  }
  await ok(id, "close");
  expect(await Promise.all([balance(a), balance(b)])).toEqual([9, 9]);
});
it("diferença que geraria saldo negativo é rejeitada integralmente", async () => {
  const p = await book(1),
    id = await ready(p, 0);
  expect((await sale(p)).statusCode).toBe(201);
  expect((await command(id, "close")).statusCode).toBe(409);
  expect(await balance(p)).toBe(0);
  expect((await detail(id)).documents).toEqual([]);
  expect((await detail(id)).status).toBe("APPROVED");
});
it("filtros de número, status e responsável retornam inventário correto", async () => {
  const p = await book(),
    id = await create([p]),
    d = await detail(id);
  const r = await get(
    `/inventory?q=${d.code}&status=DRAFT&responsibleId=${f.users[0]!.member.id}&warehouseId=${f.wa.id}`,
  );
  expect(r.statusCode).toBe(200);
  expect(r.json().items.map((v: { id: string }) => v.id)).toEqual([id]);
  expect(r.json().total).toBe(1);
});
it("CSV usa snapshot, rodada atual e proteção contra fórmulas", async () => {
  const p = await book();
  await db.product.update({ where: { id: p }, data: { description: "=1+1" } });
  const id = await create([p]);
  await ok(id, "start");
  await count(id, p, 9);
  await ok(id, "complete");
  const r = await get(`/inventory/${id}/export`);
  expect(r.statusCode).toBe(200);
  expect(r.headers["content-type"]).toContain("text/csv");
  expect(r.body).toContain("Sistema inicial");
  expect(r.body).toContain("'=1+1");
  expect(r.body).toContain('"9"');
  expect((await get(`/inventory/${id}/export`, operator)).statusCode).toBe(403);
  expect((await get(`/inventory/${id}/export`, outsider)).statusCode).toBe(404);
});
it("listagem cega não revela indicador de divergência", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 8);
  const r = await get("/inventory", operator);
  expect(r.statusCode).toBe(200);
  expect(r.json().divergent).toBeNull();
  expect(JSON.stringify(r.json())).not.toContain("systemQuantity");
});
it("histórico COUNT registra quantidade anterior/nova, ator e rodada", async () => {
  const p = await book(),
    id = await create([p]);
  await ok(id, "start");
  await count(id, p, 0, {}, operator);
  await count(id, p, 2, {}, operator);
  const logs = await db.auditLog.findMany({
    where: {
      companyId: f.company.id,
      module: "inventory",
      recordId: id,
      action: "COUNT",
    },
    orderBy: { createdAt: "asc" },
  });
  expect(
    logs.map(
      (v) => (v.metadata as { quantityBefore: number | null }).quantityBefore,
    ),
  ).toEqual([null, 0]);
  expect(
    logs.map((v) => (v.metadata as { quantityAfter: number }).quantityAfter),
  ).toEqual([0, 2]);
  expect(logs.every((v) => v.actorId === f.users[1]!.member.id)).toBe(true);
});
