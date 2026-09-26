import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@caramelo/database";
import {
  createUserSchema,
  updateUserSchema,
  listSchema,
} from "@caramelo/contracts";
import { requirePermission, HttpError, audit } from "../context.js";
import { hashPassword } from "../security.js";
export async function userRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/branches", async (request) => {
    const auth = requirePermission(request, "users:manage");
    return db.branch.findMany({
      where: { companyId: auth.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  });
  app.get("/api/roles", async (request) => {
    const { companyId } = requirePermission(request, "users:manage");
    return db.role.findMany({
      where: { companyId },
      include: { permissions: true },
      orderBy: { name: "asc" },
    });
  });
  app.get("/api/users", async (request) => {
    const { companyId } = requirePermission(request, "users:manage");
    const { page, limit } = listSchema.parse(request.query);
    const [items, total] = await db.$transaction([
      db.membership.findMany({
        where: { companyId },
        select: {
          id: true,
          active: true,
          branchId: true,
          role: { select: { id: true, name: true } },
          user: { select: { name: true, email: true } },
        },
        orderBy: { user: { name: "asc" } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.membership.count({ where: { companyId } }),
    ]);
    return { items, total, page, limit };
  });
  app.post("/api/users", async (request, reply) => {
    const auth = requirePermission(request, "users:manage");
    const data = createUserSchema.parse(request.body);
    if (
      data.branchId &&
      !(await db.branch.findFirst({
        where: { id: data.branchId, companyId: auth.companyId },
      }))
    )
      throw new HttpError(400, "Filial inválida.");
    if (
      !(await db.role.findUnique({
        where: { companyId_id: { companyId: auth.companyId, id: data.roleId } },
      }))
    )
      throw new HttpError(400, "Perfil inválido.");
    if (await db.user.findUnique({ where: { email: data.email } }))
      throw new HttpError(
        409,
        "Não foi possível cadastrar este e-mail. Convites para identidades existentes serão disponibilizados em uma próxima fase.",
      );
    const passwordHash = await hashPassword(data.password);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: data.email, name: data.name, passwordHash },
      });
      const member = await tx.membership.create({
        data: {
          companyId: auth.companyId,
          userId: user.id,
          roleId: data.roleId,
          branchId: data.branchId,
        },
      });
      await audit(tx, auth, "CREATE", "users", member.id);
      return { id: member.id, name: user.name, email: user.email };
    });
    return reply.code(201).send(result);
  });
  app.patch("/api/users/:id", async (request) => {
    const auth = requirePermission(request, "users:manage");
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const data = updateUserSchema.parse(request.body);
    if (
      data.branchId &&
      !(await db.branch.findFirst({
        where: { id: data.branchId, companyId: auth.companyId },
      }))
    )
      throw new HttpError(400, "Filial inválida.");
    if (id === auth.membershipId)
      throw new HttpError(400, "Você não pode alterar seu próprio acesso.");
    return db.$transaction(async (tx) => {
      // Serialize membership administration for this tenant, including concurrent demotions.
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${auth.companyId}::uuid FOR UPDATE`;
      const member = await tx.membership.findUnique({
        where: { companyId_id: { companyId: auth.companyId, id } },
        include: { role: true },
      });
      const role = await tx.role.findUnique({
        where: { companyId_id: { companyId: auth.companyId, id: data.roleId } },
      });
      if (!member) throw new HttpError(404, "Usuário não encontrado.");
      if (!role) throw new HttpError(400, "Perfil inválido.");
      if (
        member.role.name === "Administrador" &&
        (!data.active || role.name !== "Administrador")
      ) {
        const admins = await tx.membership.count({
          where: {
            companyId: auth.companyId,
            active: true,
            role: { name: "Administrador" },
          },
        });
        if (admins <= 1)
          throw new HttpError(400, "Mantenha ao menos um administrador ativo.");
      }
      await tx.membership.update({
        where: { companyId_id: { companyId: auth.companyId, id } },
        data,
      });
      await tx.session.deleteMany({ where: { membershipId: id } });
      await audit(tx, auth, "ACCESS_UPDATE", "users", id);
      return {
        message: "Acesso atualizado. As sessões anteriores foram revogadas.",
      };
    });
  });
  app.get("/api/audit", async (request) => {
    const { companyId, branchId } = requirePermission(request, "audit:read");
    const where = {
      companyId,
      ...(branchId
        ? {
            OR: [
              { module: { not: "stock" } },
              { metadata: { path: ["branchId"], equals: branchId } },
            ],
          }
        : {}),
    };
    const { page, limit } = listSchema.parse(request.query);
    const [items, total] = await db.$transaction([
      db.auditLog.findMany({
        where,
        include: { actor: { select: { user: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.auditLog.count({ where }),
    ]);
    return { items, total, page, limit };
  });
}
