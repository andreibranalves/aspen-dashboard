# Migração gradual sem Frappe - Design

**Status:** revisado após auditoria técnica; aguardando aprovação para implementação.

## Objetivo

Migrar o dashboard para PostgreSQL por domínio, mantendo Frappe apenas como fonte temporária de importação e comparação.

A primeira entrega não declara o ciclo completo de orçamentos pronto antes de resolver suas dependências de dados, documentos, integrações e rollback.

## Decisões

- A primeira prioridade funcional continua sendo orçamentos.
- A transição será gradual, com feature flag isolada por domínio.
- PostgreSQL será fonte de verdade para novos dados somente após freeze de gravações equivalentes no Frappe.
- `CRM_CORE_QUOTES_ENABLED` será a única flag do fluxo de orçamentos.
- `CRM_OPERATIONAL_MODE` não habilitará nem desabilitará o fluxo de orçamentos.
- Rollback de código não poderá esconder dados criados no PostgreSQL.
- O rollout terá estados explícitos `legacy`, `postgres-write`, `postgres-read-only` e `rollback-compatible`.
- Migração histórica será baseada em snapshot, manifest, lineage, lotes retomáveis e reconciliação.
- Templates serão semeados a partir das definições PostgreSQL atuais e validados antes da importação de orçamentos.
- Produtos, preços, clientes e leads necessários serão migrados antes de qualquer orçamento que os referencie.
- PDFs novos serão renderizados a partir de snapshots PostgreSQL.
- Links públicos serão recursos separados, com token, validade, revogação e acesso limitado a revisões emitidas.
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
- semeadura e validação de templates PostgreSQL;
- migração validada de produtos, preços, clientes e leads;
- migração histórica de orçamentos com snapshot e reconciliação;
- feature flag isolada e observável;
- runbook executável de corte, abortamento e rollback.

Ela não removerá ainda os adaptadores Frappe de PDF, WhatsApp, CRM ou pedidos de venda sem substitutos equivalentes.

Ela também não declarará o envio de WhatsApp, emissão pública de PDF ou conversão em pedido como capacidades PostgreSQL até as subfases específicas desses efeitos.

## Estado atual conhecido

- `api/_functions/orcamento-mode.ts` atualmente considera `CRM_OPERATIONAL_MODE=true` como ativação do core de orçamentos.
- `api/_lib/auth.ts` atualmente libera a rota `view` sem token público.
- `api/_functions/view.ts` e `api/_functions/pdf.ts` atualmente usam o caminho legado baseado em Frappe.
- A lineage atual não possui todos os campos de execução e timestamps definidos neste documento.
- A migração atual produz relatório em memória e não possui manifest persistido nem checkpoint de lote retomável.
- Os três mapas de rota possuem os mesmos nomes conhecidos, mas são cópias independentes e precisam de teste de paridade.

Esses fatos são problemas de implementação da primeira subfase, não exceções ao design.

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

A tabela de execução deverá registrar:

```text
id
provider
mode
source_snapshot_at
manifest_hash
status
started_at
completed_at
```

O processamento deverá registrar lote, entidade, estado, contagem, erro classificado e checkpoint suficiente para retomada.

Payloads brutos com dados pessoais terão retenção, acesso e exposição controlados.

A política padrão será restringir `legacy_payload` ao acesso operacional autorizado, excluir seu conteúdo de logs e relatórios e documentar prazo de retenção antes do apply em produção.

### Rollout e rollback

O rollout será separado por domínio e deployment.

`CRM_CORE_QUOTES_ENABLED` controlará apenas a seleção do fluxo de orçamento.

`CRM_OPERATIONAL_MODE` poderá continuar protegendo outros domínios, mas não será um override de orçamento.

Os estados de rollout serão:

| Estado | Leitura | Escrita | Uso |
| --- | --- | --- | --- |
| `legacy` | Frappe para registros legados | Frappe | operação atual |
| `postgres-write` | PostgreSQL | PostgreSQL | canary e produção migrada |
| `postgres-read-only` | PostgreSQL | bloqueada ou somente operações seguras | incidente e diagnóstico |
| `rollback-compatible` | PostgreSQL e legado conforme origem | somente destino explicitamente suportado | rollback sem ocultar dados |

A flag não poderá, sozinha, representar rollback seguro.

Após a criação de qualquer dado PostgreSQL em produção, rollback deverá manter leitura PostgreSQL para esses dados ou restaurar deployment compatível com essa leitura.

Não haverá gravação concorrente em Frappe e PostgreSQL durante o corte.

### Migração

A origem será exportada em snapshot identificado por timestamp, contagens e hashes.

O dry-run não escreverá no banco de destino.

O apply será executado por lotes, será retomável e será idempotente.

O apply retornará código diferente de zero quando houver erro, divergência bloqueante ou pré-requisito ausente.

Após o freeze de gravações Frappe, será executado delta final antes da ativação.

A reconciliação comparará IDs, contagens, clientes, produtos, itens, quantidades, preços, totais e estados.

Divergências serão classificadas como aprovadas ou bloqueantes.

Qualquer divergência bloqueante impedirá o corte.

### Ordem de dados

A ordem obrigatória será:

```text
templates PostgreSQL
-> produtos
-> preços
-> clientes e leads
-> orçamentos
```

Templates não serão extraídos do dataset Frappe atual.

A pipeline deverá validar que templates e versões esperados estão semeados no PostgreSQL antes de aceitar qualquer orçamento importado.

### Estados comerciais

O modelo PostgreSQL preservará o estado original da origem e o estado canônico.

A tabela inicial de mapeamento deverá ser aprovada antes do apply:

| Estado Frappe | Estado canônico inicial | Regra |
| --- | --- | --- |
| `draft` | `rascunho` | editável |
| `open` ou `sent` | `enviado` | revisão emitida ou enviada |
| `lost` ou `cancelled` | `perdido` | não editável sem nova revisão |
| `ordered`, `completed` ou `closed` | `aprovado` | vínculo de pedido deve ser preservado ou marcado como pendente |

Se o negócio exigir distinção entre cancelado, perdido, expirado e fechado, novos estados deverão ser criados antes da migração.

### Documentos

A rota administrativa de visualização permanecerá autenticada.

O link público será uma rota estreita para revisão emitida, com token aleatório ou assinado, armazenamento seguro de material de validação, expiração, revogação, rate limit e dados mínimos.

Rascunhos nunca serão acessíveis pelo link público.

Novos PDFs serão renderizados usando revisão imutável e template versionado PostgreSQL.

Cada emissão terá revisão, template, MIME, tamanho e SHA-256 registrados.

Emissão repetida com os mesmos dados será idempotente.

A política de PDFs históricos deverá escolher uma opção antes do corte: importar arquivo real, re-renderizar de snapshot ou declarar históricos fora do escopo.

### Integrações

A persistência do orçamento ocorrerá em transação PostgreSQL independente de N8N, CRM, Evolution ou armazenamento de documentos externo.

A outbox será implementada na subfase de efeitos externos, não será requisito falso da primeira subfase de dados.

Quando implementada, registrará eventos de criação, atualização, emissão e envio antes do processamento externo.

Cada efeito externo terá chave de idempotência, lease, retry com backoff e estado de dead-letter observável.

Até essa subfase, qualquer integração que ainda dependa de Frappe ficará marcada como legado e não será apresentada como capacidade PostgreSQL completa.

## Critérios de aceite da primeira subfase

- A branch parte de commit conhecido e worktree limpo.
- `npm run test:unit` funciona em checkout limpo sem depender de JavaScript gerado previamente.
- Templates e versões PostgreSQL necessárias estão semeados e validados antes dos orçamentos.
- Produtos, preços, clientes e leads necessários existem no PostgreSQL antes dos orçamentos.
- Snapshot de origem possui manifest, timestamp, hashes e contagens.
- Dry-run não modifica o banco.
- Apply repetido não cria duplicatas nem altera dados sem mudança de origem.
- Cada registro importado possui lineage e referência externa.
- Cada lineage aponta para uma execução de migração identificável.
- Não existem números de orçamento duplicados.
- Totais e itens reconciliam com a origem ou possuem divergência aprovada.
- Divergência não aprovada bloqueia apply e corte.
- Estados legados possuem mapeamento canônico e estado original auditável.
- `CRM_CORE_QUOTES_ENABLED` é a única flag de rollout do domínio.
- `CRM_OPERATIONAL_MODE` não altera o rollout de orçamentos.
- Rollback em staging mantém acessíveis orçamentos criados no PostgreSQL.
- Rotas Vercel, servidor local e testes usam o mesmo conjunto de handlers.
- Nenhuma dependência Frappe é removida sem substituto e teste correspondente.
- O runbook define backup, snapshot, freeze, delta final, canary, abortamento e rollback.
- Testes unitários, build e checks do projeto passam.

## Roadmap posterior

### Subfase 1B - Ciclo PostgreSQL

Migrar criação automática e manual, consulta, edição, revisão, status, templates, HTML, PDF administrativo, download, duplicação e emissão.

### Subfase 1C - Link público e efeitos externos

Implementar link público de revisão emitida, outbox, worker com lease e retry, N8N, CRM mínimo, WhatsApp baseado em PostgreSQL e persistência de envio.

A ação de pedido de venda ficará desabilitada com mensagem clara ou usará ponte explícita.

### Subfase 1D - Canary

Ativar coorte pequena, medir erros, latência, banco, PDF e integrações, testar rollback e ampliar gradualmente.

### Fase 2 - Pedidos de venda

Criar domínio PostgreSQL de pedidos, importar histórico e implementar conversão idempotente.

### Fase 3 - CRM e WhatsApp

Migrar Deals, conversas, mensagens, anexos, identidades, estados de entrega e armazenamento KV.

### Fase 4 - Remoção Frappe

Congelar escrita, executar export final, remover adaptadores, tokens, rotas antigas e código morto após período de retenção.
