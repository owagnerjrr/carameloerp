# Decisão de arquitetura — PDV e vendas

Preservar Sale, SaleItem, Payment, FinancialEntry e CashMovement e ampliar com campos opcionais para manter o seed/legado. Sale passa a registrar depósito, chave/hash idempotente, subtotal e cancelamento. Payment registra valor aplicado, recebido/troco, parcelas, bandeira e referência. FinancialEntry registra filial, pagamento e número de parcela. CashRegister passa a poder pertencer a uma filial; o PDV usa um caixa lógico por filial nesta etapa, sem abertura/fechamento de turnos.

Reutilizar warehouseAccess, moveStock e o mesmo advisory lock por depósito. StockMovement ganha saleId (origem comum da saída e recomposição, uma de cada tipo por produto/venda) para baixa/recomposição. Não criar um segundo mecanismo de estoque. Ordem das travas na confirmação: chave da requisição → depósito → numeração por empresa. No cancelamento: venda → depósito. Numeração usa MAX sob lock por empresa; não altera números existentes.

Preços são relidos no backend. Carrinho contém preço esperado e descontos solicitados; alteração de preço exige revisão. Cálculos monetários em centavos BigInt com arredondamento half-up para percentuais. Descontos por item e no total exigem sales:discount; o teto efetivo é 5% para Vendedor, 20% Gerente, 100% Administrador. Outros perfis não recebem desconto automaticamente. Não há preço livre no cliente.

PIX/débito/crédito são confirmações manuais explícitas, sem consulta a banco/terminal. Dinheiro e PIX produzem recebível liquidado e movimento de caixa lógico. Débito produz recebível aberto com vencimento no próximo dia; crédito produz parcelas abertas a cada mês, começando no mês seguinte. Datas são previsão interna, não agenda confirmada de adquirente. Valores das parcelas são distribuídos em centavos, sem perda. Caixa guarda receita líquida de troco; cartão não entra no saldo disponível antes de liquidação.

Confirmação grava venda, itens, pagamentos, títulos, movimentos, estoque e auditoria na mesma transação. Idempotência retorna o resultado da primeira execução sem refazer efeitos. Cancelamento serializado mantém a venda, cria movimentos de estoque inversos, cancela títulos e registra saída compensatória de caixa para recebimentos já registrados. O operador confirma que tratou a devolução manual dos valores fora do sistema. Não há estorno bancário automático.

Sem pagamentos automáticos, fiscal, TEF, transferências ou inventário. O carrinho é memória de interface e não reserva nem baixa estoque. A disponibilidade exibida é indicativa; somente a validação transacional decide a conclusão.
