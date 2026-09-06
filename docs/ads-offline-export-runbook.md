# Exportação offline de pedidos para Google Data Manager

Este runbook documenta a implementação do #204. O recurso está pronto para revisão e validação descartável; ele não ativa agendamento, backfill, deploy, migration operacional ou upload real.

## Fonte de verdade e fluxo

```text
sales_orders
  -> quotations.quote_lead_id
  -> sales_orders.quotation_revision_id
  -> quote_leads.attribution/raw.siteSubmission
  -> sales_order_offline_exports (snapshot imutável)
  -> sales_order_offline_export_attempts (histórico)
  -> Data Manager v1 events.ingest
  -> requestStatus:retrieve
```

Um pedido só pode ser selecionado quando o vínculo direto do orçamento ao lead, a revisão aprovada e a origem `site_form` são verificáveis. O caminho aprovado atual grava o total e a data de criação do pedido a partir da revisão aprovada. Linhas históricas, importadas ou sem `raw.siteSubmission` verificável ficam bloqueadas.

São aceitos `To Deliver and Bill`, `To Deliver`, `To Bill` e `Completed`. `Draft` e `Cancelled` são excluídos; `Closed` fica em revisão. A identidade é única por pedido, tipo de evento, conta e ação de destino. O identificador é preservado opaco (`gclid`, `wbraid` ou `gbraid`), sem usar nome, e-mail, telefone, endereço, IP ou contato como prova.

Consentimento genérico como `{ given: true }` não é convertido. O envio exige evidência explícita com `adUserData` e `adPersonalization` concedidos, versão de política, data RFC3339 canônica e fonte. Ausência dessa evidência exige revisão.

## Configuração

Variáveis do transporte real, mantidas fora do checkout:

```text
GOOGLE_DATA_MANAGER_CLIENT_ID
GOOGLE_DATA_MANAGER_CLIENT_SECRET
GOOGLE_DATA_MANAGER_REFRESH_TOKEN
GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID
GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID
GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_TYPE=UPLOAD_CLICKS
GOOGLE_DATA_MANAGER_API_VERSION=v1
```

O escopo é fixo no código: `https://www.googleapis.com/auth/datamanager`. Não há developer token nem fallback para a API Google Ads. O write externo também passa por `APP_ENV=production` e `EXTERNAL_WRITES_ENABLED=1`.

O `operatingAccount` deve ser o proprietário da ação de conversão `UPLOAD_CLICKS`. Antes de qualquer apply, o operador deve confirmar conta, ação, escopo OAuth, deployment e banco no mesmo alvo e gerar uma prova local de preflight com fingerprint do banco, owner, target, deployment e data de verificação. A prova não é gravada no banco.

## Comandos

Dry-run exige apenas um intervalo explícito `[from,to)` e não grava ledger, claim, tentativa ou auditoria; também não chama OAuth, `events.ingest` ou diagnóstico remoto:

```bash
npm run ads:offline -- \
  --from 2026-09-01T00:00:00Z \
  --to 2026-09-02T00:00:00Z \
  --dry-run
```

O relatório mostra somente referências internas do pedido, status, categoria, motivo, tipo de identificador, timestamp, total e estado do ledger. Configuração ausente aparece como não verificada.

Apply exige uma lista explícita de UUIDs revisados e o arquivo de prova do preflight:

```bash
npm run ads:offline -- \
  --from 2026-09-01T00:00:00Z \
  --to 2026-09-02T00:00:00Z \
  --apply \
  --approved-orders /caminho/revisados.json \
  --preflight-proof /caminho/preflight.json
```

Não existe `--force`. A implementação não autoriza automaticamente nenhum pedido real; a aprovação deste código não é aprovação de lista, destino ou primeira aplicação.

## Ledger e recuperação

O claim usa um `UPDATE ... RETURNING` curto, cria uma tentativa `started` e faz commit antes da rede. Nenhuma transação fica aberta durante OAuth ou HTTP. O worker que perde lease não pode concluir uma tentativa antiga. Timeout, erro de rede, resposta 5xx ou resposta sem `requestId` são ambíguos e levam a `needs_review/result_unknown`; não há replay cego. Erro 429 tem retry limitado; erros 4xx são falha permanente.

O aceite HTTP 200 grava `requestId` e warnings sanitizados em `accepted_pending_diagnostic`. Somente o diagnóstico posterior pode levar a `processed`; `PARTIAL_SUCCESS` leva a `needs_review/diagnostic_partial_success`. O fluxo não promete atribuição, exactly-once ou sucesso comercial a partir do aceite HTTP.

| Estado | Significado |
| --- | --- |
| `prepared` | snapshot local pronto para claim |
| `sending` | lease ativo; não é confirmação remota |
| `accepted_pending_diagnostic` | Data Manager aceitou HTTP 200; diagnóstico pendente |
| `processed` | diagnóstico confirmou sucesso |
| `failed` | falha permanente ou retry transitório agendado |
| `needs_review` | resultado ambíguo, lease expirado, consentimento, correção ou diagnóstico parcial |

Cancelamento antes da primeira tentativa remove o snapshot não enviado. Cancelamento, correção ou substituição depois de qualquer tentativa preserva o histórico e muda o ledger para revisão; não cria nova identidade nem tenta retractar o evento no Google.

## Validação desta entrega

Em 2026-09-06 foi usado PostgreSQL 16.15 local descartável na porta 55434, com database `aspen_test`, migrations completas e cleanup ao final. O transporte Google foi simulado por `fetch` injetado nos testes; nenhum OAuth, `events.ingest`, `requestStatus:retrieve`, `validateOnly`, upload, deploy ou write externo real foi executado.

As referências oficiais revalidadas para Data Manager v1 foram:

- [Offline events upgrade](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade), consultado em 2026-09-06; atualização indicada pela página: 2026-07-30.
- [Send offline events](https://developers.google.com/data-manager/api/devguides/events/send-events).
- [events.ingest REST](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest).
- [Consent REST](https://developers.google.com/data-manager/api/reference/rest/v1/Consent).
- [Data Manager diagnostics](https://developers.google.com/data-manager/api/devguides/diagnostics).

