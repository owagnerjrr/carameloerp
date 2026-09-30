# Roadmap Caramelo ERP

## FASE 1 — Base + autenticação + multiempresa

Entregue nesta versão: monorepo, PostgreSQL/Prisma, empresas/filiais, sessões, RBAC, administração de usuários, auditoria, interface responsiva, dashboard, seed, testes e CI.

Evoluções da base: troca de senha, recuperação por canal verificado, MFA, gestão e provisionamento de empresas/filiais, convites com aceite, troca de empresa autorizada e permissões customizáveis. Revisar RLS como defesa adicional e testar migrações/restore.

## FASE 2 — Clientes + fornecedores + produtos

Clientes e livros possuem criação, edição, inativação, busca e paginação. Entregues metadados bibliográficos, ISBN-10/13 normalizados, índice de identificadores e leitura USB por teclado+Enter. Completar gestão de fornecedores/categorias/filiais, importação e tributação estruturada. Autores/editoras são textos nesta etapa; catálogo relacional editorial e API bibliográfica ficam para evolução.

## FASE 3 — Estoque

Entregues entradas de livros por leitor ou seleção manual, leitura repetida, resumo/confirmacão, saldos por depósito/filial, total autorizado da rede, consulta/filtros, histórico com origem/antes/depois/usuário, ajuste por contagem e motivo. Transações, rollback, idempotência e locks de depósito protegem as operações. Acesso pode ser restrito por filial.

Pendentes: saída avulsa (baixa por venda já entregue), transferências com trânsito/recebimento, inventário como documento completo, reposição avançada, edição de mínimo/localização específica por depósito, produtos parados, relatórios e lotes. A contagem para ajuste não substitui um módulo de inventário. Nenhuma alteração de saldo por edição direta de produto.

## FASE 4 — Vendas

Entregue PDV real: leitura ISBN/EAN/SKU+Enter, carrinho, cliente opcional/cadastro, descontos, dinheiro/troco, PIX manual, débito/crédito manual, parcelas, misto, confirmação atômica/idempotente com estoque e financeiro, histórico/detalhes e cancelamento com recomposição. Concorrência e rollback testados em PostgreSQL. Guia: [PDV.md](PDV.md).

Entregues nesta etapa: caixa por terminal/sessão, conferência, suprimento/sangria, trocas com diferença, devolução parcial, emissão de vale-crédito e consulta operacional com CSV. Guia: [CAIXA-TROCAS.md](CAIXA-TROCAS.md).

Consolidação entregue: resgate FIFO de vale no PDV, histórico e restauração, observações de caixa separadas, documentos normalizados e indicadores líquidos por data do evento.

Pendentes: orçamento e pedido operacionais, boleto/crediário/outras formas e impressão não fiscal. Integrações de pagamento dependem da fase 8.

## FASE 5 — Financeiro

Caixa operacional e conferência entregues. Evoluir contas a pagar/receber, baixa, parcelamento, recorrência, juros, multa, desconto, categorias, centros de custo, contas bancárias e caixa. Fluxo previsto/realizado, vencidos/futuros, conciliação e fechamentos.

## FASE 6 — Relatórios

Consulta operacional de vendas/itens/caixas/operadores/pagamentos/horários e CSV entregue. Evoluir central com filtros por período para vendas, itens vendidos, estoque/mínimo/movimentos, clientes, fornecedores, contas, caixa, receitas/despesas e lucro/margem. Exportação CSV/Excel/PDF, proteção contra fórmulas em CSV, filas para relatórios grandes e autorização por empresa.

## FASE 7 — Fiscal

Selecionar provedor homologado e validar requisitos com assessoria fiscal. Implementar adapter, homologação, idempotência, webhooks assinados e conciliação de status para NF-e, NFC-e, NFS-e, CT-e e MDF-e conforme escopo do provedor. NCM, CFOP, CST/CSOSN, ICMS, IPI, PIS e COFINS versionados. Certificados e senhas em cofre apropriado, nunca no código. Não há emissão real nesta versão.

## FASE 8 — Integrações

PIX, boleto, TEF, WhatsApp, e-commerce, delivery, APIs bancárias e contabilidade. Contratos por domínio, credenciais por tenant, webhooks verificados, idempotência, outbox, retry e rastreamento. Não apresentar mocks como integrações concluídas.

## FASE 9 — SaaS / planos / assinaturas

Provisionamento e onboarding, planos/limites, assinatura/cobrança, uso, isolamento reforçado, exportação/eliminação conforme política, observabilidade, backups e restauração, CI/CD, secrets manager, rate limit distribuído, retenção de auditoria, testes de carga e revisão de segurança/LGPD. Comercialização somente após esses critérios operacionais.

## Feiras / Eventos — bloco 1

Cadastro, envio com trânsito rastreável, conferência com divergências, retorno parcial e encerramento operacional. Reutiliza estoque existente; não inclui venda/caixa no evento. Guia: [EVENTOS.md](EVENTOS.md).

## Compras e fornecedores

Pedido, aprovação, recebimento parcial, scanner, divergências, custo médio, auditoria e reposição inicial: [COMPRAS.md](COMPRAS.md). Evoluções futuras: devolução ao fornecedor, contas a pagar integradas, importação fiscal/XML, integração com editoras e reposição considerando pedidos pendentes. Essas integrações não fazem parte deste bloco.
