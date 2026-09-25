# Modelo de dados

PostgreSQL com UUIDs, índices por tenant e chaves estrangeiras compostas `(companyId, id)` em relações de negócio. Exclusão lógica por `active` nos cadastros; não existem endpoints de exclusão física nesta fase.

| Área        | Modelos                                                     |
| ----------- | ----------------------------------------------------------- |
| Organização | Company, Branch                                             |
| Acesso      | User, Membership, Role, Permission, RolePermission, Session |
| Cadastro    | Customer, Supplier, Category, Product                       |
| Estoque     | Warehouse, StockBalance, StockMovement                      |
| Vendas      | Sale, SaleItem, Payment                                     |
| Financeiro  | FinancialEntry, BankAccount, CashRegister, CashMovement     |
| Fiscal      | FiscalDocument                                              |
| Auditoria   | AuditLog                                                    |

User é global; Membership define vínculo e autorização por empresa. Session aponta para uma associação, fixando o tenant. Permission é catálogo global sem dados de negócio; Role é por empresa. Cada tabela operacional tem `companyId`; Session e RolePermission derivam esse vínculo através de suas relações. As filiais são vinculadas à empresa, mas o escopo de autorização desta entrega é empresa inteira, não restrição por filial.

Dinheiro usa Decimal(14,2); quantidades usam Decimal(14,3). APIs enviam dinheiro como string; gráficos convertem apenas para apresentação. Código e barcode são únicos por empresa; CPF/CNPJ é único por empresa, com NULL permitido quando não informado. Índices cobrem busca/listagens e filtros de data, status e tipo. SQL adicional aplica checks de valores positivos, consistência de liquidação e sinais de movimentos de estoque.

CPF e CNPJ são strings normalizadas. A validação aceita CNPJ numérico e alfanumérico, com cálculo dos DVs conforme o [manual técnico da Receita Federal/Serpro](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). Isso verifica a estrutura; não consulta a situação cadastral na Receita.

FinancialEntry representa ContaReceber/ContaPagar por enum RECEIVABLE/PAYABLE. Os serviços operacionais dessas entidades serão adicionados em suas fases; não se deve escrever diretamente nelas a partir do frontend. Estoque de produto é soma de saldos por depósito; margem é calculada, não persistida redundantemente.

Dashboard: faturamento considera apenas vendas COMPLETED no período; contas são OPEN com vencimento no período; saldo soma caixa até o fim do período, incluindo saldo inicial; gráfico usa movimentos realizados no período. Vendas de hoje/mês são indicadores explicitamente do calendário corrente e não mudam com o filtro. Estoque baixo é situação atual. Ranking e recentes respeitam o período. Limites de data comercial usam America/Sao_Paulo (UTC−03 atual); antes de suportar outras zonas/alterações de horário, substituir limites fixos por conversão IANA completa.

Auditoria é gravada com a alteração na mesma transação; não contém senha, token, payload bruto ou dados pessoais completos. Não é um armazenamento imutável contra administradores do banco: retenção, acesso restrito e armazenamento resistente a alteração ficam para operação SaaS.

RLS não está habilitado nesta entrega: isolamento depende do backend e das constraints. Os testes tentam leitura/escrita por IDs externos e relações cruzadas diretamente no banco. Novos módulos devem manter este padrão e adicionar testes equivalentes.
