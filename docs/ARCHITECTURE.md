# Arquitetura — decisão inicial

Status: aceita para a primeira entrega. Repositório remoto inspecionado em 25/09/2026: vazio, sem arquivos ou histórico a preservar.

## Monólito modular em monorepo npm

- `apps/web`: React, TypeScript, Vite, Tailwind; interface própria em português.
- `apps/api`: Node.js, TypeScript e Fastify; módulos de autenticação, administração, cadastros e dashboard.
- `packages/database`: PostgreSQL, Prisma, migrations SQL versionadas e seed explícito de desenvolvimento.
- `packages/contracts`: schemas Zod e matriz RBAC compartilhados; backend sempre valida novamente.

Fastify complementa a stack solicitada por oferecer ciclo de requisição, testes sem servidor HTTP, logs estruturados e plugins de segurança. Um monólito modular evita a complexidade operacional prematura dos microsserviços. Prisma 7 usa o adapter PostgreSQL; dinheiro permanece Decimal no banco e é serializado como string. Documentação consultada: https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7 e https://fastify.dev/docs/latest/Reference/TypeScript/.

## Isolamento e autorização

Usuário é uma identidade global; Membership vincula usuário, empresa, filial opcional e perfil. Login exige identificador da empresa. A sessão opaca aleatória é armazenada apenas como hash no banco e enviada em cookie HttpOnly, SameSite=Lax e Secure em produção. Cada requisição recarrega a associação ativa e suas permissões. Tenant vem da sessão, nunca de um campo enviado pelo cliente. Consultas são explicitamente limitadas pelo tenant; relações de negócio usam chaves estrangeiras compostas para impedir referências cruzadas entre empresas. Testes de integração cobrem leitura, escrita e autorização entre tenants.

Senhas: scrypt do Node com salt aleatório e parâmetros fixos. Sessões expiram, são revogáveis e logout remove a sessão. Mutações exigem Origin permitido (proteção CSRF); rate limit protege login e API. Logs não incluem corpos, cookies, senhas ou tokens. Auditoria usa metadados selecionados e é gravada na mesma transação da alteração.

## Escopo incremental

Primeira entrega: base, login/logout, usuários e perfis, dashboard alimentado pelo banco, clientes e produtos com criação/edição/listagem, seed e testes. Estoque nos cadastros é somente leitura; movimentos futuros deverão usar serviço transacional. Vendas e financeiro recebem apenas modelos e dados de demonstração para indicadores, sem endpoints operacionais. Fiscal e outras integrações têm contratos desacoplados, sem emissão ou comunicação simulada.

## Operação e evolução

### Build e execução TypeScript

Vite 8 e Rolldown unificam o compilador do frontend e dos bundles Node. A API em desenvolvimento recompila e reinicia via watcher; produção executa JavaScript com Node, sem loader TypeScript. O seed também é compilado antes da execução. A escolha substitui tsx/tsup após incompatibilidades de acesso a informações do usuário e resolução de diretórios em sessões Windows restritas; não altera a stack ou a arquitetura de runtime.

PostgreSQL via Docker Compose ou instância existente. Banco PostgreSQL portátil é opção exclusivamente local quando Docker não está disponível. Produção exige HTTPS/reverse proxy de mesma origem, banco privado, backups, monitoramento, política de retenção, revisão de segurança e rate limiter compartilhado antes de múltiplas réplicas. RLS é defesa adicional planejada; não é alegada como implementada nesta fase. Planos, cobrança, provisionamento, MFA e recuperação de senha ficam no roadmap.
