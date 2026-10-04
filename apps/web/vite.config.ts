import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, resolve(import.meta.dirname, "../.."), [
    "WEB_ORIGIN",
    "HOST",
    "PORT",
  ]);
  const origin = new URL(environment.WEB_ORIGIN || "http://localhost:5173");
  const host = ["0.0.0.0", "::"].includes(environment.HOST || "")
    ? "127.0.0.1"
    : environment.HOST || "127.0.0.1";
  const apiHost = host.includes(":") ? `[${host}]` : host;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: origin.hostname,
      port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80)),
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://${apiHost}:${environment.PORT || "3333"}`,
          changeOrigin: false,
        },
      },
    },
  };
});
