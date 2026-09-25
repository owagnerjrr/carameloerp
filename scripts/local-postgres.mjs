import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
if (process.env.NODE_ENV === "production")
  throw new Error("PostgreSQL portátil é exclusivo de desenvolvimento.");
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Use um endereço local.");
const databaseDir = ".local/postgres";
// On Windows invoke the binaries directly: restricted desktop sessions may not
// expose os.userInfo(), which the cross-platform wrapper calls unconditionally.
const run = promisify(execFile);
const bin = resolve("node_modules/@embedded-postgres/windows-x64/native/bin");
let processHandle;
const postgres =
  process.platform === "win32"
    ? {
        async initialise() {
          mkdirSync(databaseDir, { recursive: true });
          const passwordFile = resolve(".local/pg-password.tmp");
          writeFileSync(passwordFile, decodeURIComponent(url.password), {
            mode: 0o600,
          });
          try {
            await run(
              resolve(bin, "initdb.exe"),
              [
                "-D",
                resolve(databaseDir),
                "-U",
                decodeURIComponent(url.username),
                "--pwfile",
                passwordFile,
                "--auth=scram-sha-256",
                "--encoding=UTF8",
                "--locale=C",
              ],
              { windowsHide: true },
            );
          } finally {
            unlinkSync(passwordFile);
          }
        },
        async start() {
          processHandle = spawn(
            resolve(bin, "postgres.exe"),
            [
              "-D",
              resolve(databaseDir),
              "-h",
              "127.0.0.1",
              "-p",
              String(Number(url.port) || 5432),
            ],
            { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
          );
          let failure;
          processHandle.on("error", (e) => {
            failure = e;
          });
          processHandle.stderr.on("data", (chunk) => {
            if (/FATAL|PANIC/.test(String(chunk))) console.error(String(chunk));
          });
          for (let attempt = 0; attempt < 60; attempt++) {
            if (failure) throw failure;
            if (processHandle.exitCode !== null)
              throw new Error("PostgreSQL encerrou antes de iniciar.");
            const probe = new pg.Client({
              connectionString: new URL("/postgres", url).toString(),
              connectionTimeoutMillis: 500,
            });
            try {
              await probe.connect();
              await probe.end();
              return;
            } catch {
              await probe.end().catch(() => {});
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          throw new Error("PostgreSQL não iniciou em 30 segundos.");
        },
        async stop() {
          await run(
            resolve(bin, "pg_ctl.exe"),
            ["-D", resolve(databaseDir), "-m", "fast", "-w", "stop"],
            { windowsHide: true },
          );
        },
      }
    : new EmbeddedPostgres({
        databaseDir,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        port: Number(url.port) || 5432,
        persistent: true,
        authMethod: "scram-sha-256",
        postgresFlags: ["-h", "127.0.0.1"],
        onLog: () => {},
        onError: (message) => console.error(message),
      });
if (!existsSync(`${databaseDir}/PG_VERSION`)) await postgres.initialise();
await postgres.start();
const client = new pg.Client({
  connectionString: new URL("/postgres", url).toString(),
});
await client.connect();
const names = [
  url.pathname.slice(1),
  new URL(process.env.TEST_DATABASE_URL).pathname.slice(1),
];
for (const name of names) {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error("Nome de banco inválido.");
  if (
    !(await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
      .rowCount
  )
    await client.query(`CREATE DATABASE "${name}"`);
}
await client.end();
console.log(
  `PostgreSQL local pronto na porta ${url.port || 5432}. Ctrl+C encerra o processo; os dados são preservados.`,
);
const stop = async () => {
  await postgres.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
setInterval(() => {}, 60000);
