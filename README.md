# Caramelo ERP

ERP web para uma **rede de livrarias brasileiras**. Interface em português e base modular preparada para evoluir para SaaS. Esta etapa entrega livros, entrada/estoque por filial e PDV operacional; não é um ERP completo nem um serviço pronto para comercialização.

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

Entradas, ajustes, vendas e cancelamentos são operacionais e persistem no PostgreSQL. O PDV registra pagamentos manuais e financeiro básico; não há emissão fiscal, integração bancária ou TEF.

## PDV e vendas

Abra **PDV / Vendas**, escolha filial/depósito, leia código+Enter ou pesquise o livro, informe cliente opcional, descontos e pagamentos. Confirme o resumo para gravar venda, itens, pagamentos, baixa de estoque, financeiro/caixa e auditoria em uma única transação. O carrinho não altera saldo. Dinheiro calcula troco; PIX/débito/crédito exigem confirmação manual externa; crédito admite parcelas e pagamentos mistos fecham exatamente o total.

Histórico permite filtros e detalhes. Cancelamento autorizado exige motivo, recompõe estoque, cancela recebíveis e compensa o caixa, mantendo a venda e sua auditoria. Migration aditiva: `202609260002_pdv_sales`. Guia completo, regras de desconto/parcelas, endpoints, limites e testes: [docs/PDV.md](docs/PDV.md). Decisão arquitetural: [docs/PDV-ARQUITETURA.md](docs/PDV-ARQUITETURA.md).

## Livros, leitura e entrada de mercadoria

Em **Livros**, cadastre título (campo comercial `description` preservado), subtítulo, ISBN-10/13, EAN/barcode, SKU, autor/coautores, editora/selo, edição/ano, idioma, categoria/gênero, páginas, formato/capa, peso/dimensões, URL HTTPS da imagem, sinopse, custo/preço, mínimo/estante, NCM e status. Não há upload nem consulta bibliográfica externa. O cadastro antigo permanece válido, sem conversão destrutiva.

ISBN valida dígitos verificadores e remove hífens/espaços. ISBN-10 é resolvido como seu equivalente ISBN-13; ambos devem identificar a mesma edição quando informados juntos. `ProductIdentifier` impede duplicar identificador normalizado dentro da empresa, inclusive colisão com SKU. Códigos `DEMO-*` são códigos internos de demonstração, não ISBN real. Busca manual aceita título, autor, ISBN e SKU; leitura usa resolução exata, não busca ambígua por trecho.

1. Abra **Estoque → Entrada de Livros** e escolha filial/depósito e fornecedor cadastrado.
2. Informe opcionalmente documento, nota, observações e a data de recebimento.
3. Coloque o leitor em modo teclado USB com sufixo Enter. A tela captura o código, limpa o campo e mantém o foco. Não há driver proprietário exigido pelo aplicativo.
4. Cada leitura acrescenta um exemplar; ler o mesmo código três vezes resulta em quantidade 3. Quantidade e custo podem ser editados na tabela. **Adicionar manualmente** pesquisa e seleciona livros.
5. Código desconhecido oferece **Cadastrar livro** para quem tem permissão: o modal preserva a entrada e adiciona o novo cadastro ao retornar.
6. **Confirmar entrada** apresenta resumo de unidade, fornecedor, títulos, exemplares e valor. **Confirmar** grava documento, itens, movimentos, saldos e auditoria em uma transação.

O rascunho fica em memória enquanto a tela está montada, inclusive ao cadastrar livro e alternar as abas internas. Recarregar a página ou sair do módulo descarta a entrada ainda não confirmada. A confirmação usa chave idempotente: repetir a mesma requisição não soma novamente; reutilizar a chave com outros valores é rejeitado. O custo da entrada é histórico; não altera automaticamente o custo comercial do catálogo.

## Estoque por filial, histórico e ajuste

`Company → Branch → Warehouse → StockBalance`, chave `(empresa, depósito, livro)`. A consulta inclui livros sem linha de saldo como zero e filtra filial, título/ISBN/autor, editora, categoria e NORMAL/ESTOQUE BAIXO/SEM ESTOQUE. O mínimo/localização cadastral é utilizado quando não há valor específico no saldo. Não há edição direta de quantidade no livro.

**Rede e histórico** soma depósitos por filial e mostra o total autorizado, usuário, data/hora, tipo, origem, quantidade, saldo anterior/posterior e motivo. Movimentos antigos sem esses detalhes aparecem como legado, sem fabricar valores retroativos.

**Ajustar** exige contagem física e motivo de pelo menos 8 caracteres. Por exemplo, saldo 10 e contagem 8 geram movimento −2. Saldo esperado é validado no servidor: se mudou desde a consulta, atualize a tela e confira novamente. Sem alteração, o ajuste é recusado. Lock transacional por depósito evita perda de atualizações simultâneas; erro em qualquer item reverte tudo.

Perfis Administrador, Gerente e Estoque recebem `stock:read`, `stock:receive`, `stock:adjust`. Na administração de usuários, associe uma filial ou todas. Administrador sempre acessa a empresa inteira. Outros perfis associados a uma filial não podem consultar/alterar estoque de outra; o dashboard financeiro consolidado e a administração global ficam indisponíveis nesses vínculos restritos. Clientes/catálogo continuam compartilhados dentro da empresa. Gestão completa de cadastro de filiais/fornecedores permanece no roadmap; a entrada utiliza os registros existentes.

## Migration desta etapa e testes de estoque

`202609260001_books_stock` é aditiva: novos campos opcionais, `ProductIdentifier`, `StockDocument`, `StockDocumentItem`, relações e constraints. Preserva dados existentes, indexa os identificadores legados e acrescenta permissões aos perfis padrão. Colisão legada interrompe a migration transacional para revisão; não remove nenhum produto para resolver duplicidade.

```powershell
npm run db:generate
npm run db:migrate
npm run test:db
npm test
npm run lint
npm run build
npm run test:e2e
```

Configure `TEST_DATABASE_URL` separado terminado em `_test`. Testes de estoque exigem banco local e são proibidos em produção. `tests/stock.test.ts` verifica 0→10→15, A15/B5/total20, rollback após alteração intermediária, idempotência simultânea, ajustes e restrições por filial. `tests/stock.browser.spec.ts` inicia API/Vite isolados nas portas 3335/5174 sobre o banco de testes, usa o cadastro real, simula código+Enter três vezes, confirma entradas e confere o banco diretamente, testa seleção manual e cadastro desconhecido preservando a operação. Fecha processos e remove somente suas fixtures ao terminar. A suíte antiga requer os servidores de desenvolvimento na 3333/5173. Não execute simultaneamente a suíte de API que limpa fixtures e a suíte de navegador de estoque.

O teste antigo de dashboard aceita R$ 0,00: um dia sem vendas é legítimo. Detalhes de transação/escopo estão em `docs/ESTOQUE-ARQUITETURA.md`. Leitor físico não foi necessário aos testes; compatibilidade do aparelho/configuração deve ser conferida em modo teclado com Enter.

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
    modules/            auth, users, catalog, dashboard, stock, sales
    services/           domínio transacional de estoque e vendas
    integrations/       contratos sem provedores fictícios
    app.ts              composição HTTP e políticas de segurança
    context.ts          autorização e auditoria
    security.ts         hashes e tokens
  web/src/
    pages/              dashboard, cadastros, administração, estoque, PDV
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

As contas a pagar/receber compartilham o modelo `FinancialEntry`, diferenciadas por tipo; isso evita duplicação. O PDV cria recebíveis e parcelas reais de cartão; gestão financeira independente, baixas, recorrência e conciliação pertencem às fases futuras. Campos fiscais são apenas cadastro; não constituem cálculo tributário ou emissão homologada.
