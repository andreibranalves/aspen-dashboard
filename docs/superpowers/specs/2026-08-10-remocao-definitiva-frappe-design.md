# Remoção Definitiva de Frappe e ERPNext Design

**Status:** Desenho aprovado para planejamento.

## Objetivo

Transformar o dashboard em uma aplicação PostgreSQL-only.

Produtos, preços, clientes, orçamentos, CRM Kanban, pedidos, dashboard de vendas, atividade de produto, captura Typebot e comunicação devem funcionar sem chamadas, flags, credenciais, adapters ou fallbacks Frappe/ERPNext.

## Decisões Confirmadas

Não haverá importação de dados históricos de CRM, pedidos, atividades ou leads.

As novas tabelas de CRM, pedidos, atividades e fila de leads entrarão vazias em Production.

Fixtures de dados pertencem somente a testes e staging descartável.

Produtos, clientes, orçamentos, revisões, PDFs e templates PostgreSQL existentes permanecem válidos.

O app não deve criar, consultar, atualizar ou depender de nenhuma entidade Frappe/ERPNext após o corte.

As tabelas históricas `frappe_*` já existentes podem permanecer no banco exclusivamente como artefatos de auditoria.

As migrations Drizzle já aplicadas permanecem imutáveis e podem manter nomes históricos.

Nenhum módulo de runtime, configuração de ambiente, teste ativo, documentação operacional ou tela deve mencionar Frappe ou ERPNext.

Não serão adicionadas dependências.

## Limite de Escopo

Este corte preserva as superfícies atuais em vez de removê-las.

CRM Kanban, Dashboard de vendas, Pedidos de venda e Atividade do produto serão reimplementados sobre PostgreSQL.

A captura Typebot continuará gravando dados locais e não criará registros externos.

WhatsApp continuará usando somente snapshot PostgreSQL e Evolution quando estiver configurada.

N8N e CRM externo continuarão desativados.

Links, URLs e mídia hospedados no sistema antigo não serão carregados pelo app.

A interface exibirá placeholder ou mídia Blob local quando não houver mídia local disponível.

## Arquitetura Alvo

Cada rota terá um único handler PostgreSQL sem seletor de modo.

Cada handler chamará seu repositório PostgreSQL diretamente e devolverá contratos sem `core_mode` ou `source: 'frappe'`.

Validação HTTP genérica ficará em módulo neutro sob `api/_lib/`.

O cliente HTTP Frappe/ERPNext será removido depois que todos os consumidores forem substituídos.

O deploy seguirá a ordem DDL compatível, deploy de código PostgreSQL-only, canário e remoção de credenciais.

## Modelo de Dados Novo

### CRM Deals

`crm_deals` armazenará um deal local com UUID, `quote_lead_id` opcional, `client_id` opcional, `quotation_id` opcional, nome, email, telefone, status, estágio de follow-up, próxima ação, criação e atualização.

O status terá check constraint usando a ordem atual do Kanban: `Novo Lead`, `Contato Feito`, `Orcamento Enviado`, `Em Negociacao`, `Arte Aprovada`, `Pedido Fechado` e `Perdido`.

`quotation_id` terá unicidade parcial para impedir mais de um deal ativo por orçamento.

A rota `crm-deals` listará e agrupará esses registros usando a mesma ordem visual atual.

A rota `crm-update-deal` atualizará somente campos mutáveis validados no banco.

A rota `crm-prune-candidates` calculará candidatos pelo deal local, orçamento local e datas locais.

### Fila de Leads

`quote_leads` substituirá o armazenamento KV da fila de pré-orçamentos.

A tabela armazenará identidade normalizada, dados de contato, pedido, atribuição, estado, orçamento associado, criação e atualização.

A chave de identidade será calculada pelo repositório para mesclar envios repetidos de Typebot sem depender de fornecedor externo.

A captura Typebot gravará ou atualizará `quote_leads` e criará ou atualizará um `crm_deal` local quando o lead estiver qualificado.

Nenhum dado Typebot será copiado para Frappe/ERPNext.

### Pedidos de Venda

`sales_orders` armazenará pedidos locais com UUID, número comercial `PED-AAAA-NNNN`, cliente, orçamento e revisão de origem opcionais, status, datas de pedido e entrega, percentuais de entrega e faturamento, subtotal, total, criação e atualização.

`sales_order_sequences` reservará números comerciais por ano dentro da mesma transação do pedido.

`sales_order_items` armazenará snapshots ordenados de SKU, nome, unidade, quantidade, preço unitário e total de linha.

A criação de pedido a partir de orçamento usará a revisão PostgreSQL escolhida e terá unicidade por orçamento para impedir duplicidade.

A listagem, detalhe e dashboard consultarão apenas esses três conjuntos de dados.

O dashboard retornará zero e listas vazias até existirem pedidos locais.

### Atividade de Produto

`product_activity_events` armazenará UUID, SKU, tipo, texto, timestamp e referência local opcional.

Atualizações de produto e preços acrescentarão eventos na mesma transação que a mudança principal.

Criação de orçamento e pedido acrescentará eventos para os SKUs envolvidos.

A rota `product-activity` listará apenas eventos locais recentes.

Não haverá leitura de versões ou histórico externo.

## Fluxos de Escrita

Criar ou editar produto usará o repositório de catálogo PostgreSQL e gravará atividade local quando houver alteração material.

Criar orçamento usará o agregado de orçamento PostgreSQL e criará ou atualizará o deal local correspondente.

Duplicar orçamento clonará a revisão PostgreSQL em vez de chamar método externo.

Criar pedido a partir de orçamento materializará os snapshots da revisão para `sales_orders` e `sales_order_items`.

Atualizar deal alterará o registro local e não enviará payload para terceiros.

Capturar lead Typebot atualizará a fila e o deal locais.

Enviar WhatsApp aceitará exclusivamente identificadores de orçamento e revisão PostgreSQL.

## Remoções

Os handlers e repositórios legados de produtos, clientes, preços, orçamentos e migração serão removidos.

Os handlers de CRM, pedidos, dashboard, Typebot, duplicação, comunicação e WhatsApp perderão todas as branches externas.

`api/_functions/lib/erpnext.ts` será removido após mover `createHttpError` para um módulo HTTP neutro.

`api/_functions/operational-mode.ts`, `api/_functions/orcamento-mode.ts` e `api/_functions/products-mode.ts` serão removidos.

As variáveis `CRM_CORE_PRODUCTS_ENABLED`, `CRM_CORE_CLIENTS_ENABLED`, `CRM_CORE_QUOTES_ENABLED`, `CRM_QUOTES_ROLLOUT_STATE` e `CRM_OPERATIONAL_MODE` serão removidas de código, `.env.example` e Vercel.

As variáveis e scripts de migração ou acesso externo serão removidos depois que seus últimos consumidores forem removidos.

`src/types/erpnext.ts`, links externos nas telas e metadados de resposta de rollout serão removidos ou renomeados para contratos locais.

A health check operacional deixará de consultar lineage histórica.

As tabelas `frappe_*` sairão de `api/_db/schema.ts` e permanecerão inacessíveis ao runtime.

## Compatibilidade e Corte

A nova migration criará somente estruturas PostgreSQL vazias e índices necessários.

A migration não fará backfill, seed nem deleção de dados de Production.

A migration será aplicada antes do deploy que usa as novas tabelas.

Os endpoints manterão nomes públicos quando a função equivaler à existente.

Os contratos de resposta serão adaptados no frontend junto com os handlers para remover metadados de rollout.

O corte será atômico do ponto de vista do app porque não haverá fallback externo depois do deploy.

O deployment anterior continuará disponível para rollback até os canários PostgreSQL passarem.

As credenciais e variáveis Frappe/ERPNext serão removidas somente depois dos canários e da confirmação de ausência de egress.

## Verificação

Cada repositório e handler novo seguirá TDD com teste vermelho, implementação mínima e teste verde.

Testes unitários cobrirão validação, invariantes, transações, paginação, filtros, agrupamento, duplicidade e estados vazios.

Testes E2E cobrirão CRM Kanban, criação e detalhe de pedido, dashboard vazio e preenchido, atividade de produto, Typebot local, orçamento, duplicação e envio WhatsApp PostgreSQL-only.

O canário Production verificará produtos, clientes, orçamentos, preview, PDF, CRM vazio, pedidos vazios, dashboard vazio, atividade local e ausência de chamadas externas.

A verificação estrutural falhará se `api/`, `src/`, `scripts/`, testes ativos, `.env.example` ou documentação operacional contiverem referências Frappe/ERPNext.

Migrations históricas sob `drizzle/` serão a única exceção deliberada à busca textual porque reescrever migrations aplicadas corrompe instalações existentes.

A verificação de Vercel confirmará a ausência das variáveis de rollout e credenciais Frappe/ERPNext.

O egress de staging continuará bloqueando hosts Frappe/ERPNext.

## Critérios de Aceite

Nenhuma rota do app chama Frappe/ERPNext.

Nenhuma rota seleciona caminho core ou legado por variável de ambiente.

Todas as superfícies existentes usam PostgreSQL ou Evolution para WhatsApp.

Production não contém dados de seed inventados para CRM, pedidos, atividades ou leads.

Production não depende de `ERPNEXT_*`, `FRAPPE_*` ou flags de rollout.

Produtos, clientes, orçamentos, revisões, previews, PDFs e links públicos existentes continuam funcionais.

CRM, pedidos, dashboard e atividades locais funcionam vazios imediatamente após o corte e acumulam somente dados novos.
