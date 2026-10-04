# Inventário físico — decisão arquitetural

Módulo de inventário físico implementado sobre a infraestrutura existente de
estoque. Validação completa aprovada em 04/10/2026.

## Infraestrutura existente

O inventário utilizará `StockBalance`, `StockDocument`, `StockDocumentItem`,
`StockMovement`, `moveStock` e o lock transacional por empresa/depósito.
Nenhum saldo poderá ser atualizado diretamente pelo módulo. Empresa e filial
serão obtidas da sessão e verificadas no backend. Somente depósitos `STANDARD`
poderão participar.

## Referência histórica e momento da contagem

O snapshot será congelado em START, sob o mesmo lock usado pelas operações
normais de estoque. Salvar um rascunho não congelará o saldo. O custo de referência
também deverá ser preservado para o relatório histórico.

É necessário preservar duas referências distintas: o saldo no START e o saldo
de referência da rodada de contagem do item. A quantidade física representa o
momento da rodada, não necessariamente o início do inventário inteiro.

Na primeira leitura/contagem de uma rodada, o backend deverá registrar o saldo
do item e uma referência estável aos movimentos já efetivados. Se houver qualquer
movimento desse item durante a rodada, a rodada não poderá ser aceita como uma
contagem consistente: será necessária nova conferência. Comparar apenas o saldo
não basta, pois saída e entrada podem se compensar.

Ao concluir a rodada, sob lock do depósito, validar que nenhuma movimentação
interferiu entre a abertura e a conclusão da rodada. Após a conclusão, novas
operações normais poderão continuar. A correção aceita será:

`diferença = físico aceito - saldo de referência da rodada`

Ao fechar, novamente sob lock, aplicar essa diferença ao saldo atual utilizando
`moveStock`. Movimentos legítimos posteriores à contagem serão preservados.
Não atribuir `StockBalance.quantity = countedQuantity`.

Exemplos obrigatórios para os testes:

- Snapshot 10, contagem aceita 9 com referência 10: diferença -1.
- Snapshot 10, venda de 1 antes da rodada, físico 9 com referência 9: diferença 0.
- Rodada aceita com referência 10/físico 9, venda posterior de 1: saldo atual 9,
  ajuste -1, saldo final 8; a venda continua registrada.
- Venda durante uma rodada aberta: exigir nova conferência, sem ajuste automático.
- Se movimentos posteriores tornarem uma diferença negativa inaplicável,
  rejeitar o fechamento inteiro, sem estoque negativo, e exigir revisão formal.

Essa política depende de confirmação explícita da rodada pelo operador; leituras
de scanner em andamento não representam contagem final. Os testes devem cobrir
concorrência real, inclusive movimentos compensatórios e ordem dos locks.

## Contagem e revisão

Quantidade não contada será nula; zero confirmado será zero. Cada rodada deverá
preservar operador, origem scanner/manual, quantidade, observação e timestamps.
Recontagem criará outra rodada sem apagar a primeira.

Contagem cega deverá ser protegida pelo retorno da API: esconder saldo,
diferenças, valores de custo e rodadas anteriores de operadores sem autorização
de revisão. A mesma proteção deverá abranger listagem, indicadores, histórico e
exportação, e não apenas a tela principal.

Todas as diferenças precisarão de motivo antes da aprovação; OTHER exigirá
descrição. Não será criado limite monetário arbitrário. Avaria será ocorrência
documentada, sem criação automática de depósito ou baixa adicional.

## Fechamento e segurança

O fechamento deverá reunir documento, itens, movimentos, estado do inventário e
auditoria em uma única transação PostgreSQL. Diferença zero não gerará movimento.
Falha intermediária deverá reverter tudo. Documento e auditoria devem permitir
identificar inventário, item, rodada aprovada, motivo e ator.

Operações críticas utilizarão chave idempotente e hash do conteúdo, seguindo os
padrões existentes. Retry idêntico devolverá a operação original; conteúdo
diferente com a mesma chave será rejeitado. A autorização deverá ser revalidada
também no retry.

Permissões: `inventory:read`, `inventory:create`, `inventory:count`,
`inventory:review`, `inventory:approve`, `inventory:close`, `inventory:cancel`.
Estoque poderá contar; aprovação/fechamento ficarão com perfis autorizados.

## Modelo e lifecycle

`Inventory` vincula empresa, filial, depósito, responsável, tipo, configuração
cega, datas e aprovador. `InventoryItem` preserva título, ISBN, SKU, saldo inicial
e custo. `InventoryCount` guarda uma linha por item/rodada, quantidade física,
saldo de referência da rodada, número de movimentos, operador, origem e datas.
`InventoryAction` mantém chave, hash e resultado idempotente. `StockDocument`
ganha referência ao inventário; os movimentos apontam para esse documento e para
o produto. O motivo do movimento inclui ID do item e número da rodada.

Migration aditiva: `202610040001_inventory`. Constraints protegem estados,
quantidades não negativas, rodadas, origem scanner/manual, depósito comum e
relações compostas por empresa. Índice parcial admite somente um inventário ativo
por depósito, evitando ajustes duplos de contagens sobrepostas.

Fluxo: DRAFT → COUNTING → UNDER_REVIEW → APPROVED → CLOSED. Uma solicitação
de recontagem leva UNDER_REVIEW/APPROVED a RECOUNT_REQUIRED, revoga a aprovação
e abre nova rodada nos itens escolhidos. Os demais permanecem aceitos. COMPLETE
valida todas as rodadas abertas e devolve o inventário para revisão.

RESTART permite ao contador abandonar uma rodada aberta inconsistente, com
motivo, preservando-a historicamente. Uma rodada já aceita exige RECOUNT por
revisor. CANCEL exige motivo com oito caracteres, preserva histórico e nunca
movimenta estoque. CLOSED não aceita edição/cancelamento. Retry idêntico de uma
operação anterior continua retornando seu resultado original.

## Escopo e operação

O inventário completo inclui todos os produtos cadastrados na empresa no START,
inclusive inativos e produtos com saldo zero no depósito. Assim, um livro conhecido
fisicamente encontrado com sistema zero pode gerar sobra formal. O parcial usa
IDs selecionados no rascunho. Busca aceita título, autor, editora, categoria,
localização cadastral, ISBN e SKU. Leitura exata reutiliza ProductIdentifier.

O escopo fica fechado após START: novos cadastros posteriores exigem outro
inventário. Essa restrição evita reconstruir um snapshot inexistente. Nenhuma
leitura inclui produto fora do escopo silenciosamente.

ADD acumula leitura; SET confirma quantidade manual, inclusive zero. Rodadas são
serializadas pelo lock do inventário, e a captura do saldo/movimentos usa também
o lock do depósito. START insere o snapshot em lotes; nenhum saldo é alterado.
COUNT registra valores anterior/novo em auditoria com ator e rodada. Não existe
uma linha de contagem por exemplar: leituras atualizam a rodada atual, enquanto
as operações auditadas preservam as alterações.

COMPLETE exige todos os itens explicitamente contados, inclusive os zerados.
Uma venda e seu cancelamento durante a rodada também a invalidam, mesmo que o
saldo volte ao mesmo valor. APPROVE exige rodada aceita e justificativa para
diferença em relação ao snapshot inicial ou à referência da rodada. OTHER exige
descrição; não há limite monetário automático de aprovação.

## Ajuste, locking e relatório

Ordem dos locks: chave da operação → inventário → depósito; START/CREATE também
serializam a numeração quando necessário. Todas as operações normais de estoque
continuam usando o mesmo lock de depósito em `moveStock`. Não são bloqueadas
durante todo o período de contagem.

CLOSE usa documento INVENTORY_ADJUSTMENT e somente diferenças efetivas não
zeradas. StockDocumentItem congela custo e quantidade de ajuste; StockMovement
guarda saldo anterior/posterior, motivo, ator e vínculo. Se o saldo atual não
comportar uma diferença negativa, todo fechamento é rejeitado; solicitar
recontagem pelo revisor para resolver a situação.

A revisão distingue diferença em relação ao snapshot inicial de ajuste efetivo
da rodada. O impacto de custo usa o ajuste efetivo e o custo congelado, sem
reescrever custo médio. O relatório mostra faltas/sobras da comparação inicial,
rodadas, operadores, aprovador, datas, movimentos e auditoria.

CSV reutiliza `csvCell` do projeto, com escaping e proteção contra fórmulas.
Exporta número, filial, depósito, livro, ISBN, SKU, sistema inicial, referência da
rodada, físico, diferenças, custo, rodada, operador, motivo e observação.
Exige revisão no backend, inclusive em inventários fechados. Operadores cegos
recebem somente a rodada atual e não recebem custo, referência, diferenças,
documentos de ajuste, auditoria ou indicador agregado de divergência.

## API e interface

- GET `/api/inventory/options`, `/books`, `/api/inventory`.
- GET `/api/inventory/:id`, `/api/inventory/:id/export`.
- POST `/api/inventory` (criação).
- POST `/api/inventory/:id/edit`, `/start`, `/count`, `/complete`, `/restart`,
  `/recount`, `/justify`, `/approve`, `/close`, `/cancel`.

Todas as operações usam a sessão para empresa/filial e validam permissão no
backend; requisições Zod são estritas. O contrato COUNT usa código ou produto,
ADD/SET, quantidade inteira e origem SCANNER/MANUAL.

Menu Inventários e acesso por Estoque → Inventários. Listagem paginada com filtros
de número, filial, depósito, status, responsável e período. Indicadores de andamento,
revisão, finalizados e divergências (este último somente para revisores).
Contagem mostra títulos, unidades e progresso separadamente. Revisão filtra
faltas, sobras, não contados, recontagem, sem justificativa e rodadas aceitas.
Tabelas possuem rolagem interna para não transbordar a página no celular.

Atalhos locais: F2 novo inventário na lista; F4 leitor ou pesquisa; F8 divergências
quando autorizado; Ctrl+Enter concluir contagem sem operação/leitura pendente.
Recarregar a página perde apenas o formulário ainda não salvo; contagens salvas
permanecem no PostgreSQL.

## Limitações e próximos passos

- Quantidades físicas inteiras; sem lotes, séries ou inventário fracionário.
- Um inventário ativo por depósito; não há sobreposição de escopos simultâneos.
- O depósito é fixado ao salvar o rascunho; para mudar o depósito, cancelar e
  criar outro inventário. Descrição, responsável, configuração cega e escopo
  permanecem editáveis antes do início.
- Novos cadastros após START não entram neste snapshot; usar outro inventário.
- A referência temporal depende da confirmação física correta do operador;
  movimentação durante rodada exige nova conferência.
- Uma rodada é agregada: seu operador corrente é o último a alterá-la; auditoria
  mantém os atores anteriores. Não há designação exclusiva por item.
- Não há alçada monetária, dupla aprovação obrigatória ou agenda automática.
- Não há reversão de inventário fechado, PDF, depósito de avarias ou integração
  externa. Reversão futura deverá ser outro documento formal.
- CSV contém a rodada atual; histórico completo de rodadas permanece na consulta.

## Validação deste bloco

- 41 testes específicos de Inventário sobre PostgreSQL real.
- Vitest completo: 239 testes em 12 arquivos, preservando os 198 anteriores.
- Playwright completo: 22 percursos, 11 desktop e 11 mobile; preservados os 20
  anteriores. O percurso novo inclui scanner 5x, zero, recontagem 5→4,
  justificativas, aprovação, fechamento, filtro/histórico e consulta ao banco.
- Cenário numérico: 10/5/8 permanece até fechar; depois 9/7/8, com -1/+2/nenhum.
- Concorrência de contagem e fechamento, venda concorrente, movimentos antes/
  durante/depois da rodada, compensação venda/cancelamento, rollback no segundo
  ajuste, isolamento, permissões, contagem cega, CSV e idempotência cobertos.
- Lint, TypeScript, builds API/web, Prettier e Prisma validate aprovados.
- 12 migrations aplicadas, sem pendências em desenvolvimento e testes.
- Nenhum timeout aumentado, teste desativado ou mock substituindo o fluxo real.
