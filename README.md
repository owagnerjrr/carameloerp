# Caramelo ERP

ERP web para pequenas e médias empresas brasileiras. Identidade visual própria, interface em português e base modular preparada para evoluir para SaaS. **Versão 0.1: primeira entrega funcional; não é um ERP completo nem um serviço pronto para comercialização.**

## O que já funciona

- Login por empresa/e-mail/senha; sessão revogável em cookie HttpOnly; logout.
- Empresas, filiais, usuários globais e associações por empresa com seis perfis RBAC.
- Administração de usuários: criar, alterar perfil, ativar/inativar e revogar sessões. Não permite alterar o próprio acesso.
- Layout responsivo, menu recolhível, menu móvel e identidade Caramelo.
- Dashboard conectado ao PostgreSQL: faturamento, vendas, contas abertas, caixa, gráfico de entradas/saídas, estoque baixo, ranking, novos clientes e vendas recentes.
- Filtros hoje, 7 dias, 30 dias, mês e período personalizado de até 366 dias.
- Clientes e produtos: criação, edição, inativação, busca e paginação, com validação no backend.
- Auditoria de login, cadastros e mudanças de acesso, sem segredos ou conteúdo integral dos registros.
- Migrations, seed fictício, testes de API com PostgreSQL real, testes de navegador, lint, build e CI.

Os modelos de estoque, vendas, financeiro e fiscal existem para sustentar a evolução e os indicadores de demonstração. Não há endpoints para concluir vendas, movimentar estoque, baixar pagamentos ou emitir documentos. Menus dessas fases estão identificados como “Em breve”.

## Arquitetura e tecnologias

Monorepo npm com monólito modular no backend:

| Camada       | Tecnologias                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Interface    | React 19, TypeScript, Vite 8, Tailwind CSS 4, Lucide, Recharts                                 |
| API          | Node.js 22.12+, TypeScript, Fastify 5, Zod 4                                                   |
| Persistência | PostgreSQL 17/18, Prisma 7, adapter pg                                                         |
| Segurança    | scrypt N=131072/r=8/p=1, cookie de sessão opaca, RBAC, validação de Origin, rate limit, Helmet |
| Qualidade    | ESLint, TypeScript strict, Prettier, Vitest, Playwright, GitHub Actions                        |

As versões exatas estão no `package-lock.json`. Os overrides de deepmerge-ts, mysql2 e esbuild mantêm versões corrigidas de dependências transitivas; são validados pelos testes/build. Veja as decisões em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), o modelo em [docs/DATABASE.md](docs/DATABASE.md) e os próximos passos em [docs/ROADMAP.md](docs/ROADMAP.md).

## Requisitos

- Git, Node.js 22.12 ou superior e npm 10+ (validado localmente com Node 24).
- PostgreSQL 17+ acessível, ou Docker com Compose.
- Alternativa local: `npm run db:local` baixa/usa os binários do pacote de desenvolvimento embedded-postgres. Não é a estratégia de banco em produção.

## Instalação

```bash
git clone https://github.com/owagnerjrr/carameloerp.git
cd carameloerp
npm ci
npm run setup:env
npm run db:generate
```

`setup:env` cria `.env` com senha de banco e senha de demonstração aleatórias. Um `.env` existente é preservado. Alternativamente, copie `.env.example` para `.env` e substitua os marcadores. Nunca versione `.env`, certificados, chaves privadas ou credenciais.

| Variável                                            | Uso                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                                      | Conexão PostgreSQL da aplicação                                    |
| `TEST_DATABASE_URL`                                 | Banco separado para testes, com nome terminado em `_test`          |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Inicialização do PostgreSQL via Compose; devem corresponder à URL  |
| `HOST`, `PORT`                                      | Endereço e porta da API, padrão 127.0.0.1:3333                     |
| `WEB_ORIGIN`                                        | Origem exata autorizada nas mutações, padrão http://localhost:5173 |
| `NODE_ENV`                                          | development, test ou production                                    |
| `SESSION_HOURS`                                     | Duração da sessão, padrão 8, máximo 24                             |
| `SEED_DEMO_PASSWORD`                                | Senha inicial de desenvolvimento; pelo menos 12 caracteres         |

Senhas com caracteres especiais em URLs precisam de percent-encoding. Não há segredos no frontend e não é necessário criar um `.env` em `apps/web`.

## PostgreSQL e migrations

Opção recomendada para desenvolvimento:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
```

Sem Docker, abra um terminal na raiz e mantenha-o executando:

```bash
npm run db:local
```

Em outro terminal:

```bash
npm run db:migrate
npm run db:seed
```

O PostgreSQL portátil só escuta em `127.0.0.1`, usa SCRAM e persiste em `.local/postgres`, ignorado pelo Git. Ele cria também o banco de testes. Não execute as duas opções na mesma porta. Para uma instância existente, crie os bancos manualmente e configure as URLs. Migrations versionadas são aplicadas com `prisma migrate deploy`; não use `db push` em produção.

Para gerar uma nova migration durante o desenvolvimento, use `npm exec -w @caramelo/database -- prisma migrate dev --name nome_claro`, com banco de desenvolvimento e permissões para um shadow database. Revise o SQL e teste antes de publicar.

## Demonstração

- Empresa: **Caramelo Comércio LTDA**.
- Identificador no login: **caramelo-demo**.
- E-mail: **admin@caramelo.example**.
- Senha: valor de `SEED_DEMO_PASSWORD` no `.env`; quando gerada por `setup:env`, também fica em `.local/demo-access.txt`.

Nenhuma senha fixa é publicada no repositório. O seed cria 6 clientes, 1 fornecedor, 6 produtos, 30 vendas, estoque, movimentações, contas e caixa fictícios. E-mails usam domínios reservados; CPF/CNPJ não são preenchidos com dados reais. Uma empresa de demonstração existente é preservada: executar seed novamente não apaga dados nem redefine senhas. O seed é bloqueado em `NODE_ENV=production`.

## Desenvolvimento

```bash
npm run dev
```

- Frontend: **http://localhost:5173**.
- Backend: **http://127.0.0.1:3333/api/health**.
- Vite encaminha `/api` para a API, mantendo mesma origem no navegador.

Use `localhost:5173` no navegador conforme `WEB_ORIGIN`. Se mudar hostname/porta, ajuste ambos. A API rejeita mutações sem o cabeçalho Origin correspondente; clientes HTTP externos também devem enviá-lo. Não há CORS aberto.

Separadamente: `npm run dev -w @caramelo/api` e `npm run dev -w @caramelo/web`. O watcher da API recompila TypeScript e reinicia o processo Node. Ctrl+C encerra os serviços; encerre o PostgreSQL portátil no terminal dele.

## Testes e validação

Os testes de integração **limpam o banco de testes**, nunca o banco de desenvolvimento. O nome precisa terminar em `_test`, e a URL não pode ser igual à URL principal. Crie o banco antes de executar se estiver usando Docker ou PostgreSQL externo:

```bash
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" caramelo_test'
npm run test:db
npm run lint
npm test
npm run build
npm run format:check
npm audit
```

`npm run check` reúne lint, testes e build; pressupõe banco de testes migrado. A suíte usa requisições Fastify contra PostgreSQL real e cobre sessões, RBAC, CSRF, rate limit, relações entre tenants, constraints SQL, cadastros e cálculos do dashboard.

Para testes de navegador, mantenha `npm run dev` e o banco com seed ativos:

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright verifica login, navegação, formulários, busca, dashboard e logout em desktop e celular. Screenshots ficam em `.local`, e traces de falhas em `test-results`, ambos ignorados. O arquivo `.env` local fornece a senha de demonstração ao teste sem gravá-la em código. O CI executa migrations, seed, lint, testes, build, formatação e navegador.

## Build e operação

```bash
npm run build
npm run start -w @caramelo/api
```

Frontend compilado em `apps/web/dist`; API em `apps/api/dist/server.js`. O start lê o `.env` da raiz e depende de PostgreSQL disponível. Em produção, forneça variáveis pelo ambiente, `NODE_ENV=production`, `WEB_ORIGIN=https://seu-dominio`, migrations aplicadas e use um reverse proxy HTTPS que sirva o frontend e encaminhe `/api` para a API na mesma origem. Se containers precisarem acessar a API, configure `HOST=0.0.0.0` e restrinja a rede.

Não use o seed ou o PostgreSQL portátil em produção. Ainda faltam provisionamento de empresas, recuperação de senha, MFA, rate limiter distribuído, observabilidade, backups testados, retenção e avaliação de segurança/LGPD antes de comercializar como SaaS. Não habilite `trustProxy` indiscriminadamente: configure proxies confiáveis antes de escalar ou ajustar o rate limit por IP.

## Estrutura

```text
apps/
  api/src/
    modules/            auth, users, catalog, dashboard
    integrations/       contratos sem provedores fictícios
    app.ts              composição HTTP e políticas de segurança
    context.ts          autorização e auditoria
    security.ts         hashes e tokens
  web/src/
    pages/              dashboard, cadastros, administração
    App.tsx             login e shell responsivo
    api.ts              cliente HTTP
    components.tsx      elementos compartilhados
packages/
  contracts/src/        schemas Zod e matriz de permissões
  database/
    prisma/             schema, migrations e seed
    src/                criação do cliente Prisma
scripts/                configuração local, build Node, banco e testes
tests/                  unitários, integração e navegador
docs/                   arquitetura, banco, API e roadmap
.github/workflows/      CI
```

## Segurança e limites da primeira fase

Tenant é obtido da sessão, nunca do corpo da requisição. Consultas filtram `companyId`; chaves compostas protegem relações. Não há RLS nesta versão. Perfil é carregado a cada requisição; alteração de acesso revoga sessões. Senhas usam salt aleatório; tokens de sessão são aleatórios e apenas o hash é persistido. Cookies são Secure em produção. Logs HTTP não registram corpos, cookies, tokens nem query strings. Auditoria contém apenas IDs, ação, módulo, ator e data.

A política de perfis está definida no código e persistida por empresa. Há seleção de perfil por usuário; editor de permissões customizadas não está incluído. Administradores não podem anexar silenciosamente uma identidade de outra empresa: convites e aceite do usuário ficam para a evolução SaaS. Estoque é somente leitura nos cadastros; margem é `(preço - custo) / preço`, com zero quando o preço for zero.

As contas a pagar/receber compartilham o modelo `FinancialEntry`, diferenciadas por tipo; isso evita duplicação. Sua API operacional, parcelamento, recorrência e conciliação pertencem às fases futuras. Campos fiscais são apenas cadastro; não constituem cálculo tributário ou emissão homologada.
