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
        _sum: { amount: true },
      }),
      db.financialEntry.aggregate({
        where: {
          companyId,
          type: "PAYABLE",
          status: "OPEN",
          dueDate: { gte: new Date(from), lte: new Date(to) },
        },
        _sum: { amount: true },
      }),
      db.cashMovement.aggregate({
        where: { companyId, createdAt: { lt: end } },
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
      >`SELECT p.id,p.description,SUM(i.quantity) AS quantity,SUM(i.quantity*i."unitPrice"-i.discount) AS total FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" AND s."companyId"=i."companyId" JOIN "Product" p ON p.id=i."productId" AND p."companyId"=i."companyId" WHERE s."companyId"=${companyId}::uuid AND s.status='COMPLETED' AND s."createdAt">=${start} AND s."createdAt"<${end} GROUP BY p.id ORDER BY SUM(i.quantity) DESC LIMIT 5`,
      db.$queryRaw<
        Array<{ date: string; income: Prisma.Decimal; expense: Prisma.Decimal }>
      >`SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date, SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) AS income,SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) AS expense FROM "CashMovement" WHERE "companyId"=${companyId}::uuid AND "createdAt">=${start} AND "createdAt"<${end} GROUP BY 1 ORDER BY 1`,
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
      revenue: String(revenue._sum.total ?? 0),
      salesCount: revenue._count,
      daySales: String(daySales._sum.total ?? 0),
      dayCount: daySales._count,
      monthSales: String(monthSales._sum.total ?? 0),
      receivables: String(receivables._sum.amount ?? 0),
      payables: String(payables._sum.amount ?? 0),
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
