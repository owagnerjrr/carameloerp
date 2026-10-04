import { rolldown, watch } from "rolldown";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const seed = process.argv.includes("--seed");
const watching = process.argv.includes("--watch");
const output = resolve(
  root,
  seed ? ".local/seed.mjs" : "apps/api/dist/server.js",
);
const options = {
  input: resolve(
    root,
    seed ? "packages/database/prisma/seed.ts" : "apps/api/src/server.ts",
  ),
  external: (id) =>
    !id.startsWith(".") &&
    !id.startsWith("/") &&
    !/^[a-zA-Z]:/.test(id) &&
    !id.startsWith("@caramelo/"),
  resolve: {
    alias: {
      "@caramelo/database": resolve(root, "packages/database/src/index.ts"),
      "@caramelo/contracts": resolve(root, "packages/contracts/src/index.ts"),
    },
  },
  output: { file: output, format: "esm", sourcemap: true },
};
if (watching) {
  let child;
  let stopping = false;
  const watcher = watch(options);
  watcher.on("event", async (event) => {
    if (event.code === "BUNDLE_END") {
      if (child && child.exitCode === null && child.signalCode === null) {
        const previous = child;
        child = undefined;
        await new Promise((done) => {
          previous.once("exit", done);
          previous.kill();
        });
      }
      const current = spawn(
        process.execPath,
        ["--enable-source-maps", output],
        {
          cwd: root,
          stdio: "inherit",
          windowsHide: true,
        },
      );
      child = current;
      current.once("exit", (code) => {
        if (!stopping && child === current) {
          process.exitCode = code ?? 1;
          void watcher.close();
        }
      });
      current.once("error", (error) => {
        console.error(
          "Não foi possível iniciar o processo da API.",
          error.code,
        );
        process.exitCode = 1;
        void watcher.close();
      });
      await event.result.close();
    } else if (event.code === "ERROR") console.error(event.error);
  });
  const stop = async () => {
    stopping = true;
    child?.kill();
    await watcher.close();
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
} else {
  const bundle = await rolldown(options);
  await bundle.write(options.output);
  await bundle.close();
  console.log(seed ? "Seed compilado." : "API compilada.");
  if (seed) {
    const child = spawn(process.execPath, [output], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  }
}
