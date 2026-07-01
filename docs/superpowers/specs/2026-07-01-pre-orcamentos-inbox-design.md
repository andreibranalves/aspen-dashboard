# Spec — Inbox de Pré-orçamentos

**Data:** 2026-07-01  
**Branch:** `spec/pre-orcamentos-inbox`  
**Objetivo:** criar uma caixa de entrada única no Aspen Dashboard para revisar leads/pedidos vindos de Typebot, WhatsApp, Meta/Google e formulário do site antes de gerar orçamento no ERPNext.

## 1. Contexto verificado

### Dashboard atual

- Já existe uma fila estruturada em Vercel KV: `aspen:quote-leads`.
- `POST /api/typebot-lead-capture` cria/atualiza Lead no ERPNext e, quando `TYPEBOT_LEAD_CAPTURE_ENABLED=true` e não é `dry_run`, chama `upsertQuoteLead`.
- `GET /api/quote-leads` lista leads pendentes.
- `PATCH /api/quote-leads` marca lead como `converted` ou `discarded`.
- `src/pages/AutoQuotePage.tsx` já mostra esses leads na aba inferior e preenche o textarea de extração.

### Site / WhatsApp / attribution

- `aspen-site` usa `/api/wa` para links de WhatsApp com mensagem limpa e token `[ref:...]`.
- `/api/wa` grava attribution em Supabase `attribution_tokens`.
- `/api/evolution-webhook` resolve o token e inicia Typebot com variáveis preenchidas (`PageUrl`, `gclid`, `source_cta`, `utm_source`, `utm_campaign`).
- Supabase `aspen-brain` tem `attribution_tokens` ativo com dados reais.

### Evolution / Typebot

Estado live via MCP em 2026-07-01:

- Instância Evolution `aspen-estamparia` está online.
- Webhook Evolution ativo: `https://aspenestamparia.com/api/evolution-webhook`, evento `MESSAGES_UPSERT`.
- Typebot `aspen-adiantar-orcamento`: `enabled=false`.
- Typebot `captura-lead-aspen`: `enabled=true`, trigger `startsWith "Olá, gostaria de mais informações"`.

**Risco:** o Typebot pode ser iniciado por dois caminhos: keyword trigger nativo da Evolution e webhook `/api/evolution-webhook`. A implementação deve escolher um único dono do start do Typebot antes de depender dos dados de attribution.

### Meta Ads

- Conta `Zaffiro 2` tem campanhas ativas.
- Há adsets/anúncios apontando para `aspenestamparia.com/` e `aspenestamparia.com/orcamento?...utm_source=meta...`.
- Há adset ativo chamado `Aberto - Typebot`.

### Formulário do site / email

- `POST /api/quote` no `aspen-site` salva `quoteRequest` no Sanity e envia e-mail via Resend.
- Esse caminho ainda não alimenta a fila `quote-leads` do dashboard.

### Conversões offline

- Supabase `aspen-brain` tem `brain_ad_conversion_queue` e `brain_order_gclids`.
- A spec deste projeto não deve recriar esse pipeline; deve apenas preservar attribution (`gclid`, `utm_*`, `source_cta`) nos leads/pré-orçamentos para que o pipeline existente consiga usar esses dados.

## 2. Problema

Hoje a operação tem entradas separadas:

1. Typebot/WhatsApp já cai parcialmente em `quote-leads`.
2. Formulário do site cai em Sanity/e-mail, fora do dashboard operacional.
3. WhatsApp direto pode ter attribution mas não vira uma tarefa clara se o usuário não completa dados.
4. A página Auto mistura criação manual com uma lista pequena de leads, mas não funciona como uma inbox central.

Resultado: o operador precisa juntar contexto manualmente e pode perder leads ou gerar orçamentos duplicados.

## 3. Objetivo do produto

Criar uma página principal no dashboard para funcionar como **Inbox de Pré-orçamentos**:

- Todo lead/pedido relevante entra numa fila única.
- O operador revisa dados, completa o que falta e dá OK.
- O sistema gera o orçamento pelo pipeline existente (`/api/extract` → `/api/orcamento`).
- Após sucesso, o item fica convertido com `quotationId`.
- Leads incompletos não somem: ficam sinalizados para ação de follow-up.

## 4. Fora de escopo

- Não reconstruir o pipeline Google Ads offline.
- Não alterar criativos/campanhas Meta Ads.
- Não substituir o ERPNext como fonte de orçamento final.
- Não criar automação que gere orçamento sem OK humano.
- Não mudar precificação em `api/_functions/pricing.js`.

## 5. Modelo de dados proposto

Evoluir `QuoteLead` para um registro mais genérico, mantendo compatibilidade:

```ts
type PreQuoteStatus = 'new' | 'incomplete' | 'ready' | 'reviewing' | 'converted' | 'discarded';

type PreQuoteSource = 'typebot' | 'site_form' | 'whatsapp' | 'manual' | 'sanity_import';

interface PreQuoteLead {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  empresa?: string;
  pedidoTexto: string;
  produto?: string;
  quantidade?: string;
  finalidade?: string;
  prazo?: string;
  arte?: string;
  source: PreQuoteSource | string;
  sourceDetail?: string;
  status: PreQuoteStatus;
  erpLeadId?: string | null;
  quotationId?: string | null;
  externalId?: string | null;
  attribution?: {
    page_url?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    fbclid?: string | null;
    source_cta?: string | null;
    result_id?: string | null;
  };
  raw?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Compatibility rule: existing `QuoteLead` consumers should continue working during migration. Add fields as optional first.

## 6. Backend design

### 6.1 Storage

Keep Vercel KV initially to avoid new infrastructure:

- Current key: `aspen:quote-leads`.
- Rename in code only if migration is simple; otherwise keep key and evolve schema.
- Keep max queue size bounded.
- Deduplicate by:
  1. normalized phone without country prefix,
  2. email,
  3. ERP Lead ID,
  4. external source ID.

### 6.2 API endpoints

Extend existing endpoint instead of creating a parallel one first:

#### `GET /api/quote-leads`

Query params:

- `status=new|incomplete|ready|reviewing|converted|discarded|all`
- `source=typebot|site_form|whatsapp|manual|all`
- `limit=1..100`
- `q=` optional search by name/email/phone

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "status": "ready",
      "source": "typebot",
      "nome": "...",
      "email": "...",
      "telefone": "...",
      "pedidoTexto": "...",
      "texto": "Nome: ...\nE-mail: ...\nTelefone: ...\nPedido: ...",
      "quotationId": null,
      "attribution": { "utm_source": "meta" }
    }
  ]
}
```

#### `POST /api/quote-leads`

New ingestion endpoint for non-Typebot sources.

Use cases:

- `aspen-site` `/api/quote` posts here after saving to Sanity/email.
- Manual insertion from dashboard later.
- Backfill/import from Sanity later.

Payload accepts loose fields and normalizes them through the same store function.

#### `PATCH /api/quote-leads`

Support:

- status update,
- quotation ID update,
- field edits before generating quote,
- discard reason optional.

### 6.3 Typebot ingestion

Keep `POST /api/typebot-lead-capture` as the Typebot webhook.

Changes:

- Preserve structured qualification fields in queue record, not only formatted `pedidoTexto`.
- Store attribution fields inside `attribution` as well as ERP custom fields.
- If required fields are missing, enqueue as `incomplete`, not silently ignore.

### 6.4 Site form ingestion

Modify `aspen-site` `/api/quote` after current success path:

1. Save Sanity `quoteRequest` as today.
2. Send emails as today.
3. Fire-and-forget POST to dashboard `/api/quote-leads` with:
   - source `site_form`,
   - Sanity document ID as `externalId`,
   - form fields,
   - UTM/GCLID fields.
4. Do not fail the user submission if dashboard enqueue fails; log error.

Requires a shared secret env var between site and dashboard, e.g. `QUOTE_LEADS_INGEST_TOKEN`.

### 6.5 Evolution/Typebot start ownership

Before relying on WhatsApp attribution, choose one:

Recommended:

- Disable native keyword trigger in Evolution for `captura-lead-aspen`.
- Keep `/api/evolution-webhook` as the only Typebot starter because it can resolve `[ref:token]` and prefill attribution.

Acceptance check: a WhatsApp message with `[ref:token]` creates exactly one Typebot session.

## 7. Frontend design

### 7.1 Route

Add a dashboard route:

- Hash route: `#/pre-orcamentos`.
- Optionally make `#/dashboard` or `/` redirect/shortcut to this inbox later.

Do not replace `AutoQuotePage` immediately. The inbox can reuse its extraction/generation logic while keeping behavior isolated.

### 7.2 Page layout

Page title: **Pré-orçamentos**.

Top controls:

- status chips: `Novos`, `Incompletos`, `Prontos`, `Convertidos`, `Descartados`, `Todos`.
- source chips: `Todos`, `Typebot`, `Formulário`, `WhatsApp`, `Manual`.
- search input.
- refresh button.

Main layout:

- Left: queue list/cards.
- Right: selected lead detail + draft/orçamento panel.

Card fields:

- name/phone/email,
- source badge,
- status badge,
- product/quantity summary,
- created/updated date,
- attribution indicator (`Google`, `Meta`, `Orgânico`, etc.).

Detail panel actions:

- `Extrair orçamento` — uses existing `/api/extract` with `texto`.
- `Editar dados` — updates queue record.
- `Gerar orçamento` — uses existing `/api/orcamento` after extraction/draft review.
- `Pedir dados faltantes` — later can open WhatsApp flow; first version can just expose WhatsApp link/copy text.
- `Descartar`.

### 7.3 Status behavior

- `incomplete`: missing name, phone/email, or request details.
- `ready`: enough data to run extraction.
- `reviewing`: operator opened/started working.
- `converted`: quotation generated successfully.
- `discarded`: manually discarded.

First implementation can compute `ready` on normalization and keep manual status overrides simple.

## 8. Implementation phases

### Phase 0 — Safety fix / validation

- Verify Evolution Typebot start ownership.
- Disable duplicate start path or document why not.
- Add a test/manual checklist proving one WhatsApp click creates one Typebot session.

### Phase 1 — Backend queue evolution

- Extend `quote-leads-store.ts` schema and normalization.
- Add `POST /api/quote-leads` with token auth for ingestion.
- Extend tests:
  - Typebot normalized with attribution.
  - site_form payload normalized.
  - dedupe across Typebot + site form by phone/email.
  - incomplete vs ready status.

### Phase 2 — Site form integration

- Update `aspen-site` `/api/quote` to enqueue in dashboard fire-and-forget.
- Include UTM/GCLID/page URL fields.
- Keep Sanity and Resend behavior unchanged.

### Phase 3 — Dashboard inbox page

- Add `src/pages/PreQuotesPage.tsx`.
- Register route in `src/App.tsx`.
- Add nav/sidebar entry if existing layout supports it.
- Reuse API wrapper and extraction hooks from `AutoQuotePage` where practical.
- Do not remove Auto page yet.

### Phase 4 — Conversion workflow

- On successful `/api/orcamento`, PATCH selected pre-quote as `converted` with `quotationId`.
- Show generated quotation link.
- Keep failed generation as `ready` or `reviewing` with visible error.

### Phase 5 — Cleanup / migration

- Decide whether Auto page keeps its lead tab or links to the new inbox.
- Optional: backfill recent Sanity `quoteRequest` records into queue.

## 9. Testing

### Unit tests

- `tests/unit/quote-leads-store.test.ts`
  - normalize Typebot payload.
  - normalize site form payload.
  - preserve attribution.
  - dedupe by phone/email.
  - classify incomplete/ready.
  - update status/quotationId.

- `tests/unit/quote-leads.test.ts`
  - GET filters by status/source.
  - POST requires auth token for external ingestion.
  - PATCH edits fields and status.

- `tests/unit/typebot-lead-capture.test.ts`
  - enqueues attribution fields.
  - incomplete submissions become queued incomplete when useful.

### Frontend checks

- LSP diagnostics on touched TS/TSX files.
- Component behavior with empty, loading, error, and populated states.
- Manual local flow:
  1. seed queue via POST,
  2. open dashboard page,
  3. select lead,
  4. extract,
  5. generate quotation in test/stub mode if possible,
  6. verify converted status.

### Full verification before merge

- `npm run test:unit`
- `npm run lint`
- `npm run build`

If site repo is touched:

- run site typecheck/build commands from `aspen-site`.

## 10. Rollout

1. Deploy dashboard backend with backward-compatible queue changes.
2. Deploy inbox page hidden or linked only internally.
3. Deploy site form enqueue.
4. Validate one real site form reaches inbox.
5. Validate one real WhatsApp/Typebot flow reaches inbox once.
6. Promote inbox to main operational page.

## 11. Open questions

1. Should the new page become the dashboard home (`#/dashboard`) or a separate route `#/pre-orcamentos` first?
2. Should `site_form` submissions create ERPNext Lead immediately or only after operator OK?
   - Recommendation: queue first, create/update ERPNext only when generating quote, unless marketing attribution requires immediate Lead.
3. Should incomplete WhatsApp leads be pulled from Evolution conversations or only from Typebot/site forms?
   - Recommendation: do not reintroduce Evolution guessing in V1; keep it as a later fallback.
4. Should Sanity be backfilled, or only new form submissions?
   - Recommendation: only new submissions first.

## 12. Recommended V1

V1 should include only:

- single Typebot start ownership validation/fix,
- evolved `quote-leads` queue,
- POST ingestion from site form,
- new dashboard inbox page,
- manual OK to generate quotation,
- converted/discarded statuses.

This solves the operational problem without rebuilding unrelated attribution or ads infrastructure.
