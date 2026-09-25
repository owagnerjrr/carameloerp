import type { FastifyInstance } from "fastify";
import { loginSchema } from "@caramelo/contracts";
import {
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
} from "../security.js";
import { HttpError } from "../context.js";
import type { AppOptions } from "../app.js";
export async function authRoutes(app: FastifyInstance, options: AppOptions) {
  const dummyHash = await hashPassword(newToken());
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const membership = await options.db.membership.findFirst({
        where: {
          company: { slug: input.company, active: true },
          user: { email: input.email, active: true },
          active: true,
        },
        include: { user: true },
      });
      const valid = await verifyPassword(
        input.password,
        membership?.user.passwordHash ?? dummyHash,
      );
      if (!membership || !valid)
        throw new HttpError(401, "Empresa, e-mail ou senha inválidos.");
      const token = newToken();
      const expiresAt = new Date(
        Date.now() + (options.sessionHours ?? 8) * 3600000,
      );
      await options.db.$transaction(async (tx) => {
        if (request.cookies.caramelo_session)
          await tx.session.deleteMany({
            where: { tokenHash: tokenHash(request.cookies.caramelo_session) },
          });
        await tx.session.deleteMany({
          where: { membershipId: membership.id, expiresAt: { lt: new Date() } },
        });
        await tx.session.create({
          data: {
            membershipId: membership.id,
            tokenHash: tokenHash(token),
            expiresAt,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: membership.companyId,
            actorId: membership.id,
            action: "LOGIN",
            module: "auth",
            recordId: membership.id,
          },
        });
      });
      reply.setCookie("caramelo_session", token, {
        httpOnly: true,
        secure: options.production ?? false,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      });
      return { message: "Sessão iniciada." };
    },
  );
  app.get("/api/auth/me", async (request) => {
    if (!request.auth)
      throw new HttpError(401, "Entre na sua conta para continuar.");
    return request.auth;
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies.caramelo_session;
    if (token)
      await options.db.session.deleteMany({
        where: { tokenHash: tokenHash(token) },
      });
    reply.clearCookie("caramelo_session", {
      path: "/",
      secure: options.production ?? false,
      sameSite: "lax",
      httpOnly: true,
    });
    return { message: "Sessão encerrada." };
  });
}
