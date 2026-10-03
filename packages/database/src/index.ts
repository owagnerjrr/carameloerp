import { PrismaClient } from "./generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
export function createDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
export type Database = ReturnType<typeof createDatabase>;
export { Prisma } from "./generated/client.js";
export type { CashSession, Sale, FinancialEntry } from "./generated/client.js";
