import { z } from "zod";
import { type Prisma, type Database } from "@caramelo/database";
import {
  commercialHour,
  commercialPeriods,
  cents,
  reais,
  csvCell,
} from "@caramelo/contracts";
import { HttpError, type AuthContext } from "../context.js";
import { originalItemValues } from "./returns.js";
export const salesFilter = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    branchId: z.uuid().optional(),
    cashRegisterId: z.uuid().optional(),
    cashSessionId: z.uuid().optional(),
    operatorId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    customerQuery: z.string().trim().max(100).optional(),
    number: z.coerce.number().int().positive().optional(),
    book: z.string().trim().max(100).optional(),
    isbn: z.string().trim().max(80).optional(),
    author: z.string().trim().max(100).optional(),
    publisher: z.string().trim().max(100).optional(),
    method: z
      .enum([
        "CASH",
        "PIX",
        "DEBIT_CARD",
        "CREDIT_CARD",
        "OTHER",
        "STORE_CREDIT",
        "BANK_SLIP",
      ])
      .optional(),
    status: z
      .enum(["COMPLETED", "CANCELLED", "QUOTE", "ORDER", "RETURNED"])
      .optional(),
    operation: z.enum(["EXCHANGE", "RETURN"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    view: z
      .enum([
        "sales",
        "items",
        "cash",
        "operators",
        "payments",
        "hours",
        "periods",
      ])
      .default("sales"),
    csv: z.enum(["true"]).optional(),
  })
  .strict()
  .refine((f) => !f.from || !f.to || f.from <= f.to, "Período inválido");
function itemWhere(f: z.infer<typeof salesFilter>): Prisma.SaleItemWhereInput {
  return {
    ...(f.book
      ? { description: { contains: f.book, mode: "insensitive" } }
      : {}),
    ...(f.isbn
      ? {
          OR: [
            { isbn: { contains: f.isbn } },
            {
              product: {
                identifiers: {
                  some: { value: { contains: f.isbn.replace(/[-\s]/g, "") } },
                },
              },
            },
          ],
        }
      : {}),
    ...(f.author
      ? { author: { contains: f.author, mode: "insensitive" } }
      : {}),
    ...(f.publisher
      ? {
          AND: [
            {
              OR: [
                { publisher: { contains: f.publisher, mode: "insensitive" } },
                {
                  publisher: null,
                  product: {
                    publisher: { contains: f.publisher, mode: "insensitive" },
                  },
                },
              ],
            },
          ],
        }
      : {}),
  };
}
export function salesWhere(
  a: AuthContext,
  f: z.infer<typeof salesFilter>,
): Prisma.SaleWhereInput {
  if (a.branchId && f.branchId && a.branchId !== f.branchId)
    return {
      companyId: a.companyId,
      id: "00000000-0000-0000-0000-000000000000",
    };
  const item = itemWhere(f);
  return {
    companyId: a.companyId,
    ...(a.branchId || f.branchId ? { branchId: a.branchId ?? f.branchId } : {}),
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: new Date(f.from + "T00:00:00-03:00") } : {}),
            ...(f.to
              ? {
                  lt: new Date(Date.parse(f.to + "T00:00:00-03:00") + 86400000),
                }
              : {}),
          },
        }
      : {}),
    ...(f.number ? { number: f.number } : {}),
    ...(f.cashSessionId ? { cashSessionId: f.cashSessionId } : {}),
    ...(f.cashRegisterId
      ? { cashSession: { cashRegisterId: f.cashRegisterId } }
      : {}),
    ...(f.operatorId ? { sellerId: f.operatorId } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.customerQuery
      ? {
          customer: {
            OR: [
              { name: { contains: f.customerQuery, mode: "insensitive" } },
              { document: { contains: f.customerQuery } },
              { phone: { contains: f.customerQuery } },
              { email: { contains: f.customerQuery, mode: "insensitive" } },
            ],
          },
        }
      : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.method ? { payments: { some: { method: f.method } } } : {}),
    ...(f.operation ? { returns: { some: { kind: f.operation } } } : {}),
    ...(Object.keys(item).length ? { items: { some: item } } : {}),
  };
}
export type Column = { key: string; label: string; money?: boolean };
type Row = Record<string, string | number>;
export async function salesAnalysis(
  db: Database,
  a: AuthContext,
  f: z.infer<typeof salesFilter>,
) {
  const where = salesWhere(a, f);
  if ((await db.sale.count({ where })) > 5000)
    throw new HttpError(
      422,
      "A consulta ultrapassa 5.000 vendas. Refine os filtros para analisar/exportar.",
    );
  if ((await db.saleItem.count({ where: { sale: where } })) > 20000)
    throw new HttpError(
      422,
      "A consulta ultrapassa 20.000 itens. Refine os filtros.",
    );
  const matchingItems =
    f.view === "items"
      ? new Set(
          (
            await db.saleItem.findMany({
              where: { sale: where, ...itemWhere(f) },
              select: { id: true },
            })
          ).map((i) => i.id),
        )
      : null;
  const sales = await db.sale.findMany({
    where,
    include: {
      branch: true,
      customer: true,
      seller: { include: { user: true } },
      cashSession: { include: { cashRegister: true } },
      payments: true,
      returns: { include: { items: true } },
      items: {
        include: { returns: true, product: { select: { publisher: true } } },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  let columns: Column[] = [],
    rows: Row[] = [];
  const col = (key: string, label: string, money = false) => ({
    key,
    label,
    money,
  });
  const net = (s: (typeof sales)[number]) =>
    s.status === "COMPLETED"
      ? cents(String(s.total)) -
        s.returns.reduce((n, r) => n + cents(String(r.returnedAmount)), 0n)
      : 0n;
  const qty = (s: (typeof sales)[number]) =>
    s.status === "COMPLETED"
      ? s.items.reduce(
          (n, i) =>
            n +
            Number(i.quantity) -
            i.returns.reduce((m, r) => m + r.quantity, 0),
          0,
        )
      : 0;
  if (f.view === "sales") {
    columns = [
      col("number", "Venda/pedido"),
      col("date", "Data"),
      col("branch", "Filial"),
      col("cash", "Caixa"),
      col("operator", "Operador"),
      col("customer", "Cliente"),
      col("quantity", "Itens líquidos"),
      col("total", "Total original", true),
      col("net", "Total após devoluções", true),
      col("method", "Pagamento"),
      col("status", "Status"),
    ];
    rows = sales.map((s) => ({
      id: s.id,
      number: s.number,
      date: s.createdAt.toISOString(),
      branch: s.branch.name,
      cash: s.cashSession?.cashRegister.name ?? "Legado",
      operator: s.seller.user.name,
      customer: s.customer?.name ?? "Não identificado",
      quantity: qty(s),
      total: s.total.toFixed(2),
      net: reais(net(s)),
      method: s.payments.map((p) => p.method).join(" + "),
      status: s.status,
    }));
  } else if (f.view === "items") {
    columns = [
      col("book", "Livro"),
      col("isbn", "ISBN/EAN"),
      col("author", "Autor"),
      col("publisher", "Editora"),
      col("quantity", "Quantidade original"),
      col("returned", "Devolvida"),
      col("price", "Preço", true),
      col("discount", "Desconto do item", true),
      col("paid", "Valor pago com rateio", true),
      col("net", "Saldo líquido", true),
      col("branch", "Filial"),
      col("date", "Data"),
      col("number", "Venda"),
    ];
    for (const s of sales) {
      const values = originalItemValues(s);
      for (const i of s.items) {
        if (!matchingItems?.has(i.id)) continue;
        const returned = i.returns.reduce((n, r) => n + r.quantity, 0),
          paid = values.get(i.id)!;
        rows.push({
          id: s.id,
          book: i.description,
          isbn: i.isbn ?? "",
          author: i.author ?? "",
          publisher: i.publisher ?? i.product.publisher ?? "",
          quantity: Number(i.quantity),
          returned,
          price: i.unitPrice.toFixed(2),
          discount: i.discount.toFixed(2),
          paid: reais(paid),
          net:
            s.status === "COMPLETED"
              ? reais(
                  paid -
                    i.returns.reduce((n, r) => n + cents(String(r.amount)), 0n),
                )
              : "0.00",
          branch: s.branch.name,
          date: s.createdAt.toISOString(),
          number: s.number,
        });
      }
    }
  } else if (f.view === "cash") {
    columns = [
      col("cash", "Caixa"),
      col("operator", "Operador"),
      col("opened", "Abertura"),
      col("closed", "Fechamento"),
      col("sold", "Vendido líquido", true),
      col("vouchers", "Vales emitidos", true),
      col("cashMoney", "Dinheiro", true),
      col("pix", "PIX", true),
      col("debit", "Débito", true),
      col("credit", "Crédito", true),
      col("supply", "Suprimento", true),
      col("withdrawal", "Sangria", true),
      col("difference", "Diferença", true),
    ];
    const sessions = await db.cashSession.findMany({
      where: {
        companyId: a.companyId,
        ...(a.branchId || f.branchId
          ? { branchId: a.branchId ?? f.branchId }
          : {}),
        ...(f.cashRegisterId ? { cashRegisterId: f.cashRegisterId } : {}),
        ...(f.cashSessionId ? { id: f.cashSessionId } : {}),
        ...(a.branchId && f.branchId && a.branchId !== f.branchId
          ? { id: "00000000-0000-0000-0000-000000000000" }
          : {}),
        ...(f.operatorId ? { openedById: f.operatorId } : {}),
        ...(f.from || f.to
          ? {
              openedAt: {
                ...(f.from
                  ? { gte: new Date(f.from + "T00:00:00-03:00") }
                  : {}),
                ...(f.to
                  ? {
                      lt: new Date(
                        Date.parse(f.to + "T00:00:00-03:00") + 86400000,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        ...(f.book ||
        f.isbn ||
        f.customerId ||
        f.customerQuery ||
        f.number ||
        f.method ||
        f.operation ||
        f.author ||
        f.publisher ||
        f.status
          ? { sales: { some: where } }
          : {}),
      },
      include: {
        cashRegister: true,
        openedBy: { include: { user: true } },
        movements: true,
        returns: { include: { credit: true } },
      },
      orderBy: { openedAt: "desc" },
      take: 5001,
    });
    if (sessions.length > 5000)
      throw new HttpError(422, "Refine os filtros de caixa.");
    for (const s of sessions) {
      const sum = (predicate: (m: (typeof s.movements)[number]) => boolean) =>
        reais(
          s.movements
            .filter(predicate)
            .reduce((n, m) => n + BigInt(m.amount.mul(100).toFixed(0)), 0n),
        );
      rows.push({
        id: s.id,
        cash: s.cashRegister.name,
        operator: s.openedBy.user.name,
        opened: s.openedAt.toISOString(),
        closed: s.closedAt?.toISOString() ?? "Aberto",
        sold: reais(
          s.movements
            .filter((m) => ["RECEIPT", "REVERSAL"].includes(m.kind))
            .reduce((n, m) => n + BigInt(m.amount.mul(100).toFixed(0)), 0n) -
            s.returns.reduce(
              (n, r) => n + cents(String(r.credit?.amount ?? 0)),
              0n,
            ),
        ),
        vouchers: reais(
          s.returns.reduce(
            (n, r) => n + cents(String(r.credit?.amount ?? 0)),
            0n,
          ),
        ),
        cashMoney: sum(
          (m) =>
            m.method === "CASH" && ["RECEIPT", "REVERSAL"].includes(m.kind),
        ),
        pix: sum((m) => m.method === "PIX"),
        debit: sum((m) => m.method === "DEBIT_CARD"),
        credit: sum((m) => m.method === "CREDIT_CARD"),
        supply: sum((m) => m.kind === "SUPPLY"),
        withdrawal: sum((m) => m.kind === "WITHDRAWAL"),
        difference: s.difference?.toFixed(2) ?? "",
      });
    }
  } else {
    columns = [
      col(
        "group",
        f.view === "operators"
          ? "Operador"
          : f.view === "payments"
            ? "Forma de pagamento"
            : f.view === "hours"
              ? "Hora"
              : "Período do dia",
      ),
      col("count", "Vendas"),
      col("quantity", "Itens líquidos"),
      col(
        "total",
        f.view === "payments" ? "Pagamentos não estornados" : "Venda líquida",
        true,
      ),
      col("average", "Ticket médio", true),
    ];
    const groups = new Map<
      string,
      { ids: Set<string>; quantity: number; total: bigint }
    >();
    for (const s of sales.filter((s) => s.status === "COMPLETED")) {
      const hour = commercialHour(s.createdAt);
      const records =
        f.view === "payments"
          ? s.payments
              .filter(
                (p) => !p.reversedAt && (!f.method || p.method === f.method),
              )
              .map((p) => ({ key: p.method, value: cents(String(p.amount)) }))
          : [
              {
                key:
                  f.view === "operators"
                    ? s.seller.user.name + " · " + s.sellerId.slice(0, 8)
                    : f.view === "hours"
                      ? String(hour).padStart(2, "0") + "h"
                      : commercialPeriods.find(
                          (p) => hour >= p.start && hour < p.end,
                        )!.name,
                value: net(s),
              },
            ];
      for (const rec of records) {
        const g = groups.get(rec.key) ?? {
          ids: new Set<string>(),
          quantity: 0,
          total: 0n,
        };
        if (!g.ids.has(s.id)) g.quantity += qty(s);
        g.ids.add(s.id);
        g.total += rec.value;
        groups.set(rec.key, g);
      }
    }
    rows = [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, g]) => ({
        group,
        count: g.ids.size,
        quantity: g.quantity,
        total: reais(g.total),
        average: reais(
          g.ids.size
            ? (g.total + BigInt(g.ids.size) / 2n) / BigInt(g.ids.size)
            : 0n,
        ),
      }));
  }
  if (f.csv)
    return (
      "\uFEFF" +
      [
        columns.map((c) => csvCell(c.label)).join(";"),
        ...rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(";")),
      ].join("\r\n")
    );
  return {
    columns,
    items: rows.slice((f.page - 1) * 25, f.page * 25),
    total: rows.length,
    page: f.page,
    limit: 25,
  };
}
