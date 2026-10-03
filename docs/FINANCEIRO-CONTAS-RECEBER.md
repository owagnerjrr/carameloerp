# Contas a Receber e financeiro consolidado

## Arquitetura e modelos

Reutiliza `FinancialEntry`, `FinancialSettlement` e `FinancialAction`. Não existe um segundo ledger. As parcelas já criadas pelo PDV continuam vinculadas a `Payment`, `Sale`, empresa, filial e cliente. Nenhum valor original é editado pela nova interface.

- `FinancialEntry`: previsão opcional (`expectedDate`), observações, referência externa e histórico de ações.
- `FinancialSettlement`: tipos `PAYMENT` (Contas a Pagar existente), `RECEIPT` e `REVERSAL`. Reversão positiva referencia a liquidação original; o sinal é interpretado no fluxo. Unicidade por empresa/original impede reversão duplicada. Histórico não é apagado.
- `FinancialAction`: aponta exclusivamente para obrigação a pagar ou parcela a receber. Chave por empresa, hash do conteúdo e resultado permitem retry exato.
- `AuditLog`: eventos de criação, baixa parcial/total, alteração de previsão, cancelamento e reversão, com ator, data, empresa, filial, origem, IDs e valores relevantes.

A migration `202610030001_receivables` é aditiva e transacional. Mantém constraints de valores anteriores, acrescenta relações compostas por empresa, índices únicos e checks de tipo/destino. Liquidações operacionais históricas são preenchidas com valores, datas e atores existentes; vendas canceladas recebem a correspondente reversão administrativa. Não inventa ator/data para registros legados sem vínculo operacional. Auditoria histórica anterior não é fabricada.

## Origem e política dos meios de pagamento

| Meio         | Política                                                               |
| ------------ | ---------------------------------------------------------------------- |
| Dinheiro     | Recebido imediatamente, uma liquidação, sem saldo pendente             |
| PIX manual   | Recebido imediatamente conforme confirmação manual do PDV              |
| Débito       | Recebível aberto, previsão inicial no dia seguinte                     |
| Crédito      | Parcelas abertas, vencimentos mensais com ajuste ao último dia do mês  |
| Vale-crédito | Consome obrigação comercial existente; não cria nova entrada/recebível |

O divisor de centavos existente é preservado: R$ 100 / 3 resulta em R$ 33,34 + R$ 33,33 + R$ 33,33. Cada parcela mantém o pagamento e a venda original. Confirmação do cartão no PDV representa captura administrativa, não liquidação bancária.

Feiras/Eventos atualmente têm estoque, sem venda própria. A integração futura deverá reutilizar o serviço de pagamentos; este bloco não cria PDV de feira.

## Baixas e previsão

Baixa total ou parcial usa valor positivo, limitado ao saldo. Data deve estar entre a data comercial da venda e hoje, no fuso de São Paulo. Cada baixa registra operador, data, meio original, referência e observações. O valor original permanece intacto; saldo, status parcial/recebido e atraso são calculados no backend. Atraso usa vencimento original, independentemente da previsão ajustada.

Previsão/referência/observações podem ser alteradas, com motivo e auditoria, somente antes da primeira baixa e enquanto a venda estiver concluída. Não há edição arbitrária do valor original. A data final de liquidação é a maior data dos recebimentos registrados.

## Cancelamento, trocas e vale

Cancelamento integral da venda cancela parcelas pendentes e cria reversões das baixas existentes. As liquidações originais e `settledAmount` permanecem como histórico; saldo exigível da parcela cancelada é zero. A reversão é um efeito administrativo, **não confirmação de estorno bancário real**. A execução externa continua manual.

Trocas/devoluções existentes devolvem valor por livro ou vale, não por estorno do cartão. Portanto o recebível original permanece: cancelar também esse recebível duplicaria o benefício. Uma reposição paga apenas pela diferença gera financeiro somente sobre a diferença. Vale consumido não aumenta entradas. Vales não são classificados como saídas monetárias previstas.

## Concorrência, idempotência e rollback

A ordem é chave de requisição, trava consultiva da venda e `FOR UPDATE` da parcela. Cancelamento usa a mesma trava da venda. Duas baixas não consomem o mesmo saldo, e uma baixa concorrente com cancelamento termina liquidada e revertida ou rejeitada. Operações do PDV mantêm a idempotência existente; baixas e alterações usam `FinancialAction`.

Mesma chave/conteúdo retorna o resultado anterior; conteúdo divergente é rejeitado. Saldo, liquidação, ação e auditoria fazem parte de uma transação PostgreSQL. Cancelamento mantém estoque, venda, financeiro e auditoria na transação original. Testes provocam falhas reais por triggers no banco isolado, verificando rollback e removendo as triggers em `finally`.

O consolidado lê parcelas e liquidações em snapshot `RepeatableRead`, evitando combinar saldos e movimentos de instantes diferentes.

## Fluxo e filtros

`Financeiro` mantém Contas a Pagar e acrescenta Contas a Receber e Fluxo de Caixa.

- Realizado: recebimentos menos pagamentos e reversões administrativas, pela data da liquidação.
- Previsto: saldos abertos de recebíveis e Contas a Pagar, pela data prevista/vencimento.
- Visão diária, hoje, 7 dias, 30 dias e período personalizado; indicadores de entradas, saídas, resultado, saldos abertos e atrasados.
- Empresa é a sessão atual; filtros por filial, cliente, fornecedor, origem, situação, meio e texto. Recebíveis usam período de vencimento original. Fluxo usa período de liquidação/previsão.
- Saldos abertos/atrasados são posição atual, inclusive fora do período selecionado; não são uma reconstrução histórica de saldo.
- Filtro de situação usa situação atual da obrigação. Para histórico completo de reversões, usar todas as situações.
- Forma de pagamento filtra liquidações pelo meio efetivo. No previsto, filtra recebíveis pelo meio original; contas a pagar ainda sem meio definido ficam fora dessa seleção.
- Suprimentos/sangrias são transferências de tesouraria, não receitas/despesas; não entram no resultado. `Payment` e `CashMovement` não são somados novamente às liquidações.
- Resultado do período não é saldo bancário nem saldo físico do caixa. Não há saldo inicial bancário fictício.

Tabelas têm rolagem interna. Navegação e formulários funcionam no desktop/celular. Atalhos existentes de Contas a Pagar foram preservados; nenhum atalho global novo foi introduzido.

## Endpoints e permissões

- `GET /api/receivables/options`: opções autorizadas.
- `GET /api/receivables`: lista paginada (25), filtros e saldos.
- `GET /api/receivables/:id`: parcela, parcelas irmãs, liquidações e auditoria.
- `POST /api/receivables/:id/receipts`: baixa idempotente.
- `POST /api/receivables/:id/forecast`: previsão idempotente.
- `GET /api/finance`: consolidado realizado/previsto e série diária.

Permissões `receivables:read`, `receivables:receive`, `receivables:edit`, `finance:read`; Administrador, Gerente e Financeiro recebem os acessos. Estoque/Vendedor não recebem acesso financeiro indiscriminado. Tenant vem da sessão e filial é validada no backend em consulta e mutação. Chaves compostas impedem relacionamentos entre empresas.

## Limitações reais

- Sem banco, adquirente, TEF, CNAB, Open Finance, conciliação automática, emissão/consulta de boleto, fiscal ou credenciais reais.
- Sem taxas de cartão, antecipação, chargeback, renegociação, juros/descontos de recebíveis, edição de parcela original ou estorno avulso de uma baixa. Cancelamento parte da venda e preserva suas regras existentes.
- Registros legados sem venda/pagamento podem ser consultados, mas não baixados por este serviço; precisam de regularização analisada. Realizado exige liquidações comprováveis, não valores fictícios inferidos de registros incompletos.
- Consulta consolidada limitada a 366 dias e 10.000 registros selecionados/liquidações; listas também limitam o conjunto selecionado antes da paginação. Volumes maiores exigem evolução com agregação/paginação integral no banco.
- Sem exportação própria deste novo módulo; CSV anterior de Contas a Pagar e vendas permanece disponível.
- Navegação apresenta número/vínculo da venda e suas parcelas; não abre o PDV automaticamente. Dashboard gerencial anterior permanece preservado; a nova visão consolidada está em Financeiro → Fluxo de Caixa.
- Seleção entre empresas continua sendo a sessão da empresa, sem consolidação cruzada de tenants.

## Validação

27 testes novos de integração: dinheiro/PIX, débito, parcelamento exato, baixa total/parcial, excedente/zero, idempotência e colisão de conteúdo, concorrência, cancelamento sem/com baixa, corrida cancelamento/baixa, rollback da baixa e do cancelamento com estoque, empresas/filiais/perfis, fluxo realizado/previsto, Contas a Pagar, filtros, previsão, vencidos, retry da venda, datas e devolução/vale.

Percurso Playwright em desktop e celular usa API e PostgreSQL reais, testa baixa 40 + 60, histórico, filtros, previsão de despesas e resultado realizado, além de ausência de erros de página e overflow horizontal. Os resultados finais da regressão são informados no relatório da entrega.

Resultado final em 03/10/2026: 165/165 Vitest em 10 arquivos (138 anteriores + 27 novos); 18/18 Playwright (9 desktop + 9 mobile, preservando os 16 percursos anteriores). Lint, TypeScript, build API/web, Prettier, Prisma validate e diff-check aprovados. Desenvolvimento e testes com 10 migrations aplicadas, nenhuma pendente. Sem aumento de timeout ou testes desativados. Avisos não bloqueantes: depreciação do driver pg e importação dinâmica do catálogo já compartilhado com Estoque/PDV.
