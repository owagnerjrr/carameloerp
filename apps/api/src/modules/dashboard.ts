import type { FastifyInstance } from "fastify";
import { Prisma, type Database } from "@caramelo/database";
import { periodSchema } from "@caramelo/contracts";
import { requirePermission } from "../context.js";
export async function dashboardRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/dashboard", async (request) => {
    const { companyId } = requirePermission(request, "dashboard:read");
    const { from, to } = periodSchema.parse(request.query);
    // Commercial dates in America/Sao_Paulo (UTC-03); end is exclusive.
    const start = new Date(`${from}T00:00:00-03:00`);
    const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86400000);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const todayStart = new Date(`${today}T00:00:00-03:00`);
    const tomorrow = new Date(todayStart.getTime() + 86400000);
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00-03:00`);
    const where = {
      companyId,
      status: "COMPLETED" as const,
      createdAt: { gte: start, lt: end },
    };
    const [
      commercialCount,
      dayCommercialCount,
      returnsPeriod,
      returnsDay,
      returnsMonth,
      revenue,
      daySales,
      monthSales,
      receivables,
      payables,
      cash,
      recentSales,
      recentCustomers,
      lowStock,
      topProducts,
      series,
      customerCount,
      productCount,
    ] = await Promise.all([
      db.sale.count({ where: { ...where, exchangeOrigin: null } }),
      db.sale.count({
        where: {
          companyId,
          status: "COMPLETED",
          exchangeOrigin: null,
          createdAt: { gte: todayStart, lt: tomorrow },
        },
      }),
      db.returnOperation.aggregate({
        where: { companyId, createdAt: { gte: start, lt: end } },
        _sum: { returnedAmount: true },
      }),
      db.returnOperation.aggregate({
        where: { companyId, createdAt: { gte: todayStart, lt: tomorrow } },
        _sum: { returnedAmount: true },
      }),
      db.returnOperation.aggregate({
        where: { companyId, createdAt: { gte: monthStart, lt: tomorrow } },
        _sum: { returnedAmount: true },
      }),
      db.sale.aggregate({ where, _sum: { total: true }, _count: true }),
      db.sale.aggregate({
        where: {
          companyId,
          status: "COMPLETED",
          createdAt: { gte: todayStart, lt: tomorrow },
        },
        _sum: { total: true },
        _count: true,
      }),
      db.sale.aggregate({
        where: {
          companyId,
          status: "COMPLETED",
          createdAt: { gte: monthStart, lt: tomorrow },
        },
        _sum: { total: true },
      }),
      db.financialEntry.aggregate({
        where: {
          companyId,
          type: "RECEIVABLE",
          status: "OPEN",
          dueDate: { gte: new Date(from), lte: new Date(to) },
        },
        _sum: { amount: true, settledAmount: true },
      }),
      db.financialEntry.aggregate({
        where: {
          companyId,
          type: "PAYABLE",
          status: "OPEN",
          dueDate: { gte: new Date(from), lte: new Date(to) },
        },
        _sum: { amount: true, settledAmount: true },
      }),
      db.cashMovement.aggregate({
        where: {
          companyId,
          createdAt: { lt: end },
          OR: [{ method: null }, { method: { in: ["CASH", "PIX"] } }],
        },
        _sum: { amount: true },
      }),
      db.sale.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      db.customer.findMany({
        where: { companyId, createdAt: { gte: start, lt: end } },
        select: { id: true, name: true, city: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      db.$queryRaw<
        Array<{
          id: string;
          description: string;
          code: string;
          quantity: Prisma.Decimal;
          minStock: Prisma.Decimal;
        }>
      >`SELECT p.id,p.description,p.code,p."minStock",COALESCE(SUM(b.quantity),0) AS quantity FROM "Product" p LEFT JOIN "StockBalance" b ON b."companyId"=p."companyId" AND b."productId"=p.id WHERE p."companyId"=${companyId}::uuid AND p.active=true GROUP BY p.id HAVING COALESCE(SUM(b.quantity),0)<=p."minStock" ORDER BY COALESCE(SUM(b.quantity),0) LIMIT 5`,
      db.$queryRaw<
        Array<{
          id: string;
          description: string;
          quantity: Prisma.Decimal;
          total: Prisma.Decimal;
        }>
      >`WITH lines AS (
 SELECT i.*, (i.quantity*i."unitPrice"-i.discount)*100 AS line_cents,s.discount*100 AS header_cents,s."createdAt" AS sold_at,
 SUM((i.quantity*i."unitPrice"-i.discount)*100) OVER(PARTITION BY i."saleId") AS base_cents,
 SUM((i.quantity*i."unitPrice"-i.discount)*100) OVER(PARTITION BY i."saleId" ORDER BY i.id ROWS UNBOUNDED PRECEDING) AS cumulative
 FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" AND s."companyId"=i."companyId" WHERE s."companyId"=${companyId}::uuid AND s.status='COMPLETED'
), events AS (
 SELECT "productId", quantity, (line_cents-COALESCE(FLOOR(header_cents*cumulative/NULLIF(base_cents,0))-FLOOR(header_cents*(cumulative-line_cents)/NULLIF(base_cents,0)),0))/100 AS amount FROM lines WHERE sold_at>=${start} AND sold_at<${end}
 UNION ALL
 SELECT i."productId", -r.quantity, -r.amount FROM "ReturnItem" r JOIN "ReturnOperation" op ON op.id=r."returnId" AND op."companyId"=r."companyId" JOIN "SaleItem" i ON i.id=r."saleItemId" AND i."companyId"=r."companyId" WHERE op."companyId"=${companyId}::uuid AND op."createdAt">=${start} AND op."createdAt"<${end}
) SELECT p.id,p.description,SUM(e.quantity) AS quantity,SUM(e.amount) AS total FROM events e JOIN "Product" p ON p.id=e."productId" GROUP BY p.id HAVING SUM(e.quantity)<>0 ORDER BY SUM(e.quantity) DESC,p.id LIMIT 5`,
      db.$queryRaw<
        Array<{ date: string; income: Prisma.Decimal; expense: Prisma.Decimal }>
      >`SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date, SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) AS income,SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) AS expense FROM "CashMovement" WHERE (method IS NULL OR method IN ('CASH','PIX')) AND "companyId"=${companyId}::uuid AND "createdAt">=${start} AND "createdAt"<${end} GROUP BY 1 ORDER BY 1`,
      db.customer.count({ where: { companyId, active: true } }),
      db.product.count({ where: { companyId, active: true } }),
    ]);
    const days = [];
    for (
      let date = new Date(`${from}T12:00:00Z`);
      date <= new Date(`${to}T12:00:00Z`);
      date = new Date(date.getTime() + 86400000)
    ) {
      const key = date.toISOString().slice(0, 10);
      const row = series.find((r) => r.date === key);
      days.push({
        date: key,
        income: String(row?.income ?? 0),
        expense: String(row?.expense ?? 0),
      });
    }
    return {
      period: { from, to },
      revenue: new Prisma.Decimal(revenue._sum.total ?? 0)
        .minus(returnsPeriod._sum.returnedAmount ?? 0)
        .toString(),
      grossRevenue: String(revenue._sum.total ?? 0),
      returnsAmount: String(returnsPeriod._sum.returnedAmount ?? 0),
      averageTicket: commercialCount
        ? new Prisma.Decimal(revenue._sum.total ?? 0)
            .minus(returnsPeriod._sum.returnedAmount ?? 0)
            .div(commercialCount)
            .toFixed(2)
        : null,
      salesCount: commercialCount,
      daySales: new Prisma.Decimal(daySales._sum.total ?? 0)
        .minus(returnsDay._sum.returnedAmount ?? 0)
        .toString(),
      dayCount: dayCommercialCount,
      monthSales: new Prisma.Decimal(monthSales._sum.total ?? 0)
        .minus(returnsMonth._sum.returnedAmount ?? 0)
        .toString(),
      receivables: new Prisma.Decimal(receivables._sum.amount ?? 0)
        .minus(receivables._sum.settledAmount ?? 0)
        .toString(),
      payables: new Prisma.Decimal(payables._sum.amount ?? 0)
        .minus(payables._sum.settledAmount ?? 0)
        .toString(),
      balance: String(cash._sum.amount ?? 0),
      customerCount,
      productCount,
      recentSales,
      recentCustomers,
      lowStock,
      topProducts,
      series: days,
    };
  });
}
