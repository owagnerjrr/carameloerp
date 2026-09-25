import "dotenv/config";
import { spawnSync } from "node:child_process";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error(
    "Use TEST_DATABASE_URL separado com nome terminado em _test.",
  );
const result = spawnSync(
  process.execPath,
  ["../../node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    cwd: "packages/database",
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  },
);
process.exitCode = result.status ?? 1;
