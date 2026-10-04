# Transferências entre filiais

## Decisão arquitetural anterior à implementação

Reutilizar StockDocument/StockDocumentItem para todas as operações, StockMovement para contrapartidas e moveStock para qualquer alteração de saldo. StockTransfer acompanha origem/destino, responsável e lifecycle; StockTransferItem acompanha planejado, recebido e devolvido. Não é um estoque paralelo: saldos permanecem exclusivamente em StockBalance.

Cada transferência tem um Warehouse TRANSFER_TRANSIT exclusivo. Origem e destino são depósitos STANDARD de filiais diferentes da mesma empresa. Rascunho/preparação não reservam saldo; envio valida disponibilidade sob locks e debita origem/credita trânsito atomicamente. Recebimento debita trânsito/credita destino. Locks de depósitos são adquiridos em ordem estável.

Usuário restrito à origem pode criar/editar/preparar/enviar/cancelar antes do envio e confirmar retorno físico à origem. Usuário restrito ao destino pode receber e registrar divergências. Ambos podem consultar o documento; terceiros não. Destinos da empresa são listados para roteamento, sem conceder acesso ao estoque ou operação dessa filial. Autorizações específicas antecedem qualquer operação entre filiais dentro de moveStock.

Lifecycle: DRAFT → READY → IN_TRANSIT → PARTIALLY_RECEIVED → RECEIVED. Se houver retorno, encerramento usa CLOSED_RETURNED para não afirmar que tudo foi recebido. CANCELLED somente antes do envio. Retorno de saldo já recebido exige nova transferência inversa; retorno nesta transferência só consome saldo ainda em trânsito.

Recebimento menor exige motivo e preserva o pendente em trânsito. Excedentes/ISBN inesperado/dano podem ser registrados como divergência sem criar saldo. Excedente não pode ser incorporado por override: exige regularização física e novo envio autorizado da origem. Não haverá baixa silenciosa.

Idempotência usa StockDocument(companyId,requestKey), hash do comando e resposta do documento original. Cada par de movimentos usa o mesmo documento e transferGroup. Auditoria fica na mesma transação. Não inclui fiscal, transportadora, inventário ou integração externa.

## Models e migration

`StockTransfer` guarda número, estado, depósitos e responsável; `StockTransferItem` guarda quantidade planejada, recebida e retornada; `TransferDivergence` guarda código, tipo, esperado, observado e motivo vinculados ao documento. `StockDocument.transferId` relaciona os documentos operacionais. `Warehouse` recebe as relações de origem/destino/trânsito. Nenhuma tabela de saldo nova foi criada.

Migration: `202610030002_transfers`, aditiva, em transação. Relações compostas por empresa, unicidade de número e depósito de trânsito, índices de empresa/status/data e origem/destino. Checks de quantidade impedem recebido + retornado acima do planejado. Uma constraint trigger diferida exige duas contrapartidas `TRANSFER` de soma zero por produto/documento ao concluir a transação. As constraints anteriores de saldo não negativo e antes/depois permanecem.

## Lifecycle e operação

1. Criar rascunho com depósitos STANDARD de filiais distintas da empresa autenticada, responsável ativo autorizado na origem, livros ativos e quantidades inteiras positivas.
2. Editar rascunho preservando origem/destino. Cada edição cria novo StockDocument e snapshot dos itens, sem apagar snapshots anteriores.
3. Preparar bloqueia edição. Preparação não reserva estoque.
4. Enviar valida estoque sob lock; gera origem -Q / trânsito +Q, sem disponibilidade no destino.
5. Receber aceita apenas o conferido agora; gera trânsito -Q / destino +Q. Mostra enviado, recebido anteriormente e pendente. Quantidade superior ao pendente é rejeitada.
6. Quantidade menor que o pendente exige justificativa e gera divergência por item. Itens omitidos continuam pendentes. Recebimentos complementares consomem apenas o restante.
7. Origem confirma retorno físico do saldo ainda em trânsito, gerando trânsito -Q / origem +Q. Unidades já recebidas precisam de uma nova transferência inversa.
8. Encerramento automático quando recebido + retornado = enviado. Com retorno usa CLOSED_RETURNED; sem retorno usa RECEIVED. Encerradas bloqueiam novas operações, exceto retry exato de documento anterior.
9. Cancelamento somente em DRAFT/READY, com motivo, sem movimento artificial. Não há exclusão física de documentos.

Exemplos validados: 20 na origem, envio de 5 → 15 origem / 5 trânsito / 0 destino; recebimento 3 + 2 → 15 / 0 / 5. Envio 10, recebimento 9 → 1 em trânsito com justificativa. Envio 10, recebimento 8, retorno 2 → origem 12 / destino 8 / trânsito 0 a partir de origem 20.

## Divergências

Tipos MISSING, DAMAGED, WRONG, EXCESS e UNEXPECTED. Registros explícitos armazenam esperado/observado; diferença é observado - esperado. Ator/data e transferência ficam no StockDocument; enviado original e recebimentos anteriores permanecem nos snapshots e histórico. Recebimento parcial registra automaticamente o saldo faltante naquela conferência.

Registro de dano/excedente/produto diferente não altera estoque. Unidades não aceitas permanecem no fluxo de trânsito até conferência complementar ou retorno físico. Não existe baixa por perda nem autorização para fabricar saldo excedente. Excedente exige regularização física na origem e novo envio autorizado; não há integração externa para resolver divergências.

## Concorrência, idempotência e rollback

Transação usa, nesta ordem: lock da chave de requisição, lock da transferência e locks dos depósitos em ordem estável. `moveStock` usa os mesmos locks do Estoque/PDV, valida saldo e grava StockBalance/StockMovement. Assim envios de transferências diferentes disputam o saldo real da origem, e recebimentos sobre a mesma transferência não consomem duas vezes seu saldo em trânsito.

Movimento entre filiais exige documento TRANSFER_SEND/RECEIVE/RETURN, permissão correspondente, filial operadora correta, depósito da ponta correta e grupo igual ao documento. A liberação do escopo de filial ocorre apenas após essas verificações internas; operações comuns continuam rejeitando depósitos especiais.

StockDocument mantém chave única por empresa e hash normalizado do comando. Retry exato retorna o documento anterior; conteúdo divergente é rejeitado. Documentos, contadores, dois movimentos e auditoria são atômicos. Testes reais no PostgreSQL forçam falha depois do débito e antes da contrapartida, verificando que nenhum saldo, documento ou auditoria parcial permanece.

## Permissões e isolamento

- `transfers:read`: listar/detalhar apenas transferências nas quais a filial participa.
- `transfers:create`: criar/editar na origem.
- `transfers:send`: preparar/enviar na origem.
- `transfers:receive`: conferir/receber/registrar divergência no destino.
- `transfers:cancel`: cancelar antes do envio na origem.
- `transfers:return`: confirmar retorno físico na origem.

Administrador/Gerente/Estoque recebem as permissões por padrão, mantendo a restrição de filial vigente. Um operador de origem não recebe pelo destino; operador do destino não envia nem confirma retorno na origem. Terceira filial e outra empresa não consultam detalhes. Empresa é a sessão autenticada, não um ID arbitrário do frontend. A lista de destinos exibe apenas nomes/IDs para roteamento e não libera consulta ao estoque de outra filial.

## Interface, consultas e auditoria

Acesso em Estoque → Transferências entre filiais e menu Transferências. Filtros por número, depósitos de origem/destino (identificados pela filial), data comercial, responsável, status, livro/ISBN/código. Indicadores de preparação, trânsito, parcial, conclusão e documentos com divergências. Lista paginada em 25 registros.

Scanner usa `useBarcodeReader` (fila de leituras) e `addScanned`, compartilhados com os módulos anteriores. ISBN/EAN/SKU + Enter busca o identificador no backend e incrementa a mesma linha. Busca manual e edição de quantidades estão disponíveis. Conferência começa com zero para exigir contagem explícita; não presume recebimento completo.

Atalhos locais: F2 nova transferência; F4 foco no leitor do formulário; F8 receber documento aberto quando permitido; Ctrl+Enter confirmar formulário quando não há leituras pendentes. Tabelas possuem rolagem interna e formulários funcionam no celular.

Documentos e auditoria registram criação, edição, preparação, envio, recebimento, parcial, divergência, retorno, cancelamento e encerramento; armazenam ator, data, empresa, filiais, documento, estado e itens. Cada movimento aponta StockDocument e transferGroup. Histórico comum do estoque continua exibindo o documento da transferência.

Endpoints: GET `/api/transfers/options`, `/api/transfers/books`, `/api/transfers`, `/api/transfers/:id`; POST `/api/transfers`; POST `/api/transfers/:id/{edit,prepare,send,receive,return,cancel,divergence}`.

## Integração e limitações

- Catálogo, alerta de estoque baixo, estoque comum, compras e PDV já selecionam depósitos STANDARD; trânsito não passa a ser disponibilidade de nenhuma loja. Estoque de evento permanece separado. A visão por transferência mostra seu trânsito sem alterar o significado das métricas anteriores.
- Sem reserva na preparação, divisão de uma transferência entre vários depósitos, desfazer preparação, edição após envio, exclusão histórica, perda/quebra automática ou incorporação de excedente. Cancelar e criar novo rascunho é o caminho após preparação incorreta.
- Quantidades inteiras para livros/produtos unitários; sem fracionamento, lote ou série neste módulo. Não altera custo médio: é movimentação interna da mesma empresa.
- Divergências são histórico permanente; pendências quantitativas se encerram por recebimento/retorno. O indicador "Com divergência" representa existência histórica, não uma fila separada de resolução.
- Sem transferência entre empresas, estoque paralelo, NF-e/NFC-e/CT-e/MDF-e, transportadora, rastreamento externo, EDI, bancos, TEF, PIX API, devolução a fornecedor ou inventário completo.
- Sem impressão/exportação própria e sem aprovação multinível. Responsáveis com vínculo a outra filial não podem ser escolhidos como responsáveis da origem.

## Validação final — 03/10/2026

33 testes novos; regressão Vitest 198/198 em 11 arquivos, preservando os 165 anteriores. Playwright 20/20 (10 desktop e 10 mobile), preservando os 18 percursos anteriores; percurso isolado de Transferências também aprovado em 2/2. Inclui envio/recebimento concorrente, recebimento parcial concorrente, retries, payload divergente, rollback nas duas pontas, isolamento, permissão, scanner 5x, contrapartidas e bloqueio de operação encerrada.

Lint, TypeScript, Prettier, builds API/web, Prisma validate e git diff --check aprovados. Desenvolvimento e testes com 11 migrations aplicadas e nenhuma pendente. Sem alteração de timeouts existentes, testes desativados ou assertions enfraquecidas. Avisos não bloqueantes existentes: depreciação do driver pg e importação dinâmica do catálogo já compartilhado com Estoque/PDV.
