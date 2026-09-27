# Caixa, trocas e consulta operacional

Decisão anterior à implementação: evoluir o monólito modular existente; reutilizar Sale, Payment, FinancialEntry, CashRegister, CashMovement e moveStock. Não substituir os módulos de PDV/estoque.

## Caixa

CashSession identifica terminal, operador, abertura, fechamento e conferência. Uma sessão OPEN por terminal (índice parcial PostgreSQL). Toda nova venda exige sessão aberta na filial; o servidor pode resolver a única sessão do operador quando não informada. Sessões fechadas são imutáveis. Lock de sessão serializa vendas, movimentos e fechamento. CashMovement recebe sessão, método, ator, motivo e chave idempotente; também registra cartões, sem aumentar dinheiro físico/disponível. Fundo inicial, suprimento e sangria afetam somente dinheiro. Fechamento armazena resumo, contado e diferença permanentemente.

O dinheiro físico considera somente CASH e operações de gaveta. PIX é disponível no caixa lógico mas não na gaveta; cartão permanece recebível futuro. Movimentos de abertura e transferência para cofre não são faturamento. Cancelamentos posteriores usam sessão aberta atual da mesma filial, sem reabrir ou reescrever conferência histórica.

## Trocas e devoluções

ReturnOperation relaciona venda original, itens devolvidos e eventual venda de reposição. ReturnItem registra item original, quantidade e valor efetivamente pago, inclusive rateio do desconto geral em centavos. Quantidade líquida é validada sob lock da venda; devoluções acumuladas nunca excedem o vendido. Rateio determinístico e cumulativo evita criar/perder centavos em devoluções parciais.

Reposição usa Sale/SaleItem e o mesmo serviço de pagamento, na transação da troca. Valor dos retornos aplicado à reposição fica explicitamente registrado como crédito da troca na venda, sem inventar pagamento externo. Só a diferença positiva gera pagamentos. Diferença zero não gera Payment. Diferença negativa gera CustomerCredit identificado por cliente, origem, saldo/status e obrigação financeira vinculada. Política inicial única: vale-crédito; sem reembolso automático/manual nesta entrega. Cliente obrigatório para emitir vale. O resgate foi acrescentado pela consolidação descrita em [CONSOLIDACAO.md](CONSOLIDACAO.md), com consumo e restauração transacionais.

Retornos e saídas possuem origem ReturnOperation no histórico de estoque e são gravados por moveStock. Operação permitida apenas no depósito/filial original; não implica transferência entre filiais. Venda cancelada ou legado sem estoque operacional não admite retorno. Venda com devoluções não admite cancelamento integral; reposição vinculada à troca também não admite cancelamento avulso, para preservar o vínculo financeiro. Continua possível devolver seus itens por uma nova operação rastreável.

## Transações e consulta

Ordem de locks: requisição → venda original (troca/cancelamento) → sessão → depósito → numeração. Abertura/fechamento usam lock do terminal/sessão. Idempotência protege abertura, movimentos, fechamento e troca. Uma falha reverte estoque, venda de reposição, pagamentos, vale, financeiro e auditoria.

Consulta operacional expande vendas existentes: pesquisa sem data obrigatória, filtros por metadados, caixa, cliente, pagamento e operações; visões vendas/itens/caixas/operadores/pagamentos/horários, com paginação/limites e CSV protegido contra fórmulas. Agrupamentos horários usam São Paulo e períodos centralizados. Pedido usa o número do registro Sale em status ORDER existente, sem inventar integração ou pedido externo.

Validação: PostgreSQL isolado, cenários exigidos de caixa/trocas, concorrência, idempotência, rollback, autorização e Playwright desktop/celular. Migração aditiva preserva histórico. Sem fiscal, TEF, PIX integrado, eventos ou transferências.
