import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { Prisma, type Database } from "@caramelo/database";
import { tokenHash } from "./security.js";
import { HttpError } from "./context.js";
import { authRoutes } from "./modules/auth.js";
import { catalogRoutes } from "./modules/catalog.js";
import { userRoutes } from "./modules/users.js";
import { dashboardRoutes } from "./modules/dashboard.js";
import { stockRoutes } from "./modules/stock.js";
export interface AppOptions {
  db: Database;
  origin: string;
  production?: boolean;
  sessionHours?: number;
  logger?: boolean;
  rateLimitMax?: number;
}
export async function buildApp(options: AppOptions) {
  const app = Fastify({
    bodyLimit: 65536,
    logger: options.logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
          serializers: {
            req: (r) => ({ method: r.method, url: r.url?.split("?")[0] }),
          },
        }
      : false,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 120,
    timeWindow: "1 minute",
  });
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== options.origin
    )
      throw new HttpError(403, "Origem da requisição não permitida.");
    const token = request.cookies.caramelo_session;
    if (!token) return;
    const session = await options.db.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: {
        membership: {
          include: {
            user: true,
            company: true,
            role: { include: { permissions: true } },
          },
        },
      },
    });
    if (!session || session.expiresAt <= new Date()) return;
    const m = session.membership;
    if (!m.active || !m.user.active || !m.company.active) return;
    request.auth = {
      branchId: m.role.name === "Administrador" ? null : m.branchId,
      companyId: m.companyId,
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      companyName: m.company.name,
      role: m.role.name,
      permissions: m.role.permissions
        .map((p) => p.permissionCode)
        .filter(
          (p) =>
            m.role.name === "Administrador" ||
            !m.branchId ||
            !["dashboard:read", "users:manage"].includes(p),
        ),
    };
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: "Confira os campos informados.",
        issues: error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002")
        return reply
          .code(409)
          .send({ message: "Já existe um cadastro com este identificador." });
      if (["P2003", "P2025"].includes(error.code))
        return reply
          .code(400)
          .send({ message: "Referência inválida ou registro indisponível." });
    }
    const status =
      error instanceof HttpError
        ? error.statusCode
        : typeof error === "object" && error !== null && "statusCode" in error
          ? Number(error.statusCode)
          : 500;
    if (status >= 500)
      request.log.error(
        { event: "request_failed", requestId: request.id },
        "Erro interno",
      );
    return reply.code(status >= 400 && status < 600 ? status : 500).send({
      message:
        status >= 500
          ? "Não foi possível concluir a operação."
          : error instanceof Error
            ? error.message
            : "Requisição inválida.",
    });
  });
  app.get("/api/health", async () => {
    await options.db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });
  await authRoutes(app, options);
  await catalogRoutes(app, options.db);
  await userRoutes(app, options.db);
  await dashboardRoutes(app, options.db);
  await stockRoutes(app, options.db);
  return app;
}
