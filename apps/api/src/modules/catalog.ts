import { identifier, documentSearch } from "@caramelo/contracts";
import { saveIdentifiers } from "../services/books.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { customerSchema, productSchema, listSchema } from "@caramelo/contracts";
import type { Database } from "@caramelo/database";
import { requirePermission, HttpError, audit } from "../context.js";
const idFrom = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export async function catalogRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/customers", async (request) => {
    const { companyId } = requirePermission(request, "customers:read");
    const { q, page, limit } = listSchema.parse(request.query);
    const where = {
      companyId,
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        {
          document: {
            contains: documentSearch(q),
            mode: "insensitive" as const,
          },
        },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" as const } },
      ],
    };
    const [items, total] = await db.$transaction([
      db.customer.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.customer.count({ where }),
    ]);
    return { items, total, page, limit };
  });
  app.post("/api/customers", async (request, reply) => {
    const auth = requirePermission(request, "customers:write");
    const data = customerSchema.parse(request.body);
    const result = await db.$transaction(async (tx) => {
      const row = await tx.customer.create({
        data: { ...data, companyId: auth.companyId },
      });
      await audit(tx, auth, "CREATE", "customers", row.id);
      return row;
    });
    return reply.code(201).send(result);
  });
  app.put("/api/customers/:id", async (request) => {
    const auth = requirePermission(request, "customers:write");
    const id = idFrom(request.params);
    const data = customerSchema.parse(request.body);
    return db.$transaction(async (tx) => {
      if (
        !(await tx.customer.findUnique({
          where: { companyId_id: { companyId: auth.companyId, id } },
        }))
      )
        throw new HttpError(404, "Cliente não encontrado.");
      const row = await tx.customer.update({
        where: { companyId_id: { companyId: auth.companyId, id } },
        data,
      });
      await audit(tx, auth, "UPDATE", "customers", id);
      return row;
    });
  });
  app.get("/api/products/lookup", async (request) => {
    const auth = requirePermission(request, "products:read");
    const { code } = z
      .object({ code: z.string().trim().min(1).max(80) })
      .parse(request.query);
    const found = await db.productIdentifier.findUnique({
      where: {
        companyId_value: { companyId: auth.companyId, value: identifier(code) },
      },
      include: { product: true },
    });
    if (!found || !found.product.active)
      throw new HttpError(404, "Livro não encontrado.");
    return found.product;
  });
  app.get("/api/products", async (request) => {
    const { companyId, branchId } = requirePermission(request, "products:read");
    const { q, page, limit } = listSchema.parse(request.query);
    const where = {
      companyId,
      OR: [
        { description: { contains: q, mode: "insensitive" as const } },
        { code: { contains: q, mode: "insensitive" as const } },
        { barcode: { contains: q } },
        { isbn13: { contains: q } },
        { isbn10: { contains: q } },
        { author: { contains: q, mode: "insensitive" as const } },
        { publisher: { contains: q, mode: "insensitive" as const } },
        { identifiers: { some: { value: identifier(q) } } },
      ],
    };
    const [items, total] = await db.$transaction([
      db.product.findMany({
        where,
        include: {
          category: true,
          supplier: true,
          balances: { where: branchId ? { warehouse: { branchId } } : {} },
        },
        orderBy: { description: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.product.count({ where }),
    ]);
    return {
      items: items.map((p) => ({
        ...p,
        stock: p.balances.reduce((n, b) => n + Number(b.quantity), 0),
        margin:
          Number(p.price) > 0
            ? ((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100
            : 0,
      })),
      total,
      page,
      limit,
    };
  });
  app.get("/api/products/options", async (request) => {
    const { companyId } = requirePermission(request, "products:read");
    return {
      categories: await db.category.findMany({
        where: { companyId },
        orderBy: { name: "asc" },
      }),
      suppliers: await db.supplier.findMany({
        where: { companyId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    };
  });
  async function references(
    companyId: string,
    data: z.output<typeof productSchema>,
  ) {
    if (
      data.categoryId &&
      !(await db.category.findUnique({
        where: { companyId_id: { companyId, id: data.categoryId } },
      }))
    )
      throw new HttpError(400, "Categoria inválida.");
    if (
      data.supplierId &&
      !(await db.supplier.findUnique({
        where: { companyId_id: { companyId, id: data.supplierId } },
      }))
    )
      throw new HttpError(400, "Fornecedor inválido.");
  }
  app.post("/api/products", async (request, reply) => {
    const auth = requirePermission(request, "products:write");
    const data = productSchema.parse(request.body);
    await references(auth.companyId, data);
    const result = await db.$transaction(async (tx) => {
      const row = await tx.product.create({
        data: { ...data, companyId: auth.companyId },
      });
      await saveIdentifiers(tx, auth.companyId, row);
      await audit(tx, auth, "CREATE", "products", row.id);
      return row;
    });
    return reply.code(201).send(result);
  });
  app.put("/api/products/:id", async (request) => {
    const auth = requirePermission(request, "products:write");
    const id = idFrom(request.params);
    const data = productSchema.parse(request.body);
    await references(auth.companyId, data);
    return db.$transaction(async (tx) => {
      if (
        !(await tx.product.findUnique({
          where: { companyId_id: { companyId: auth.companyId, id } },
        }))
      )
        throw new HttpError(404, "Produto não encontrado.");
      const row = await tx.product.update({
        where: { companyId_id: { companyId: auth.companyId, id } },
        data,
      });
      await saveIdentifiers(tx, auth.companyId, row);
      await audit(tx, auth, "UPDATE", "products", id);
      return row;
    });
  });
}
