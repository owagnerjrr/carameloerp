# Roadmap Caramelo ERP

## FASE 1 — Base + autenticação + multiempresa

Entregue nesta versão: monorepo, PostgreSQL/Prisma, empresas/filiais, sessões, RBAC, administração de usuários, auditoria, interface responsiva, dashboard, seed, testes e CI.

Evoluções da base: troca de senha, recuperação por canal verificado, MFA, gestão e provisionamento de empresas/filiais, convites com aceite, troca de empresa autorizada e permissões customizáveis. Revisar RLS como defesa adicional e testar migrações/restore.

## FASE 2 — Clientes + fornecedores + produtos

Clientes e livros possuem criação, edição, inativação, busca e paginação. Entregues metadados bibliográficos, ISBN-10/13 normalizados, índice de identificadores e leitura USB por teclado+Enter. Completar gestão de fornecedores/categorias/filiais, importação e tributação estruturada. Autores/editoras são textos nesta etapa; catálogo relacional editorial e API bibliográfica ficam para evolução.

## FASE 3 — Estoque

Entregues entradas de livros por leitor ou seleção manual, leitura repetida, resumo/confirmacão, saldos por depósito/filial, total autorizado da rede, consulta/filtros, histórico com origem/antes/depois/usuário, ajuste por contagem e motivo. Transações, rollback, idempotência e locks de depósito protegem as operações. Acesso pode ser restrito por filial.

Pendentes: saída operacional, transferências com trânsito/recebimento, inventário como documento completo, reposição avançada, edição de mínimo/localização específica por depósito, produtos parados, relatórios e lotes. A contagem para ajuste não substitui um módulo de inventário. Nenhuma alteração de saldo por edição direta de produto.

## FASE 4 — Vendas

Orçamentos, pedidos, venda concluída, descontos, clientes, vendedores, formas de pagamento, cancelamentos e devoluções. Conclusão atômica e idempotente com estoque e financeiro. Pagamentos em dinheiro, PIX, débito/crédito, boleto, crediário e outros, sem confundir registro de pagamento com integração bancária real.

## FASE 5 — Financeiro

Contas a pagar/receber, baixa, parcelamento, recorrência, juros, multa, desconto, categorias, centros de custo, contas bancárias e caixa. Fluxo previsto/realizado, vencidos/futuros, conciliação e fechamentos.

## FASE 6 — Relatórios

Central com filtros por período para vendas, itens vendidos, estoque/mínimo/movimentos, clientes, fornecedores, contas, caixa, receitas/despesas e lucro/margem. Exportação CSV/Excel/PDF, proteção contra fórmulas em CSV, filas para relatórios grandes e autorização por empresa.

## FASE 7 — Fiscal

Selecionar provedor homologado e validar requisitos com assessoria fiscal. Implementar adapter, homologação, idempotência, webhooks assinados e conciliação de status para NF-e, NFC-e, NFS-e, CT-e e MDF-e conforme escopo do provedor. NCM, CFOP, CST/CSOSN, ICMS, IPI, PIS e COFINS versionados. Certificados e senhas em cofre apropriado, nunca no código. Não há emissão real nesta versão.

## FASE 8 — Integrações

PIX, boleto, TEF, WhatsApp, e-commerce, delivery, APIs bancárias e contabilidade. Contratos por domínio, credenciais por tenant, webhooks verificados, idempotência, outbox, retry e rastreamento. Não apresentar mocks como integrações concluídas.

## FASE 9 — SaaS / planos / assinaturas

Provisionamento e onboarding, planos/limites, assinatura/cobrança, uso, isolamento reforçado, exportação/eliminação conforme política, observabilidade, backups e restauração, CI/CD, secrets manager, rate limit distribuído, retenção de auditoria, testes de carga e revisão de segurança/LGPD. Comercialização somente após esses critérios operacionais.
