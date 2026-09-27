import { openTestCash } from "./cash-fixture.js";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { testDatabase, stockFixture } from "./stock-fixture.js";
import {
  cents,
  reais,
  discountCents,
  splitCents,
  rolePermissions,
  type Checkout,
} from "@caramelo/contracts";
const db = testDatabase(),
  origin = "http://localhost:5173";
let f: Awaited<ReturnType<typeof stockFixture>>,
  other: Awaited<ReturnType<typeof stockFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  seller: string,
  book: string;
const post = (url: string, payload: unknown, session = cookie) =>
  app.inject({
    method: "POST",
    url,
    headers: { origin, cookie: session },
    payload: payload as object,
  });
const get = (url: string, session = cookie) =>
  app.inject({ method: "GET", url, headers: { cookie: session } });
const payment = (
  method: Checkout["payments"][number]["method"],
  amount: string,
  extra: Partial<Checkout["payments"][number]> = {},
) => ({ method, amount, installments: 1, confirmed: true, ...extra });
function checkout(
  quantity = 1,
  productId = book,
  warehouseId = f.wa.id,
): Checkout {
  return {
    requestKey: randomUUID(),
    cart: {
      warehouseId,
      discount: { type: "AMOUNT", value: "0" },
      items: [
        {
          productId,
          quantity,
          expectedUnitPrice: "50.00",
          discount: { type: "AMOUNT", value: "0" },
        },
      ],
    },
    payments: [payment("PIX", String(quantity * 50))],
  };
}
const balance = async (productId = book, warehouseId = f.wa.id) =>
  String(
    (
      await db.stockBalance.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: f.company.id,
            warehouseId,
            productId,
          },
        },
      })
    )?.quantity ?? 0,
  );
async function newBook(code: string, quantity: number, warehouseId = f.wa.id) {
  const r = await post("/api/products", {
    code,
    barcode: code + "-EAN",
    description: "Livro Teste Caramelo " + code,
    author: "Autoria fictícia",
    publisher: "Editora fictícia",
    price: "50.00",
    cost: "20.00",
    minStock: "1",
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().id as string;
  const entry = await post("/api/stock/entries", {
    requestKey: randomUUID(),
    warehouseId,
    supplierId: f.supplier.id,
    receivedAt: "2026-09-26",
    items: [{ productId: id, quantity, unitCost: "20" }],
  });
  expect(entry.statusCode, entry.body).toBe(201);
  return id;
}
beforeAll(async () => {
  f = await stockFixture(db);
  other = await stockFixture(db);
  const role = await db.role.create({
    data: {
      companyId: f.company.id,
      name: "Vendedor",
      permissions: {
        create: rolePermissions.Vendedor!.map((permissionCode) => ({
          permissionCode,
        })),
      },
    },
  });
  await db.membership.update({
    where: { id: f.users[1]!.member.id },
    data: { roleId: role.id },
  });
  app = await buildApp({ db, origin, rateLimitMax: 2000 });
  for (const [i, u] of f.users.entries()) {
    const r = await post(
      "/api/auth/login",
      { company: f.company.slug, email: u.user.email, password: f.password },
      "",
    );
    expect(r.statusCode).toBe(200);
    const c = String(r.headers["set-cookie"]).split(";")[0]!;
    if (i === 0) cookie = c;
    else seller = c;
  }
  await openTestCash(app, cookie, f.a.id);
  await openTestCash(app, cookie, f.b.id);
  book = await newBook("DEMO-PDV", 10);
});
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
  await other?.cleanup();
  await db.$disconnect();
});
it("calcula centavos, arredondamento percentual e parcelas sem perder centavos", () => {
  expect(cents("129.70")).toBe(12970n);
  expect(reais(2030n)).toBe("20.30");
  expect(discountCents(1999n, { type: "PERCENT", value: "2.5" })).toBe(50n);
  expect(splitCents(10001n, 3)).toEqual([3334n, 3334n, 3333n]);
  expect(() => splitCents(1n, 2)).toThrow();
  expect(() => cents("1.999")).toThrow();
  expect(() =>
    discountCents(100n, { type: "PERCENT", value: "101" }),
  ).toThrow();
});
it("consulta código e cota carrinho sem reservar nem baixar estoque", async () => {
  const r = await get(
    "/api/sales/lookup?warehouseId=" + f.wa.id + "&code=demo-pdv-ean",
  );
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({ id: book, price: "50", available: "10" });
  expect(
    (await post("/api/sales/quote", checkout(2).cart)).json(),
  ).toMatchObject({ total: "100.00" });
  expect(await balance()).toBe("10");
  expect(await db.sale.count({ where: { companyId: f.company.id } })).toBe(0);
  expect(
    (await get("/api/sales/lookup?warehouseId=" + f.wa.id + "&code=naoexiste"))
      .statusCode,
  ).toBe(404);
});
it("executa PIX → dinheiro/troco → crédito 2x → misto → cancelamento, conferindo PostgreSQL", async () => {
  const pix = await post("/api/sales", checkout(2));
  expect(pix.statusCode, pix.body).toBe(201);
  const p = pix.json();
  expect(await balance()).toBe("8");
  expect(p.items).toHaveLength(1);
  expect(p.payments).toHaveLength(1);
  expect(p.movements[0]).toMatchObject({
    quantity: "-2",
    beforeQuantity: "10",
    afterQuantity: "8",
    saleId: p.id,
  });
  expect(p.financialEntries[0]).toMatchObject({
    amount: "100",
    status: "SETTLED",
    type: "RECEIVABLE",
  });
  expect(p.cashMovements[0]).toMatchObject({ amount: "100", kind: "RECEIPT" });
  const cashInput = checkout();
  cashInput.payments = [payment("CASH", "50", { receivedAmount: "100" })];
  const cash = await post("/api/sales", cashInput);
  expect(cash.statusCode, cash.body).toBe(201);
  expect(cash.json().payments[0]).toMatchObject({
    receivedAmount: "100",
    change: "50",
  });
  expect(cash.json().cashMovements[0].amount).toBe("50");
  expect(await balance()).toBe("7");
  const creditInput = checkout();
  creditInput.payments = [
    payment("CREDIT_CARD", "50", {
      installments: 2,
      cardBrand: "Teste",
      reference: "Transação externa fictícia",
    }),
  ];
  const credit = await post("/api/sales", creditInput);
  expect(credit.statusCode, credit.body).toBe(201);
  expect(credit.json().payments[0].installments).toBe(2);
  expect(
    credit
      .json()
      .financialEntries.map((e: { amount: string; status: string }) => [
        e.amount,
        e.status,
      ]),
  ).toEqual([
    ["25", "OPEN"],
    ["25", "OPEN"],
  ]);
  expect(
    credit
      .json()
      .cashMovements.filter(
        (m: { method: string }) => m.method === "CASH" || m.method === "PIX",
      ),
  ).toHaveLength(0);
  expect(credit.json().cashMovements[0].method).toBe("CREDIT_CARD");
  expect(await balance()).toBe("6");
  const mixedInput = checkout(2);
  mixedInput.payments = [payment("PIX", "40"), payment("DEBIT_CARD", "60")];
  const mixed = await post("/api/sales", mixedInput);
  expect(mixed.statusCode, mixed.body).toBe(201);
  const m = mixed.json();
  expect(await balance()).toBe("4");
  expect(m.payments).toHaveLength(2);
  expect(
    m.financialEntries.map((e: { amount: string; status: string }) => [
      e.amount,
      e.status,
    ]),
  ).toEqual([
    ["40", "SETTLED"],
    ["60", "OPEN"],
  ]);
  const cancel = {
    requestKey: randomUUID(),
    reason: "Cliente desistiu da compra de teste",
    refundConfirmed: true,
  };
  expect(
    (await post("/api/sales/" + m.id + "/cancel", cancel, seller)).statusCode,
  ).toBe(403);
  expect(
    (await post("/api/sales/" + m.id + "/cancel", { ...cancel, reason: "" }))
      .statusCode,
  ).toBe(400);
  const cancelled = await post("/api/sales/" + m.id + "/cancel", cancel);
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  expect(cancelled.json().status).toBe("CANCELLED");
  expect(await balance()).toBe("6");
  const persisted = await db.sale.findUniqueOrThrow({
    where: { id: m.id },
    include: {
      payments: true,
      movements: true,
      financialEntries: true,
      cashMovements: true,
    },
  });
  expect(persisted.movements.map((x) => String(x.quantity)).sort()).toEqual([
    "-2",
    "2",
  ]);
  expect(
    persisted.financialEntries.every(
      (x) => x.status === "CANCELLED" && x.settledAt === null,
    ),
  ).toBe(true);
  expect(persisted.payments.every((x) => x.reversedAt !== null)).toBe(true);
  expect(
    persisted.cashMovements.reduce((n, x) => n + Number(x.amount), 0),
  ).toBe(0);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { recordId: m.id, action: "SALE_CANCELLED" },
  });
  expect(audit.actorId).toBe(f.users[0]!.member.id);
  expect(audit.metadata).toMatchObject({
    reason: cancel.reason,
    refundConfirmed: true,
  });
  expect(audit.createdAt).toBeInstanceOf(Date);
  expect(
    (await post("/api/sales/" + m.id + "/cancel", cancel)).statusCode,
  ).toBe(200);
  expect(await balance()).toBe("6");
  expect(
    (
      await post("/api/sales/" + m.id + "/cancel", {
        ...cancel,
        requestKey: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  expect(await db.sale.count({ where: { companyId: f.company.id } })).toBe(4);
});
it("recusa pagamentos divergentes, não confirmados, troco insuficiente, preço adulterado e quantidade inválida", async () => {
  const before = await balance(),
    count = await db.sale.count({ where: { companyId: f.company.id } });
  for (const p of [
    [payment("PIX", "49")],
    [payment("PIX", "51")],
    [payment("PIX", "50", { confirmed: false })],
    [payment("CASH", "50", { receivedAmount: "49" })],
    [payment("DEBIT_CARD", "50", { installments: 2 })],
    [payment("PIX", "50", { receivedAmount: "50" })],
  ]) {
    const input = checkout();
    input.payments = p;
    const r = await post("/api/sales", input);
    expect(r.statusCode, r.body).toBe(400);
  }
  const fake = checkout();
  fake.cart.items[0]!.expectedUnitPrice = "1";
  expect((await post("/api/sales", fake)).statusCode).toBe(409);
  const fraction = checkout();
  fraction.cart.items[0]!.quantity = 1.5;
  expect((await post("/api/sales", fraction)).statusCode).toBe(400);
  const over = checkout(999);
  expect((await post("/api/sales", over)).json().message).toBe(
    "Estoque insuficiente.",
  );
  const negative = checkout();
  negative.cart.discount = { type: "AMOUNT", value: "51" };
  expect((await post("/api/sales", negative)).statusCode).toBe(400);
  expect(await balance()).toBe(before);
  expect(await db.sale.count({ where: { companyId: f.company.id } })).toBe(
    count,
  );
});
it("serializa duas vendas da última unidade: uma concluída, outra recusada, saldo zero", async () => {
  const id = await newBook("DEMO-ULTIMO", 1);
  const results = await Promise.all([
    post("/api/sales", checkout(1, id)),
    post("/api/sales", checkout(1, id)),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().message).toBe(
    "Estoque insuficiente.",
  );
  expect(await balance(id)).toBe("0");
  expect(
    await db.saleItem.count({
      where: { productId: id, companyId: f.company.id },
    }),
  ).toBe(1);
});
it("deduplica confirmações simultâneas e rejeita reuso da chave com conteúdo diferente", async () => {
  const id = await newBook("DEMO-IDEMPOTENTE", 3),
    input = checkout(1, id);
  const responses = await Promise.all([
    post("/api/sales", input),
    post("/api/sales", input),
  ]);
  expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
  expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
  expect(await balance(id)).toBe("2");
  expect(
    await db.stockMovement.count({ where: { productId: id, type: "OUT" } }),
  ).toBe(1);
  input.cart.items[0]!.quantity = 2;
  expect((await post("/api/sales", input)).statusCode).toBe(409);
});
it("reverte toda a transação quando o lançamento financeiro falha depois da baixa", async () => {
  const id = await newBook("DEMO-ROLLBACK", 2),
    input = checkout(1, id),
    where = { companyId: f.company.id };
  const counts = async () =>
    Promise.all([
      db.sale.count({ where }),
      db.payment.count({ where }),
      db.stockMovement.count({ where }),
      db.cashMovement.count({ where }),
      db.auditLog.count({ where }),
      db.financialEntry.count({ where }),
    ]);
  const before = await counts();
  // DDL confined to the validated local _test database and this unique tenant.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION pdv_test_fail_finance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId" = '${f.company.id}' THEN RAISE EXCEPTION 'PDV_TEST_ROLLBACK'; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      'CREATE TRIGGER pdv_test_fail_finance BEFORE INSERT ON "FinancialEntry" FOR EACH ROW EXECUTE FUNCTION pdv_test_fail_finance()',
    );
    expect((await post("/api/sales", input)).statusCode).toBe(500);
    expect(await balance(id)).toBe("2");
    expect(await counts()).toEqual(before);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS pdv_test_fail_finance ON "FinancialEntry"',
    );
    await db.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS pdv_test_fail_finance()",
    );
  }
  expect((await post("/api/sales", input)).statusCode).toBe(201);
  expect(await balance(id)).toBe("1");
});
it("aplica limites de desconto por perfil à soma do desconto dos itens e do total", async () => {
  const input = checkout();
  input.cart.items[0]!.discount = { type: "PERCENT", value: "3" };
  input.cart.discount = { type: "AMOUNT", value: "1" };
  input.payments = [payment("PIX", "47.50")];
  expect((await post("/api/sales/quote", input.cart, seller)).statusCode).toBe(
    200,
  );
  input.cart.discount.value = "1.01";
  expect((await post("/api/sales/quote", input.cart, seller)).statusCode).toBe(
    403,
  );
  input.cart.discount = { type: "PERCENT", value: "50" };
  expect((await post("/api/sales/quote", input.cart)).statusCode).toBe(200);
  const role = await db.role.findFirstOrThrow({
    where: { companyId: f.company.id, name: "Vendedor" },
  });
  await db.rolePermission.delete({
    where: {
      roleId_permissionCode: {
        roleId: role.id,
        permissionCode: "sales:discount",
      },
    },
  });
  expect((await post("/api/sales/quote", input.cart, seller)).statusCode).toBe(
    403,
  );
  await db.rolePermission.create({
    data: { roleId: role.id, permissionCode: "sales:discount" },
  });
});
it("restringe filial e empresa em lookup, venda, histórico, detalhes e cancelamento", async () => {
  const id = await newBook("DEMO-FILIAL-B", 2, f.wb.id);
  const sale = await post("/api/sales", checkout(1, id, f.wb.id));
  expect(sale.statusCode).toBe(201);
  const saleId = sale.json().id;
  expect(
    (await post("/api/sales", checkout(1, id, f.wb.id), seller)).statusCode,
  ).toBe(404);
  expect(
    (
      await get(
        "/api/sales/lookup?warehouseId=" + f.wb.id + "&productId=" + id,
        seller,
      )
    ).statusCode,
  ).toBe(404);
  expect((await get("/api/sales/" + saleId, seller)).statusCode).toBe(404);
  const period = "from=2026-01-01&to=2026-12-31";
  expect(
    (await get("/api/sales?" + period + "&branchId=" + f.b.id, seller)).json()
      .items,
  ).toEqual([]);
  const otherLogin = await post(
    "/api/auth/login",
    {
      company: other.company.slug,
      email: other.users[0]!.user.email,
      password: other.password,
    },
    "",
  );
  const otherCookie = String(otherLogin.headers["set-cookie"]).split(";")[0]!;
  expect((await get("/api/sales/" + saleId, otherCookie)).statusCode).toBe(404);
  expect(
    (await post("/api/sales", checkout(1, id, f.wb.id), otherCookie))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await post(
        "/api/sales/" + saleId + "/cancel",
        {
          requestKey: randomUUID(),
          reason: "Tentativa entre empresas",
          refundConfirmed: true,
        },
        otherCookie,
      )
    ).statusCode,
  ).toBe(404);
  const foreignCustomer = await db.customer.create({
    data: { companyId: other.company.id, name: "Cliente de outra empresa" },
  });
  const c = checkout();
  c.cart.customerId = foreignCustomer.id;
  expect((await post("/api/sales", c)).statusCode).toBe(400);
  expect(await balance(id, f.wb.id)).toBe("1");
});
it("filtra vendas por cliente, operador, status e período", async () => {
  const customer = await post("/api/customers", {
    name: "Cliente PDV Fictício",
    phone: "00000000000",
    email: "pdv@example.invalid",
  });
  expect(customer.statusCode, customer.body).toBe(201);
  const input = checkout();
  input.cart.customerId = customer.json().id;
  const sold = await post("/api/sales", input);
  expect(sold.statusCode, sold.body).toBe(201);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const r = await get(
    "/api/sales?" +
      new URLSearchParams({
        from: date,
        to: date,
        customerQuery: "pdv@example.invalid",
        operatorId: f.users[0]!.member.id,
        status: "COMPLETED",
      }),
  );
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().items.map((s: { id: string }) => s.id)).toEqual([
    sold.json().id,
  ]);
});
