import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env existente preservado.");
  process.exit(0);
}
const dbPassword = randomBytes(24).toString("hex");
const demoPassword = randomBytes(18).toString("base64url");
const template = readFileSync(".env.example", "utf8")
  .replaceAll("CHANGE_ME", dbPassword)
  .replace("REPLACE_WITH_AT_LEAST_12_CHARACTERS", demoPassword);
writeFileSync(".env", template, { mode: 0o600 });
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".local/demo-access.txt",
  `Empresa: caramelo-demo\nE-mail: admin@caramelo.example\nSenha: ${demoPassword}\n`,
  { mode: 0o600 },
);
console.log(
  ".env criado com segredos aleatórios. Acesso de demonstração salvo em .local/demo-access.txt (ignorado pelo Git).",
);
