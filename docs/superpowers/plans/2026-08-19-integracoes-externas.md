# Fase 19 External Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all active Evolution API, OpenRouter, Vercel Blob, and Vercel KV access in `api/_modules` and `api/_shared` through thin provider-specific adapters.

**Architecture:** Add provider-specific config readers and clients under `api/_infrastructure/integrations`. Keep domain payloads, prompts, parsing, timeouts, public errors, KV key design, and Blob ownership rules in current modules; inject only the low-level provider operation each flow needs. Finish with a static boundary check that prevents direct provider access from returning.

**Tech Stack:** Node.js ESM, TypeScript 5.9, native `fetch`, `@vercel/blob` 2.6.1, `@vercel/kv` 3.0.0, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-19-integracoes-externas-design.md`

## Global Constraints

- Preserve current prompts, payloads, timeouts, retries, status codes, public HTTP messages, and logging behavior.
- Do not add dependencies, migrations, provider fallbacks, transport fallbacks, persistence fallbacks, rollout branches, or generic provider abstractions.
- Read provider env on demand; never capture provider config during module import.
- Do not log API keys, tokens, personal payloads, raw provider bodies, or stack traces.
- Evolution writes must pass `assertExternalWritesAllowed('evolution')`; synchronization reads must not require write authorization.
- No remote provider calls, secrets, deploy, push, PR, database operations, or remote E2E.
- Do not modify `drizzle/` or generated Vite files in `public/`.
- Backend local ESM imports include `.js`.
- User-facing HTTP messages remain in Brazilian Portuguese.
- Runtime boundary scope is exactly `api/_modules` and `api/_shared`; operational scripts remain outside this phase.

## File Structure

**Create:**

- `api/_infrastructure/integrations/evolution/config.ts` — on-demand Evolution env normalization.
- `api/_infrastructure/integrations/evolution/client.ts` — URL/header composition, injected fetch, write guard.
- `api/_infrastructure/integrations/openrouter/config.ts` — on-demand OpenRouter key/model/referer resolution.
- `api/_infrastructure/integrations/openrouter/client.ts` — chat completions endpoint and common headers.
- `api/_infrastructure/integrations/blob/config.ts` — active Blob credential normalization.
- `api/_infrastructure/integrations/blob/client.ts` — thin wrapper around installed Blob SDK operations.
- `api/_infrastructure/integrations/kv/config.ts` — on-demand KV configured-state check.
- `api/_infrastructure/integrations/kv/client.ts` — thin accessor for installed KV client.
- `scripts/check-external-integration-boundary.mjs` — static runtime boundary enforcement.
- `tests/unit/evolution-integration.test.ts` — Evolution adapter contract.
- `tests/unit/openrouter-integration.test.ts` — OpenRouter adapter contract.
- `tests/unit/blob-integration.test.ts` — Blob adapter/config contract.
- `tests/unit/kv-integration.test.ts` — KV adapter/config contract.
- `tests/unit/external-integration-boundary.test.ts` — static checker contract.
- `tests/unit/edit-draft.test.ts` — characterization for edit-draft OpenRouter behavior.

**Modify for Evolution:**

- `api/_modules/whatsapp-conversations-sync.ts`
- `api/_modules/send-whatsapp.ts`
- `api/_modules/send-whatsapp-flow.ts`
- `api/_modules/whatsapp-leads.ts`
- existing focused tests named in Tasks 1-2.

**Modify for OpenRouter:**

- `api/_modules/extract.ts`
- `api/_modules/edit-draft.ts`
- `api/_modules/whatsapp-leads.ts`
- `tests/unit/extract-handler.test.ts`
- `tests/unit/whatsapp-leads.test.ts`

**Modify for Blob:**

- `api/_modules/communication-media.ts`
- `api/_modules/communication-media-upload.ts`
- `api/_modules/postgres-media.ts`
- `api/_modules/quotation-document-storage.ts`
- existing focused media and quotation tests named in Task 4.

**Modify for KV:**

- `api/_modules/communication-flow-preview.ts`
- `api/_modules/communication-flows.ts`
- `api/_modules/communication-media.ts`
- `api/_modules/communication-send-events.ts`
- `api/_modules/postgres-media.ts`
- `api/_modules/public-quotation.ts`
- `api/_modules/send-whatsapp-flow.ts`
- `api/_modules/whatsapp-conversations-store.ts`
- `api/_modules/whatsapp-flows.ts`
- `api/_modules/whatsapp-send-reservation-store.ts`
- `api/_shared/rate-limit.ts`
- existing focused tests named in Task 5.

**Modify for enforcement:**

- `package.json`

---

### Task 1: Evolution config/client and conversation synchronization

**Files:**

- Create: `api/_infrastructure/integrations/evolution/config.ts`
- Create: `api/_infrastructure/integrations/evolution/client.ts`
- Create: `tests/unit/evolution-integration.test.ts`
- Modify: `api/_modules/whatsapp-conversations-sync.ts:12-15,221-278`
- Modify: `tests/unit/whatsapp-conversations-sync.test.ts`

**Interfaces:**

- Consumes: `assertExternalWritesAllowed(provider: 'evolution'): void` from `api/_shared/external-writes.ts`.
- Produces: `EvolutionConfig`, `getEvolutionConfig`, `EvolutionClient`, `EvolutionClientOptions`, `EvolutionRequestOptions`, and `getEvolutionClient` for Task 2.

- [ ] **Step 1: Write failing adapter tests**

Create `tests/unit/evolution-integration.test.ts` with focused cases equivalent to:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEvolutionClient,
  type EvolutionConfig,
} from '../../api/_infrastructure/integrations/evolution/client.js';
import { getEvolutionConfig } from '../../api/_infrastructure/integrations/evolution/config.js';

test('reads and normalizes Evolution config on every call', () => {
  const env: NodeJS.ProcessEnv = {
    EVOLUTION_BASE_URL: ' https://evolution.example/// ',
    EVOLUTION_API_KEY: ' secret ',
    EVOLUTION_INSTANCE: ' aspen ',
  };
  assert.deepEqual(getEvolutionConfig(env), {
    baseUrl: 'https://evolution.example',
    apiKey: 'secret',
    instance: 'aspen',
  });
  env.EVOLUTION_INSTANCE = ' second ';
  assert.equal(getEvolutionConfig(env).instance, 'second');
});

test('builds authenticated requests and guards writes only', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  let guards = 0;
  const config: EvolutionConfig = {
    baseUrl: 'https://evolution.example',
    apiKey: 'secret',
    instance: 'aspen',
  };
  const client = getEvolutionClient({
    getConfig: () => config,
    assertWriteAllowed: () => {
      guards += 1;
    },
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response('{}', { status: 200 });
    },
  });

  await client.request('/chat/findChats/aspen', { limit: 10 }, { externalWrite: false });
  await client.request('/message/sendText/aspen', { number: '5511', text: 'Oi' });

  assert.equal(guards, 1);
  assert.equal(calls[0].input, 'https://evolution.example/chat/findChats/aspen');
  assert.equal(new Headers(calls[0].init?.headers).get('apikey'), 'secret');
  assert.equal(calls[0].init?.body, JSON.stringify({ limit: 10 }));
});
```

- [ ] **Step 2: Run build to verify tests fail for missing modules**

Run:

```bash
npm run build:api
```

Expected: FAIL with `TS2307` for the new Evolution config/client imports.

- [ ] **Step 3: Implement minimal Evolution config and client**

Create `config.ts` with this public shape:

```ts
export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

export function getEvolutionConfig(env: NodeJS.ProcessEnv = process.env): EvolutionConfig {
  return {
    baseUrl: (env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (env.EVOLUTION_API_KEY || '').trim(),
    instance: (env.EVOLUTION_INSTANCE || '').trim(),
  };
}
```

Create `client.ts` with these exact contracts:

```ts
export interface EvolutionRequestOptions {
  externalWrite?: boolean;
  signal?: AbortSignal;
}

export interface EvolutionClient {
  config(): EvolutionConfig;
  request(
    path: string,
    body?: Record<string, unknown>,
    options?: EvolutionRequestOptions
  ): Promise<Response>;
}

export interface EvolutionClientOptions {
  getConfig?: () => EvolutionConfig;
  fetchImpl?: typeof fetch;
  assertWriteAllowed?: () => void;
}

export function getEvolutionClient(options: EvolutionClientOptions = {}): EvolutionClient;
```

Implementation rules:

```ts
const getConfig = options.getConfig || getEvolutionConfig;
const fetchImpl = options.fetchImpl || fetch;
const assertWriteAllowed =
  options.assertWriteAllowed || (() => assertExternalWritesAllowed('evolution'));
```

`request` must call `assertWriteAllowed()` unless `externalWrite === false`, read config at request time, concatenate `baseUrl + path`, send `POST` when `body` exists and `GET` otherwise, set `Content-Type: application/json` and `apikey`, serialize body once, pass the optional signal, and return the raw `Response`. It must not parse responses, translate errors, log, retry, or inspect provider payloads.

- [ ] **Step 4: Run adapter tests**

Run:

```bash
npm run build:api && node --test --test-concurrency=1 tests/unit/evolution-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Migrate conversation sync without changing its contract**

In `whatsapp-conversations-sync.ts`:

1. Remove module-load `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, and `EVOLUTION_INSTANCE` constants.
2. Keep `EVOLUTION_TIMEOUT_MS`, bounded response parsing, timeout race, cancellation, and all public error messages in this module.
3. Preserve the existing exported `EvolutionRequestOptions` shape (`baseUrl`, `apiKey`, `instance`, `fetchImpl`, `timeoutMs`) for tests and callers.
4. Inside `evolutionRequest`, merge per-call overrides over `getEvolutionConfig()` and create a client with `getConfig: () => mergedConfig` and `fetchImpl: options.fetchImpl`.
5. Replace only the inline `fetchImpl(...)` call with:

```ts
client.request(path, body, {
  externalWrite: false,
  signal: controller.signal,
});
```

6. Replace path construction that uses the removed module constants with `getEvolutionConfig().instance` at call time.

- [ ] **Step 6: Add a characterization test for env changes after import**

Append a test to `tests/unit/whatsapp-conversations-sync.test.ts` that sets valid Evolution env values, calls `evolutionRequest` with a fake `fetchImpl`, changes `EVOLUTION_INSTANCE`, calls the sync fetch path again, and asserts the second URL uses the second instance. Restore every env value in `finally`.

- [ ] **Step 7: Run focused regression tests**

Run:

```bash
npm run build:api && node --test --test-concurrency=1 \
  tests/unit/evolution-integration.test.ts \
  tests/unit/whatsapp-conversations-sync.test.ts \
  tests/unit/whatsapp-conversations.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run fast verification**

Run:

```bash
npm run verify:fast
```

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add \
  api/_infrastructure/integrations/evolution/config.ts \
  api/_infrastructure/integrations/evolution/client.ts \
  api/_modules/whatsapp-conversations-sync.ts \
  tests/unit/evolution-integration.test.ts \
  tests/unit/whatsapp-conversations-sync.test.ts
git commit -m "refactor(integrations): centralize Evolution client"
```

---

### Task 2: Route Evolution send flows through the client

**Files:**

- Modify: `api/_modules/send-whatsapp.ts:45-49,618-783`
- Modify: `api/_modules/send-whatsapp-flow.ts:58-62,276-447`
- Modify: `api/_modules/whatsapp-leads.ts:867`
- Modify: `tests/unit/send-whatsapp.test.ts`
- Modify: `tests/unit/send-whatsapp-idempotency.test.ts`
- Modify: `tests/unit/send-whatsapp-review-r1.test.ts`
- Modify: `tests/unit/communication-send.test.ts`
- Modify: `tests/unit/whatsapp-leads.test.ts`

**Interfaces:**

- Consumes: `getEvolutionConfig(): EvolutionConfig` and `getEvolutionClient(options?): EvolutionClient` from Task 1.
- Produces: all runtime Evolution reads and writes under `api/_modules` routed through the integration layer.

- [ ] **Step 1: Add characterization tests for write guard, URL, and error mapping**

Extend existing send tests rather than creating duplicate suites. Add assertions covering:

```ts
assert.equal(capturedUrl, 'https://evolution.example/message/sendText/aspen');
assert.equal(new Headers(capturedInit?.headers).get('apikey'), 'test-key');
assert.equal(JSON.parse(String(capturedInit?.body)).number, '5511999999999');
```

Retain existing assertions for:

- missing config public errors;
- `EXTERNAL_WRITES_ENABLED=0` blocking sends before fetch;
- transport failure status and user message;
- non-2xx Evolution status mapping;
- `normalizeEvolutionDelivery` behavior;
- idempotency/reservation behavior.

Add one `whatsapp-leads` test that changes `EVOLUTION_BASE_URL` after module import and confirms the configured-sync decision observes the new value.

- [ ] **Step 2: Run focused tests before migration**

Run:

```bash
npm run build:api && node --test --test-concurrency=1 \
  tests/unit/send-whatsapp.test.ts \
  tests/unit/send-whatsapp-idempotency.test.ts \
  tests/unit/send-whatsapp-review-r1.test.ts \
  tests/unit/communication-send.test.ts \
  tests/unit/whatsapp-leads.test.ts
```

Expected: existing tests PASS; the new post-import env test FAILS because `whatsapp-leads.ts` captures provider config.

- [ ] **Step 3: Replace send-whatsapp inline config and fetch**

In `send-whatsapp.ts`:

1. Import `getEvolutionClient` and `getEvolutionConfig` from `../_infrastructure/integrations/evolution/*.js`.
2. Delete local `evolutionConfig` and direct provider env reads.
3. Make `assertEvolutionConfig` read `getEvolutionConfig()` and preserve exact missing-variable list and existing `createHttpError` call.
4. Keep `evolutionPost` in this module because it owns logging, public error mapping, response parsing, and delivery normalization.
5. Replace its inline fetch with `getEvolutionClient().request(path, body)`.
6. Use `getEvolutionConfig().instance` in `sendText`, `sendMedia`, and every provider path.
7. Remove redundant direct `assertExternalWritesAllowed('evolution')` only after a test proves the client guard runs before fetch. Keep any earlier handler-level guard whose ordering is externally tested.

- [ ] **Step 4: Replace send-whatsapp-flow inline config and fetch**

Apply the same pattern in `send-whatsapp-flow.ts`. Preserve its distinct retryability classification, transport errors, send history, duplicate warning behavior, and delivery normalization. Do not share domain helpers between the two large send modules in this phase.

- [ ] **Step 5: Remove whatsapp-leads module-load Evolution check**

Replace:

```ts
sync: process.env.EVOLUTION_BASE_URL ? syncWhatsappConversations : undefined,
```

with an on-demand check:

```ts
sync: getEvolutionConfig().baseUrl ? syncWhatsappConversations : undefined,
```

No other leads behavior changes in this task.

- [ ] **Step 6: Run focused tests**

Run the command from Step 2.

Expected: PASS, with no real fetch.

- [ ] **Step 7: Confirm no direct Evolution config remains in runtime modules**

Run:

```bash
node - <<'NODE'
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const hits = files('api/_modules').filter((path) => /process\.env\.EVOLUTION_/.test(readFileSync(path, 'utf8')));
console.log(hits.join('\n'));
process.exitCode = hits.length ? 1 : 0;
NODE
```

Expected: no output; exit 0.

- [ ] **Step 8: Run fast verification**

```bash
npm run verify:fast
```

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add \
  api/_modules/send-whatsapp.ts \
  api/_modules/send-whatsapp-flow.ts \
  api/_modules/whatsapp-leads.ts \
  tests/unit/send-whatsapp.test.ts \
  tests/unit/send-whatsapp-idempotency.test.ts \
  tests/unit/send-whatsapp-review-r1.test.ts \
  tests/unit/communication-send.test.ts \
  tests/unit/whatsapp-leads.test.ts
git commit -m "refactor(integrations): route Evolution send flows"
```

---

### Task 3: Centralize OpenRouter transport and config

**Files:**

- Create: `api/_infrastructure/integrations/openrouter/config.ts`
- Create: `api/_infrastructure/integrations/openrouter/client.ts`
- Create: `tests/unit/openrouter-integration.test.ts`
- Create: `tests/unit/edit-draft.test.ts`
- Modify: `api/_modules/extract.ts:338-458`
- Modify: `api/_modules/edit-draft.ts:91-166`
- Modify: `api/_modules/whatsapp-leads.ts:36-43,332-408`
- Modify: `tests/unit/extract-handler.test.ts`
- Modify: `tests/unit/whatsapp-leads.test.ts`

**Interfaces:**

- Consumes: native `fetch` and `NodeJS.ProcessEnv` only.
- Produces: `OpenRouterConfig`, `getOpenRouterConfig`, `OpenRouterClient`, `OpenRouterClientOptions`, `OpenRouterRequestOptions`, and `getOpenRouterClient`.

- [ ] **Step 1: Write failing OpenRouter adapter tests**

Create tests equivalent to:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getOpenRouterConfig } from '../../api/_infrastructure/integrations/openrouter/config.js';
import { getOpenRouterClient } from '../../api/_infrastructure/integrations/openrouter/client.js';

test('resolves key, model, and referer without caching env', () => {
  const env: NodeJS.ProcessEnv = {
    OPENROUTER_API_KEY: ' key ',
    OPENROUTER_MODEL: ' model ',
    URL: ' https://app.example ',
  };
  assert.deepEqual(getOpenRouterConfig(env), {
    apiKey: 'key',
    model: 'model',
    siteUrl: 'https://app.example',
  });
  env.OPENROUTER_SITE_URL = ' https://preview.example ';
  assert.equal(getOpenRouterConfig(env).siteUrl, 'https://preview.example');
});

test('posts chat completions with caller title and signal', async () => {
  let captured: { input?: string; init?: RequestInit } = {};
  const controller = new AbortController();
  const client = getOpenRouterClient({
    getConfig: () => ({ apiKey: 'key', model: 'model', siteUrl: 'https://app.example' }),
    fetchImpl: async (input, init) => {
      captured = { input: String(input), init };
      return new Response('{}', { status: 200 });
    },
  });
  await client.request(
    { model: 'model', messages: [] },
    {
      title: 'Aspen Test',
      signal: controller.signal,
    }
  );
  assert.equal(captured.input, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(new Headers(captured.init?.headers).get('Authorization'), 'Bearer key');
  assert.equal(new Headers(captured.init?.headers).get('X-OpenRouter-Title'), 'Aspen Test');
  assert.equal(new Headers(captured.init?.headers).get('HTTP-Referer'), 'https://app.example');
  assert.equal(captured.init?.signal, controller.signal);
});
```

- [ ] **Step 2: Run build to verify missing-module failure**

```bash
npm run build:api
```

Expected: FAIL with `TS2307` for OpenRouter integration modules.

- [ ] **Step 3: Implement OpenRouter config and client**

Use these contracts:

```ts
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  siteUrl: string;
}

export function getOpenRouterConfig(env: NodeJS.ProcessEnv = process.env): OpenRouterConfig;

export interface OpenRouterRequestOptions {
  title: string;
  signal?: AbortSignal;
}

export interface OpenRouterClient {
  config(): OpenRouterConfig;
  request(payload: Record<string, unknown>, options: OpenRouterRequestOptions): Promise<Response>;
}

export interface OpenRouterClientOptions {
  getConfig?: () => OpenRouterConfig;
  fetchImpl?: typeof fetch;
}

export function getOpenRouterClient(options: OpenRouterClientOptions = {}): OpenRouterClient;
```

`getOpenRouterConfig` trims values, defaults model exactly to `google/gemini-2.5-flash`, and resolves `siteUrl` in this order: `OPENROUTER_SITE_URL`, `URL`, `DEPLOY_PRIME_URL`, empty string.

`request` reads config at call time, POSTs to the fixed chat completions endpoint, sets `Authorization`, `Content-Type`, caller title, optional `HTTP-Referer`, serializes payload once, passes the optional signal, and returns raw `Response`. It does not enforce key presence, timeout, response size, MIME, parsing, error mapping, or logging; consumers retain those differences.

- [ ] **Step 4: Run adapter tests**

```bash
npm run build:api && node --test --test-concurrency=1 tests/unit/openrouter-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Characterize edit-draft before migration**

Create `tests/unit/edit-draft.test.ts` with two handler-level tests:

1. Empty `OPENROUTER_API_KEY` returns status 500 and `{ error: 'Serviço de edição indisponível.' }` without fetch.
2. Valid config plus a fake `globalThis.fetch` returning a valid OpenRouter choice preserves status 200, title `Aspen Orcamento App`, model, referer, prompt payload, and proposed draft.

Always save and restore env and `globalThis.fetch` in `finally`.

- [ ] **Step 6: Migrate extract and edit-draft**

For both modules:

1. Read config through `getOpenRouterConfig()` at function call time.
2. Preserve each existing missing-key error.
3. Preserve each payload and response parser unchanged.
4. Replace only inline URL/header/fetch construction with:

```ts
const res = await getOpenRouterClient().request(body, {
  title: 'Aspen Orcamento App',
});
```

Do not merge the two private domain functions.

- [ ] **Step 7: Migrate whatsapp-leads while preserving timeout cleanup**

In `requestOpenRouter`:

1. Keep `OpenRouterRequestOptions`, timeout race, abort controller, late-response cancellation, MIME validation, bounded JSON reader, and current errors in `whatsapp-leads.ts`.
2. Use `getOpenRouterConfig().apiKey` for the current no-key `null` behavior.
3. Create the client with `fetchImpl: options.fetchImpl`.
4. Replace only its inline fetch with:

```ts
client.request(payload, {
  title: 'Aspen Orcamento WhatsApp Leads',
  signal: controller.signal,
});
```

5. Replace the module-load model constant with `getOpenRouterConfig().model` when constructing the extraction payload.

- [ ] **Step 8: Run focused OpenRouter tests**

```bash
npm run build:api && node --test --test-concurrency=1 \
  tests/unit/openrouter-integration.test.ts \
  tests/unit/edit-draft.test.ts \
  tests/unit/extract-handler.test.ts \
  tests/unit/whatsapp-leads.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run fast verification**

```bash
npm run verify:fast
```

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add \
  api/_infrastructure/integrations/openrouter/config.ts \
  api/_infrastructure/integrations/openrouter/client.ts \
  api/_modules/extract.ts \
  api/_modules/edit-draft.ts \
  api/_modules/whatsapp-leads.ts \
  tests/unit/openrouter-integration.test.ts \
  tests/unit/edit-draft.test.ts \
  tests/unit/extract-handler.test.ts \
  tests/unit/whatsapp-leads.test.ts
git commit -m "refactor(integrations): centralize OpenRouter client"
```

---

### Task 4: Encapsulate Vercel Blob config and SDK operations

**Files:**

- Create: `api/_infrastructure/integrations/blob/config.ts`
- Create: `api/_infrastructure/integrations/blob/client.ts`
- Create: `tests/unit/blob-integration.test.ts`
- Modify: `api/_modules/communication-media.ts:12-13,384-435,793`
- Modify: `api/_modules/communication-media-upload.ts:15,56`
- Modify: `api/_modules/postgres-media.ts:1,30,402-451`
- Modify: `api/_modules/quotation-document-storage.ts:28-34`
- Modify: `tests/unit/postgres-media.test.ts`
- Modify: `tests/unit/communication-api.test.ts`

**Interfaces:**

- Consumes: installed `@vercel/blob` and `@vercel/blob/client` only.
- Produces: `BlobConfig`, `getBlobConfig`, `BlobClient`, and `getBlobClient`.

- [ ] **Step 1: Write failing Blob config/client tests**

Create tests equivalent to:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBlobConfig } from '../../api/_infrastructure/integrations/blob/config.js';
import { getBlobClient } from '../../api/_infrastructure/integrations/blob/client.js';

test('normalizes active Blob credentials on every call', () => {
  const env: NodeJS.ProcessEnv = {
    BLOB_READ_WRITE_TOKEN: ' default-token ',
    BLOB_STORE_ID: ' default-store ',
  };
  assert.deepEqual(getBlobConfig(env), { token: 'default-token', storeId: 'default-store' });
  env.BLOB_STORE_ID = ' second-store ';
  assert.equal(getBlobConfig(env).storeId, 'second-store');
});

test('allows minimal SDK operation injection', async () => {
  const calls: string[] = [];
  const client = getBlobClient({
    head: async (url) => {
      calls.push(`head:${url}`);
      return {} as never;
    },
    del: async (url) => {
      calls.push(`del:${String(url)}`);
    },
    handleUpload: async () => {
      calls.push('upload');
      return {} as never;
    },
  });
  await client.head('https://blob.example/a');
  await client.del('https://blob.example/a');
  await client.handleUpload({} as never);
  assert.deepEqual(calls, ['head:https://blob.example/a', 'del:https://blob.example/a', 'upload']);
});
```

- [ ] **Step 2: Run build to verify missing-module failure**

```bash
npm run build:api
```

Expected: FAIL with `TS2307` for Blob integration modules.

- [ ] **Step 3: Implement Blob config and thin client**

Use these contracts:

```ts
export interface BlobConfig {
  token?: string;
  storeId?: string;
}

export function getBlobConfig(env: NodeJS.ProcessEnv = process.env): BlobConfig;

export interface BlobClient {
  head: typeof blobHead;
  del: typeof blobDelete;
  handleUpload: typeof blobHandleUpload;
}

export function getBlobClient(overrides: Partial<BlobClient> = {}): BlobClient;
```

Import SDK functions only inside `blob/client.ts`. Return `{ head, del, handleUpload }` with each override replacing only its named operation. Do not wrap errors or create alternate storage.

`getBlobConfig` trims values and returns `undefined` for empty strings. It does not define quotation aliases or fallback credentials.

- [ ] **Step 4: Delete dead quotation auth and migrate postgres media config**

- Delete deprecated, unreferenced `quotationBlobAuth()` from `quotation-document-storage.ts`; keep checksum, PDF validation, pathname, and error behavior unchanged.
- In `postgres-media.ts`, replace direct Blob env reads with `getBlobConfig()` while preserving explicit option precedence: explicit `options.token`/`options.storeId` first, config second.
- Replace the direct default `head` import with `getBlobClient().head`; keep `BlobHead`, `BlobHeadResult`, timeout, abort behavior, ownership checks, and injected `headFn` contract unchanged.

- [ ] **Step 5: Migrate communication media and upload**

- Replace `blobHead` and `blobDelete` imports in `communication-media.ts` with operations from `getBlobClient()`. Keep existing dependency overrides (`headFn`, `blobDelete`) first.
- Replace direct `handleUpload` import in `communication-media-upload.ts` with `getBlobClient().handleUpload`. Keep synthetic request, pathname validation, MIME/size policy, token payload, callback, and public errors unchanged.

- [ ] **Step 6: Run focused Blob/media tests**

```bash
npm run build:api && node --test --test-concurrency=1 \
  tests/unit/blob-integration.test.ts \
  tests/unit/postgres-media.test.ts \
  tests/unit/communication-api.test.ts \
  tests/unit/quotations-core.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run fast verification**

```bash
npm run verify:fast
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add \
  api/_infrastructure/integrations/blob/config.ts \
  api/_infrastructure/integrations/blob/client.ts \
  api/_modules/communication-media.ts \
  api/_modules/communication-media-upload.ts \
  api/_modules/postgres-media.ts \
  api/_modules/quotation-document-storage.ts \
  tests/unit/blob-integration.test.ts \
  tests/unit/postgres-media.test.ts \
  tests/unit/communication-api.test.ts \
  tests/unit/quotations-core.test.ts
git commit -m "refactor(integrations): encapsulate Vercel Blob"
```

---

### Task 5: Route runtime Vercel KV access through one adapter

**Files:**

- Create: `api/_infrastructure/integrations/kv/config.ts`
- Create: `api/_infrastructure/integrations/kv/client.ts`
- Create: `tests/unit/kv-integration.test.ts`
- Modify: `api/_modules/communication-flow-preview.ts`
- Modify: `api/_modules/communication-flows.ts`
- Modify: `api/_modules/communication-media.ts`
- Modify: `api/_modules/communication-send-events.ts`
- Modify: `api/_modules/postgres-media.ts`
- Modify: `api/_modules/public-quotation.ts`
- Modify: `api/_modules/send-whatsapp-flow.ts`
- Modify: `api/_modules/whatsapp-conversations-store.ts:159-170`
- Modify: `api/_modules/whatsapp-flows.ts`
- Modify: `api/_modules/whatsapp-send-reservation-store.ts`
- Modify: `api/_shared/rate-limit.ts:2,82`
- Modify: existing focused tests listed below only when import seams require adjustment.

**Interfaces:**

- Consumes: installed `@vercel/kv` client only.
- Produces: `KvClient`, `getKvClient`, and `isKvConfigured`.

- [ ] **Step 1: Write failing KV adapter/config tests**

Create:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getKvClient } from '../../api/_infrastructure/integrations/kv/client.js';
import { isKvConfigured } from '../../api/_infrastructure/integrations/kv/config.js';

test('checks KV env on every call without exposing values', () => {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(isKvConfigured(env), false);
  env.KV_REST_API_URL = ' https://kv.example ';
  env.KV_REST_API_TOKEN = ' token ';
  assert.equal(isKvConfigured(env), true);
  env.KV_REST_API_TOKEN = '   ';
  assert.equal(isKvConfigured(env), false);
});

test('returns the installed KV client', () => {
  const client = getKvClient();
  assert.equal(typeof client.get, 'function');
  assert.equal(typeof client.set, 'function');
});
```

- [ ] **Step 2: Run build to verify missing-module failure**

```bash
npm run build:api
```

Expected: FAIL with `TS2307` for KV integration modules.

- [ ] **Step 3: Implement minimal KV config/client**

Use:

```ts
import { kv as vercelKv } from '@vercel/kv';

export type KvClient = typeof vercelKv;

export function getKvClient(): KvClient {
  return vercelKv;
}

export function isKvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.KV_REST_API_URL?.trim() && env.KV_REST_API_TOKEN?.trim());
}
```

Keep config and client in separate files. Do not create repository methods, key builders, serializers, caches, or in-memory substitutes.

- [ ] **Step 4: Run KV adapter tests**

```bash
npm run build:api && node --test --test-concurrency=1 tests/unit/kv-integration.test.ts
```

Expected: PASS without contacting KV.

- [ ] **Step 5: Replace direct SDK imports mechanically**

In every file listed for this task:

1. Replace `import { kv } from '@vercel/kv'` with `import { getKvClient } from '../_infrastructure/integrations/kv/client.js'`; both `_modules` and `_shared` are siblings of `_infrastructure`.
2. Define `const kv = getKvClient();` at the existing module boundary. This captures only the installed SDK object, not env config.
3. Keep every key, TTL, scan cursor, transaction shape, serialization, error mapping, and dependency override unchanged.
4. Do not consolidate the modules into a shared KV repository.

- [ ] **Step 6: Replace direct KV configured-state reads**

In `whatsapp-conversations-store.ts` and `_shared/rate-limit.ts`, replace direct `KV_REST_API_URL`/`KV_REST_API_TOKEN` checks with `isKvConfigured()`. Preserve existing return values and fallback behavior already present in those modules; do not add new fallback paths.

- [ ] **Step 7: Run focused KV consumers**

```bash
npm run build:api && node --test --test-concurrency=1 \
  tests/unit/kv-integration.test.ts \
  tests/unit/rate-limit.test.ts \
  tests/unit/communication-flow-preview.test.ts \
  tests/unit/communication-send.test.ts \
  tests/unit/postgres-media.test.ts \
  tests/unit/public-quotation.test.ts \
  tests/unit/whatsapp-conversations-store.test.ts \
  tests/unit/whatsapp-flows.test.ts \
  tests/unit/whatsapp-send-reservation-store.test.ts
```

Expected: PASS without remote KV.

- [ ] **Step 8: Run fast verification**

```bash
npm run verify:fast
```

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add \
  api/_infrastructure/integrations/kv/config.ts \
  api/_infrastructure/integrations/kv/client.ts \
  api/_modules/communication-flow-preview.ts \
  api/_modules/communication-flows.ts \
  api/_modules/communication-media.ts \
  api/_modules/communication-send-events.ts \
  api/_modules/postgres-media.ts \
  api/_modules/public-quotation.ts \
  api/_modules/send-whatsapp-flow.ts \
  api/_modules/whatsapp-conversations-store.ts \
  api/_modules/whatsapp-flows.ts \
  api/_modules/whatsapp-send-reservation-store.ts \
  api/_shared/rate-limit.ts \
  tests/unit/kv-integration.test.ts
git commit -m "refactor(integrations): centralize Vercel KV access"
```

---

### Task 6: Enforce the external integration boundary and verify the phase

**Files:**

- Create: `scripts/check-external-integration-boundary.mjs`
- Create: `tests/unit/external-integration-boundary.test.ts`
- Modify: `package.json:20-24`

**Interfaces:**

- Consumes: final file layout from Tasks 1-5.
- Produces: `findExternalIntegrationBoundaryViolations(files)` and `npm run check:integration-boundary`.

- [ ] **Step 1: Write failing boundary checker tests**

Create `tests/unit/external-integration-boundary.test.ts` using source objects shaped as `{ path, content }`. Cover exact failures:

```ts
assert.deepEqual(
  findExternalIntegrationBoundaryViolations([
    source('api/_modules/a.ts', "import { kv } from '@vercel/kv';\n"),
    source('api/_shared/b.ts', 'const key = process.env.OPENROUTER_API_KEY;\n'),
    source('api/_modules/c.ts', "fetch('https://openrouter.ai/api/v1/chat/completions');\n"),
  ]),
  [
    { path: 'api/_modules/a.ts', line: 1, target: '@vercel/kv' },
    { path: 'api/_modules/c.ts', line: 1, target: 'openrouter endpoint' },
    { path: 'api/_shared/b.ts', line: 1, target: 'OPENROUTER_API_KEY' },
  ]
);
```

Also assert:

- static and dynamic imports of `@vercel/blob`, `@vercel/blob/client`, and `@vercel/kv` fail;
- direct env reads for prefixes `EVOLUTION_`, `OPENROUTER_`, `BLOB_`, `QUOTATION_BLOB_`, and exact KV keys fail;
- literal `openrouter.ai` and direct `process.env.EVOLUTION_BASE_URL` URL assembly in runtime files fail;
- files under `api/_infrastructure/integrations` and `scripts/` are accepted because they are outside collected scope;
- imports from `../_infrastructure/integrations/.../*.js` are accepted;
- findings are sorted by path, line, target.

- [ ] **Step 2: Run test to verify missing checker failure**

```bash
node --test --test-concurrency=1 tests/unit/external-integration-boundary.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/check-external-integration-boundary.mjs`.

- [ ] **Step 3: Implement the smallest static checker**

Follow `scripts/check-postgres-boundary.mjs` structure:

```js
const RUNTIME_ROOTS = [resolve(PROJECT_ROOT, 'api/_modules'), resolve(PROJECT_ROOT, 'api/_shared')];

const FORBIDDEN_IMPORTS = /^@vercel\/(?:blob(?:\/client)?|kv)$/;
const PROVIDER_ENV_NAME =
  /^(?:EVOLUTION_[A-Z0-9_]+|OPENROUTER_[A-Z0-9_]+|(?:QUOTATION_)?BLOB_[A-Z0-9_]+|KV_REST_API_(?:URL|TOKEN))$/;
const PROCESS_ENV_ACCESS =
  /\bprocess\s*\.\s*env\s*(?:\.\s*([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;
const FORBIDDEN_ENDPOINTS = [
  { pattern: /openrouter\.ai\/api\/v1\/chat\/completions/g, target: 'openrouter endpoint' },
];
```

Reuse or copy only the small import parsing, line-number, recursive `.ts` collection, deterministic sorting, exported pure finder, and CLI pattern needed from the PostgreSQL checker. Match `PROCESS_ENV_ACCESS`, extract either capture group, and report it only when `PROVIDER_ENV_NAME.test(name)` is true. This forbids reads, not harmless variable-name strings retained in missing-config errors. Do not refactor the existing checker in this phase.

For Evolution, forbid direct provider URL construction by rejecting `process.env.EVOLUTION_BASE_URL` access; do not guess arbitrary deployment hostnames. Provider-name strings used as domain data, such as `source: 'evolution'`, and labels such as `'EVOLUTION_BASE_URL'` remain allowed.

CLI output format:

```text
api/_modules/file.ts:12: direct external integration access: @vercel/kv
```

Exit 1 when findings exist; exit 0 otherwise.

- [ ] **Step 4: Run checker unit tests**

```bash
node --test --test-concurrency=1 tests/unit/external-integration-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add package command and fast-verification gate**

Add:

```json
"check:integration-boundary": "node scripts/check-external-integration-boundary.mjs"
```

Update `verify:fast` to run it immediately after `check:db-boundary`:

```json
"verify:fast": "npm run lint && npm run typecheck && npm run check:db-boundary && npm run check:integration-boundary && npm run check:db-migrations && npm run check:vercel-functions && npm run test:unit"
```

- [ ] **Step 6: Run boundary checker against repository**

```bash
npm run check:integration-boundary
```

Expected: exit 0, no violations.

- [ ] **Step 7: Run full verification with captured output**

Run:

```bash
npm run verify:full
```

Expected: exit 0; unit and local E2E suites pass. Use context-mode capture when executing this command to avoid flooding session context.

- [ ] **Step 8: Verify repository invariants**

Run:

```bash
git diff --check
git diff --name-only HEAD~5..HEAD -- drizzle public
git status --short
```

Expected:

- `git diff --check`: exit 0;
- no `drizzle/` or `public/` paths caused by this phase;
- only intended Phase 19 files remain, ideally none after commits.

- [ ] **Step 9: Commit enforcement**

```bash
git add \
  scripts/check-external-integration-boundary.mjs \
  tests/unit/external-integration-boundary.test.ts \
  package.json
git commit -m "test(architecture): enforce integration boundaries"
```

- [ ] **Step 10: Request independent final review**

Review against:

- `docs/superpowers/specs/2026-08-19-integracoes-externas-design.md`;
- this plan;
- all Phase 19 commits;
- no expansion beyond the approved four-provider runtime boundary.

Resolve only blocking findings or approved scope corrections. Maximum three review/fix rounds.
