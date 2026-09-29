# Feiras / Eventos — bloco 1

## Operação

1. Em **Feiras / Eventos**, crie o cadastro com filial, responsável ativo, período e localização. O sistema atribui FEIRA-ANO-00001 e cria localizações exclusivas EVENT e EVENT_TRANSIT.
2. **Iniciar preparação** libera envios. A preparação não reserva livros: o saldo real é conferido no envio.
3. Em **Envios → Enviar livros**, escolha um depósito comum da mesma filial. Leia ISBN/EAN/SKU + Enter, ou pesquise título, autor, editora ou ISBN. Repetições acumulam na mesma linha. Revise quantidades e confirme.
4. O documento ENV registra operador, origem, livros e quantidades. A origem diminui e o trânsito aumenta na mesma transação. O estoque físico do evento ainda não aumenta.
5. **Conferir recebimento** informa quanto chegou de cada livro. Um REC registra operador, horário, quantidade esperada, conferida e observação. Uma falta exige justificativa de pelo menos oito caracteres. Exemplo: 10 enviados, 9 conferidos, diferença -1; 1 permanece em trânsito. Uma conferência complementar pode receber o restante, preservando a divergência original.
6. Em **Estoque**, pesquise título, ISBN, autor ou editora. Consulte enviado, recebido, retornado, atual e trânsito. **Resumo** mostra títulos físicos, unidades enviadas, recebidas, retornadas, atuais e em trânsito.
7. Em **Retornos**, use o mesmo leitor e revise antes de confirmar. RET transfere livros físicos do evento para um depósito comum da mesma filial. Retorno parcial é permitido e inicia CLOSING, bloqueando novos envios.
8. **Encerrar evento** exige estoque físico zero, trânsito zero e todos os envios recebidos. Não existe encerramento financeiro neste bloco. Cancelamento só é permitido antes do primeiro envio, com justificativa.

A confirmação é feita por operador com events:stock e acesso à filial. O responsável designado fica no cadastro/auditoria e não ganha acesso automaticamente. Estoque de eventos não pode ser vendido pelo PDV comum nem alterado por entrada/ajuste comum. Catálogo e disponibilidade da filial consideram apenas STANDARD. Movimentos continuam consultáveis pelo histórico de estoque, identificados pelos códigos dos documentos.

## Lifecycle

DRAFT → PREPARING → IN_TRANSIT → OPEN → CLOSING → CLOSED. DRAFT/PREPARING podem ser CANCELLED. Primeiro recebimento positivo abre o evento; recebimentos complementares continuam permitidos em CLOSING. Cadastro pode ser editado em DRAFT/PREPARING, sem mudar filial. Estados terminais rejeitam novas operações; retry de uma operação já confirmada retorna o documento original.

## Backend, banco e proteção

Models novos: Event, EventDocument e EventDocumentItem. Warehouse recebe kind; StockMovement recebe eventDocumentId. Relações inversas em Company, Branch, Membership e Product. StockBalance é reutilizado sem novo controle paralelo.

Migration: 202609290001_events, aditiva e transacional. Mantém depósitos antigos STANDARD. FKs compostas por empresa; unicidade de código, requestKey, livro por documento e movimento por documento/local/livro; índice de eventos por empresa/filial/status/data e documentos por evento/data. Constraints validam datas, estados, locais diferentes e quantidades. Novas permissões são atribuídas aos perfis padrão existentes e ao seed por contratos compartilhados.

services/events.ts coordena serviços existentes de estoque. Ordem de locks: requisição, evento, depósitos ordenados, numeração. Consumo de estoque não pode ficar negativo. RequestKey + hash impedem duplicação e reutilização com conteúdo divergente. Uma falha desfaz documentos, status, ambos os saldos, movimentos e auditoria. Leituras do detalhe usam snapshot transacional consistente. Autorizações são avaliadas no backend, sem confiar nos IDs enviados pela tela.

Permissões: Administrador/Gerente têm events:read/create/manage/stock; Estoque tem read/stock; demais perfis não recebem acesso automático. O escopo de empresa/filial continua obrigatório para todos os perfis.

Auditoria: EVENT_CREATED, EVENT_UPDATED, EVENT_PREPARING, EVENT_DISPATCHED, EVENT_RECEIVED, EVENT_RETURNED, EVENT_CLOSING, EVENT_CLOSED e EVENT_CANCELLED. Guarda empresa, operador, data, filial, evento, documento, responsável, locais e itens/quantidades; cadastro inicial e alterações preservam os campos no metadata. Documentos preservam motivos e identificação bibliográfica.

## Endpoints relativos a /api

| Método | Rota                   | Permissão     |
| ------ | ---------------------- | ------------- |
| GET    | /events                | events:read   |
| GET    | /events/options        | events:read   |
| GET    | /events/books          | events:read   |
| GET    | /events/:id            | events:read   |
| POST   | /events                | events:create |
| PUT    | /events/:id            | events:manage |
| POST   | /events/:id/state      | events:manage |
| POST   | /events/:id/dispatches | events:stock  |
| POST   | /events/:id/receipts   | events:stock  |
| POST   | /events/:id/returns    | events:stock  |

GET /events aceita view ACTIVE/UPCOMING/CLOSED, q e page. Books aceita q ou code exato. Todas as mutações exigem requestKey UUID. Transferências do evento só usam depósitos STANDARD da mesma filial.

## Limites deste bloco

- Sem reserva persistente de separação; rascunho de leitura fica na tela até confirmar.
- Retorno tem confirmação única, sem uma segunda viagem de trânsito/recebimento na filial.
- Faltas ficam em trânsito até conferência complementar. Não existe baixa de extravio, indenização ou ajuste de excedente; tais ocorrências mantêm pendência e impedem encerramento, sem inventar recebimento físico.
- Sem exclusão, reabertura ou estorno de documentos confirmados. Corrigir envio efetivo requer recebimento e retorno rastreáveis; cadastro é editável apenas antes de operar.
- Consulta de eventos: 25 por página; busca de livros: 30 resultados; operação: até 200 títulos, quantidades inteiras de 1 a 100.000. Detalhe rejeita mais de 5.000 documentos em vez de truncar silenciosamente. Numeração limita 99.999 por prefixo/ano/empresa.
- Sem impressão/PDF, exportação de eventos, vendas, caixa, pagamentos, ofertas ou fechamento financeiro de evento. Fiscal, TEF, PIX automático, compras e transferências comuns entre filiais não foram implementados.
- Leitor testado como teclado com Enter. O teste automatizado não certifica um modelo físico específico.
