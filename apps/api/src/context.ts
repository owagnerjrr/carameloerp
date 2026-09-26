import type { FastifyRequest } from "fastify";
import type { Database } from "@caramelo/database";
export interface AuthContext {
  branchId?: string | null;
  companyId: string;
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  companyName: string;
  role: string;
  permissions: string[];
}
declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function requirePermission(
  request: FastifyRequest,
  permission: string,
): AuthContext {
  if (!request.auth)
    throw new HttpError(401, "Entre na sua conta para continuar.");
  if (!request.auth.permissions.includes(permission))
    throw new HttpError(403, "Seu perfil não permite esta ação.");
  return request.auth;
}
export type Transaction = Parameters<
  Parameters<Database["$transaction"]>[0]
>[0];
export async function audit(
  tx: Transaction,
  auth: AuthContext,
  action: string,
  module: string,
  recordId: string,
) {
  await tx.auditLog.create({
    data: {
      companyId: auth.companyId,
      actorId: auth.membershipId,
      action,
      module,
      recordId,
    },
  });
}
