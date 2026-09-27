# Caixa, trocas e devoluções — guia operacional

Esta etapa evolui o PDV e o estoque existentes. Decisões: [CAIXA-TROCAS-ARQUITETURA.md](CAIXA-TROCAS-ARQUITETURA.md).

## Caixa

1. Em **Caixa**, escolha **Abrir caixa**, terminal/filial e fundo inicial. Administrador/Gerente pode cadastrar terminal. Só pode existir uma sessão aberta por terminal.
2. No PDV, selecione o depósito e uma sessão aberta da mesma filial. Vendas novas exigem caixa aberto. O operador usa seu caixa; `cash:manage` permite operar caixas de outros operadores autorizados.
3. **Ver caixa** mostra recebimentos por método, suprimentos, sangrias, cancelamentos, vales emitidos, total vendido líquido e dinheiro esperado. PIX e cartões não aumentam dinheiro físico.
4. Suprimento/sangria exigem valor positivo e motivo de pelo menos oito caracteres. Sangria não pode exceder o dinheiro esperado.
5. **Fechar caixa** mostra o resumo e solicita dinheiro contado. A diferença é contado menos esperado; se diferente de zero, exige observação. **Atualizar resumo** permite conferir novamente quando outra operação alterou o saldo.
6. A conferência fica gravada com usuário, horário e diferença. Uma sessão fechada não recebe vendas, trocas ou movimentos. Cancelamento posterior usa uma sessão aberta atual da mesma filial, preservando o fechamento anterior.

O total vendido líquido da sessão é recebimentos menos cancelamentos e vales emitidos naquela sessão. A diferença de troca positiva entra como recebimento; a parcela reaplicada na mercadoria não é um novo recebimento. Vales não retiram dinheiro da gaveta. O histórico registra recebimentos externos e movimentos lógicos STORE_CREDIT, sem entrada física de dinheiro. Vales também possuem histórico próprio de emissão, uso e restauração.

## Trocar ou devolver

Em **Trocas / Devoluções**, localize a venda sem informar data, por número, cliente/documento ou livro. Também é possível iniciar pelos detalhes da venda.

Selecione quantidades devolvidas. A tela mostra preço, desconto e valor efetivamente pago, incluindo rateio do desconto geral. O backend desconta todas as devoluções anteriores da quantidade disponível.

Para trocar, leia ISBN/EAN/SKU e Enter ou pesquise os novos livros. Ler novamente aumenta quantidade; o campo limpa e recupera foco. Escolha caixa, informe motivo e calcule o resumo. Vários itens podem entrar e sair na mesma operação.

- Diferença positiva: use os mesmos pagamentos do PDV, inclusive mistos. PIX e cartões exigem confirmação manual externa.
- Diferença zero: confirme sem pagamento artificial.
- Diferença negativa: identifique um cliente ativo para emitir vale-crédito com origem, valor, saldo e status.
- Devolução sem novos livros: emite vale pelo valor devolvido.

A política desta entrega é **vale-crédito**, sem reembolso bancário/manual. O vale fica consultável no histórico da operação e pela API de créditos por cliente. No PDV, selecione cliente e depósito, consulte o saldo e escolha **Vale-crédito** como pagamento. É possível usar parte do saldo e combinar com dinheiro, PIX ou cartões. O servidor consome os vales disponíveis mais antigos do mesmo cliente e filial; cancelamento elegível restaura exatamente os consumos. Veja [CONSOLIDACAO.md](CONSOLIDACAO.md).

O detalhe preserva venda original, reposição, itens, pagamentos, vale, operador, filial, caixa e movimentos com saldos anteriores/posteriores. A operação é atômica e idempotente. Não há exclusão de trocas/devoluções pela API. Vendas com retornos ou reposições de troca não permitem cancelamento integral avulso; seus itens disponíveis podem ser devolvidos em outra operação rastreável.

A troca usa o depósito original. Vendas legadas sem vínculo operacional de estoque não admitem troca. A disponibilidade dos novos itens é validada antes do retorno; itens devolvidos na própria operação não são usados para encobrir falta de estoque.

## Consulta operacional

**PDV / Vendas → Histórico de vendas** contém Movimentações de vendas. Filtros: período opcional, hoje/ontem/7/30 dias, filial, terminal, operador, cliente/CPF/CNPJ/contato, número da venda/pedido, título, ISBN/EAN, autor, editora, método, status e presença de troca/devolução.

Visões: vendas, itens, caixas, operador, pagamento, hora e período do dia. Horários usam America/Sao_Paulo; madrugada 0–6, manhã 6–12, tarde 12–18 e noite 18–24, centralizados nos contratos.

Valores comerciais usam a data de cada evento: vendas realizadas no período menos retornos realizados no período, mesmo que a venda original seja anterior. Na visão de itens, os filtros bibliográficos limitam também as linhas exibidas, preservando o rateio do desconto da venda inteira. A visão de caixas mostra o resumo completo das sessões selecionadas; filtros de livro/cliente selecionam sessões que contêm vendas correspondentes, não recortam seus movimentos.

Por pagamento, valores representam pagamentos não estornados, incluindo STORE_CREDIT, pela data da venda. Uma venda mista participa de cada método utilizado; quantidades de vendas/itens entre métodos não devem ser somadas como total único. O vale não é estorno do pagamento original. Reposições participam dos valores e itens, mas não da contagem de vendas independentes. Ticket médio divide o valor líquido pela contagem independente; sem venda independente fica indisponível. Canceladas não participam dos agrupamentos de vendas concluídas.

Exportação CSV usa os mesmos filtros e visão, UTF-8 com BOM, separador `;`, aspas escapadas e proteção contra fórmulas. Paginação de 25 linhas; consultas limitadas a 5.000 vendas/20.000 itens e 5.000 sessões, solicitando filtros adicionais. Não há PDF nesta entrega.

## Teclado

PDV: F2 cliente, F3 pesquisar livro, F4 desconto, F8 pagamento, F10 revisar/finalizar. A confirmação final da venda continua explícita. Caixa: F2 abrir, F10 conferir fechamento da sessão selecionada. Esc fecha modal quando seguro; durante gravação não descarta a operação.

## Banco e backend

Migration aditiva `202609270001_cash_returns`, aplicada com `npm run db:migrate` e `npm run test:db`.

Novos models: `CashSession`, `ReturnOperation`, `ReturnItem`, `CustomerCredit`. Evoluídos: `CashRegister`, `CashMovement`, `Sale`, `SaleItem`, `StockMovement`, `FinancialEntry` e relações inversas de empresa/filial/operador/cliente/depósito. Índice parcial garante uma sessão aberta por terminal; constraints monetárias e FKs compostas por empresa protegem os vínculos. Triggers impedem alterar sessão fechada e inserir movimentos em sessão fechada/incompatível. Vendas antigas continuam válidas com sessão opcional no schema; novas vendas exigem sessão no serviço.

Serviços: `cash.ts` para sessões/conferência; `returns.ts` para troca/rateio/vale; `sales-query.ts` para consulta; `payments.ts` extrai e reutiliza o pagamento existente. `writeSale` e `moveStock` são compartilhados, dentro da mesma transação PostgreSQL.

Endpoints relativos a `/api`:

| Método e rota                     | Permissão / finalidade                               |
| --------------------------------- | ---------------------------------------------------- |
| GET /cash/options                 | cash:read; terminais e sessões                       |
| POST /cash/registers              | cash:manage; novo terminal                           |
| GET /cash/sessions                | cash:read; histórico paginado                        |
| GET /cash/sessions/:id            | cash:read; detalhe e resumo                          |
| POST /cash/sessions               | cash:operate; abertura idempotente                   |
| POST /cash/sessions/:id/movements | cash:operate; suprimento/sangria                     |
| POST /cash/sessions/:id/close     | cash:operate; conferência                            |
| POST /returns/quote               | returns:create; cálculo sem mutação                  |
| POST /returns                     | returns:create; confirmação atômica                  |
| GET /returns                      | sales:read; histórico e filtro saleId                |
| GET /returns/:id                  | sales:read; detalhe                                  |
| GET /credits?customerId=UUID      | sales:read; vales do cliente no escopo autorizado    |
| GET /sales/analysis               | sales:read; filtros/visões, csv=true para exportação |

As mutações recebem `requestKey` UUID. Repetição do mesmo conteúdo retorna o resultado existente; reutilização divergente é rejeitada. Contratos Zod rejeitam campos extras. RBAC, sessão autenticada, proteção de origem e escopo de empresa/filial são aplicados no backend. Locks de requisição, venda, sessão e depósito serializam disputas. Auditoria e movimentos vinculados permitem reconstruir estoque, pagamentos e créditos sem registrar segredos.

## Executar e validar

Com `.env` local configurado conforme README: iniciar PostgreSQL (`npm run db:local` para a opção local), aplicar migrations, gerar Prisma (`npm run db:generate`) e iniciar `npm run dev`. Abra http://localhost:5173. Credenciais continuam no ambiente local, nunca nesta documentação. Seed existente é fictício e preservado; uma instalação nova recebe terminal vinculado à filial.

Validação: `npm test`, `npm run lint` (inclui TypeScript), `npm run build`, `npm run test:e2e`, `npm run format:check`, `git diff --check`. Playwright requer navegador instalado e frontend/API de desenvolvimento em execução para o cenário básico; cenários operacionais sobem servidores próprios e usam exclusivamente o banco `_test`. Não executar suites de API e navegador simultaneamente, pois a suite antiga recria dados de teste.

Não foram implementados fiscal, feiras/eventos, transferências entre filiais, TEF, PIX automático ou estorno bancário.
