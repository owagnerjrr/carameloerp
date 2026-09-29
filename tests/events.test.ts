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
  operator = "";
const post = (path: string, payload: object, auth = cookie) =>
  app.inject({
    method: "POST",
    url: "/api" + path,
    headers: { origin, cookie: auth },
    payload,
  });
const get = (path: string, auth = cookie) =>
  app.inject({ url: "/api" + path, headers: { cookie: auth } });
const qty = async (w: string, p: string) =>
  Number(
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
const items = (productId: string, quantity: number) => [
  { productId, quantity },
];
const registration = () => ({
  name: "Feira teste " + randomUUID().slice(0, 8),
  description: "Fictício",
  type: "FEIRA",
  startsAt: "2026-10-10",
  endsAt: "2026-10-15",
  branchId: f.a.id,
  responsibleId: f.users[1]!.member.id,
  location: "Escola fictícia",
  city: "Varginha",
  state: "MG",
  notes: "",
});
async function event(prepare = true) {
  const r = await post("/events", {
    requestKey: randomUUID(),
    event: registration(),
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().eventId as string;
  if (prepare)
    expect(
      (
        await post(`/events/${id}/state`, {
          requestKey: randomUUID(),
          action: "PREPARE",
        })
      ).statusCode,
    ).toBe(200);
  return (await get("/events/" + id)).json() as {
    id: string;
    warehouseId: string;
    transitWarehouseId: string;
    status: string;
  };
}
async function book(quantity = 20) {
  const p = await post("/products", {
    code: "EVENT-" + randomUUID().slice(0, 24),
    description: "Livro fictício de evento",
    price: "10",
    cost: "1",
    minStock: "0",
    author: "Autora Fictícia",
    publisher: "Editora Teste",
  });
  expect(p.statusCode, p.body).toBe(201);
  const id = p.json().id as string;
  const r = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-29",
    items: [{ productId: id, quantity, unitCost: "1" }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return id;
}
const dispatch = (e: string, p: string, n: number, key = randomUUID()) =>
  post(`/events/${e}/dispatches`, {
    requestKey: key,
    warehouseId: f.wa.id,
    items: items(p, n),
  });
const receive = (e: string, d: string, p: string, n: number, notes = "") =>
  post(`/events/${e}/receipts`, {
    requestKey: randomUUID(),
    dispatchId: d,
    items: items(p, n),
    notes,
  });
const ret = (e: string, p: string, n: number, key = randomUUID()) =>
  post(`/events/${e}/returns`, {
    requestKey: key,
    warehouseId: f.wa.id,
    items: items(p, n),
  });
beforeAll(async () => {
  f = await stockFixture(db);
  other = await stockFixture(db);
  app = await buildApp({ db, origin, rateLimitMax: 5000 });
  for (const [i, u] of f.users.entries()) {
    const r = await post(
      "/auth/login",
      {
        company: f.company.slug,
        email: u.user.email,
        password: f.password,
      },
      "",
    );
    expect(r.statusCode, r.body).toBe(200);
    const c = String(r.headers["set-cookie"]).split(";")[0]!;
    if (!i) cookie = c;
    else operator = c;
  }
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("20→15, trânsito5→recebido5; retorno3→evento2/filial18; auditoria e dois movimentos por documento", async () => {
  const e = await event(),
    p = await book();
  const d = await dispatch(e.id, p, 5);
  expect(d.statusCode, d.body).toBe(201);
  expect(await qty(f.wa.id, p)).toBe(15);
  expect(await qty(e.transitWarehouseId, p)).toBe(5);
  expect(await qty(e.warehouseId, p)).toBe(0);
  expect((await receive(e.id, d.json().id, p, 5)).statusCode).toBe(201);
  expect(await qty(e.transitWarehouseId, p)).toBe(0);
  expect(await qty(e.warehouseId, p)).toBe(5);
  const r = await ret(e.id, p, 3);
  expect(r.statusCode, r.body).toBe(201);
  expect(await qty(e.warehouseId, p)).toBe(2);
  expect(await qty(f.wa.id, p)).toBe(18);
  expect(
    await db.stockMovement.count({ where: { eventDocumentId: r.json().id } }),
  ).toBe(2);
  expect(
    await db.auditLog.count({
      where: {
        recordId: e.id,
        action: {
          in: [
            "EVENT_CREATED",
            "EVENT_DISPATCHED",
            "EVENT_RECEIVED",
            "EVENT_RETURNED",
          ],
        },
      },
    }),
  ).toBe(4);
});
it("estoque5 rejeita envio6 e preserva ambos locais", async () => {
  const e = await event(),
    p = await book(5);
  expect((await dispatch(e.id, p, 6)).statusCode).toBe(409);
  expect(await qty(f.wa.id, p)).toBe(5);
  expect(await qty(e.transitWarehouseId, p)).toBe(0);
});
it("dois eventos concorrentes enviam4+4 do mesmo estoque5: só um sucesso", async () => {
  const a = await event(),
    b = await event(),
    p = await book(5);
  const results = await Promise.all([
    dispatch(a.id, p, 4),
    dispatch(b.id, p, 4),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(await qty(f.wa.id, p)).toBe(1);
  expect(
    (await qty(a.transitWarehouseId, p)) + (await qty(b.transitWarehouseId, p)),
  ).toBe(4);
});
it("retry de envio simultâneo movimenta uma vez; conteúdo divergente rejeitado", async () => {
  const e = await event(),
    p = await book(),
    key = randomUUID();
  const [a, b] = await Promise.all([
    dispatch(e.id, p, 5, key),
    dispatch(e.id, p, 5, key),
  ]);
  expect(a.statusCode, a.body).toBe(201);
  expect(b.json().id).toBe(a.json().id);
  expect(await qty(f.wa.id, p)).toBe(15);
  expect((await dispatch(e.id, p, 4, key)).statusCode).toBe(409);
});
it("rollback entre origem e destino conserva estoque, documentos e auditoria", async () => {
  const e = await event(),
    p = await book();
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."warehouseId"='${e.transitWarehouseId}'::uuid THEN RAISE EXCEPTION 'forced event failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_event_failure BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION test_event_failure()',
  );
  try {
    expect((await dispatch(e.id, p, 5)).statusCode).toBe(500);
    expect(await qty(f.wa.id, p)).toBe(20);
    expect(await qty(e.transitWarehouseId, p)).toBe(0);
    expect(
      await db.eventDocument.count({
        where: { eventId: e.id, kind: "DISPATCH" },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { recordId: e.id, action: "EVENT_DISPATCHED" },
      }),
    ).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER test_event_failure ON "StockMovement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION test_event_failure()");
  }
});
it("retorno parcial10→3; retry não duplica; quantidade acima do saldo rejeitada", async () => {
  const e = await event(),
    p = await book(),
    d = await dispatch(e.id, p, 10);
  await receive(e.id, d.json().id, p, 10);
  const key = randomUUID(),
    [a, b] = await Promise.all([ret(e.id, p, 7, key), ret(e.id, p, 7, key)]);
  expect(a.statusCode, a.body).toBe(201);
  expect(b.json().id).toBe(a.json().id);
  expect(await qty(e.warehouseId, p)).toBe(3);
  expect((await ret(e.id, p, 4)).statusCode).toBe(409);
});
it("enviado10 recebido9 exige motivo, preserva diferença-1 e aceita conferência complementar", async () => {
  const e = await event(),
    p = await book(),
    d = await dispatch(e.id, p, 10);
  expect((await receive(e.id, d.json().id, p, 9)).statusCode).toBe(400);
  expect(await qty(e.transitWarehouseId, p)).toBe(10);
  const r = await receive(
    e.id,
    d.json().id,
    p,
    9,
    "Uma unidade ainda na transportadora",
  );
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().items[0].quantity - r.json().items[0].expectedQuantity).toBe(
    -1,
  );
  expect(await qty(e.warehouseId, p)).toBe(9);
  expect(await qty(e.transitWarehouseId, p)).toBe(1);
  expect((await receive(e.id, d.json().id, p, 2)).statusCode).toBe(409);
  expect((await receive(e.id, d.json().id, p, 1)).statusCode).toBe(201);
  expect(await qty(e.warehouseId, p)).toBe(10);
  expect(await qty(e.transitWarehouseId, p)).toBe(0);
  expect(
    await db.eventDocument.count({ where: { dispatchId: d.json().id } }),
  ).toBe(2);
});
it("conferências concorrentes não duplicam entrada", async () => {
  const e = await event(),
    p = await book(),
    d = await dispatch(e.id, p, 5);
  const r = await Promise.all([
    receive(e.id, d.json().id, p, 5),
    receive(e.id, d.json().id, p, 5),
  ]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([201, 409]);
  expect(await qty(e.warehouseId, p)).toBe(5);
});
it("lifecycle e fechamento bloqueiam saldo/trânsito e operações posteriores", async () => {
  const e = await event(false),
    p = await book();
  expect((await dispatch(e.id, p, 5)).statusCode).toBe(409);
  await post(`/events/${e.id}/state`, {
    requestKey: randomUUID(),
    action: "PREPARE",
  });
  const d = await dispatch(e.id, p, 5);
  await receive(e.id, d.json().id, p, 4, "Unidade em trânsito ainda");
  await ret(e.id, p, 4);
  expect(
    (
      await post(`/events/${e.id}/state`, {
        requestKey: randomUUID(),
        action: "CLOSE",
      })
    ).statusCode,
  ).toBe(409);
  await receive(e.id, d.json().id, p, 1);
  await ret(e.id, p, 1);
  expect(
    (
      await post(`/events/${e.id}/state`, {
        requestKey: randomUUID(),
        action: "CLOSE",
      })
    ).statusCode,
  ).toBe(200);
  expect((await dispatch(e.id, p, 1)).statusCode).toBe(409);
  expect((await ret(e.id, p, 1)).statusCode).toBe(409);
  expect((await get(`/events/${e.id}`)).json().status).toBe("CLOSED");
});
it("cancelamento somente antes de operar; exige motivo; terminal bloqueado", async () => {
  const e = await event(false);
  expect(
    (
      await post(`/events/${e.id}/state`, {
        requestKey: randomUUID(),
        action: "CANCEL",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post(`/events/${e.id}/state`, {
        requestKey: randomUUID(),
        action: "CANCEL",
        notes: "Evento cancelado pela escola",
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await post(`/events/${e.id}/state`, {
        requestKey: randomUUID(),
        action: "PREPARE",
      })
    ).statusCode,
  ).toBe(409);
});
it("outra empresa/filial e falta de permissão são rejeitadas; responsável incompatível", async () => {
  const e = await event(),
    p = await book();
  expect(
    (
      await post(`/events/${e.id}/dispatches`, {
        requestKey: randomUUID(),
        warehouseId: f.wb.id,
        items: items(p, 1),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post(
        "/events",
        { requestKey: randomUUID(), event: registration() },
        operator,
      )
    ).statusCode,
  ).toBe(403);
  const foreign = await db.event.create({
    data: {
      ...registration(),
      startsAt: new Date("2026-10-10"),
      endsAt: new Date("2026-10-15"),
      companyId: other.company.id,
      branchId: other.a.id,
      responsibleId: other.users[0]!.member.id,
      warehouseId: other.wa.id,
      transitWarehouseId: other.wb.id,
      code: "TEST-FOREIGN",
    },
  });
  expect((await get("/events/" + foreign.id)).statusCode).toBe(404);
  expect(
    (
      await post(`/events/${foreign.id}/dispatches`, {
        requestKey: randomUUID(),
        warehouseId: f.wa.id,
        items: items(p, 1),
      })
    ).statusCode,
  ).toBe(404);
  const reg = registration();
  reg.branchId = f.b.id;
  expect(
    (await post("/events", { requestKey: randomUUID(), event: reg }))
      .statusCode,
  ).toBe(400);
  const otherBranch = await post("/events", {
    requestKey: randomUUID(),
    event: { ...reg, responsibleId: f.users[0]!.member.id },
  });
  expect(
    (await get("/events/" + otherBranch.json().eventId, operator)).statusCode,
  ).toBe(404);
  expect(
    (
      await post(
        `/events/${otherBranch.json().eventId}/dispatches`,
        { requestKey: randomUUID(), warehouseId: f.wb.id, items: items(p, 1) },
        operator,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await post(
        `/events/${e.id}/dispatches`,
        { requestKey: randomUUID(), warehouseId: f.wa.id, items: items(p, 1) },
        operator,
      )
    ).statusCode,
  ).toBe(201);
});
it("depósitos de evento não aceitam entrada, ajuste ou PDV comum e não somam disponível da filial", async () => {
  const e = await event(),
    p = await book();
  await dispatch(e.id, p, 5);
  expect(
    (
      await post("/stock/entries", {
        requestKey: randomUUID(),
        warehouseId: e.warehouseId,
        supplierId: f.supplier.id,
        receivedAt: "2026-09-29",
        items: [{ productId: p, quantity: 1, unitCost: "1" }],
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await post("/stock/adjustments", {
        requestKey: randomUUID(),
        warehouseId: e.transitWarehouseId,
        productId: p,
        quantity: 1,
        expectedQuantity: "5",
        reason: "Ajuste proibido no evento",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await post("/sales/quote", {
        warehouseId: e.warehouseId,
        items: [{ productId: p, quantity: 1, expectedUnitPrice: "10" }],
      })
    ).statusCode,
  ).toBe(409);
  expect(Number((await get(`/stock/books/${p}`)).json().total)).toBe(15);
  const product = await db.product.findUniqueOrThrow({ where: { id: p } });
  expect(
    (await get("/products?q=" + encodeURIComponent(product.code))).json()
      .items[0].stock,
  ).toBe(15);
  const stockOptions = (await get("/stock/options")).json();
  expect(
    stockOptions.warehouses.some((w: { id: string }) =>
      [e.warehouseId, e.transitWarehouseId].includes(w.id),
    ),
  ).toBe(false);
  const options = (await get("/sales/options")).json();
  expect(
    options.warehouses.some((w: { id: string }) => w.id === e.warehouseId),
  ).toBe(false);
});
it("validação de datas, leitura exata e edição antes de operar", async () => {
  expect(
    (
      await post("/events", {
        requestKey: randomUUID(),
        event: { ...registration(), endsAt: "2026-01-01" },
      })
    ).statusCode,
  ).toBe(400);
  const e = await event(false),
    p = await book();
  const b = await db.product.findUniqueOrThrow({ where: { id: p } });
  expect(
    (await get("/events/books?code=" + encodeURIComponent(b.code))).json()[0]
      .id,
  ).toBe(p);
  const payload = {
    requestKey: randomUUID(),
    event: { ...registration(), name: "Evento editado" },
  };
  const edit = await app.inject({
    method: "PUT",
    url: "/api/events/" + e.id,
    headers: { cookie, origin },
    payload,
  });
  expect(edit.statusCode, edit.body).toBe(200);
  expect((await get("/events/" + e.id)).json().name).toBe("Evento editado");
});
it("recebimento idempotente preserva um REC e rejeita chave com novo conteúdo", async () => {
  const e = await event(),
    p = await book(),
    d = await dispatch(e.id, p, 5);
  const payload = {
    requestKey: randomUUID(),
    dispatchId: d.json().id,
    items: items(p, 5),
  };
  const [a, b] = await Promise.all([
    post(`/events/${e.id}/receipts`, payload),
    post(`/events/${e.id}/receipts`, payload),
  ]);
  expect(a.statusCode, a.body).toBe(201);
  expect(b.json().id).toBe(a.json().id);
  expect(await qty(e.warehouseId, p)).toBe(5);
  expect(
    await db.eventDocument.count({ where: { dispatchId: d.json().id } }),
  ).toBe(1);
  expect(
    (
      await post(`/events/${e.id}/receipts`, {
        ...payload,
        items: items(p, 4),
        notes: "Conteúdo diferente",
      })
    ).statusCode,
  ).toBe(409);
});
it("retornos concorrentes e rollback no destino mantêm saldo total", async () => {
  const e = await event(),
    p = await book(5),
    d = await dispatch(e.id, p, 5);
  expect((await receive(e.id, d.json().id, p, 5)).statusCode).toBe(201);
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION test_event_return_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."warehouseId"='${f.wa.id}'::uuid AND NEW."productId"='${p}'::uuid THEN RAISE EXCEPTION 'forced return failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_event_return_failure BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION test_event_return_failure()',
  );
  try {
    expect((await ret(e.id, p, 4)).statusCode).toBe(500);
    expect(await qty(e.warehouseId, p)).toBe(5);
    expect(await qty(f.wa.id, p)).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER test_event_return_failure ON "StockMovement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION test_event_return_failure()");
  }
  const results = await Promise.all([ret(e.id, p, 4), ret(e.id, p, 4)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(await qty(e.warehouseId, p)).toBe(1);
  expect(await qty(f.wa.id, p)).toBe(4);
});
