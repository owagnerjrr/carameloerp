# Compras e fornecedores

## Decisões de arquitetura

O módulo evolui Supplier e reutiliza StockDocument, StockDocumentItem e moveStock. PurchaseOrder guarda o pedido, PurchaseOrderItem seus itens, PurchaseReceipt liga cada conferência a um StockDocument, PurchaseReceiptItem preserva os custos e PurchaseDivergence registra ocorrências. As relações usam empresa + identificador. Nenhum estoque paralelo é criado.

Lifecycle: DRAFT → PENDING → APPROVED → ORDERED → PARTIALLY_RECEIVED → RECEIVED. Somente rascunhos são editáveis. Cancelar antes da conclusão exige motivo e encerra apenas o saldo pendente; quantidades recebidas permanecem no estoque. Recebimento começa em ORDERED. Aprovação e envio são ações explícitas e auditadas; envio não transmite mensagens ao fornecedor.

## Custo e valores

Decisão registrada antes da implementação: Product.cost já é um valor global da empresa em Decimal(14,2). Os novos recebimentos calculam média ponderada global, incluindo todos os depósitos (também eventos e trânsito, pois continuam propriedade da empresa). Dez unidades a 40 mais dez a 50 resultam em 45. O cálculo usa Prisma.Decimal, arredondamento half-up de duas casas somente no custo final; valores monetários trafegam como strings. Custos históricos de vendas e entradas anteriores permanecem imutáveis. Entradas comuns mantêm seu comportamento anterior.

O desconto do pedido é unitário por item; subtotal bruto, desconto total, frete e despesas são calculados no servidor. O recebimento informa custo unitário real líquido e encargos reais daquela entrega; os encargos são rateados por quantidade, com o último item absorvendo centavos residuais. Frete/despesas do pedido são previsão e não são cobrados automaticamente a cada entrega. Custos dos recebimentos ficam preservados, incluindo custo anterior e posterior do produto. Não há contas a pagar ou lançamentos bancários neste bloco.

## Concorrência, segurança e rastreabilidade

Recebimentos usam uma transação PostgreSQL para validação, documento, itens, estoque, custo, quantidades acumuladas, status e auditoria. Ordem de locks: chave idempotente, pedido, depósitos da empresa em ordem de ID, produtos em ordem de ID. A trava dos depósitos existentes permite calcular o custo global sem disputar saldos com vendas/eventos. Isso serializa recebimentos e movimentações durante a breve confirmação; é uma escolha conservadora compatível com o estoque atual.

Mesmo requestKey e conteúdo retornam o resultado anterior; conteúdo diferente é rejeitado. Acesso ao pedido é validado antes do retry. A filial do depósito deve corresponder à filial do pedido e o depósito deve ser STANDARD. Empresa, filial e permissões são validadas no backend. Excedentes exigem permissão específica e justificativa; produtos não solicitados/danificados/edição ou ISBN divergente são registrados como ocorrências e não entram silenciosamente no estoque vendável.

## Limites deliberados

Os pedidos comportam até 100 títulos, com até 100.000 unidades por item. Listagens de pedidos têm páginas de 25; reposição e histórico de custos, 50; pesquisa de livros, 30 resultados. O mínimo da filial é a soma dos mínimos por depósito comum (override StockBalance.minStock ou Product.minStock por depósito). Sugestões são preliminares: não descontam pedidos em aberto nem combinam automaticamente fornecedores. A filial é escolhida explicitamente ao gerar o pedido.

Sem emissão/importação fiscal, EDI, mensagens automáticas, devolução ao fornecedor, contas a pagar completas ou previsão por IA. Não há aprovação multinível. Reposição considera apenas depósitos comuns da filial; sugere max(1, mínimo − saldo), arredondado para unidades inteiras. Divergências não representam estoque de quarentena. Recebimentos confirmados não são editados/apagados. Scanner usa teclado + Enter; a validação automatizada não certifica um aparelho físico.

## Uso e atalhos

Menu Compras: Pedidos, Recebimentos, Fornecedores e Reposição. Novo pedido permite ISBN/EAN/código interno exato pelo scanner ou busca por título, autor e editora. Na conferência, cada leitura incrementa uma única linha; ISBN não solicitado apresenta erro e permite registrar ocorrência para um produto cadastrado. Recebimento parcial não implica falta definitiva: registre uma divergência quando a situação exigir histórico. O sistema não presume devolução ou perda.

- F2: novo pedido, na área de Compras fora de modais e do cadastro de fornecedores.
- F4: foco no leitor do editor/conferência.
- F8: abrir recebimento do pedido selecionado quando permitido.
- Ctrl+Enter: salvar pedido ou confirmar conferência; respeita campos obrigatórios, leituras pendentes e autorização.

Os atalhos são removidos ao sair da tela. Não atuam sobre o PDV. A interface preserva requestKey em tentativas após falha; alterar o conteúdo cria outra operação. Confirmações bem-sucedidas aparecem nos detalhes do pedido.

## Permissões e API

Administrador e Gerente recebem todas as permissões de Compras/Fornecedores. Estoque recebe visualização de compras/fornecedores e recebimento; não aprova nem aceita excedentes. Perfis customizados não recebem novas permissões automaticamente. Todas as rotas requerem sessão e validação Zod; mutações verificam a origem HTTP.

| Rotas                                                                     | Permissão                        |
| ------------------------------------------------------------------------- | -------------------------------- |
| GET /api/suppliers                                                        | suppliers:read                   |
| POST /api/suppliers; PUT /api/suppliers/:id                               | suppliers:write                  |
| GET /api/purchases, /:id, /options, /books, /replenishment, /cost-history | purchases:read                   |
| POST /api/purchases                                                       | purchases:create                 |
| PUT /api/purchases/:id                                                    | purchases:edit                   |
| POST /api/purchases/:id/state (SUBMIT, ORDER)                             | purchases:edit                   |
| POST /api/purchases/:id/state (APPROVE)                                   | purchases:approve                |
| POST /api/purchases/:id/state (CANCEL)                                    | purchases:cancel                 |
| POST /api/purchases/:id/receipts                                          | purchases:receive                |
| Recebimento acima do saldo pendente                                       | também purchases:excess e motivo |

Filtros de pedidos: filial, fornecedor, comprador, data inicial/final do pedido, status/atrasados, número e texto do livro/ISBN/autor/editora. Atraso significa previsão anterior à data corrente UTC, para pedidos enviados ou parcialmente recebidos. Histórico de preços exige productId e retorna quantidade, custo líquido, encargos, custo médio anterior/posterior, fornecedor, pedido, filial, data e usuário do recebimento.

## Banco e auditoria

Migration `202609290002_purchases`: seis entidades novas (PurchaseOrder, PurchaseOrderItem, PurchaseReceipt, PurchaseReceiptItem, PurchaseDivergence, PurchaseAction), campos adicionais em Supplier, relações compostas por empresa, índices, checks monetários/quantidades/status e permissões. Fornecedores existentes são preservados; documentos são normalizados e a migration aborta se a normalização criar duplicatas. Nenhum segredo ou certificado é incluído.

PurchaseAction guarda a resposta idempotente e o histórico do ator. AuditLog registra PURCHASE_ORDER_CREATED, PURCHASE_ORDER_UPDATED, PURCHASE_ORDER_SUBMITTED, PURCHASE_ORDER_APPROVED, PURCHASE_ORDER_ORDERED, PURCHASE_ORDER_CANCELLED, PURCHASE_RECEIVED e PURCHASE_DIVERGENCE_RECORDED. Metadata inclui pedido, filial, fornecedor, status, recebimento e justificativas; credenciais não são registradas. As divergências herdam usuário/data do StockDocument de recebimento.
