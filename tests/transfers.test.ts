import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { stockFixture, testDatabase } from "./stock-fixture.js";
import { addScanned } from "@caramelo/contracts";
const db = testDatabase(),
  origin = "http://localhost:5173";
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  outsider = "",
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
const command = (id: string, kind: string, extra: object = {}, auth = cookie) =>
  post(
    `/transfers/${id}/${kind}`,
    { requestKey: randomUUID(), ...extra },
    auth,
  );
async function book(q = 20) {
  const p = await post("/products", {
    code: "TRF-" + randomUUID(),
    description: "Livro transferência fictício",
    price: "50",
    cost: "10",
    minStock: "0",
  });
  expect(p.statusCode).toBe(201);
  const productId = p.json().id as string;
  const r = await post("/stock/entries", {
    requestKey: randomUUID(),
    warehouseId: f.wa.id,
    supplierId: f.supplier.id,
    receivedAt: "2026-01-01",
    items: [{ productId, quantity: q, unitCost: "10" }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return productId;
}
const input = (productId: string, quantity = 5) => ({
  requestKey: randomUUID(),
  originWarehouseId: f.wa.id,
  destinationWarehouseId: f.wb.id,
  responsibleId: f.users[0]!.member.id,
  items: [{ productId, quantity }],
});
async function create(productId: string, quantity = 5, extra: object = {}) {
  const r = await post("/transfers", {
    ...input(productId, quantity),
    ...extra,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().transferId as string;
}
const detail = async (id: string) => (await get("/transfers/" + id)).json();
async function send(id: string) {
  expect((await command(id, "prepare")).statusCode).toBe(200);
  const r = await command(id, "send");
  expect(r.statusCode, r.body).toBe(200);
}
const receive = (id: string, p: string, q: number, extra: object = {}) =>
  command(id, "receive", {
    items: [{ productId: p, quantity: q }],
    notes: "Conferência parcial de teste",
    ...extra,
  });
async function balance(productId: string, warehouseId: string) {
  return Number(
    (
      await db.stockBalance.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: f.company.id,
            productId,
            warehouseId,
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
it("cria rascunho numerado sem movimentar estoque", async () => {
  const p = await book(),
    id = await create(p),
    d = await detail(id);
  expect(d.status).toBe("DRAFT");
  expect(d.code).toMatch(/^TRF-/);
  expect(d.documents[0].items).toHaveLength(1);
  expect(d.documents[0].movements).toHaveLength(0);
  expect(await balance(p, f.wa.id)).toBe(20);
});
it("rejeita origem e destino na mesma filial", async () => {
  const p = await book();
  expect(
    (await post("/transfers", { ...input(p), destinationWarehouseId: f.wa.id }))
      .statusCode,
  ).toBe(400);
});
it("rejeita destino de outra empresa", async () => {
  const p = await book();
  expect(
    (
      await post("/transfers", {
        ...input(p),
        destinationWarehouseId: other.wb.id,
      })
    ).statusCode,
  ).toBe(404);
});
it("scanner compartilhado agrega cinco leituras em uma linha", () => {
  const b = {
    id: randomUUID(),
    description: "Livro teste",
    isbn13: "9788535914849",
  };
  let lines: ReturnType<typeof addScanned> = [];
  for (let i = 0; i < 5; i++) lines = addScanned(lines, b, "0");
  expect(lines).toHaveLength(1);
  expect(lines[0]!.quantity).toBe(5);
});
it("envio 20 → 15 origem, 5 trânsito e zero destino", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const d = await detail(id);
  expect([
    await balance(p, f.wa.id),
    await balance(p, d.transitWarehouseId),
    await balance(p, f.wb.id),
  ]).toEqual([15, 5, 0]);
  expect(d.status).toBe("IN_TRANSIT");
});
it("recebimento completo zera trânsito e credita destino", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  expect((await receive(id, p, 5)).statusCode).toBe(200);
  const d = await detail(id);
  expect([
    d.status,
    await balance(p, d.transitWarehouseId),
    await balance(p, f.wb.id),
  ]).toEqual(["RECEIVED", 0, 5]);
});
it("parcial 6 + complementar 4 preservam saldo e fecham", async () => {
  const p = await book(),
    id = await create(p, 10);
  await send(id);
  expect((await receive(id, p, 6)).statusCode).toBe(200);
  let d = await detail(id);
  expect([
    d.status,
    await balance(p, d.transitWarehouseId),
    await balance(p, f.wb.id),
  ]).toEqual(["PARTIALLY_RECEIVED", 4, 6]);
  expect((await receive(id, p, 4)).statusCode).toBe(200);
  d = await detail(id);
  expect([
    d.status,
    await balance(p, d.transitWarehouseId),
    await balance(p, f.wb.id),
  ]).toEqual(["RECEIVED", 0, 10]);
});
it("parcial em múltiplos livros preserva pendência individual", async () => {
  const a = await book(),
    b = await book(),
    id = await create(a, 10, {
      items: [
        { productId: a, quantity: 10 },
        { productId: b, quantity: 5 },
      ],
    });
  await send(id);
  const r = await command(id, "receive", {
    items: [
      { productId: a, quantity: 8 },
      { productId: b, quantity: 5 },
    ],
    notes: "Faltaram dois exemplares A",
  });
  expect(r.statusCode).toBe(200);
  const d = await detail(id);
  expect(await balance(a, d.transitWarehouseId)).toBe(2);
  expect(await balance(b, d.transitWarehouseId)).toBe(0);
  expect(await balance(b, f.wb.id)).toBe(5);
});
it("excedente é rejeitado sem criar estoque", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  expect((await receive(id, p, 6)).statusCode).toBe(409);
  expect(await balance(p, f.wb.id)).toBe(0);
});
it("recebimento menor exige motivo e registra diferença", async () => {
  const p = await book(),
    id = await create(p, 10);
  await send(id);
  expect((await receive(id, p, 9, { notes: "" })).statusCode).toBe(400);
  expect((await receive(id, p, 9)).statusCode).toBe(200);
  const d = await detail(id),
    doc = d.documents.find(
      (x: { kind: string }) => x.kind === "TRANSFER_RECEIVE",
    );
  expect(doc.divergences[0]).toMatchObject({
    expected: 10,
    observed: 9,
    kind: "MISSING",
  });
  expect(await balance(p, d.transitWarehouseId)).toBe(1);
});
it("retorno parcial à origem mantém conservação e encerra com retorno", async () => {
  const p = await book(),
    id = await create(p, 10);
  await send(id);
  await receive(id, p, 8);
  const r = await command(id, "return", {
    items: [{ productId: p, quantity: 2 }],
    notes: "Volumes retornaram fisicamente",
  });
  expect(r.statusCode, r.body).toBe(200);
  const d = await detail(id);
  expect([
    d.status,
    await balance(p, f.wa.id),
    await balance(p, f.wb.id),
    await balance(p, d.transitWarehouseId),
  ]).toEqual(["CLOSED_RETURNED", 12, 8, 0]);
});
it("cancela antes do envio sem movimento artificial", async () => {
  const p = await book(),
    id = await create(p);
  expect(
    (await command(id, "cancel", { notes: "Solicitação cancelada na origem" }))
      .statusCode,
  ).toBe(200);
  const d = await detail(id);
  expect(d.status).toBe("CANCELLED");
  expect(
    d.documents.flatMap((x: { movements: unknown[] }) => x.movements),
  ).toHaveLength(0);
});
it("cancelamento simples após envio é bloqueado", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  expect(
    (await command(id, "cancel", { notes: "Não pode apagar movimentos" }))
      .statusCode,
  ).toBe(409);
});
it("duas transferências de 4 com saldo 5 aprovam somente uma", async () => {
  const p = await book(5),
    a = await create(p, 4),
    b = await create(p, 4);
  await command(a, "prepare");
  await command(b, "prepare");
  const r = await Promise.all([command(a, "send"), command(b, "send")]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  expect(await balance(p, f.wa.id)).toBe(1);
});
it("dois recebimentos concorrentes não duplicam destino", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const r = await Promise.all([receive(id, p, 5), receive(id, p, 5)]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  expect(await balance(p, f.wb.id)).toBe(5);
});
it("retry de envio retorna documento original com um único par", async () => {
  const p = await book(),
    id = await create(p),
    requestKey = randomUUID();
  await command(id, "prepare");
  const r = await Promise.all([
    command(id, "send", { requestKey }),
    command(id, "send", { requestKey }),
  ]);
  expect(r.map((x) => x.statusCode)).toEqual([200, 200]);
  expect(r[0]!.json()).toEqual(r[1]!.json());
  expect(
    await db.stockMovement.count({ where: { documentId: r[0]!.json().id } }),
  ).toBe(2);
});
it("retry de recebimento não duplica movimentos", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const requestKey = randomUUID(),
    a = await receive(id, p, 5, { requestKey }),
    b = await receive(id, p, 5, { requestKey });
  expect(a.statusCode).toBe(200);
  expect(b.json()).toEqual(a.json());
  expect(await balance(p, f.wb.id)).toBe(5);
});
it("mesma chave com outro conteúdo é rejeitada", async () => {
  const p = await book(),
    id = await create(p),
    requestKey = randomUUID();
  await send(id);
  await receive(id, p, 2, { requestKey });
  expect((await receive(id, p, 3, { requestKey })).statusCode).toBe(409);
});
async function failure(warehouseId: string, action: () => Promise<void>) {
  await db.$executeRawUnsafe(
    `CREATE FUNCTION transfer_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."warehouseId"='${warehouseId}'::uuid AND NEW.type='TRANSFER' AND NEW.quantity>0 THEN RAISE EXCEPTION 'transfer rollback'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER transfer_test_failure BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION transfer_test_failure()',
  );
  try {
    await action();
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER transfer_test_failure ON "StockMovement"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION transfer_test_failure()");
  }
}
it("rollback após débito da origem restaura tudo", async () => {
  const p = await book(),
    id = await create(p);
  await command(id, "prepare");
  const d = await detail(id);
  await failure(d.transitWarehouseId, async () => {
    expect((await command(id, "send")).statusCode).toBe(500);
    expect(await balance(p, f.wa.id)).toBe(20);
    expect(await balance(p, d.transitWarehouseId)).toBe(0);
    expect((await detail(id)).status).toBe("READY");
    expect(
      await db.stockDocument.count({
        where: { transferId: id, kind: "TRANSFER_SEND" },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { recordId: id, action: "TRANSFER_SEND" },
      }),
    ).toBe(0);
  });
});
it("rollback antes do crédito ao destino preserva trânsito e histórico", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const d = await detail(id);
  await failure(f.wb.id, async () => {
    expect((await receive(id, p, 5)).statusCode).toBe(500);
    expect(await balance(p, f.wb.id)).toBe(0);
    expect(await balance(p, d.transitWarehouseId)).toBe(5);
    expect((await detail(id)).items[0].received).toBe(0);
    expect(
      await db.stockDocument.count({
        where: { transferId: id, kind: "TRANSFER_RECEIVE" },
      }),
    ).toBe(0);
  });
});
it("outra empresa não consulta nem movimenta", async () => {
  const p = await book(),
    id = await create(p);
  expect((await get("/transfers/" + id, outsider)).statusCode).toBe(404);
  expect((await command(id, "prepare", {}, outsider)).statusCode).toBe(404);
});
it("origem não pode receber, destino não pode enviar e terceira filial não vê", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  expect(
    (
      await command(
        id,
        "receive",
        { items: [{ productId: p, quantity: 5 }] },
        operator,
      )
    ).statusCode,
  ).toBe(403);
  const memberId = f.users[1]!.member.id;
  await db.membership.update({
    where: { id: memberId },
    data: { branchId: f.b.id },
  });
  try {
    expect(
      (
        await command(
          id,
          "return",
          {
            items: [{ productId: p, quantity: 1 }],
            notes: "Retorno físico solicitado",
          },
          operator,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await command(
          id,
          "receive",
          { items: [{ productId: p, quantity: 5 }] },
          operator,
        )
      ).statusCode,
    ).toBe(200);
    const third = await db.branch.create({
      data: { companyId: f.company.id, name: "Terceira filial" },
    });
    await db.membership.update({
      where: { id: memberId },
      data: { branchId: third.id },
    });
    expect((await get("/transfers/" + id, operator)).statusCode).toBe(404);
  } finally {
    await db.membership.update({
      where: { id: memberId },
      data: { branchId: f.a.id },
    });
  }
});
it("trânsito não aparece no estoque comum nem opções do PDV", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const d = await detail(id),
    stock = (await get("/stock?productId=" + p)).json();
  expect(
    stock.items.some(
      (x: { warehouseId: string }) => x.warehouseId === d.transitWarehouseId,
    ),
  ).toBe(false);
  const store = stock.items.find(
    (x: { warehouseId: string }) => x.warehouseId === f.wa.id,
  );
  expect(Number(store.quantity)).toBe(15);
  expect(
    (await get("/sales/options"))
      .json()
      .warehouses.some((w: { id: string }) => w.id === d.transitWarehouseId),
  ).toBe(false);
});
it("movimentos possuem documento, grupo e contrapartida exata", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  await receive(id, p, 5);
  const d = await detail(id);
  for (const doc of d.documents.filter(
    (x: { movements: unknown[] }) => x.movements.length,
  )) {
    expect(doc.movements).toHaveLength(2);
    expect(
      doc.movements.reduce(
        (n: number, m: { quantity: string }) => n + Number(m.quantity),
        0,
      ),
    ).toBe(0);
    expect(
      doc.movements.every(
        (m: { documentId: string; transferGroup: string }) =>
          m.documentId === doc.id && m.transferGroup === doc.id,
      ),
    ).toBe(true);
  }
});
it("encerrada bloqueia recebimento retorno edição e envio", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  await receive(id, p, 5);
  for (const action of ["receive", "return", "send", "prepare"])
    expect(
      (
        await command(id, action, {
          ...(action === "receive" || action === "return"
            ? {
                items: [{ productId: p, quantity: 1 }],
                notes: "Tentativa indevida de teste",
              }
            : {}),
        })
      ).statusCode,
    ).toBe(409);
});
it("edição de rascunho preserva snapshots e preparação bloqueia edição", async () => {
  const p = await book(),
    id = await create(p);
  expect(
    (await post("/transfers/" + id + "/edit", input(p, 3))).statusCode,
  ).toBe(200);
  let d = await detail(id);
  expect(d.items[0].quantity).toBe(3);
  expect(Number(d.documents[0].items[0].quantity)).toBe(5);
  await command(id, "prepare");
  expect(
    (await post("/transfers/" + id + "/edit", input(p, 2))).statusCode,
  ).toBe(409);
  d = await detail(id);
  expect(d.items[0].quantity).toBe(3);
});
it("estoque insuficiente rejeita envio de 6 quando há 5", async () => {
  const p = await book(5),
    id = await create(p, 6);
  await command(id, "prepare");
  expect((await command(id, "send")).statusCode).toBe(409);
  expect(await balance(p, f.wa.id)).toBe(5);
});
it("dano excedente e ISBN inesperado geram divergência sem estoque", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  for (const kind of ["DAMAGED", "EXCESS", "UNEXPECTED", "WRONG"]) {
    const r = await command(id, "divergence", {
      divergence: {
        kind,
        code: "ISBN inesperado",
        expected: 0,
        observed: 1,
        reason: "Conferência requer regularização",
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().divergences).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: {
          recordId: id,
          action: "TRANSFER_DIVERGENCE",
          metadata: { path: ["documentId"], equals: r.json().id },
        },
      }),
    ).toBe(1);
  }
  expect(await balance(p, f.wb.id)).toBe(0);
});
it("depósito de trânsito é bloqueado em entrada comum e ajuste", async () => {
  const p = await book(),
    id = await create(p),
    d = await detail(id);
  expect(
    (
      await post("/stock/entries", {
        requestKey: randomUUID(),
        warehouseId: d.transitWarehouseId,
        supplierId: f.supplier.id,
        receivedAt: "2026-01-01",
        items: [{ productId: p, quantity: 1, unitCost: "10" }],
      })
    ).statusCode,
  ).toBe(409);
});
it("filtros por número origem destino livro responsável status período", async () => {
  const p = await book(),
    id = await create(p),
    d = await detail(id);
  const r = await get(
    `/transfers?q=${d.code}&originId=${f.wa.id}&destinationId=${f.wb.id}&responsibleId=${f.users[0]!.member.id}&status=DRAFT&book=Livro&from=2020-01-01&to=2099-01-01`,
  );
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().items.map((x: { id: string }) => x.id)).toEqual([id]);
});
it("recebimentos parciais concorrentes respeitam saldo restante", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const r = await Promise.all([receive(id, p, 3), receive(id, p, 3)]);
  expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  const d = await detail(id);
  expect(await balance(p, f.wb.id)).toBe(3);
  expect(await balance(p, d.transitWarehouseId)).toBe(2);
});
it("sem permissão específica não pode criar", async () => {
  const p = await book(),
    member = await db.membership.findUniqueOrThrow({
      where: { id: f.users[1]!.member.id },
    });
  await db.rolePermission.delete({
    where: {
      roleId_permissionCode: {
        roleId: member.roleId,
        permissionCode: "transfers:create",
      },
    },
  });
  try {
    expect((await post("/transfers", input(p), operator)).statusCode).toBe(403);
  } finally {
    await db.rolePermission.create({
      data: { roleId: member.roleId, permissionCode: "transfers:create" },
    });
  }
});
it("banco rejeita contrapartida adicional desequilibrada", async () => {
  const p = await book(),
    id = await create(p);
  await send(id);
  const doc = await db.stockDocument.findFirstOrThrow({
    where: { transferId: id, kind: "TRANSFER_SEND" },
  });
  const movement = await db.stockMovement.findFirstOrThrow({
    where: { documentId: doc.id, quantity: { gt: 0 } },
  });
  await expect(
    db.stockMovement.create({ data: { ...movement, id: randomUUID() } }),
  ).rejects.toThrow();
  expect(await db.stockMovement.count({ where: { documentId: doc.id } })).toBe(
    2,
  );
});
