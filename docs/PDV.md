# PDV operacional — guia e API

## Operação

1. Entre com seu usuário e abra **PDV / Vendas → Nova Venda**.
2. Escolha filial/depósito autorizado. O operador é sempre o usuário da sessão.
3. Leia ISBN/EAN/SKU com um leitor configurado como teclado USB com sufixo Enter. O campo limpa e recupera o foco; cada leitura soma uma unidade na mesma linha. Leituras rápidas são processadas em fila, compartilhada com a Entrada de Livros.
4. **Adicionar livro** permite pesquisar título, autor, editora, ISBN e SKU. Ajuste quantidades, remova itens e conceda descontos conforme seu perfil.
5. Opcionalmente selecione ou cadastre cliente. O cadastro em modal preserva o carrinho. A pesquisa aceita nome, documento, telefone e e-mail.
6. Informe pagamentos até a soma dos valores aplicados corresponder exatamente ao total. Em dinheiro, informe também o recebido; troco é recebido menos valor aplicado. Em PIX/cartão, confirme o recebimento realizado externamente.
7. **Finalizar venda** valida preço, disponibilidade e desconto no backend e abre o resumo. **Confirmar venda** revalida e grava tudo na mesma transação.
8. A confirmação mostra número, total, pagamentos, troco, operador e filial. **Nova venda** limpa o carrinho concluído; **Ver venda** apresenta os registros persistidos.

Carrinho em memória não reserva nem baixa estoque. Alternar as abas internas e cadastrar cliente preserva os itens; recarregar a página ou sair do módulo descarta o rascunho. O depósito fica bloqueado enquanto há itens/leituras pendentes para impedir troca silenciosa da origem do estoque. Preço alterado no catálogo exige remover e adicionar novamente o livro antes de confirmar. O cancelamento de uma venda antiga de demonstração sem origem operacional é bloqueado.

## Pagamentos e financeiro

| Forma          | Registro persistido                                                                     |
| -------------- | --------------------------------------------------------------------------------------- |
| Dinheiro       | Pagamento com recebido/troco, recebível liquidado, entrada no caixa pelo valor aplicado |
| PIX manual     | Confirmação externa explícita, recebível liquidado, entrada no caixa lógico             |
| Débito manual  | Pagamento registrado, recebível aberto com previsão no próximo dia                      |
| Crédito manual | Pagamento registrado, 1–12 parcelas abertas, mensais a partir do mês seguinte           |
| Misto          | Até oito registros; soma exata do total, com no máximo uma parcela em dinheiro          |

Previsões de cartão são convenções internas, sem confirmação de adquirente, taxas ou antecipação. A soma das parcelas mantém todos os centavos: R$ 100,01 em 3x gera R$ 33,34 + R$ 33,34 + R$ 33,33. Datas mensais são limitadas ao último dia do mês. Não há liquidação automática de cartão nem tela de conciliação nesta etapa.

Caixa lógico por filial registra dinheiro e PIX, líquido de troco. Não representa abertura/fechamento por turno ou conciliação bancária. Dashboard existente lê vendas concluídas, recebíveis abertos e movimentos de caixa reais. Venda cancelada deixa o faturamento; recebíveis cancelados deixam os valores abertos e a saída compensatória reduz o saldo. Recebimentos de cartão só impactarão caixa após futura liquidação.

## Desconto e autorização

`sales:read`, `sales:create`, `sales:discount` e `sales:cancel` são permissões separadas. Administrador/Gerente recebem as quatro; Vendedor recebe consulta, criação e desconto. O backend limita a soma de descontos de itens e cabeçalho sobre o subtotal original: Vendedor 5%, Gerente 20%, Administrador 100%. O desconto geral incide depois dos descontos dos itens. Outros perfis precisam de concessão explícita; não existe editor de perfis customizados nesta versão.

Empresa vem da sessão, filial vem do depósito autorizado, operador vem do vínculo autenticado. Escopo de filial vale para opções, busca exata, cotação, confirmação, histórico, detalhes e cancelamento. Relações compostas por empresa impedem referências cruzadas no banco.

## Cancelamento

Nos detalhes de uma venda operacional concluída, **Cancelar venda** exige permissão, motivo com ao menos oito caracteres e confirmação de que a devolução manual dos valores foi tratada. A transação preserva a venda como `CANCELLED`, registra ator/data/motivo, recompõe o depósito original com movimento positivo, marca pagamentos revertidos, cancela os títulos e cria saídas compensatórias para os recebimentos em caixa.

Sem exclusão física, estorno bancário ou comunicação com maquininha. Cancelamento repetido com a mesma chave e motivo retorna o resultado existente; com outra chave é recusado. Não existe devolução parcial nesta etapa.

## Banco e migração

Migration aditiva `202609260002_pdv_sales`: **nenhuma nova tabela**. Amplia `Sale`, `SaleItem`, `Payment`, `FinancialEntry`, `CashRegister`, `CashMovement` e `StockMovement`; adiciona relações inversas a empresa/filial/depósito/usuário conforme schema. Inclui campos de origem/idempotência/cancelamento, snapshots bibliográficos, parcelas/troco e índices/constraints. Campos opcionais preservam o seed/legado. Permissões são acrescentadas aos perfis existentes.

Serviço `apps/api/src/services/sales.ts` usa o `moveStock` já existente. A confirmação mantém a mesma trava transacional por depósito; duas vendas disputando a última unidade resultam em uma confirmação e uma recusa. A numeração é serializada por empresa. Descrições, preço e custo são snapshots da venda. Cálculos usam centavos `BigInt`; PostgreSQL armazena `Decimal`.

## Endpoints

| Método / rota                                     | Permissão / função                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/sales/options`                          | `sales:read`: depósitos/filiais e operadores autorizados                     |
| `GET /api/sales/lookup?warehouseId=UUID&code=...` | `sales:create`: código exato e disponibilidade; alternativamente `productId` |
| `POST /api/sales/quote`                           | `sales:create`: valida e calcula carrinho sem efeito no estoque              |
| `POST /api/sales`                                 | `sales:create`: confirmação atômica e idempotente                            |
| `GET /api/sales?from=AAAA-MM-DD&to=AAAA-MM-DD`    | `sales:read`: histórico paginado, até 366 dias                               |
| `GET /api/sales/:id`                              | `sales:read`: itens, pagamentos, parcelas, estoque e caixa                   |
| `POST /api/sales/:id/cancel`                      | `sales:cancel`: motivo e recomposição idempotente                            |

Histórico aceita `branchId`, `operatorId`, `customerId`, `customerQuery`, `status` e `page`. Datas comerciais seguem São Paulo. Objetos de entrada são estritos (Zod). Envie o cookie de sessão e `Origin` autorizado nas mutações.

Cotação recebe `{warehouseId, customerId?, discount, items}`. Cada item contém `{productId, quantity, expectedUnitPrice, discount}`; dinheiro é string decimal com até duas casas, quantidade inteira. Desconto é `{type: "AMOUNT" | "PERCENT", value: "0"}`. Confirmação recebe `{requestKey: UUID, cart, payments}`; pagamento usa `method` (`CASH`, `PIX`, `DEBIT_CARD`, `CREDIT_CARD`), `amount`, `receivedAmount?`, `installments`, `confirmed`, `cardBrand?` e `reference?`. Cancelamento recebe `{requestKey: UUID, reason, refundConfirmed: true}`. Reuse a mesma chave e corpo em retries. Não envie dados de cartão ou segredos na referência.

## Validação reproduzível

`npm run test:db` prepara o PostgreSQL local isolado terminado em `_test`. `npm test` inclui os testes de PDV, estoque, autenticação e cadastros. Execute depois `npm run lint`, `npm run build` e `npm run test:e2e`. O navegador do PDV inicia API/Vite próprios em 3335/5174, opera contra o banco real, confere registros e remove apenas sua fixture. Não execute a suíte API e a suíte navegador simultaneamente: testes antigos de API limpam o banco de testes.

`tests/sales.test.ts`: sequência 10→8→7→6→4→6, PIX, troco, parcelas, misto, cancelamento, concorrência última unidade, idempotência simultânea, falha financeira forçada com rollback, limites de desconto, autorização por filial/empresa e filtros. `tests/sales.browser.spec.ts`: teclado+Enter, leitura repetida, pesquisa manual, cadastro de cliente com carrinho preservado, pagamentos, cancelamento, estoque insuficiente, botões de quantidade e desconto em desktop/celular. O leitor físico deve ser conferido no balcão; testes simulam o protocolo teclado+Enter.

Fora do escopo: fiscal, PIX automático/QR, TEF, adquirentes, transferências, devolução parcial, orçamento/pedido operacional, conciliação, gestão de turnos e impressão fiscal.
