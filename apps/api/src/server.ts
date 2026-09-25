import { createDatabase } from "@caramelo/database";
import { buildApp } from "./app.js";
import { config } from "./config.js";
const db = createDatabase(config.DATABASE_URL);
const app = await buildApp({
  db,
  origin: config.WEB_ORIGIN,
  production: config.NODE_ENV === "production",
  sessionHours: config.SESSION_HOURS,
  logger: true,
});
const shutdown = async () => {
  await app.close();
  await db.$disconnect();
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
try {
  await db.$connect();
  await app.listen({ port: config.PORT, host: config.HOST });
} catch {
  app.log.error(
    "Não foi possível iniciar a API. Confira o banco e a configuração.",
  );
  await shutdown();
  process.exitCode = 1;
}
