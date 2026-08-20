# Template de E-mail de Orçamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a aba Comunicação > E-mail de orçamento para configurar, visualizar e usar um único modelo global nos futuros envios de orçamento.

**Architecture:** O modelo global ficará em uma coluna JSONB do singleton `app_settings`, com contrato, validação e renderização centralizados em um módulo puro compartilhado entre Vite e API. O envio reservará uma cópia não renderizada do modelo somente durante tentativas pendentes, garantindo retries idempotentes, e apagará essa cópia nos estados terminais.

**Tech Stack:** React 19, TypeScript, Vite 6, Node.js ESM, Vercel Functions, PostgreSQL, Drizzle ORM, Node test runner e Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-template-email-orcamento-design.md`

## Global Constraints

- Não adicionar dependências.
- Manter backend ESM com extensões `.js` nos imports.
- Não editar migrations históricas nem arquivos gerados em `public/`.
- Usar somente `{{nome_cliente}}` e `{{numero_orcamento}}`.
- Limitar assunto a 200, saudação a 500, mensagem a 4.000, botão a 80 e assinatura a 500 caracteres.
- Manter assunto, mensagem e botão obrigatórios; saudação e assinatura opcionais.
- Preservar link público, PDF, remetente, reply-to, idempotência e estados de entrega existentes.
- Reter `template_snapshot` somente em tentativas pendentes e apagá-lo em estados aceito ou falha.
- Não registrar destinatário, conteúdo renderizado, PDF, segredo, erro bruto do banco ou resposta bruta da Resend.
- Retornar erros ao usuário em português.
- Não chamar a Resend real em testes automatizados.
- Manter sincronizados `api/[...path].ts`, `scripts/dev-api-server.mjs` e `scripts/app-server.mjs`.
- Não aplicar migration em banco real nem fazer envio real sem autorização explícita separada.

## File Structure

### Shared domain

- Create `api/_lib/quotation-email-template.ts` as the environment-neutral contract, default, validator, token interpolator and renderer used by API and frontend.
- Create `tests/unit/quotation-email-template-domain.test.ts` for validation, escaping, default compatibility and HTML/text rendering.

### Persistence and delivery

- Modify `api/_db/schema.ts` to add the global JSONB template and pending delivery snapshot.
- Create `api/_db/quotation-email-template-repository.ts` for singleton reads and atomic saves.
- Modify `api/_db/quotation-email-delivery-repository.ts` to reserve and clear `templateSnapshot` with delivery state transitions.
- Generate `drizzle/0021_quotation_email_template.sql`, `drizzle/meta/0021_snapshot.json` and update `drizzle/meta/_journal.json` through Drizzle Kit.
- Modify `tests/unit/settings-postgres.test.ts` and `tests/unit/quotation-email-delivery-postgres.test.ts` for migration and repository coverage.

### Sending

- Modify `api/_functions/lib/quotation-email.ts` so the Resend transport receives already-rendered subject, HTML and text.
- Modify `api/_functions/send-quotation-email.ts` to load or reuse the reserved template before sending.
- Modify `tests/unit/quotation-email.test.ts` and `tests/unit/send-quotation-email.test.ts` for rendered payload and idempotent snapshot behavior.

### Configuration API

- Create `api/_functions/quotation-email-template.ts` with authenticated-boundary-compatible `GET` and `PUT` behavior.
- Modify all three route maps.
- Create `tests/unit/quotation-email-template.test.ts` for handler validation and failure behavior.

### Frontend

- Create `src/lib/quotationEmailTemplateApi.ts` as the frontend API and shared-domain facade.
- Create `src/components/communication/QuotationEmailTemplateTab.tsx` for load, edit, preview, validation, restore and save.
- Modify `src/pages/ComunicacaoPage.tsx` to add the tab and guard tab changes.
- Modify `src/hooks/useHashRoute.ts` and `src/App.tsx` to guard app navigation while edits are dirty.
- Create `tests/communication-email-template.spec.js` for user-visible behavior without a real provider call.

---

### Task 1: Shared template contract and renderer

**Files:**

- Create: `api/_lib/quotation-email-template.ts`
- Create: `tests/unit/quotation-email-template-domain.test.ts`

**Interfaces:**

- Produces: `QuotationEmailTemplate`, `QuotationEmailTemplateField`, `QuotationEmailTemplateValidation`, `RenderedQuotationEmail`, `DEFAULT_QUOTATION_EMAIL_TEMPLATE`, `QUOTATION_EMAIL_TEMPLATE_LIMITS`, `QUOTATION_EMAIL_TEMPLATE_TOKENS`, `validateQuotationEmailTemplate()` and `renderQuotationEmailTemplate()`.
- Consumes: no application modules.

- [ ] **Step 1: Write failing domain tests**

Create `tests/unit/quotation-email-template-domain.test.ts` with focused cases matching this structure:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  renderQuotationEmailTemplate,
  validateQuotationEmailTemplate,
} from '../../api/_lib/quotation-email-template.js';

const renderInput = {
  customerName: '<Maria & Filhos>',
  businessNumber: 'ORC-42',
  publicUrl: 'https://app.example.com/api/public-quotation?token=abc',
};

test('default template preserves the current quotation email', () => {
  const rendered = renderQuotationEmailTemplate(DEFAULT_QUOTATION_EMAIL_TEMPLATE, renderInput);
  assert.equal(rendered.subject, 'Orçamento ORC-42 - Aspen');
  assert.match(rendered.html, /Olá, &lt;Maria &amp; Filhos&gt;\./);
  assert.match(rendered.html, /Segue o orçamento ORC-42 em anexo\./);
  assert.match(rendered.html, />Ver orçamento<\/a>/);
  assert.match(rendered.html, /Atenciosamente,<br>Aspen/);
  assert.match(rendered.text, /Ver orçamento: https:\/\/app\.example\.com/);
});

test('validator normalizes valid fields and rejects unknown tokens', () => {
  const valid = validateQuotationEmailTemplate({
    subject: '  Orçamento {{numero_orcamento}}  ',
    greeting: 'Olá, {{nome_cliente}}.',
    message: 'Linha 1\r\nLinha 2',
    button_label: 'Abrir',
    signature: '',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.message, 'Linha 1\nLinha 2');

  const invalid = validateQuotationEmailTemplate({
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    message: 'Olá, {{cliente_nome}}',
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.fields.message || '', /cliente_nome/);
});

test('validator enforces required fields and exact limits', () => {
  const invalid = validateQuotationEmailTemplate({
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    subject: '',
    message: 'M'.repeat(4001),
    button_label: 'B'.repeat(81),
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.fields.subject);
    assert.ok(invalid.fields.message);
    assert.ok(invalid.fields.button_label);
  }
});

test('renderer escapes configured text and omits optional empty blocks', () => {
  const rendered = renderQuotationEmailTemplate({
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    greeting: '',
    message: '<script>alert(1)</script>\nSegundo parágrafo',
    signature: '',
  }, renderInput);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /Atenciosamente/);
  assert.doesNotMatch(rendered.html, /<p><\/p>/);
});
```

- [ ] **Step 2: Run the domain test and confirm RED**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-email-template-domain.test.ts
```

Expected: FAIL because `api/_lib/quotation-email-template.ts` does not exist.

- [ ] **Step 3: Implement the pure shared module**

Create `api/_lib/quotation-email-template.ts` with these public contracts:

```ts
export interface QuotationEmailTemplate {
  subject: string;
  greeting: string;
  message: string;
  button_label: string;
  signature: string;
}

export type QuotationEmailTemplateField = keyof QuotationEmailTemplate;

export interface QuotationEmailRenderInput {
  customerName: string;
  businessNumber: string;
  publicUrl: string;
}

export interface RenderedQuotationEmail {
  subject: string;
  html: string;
  text: string;
}

export type QuotationEmailTemplateValidation =
  | { ok: true; value: QuotationEmailTemplate }
  | { ok: false; fields: Partial<Record<QuotationEmailTemplateField | '_form', string>> };

export const QUOTATION_EMAIL_TEMPLATE_LIMITS = Object.freeze({
  subject: 200,
  greeting: 500,
  message: 4000,
  button_label: 80,
  signature: 500,
} satisfies Record<QuotationEmailTemplateField, number>);

export const QUOTATION_EMAIL_TEMPLATE_TOKENS = Object.freeze([
  '{{nome_cliente}}',
  '{{numero_orcamento}}',
] as const);

export const DEFAULT_QUOTATION_EMAIL_TEMPLATE: Readonly<QuotationEmailTemplate> = Object.freeze({
  subject: 'Orçamento {{numero_orcamento}} - Aspen',
  greeting: 'Olá, {{nome_cliente}}.',
  message: 'Segue o orçamento {{numero_orcamento}} em anexo.',
  button_label: 'Ver orçamento',
  signature: 'Atenciosamente,\nAspen',
});

export function validateQuotationEmailTemplate(value: unknown): QuotationEmailTemplateValidation;

export function renderQuotationEmailTemplate(
  template: QuotationEmailTemplate,
  input: QuotationEmailRenderInput,
): RenderedQuotationEmail;
```

Implement validation with an exact field list, string type checks, CRLF normalization, outer trimming, required-field checks, per-field limits and `/{{[^{}]+}}/g` token inspection.
Reject unknown object keys through `_form` so API payloads cannot silently carry unsupported configuration.
Replace tokens before escaping rendered HTML.
Render each non-empty message line as a safe paragraph.
Render optional greeting and signature only when non-empty.
Generate text as non-empty blocks joined by two newlines, including `${button_label}: ${publicUrl}`.
Keep the current fixed button style and fixed HTML structure from `renderQuotationEmailHtml()`.

- [ ] **Step 4: Run focused tests and type checks**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-email-template-domain.test.ts
npx tsc --noEmit
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the shared domain**

```bash
git add api/_lib/quotation-email-template.ts tests/unit/quotation-email-template-domain.test.ts
git commit -m "feat(email): add template renderer"
```

---

### Task 2: Persist templates and preserve retry payloads

**Files:**

- Create: `api/_db/quotation-email-template-repository.ts`
- Modify: `api/_db/schema.ts`
- Modify: `api/_db/quotation-email-delivery-repository.ts`
- Modify: `api/_functions/lib/quotation-email.ts`
- Modify: `api/_functions/send-quotation-email.ts`
- Generate: `drizzle/0021_quotation_email_template.sql`
- Generate: `drizzle/meta/0021_snapshot.json`
- Modify through generator: `drizzle/meta/_journal.json`
- Modify: `tests/unit/settings-postgres.test.ts`
- Modify: `tests/unit/quotation-email-delivery-postgres.test.ts`
- Modify: `tests/unit/quotation-email.test.ts`
- Modify: `tests/unit/send-quotation-email.test.ts`

**Interfaces:**

- Consumes: Task 1 `QuotationEmailTemplate`, `DEFAULT_QUOTATION_EMAIL_TEMPLATE`, `validateQuotationEmailTemplate()` and `renderQuotationEmailTemplate()`.
- Produces: `QuotationEmailTemplateRepository`, `createPostgresQuotationEmailTemplateRepository()`, `QuotationEmailDelivery.templateSnapshot` and a rendered Resend transport input.

- [ ] **Step 1: Add failing repository and delivery snapshot assertions**

In `tests/unit/settings-postgres.test.ts`, import `createPostgresQuotationEmailTemplateRepository` and assert after migrations:

```ts
const templateRepository = createPostgresQuotationEmailTemplateRepository(() => db);
assert.deepEqual(await templateRepository.get(), DEFAULT_QUOTATION_EMAIL_TEMPLATE);

const customized = await templateRepository.save({
  ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  subject: 'Proposta {{numero_orcamento}}',
});
assert.equal(customized.subject, 'Proposta {{numero_orcamento}}');
assert.deepEqual(await templateRepository.get(), customized);
```

In `tests/unit/quotation-email-delivery-postgres.test.ts`, reserve with a template snapshot and assert terminal cleanup:

```ts
const templateSnapshot = {
  ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  subject: 'Proposta {{numero_orcamento}}',
};
const reserved = await repository.reserve({
  attemptId,
  revisionId,
  recipient: 'cliente@example.com',
  publicToken: 'stable-public-token',
  templateSnapshot,
});
assert.deepEqual(reserved.delivery.templateSnapshot, templateSnapshot);

const accepted = await repository.markAccepted({ attemptId, providerEmailId: 'email_123' });
assert.equal(accepted.templateSnapshot, null);
```

Add a corresponding failed transition assertion that `templateSnapshot` becomes `null`.

- [ ] **Step 2: Add failing send integration assertions**

Update `tests/unit/quotation-email.test.ts` so transport input supplies `subject`, `html` and `text`, then assert the Resend request contains all three.

Add these behaviors to `tests/unit/send-quotation-email.test.ts`:

```ts
test('new attempt reserves and renders the active global template', async () => {
  const calls: string[] = [];
  let transportInput: Record<string, unknown> | undefined;
  const activeTemplate = {
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    subject: 'Proposta {{numero_orcamento}}',
  };

  const result = await handler(event('POST', payload(), { host: 'app.example.com' }), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    templates: { get: async () => activeTemplate },
    issueToken: async () => acceptedToken(),
    transport: async input => {
      transportInput = input as unknown as Record<string, unknown>;
      return { id: 'email_123' };
    },
    token: () => 'stable-public-token',
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(transportInput?.subject, 'Proposta ORC-42');
});

test('pending retry reuses reserved template after the global template changes', async () => {
  const reservedTemplate = {
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    subject: 'Modelo reservado {{numero_orcamento}}',
  };
  let templateReads = 0;
  let subject = '';

  const result = await handler(event('POST', payload(), { host: 'app.example.com' }), {
    deliveries: fakeDeliveries([], { initial: delivery({ templateSnapshot: reservedTemplate }) }),
    snapshots: snapshots(snapshot()),
    templates: {
      get: async () => {
        templateReads += 1;
        return { ...DEFAULT_QUOTATION_EMAIL_TEMPLATE, subject: 'Modelo novo' };
      },
    },
    issueToken: async () => acceptedToken(),
    transport: async input => {
      subject = input.subject;
      return { id: 'email_123' };
    },
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(templateReads, 0);
  assert.equal(subject, 'Modelo reservado ORC-42');
});
```

Update `delivery()` so pending fixtures default to `{ ...DEFAULT_QUOTATION_EMAIL_TEMPLATE }` and accepted or failed fixtures default to `null` for `templateSnapshot`.
Update `fakeDeliveries()` so first reservation persists `input.templateSnapshot`, existing pending rows return their stored snapshot and terminal transitions clear it.
Add a template read failure test with a `calls` array and provider boolean, then assert HTTP `500`, body `{ error: 'Erro interno. Tente novamente.' }`, no `reserve` call and no provider call.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-email.test.ts tests/unit/send-quotation-email.test.ts tests/unit/quotation-email-delivery-postgres.test.ts tests/unit/settings-postgres.test.ts
```

Expected: unit tests FAIL on missing repository, fields and rendered transport contract.
PostgreSQL tests may be SKIP when `TEST_DATABASE_URL` is absent.

- [ ] **Step 4: Extend the Drizzle schema**

In `api/_db/schema.ts`, import the shared template type and default using explicit `.js` extension.
Add to `appSettings`:

```ts
quotationEmailTemplate: jsonb('quotation_email_template')
  .$type<QuotationEmailTemplate>()
  .notNull()
  .default(DEFAULT_QUOTATION_EMAIL_TEMPLATE),
```

Add to `quotationEmailDeliveries`:

```ts
templateSnapshot: jsonb('template_snapshot').$type<QuotationEmailTemplate>(),
```

Add this state invariant:

```ts
check(
  'quotation_email_deliveries_template_snapshot_check',
  sql`(${table.state} = 'pending' AND ${table.templateSnapshot} IS NOT NULL) OR (${table.state} IN ('accepted', 'failed') AND ${table.templateSnapshot} IS NULL)`,
),
```

- [ ] **Step 5: Generate and inspect migration 0021**

Run:

```bash
npm run db:generate -- --name quotation_email_template
```

Expected generated files:

```text
drizzle/0021_quotation_email_template.sql
drizzle/meta/0021_snapshot.json
drizzle/meta/_journal.json
```

Before the generated snapshot constraint is added, ensure the new migration backfills historical pending attempts with the current default:

```sql
UPDATE "quotation_email_deliveries"
SET "template_snapshot" = '{"subject":"Orçamento {{numero_orcamento}} - Aspen","greeting":"Olá, {{nome_cliente}}.","message":"Segue o orçamento {{numero_orcamento}} em anexo.","button_label":"Ver orçamento","signature":"Atenciosamente,\nAspen"}'::jsonb
WHERE "state" = 'pending' AND "template_snapshot" IS NULL;
```

Do not alter migrations `0000` through `0020`.
Run `git diff -- drizzle/` and verify the migration adds only `quotation_email_template`, `template_snapshot`, the backfill and the new check constraint.

- [ ] **Step 6: Implement the global template repository**

Create `api/_db/quotation-email-template-repository.ts` with:

```ts
import { eq } from 'drizzle-orm';
import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  validateQuotationEmailTemplate,
  type QuotationEmailTemplate,
} from '../_lib/quotation-email-template.js';
import { getDatabase, type AppDatabase } from './client.js';
import { appSettings } from './schema.js';

export interface QuotationEmailTemplateRepository {
  get(): Promise<QuotationEmailTemplate>;
  save(template: QuotationEmailTemplate): Promise<QuotationEmailTemplate>;
}

type DatabaseProvider = () => AppDatabase;

function normalized(value: unknown): QuotationEmailTemplate {
  const result = validateQuotationEmailTemplate(value);
  if (!result.ok) throw new Error('Modelo de e-mail armazenado inválido.');
  return result.value;
}

export function createPostgresQuotationEmailTemplateRepository(
  getDb: DatabaseProvider = getDatabase,
): QuotationEmailTemplateRepository {
  return {
    async get() {
      const [row] = await getDb()
        .select({ template: appSettings.quotationEmailTemplate })
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1))
        .limit(1);
      return row ? normalized(row.template) : { ...DEFAULT_QUOTATION_EMAIL_TEMPLATE };
    },
    async save(template) {
      const value = normalized(template);
      const [row] = await getDb()
        .insert(appSettings)
        .values({ singletonId: 1, quotationEmailTemplate: value })
        .onConflictDoUpdate({
          target: appSettings.singletonId,
          set: { quotationEmailTemplate: value },
        })
        .returning({ template: appSettings.quotationEmailTemplate });
      if (!row) throw new Error('Modelo de e-mail não foi salvo.');
      return normalized(row.template);
    },
  };
}
```

Do not log the invalid stored value.

- [ ] **Step 7: Persist the pending delivery snapshot**

Extend `ReserveInput` with required `templateSnapshot: QuotationEmailTemplate`.
Extend `QuotationEmailDelivery` with `templateSnapshot: QuotationEmailTemplate | null`.
Validate the input through `validateQuotationEmailTemplate()` and reject invalid snapshots with `QuotationEmailDeliveryInputError`.
Insert the normalized snapshot during `reserve()`.
Map it in `toDelivery()`.
Set `templateSnapshot: null` in both `transitionAccepted()` and `transitionFailed()`.
Keep uncertain provider results pending so the snapshot remains available.

- [ ] **Step 8: Separate rendering from the Resend transport**

Change `SendQuotationEmailTransportInput` in `api/_functions/lib/quotation-email.ts` to:

```ts
export interface SendQuotationEmailTransportInput {
  recipient: string;
  businessNumber: string;
  attachmentUrl: string;
  attemptId: string;
  subject: string;
  html: string;
  text: string;
}
```

Remove `renderQuotationEmailHtml()` and its private escaping helper from this provider module.
Send these exact payload fields:

```ts
body: JSON.stringify({
  from,
  to: [input.recipient],
  subject: input.subject,
  html: input.html,
  text: input.text,
  ...(replyTo ? { reply_to: replyTo } : {}),
  attachments: [{
    filename: `orcamento-${input.businessNumber}.pdf`,
    path: attachmentUrl.toString(),
  }],
}),
```

Keep HTTPS/PDF validation, timeout, provider error classification and idempotency key unchanged.

- [ ] **Step 9: Load, reserve and render the correct template in the send handler**

Add `templates?: Pick<QuotationEmailTemplateRepository, 'get'>` to `SendQuotationEmailDependencies`.
For an existing pending delivery, do not read the global template.
For a new attempt, read the active template before reservation.
Always render from `reservation.delivery.templateSnapshot` after `reserve()` so concurrent requests use the winning snapshot.
Use this control flow:

```ts
const templates = dependencies.templates || createPostgresQuotationEmailTemplateRepository();
const templateForReservation = existing?.templateSnapshot || await templates.get();
const createPublicToken = dependencies.token || (() => randomBytes(32).toString('base64url'));
const publicTokenForReservation = existing?.publicToken || createPublicToken();

const reservation = await deliveries.reserve({
  attemptId,
  revisionId,
  recipient: normalizedRecipient,
  publicToken: publicTokenForReservation,
  templateSnapshot: templateForReservation,
});

const template = reservation.delivery.templateSnapshot;
if (!template) return internalErrorResponse();

const rendered = renderQuotationEmailTemplate(template, {
  customerName: snapshot.revision.clienteNome || 'Cliente',
  businessNumber: snapshot.quotation.businessNumber,
  publicUrl,
});

sent = await transport({
  recipient: normalizedRecipient,
  businessNumber: snapshot.quotation.businessNumber,
  attachmentUrl,
  attemptId,
  ...rendered,
}, { env: dependencies.env });
```

Preserve the existing token reservation order, conflict checks, accepted/failed short circuits and ambiguous retry behavior.
Do not generate a second public token for an existing pending attempt.
Do not include template content in `logFailure()`.

- [ ] **Step 10: Run focused verification**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-email-template-domain.test.ts tests/unit/quotation-email.test.ts tests/unit/send-quotation-email.test.ts tests/unit/quotation-email-delivery-postgres.test.ts tests/unit/settings-postgres.test.ts
npm run type-check
```

Expected: all non-database tests PASS.
Database tests PASS when `TEST_DATABASE_URL` is configured and otherwise report SKIP.

- [ ] **Step 11: Commit persistence and sending**

```bash
git add api/_lib/quotation-email-template.ts api/_db/schema.ts api/_db/quotation-email-template-repository.ts api/_db/quotation-email-delivery-repository.ts api/_functions/lib/quotation-email.ts api/_functions/send-quotation-email.ts drizzle/0021_quotation_email_template.sql drizzle/meta/0021_snapshot.json drizzle/meta/_journal.json tests/unit/settings-postgres.test.ts tests/unit/quotation-email-delivery-postgres.test.ts tests/unit/quotation-email.test.ts tests/unit/send-quotation-email.test.ts
git commit -m "feat(email): persist configurable template"
```

---

### Task 3: Expose the template configuration API

**Files:**

- Create: `api/_functions/quotation-email-template.ts`
- Create: `tests/unit/quotation-email-template.test.ts`
- Modify: `api/[...path].ts`
- Modify: `scripts/dev-api-server.mjs`
- Modify: `scripts/app-server.mjs`

**Interfaces:**

- Consumes: Task 1 validator and Task 2 `QuotationEmailTemplateRepository`.
- Produces: `GET /api/quotation-email-template` and `PUT /api/quotation-email-template`.

- [ ] **Step 1: Write failing handler tests**

Create an in-memory repository and cover GET, normalized PUT, invalid JSON, field errors, unknown keys, safe repository failure and `405`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_QUOTATION_EMAIL_TEMPLATE } from '../../api/_lib/quotation-email-template.js';
import { createHandler } from '../../api/_functions/quotation-email-template.js';

function event(method: string, body?: unknown) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  };
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}');
}

test('GET returns the effective template', async () => {
  const handler = createHandler({
    repository: {
      get: async () => ({ ...DEFAULT_QUOTATION_EMAIL_TEMPLATE }),
      save: async value => value,
    },
  });
  const result = await handler(event('GET'));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(parse(result), DEFAULT_QUOTATION_EMAIL_TEMPLATE);
});

test('PUT rejects unknown tokens with field errors without saving', async () => {
  let saves = 0;
  const handler = createHandler({
    repository: {
      get: async () => ({ ...DEFAULT_QUOTATION_EMAIL_TEMPLATE }),
      save: async value => {
        saves += 1;
        return value;
      },
    },
  });
  const result = await handler(event('PUT', {
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    message: 'Olá, {{cliente_nome}}',
  }));
  assert.equal(result.statusCode, 400);
  assert.match(parse(result).fields.message, /cliente_nome/);
  assert.equal(saves, 0);
});
```

- [ ] **Step 2: Run handler tests and confirm RED**

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-email-template.test.ts
```

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement the handler**

Expose `createHandler(dependencies)` and `handler` following `api/_functions/settings.ts`.
Use these response contracts:

```ts
// GET 200 or PUT 200
QuotationEmailTemplate

// PUT 400
{
  error: 'Revise os campos destacados.',
  fields: Partial<Record<QuotationEmailTemplateField | '_form', string>>,
}

// persistence 500
{ error: 'Não foi possível carregar o modelo de e-mail. Tente novamente.' }
{ error: 'Não foi possível salvar o modelo de e-mail. Tente novamente.' }
```

Accept only `GET` and `PUT`.
Return `Allow: GET, PUT` on `405`.
Parse JSON only for PUT.
Validate before calling `repository.save()`.
Log only the operation category, never the payload or raw database error.

- [ ] **Step 4: Register all route maps**

Add the same import and route key to:

```text
api/[...path].ts
scripts/dev-api-server.mjs
scripts/app-server.mjs
```

Use key:

```ts
'quotation-email-template': quotationEmailTemplate,
```

- [ ] **Step 5: Run focused tests and route checks**

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-email-template.test.ts tests/unit/settings-app-server.test.ts
node - <<'NODE'
const fs = require('fs');
for (const file of ['api/[...path].ts', 'scripts/dev-api-server.mjs', 'scripts/app-server.mjs']) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes("'quotation-email-template'")) throw new Error(`route missing: ${file}`);
}
console.log('all route maps contain quotation-email-template');
NODE
```

Expected: all tests and route assertions PASS.

- [ ] **Step 6: Commit the API**

```bash
git add api/_functions/quotation-email-template.ts api/'[...path].ts' scripts/dev-api-server.mjs scripts/app-server.mjs tests/unit/quotation-email-template.test.ts
git commit -m "feat(email): expose template settings API"
```

---

### Task 4: Build the Communication editor and navigation guards

**Files:**

- Create: `src/lib/quotationEmailTemplateApi.ts`
- Create: `src/components/communication/QuotationEmailTemplateTab.tsx`
- Modify: `src/pages/ComunicacaoPage.tsx`
- Modify: `src/hooks/useHashRoute.ts`
- Modify: `src/App.tsx`

**Interfaces:**

- Consumes: Task 1 shared contracts and renderer, Task 3 API.
- Produces: `getQuotationEmailTemplate()`, `saveQuotationEmailTemplate()`, `QuotationEmailTemplateTab({ onDirtyChange })` and app-level dirty navigation guard registration.

- [ ] **Step 1: Add the frontend API facade**

Create `src/lib/quotationEmailTemplateApi.ts`:

```ts
import { apiGet, apiPut } from '@/lib/api';

export {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  QUOTATION_EMAIL_TEMPLATE_LIMITS,
  QUOTATION_EMAIL_TEMPLATE_TOKENS,
  renderQuotationEmailTemplate,
  validateQuotationEmailTemplate,
} from '../../api/_lib/quotation-email-template.js';
export type {
  QuotationEmailTemplate,
  QuotationEmailTemplateField,
} from '../../api/_lib/quotation-email-template.js';

import type { QuotationEmailTemplate } from '../../api/_lib/quotation-email-template.js';

export function getQuotationEmailTemplate(): Promise<QuotationEmailTemplate> {
  return apiGet<QuotationEmailTemplate>('/quotation-email-template');
}

export function saveQuotationEmailTemplate(
  template: QuotationEmailTemplate,
): Promise<QuotationEmailTemplate> {
  return apiPut<QuotationEmailTemplate>('/quotation-email-template', template);
}
```

Run `npx tsc --noEmit` immediately and keep the explicit `.js` cross-boundary import resolved by the existing `moduleResolution: "bundler"` configuration.
Do not duplicate the domain rules in `src/`.

- [ ] **Step 2: Implement guarded hash navigation**

Extend `src/hooks/useHashRoute.ts` with:

```ts
export type HashRouteGuard = (nextRoute: string) => boolean;
export type SetHashRouteGuard = (guard: HashRouteGuard | null) => void;

export function useHashRoute(): [
  string,
  (hash: string) => void,
  SetHashRouteGuard,
];
```

Use one pre-approved route ref so programmatic navigation does not show the confirmation twice:

```ts
const normalizeHash = (hash: string) => hash.replace(/^#/, '') || '/auto';
const initialRoute = normalizeHash(window.location.hash);
const [route, setRoute] = useState(initialRoute);
const routeRef = useRef(initialRoute);
const guardRef = useRef<HashRouteGuard | null>(null);
const approvedRouteRef = useRef<string | null>(null);

const setNavigationGuard = useCallback<SetHashRouteGuard>((guard) => {
  guardRef.current = guard;
}, []);

const canNavigate = useCallback((nextRoute: string) => (
  nextRoute === routeRef.current || !guardRef.current || guardRef.current(nextRoute)
), []);

useEffect(() => {
  const onHashChange = () => {
    const nextRoute = normalizeHash(window.location.hash);
    const preApproved = approvedRouteRef.current === nextRoute;
    approvedRouteRef.current = null;
    if (!preApproved && !canNavigate(nextRoute)) {
      history.replaceState(null, '', `#${routeRef.current}`);
      return;
    }
    routeRef.current = nextRoute;
    setRoute(nextRoute);
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}, [canNavigate]);

const navigate = useCallback((hash: string) => {
  const nextRoute = normalizeHash(hash);
  if (nextRoute === routeRef.current || !canNavigate(nextRoute)) return;
  approvedRouteRef.current = nextRoute;
  window.location.hash = nextRoute;
}, [canNavigate]);
```

Return `[route, navigate, setNavigationGuard]`.
Update `src/App.tsx` so `renderPage()` receives `setNavigationGuard` and passes it only to `ComunicacaoPage`.
Keep other page signatures unchanged.

- [ ] **Step 3: Implement the template editor component**

Create `QuotationEmailTemplateTab` with this public prop:

```ts
interface QuotationEmailTemplateTabProps {
  onDirtyChange?: (dirty: boolean) => void;
}
```

Use these state groups:

```ts
const [saved, setSaved] = useState<QuotationEmailTemplate | null>(null);
const [form, setForm] = useState<QuotationEmailTemplate | null>(null);
const [fieldErrors, setFieldErrors] = useState<Partial<Record<QuotationEmailTemplateField | '_form', string>>>({});
const [loadError, setLoadError] = useState('');
const [saveError, setSaveError] = useState('');
const [success, setSuccess] = useState('');
const [loading, setLoading] = useState(true);
const [saving, setSaving] = useState(false);
const [restoreOpen, setRestoreOpen] = useState(false);
```

Compute dirty state by comparing the five fixed fields, not by object identity.
Notify `onDirtyChange(dirty)` in an effect.
Register `beforeunload` only while dirty using `event.preventDefault()` and `event.returnValue = ''`, then remove the listener in cleanup.

Load with `getQuotationEmailTemplate()`.
On failure, disable the form and show `Não foi possível carregar o modelo de e-mail.` plus `Tentar novamente`.
Do not initialize an editable fallback after a failed GET.

Render labeled controls with exact labels:

```text
Assunto
Saudação
Mensagem principal
Texto do botão
Assinatura
```

Use an `<input>` for subject and button label.
Use `<textarea>` for greeting, message and signature.
Show character count and field error for each control.
Use `aria-invalid` and `aria-describedby`.

Add variable insertion buttons labeled:

```text
Inserir nome do cliente
Inserir número do orçamento
```

Insert at `selectionStart` and `selectionEnd` of the last focused input or textarea, defaulting to `message` when no field has been focused.
Restore focus and cursor in `requestAnimationFrame()`.

Validate client-side with `validateQuotationEmailTemplate()` before PUT.
Focus the first invalid field in this order: subject, greeting, message, button label, signature.
If the API returns `ApiError.data.fields`, display those server field errors without losing the form.
After success, assign the normalized response to both `saved` and `form`, clear errors and show role `status` text `Modelo salvo. Os próximos envios usarão esta configuração.`.

Use `ConfirmDialog` for restoration:

```tsx
<ConfirmDialog
  open={restoreOpen}
  title="Restaurar modelo padrão?"
  message="O formulário será restaurado, mas a alteração só será ativada após salvar."
  confirmLabel="Restaurar padrão"
  cancelLabel="Continuar editando"
  variant="default"
  onConfirm={() => {
    setForm({ ...DEFAULT_QUOTATION_EMAIL_TEMPLATE });
    setRestoreOpen(false);
  }}
  onCancel={() => setRestoreOpen(false)}
/>
```

Render the preview through `renderQuotationEmailTemplate(form, previewInput)` with:

```ts
const previewInput = {
  customerName: 'Maria Silva',
  businessNumber: 'ORC-20260001',
  publicUrl: 'https://example.invalid/orcamento',
};
```

Place rendered HTML in a sandboxed iframe with `title="Preview do e-mail"` and `className="pointer-events-none"`.
Show a separate visual row `Anexo: orcamento-ORC-20260001.pdf`.
Use responsive classes equivalent to `grid gap-6 lg:grid-cols-2`.

- [ ] **Step 4: Add the tab and tab-discard confirmation**

Modify `ComunicacaoPage` props:

```ts
interface ComunicacaoPageProps {
  setNavigationGuard?: SetHashRouteGuard;
}
```

Add a `Mail` icon tab:

```ts
{ id: 'email-template', label: 'E-mail de orçamento', icon: Mail }
```

Track `emailTemplateDirty` and `pendingTabId`.
When dirty and another tab is clicked, leave the active tab unchanged and open `ConfirmDialog` with:

```text
Title: Descartar alterações?
Message: Existem alterações não salvas no modelo de e-mail.
Confirm: Descartar alterações
Cancel: Continuar editando
```

On confirm, clear dirty state and activate the pending tab.
On cancel, retain the editor and form.

While dirty, register this app route guard:

```ts
() => window.confirm('Existem alterações não salvas. Descartar alterações?')
```

Clear the guard when the form becomes clean and during unmount.
Render:

```tsx
{activeTab === 'email-template' && (
  <QuotationEmailTemplateTab onDirtyChange={setEmailTemplateDirty} />
)}
```

- [ ] **Step 5: Run static verification**

```bash
npx tsc --noEmit
npm run type-check
npm run lint
npm run build
```

Expected: all commands PASS.
Do not stage generated Vite files under `public/`.

- [ ] **Step 6: Commit the frontend**

```bash
git add src/lib/quotationEmailTemplateApi.ts src/components/communication/QuotationEmailTemplateTab.tsx src/pages/ComunicacaoPage.tsx src/hooks/useHashRoute.ts src/App.tsx
git commit -m "feat(email): add template editor"
```

---

### Task 5: Prove the complete user flow

**Files:**

- Create: `tests/communication-email-template.spec.js`
- Modify only if a proven defect requires it: files from Tasks 1 through 4.

**Interfaces:**

- Consumes: all previous tasks.
- Produces: browser-level acceptance evidence without Resend calls.

- [ ] **Step 1: Write Playwright coverage with a controlled API**

Create `tests/communication-email-template.spec.js` with an in-memory template route:

```js
// @ts-check
import { expect, test } from '@playwright/test';

const DEFAULT_TEMPLATE = {
  subject: 'Orçamento {{numero_orcamento}} - Aspen',
  greeting: 'Olá, {{nome_cliente}}.',
  message: 'Segue o orçamento {{numero_orcamento}} em anexo.',
  button_label: 'Ver orçamento',
  signature: 'Atenciosamente,\nAspen',
};

async function mockTemplateApi(page) {
  let template = { ...DEFAULT_TEMPLATE };
  const puts = [];
  await page.route('**/api/quotation-email-template', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(template) });
      return;
    }
    const payload = route.request().postDataJSON();
    puts.push(payload);
    template = { ...payload };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(template) });
  });
  return { puts, current: () => template };
}
```

Add separate tests for:

1. Loading the new tab and rendering `Maria Silva`, `ORC-20260001` and the PDF row in the preview.
2. Inserting both allowed variables at the current cursor.
3. Rejecting `{{cliente_nome}}` without issuing a PUT and focusing `Mensagem principal`.
4. Restoring the default only in the form, then saving it explicitly.
5. Saving a valid change and showing the success status.
6. Preserving typed content when PUT returns HTTP `500`.
7. Blocking tab switch until the operator confirms discard.
8. Blocking sidebar navigation through the native confirmation while dirty.
9. Showing load failure with disabled editing and succeeding after `Tentar novamente`.

Use iframe assertions through:

```js
const preview = page.frameLocator('iframe[title="Preview do e-mail"]');
await expect(preview.getByText('Maria Silva')).toBeVisible();
await expect(preview.getByText('ORC-20260001')).toBeVisible();
```

Use `page.on('dialog', dialog => dialog.dismiss())` for the first navigation attempt and accept a second attempt.
Do not intercept or call `/api/send-quotation-email`.

- [ ] **Step 2: Run the focused E2E and confirm behavior**

```bash
npx playwright test tests/communication-email-template.spec.js --project=chromium
```

Expected: all new tests PASS.
Inspect screenshots/traces for spacing, wrapping, focus visibility, mobile stacking and preview clipping if any test fails.
Fix root causes only.

- [ ] **Step 3: Run email and quotation regression suites**

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-email-template-domain.test.ts tests/unit/quotation-email-template.test.ts tests/unit/quotation-email.test.ts tests/unit/send-quotation-email.test.ts tests/unit/quotation-email-delivery-postgres.test.ts tests/unit/settings-postgres.test.ts
npx playwright test tests/communication-email-template.spec.js tests/quotation-lifecycle.spec.js --project=chromium
```

Expected: all non-database tests PASS and database tests PASS or explicitly SKIP only because `TEST_DATABASE_URL` is absent.

- [ ] **Step 4: Commit E2E evidence**

```bash
git add tests/communication-email-template.spec.js
git commit -m "test(email): cover template editor flow"
```

- [ ] **Step 5: Run the complete quality gate**

```bash
npm run test:unit
npm run lint
npm run type-check
npm run build
node scripts/check-no-legacy-provider.mjs
npx playwright test tests/communication-email-template.spec.js tests/quotation-lifecycle.spec.js --project=chromium
if [ -n "$(git status --porcelain -- public/)" ]; then git restore --worktree public/; fi
git diff --check
git status --short --branch
```

Expected:

```text
All unit tests pass, except documented PostgreSQL skips when no dedicated TEST_DATABASE_URL exists.
Lint, type-check, build and legacy-provider check pass.
Focused Playwright suites pass.
Git diff check is empty.
Worktree contains no uncommitted source, migration or test files.
```

Run Pi `lens_diagnostics` with `mode=all` and fix every blocking diagnostic before completion.
Do not deploy, apply the migration to a real database or send a real e-mail during this task.
