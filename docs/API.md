# API inicial

Prefixo `/api`. JSON. Sem CORS aberto: frontend usa mesma origem via proxy. Mutações exigem `Origin` igual a `WEB_ORIGIN`. Sessão no cookie `caramelo_session`; nenhuma rota aceita um tenant arbitrário para dados de negócio.

| Método e rota                                | Permissão / efeito                                          |
| -------------------------------------------- | ----------------------------------------------------------- |
| GET /health                                  | Disponibilidade e SELECT 1 no PostgreSQL                    |
| POST /auth/login                             | company (slug), email e password; limite de 8/minuto por IP |
| GET /auth/me                                 | Perfil, empresa e permissões da sessão                      |
| POST /auth/logout                            | Revoga sessão e remove cookie                               |
| GET /dashboard?from=AAAA-MM-DD&to=AAAA-MM-DD | dashboard:read; até 366 dias                                |
| GET /customers?q=&page=1&limit=20            | customers:read                                              |
| POST /customers                              | customers:write; contrato customerSchema                    |
| PUT /customers/:id                           | customers:write; atualização completa validada              |
| GET /products?q=&page=1&limit=20             | products:read                                               |
| GET /products/options                        | products:read; categorias e fornecedores do tenant          |
| POST /products                               | products:write; contrato productSchema                      |
| PUT /products/:id                            | products:write; atualização completa, sem editar saldo      |
| GET /roles                                   | users:manage; perfis e permissões disponíveis               |
| GET /users?page=1&limit=20                   | users:manage; associações sem senha/hash                    |
| POST /users                                  | users:manage; name, email, password, roleId                 |
| PATCH /users/:id                             | users:manage; roleId e active, revoga sessões               |
| GET /audit?page=1&limit=20                   | audit:read                                                  |

Listas paginadas: `{items,total,page,limit}`; limite máximo 100. Validação usa Zod em `packages/contracts/src/index.ts`; chaves extras sensíveis são rejeitadas. Erros: 400 validação, 401 sessão inválida, 403 acesso/origem, 404 registro fora do escopo ou inexistente, 409 duplicação, 429 limite, 500 mensagem genérica. Campos monetários são strings decimais. Estoque e PDV foram adicionados posteriormente; consulte [PDV.md](PDV.md) e [CAIXA-TROCAS.md](CAIXA-TROCAS.md) para os endpoints operacionais atuais. Não há emissão fiscal.

Perfis da entrega inicial (as permissões atuais de estoque, PDV, caixa e trocas estão nos contratos e guias operacionais):

| Perfil        | Acesso                                         |
| ------------- | ---------------------------------------------- |
| Administrador | Todos os módulos implementados e usuários      |
| Gerente       | Dashboard, editar clientes/produtos, auditoria |
| Financeiro    | Dashboard gerencial e consulta de clientes     |
| Vendedor      | Consultar/editar clientes e consultar produtos |
| Estoque       | Consultar/editar produtos                      |
| Fiscal        | Consultar clientes/produtos                    |

Perfis especializados ganharão as permissões dos seus módulos conforme o roadmap. Dashboard é um conjunto de dados gerenciais/financeiros: não é concedido ao vendedor por padrão. As permissões são verificadas no backend, independentemente de botões visíveis no frontend.
