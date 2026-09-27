# Relatório de validação — Caixa, trocas e devoluções

Base preservada: `main`, commit `0c16201`. A implementação interrompida foi retomada, sem reset, descarte ou recriação do projeto.

## Funcionalidades entregues

- Caixa: terminal/filial/operador, abertura, vínculo obrigatório com vendas novas, suprimento, sangria, histórico por método, fechamento, conferência e diferença permanente. Caixa fechado rejeita novas operações.
- Trocas: busca da venda sem data obrigatória, retorno parcial/múltiplo, novos livros por leitor/pesquisa, diferenças positiva/zero/negativa, pagamento misto pelo serviço existente, estoque com entrada/saída na mesma transação.
- Devoluções e vale: quantidades acumuladas limitadas à venda original, valor efetivamente pago com rateio exato de centavos; devolução sem nova mercadoria emite vale. Saldo, cliente, origem e status persistidos. Resgate do vale é pendência explícita.
- Consulta: filtros bibliográficos, cliente/documento, período, filial, caixa, operador, número, método, status e operações; visões vendas/itens/caixas/operadores/pagamentos/horas/períodos; CSV protegido contra fórmulas.
- Frontend: Caixa, Trocas/Devoluções, Movimentações; componente de pagamento compartilhado; leitor com repetição/foco; F2/F3/F4/F8/F10 e Esc seguro; desktop e celular.

## Estrutura e segurança

Migration `202609270001_cash_returns` aplicada em desenvolvimento e teste. Cria `CashSession`, `ReturnOperation`, `ReturnItem`, `CustomerCredit`; amplia registros de caixa, venda/itens, movimentos, financeiro e relações por empresa. Mantém vendas históricas e cria terminais onde necessário.

Serviços `cash`, `returns`, `sales-query` e extração de `payments`; reutiliza `writeSale` e `moveStock`. Endpoints e regras completos no [guia operacional](CAIXA-TROCAS.md). Schema/constraints/FKs compostas, sessão autenticada, origem, RBAC e escopo de empresa/filial protegem as operações. Chaves e hashes controlam retries; locks protegem sessão, venda e depósito. Auditoria e histórico vinculam usuário, motivo, itens, valores e saldos de estoque. Falha intermediária reverte a transação inteira.

## Resultados automatizados

- **65 testes Vitest aprovados em 5 arquivos:** 52 anteriores e 13 novos de caixa/trocas. Incluem API, validação/segurança, estoque, vendas, concorrência e rollback.
- **8 testes Playwright aprovados:** 4 cenários em desktop e os mesmos 4 em celular. Preservados os 6 testes anteriores; acrescentados 2 de caixa/trocas.
- O novo fluxo de navegador cobre abertura, suprimento/sangria, venda em dinheiro vinculada, consulta sem data, visões/CSV, troca pelo leitor (inclusive repetição), PIX da diferença e fechamento. Atalhos e ausência de erros JavaScript também verificados.
- Lint, TypeScript, build, Prettier/check e `git diff --check`: aprovados.
- Migrations: 5 presentes; desenvolvimento atualizado e teste sem pendências.
- Avisos não bloqueantes: importação estática/dinâmica preexistente de Catalog no Vite; depreciação de consultas concorrentes do adaptador PostgreSQL. Não houve falha de build/testes.

## Cenários persistidos e conferidos

| Cenário                                                               | Resultado                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Fundo 200 + venda dinheiro 100 + PIX 50 + suprimento 50 − sangria 100 | Total vendido 150; dinheiro físico esperado 250                                 |
| Conferência contado 245                                               | Diferença −5 persistida, sessão CLOSED                                          |
| A vendido por 50; troca por B70                                       | A 9→10; B 5→4; pagamento PIX20; movimentos e auditoria vinculados               |
| Troca 50 por 50                                                       | Entrada/saída reais; zero Payment/recebível artificial                          |
| Troca 70 por 50                                                       | Vale20, saldo20, AVAILABLE, obrigação financeira vinculada                      |
| Compra 2, devolução 1                                                 | Uma unidade retorna; tentativa de devolver outras 2 rejeitada                   |
| Reenvio/retry simultâneo                                              | Uma operação; estoque e pagamento sem duplicação                                |
| Última unidade em duas trocas                                         | Uma aceita, outra 409 por estoque; saldo final zero                             |
| Falha injetada ao gravar pagamento                                    | Estoque, troca, reposição, financeiro, movimentos e auditoria revertidos        |
| Aberturas concorrentes do mesmo terminal                              | Uma aceita, outra rejeitada                                                     |
| Fechamento concorrente com suprimento                                 | Serialização e conferência esperada preservadas                                 |
| Troca com vários itens                                                | Dois retornos, duas saídas e PIX20; filtros mostram somente item correspondente |
| Rateio de 149,99 em 3 retornos                                        | 49,99 + 50,00 + 50,00, sem perder/criar centavos                                |

O cenário de navegador usa fundo200, venda50, suprimento50/sangria50 e PIX20 da troca: gaveta250, contado245, diferença−5. Não é confundido com o cenário financeiro de API acima.

## Entrega e limites

Arquivos novos principais: quatro serviços backend, rotas de operações, quatro páginas/componentes frontend, contratos, migration, fixture e testes, guias de arquitetura/operação e este relatório. Alterações integram App, PDV, estoque, dashboard, permissões, Prisma, seed, testes e documentação existente. O índice Git deve conter somente código, migration, testes e documentação; `.env`, credenciais, banco local, logs, traces e temporários permanecem ignorados.

Commit solicitado: `feat: implementa caixa trocas e devolucoes`, branch `main`. Hash e resultado do push serão informados na entrega; não são presumidos neste arquivo antes da execução. Se houver erro de autenticação, o commit será preservado, sem novo commit/reset/destino alternativo.

Não foram iniciados Fiscal, Feiras/Eventos ou Transferências entre filiais.
