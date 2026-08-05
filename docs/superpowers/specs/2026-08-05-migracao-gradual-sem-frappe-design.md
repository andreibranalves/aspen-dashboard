# Migração gradual sem Frappe - Design

**Status:** aprovado para planejamento da primeira subfase.

## Objetivo

Migrar o dashboard para PostgreSQL por domínio, mantendo Frappe apenas como fonte temporária de importação e comparação.

A primeira entrega não declara o ciclo completo de orçamentos pronto antes de resolver suas dependências de dados, documentos, integrações e rollback.

## Decisões

- A primeira prioridade funcional continua sendo orçamentos.
- A transição será gradual, com feature flag isolada por domínio.
- PostgreSQL será fonte de verdade para novos dados somente após freeze de gravações equivalentes no Frappe.
- `CRM_CORE_QUOTES_ENABLED` será a flag única do fluxo de orçamentos.
- `CRM_OPERATIONAL_MODE` não será usado para controlar rollout de orçamentos.
- Rollback de código não poderá esconder dados criados no PostgreSQL.
- Migração histórica será baseada em snapshot, manifest, lineage, lotes retomáveis e reconciliação.
- A fase de orçamento dependerá previamente de templates, produtos, preços, clientes e leads necessários.
- PDFs novos serão renderizados a partir de snapshots PostgreSQL.
- Links públicos serão recursos autenticados por token, com validade e acesso limitado a revisões emitidas.
- Integrações externas não poderão impedir a persistência transacional do orçamento.
- Pedidos de venda permanecerão desabilitados ou usarão ponte explícita até terem domínio PostgreSQL próprio.

## Escopo da primeira subfase

A primeira subfase implementará fundação de corte e dependências de dados.

Ela entregará:

- matriz de rotas e consumidores do domínio de orçamento;
- contrato canônico de orçamento;
- estados e transições comerciais definidos;
- referências entre IDs legados e IDs PostgreSQL;
- política de histórico, PDFs e rollback;
- migração validada de templates, produtos, preços, clientes e leads;
- migração histórica de orçamentos com snapshot e reconciliação;
- feature flag isolada e observável.

Ela não removerá ainda os adaptadores Frappe de PDF, WhatsApp, CRM ou pedidos de venda sem substitutos equivalentes.

Esses adaptadores ficarão explicitamente fora do corte até a subfase de efeitos externos.

## Arquitetura

### Agregado de orçamento

Criação, consulta, edição, revisão, status, emissão, PDF, link público, duplicação, WhatsApp e conversão em pedido deverão consumir uma representação canônica do orçamento.

Cada handler poderá manter seu contrato HTTP atual, mas não poderá duplicar regras de domínio ou consultar Frappe diretamente quando o fluxo PostgreSQL estiver ativo.

### Dados e lineage

Cada entidade importada deverá manter referência a:

```text
provider
entity_type
source_id
local_id
business_number
source_hash
migration_run_id
source_updated_at
imported_at
```

Payloads brutos com dados pessoais terão retenção, acesso e exposição controlados.

Logs e relatórios não poderão imprimir payloads brutos.

### Rollout

O rollout será separado por domínio e deployment.

A flag ligada deverá selecionar PostgreSQL para o fluxo de orçamento sem fallback silencioso para Frappe.

A flag desligada deverá preservar o fluxo legado somente para dados legados já compatíveis.

Após a criação de qualquer dado PostgreSQL em produção, rollback de código exigirá preservar leitura PostgreSQL ou usar ponte explícita.

Não haverá gravação concorrente em Frappe e PostgreSQL durante o corte.

### Migração

A origem será exportada em snapshot identificado por timestamp, contagens e hashes.

O dry-run não escreverá no banco de destino.

O apply será executado por lotes, será retomável e será idempotente.

Após o freeze de gravações Frappe, será executado delta final antes da ativação.

A reconciliação comparará IDs, contagens, clientes, produtos, itens, quantidades, preços, totais e estados.

Divergências não explicadas bloquearão o corte.

### Documentos

Novos PDFs serão renderizados usando revisão imutável e template versionado PostgreSQL.

Cada emissão terá revisão, template, MIME, tamanho e SHA-256 registrados.

Emissão repetida com os mesmos dados será idempotente.

PDFs históricos serão tratados por política explícita: importar arquivo real, re-renderizar de snapshot ou declarar fora do escopo.

### Integrações

A persistência do orçamento ocorrerá em transação PostgreSQL independente de N8N, CRM, Evolution ou armazenamento de documentos externo.

Eventos de criação, atualização, emissão e envio serão registrados em outbox transacional antes do processamento externo.

Cada efeito externo terá chave de idempotência e retry observável.

## Critérios de aceite da subfase

- A branch parte de commit conhecido e worktree limpo.
- Templates, produtos, preços, clientes e leads necessários existem no PostgreSQL antes dos orçamentos.
- Snapshot de origem possui manifest, timestamp, hashes e contagens.
- Dry-run não modifica o banco.
- Apply repetido não cria duplicatas nem altera dados sem mudança de origem.
- Cada registro importado possui lineage e referência externa.
- Não existem números de orçamento duplicados.
- Totais e itens reconciliam com a origem ou possuem divergência aprovada.
- Estados legados possuem mapeamento canônico auditável.
- `CRM_CORE_QUOTES_ENABLED` é a única flag de rollout do domínio.
- `CRM_OPERATIONAL_MODE` não altera o rollout de orçamentos.
- Rollback em staging mantém acessíveis orçamentos criados no PostgreSQL.
- Rotas Vercel, servidor local e testes usam o mesmo mapa de handlers.
- Nenhuma dependência Frappe é removida sem substituto e teste correspondente.
- Testes unitários, build e checks do projeto passam.

## Roadmap posterior

### Subfase 1B - Ciclo PostgreSQL

Migrar criação automática e manual, consulta, edição, revisão, status, templates, HTML, PDF, download, duplicação e link público.

### Subfase 1C - Efeitos externos

Migrar outbox, N8N, CRM mínimo, WhatsApp baseado em PostgreSQL e persistência de envio.

A ação de pedido de venda ficará desabilitada com mensagem clara ou usará ponte explícita.

### Subfase 1D - Canary

Ativar coorte pequena, medir erros, latência, banco, PDF e integrações, testar rollback e ampliar gradualmente.

### Fase 2 - Pedidos de venda

Criar domínio PostgreSQL de pedidos, importar histórico e implementar conversão idempotente.

### Fase 3 - CRM e WhatsApp

Migrar Deals, conversas, mensagens, anexos, identidades, estados de entrega e armazenamento KV.

### Fase 4 - Remoção Frappe

Congelar escrita, executar export final, remover adaptadores, tokens, rotas antigas e código morto após período de retenção.
