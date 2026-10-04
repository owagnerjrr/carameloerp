import { createDatabase } from "@caramelo/database";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startupDiagnostic } from "./startup-diagnostic.js";
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
let phase = "database";
try {
  await db.$connect();
  phase = "listen";
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  const message =
    "Não foi possível iniciar a API. Confira o banco e a configuração.";
  if (config.NODE_ENV === "development")
    app.log.error({ phase, startup: startupDiagnostic(error) }, message);
  else app.log.error(message);
  await shutdown();
  process.exitCode = 1;
}
