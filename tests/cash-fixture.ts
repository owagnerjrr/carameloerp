import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
export async function openTestCash(
  app: FastifyInstance,
  cookie: string,
  branchId: string,
  origin = "http://localhost:5173",
  openingAmount = "0",
) {
  const post = (url: string, payload: object) =>
    app.inject({ method: "POST", url, headers: { cookie, origin }, payload });
  const r = await post("/api/cash/registers", {
    branchId,
    name: "Terminal " + randomUUID().slice(0, 8),
  });
  if (r.statusCode !== 201) throw Error(r.body);
  const s = await post("/api/cash/sessions", {
    requestKey: randomUUID(),
    cashRegisterId: r.json().id,
    openingAmount,
  });
  if (s.statusCode !== 201) throw Error(s.body);
  return s.json() as { id: string; cashRegisterId: string };
}
