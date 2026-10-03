# Financeiro — Contas a Pagar

## Decisão arquitetural (antes da implementação)

A auditoria confirmou FinancialEntry como registro existente de obrigações e recebíveis. Este bloco estende essa entidade: cada parcela é um FinancialEntry PAYABLE. FinancialObligation agrupa parcelas e identifica a origem; FinancialSettlement registra pagamentos administrativos, sem reutilizar Payment (que exige uma venda) ou movimentar o caixa do PDV. FinancialCategory é configurável por empresa. FinancialAction guarda idempotência e referência auditável. As obrigações de vale-crédito continuam controladas exclusivamente pelo serviço de créditos, sem acesso às ações deste módulo.

## Compras e recebimentos parciais

Criar, aprovar ou enviar um pedido não gera dívida. Um usuário autorizado confirma explicitamente o financeiro de cada recebimento positivo. O valor é exatamente PurchaseReceipt.total, incluindo custos e encargos reais daquela entrega; fornecedor e filial vêm do pedido. Uma constraint única por empresa/recebimento impede confirmação duplicada mesmo com outra requestKey. A entrega 6 + 4 gera duas confirmações dos respectivos valores, nunca duas cópias do total do pedido. Cancelamento financeiro não libera o recebimento para nova geração: o histórico e a referência são preservados. Retificação/reemissão exige etapa futura explícita.

## Regras operacionais

Parcelamento determinístico em centavos, com resíduo na última parcela e vencimentos explícitos crescentes. Pagamentos parciais preservam o valor original e registram cada baixa. Juros, multa e desconto são campos separados; ajustes e edição financeira ficam bloqueados após qualquer pagamento. Cancelamento exige motivo e saldo sem pagamentos. Vencida e parcial são situações calculadas; vencida usa data comercial America/Sao_Paulo.

Transações PostgreSQL com locks de idempotência, origem e obrigação protegem geração, edição, cancelamento e pagamento. Retry idêntico retorna a resposta anterior; payload diferente é rejeitado. Falhas devem reverter pagamento, saldo, ação e auditoria juntos. Permissões específicas de leitura, criação, edição, pagamento e cancelamento não são concedidas a Estoque/Vendedor. Categorias exigem permissão de edição.

## Limites do bloco

Pagamento é registro administrativo; não executa PIX/boleto/transferência nem baixa o caixa de vendas. Recorrência fica para etapa futura, com geração controlada e idempotente. Sem bancos reais, OFX, conciliação, fiscal, DRE completa, contas a receber avançadas, devolução ao fornecedor ou aprovação multinível. Registros legados sem grupo de obrigação continuam preservados e não recebem ações novas automaticamente.

## Models e migration

Migration `202610020001_payables` adiciona FinancialObligation, FinancialCategory, FinancialSettlement e FinancialAction. FinancialEntry recebe obrigação, juros, multa e desconto. Relações compostas por empresa e índices protegem a origem única por recebimento, a parcela dentro da obrigação e requestKey por empresa. A constraint antiga de saldo é ampliada apenas para títulos do novo módulo. Não há DROP de tabela, reset ou conversão de obrigações legadas. Categorias iniciais são inseridas para empresas existentes; novas empresas podem cadastrar categorias pelo módulo.

## Edição, cancelamento e datas

Qualquer pagamento em uma parcela bloqueia edição e cancelamento simples de toda a obrigação. Antes disso, contas manuais permitem corrigir valor original, vencimento e ajustes, com justificativa e valores anteriores/posteriores auditados. Parcelas de compra não permitem mudar seu valor original, pois representam o recebimento; juros/multa/desconto são explícitos. Vencimentos devem manter a ordem das parcelas. Cancelamento atua sobre a parcela selecionada, exige motivo e preserva todos os registros. Não há estorno de pagamento neste bloco. Desconto integral encerra o saldo sem inventar pagamento. A data comercial é America/Sao_Paulo; pagamentos futuros ou anteriores à emissão são rejeitados.

## API e permissões

- GET `/api/payables`, `/:id`, `/options`, `/indicators`, `/reports`, `/export`: `payables:read`.
- POST `/api/payables`: `payables:create`.
- POST `/api/payables/:id/payments`: `payables:pay`.
- POST `/api/payables/:id/edit` e `/api/payables/categories`: `payables:edit`.
- POST `/api/payables/:id/cancel`: `payables:cancel`.

Administrador, Gerente e Financeiro recebem as permissões; Estoque e Vendedor não. Empresa é determinada pela sessão, sem filtro que permita escolher outro tenant. Filial é limitada pelo vínculo do usuário. Acesso é revalidado em retries. Categorias são configuradas no backend por empresa, sem listas fixas de despesas no frontend.

Auditoria: PAYABLE_CREATED, PAYABLE_INSTALLMENTS_CREATED, PAYABLE_CREATED_FROM_PURCHASE, PAYABLE_UPDATED, PAYABLE_PAYMENT_REGISTERED, PAYABLE_CANCELLED e PAYABLE_CATEGORY_CREATED. Inclui ator, data, empresa, referências, valores, filial e justificativa conforme a operação. Pagamentos guardam meio, data, observação e referência administrativa.

## Consultas, dashboard e uso

Financeiro → Contas a Pagar. Filtros por filial autorizada, fornecedor, categoria, situação derivada, origem, emissão, vencimento, documento, texto e compra vinculada. Detalhes mostram parcelas, baixas, ajustes, responsável e auditoria. A navegação permite abrir a compra relacionada ou consultar/confirmar seus recebimentos pelo pedido. Indicadores separados no dashboard: em aberto, vencidas, próximos sete dias e pago no mês. Hoje e próximos sete dias nos indicadores não se sobrepõem (sete dias começa amanhã). Consultas rápidas de hoje/7/30 dias são alternativas de filtro, não agrupamentos somados.

Relatórios simples: fornecedor, categoria, filial, vencimentos, vencidas, pagamentos e vínculos de compras. O intervalo de vencimentos vira intervalo de pagamento na consulta de pagamentos. CSV exporta todas as parcelas filtradas com valores separados, situação, documento e origem, protegendo células contra fórmulas. Listagem paginada de 25; relatórios/exportação limitados a 10.000 registros, com erro explícito pedindo filtros quando excedido. Não há truncamento silencioso.

F2 abre nova conta, F4 foca pesquisa, F8 abre pagamento nos detalhes e Ctrl+Enter confirma o formulário. Listeners são removidos ao sair; os atalhos não alteram PDV ou Compras. Tabelas usam rolagem interna; formulários se adaptam ao celular.

## Validação

Testes específicos em `tests/payables.test.ts` e percurso real em `tests/payables.browser.spec.ts`, usando PostgreSQL separado de testes. Cobrem criação, 400+600, concorrência 500+500, idempotência, falha forçada, centavos 100/3, confirmação de compra 6+4, ajustes, isolamento e vencimento. Validação concluída em 03/10/2026: 22/22 testes específicos, 138/138 Vitest em nove arquivos e 16/16 Playwright (oito desktop e oito mobile). O percurso financeiro isolado também passou nos dois projetos. Nove migrations aplicadas nos bancos de desenvolvimento e testes, nenhuma pendente. Lint, TypeScript, build backend/frontend, Prettier e Prisma validate aprovados.

Na validação foram corrigidos o campo obrigatório minStock das fixtures novas e os nomes acessíveis dos selects financeiros. Uma execução da regressão mobile de Compras apresentou ERR_NO_BUFFER_SPACE do Chromium em uma consulta de ISBN; o banco estava sem transações penduradas ou bloqueadas. O percurso isolado e a repetição integral passaram sem mudança de scanner, timeout ou assertions.

## Próximas etapas explícitas

Renomear/inativar categorias (neste bloco há cadastro e seleção), recorrência com geração idempotente controlada, estorno e retificação financeira formal, edição de dados gerais após criação, aprovação multinível, relatórios assíncronos extensos e integração bancária/contábil ficam para etapas futuras. Sem automações fictícias ou cron externo neste bloco.
