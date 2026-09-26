# Livros e estoque por filial

Decisão: preservar Product e description como título comercial, adicionando metadados bibliográficos opcionais. Não converter nem apagar produtos antigos. ISBN-10 é validado e convertido ao ISBN-13 para resolução; ProductIdentifier impõe unicidade por empresa entre ISBN/EAN/SKU. Identificadores legados conflitantes interrompem a migration para revisão, sem excluir dados.

StockDocument representa entrada ou ajuste confirmado; seus itens guardam custo e título históricos. Não há rascunho persistido: a interface mantém a operação até a confirmação, que cria documento, itens, movimentos, saldo e auditoria numa transação. Chave UUID idempotente com hash do conteúdo impede repetição ou reutilização para outra operação.

Warehouse continua ligado a Branch. Membership.branchId restringe acesso à filial; null significa todas as filiais da empresa. Administrador mantém acesso à empresa inteira, mesmo se o vínculo legado indicar uma filial. Vínculos restritos não recebem dashboard financeiro consolidado nem administração global. Estoque é sempre por depósito, com agregação por filial. O modelo suporta mínimo/localização por depósito; a tela herda o cadastro quando não há valor específico. A edição desses parâmetros por depósito permanece futura. O total exibido respeita as filiais autorizadas.

Serviço backend reutilizável serializa mutações por depósito via advisory lock transacional PostgreSQL; transações de depósitos distintos são independentes. Ajuste usa contagem absoluta e saldo esperado para rejeitar contagem desatualizada. Movimentos novos têm saldos antes/depois e origem; movimentos antigos permanecem com esses campos nulos e são apresentados como legado, sem inventar histórico.

Não há integração bibliográfica real, pagamentos, vendas ou emissão fiscal nesta etapa. Não se altera custo global automaticamente: cada entrada guarda custo recebido, preservando a política comercial até definirmos custo médio.
