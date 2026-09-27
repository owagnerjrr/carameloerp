# Entrega PDV — 26/09/2026

Implementação sobre `main`, marco anterior `bc4d5da`. Estoque existente reutilizado, sem substituir seu motor transacional. Guia funcional e contratos HTTP: [PDV.md](PDV.md). Decisões: [PDV-ARQUITETURA.md](PDV-ARQUITETURA.md).

## Funcionalidades

- Menu **PDV / Vendas**, tela Nova Venda, filial/depósito autorizado e operador da sessão.
- Leitor teclado USB + Enter, fila de leituras, repetição soma na mesma linha, limpeza/foco, pesquisa manual por metadados.
- Carrinho sem reserva ou baixa, quantidades, remoção, descontos em valor/percentual por item e no total, cliente opcional e cadastro em modal.
- Dinheiro/troco, PIX manual, débito manual, crédito manual em 1–12 parcelas e misto com fechamento exato em centavos.
- Resumo e confirmação atômica; estoque, itens, pagamentos, recebíveis, caixa e auditoria persistidos em PostgreSQL.
- Histórico por período/filial/operador/cliente/status, detalhes e referência aos movimentos.
- Cancelamento autorizado com motivo, devolução manual confirmada, recomposição, reversão financeira e retenção da venda.
- Idempotência, validação de preços no backend, limites de desconto e proteção de empresa/filial.

## Banco, API e interface

Sem novas tabelas. Migration **202609260002_pdv_sales** amplia `Sale`, `SaleItem`, `Payment`, `FinancialEntry`, `CashRegister`, `CashMovement` e `StockMovement`, preservando os registros existentes. Inclui índices, constraints, relações por empresa e permissões dos perfis. Aplicada com sucesso no banco local de desenvolvimento e no banco isolado de testes.

APIs: `GET /sales/options`, `GET /sales/lookup`, `POST /sales/quote`, `POST /sales`, `GET /sales`, `GET /sales/:id`, `POST /sales/:id/cancel`, todas sob `/api`. Busca de clientes existente ampliada para telefone/e-mail; histórico de estoque passa a identificar a venda de origem.

Componentes em `Sales.tsx`: `SalesPage`, `PointOfSale`, `DiscountInput`, `SearchForm`, `SalesHistory`, `SaleDetail`. Hook `useBarcodeReader` compartilhado com a entrada de livros. Serviços em `services/sales.ts`, rotas em `modules/sales.ts`, schemas/cálculos em `packages/contracts/src/sales.ts`.

## Resultados verificados

Testes executados em PostgreSQL local isolado, nunca produção. O navegador consulta o banco diretamente após as operações.

| Cenário                                               | Resultado                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Livro R$ 50, estoque inicial                          | 10 unidades                                                                                                                   |
| Duas leituras, PIX manual R$ 100                      | Uma linha com quantidade 2; venda/pagamento/recebível R$ 100; movimento −2; estoque 8                                         |
| Dinheiro, 1 livro, recebido R$ 100                    | Total R$ 50, troco R$ 50; caixa líquido +R$ 50; estoque 7                                                                     |
| Crédito, 1 livro, 2x                                  | Duas parcelas abertas de R$ 25; estoque 6                                                                                     |
| Misto, 2 livros, PIX R$ 40 + débito R$ 60             | Dois pagamentos, recebível PIX liquidado/débito aberto; estoque 4                                                             |
| Cancelamento da venda mista                           | Venda mantida cancelada, movimento +2, títulos cancelados, caixa PIX compensado, auditoria com usuário/data/motivo; estoque 6 |
| Duas confirmações simultâneas da última unidade       | Uma HTTP 201, outra HTTP 409 “Estoque insuficiente.”; estoque 0                                                               |
| Repetição simultânea da mesma confirmação             | Mesma venda retornada, baixa única                                                                                            |
| Falha forçada ao criar financeiro após baixar estoque | HTTP 500; rollback de venda/itens/pagamentos/estoque/caixa/auditoria; retry válido funciona                                   |
| Empresa ou filial sem acesso                          | Operação/consulta recusada, saldo preservado                                                                                  |

## Qualidade

- **52 testes unitários/integração aprovados** em quatro arquivos, incluindo dez novos testes de PDV.
- **6 testes Playwright aprovados**: base, estoque e PDV em desktop/celular. Sem erros JavaScript nas páginas testadas.
- Lint e TypeScript: aprovados.
- Build frontend e backend: aprovados.
- Formatação Prettier e `git diff --check`: aprovados.
- API `/api/health`: `ok`; frontend local: HTTP 200.
- Avisos não bloqueantes: driver PostgreSQL avisa sobre chamadas internas concorrentes; Vite informa que o catálogo compartilhado não ganha chunk próprio por import dinâmico. Nenhum erro de execução observado nos cenários verificados.

## Revisão local

Com PostgreSQL/API/Vite ativos, abra `http://localhost:5173` e selecione **PDV / Vendas**. Login de demonstração: empresa `caramelo-demo`, e-mail `admin@caramelo.example`; senha local em `.local/demo-access.txt` ou variável `SEED_DEMO_PASSWORD` do `.env`. Senhas não são versionadas. Para reiniciar, siga os comandos de banco, migrations e `npm run dev` do README.

O leitor foi testado por simulação do protocolo teclado+Enter; testar também o aparelho físico no balcão. PIX/cartão e devoluções são manuais; vencimentos de cartão são previsões internas. Gestão financeira completa, turnos de caixa, devoluções parciais, integrações, fiscal e TEF permanecem fora desta entrega. Commit e confirmação de push são informados no encerramento da tarefa.
