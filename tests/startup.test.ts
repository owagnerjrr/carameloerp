import { it, expect } from "vitest";
import { startupDiagnostic } from "../apps/api/src/startup-diagnostic.js";
it("diagnóstico preserva código, causa e linha úteis sem configuração do driver", () => {
  const cause = Object.assign(new Error("listen EADDRINUSE: 127.0.0.1:3333"), {
    code: "EADDRINUSE",
  });
  const e = Object.assign(new Error("Inicialização", { cause }), {
    driverConfig: { password: "nao-serializar" },
  });
  const d = startupDiagnostic(e, {});
  expect(d.cause?.code).toBe("EADDRINUSE");
  expect(d.cause?.stack).toContain("startup.test.ts");
  expect(JSON.stringify(d)).not.toContain("nao-serializar");
});
it("diagnóstico remove credenciais do ambiente, URLs e segredos percent-encoded", () => {
  const password = "senha-ficticia@com/espaco",
    url = `postgresql://fixture:${encodeURIComponent(password)}@127.0.0.1:5432/fixture`;
  const env = {
    DATABASE_URL: url,
    POSTGRES_PASSWORD: password,
    SEED_DEMO_PASSWORD: "senha-demo-ficticia",
    API_TOKEN: "token-ficticio",
  };
  const d = JSON.stringify(
    startupDiagnostic(
      new Error(
        `${url} ${password} ${encodeURIComponent(password)} senha-demo-ficticia token-ficticio`,
      ),
      env,
    ),
  );
  for (const secret of [
    url,
    password,
    encodeURIComponent(password),
    env.SEED_DEMO_PASSWORD,
    env.API_TOKEN,
  ])
    expect(d).not.toContain(secret);
  expect(d).toContain("REDACTED");
});
it("diagnóstico sanitiza causas agregadas e segredos desconhecidos", () => {
  const e = new AggregateError(
    [
      new Error("password=oculto https://fixture:senha@host.local/path"),
      new Error("Authorization: Bearer outrosegredo"),
    ],
    "Falha",
  );
  const d = JSON.stringify(startupDiagnostic(e, {}));
  expect(d).not.toContain("oculto");
  expect(d).not.toContain("outrosegredo");
  expect(d).not.toContain("fixture:senha");
});
it("diagnóstico limita recursão em causa circular", () => {
  const e = new Error("Falha circular");
  e.cause = e;
  expect(JSON.stringify(startupDiagnostic(e, {})).length).toBeLessThan(10000);
});
