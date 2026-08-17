# Envio de orçamento por e-mail com Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar a revisão emitida de um orçamento por e-mail via Resend, com PDF, link público e marcador por revisão em `/orcamentos`.

**Architecture:** Uma tabela PostgreSQL registra tentativas idempotentes sem alterar a entrega WhatsApp.
Um endpoint Vercel prepara o snapshot e duas URLs assinadas para a mesma revisão, chama a API HTTP da Resend com `fetch` e confirma o estado somente após receber o identificador do provedor.
As APIs de orçamento projetam o último envio aceito da revisão atual para a página individual e para a listagem.

**Tech Stack:** TypeScript ESM, Node.js `fetch`, Vercel Functions, PostgreSQL, Drizzle ORM, React 19, Playwright e `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-17-envio-orcamento-email-resend-design.md`

## Global Constraints

- Não adicionar o pacote `resend` nem qualquer outra dependência.
- Usar somente a API HTTP da Resend por meio do `fetch` nativo do Node.js.
- Não alterar a tabela nem o fluxo de entrega WhatsApp.
- O marcador significa aceitação pela Resend, não entrega, abertura ou leitura.
- O marcador pertence somente à revisão atual.
- O e-mail contém o PDF e o link público da mesma revisão emitida.
- Todas as mensagens de erro ao usuário ficam em português brasileiro.
- Nenhuma resposta ou log expõe chave, stack trace, erro do banco, PDF ou dados de outro cliente.
- Não editar migrações históricas em `drizzle/`.
- Manter os três mapas de rotas sincronizados.
- Manter arquivos de ambiente fora do checkout.
- Reutilizar `normalizeClientEmail`, `issuePublicQuotationToken`, o PDF do endpoint público e os componentes UI existentes.

---

## Mapa de arquivos

### Novos arquivos

- `api/_db/quotation-email-delivery-repository.ts`: reserva tentativas, aplica transições idempotentes e lê o estado persistido.
- `api/_functions/lib/quotation-email.ts`: renderiza HTML seguro e encapsula a chamada HTTP da Resend.
- `api/_functions/send-quotation-email.ts`: valida HTTP, prepara a revisão e coordena persistência e transporte.
- `src/components/quotation/QuotationEmailDialog.tsx`: diálogo acessível para confirmar ou editar o destinatário.
- `tests/unit/quotation-email-delivery-postgres.test.ts`: integração PostgreSQL da nova persistência.
- `tests/unit/quotation-email.test.ts`: HTML, limite do PDF e contrato HTTP da Resend.
- `tests/unit/send-quotation-email.test.ts`: contrato e orquestração do endpoint.

### Arquivos modificados

- `api/_db/schema.ts`: tabela e índices de tentativas de e-mail.
- `api/_db/quote-draft-management-repository.ts`: projeta `email_sent` e `email_sent_at` da revisão atual.
- `api/_functions/lib/quotation-document-storage.ts`: exporta o limite de PDF já usado no produto.
- `api/_db/quotation-delivery-repository.ts`: importa o limite compartilhado sem mudar comportamento WhatsApp.
- `api/_functions/public-quotation.ts`: aplica o limite compartilhado ao PDF servido pela URL assinada.
- `tests/unit/public-quotation.test.ts`: valida rejeição de PDF acima do limite.
- `api/[...path].ts`: rota implantada.
- `scripts/dev-api-server.mjs`: rota do servidor API local.
- `scripts/app-server.mjs`: rota do servidor completo local.
- `tests/unit/route-map.test.ts`: nova contagem e rota obrigatória.
- `src/lib/localProjections.ts`: projeta os campos de e-mail com fallback compatível.
- `src/pages/QuotationDetailPage.tsx`: botão, estado e envio.
- `src/pages/QuotationsPage.tsx`: marcadores desktop e mobile.
- `tests/quotation-lifecycle.spec.js`: fluxo do diálogo e tratamento de falha.
- `tests/quotations-core.spec.js`: marcadores da listagem em desktop e mobile.
- `scripts/cutover-env-status.mjs`: presença das configurações obrigatórias.
- `tests/unit/cutover-env-status.test.js`: garante preflight sem exposição de valores.
- `tests/unit/quotation-schema.test.ts`: contrato estrutural da tabela.
- `tests/unit/quotations-postgres.test.ts`: projeção por revisão.
- `drizzle/0020_quotation_email_deliveries.sql`: migração gerada.
- `drizzle/meta/0020_snapshot.json`: snapshot gerado.
- `drizzle/meta/_journal.json`: journal atualizado pelo Drizzle Kit.

---

### Task 1: Persistir tentativas idempotentes de e-mail

**Files:**

- Modify: `api/_db/schema.ts:403-424`
- Create: `api/_db/quotation-email-delivery-repository.ts`
- Modify: `tests/unit/quotation-schema.test.ts:5-62`
- Create: `tests/unit/quotation-email-delivery-postgres.test.ts`
- Create: `drizzle/0020_quotation_email_deliveries.sql`
- Create: `drizzle/meta/0020_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**

- Consumes: `getDatabase(): AppDatabase`, `quoteRevisions.id` e UUIDs fornecidos pelo endpoint.
- Produces: `QuotationEmailDelivery`, `QuotationEmailDeliveryRepository` e `createPostgresQuotationEmailDeliveryRepository()`.

```ts
export type QuotationEmailDeliveryState = 'pending' | 'accepted' | 'failed';

export interface QuotationEmailDelivery {
  id: string;
  revisionId: string;
  recipient: string;
  publicToken: string | null;
  state: QuotationEmailDeliveryState;
  providerEmailId: string | null;
  publicError: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotationEmailDeliveryRepository {
  get(attemptId: string): Promise<QuotationEmailDelivery | null>;
  reserve(input: {
    attemptId: string;
    revisionId: string;
    recipient: string;
    publicToken: string;
  }): Promise<{ kind: 'reserved' | 'existing'; delivery: QuotationEmailDelivery }>;
  markAccepted(input: {
    attemptId: string;
    providerEmailId: string;
  }): Promise<QuotationEmailDelivery>;
  markFailed(input: {
    attemptId: string;
    publicError: string;
  }): Promise<QuotationEmailDelivery>;
}
```

- [ ] **Step 1: Escrever o teste estrutural que falha**

Adicionar em `tests/unit/quotation-schema.test.ts`:

```ts
import { quotationEmailDeliveries } from '../../api/_db/schema.js';

const emailDeliveryConfig = getTableConfig(quotationEmailDeliveries);
assert.equal(quotationEmailDeliveries.id.name, 'id');
assert.equal(quotationEmailDeliveries.revisionId.name, 'revision_id');
assert.equal(quotationEmailDeliveries.providerEmailId.name, 'provider_email_id');
assert.equal(quotationEmailDeliveries.publicToken.name, 'public_token');
assert.equal(quotationEmailDeliveries.providerEmailId.isUnique, true);
const emailStateCheck = emailDeliveryConfig.checks.find(
  (item) => item.name === 'quotation_email_deliveries_state_check'
);
assert.ok(emailStateCheck);
assert.equal(renderCheck(emailStateCheck), "state IN ('pending', 'accepted', 'failed')");
```

- [ ] **Step 2: Executar o teste estrutural e confirmar a falha**

Run: `npm run build:api && node --test tests/unit/quotation-schema.test.ts`

Expected: FAIL porque `quotationEmailDeliveries` ainda não existe.

- [ ] **Step 3: Adicionar tabela e índices ao schema**

Adicionar em `api/_db/schema.ts` após `quotationDeliveries`:

```ts
export const quotationEmailDeliveries = pgTable(
  'quotation_email_deliveries',
  {
    id: uuid('id').primaryKey(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id, { onDelete: 'cascade' }),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    publicToken: text('public_token'),
    state: text('state').notNull(),
    providerEmailId: text('provider_email_id').unique(),
    publicError: text('public_error'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'quotation_email_deliveries_state_check',
      sql`${table.state} IN ('pending', 'accepted', 'failed')`
    ),
    check(
      'quotation_email_deliveries_public_token_check',
      sql`(${table.state} = 'pending' AND btrim(${table.publicToken}) <> '') OR (${table.state} IN ('accepted', 'failed') AND ${table.publicToken} IS NULL)`
    ),
    index('quotation_email_deliveries_revision_state_accepted_idx').on(
      table.revisionId,
      table.state,
      table.acceptedAt
    ),
  ]
);
```

Importar `index` de `drizzle-orm/pg-core` se ainda não estiver importado.

- [ ] **Step 4: Gerar a migração**

Run: `npm run db:generate -- --name quotation_email_deliveries`

Expected: criação de `drizzle/0020_quotation_email_deliveries.sql`, `drizzle/meta/0020_snapshot.json` e atualização de `drizzle/meta/_journal.json`.

Confirmar que o SQL contém apenas criação da nova tabela, check, índice, unique e foreign key.

- [ ] **Step 5: Escrever o teste PostgreSQL de reserva e transições**

Em `tests/unit/quotation-email-delivery-postgres.test.ts`, usar o mesmo bootstrap isolado de banco e limpeza de `tests/unit/quotation-delivery-postgres.test.ts`.
Criar uma revisão emitida, depois executar estas asserções:

```ts
const repository = createPostgresQuotationEmailDeliveryRepository(() => db, {
  now: () => new Date('2026-08-17T12:00:00.000Z'),
});

const first = await repository.reserve({
  attemptId,
  revisionId,
  recipient: 'cliente@example.com',
  publicToken: 'stable-public-token',
});
assert.equal(first.kind, 'reserved');
assert.equal(first.delivery.state, 'pending');
assert.equal(first.delivery.publicToken, 'stable-public-token');

const duplicate = await repository.reserve({
  attemptId,
  revisionId,
  recipient: 'cliente@example.com',
  publicToken: 'discarded-racing-token',
});
assert.equal(duplicate.kind, 'existing');
assert.equal(duplicate.delivery.id, attemptId);
assert.equal(duplicate.delivery.publicToken, 'stable-public-token');

await assert.rejects(
  repository.reserve({
    attemptId,
    revisionId: secondRevisionId,
    recipient: 'outro@example.com',
    publicToken: 'other-public-token',
  }),
  /identificador.*outra tentativa/i
);

const accepted = await repository.markAccepted({
  attemptId,
  providerEmailId: 'resend-email-1',
});
assert.equal(accepted.state, 'accepted');
assert.equal(accepted.publicToken, null);
assert.equal(accepted.acceptedAt?.toISOString(), '2026-08-17T12:00:00.000Z');

const repeated = await repository.markAccepted({
  attemptId,
  providerEmailId: 'resend-email-1',
});
assert.equal(repeated.state, 'accepted');

await assert.rejects(
  repository.markFailed({ attemptId, publicError: 'Falha conhecida.' }),
  /já aceita/i
);
```

Adicionar uma segunda tentativa e verificar `pending -> failed` e repetição idempotente de `failed`.

- [ ] **Step 6: Executar o teste PostgreSQL e confirmar a falha**

Run: `npm run build:api && node --test tests/unit/quotation-email-delivery-postgres.test.ts`

Expected: FAIL porque o repositório ainda não existe.
O teste pode ficar SKIP quando `TEST_DATABASE_URL` não estiver configurado, seguindo a convenção atual.

- [ ] **Step 7: Implementar o repositório mínimo**

Em `api/_db/quotation-email-delivery-repository.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from './client.js';
import { quotationEmailDeliveries } from './schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DatabaseProvider = () => AppDatabase;

export class QuotationEmailDeliveryInputError extends Error {}
export class QuotationEmailDeliveryConflictError extends Error {}
export class QuotationEmailDeliveryNotFoundError extends Error {}
export class QuotationEmailDeliveryRepositoryError extends Error {}

export function createPostgresQuotationEmailDeliveryRepository(
  getDb: DatabaseProvider = getDatabase,
  options: { now?: () => Date } = {}
): QuotationEmailDeliveryRepository {
  const now = options.now || (() => new Date());

  return {
    async get(attemptId) {
      if (!UUID.test(attemptId)) throw new QuotationEmailDeliveryInputError('Tentativa inválida.');
      const [row] = await getDb()
        .select()
        .from(quotationEmailDeliveries)
        .where(eq(quotationEmailDeliveries.id, attemptId))
        .limit(1);
      return row ? toDelivery(row) : null;
    },

    async reserve(input) {
      validateReserveInput(input);
      const current = now();
      const [inserted] = await getDb()
        .insert(quotationEmailDeliveries)
        .values({
          id: input.attemptId,
          revisionId: input.revisionId,
          recipient: input.recipient,
          publicToken: input.publicToken,
          state: 'pending',
          providerEmailId: null,
          publicError: null,
          acceptedAt: null,
          createdAt: current,
          updatedAt: current,
        })
        .onConflictDoNothing()
        .returning();
      const delivery = inserted ? toDelivery(inserted) : await this.get(input.attemptId);
      if (!delivery) throw new QuotationEmailDeliveryRepositoryError('Não foi possível registrar o envio.');
      if (delivery.revisionId !== input.revisionId || delivery.recipient !== input.recipient) {
        throw new QuotationEmailDeliveryConflictError('O identificador pertence a outra tentativa.');
      }
      return { kind: inserted ? 'reserved' : 'existing', delivery };
    },

    async markAccepted(input) {
      return transitionAccepted(getDb(), input, now());
    },

    async markFailed(input) {
      return transitionFailed(getDb(), input, now());
    },
  };
}
```

Implementar `toDelivery`, `validateReserveInput`, `transitionAccepted` e `transitionFailed` no mesmo arquivo.
Usar update condicionado por `id` e `state = 'pending'`, apagar `publicToken` ao entrar em `accepted` ou `failed`, reler após update e aceitar repetição somente quando os dados persistidos forem iguais.
Quando duas reservas concorrerem, sempre retornar o token da linha vencedora, nunca o token descartado.
Converter erros desconhecidos para `QuotationEmailDeliveryRepositoryError` sem incluir a mensagem do banco.

- [ ] **Step 8: Executar testes da persistência**

Run: `npm run build:api && node --test tests/unit/quotation-schema.test.ts tests/unit/quotation-email-delivery-postgres.test.ts`

Expected: PASS, ou PASS com o teste PostgreSQL explicitamente SKIP sem `TEST_DATABASE_URL`.

- [ ] **Step 9: Commit**

```bash
git add api/_db/schema.ts api/_db/quotation-email-delivery-repository.ts tests/unit/quotation-schema.test.ts tests/unit/quotation-email-delivery-postgres.test.ts drizzle/0020_quotation_email_deliveries.sql drizzle/meta/0020_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(db): track quotation email deliveries"
```

---

### Task 2: Renderizar e transportar o e-mail pela API Resend

**Files:**

- Modify: `api/_functions/lib/quotation-document-storage.ts:1-25`
- Modify: `api/_db/quotation-delivery-repository.ts:24-33`
- Modify: `api/_functions/public-quotation.ts:1-18,246-269`
- Modify: `tests/unit/public-quotation.test.ts`
- Create: `api/_functions/lib/quotation-email.ts`
- Create: `tests/unit/quotation-email.test.ts`

**Interfaces:**

- Consumes: URLs públicas assinadas, `fetch`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` e `RESEND_REPLY_TO`.
- Produces: `renderQuotationEmailHtml()` e `sendQuotationEmailViaResend()`.

```ts
export interface SendQuotationEmailTransportInput {
  recipient: string;
  customerName: string;
  businessNumber: string;
  publicUrl: string;
  attachmentUrl: string;
  attemptId: string;
}

export interface ResendTransportDependencies {
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export type ResendTransportErrorKind = 'configuration' | 'rejected' | 'uncertain';

export class ResendTransportError extends Error {
  constructor(
    message: string,
    readonly kind: ResendTransportErrorKind
  ) {
    super(message);
  }
}
```

- [ ] **Step 1: Escrever testes de HTML e transporte que falham**

Criar `tests/unit/quotation-email.test.ts` com estes casos:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderQuotationEmailHtml,
  ResendTransportError,
  sendQuotationEmailViaResend,
} from '../../api/_functions/lib/quotation-email.js';

const input = {
  recipient: 'cliente@example.com',
  customerName: '<Cliente & Filhos>',
  businessNumber: 'ORC-42',
  publicUrl: 'https://app.example.com/api/public-quotation?token=abc',
  attachmentUrl: 'https://app.example.com/api/public-quotation?token=abc&format=pdf',
  attemptId: '11111111-1111-4111-8111-111111111111',
};

test('quotation email escapes customer data and keeps the public URL', () => {
  const html = renderQuotationEmailHtml(input);
  assert.match(html, /&lt;Cliente &amp; Filhos&gt;/);
  assert.doesNotMatch(html, /<Cliente/);
  assert.match(html, /https:\/\/app\.example\.com\/api\/public-quotation\?token=abc/);
});

test('Resend request contains sender, attachment and idempotency key', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const result = await sendQuotationEmailViaResend(input, {
    env: {
      RESEND_API_KEY: 'secret-test-key',
      RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>',
      RESEND_REPLY_TO: 'vendas@example.com',
    },
    fetchFn: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'resend-email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(result.id, 'resend-email-1');
  assert.equal(capturedUrl, 'https://api.resend.com/emails');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer secret-test-key');
  assert.equal(headers.get('Idempotency-Key'), `quotation-email/${input.attemptId}`);
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.from, 'Aspen <orcamentos@example.com>');
  assert.deepEqual(body.to, ['cliente@example.com']);
  assert.equal(body.reply_to, 'vendas@example.com');
  assert.equal(body.attachments[0].filename, 'orcamento-ORC-42.pdf');
  assert.equal(body.attachments[0].path, input.attachmentUrl);
  assert.equal(body.attachments[0].content, undefined);
});
```

Adicionar testes para configuração ausente, resposta HTTP `422`, `fetch` lançando erro, resposta `200` sem `id` e URL de anexo sem HTTPS.
Esperar `kind = 'rejected'` somente para resposta HTTP não aceita ou URL remota inválida.
Esperar `kind = 'uncertain'` para timeout, erro de rede ou resposta de sucesso sem identificador.

- [ ] **Step 2: Executar testes e confirmar a falha**

Run: `npm run build:api && node --test tests/unit/quotation-email.test.ts`

Expected: FAIL porque o módulo ainda não existe.

- [ ] **Step 3: Compartilhar o limite de PDF existente**

Em `api/_functions/lib/quotation-document-storage.ts`:

```ts
export const MAX_QUOTATION_PDF_BYTES = 10 * 1024 * 1024;
```

Em `api/_db/quotation-delivery-repository.ts`, remover o `MAX_PDF_BYTES` local, importar `MAX_QUOTATION_PDF_BYTES` e trocar as referências.
Em `api/_functions/public-quotation.ts`, rejeitar o PDF quando `pdf.byteLength > MAX_QUOTATION_PDF_BYTES` antes de montar a resposta base64.
Estender `tests/unit/public-quotation.test.ts` com um renderer que devolve buffer acima do limite e esperar `503` com a mensagem pública atual.
Não alterar mensagens, estados ou comportamento WhatsApp.

- [ ] **Step 4: Implementar HTML e transporte mínimos**

Criar `api/_functions/lib/quotation-email.ts`:

```ts
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export function renderQuotationEmailHtml(
  input: Pick<SendQuotationEmailTransportInput, 'customerName' | 'businessNumber' | 'publicUrl'>
): string {
  const customerName = escapeHtml(input.customerName);
  const businessNumber = escapeHtml(input.businessNumber);
  const publicUrl = escapeHtml(input.publicUrl);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937"><p>Olá, ${customerName}.</p><p>Segue o orçamento ${businessNumber} em anexo.</p><p><a href="${publicUrl}" style="display:inline-block;padding:12px 18px;background:#166534;color:#fff;text-decoration:none;border-radius:6px">Ver orçamento</a></p><p>Atenciosamente,<br>Aspen</p></body></html>`;
}

export async function sendQuotationEmailViaResend(
  input: SendQuotationEmailTransportInput,
  dependencies: ResendTransportDependencies = {}
): Promise<{ id: string }> {
  const env = dependencies.env || process.env;
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.RESEND_FROM_EMAIL || '').trim();
  const replyTo = String(env.RESEND_REPLY_TO || '').trim();
  if (!apiKey || !from) {
    throw new ResendTransportError('Envio por e-mail não configurado.', 'configuration');
  }
  let attachmentUrl: URL;
  try {
    attachmentUrl = new URL(input.attachmentUrl);
  } catch {
    throw new ResendTransportError('URL do PDF inválida.', 'rejected');
  }
  if (attachmentUrl.protocol !== 'https:' || attachmentUrl.searchParams.get('format') !== 'pdf') {
    throw new ResendTransportError('URL do PDF inválida.', 'rejected');
  }

  let response: Response;
  try {
    response = await (dependencies.fetchFn || fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `quotation-email/${input.attemptId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.recipient],
        subject: `Orçamento ${input.businessNumber} - Aspen`,
        html: renderQuotationEmailHtml(input),
        ...(replyTo ? { reply_to: replyTo } : {}),
        attachments: [{
          filename: `orcamento-${input.businessNumber}.pdf`,
          path: attachmentUrl.toString(),
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ResendTransportError('O resultado do envio não pôde ser confirmado.', 'uncertain');
  }

  if (!response.ok) {
    throw new ResendTransportError('A Resend não aceitou o e-mail.', 'rejected');
  }
  const payload = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!payload || typeof payload.id !== 'string' || !payload.id.trim()) {
    throw new ResendTransportError('O resultado do envio não pôde ser confirmado.', 'uncertain');
  }
  return { id: payload.id.trim() };
}
```

Definir as interfaces e classes exportadas acima do código.
Não registrar corpo, chave, destinatário ou PDF.

- [ ] **Step 5: Executar testes do transporte e regressão WhatsApp**

Run: `npm run build:api && node --test tests/unit/quotation-email.test.ts tests/unit/public-quotation.test.ts tests/unit/quotation-delivery-postgres.test.ts`

Expected: PASS, com SKIP explícito apenas para teste PostgreSQL sem banco.

- [ ] **Step 6: Commit**

```bash
git add api/_functions/lib/quotation-document-storage.ts api/_db/quotation-delivery-repository.ts api/_functions/public-quotation.ts tests/unit/public-quotation.test.ts api/_functions/lib/quotation-email.ts tests/unit/quotation-email.test.ts
git commit -m "feat(email): add Resend quotation transport"
```

---

### Task 3: Expor endpoint autenticado e idempotente

**Files:**

- Create: `api/_functions/send-quotation-email.ts`
- Create: `tests/unit/send-quotation-email.test.ts`
- Modify: `api/[...path].ts:34-89`
- Modify: `scripts/dev-api-server.mjs:31-84`
- Modify: `scripts/app-server.mjs:38-92`
- Modify: `tests/unit/route-map.test.ts:35-68`

**Interfaces:**

- Consumes: `QuotationEmailDeliveryRepository`, `createQuotationTemplateRepository()`, `issuePublicQuotationToken()` e `sendQuotationEmailViaResend()`.
- Produces: `handler(event, dependencies?)` em `POST /api/send-quotation-email`.

```ts
export interface SendQuotationEmailDependencies {
  deliveries?: QuotationEmailDeliveryRepository;
  snapshots?: ReturnType<typeof createQuotationTemplateRepository>;
  issueToken?: typeof issuePublicQuotationToken;
  transport?: typeof sendQuotationEmailViaResend;
  token?: () => string;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}
```

- [ ] **Step 1: Escrever testes de endpoint que falham**

Criar `tests/unit/send-quotation-email.test.ts` com helper de evento e dependências falsas.
Cobrir estes casos:

```ts
test('accepted Resend response marks attempt and returns safe projection', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', {
    revision_id: revisionId,
    recipient: ' CLIENTE@EXAMPLE.COM ',
    attempt_id: attemptId,
  }), {
    deliveries: fakeDeliveries(calls),
    snapshots: fakeSnapshots({
      quotation: { id: quotationId, businessNumber: 'ORC-42' },
      revision: { id: revisionId, status: 'emitido', clienteNome: 'Cliente Teste' },
    }),
    issueToken: async (input) => {
      assert.equal(input.token?.(), 'stable-public-token');
      return {
      token: 'public-token',
      expiresAt: Date.now() + 60_000,
      revisionId,
      quotationId,
        businessNumber: 'ORC-42',
      };
    },
    transport: async (input) => {
      assert.equal(input.recipient, 'cliente@example.com');
      assert.match(input.publicUrl, /public-quotation\?token=public-token$/);
      assert.match(input.attachmentUrl, /public-quotation\?token=public-token&format=pdf$/);
      return { id: 'resend-email-1' };
    },
    token: () => 'stable-public-token',
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || ''), {
    success: true,
    delivery: {
      state: 'accepted',
      recipient: 'cliente@example.com',
      accepted_at: '2026-08-17T12:00:00.000Z',
    },
  });
  assert.deepEqual(calls, ['reserve', 'transport', 'markAccepted']);
});
```

Adicionar casos para:

- `405` em método diferente de POST.
- `400` em JSON inválido, UUID inválido e e-mail inválido.
- `404` em revisão inexistente.
- `409` em revisão rascunho.
- Retorno imediato de tentativa já aceita sem PDF, token ou transporte.
- `409` para tentativa existente `failed`, exigindo novo `attempt_id`.
- Resend `configuration` retornando `503` e marcando `failed`.
- Resend `rejected` retornando `502`, marcando `failed` e `retry_same_attempt: false`.
- Resend `uncertain` retornando `503`, mantendo `pending` e `retry_same_attempt: true`.
- Falha ao gravar `accepted` retornando `503`, mantendo repetição com o mesmo identificador.
- Resposta sem chave, ID do provedor ou stack trace.

- [ ] **Step 2: Executar testes e confirmar a falha**

Run: `npm run build:api && node --test tests/unit/send-quotation-email.test.ts`

Expected: FAIL porque o handler ainda não existe.

- [ ] **Step 3: Implementar parsing, base URL e mapeamento de erros**

Criar `api/_functions/send-quotation-email.ts` com:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function publicBaseUrl(event: FunctionEvent): string {
  const headers = event.headers || {};
  const forwardedProto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error('Origem da aplicação indisponível.');
  return `${forwardedProto === 'http' ? 'http' : 'https'}://${host}`;
}
```

Usar `normalizeClientEmail()` para destinatário.
Nunca aceitar base URL do corpo da requisição.

- [ ] **Step 4: Implementar a orquestração**

O fluxo central deve seguir esta ordem:

```ts
const existing = await deliveries.get(attemptId);
if (existing?.state === 'accepted') return acceptedResponse(existing);
if (existing?.state === 'failed') {
  return json(409, { error: 'Crie uma nova tentativa para reenviar o e-mail.', retry_same_attempt: false });
}
if (existing && (existing.revisionId !== revisionId || existing.recipient !== recipient)) {
  return json(409, { error: 'O identificador pertence a outra tentativa.', retry_same_attempt: false });
}

const snapshot = await snapshots.get(revisionId);
if (!snapshot) return json(404, { error: 'Revisão do orçamento não encontrada.' });
if (!isIssuedQuotationStatus(snapshot.revision.status)) {
  return json(409, { error: 'Emita o orçamento antes de enviar por e-mail.' });
}

const reservation = await deliveries.reserve({
  attemptId,
  revisionId,
  recipient,
  publicToken: (dependencies.token || (() => randomBytes(32).toString('base64url')))(),
});
const publicToken = reservation.delivery.publicToken;
if (!publicToken) {
  return json(409, { error: 'A tentativa não pode mais ser enviada.', retry_same_attempt: false });
}
const token = await issueToken({
  revisionId,
  repository: snapshots,
  token: () => publicToken,
});
const publicUrl = `${publicBaseUrl(event)}/api/public-quotation?token=${encodeURIComponent(token.token)}`;
const attachmentUrl = `${publicUrl}&format=pdf`;

try {
  const sent = await transport({
    recipient,
    customerName: snapshot.revision.clienteNome || 'Cliente',
    businessNumber: snapshot.quotation.businessNumber,
    publicUrl,
    attachmentUrl,
    attemptId,
  }, { env: dependencies.env });
  const accepted = await deliveries.markAccepted({ attemptId, providerEmailId: sent.id });
  return acceptedResponse(accepted);
} catch (error) {
  if (error instanceof ResendTransportError && error.kind !== 'uncertain') {
    await deliveries.markFailed({ attemptId, publicError: publicMessage(error.kind) }).catch(() => undefined);
  }
  if (error instanceof ResendTransportError && error.kind === 'rejected') {
    return json(502, { error: 'A Resend não aceitou o e-mail.', retry_same_attempt: false });
  }
  if (error instanceof ResendTransportError && error.kind === 'configuration') {
    return json(503, { error: 'Envio por e-mail não configurado.', retry_same_attempt: false });
  }
  return json(503, {
    error: 'O resultado do envio não pôde ser confirmado. Tente novamente.',
    retry_same_attempt: true,
  });
}
```

Importar `randomBytes` de `node:crypto`.
A reserva precisa ocorrer antes da emissão do link, e toda repetição deve usar `reservation.delivery.publicToken`, inclusive quando outra requisição venceu a corrida de insert.
Se `markAccepted` falhar após retorno da Resend, cair na resposta ambígua e deixar `pending` com o token estável para repetição idempotente.
Logar somente `attemptId`, `revisionId` e categoria do erro.

- [ ] **Step 5: Adicionar a rota aos três mapas**

Adicionar import `sendQuotationEmail` e entrada:

```ts
'send-quotation-email': sendQuotationEmail,
```

Arquivos:

- `api/[...path].ts`
- `scripts/dev-api-server.mjs`
- `scripts/app-server.mjs`

Em `tests/unit/route-map.test.ts`, trocar `44` por `45` no nome e nas duas asserções e adicionar `'send-quotation-email'` à lista de rotas obrigatórias.

- [ ] **Step 6: Executar testes do endpoint e mapas**

Run: `npm run build:api && node --test tests/unit/send-quotation-email.test.ts tests/unit/route-map.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/_functions/send-quotation-email.ts tests/unit/send-quotation-email.test.ts api/'[...path].ts' scripts/dev-api-server.mjs scripts/app-server.mjs tests/unit/route-map.test.ts
git commit -m "feat(api): send quotations by email"
```

---

### Task 4: Projetar marcador da revisão atual nas APIs

**Files:**

- Modify: `api/_db/quote-draft-management-repository.ts:120-229,746-839,882-1062`
- Modify: `tests/unit/quotations-postgres.test.ts:29-395`
- Modify: `src/lib/localProjections.ts:72-80,151-189,660-780`
- Modify: `tests/unit/quotations-core.test.ts:45-302`

**Interfaces:**

- Consumes: linhas `accepted` de `quotationEmailDeliveries`.
- Produces: `email_sent: boolean` e `email_sent_at: string | null` em lista e detalhe.

- [ ] **Step 1: Escrever teste PostgreSQL do marcador que falha**

No fixture emitido de `tests/unit/quotations-postgres.test.ts`, inserir tentativa aceita para a revisão atual:

```ts
await db.insert(quotationEmailDeliveries).values({
  id: emailAttemptId,
  revisionId: issuedRevisionId,
  recipient: 'cliente@example.com',
  state: 'accepted',
  providerEmailId: 'resend-email-1',
  publicError: null,
  acceptedAt: new Date('2026-08-17T12:00:00.000Z'),
  createdAt: new Date('2026-08-17T11:59:00.000Z'),
  updatedAt: new Date('2026-08-17T12:00:00.000Z'),
});

const list = await management.list({ page: 1, limit: 50 });
const listed = list.rows.find((row) => row.revision_id === issuedRevisionId);
assert.equal(listed?.email_sent, true);
assert.equal(listed?.email_sent_at, '2026-08-17T12:00:00.000Z');

const detail = await management.get(quotationId);
assert.equal(detail?.email_sent, true);
assert.equal(detail?.email_sent_at, '2026-08-17T12:00:00.000Z');
```

Depois criar a nova revisão atual sem tentativa aceita e verificar `false` e `null` na lista e detalhe.

- [ ] **Step 2: Executar teste PostgreSQL e confirmar a falha**

Run: `npm run build:api && node --test tests/unit/quotations-postgres.test.ts`

Expected: FAIL nas propriedades ausentes, ou SKIP explícito sem `TEST_DATABASE_URL`.

- [ ] **Step 3: Adicionar campos aos contratos do repositório**

Adicionar em `QuoteDraftManagementListRow` e `QuoteDraftManagementDetail`:

```ts
email_sent: boolean;
email_sent_at: string | null;
```

Importar `quotationEmailDeliveries` e operadores `and`, `desc`, `inArray` conforme necessidade.

- [ ] **Step 4: Projetar entregas aceitas sem N+1**

Em `listRows`, criar primeiro a página e buscar uma vez somente suas revisões:

```ts
const pageCandidates = candidates.slice((page - 1) * limit, page * limit);
const currentRevisionIds = pageCandidates.map(({ revision }) => revision.id);
const acceptedEmailRows = currentRevisionIds.length
  ? await tx
      .select()
      .from(quotationEmailDeliveries)
      .where(and(
        inArray(quotationEmailDeliveries.revisionId, currentRevisionIds),
        eq(quotationEmailDeliveries.state, 'accepted')
      ))
  : [];
const latestEmailByRevision = new Map<string, Date>();
for (const delivery of acceptedEmailRows) {
  if (!delivery.acceptedAt) continue;
  const current = latestEmailByRevision.get(delivery.revisionId);
  const acceptedAt = asDate(delivery.acceptedAt);
  if (!current || acceptedAt > current) latestEmailByRevision.set(delivery.revisionId, acceptedAt);
}
```

Trocar o `candidates.slice(...).map(...)` existente por `pageCandidates.map(...)` e mapear cada linha:

```ts
const emailSentAt = latestEmailByRevision.get(revision.id) || null;
return {
  // campos existentes
  email_sent: emailSentAt !== null,
  email_sent_at: emailSentAt?.toISOString() || null,
};
```

Em `readPostgresQuotationDetail`, consultar somente a revisão atual com `state = 'accepted'`, ordenar `acceptedAt` decrescente e limitar a uma linha.

- [ ] **Step 5: Escrever testes de projeção frontend que falham**

Em `tests/unit/quotations-core.test.ts`, adicionar payloads com:

```ts
email_sent: true,
email_sent_at: '2026-08-17T12:00:00.000Z',
cliente_snapshot: {
  id: 'client-1',
  nome: 'Cliente Teste',
  email: 'cliente@example.com',
  telefone: '5511999999999',
},
```

Validar que `projectQuotationListRow()` e `projectQuotationDetail()` preservam os campos de envio e que o detalhe projeta `data.email === 'cliente@example.com'` para preencher o diálogo.
Adicionar caso sem os campos e esperar fallback `false` e `null` para compatibilidade entre deploys.

- [ ] **Step 6: Atualizar projeções locais**

Adicionar aos tipos:

```ts
email_sent: boolean;
email_sent_at: string | null;
```

Em ambas as funções de projeção:

```ts
const emailSent = readBoolean(source.email_sent) ?? false;
const emailSentAt = source.email_sent_at === null || source.email_sent_at === undefined
  ? null
  : readDate(source.email_sent_at) || null;
```

Em `projectQuotationDetail`, projetar também o snapshot já retornado pela API:

```ts
const clientSnapshot = projectClientRow(source.cliente_snapshot);
if (!clientSnapshot) return null;

// dentro de data
email: clientSnapshot.email || undefined,
telefone: clientSnapshot.telefone || undefined,
```

Retornar os campos de envio sem tornar respostas antigas inválidas.
Se `email_sent` for verdadeiro e a data vier inválida, preservar `email_sent: true` e usar `email_sent_at: null`.

- [ ] **Step 7: Executar testes de backend e projeção**

Run: `npm run build:api && node --test tests/unit/quotations-postgres.test.ts tests/unit/quotations-core.test.ts`

Expected: PASS, ou PASS com SKIP explícito apenas para banco ausente.

- [ ] **Step 8: Commit**

```bash
git add api/_db/quote-draft-management-repository.ts tests/unit/quotations-postgres.test.ts src/lib/localProjections.ts tests/unit/quotations-core.test.ts
git commit -m "feat(quotation): expose email delivery marker"
```

---

### Task 5: Adicionar diálogo e envio na página individual

**Files:**

- Create: `src/components/quotation/QuotationEmailDialog.tsx`
- Modify: `src/pages/QuotationDetailPage.tsx:1-44,157-260,698-725,1120-1205`
- Modify: `tests/quotation-lifecycle.spec.js:10-113,115-460`

**Interfaces:**

- Consumes: `apiPost('/send-quotation-email', { revision_id, recipient, attempt_id })`, `ProjectedQuotationData.email_sent` e `email_sent_at`.
- Produces: diálogo acessível, botão `Enviar por e-mail` ou `Reenviar por e-mail` e reload autoritativo.

```ts
export interface QuotationEmailDialogProps {
  open: boolean;
  initialEmail: string;
  sending: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (email: string) => Promise<void>;
}
```

- [ ] **Step 1: Escrever E2E do fluxo feliz que falha**

Em `tests/quotation-lifecycle.spec.js`, incluir `email_sent: false` e `email_sent_at: null` no helper `detail()` e adicionar:

```js
test('operator confirms editable email and sends the current issued revision', async ({ page }) => {
  const sentBodies = [];
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) => fulfillJson(route, detail({
    status: 'Enviado',
    status_canonical: 'emitido',
    email: 'original@example.com',
    email_sent: false,
    email_sent_at: null,
  })));
  await page.route('**/api/send-quotation-email', async (route) => {
    sentBodies.push(route.request().postDataJSON());
    await fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'corrigido@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto('/#/quotations/ORC-42');
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  await expect(dialog.getByLabel('E-mail do destinatário')).toHaveValue('original@example.com');
  await dialog.getByLabel('E-mail do destinatário').fill('corrigido@example.com');
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();

  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  expect(sentBodies).toHaveLength(1);
  expect(sentBodies[0]).toMatchObject({
    revision_id: detail().revision_id,
    recipient: 'corrigido@example.com',
  });
  expect(sentBodies[0].attempt_id).toMatch(/^[0-9a-f-]{36}$/i);
});
```

- [ ] **Step 2: Executar o E2E e confirmar a falha**

Run: `npx playwright test tests/quotation-lifecycle.spec.js --grep "confirms editable email"`

Expected: FAIL porque o botão e diálogo ainda não existem.

- [ ] **Step 3: Implementar diálogo acessível**

Criar `src/components/quotation/QuotationEmailDialog.tsx` com:

```tsx
export function QuotationEmailDialog({
  open,
  initialEmail,
  sending,
  error,
  onCancel,
  onSubmit,
}: QuotationEmailDialogProps) {
  const [email, setEmail] = useState(initialEmail);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    queueMicrotask(() => inputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [initialEmail, onCancel, open, sending]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar envio por e-mail"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        disabled={sending}
        onClick={onCancel}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="quotation-email-title"
        className="relative w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(email);
        }}
      >
        <h2 id="quotation-email-title" className="text-lg font-semibold text-fg">Enviar orçamento por e-mail</h2>
        <label className="mt-4 block text-sm font-medium text-fg" htmlFor="quotation-email-recipient">E-mail do destinatário</label>
        <Input
          ref={inputRef}
          id="quotation-email-recipient"
          type="email"
          required
          autoComplete="email"
          value={email}
          disabled={sending}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={sending} onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={sending}>{sending ? 'Enviando...' : 'Enviar e-mail'}</Button>
        </div>
      </form>
    </div>
  );
}
```

Usar o `ref` já encaminhado por `src/components/ui/input.tsx` e manter foco inicial no campo.

- [ ] **Step 4: Integrar estado e chamada na página**

Em `QuotationDetailPage.tsx`, importar `Mail`, `QuotationEmailDialog` e `ApiError`.
Adicionar estado dentro de `CoreQuotationDetail`:

```ts
const [emailDialogOpen, setEmailDialogOpen] = useState(false);
const [emailSending, setEmailSending] = useState(false);
const [emailError, setEmailError] = useState('');
const [emailSuccess, setEmailSuccess] = useState('');
const [emailAttemptId, setEmailAttemptId] = useState('');
```

Adicionar handler:

```ts
const sendQuotationEmail = useCallback(async (recipient: string) => {
  if (!data.revision_id) return;
  const attemptId = emailAttemptId || crypto.randomUUID();
  setEmailAttemptId(attemptId);
  setEmailSending(true);
  setEmailError('');
  setEmailSuccess('');
  try {
    await apiPost('/send-quotation-email', {
      revision_id: data.revision_id,
      recipient,
      attempt_id: attemptId,
    });
    setEmailSuccess('E-mail aceito para envio.');
    setEmailDialogOpen(false);
    setEmailAttemptId('');
    await onReload();
  } catch (error) {
    const apiError = error as ApiError;
    const response = apiError.data as { retry_same_attempt?: unknown } | undefined;
    if (response?.retry_same_attempt !== true) setEmailAttemptId('');
    setEmailError(error instanceof Error ? error.message : 'Não foi possível enviar o e-mail.');
  } finally {
    setEmailSending(false);
  }
}, [data.revision_id, emailAttemptId, onReload]);
```

Renderizar o botão somente quando `status_canonical !== 'rascunho'`:

```tsx
<Button
  variant="outline"
  onClick={() => {
    setEmailError('');
    setEmailDialogOpen(true);
  }}
>
  <Mail size={14} /> {data.email_sent ? 'Reenviar por e-mail' : 'Enviar por e-mail'}
</Button>
```

Renderizar `emailSuccess` com `role="status"` e o diálogo no final do componente.

- [ ] **Step 5: Escrever E2E de falha e tentativa ambígua**

Adicionar teste que responde `503` com:

```json
{
  "error": "O resultado do envio não pôde ser confirmado. Tente novamente.",
  "retry_same_attempt": true
}
```

Clicar novamente e verificar que o segundo corpo mantém o mesmo `attempt_id`.
Depois responder sucesso e verificar fechamento e confirmação.
Adicionar caso `502` com `retry_same_attempt: false` e confirmar que a nova tentativa usa outro UUID.

- [ ] **Step 6: Executar E2E da página individual**

Run: `npx playwright test tests/quotation-lifecycle.spec.js --grep "email|e-mail"`

Expected: PASS.

- [ ] **Step 7: Executar diagnóstico e build frontend**

Run: `npm run build`

Expected: PASS sem erro TypeScript ou Vite.

- [ ] **Step 8: Commit**

```bash
git add src/components/quotation/QuotationEmailDialog.tsx src/pages/QuotationDetailPage.tsx tests/quotation-lifecycle.spec.js
git commit -m "feat(crm): send quotation email from detail"
```

---

### Task 6: Mostrar marcadores em `/orcamentos`

**Files:**

- Modify: `src/pages/QuotationsPage.tsx:1-38,460-550`
- Modify: `tests/quotations-core.spec.js:44-155`

**Interfaces:**

- Consumes: `ProjectedQuotationListRow.email_sent` e `email_sent_at`.
- Produces: texto explícito e acessível em desktop e mobile.

- [ ] **Step 1: Escrever E2E desktop e mobile que falha**

Adicionar em `tests/quotations-core.spec.js` uma lista com duas linhas:

```js
const rows = [
  {
    id: 'ORC-EMAIL-1',
    data: '2026-08-17',
    cliente: 'Cliente Enviado',
    valor: '100.00',
    status: 'Enviado',
    status_canonical: 'emitido',
    revision_id: '11111111-1111-4111-8111-111111111111',
    email_sent: true,
    email_sent_at: '2026-08-17T12:00:00.000Z',
  },
  {
    id: 'ORC-EMAIL-2',
    data: '2026-08-17',
    cliente: 'Cliente Pendente',
    valor: '200.00',
    status: 'Enviado',
    status_canonical: 'emitido',
    revision_id: '22222222-2222-4222-8222-222222222222',
    email_sent: false,
    email_sent_at: null,
  },
];
```

No desktop, esperar `E-mail enviado` com `17/08/2026` e `E-mail não enviado`.
Depois executar `page.setViewportSize({ width: 390, height: 844 })`, recarregar a rota e repetir as asserções nos cards mobile.

- [ ] **Step 2: Executar o E2E e confirmar a falha**

Run: `npx playwright test tests/quotations-core.spec.js --grep "email markers"`

Expected: FAIL porque os marcadores ainda não existem.

- [ ] **Step 3: Adicionar marcador reutilizado nas duas renderizações**

Dentro de `QuotationsPage`, definir componente local:

```tsx
const EmailMarker = ({ row }: { row: QuotationRow }) => (
  <div className="flex flex-col items-start gap-0.5">
    <span className={row.email_sent ? 'text-xs font-medium text-success' : 'text-xs text-fg-muted'}>
      {row.email_sent ? 'E-mail enviado' : 'E-mail não enviado'}
    </span>
    {row.email_sent_at && (
      <span className="text-[11px] text-fg-muted">{formatDate(row.email_sent_at)}</span>
    )}
  </div>
);
```

Adicionar coluna `E-mail` na tabela desktop e `<EmailMarker row={row} />` na célula correspondente.
Adicionar o mesmo marcador no card mobile abaixo do status comercial.
Não usar ícone isolado nem cor como único sinal.

- [ ] **Step 4: Executar E2E da listagem**

Run: `npx playwright test tests/quotations-core.spec.js --grep "email markers"`

Expected: PASS em desktop e viewport mobile.

- [ ] **Step 5: Executar regressão das páginas de orçamento**

Run: `npx playwright test tests/quotations-core.spec.js tests/quotation-lifecycle.spec.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/QuotationsPage.tsx tests/quotations-core.spec.js
git commit -m "feat(crm): show quotation email markers"
```

---

### Task 7: Validar configuração operacional e concluir o fluxo

**Files:**

- Modify: `scripts/cutover-env-status.mjs:6-29`
- Modify: `tests/unit/cutover-env-status.test.js:27-136`

**Interfaces:**

- Consumes: arquivos externos `$HOME/.config/aspen-dashboard/.env.local` ou `.env`.
- Produces: presença ou ausência de `RESEND_API_KEY` e `RESEND_FROM_EMAIL`, sem valores.

- [ ] **Step 1: Escrever teste de preflight que falha**

Adicionar em `tests/unit/cutover-env-status.test.js`:

```js
test('preflight requires Resend key and verified sender without printing values', () => {
  assert.ok(requiredCutoverKeys.includes('RESEND_API_KEY'));
  assert.ok(requiredCutoverKeys.includes('RESEND_FROM_EMAIL'));
  assert.ok(!requiredCutoverKeys.includes('RESEND_REPLY_TO'));

  const secret = 're_secret_must_not_leak';
  const result = inspectCutoverEnv({
    env: {
      HOME: '/tmp/aspen-test',
      RESEND_API_KEY: secret,
      RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>',
    },
    exists: () => false,
  });
  const output = formatCutoverEnvStatus(result);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /RESEND_API_KEY: present/);
  assert.match(output, /RESEND_FROM_EMAIL: present/);
});
```

Adaptar o helper do teste para fornecer as outras chaves obrigatórias como `present`, mantendo o foco somente nas duas novas chaves.

- [ ] **Step 2: Executar o teste e confirmar a falha**

Run: `node --test tests/unit/cutover-env-status.test.js`

Expected: FAIL porque as chaves Resend ainda não fazem parte do preflight.

- [ ] **Step 3: Adicionar chaves obrigatórias ao preflight**

Em `requiredCutoverKeys`, adicionar:

```js
'RESEND_API_KEY',
'RESEND_FROM_EMAIL',
```

Não adicionar `RESEND_REPLY_TO`, pois é opcional.
Não alterar a leitura de arquivos nem o formato presença/ausência.

- [ ] **Step 4: Executar testes operacionais e unitários completos**

Run: `node --test tests/unit/cutover-env-status.test.js`

Expected: PASS.

Run: `npm run test:unit`

Expected: PASS sem falhas.

- [ ] **Step 5: Executar diagnósticos antes do build final**

Run: diagnósticos LSP nos arquivos TypeScript e TSX modificados.

Expected: nenhum erro.

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 6: Executar builds e verificações obrigatórias**

```bash
npm run build:api
npm run build
node scripts/check-no-legacy-provider.mjs
```

Expected: todos os comandos retornam código `0`.

- [ ] **Step 7: Executar E2E focado**

Run: `npx playwright test tests/quotation-lifecycle.spec.js tests/quotations-core.spec.js`

Expected: PASS.

- [ ] **Step 8: Executar preflight real sem exibir segredos**

Run: `node scripts/cutover-env-status.mjs`

Expected: `RESEND_API_KEY: present` e `RESEND_FROM_EMAIL: present`.
Nunca copiar o arquivo externo para o checkout.

- [ ] **Step 9: Fazer smoke em staging com caixa controlada**

No staging autenticado, abrir um orçamento de teste emitido, substituir o destinatário pela caixa controlada do operador e enviar uma vez.
Confirmar:

- Resend aceita o envio.
- A caixa controlada recebe o assunto esperado.
- O PDF abre e corresponde à revisão exibida.
- O link público abre a mesma revisão.
- `/orcamentos` mostra `E-mail enviado` e a data.
- Nenhum endereço real de cliente é usado.

- [ ] **Step 10: Verificar árvore de trabalho e commit final**

Run: `git status --short`

Expected: somente alterações desta tarefa, sem `.env`, `public/`, relatório Playwright ou credenciais.

```bash
git add scripts/cutover-env-status.mjs tests/unit/cutover-env-status.test.js
git commit -m "chore(email): validate Resend configuration"
```

- [ ] **Step 11: Auditoria final de aceitação**

Confirmar requisito por requisito:

- Botão existe somente para revisão emitida.
- Destinatário é pré-preenchido e editável.
- PDF e link usam a mesma revisão.
- Resend é chamado via `fetch`, sem dependência nova.
- Tentativa ambígua repete a mesma chave.
- Tentativa aceita ativa o marcador.
- Nova revisão não herda o marcador.
- Desktop e mobile mostram enviado e não enviado.
- WhatsApp continua passando nos testes.
- Segredos permanecem fora do checkout e dos logs.
