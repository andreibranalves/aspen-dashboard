# Refatoração Fases 0-3: Rotas Únicas e Pipeline Compartilhado — Plano de Implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa.
> Passos usam sintaxe de checkbox (`- [ ]`) para rastreamento.

**Goal:** Eliminar as três definições duplicadas do mapa de rotas da API e centralizar o fluxo HTTP (auth, rate limit, dispatch, normalização de erro) em um único pipeline compartilhado entre o runtime Vercel e o runtime Node local, removendo o servidor dev redundante.

**Architecture:** Um único mapa `api/_app/routes.ts` é importado por todos os runtimes.
Um único `api/_app/handle-request.ts` executa o pipeline `auth -> rate limit -> dispatch -> normalização de erro`.
Os runtimes ficam responsáveis apenas por adaptação de transporte: `api/_http/vercel-adapter.ts` para Vercel e `api/_http/node-adapter.ts` para `node:http` puro.
O contrato Lambda (`FunctionEvent -> FunctionResult`) existente em `api/_lib/` é preservado integralmente; nenhum handler é alterado.

**Tech Stack:** Node.js 22 (type stripping nativo), TypeScript 5.9, `node:http`, Vercel serverless functions, `node:test` para testes de unidade.

**Spec:** `aspen-dashboard-plano-refatoracao.md` (raiz do repositório) — este plano implementa as Fases 0, 1, 2 e 3 da spec.

## Global Constraints

- Manter React + Vite, Node.js, PostgreSQL + Drizzle e monólito modular.
- Manter Vercel como runtime principal de produção.
- Não introduzir microservices, Kubernetes, Nx ou Turborepo.
- Não fazer reescrita: nenhum handler em `api/_functions/` muda de assinatura neste plano.
- Backend ESM: imports de `.js` exigem extensão explícita no código-fonte.
- Vite builda para `public/` com `emptyOutDir: false`.
- Erros retornados a usuários em português brasileiro.
- Manter os três mapas de rotas sincronizados deixa de ser regra: após este plano existe um único mapa.

---

## Decisão de escopo (writing-plans)

A spec cobre mais de 20 fases que entregam software independente (pipeline HTTP, reorganização de domínios, Preview staging, CI, release lanes, limpeza de legado).
Este plano cobre as Fases 0-3, que formam a prioridade arquitetural número 1 da spec e são entregáveis sozinhas: ao final, uma rota nova é registrada uma única vez e o fluxo HTTP existe uma única vez.
As demais fases viram planos separados (ver "Próximos planos" no final).

---

## Task 1: Baseline executável (Fase 0)

Registrar o estado atual como saudável antes de qualquer mudança estrutural.

**Files:**

- Create: `docs/baseline-refatoracao.md`

**Interfaces:**

- Consumes: nada (somente leitura do estado atual).
- Produces: `docs/baseline-refatoracao.md` — referência para comparar regressões nas Tasks 2-5.

- [ ] **Step 1: Rodar checks e registrar tempos**

Run:

```bash
time npm run check
time npm run test:unit
time npx playwright test
```

Anotar resultado (verde/vermelho) e tempo de cada um.
Se algum Playwright spec falhar por depender de staging, registrar exatamente quais specs falharam e por quê (`tests/postgres-only-cutover.spec.js` e `tests/quotation-cutover-staging.spec.js` são staging-only; o restante deve rodar localmente).

- [ ] **Step 2: Inventariar endpoints**

Os 44 endpoints atuais estão no bloco `ROUTES` de `api/[...path].ts`.
Copiar a lista abaixo para o baseline:

```text
operational-status, client-detail, crm-deals, crm-prune-candidates, crm-update-deal,
duplicate-quotation, edit-draft, extract, leads-clients, login, logout, orcamento, pdf,
pricing-lookup, product-detail, product-update, product-pricing-update, product-activity,
product-pricing, products, quote-leads, quotations, quotation-templates, order-templates,
quotation-preview, quotation-issues, public-quotation, sales-dashboard,
sales-order-from-quotation, sales-orders, send-whatsapp, send-whatsapp-flow,
whatsapp-send-status, settings, typebot-lead-capture, whatsapp-conversations,
whatsapp-flows, whatsapp-leads, communication-flow-preview, communication-send-events,
communication-flows, communication-media, communication-media-upload, view
```

Conferir com:

```bash
node --test tests/unit/route-map.test.ts
```

- [ ] **Step 3: Inventariar integrações externas e variáveis de ambiente**

Run:

```bash
grep -rhoE "process\.env\.[A-Z0-9_]+" api scripts --include="*.ts" --include="*.mjs" | sort | uniq -c | sort -rn
grep -rlnE "EVOLUTION|OPENROUTER|META_CAPI|TYPEBOT|KV_REST|BLOB_READ" api --include="*.ts" | sort
```

Anotar no baseline: lista de env vars usadas, e quais arquivos tocam cada integração externa (Evolution, OpenRouter, Meta CAPI, Typebot, Vercel KV, Vercel Blob).

- [ ] **Step 4: Identificar migrations aplicadas em produção**

Run:

```bash
ls drizzle/migrations
```

E, com acesso ao banco de produção do operador:

```bash
psql "$DATABASE_URL" -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
```

Anotar no baseline quais migrations existem localmente e quais constam como aplicadas em produção.

- [ ] **Step 5: Identificar testes que dependem de providers externos**

Run:

```bash
grep -rlnE "EVOLUTION|OPENROUTER|KV_REST|BLOB_READ|META_CAPI" tests
```

Anotar no baseline a lista de arquivos de teste.

- [ ] **Step 6: Escrever o baseline**

Escrever `docs/baseline-refatoracao.md` com seções: "Checks e tempos", "Endpoints", "Integrações externas", "Variáveis de ambiente", "Migrations em produção", "Testes com dependência externa".
Uma linha por item, formato tabela.

- [ ] **Step 7: Commit**

```bash
git add docs/baseline-refatoracao.md
git commit -m "docs: registrar baseline de refatoração arquitetural"
```

---

## Task 2: Mapa único de rotas (Fase 1)

**Files:**

- Create: `api/_app/routes.ts`
- Modify: `api/[...path].ts`
- Modify: `scripts/app-server.mjs`
- Test: `tests/unit/routes.test.ts`
- Delete: `tests/unit/route-map.test.ts` (substituído pelo novo teste; o teste antigo exige 3 mapas e passa a falhar de propósito)

**Interfaces:**

- Consumes: `LegacyHandler` de `api/_lib/types.ts`; handlers existentes de `api/_functions/*.ts`.
- Produces: `export const routes: Record<string, LegacyHandler>` com exatamente 44 entradas, consumido pelo catch-all Vercel, pelo `app-server.mjs` e, nas Tasks 3-4, pelo pipeline compartilhado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/routes.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { routes } from '../api/_app/routes.js';

test('routes: 44 nomes únicos e bem formados', () => {
  const names = Object.keys(routes);
  assert.equal(names.length, 44);
  assert.equal(new Set(names).size, names.length, 'nomes duplicados');
  for (const name of names) assert.match(name, /^[a-z][a-z0-9-]*$/, name);
});

test('routes: todos os handlers são funções', () => {
  for (const [name, handler] of Object.entries(routes)) {
    assert.equal(typeof handler, 'function', name);
  }
});

test('routes: nenhum outro arquivo define mapa de rotas', () => {
  for (const relativePath of ['../../api/[...path].ts', '../../scripts/app-server.mjs']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.ok(!source.includes('const ROUTES'), `${relativePath} não deve definir ROUTES`);
  }
});
```

Apagar `tests/unit/route-map.test.ts` neste mesmo passo.

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `TZ=UTC node --test tests/unit/routes.test.ts`
Expected: FAIL com "Cannot find module" para `api/_app/routes.js`.

- [ ] **Step 3: Criar `api/_app/routes.ts`**

Conteúdo completo (44 handlers, mesmo conjunto dos dois mapas atuais):

```ts
// Única definição de rotas da API. Novos endpoints são registrados aqui, uma única vez.
import type { LegacyHandler } from '../_lib/types.js';

import { handler as crmDeals } from '../_functions/crm-deals.js';
import { handler as crmUpdateDeal } from '../_functions/crm-update-deal.js';
import { handler as crmPruneCandidates } from '../_functions/crm-prune-candidates.js';
import { handler as duplicateQuotation } from '../_functions/duplicate-quotation.js';
import { handler as editDraft } from '../_functions/edit-draft.js';
import { handler as extract } from '../_functions/extract.js';
import { handler as clientDetail } from '../_functions/client-detail.js';
import { handler as leadsClients } from '../_functions/leads-clients.js';
import { handler as login } from '../_functions/login.js';
import { handler as logout } from '../_functions/logout.js';
import { handler as orcamento } from '../_functions/orcamento.js';
import { handler as pricingLookup } from '../_functions/pricing-lookup.js';
import { handler as productDetail } from '../_functions/product-detail.js';
import { handler as productUpdate } from '../_functions/product-update.js';
import { handler as productPricingUpdate } from '../_functions/product-pricing-update.js';
import { handler as productActivity } from '../_functions/product-activity.js';
import { handler as productPricing } from '../_functions/product-pricing.js';
import { handler as products } from '../_functions/products.js';
import { handler as quoteLeads } from '../_functions/quote-leads.js';
import { handler as quotations } from '../_functions/quotations.js';
import { handler as quotationTemplates } from '../_functions/quotation-templates.js';
import { handler as orderTemplates } from '../_functions/order-templates.js';
import { handler as quotationPreview } from '../_functions/quotation-preview.js';
import { handler as quotationIssues } from '../_functions/quotation-issues.js';
import { handler as publicQuotation } from '../_functions/public-quotation.js';
import { handler as salesDashboard } from '../_functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from '../_functions/sales-order-from-quotation.js';
import { handler as salesOrders } from '../_functions/sales-orders.js';
import { handler as sendWhatsapp } from '../_functions/send-whatsapp.js';
import { handler as sendWhatsappFlow } from '../_functions/send-whatsapp-flow.js';
import { handler as whatsappSendStatus } from '../_functions/whatsapp-send-status.js';
import { handler as settings } from '../_functions/settings.js';
import { handler as typebotLeadCapture } from '../_functions/typebot-lead-capture.js';
import { handler as whatsappConversations } from '../_functions/whatsapp-conversations.js';
import { handler as whatsappFlows } from '../_functions/whatsapp-flows.js';
import { handler as whatsappLeads } from '../_functions/whatsapp-leads.js';
import { handler as communicationFlowPreview } from '../_functions/communication-flow-preview.js';
import { handler as communicationSendEvents } from '../_functions/communication-send-events.js';
import { handler as communicationFlows } from '../_functions/communication-flows.js';
import { handler as communicationMedia } from '../_functions/communication-media.js';
import { handler as communicationMediaUpload } from '../_functions/communication-media-upload.js';
import { handler as pdf } from '../_functions/pdf.js';
import { handler as view } from '../_functions/view.js';
import { handler as operationalStatus } from '../_functions/operational-status.js';

export const routes: Record<string, LegacyHandler> = {
  'operational-status': operationalStatus,
  'client-detail': clientDetail,
  'crm-deals': crmDeals,
  'crm-prune-candidates': crmPruneCandidates,
  'crm-update-deal': crmUpdateDeal,
  'duplicate-quotation': duplicateQuotation,
  'edit-draft': editDraft,
  extract,
  'leads-clients': leadsClients,
  orcamento,
  pdf,
  'pricing-lookup': pricingLookup,
  'product-detail': productDetail,
  'product-update': productUpdate,
  'product-pricing-update': productPricingUpdate,
  'product-activity': productActivity,
  'product-pricing': productPricing,
  products,
  'quote-leads': quoteLeads,
  quotations,
  'quotation-templates': quotationTemplates,
  'order-templates': orderTemplates,
  'quotation-preview': quotationPreview,
  'quotation-issues': quotationIssues,
  'public-quotation': publicQuotation,
  'sales-dashboard': salesDashboard,
  'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders,
  'send-whatsapp': sendWhatsapp,
  'send-whatsapp-flow': sendWhatsappFlow,
  'whatsapp-send-status': whatsappSendStatus,
  settings,
  'typebot-lead-capture': typebotLeadCapture,
  'whatsapp-conversations': whatsappConversations,
  'whatsapp-flows': whatsappFlows,
  'whatsapp-leads': whatsappLeads,
  'communication-flow-preview': communicationFlowPreview,
  'communication-send-events': communicationSendEvents,
  'communication-flows': communicationFlows,
  'communication-media': communicationMedia,
  'communication-media-upload': communicationMediaUpload,
  view,
  login,
  logout,
};
```

- [ ] **Step 4: Ligar o catch-all Vercel ao mapa único**

Em `api/[...path].ts`:
Remover as 44 linhas de import de handlers e o bloco `const ROUTES: Record<string, HandlerFunction> = { ... };` (com `type HandlerFunction`).
Adicionar `import { routes } from './_app/routes.js';` junto aos outros imports e trocar `ROUTES[routeName]` por `routes[routeName]` no corpo do handler.
O fluxo de guards (401, 429, 404, `wrapFunctionHandler`) permanece idêntico nesta Task.

- [ ] **Step 5: Ligar o `app-server.mjs` ao mapa único**

Em `scripts/app-server.mjs`:
Remover as 44 linhas de import de handlers e o literal `const ROUTES = { ... };`.
Adicionar `import { routes } from '../api/_app/routes.js';` após o import de `load-env-side-effect.mjs`.
Trocar `const handler = ROUTES[routeName]` por `const handler = routes[routeName]`.
Nada mais muda neste arquivo nesta Task (o `console.log` final que cita o número de handlers pode citar `Object.keys(routes).length`).

- [ ] **Step 6: Rodar os testes e verificar que passam**

Run:

```bash
TZ=UTC node --test tests/unit/routes.test.ts
npm run type-check
```

Expected: PASS (3 testes) e type-check sem erros.

- [ ] **Step 7: Rodar a suíte completa**

Run:

```bash
npm run test:unit
```

Expected: verde, incluindo os demais testes de unidade que importam handlers.

- [ ] **Step 8: Commit**

```bash
git add api/_app/routes.ts 'api/[...path].ts' scripts/app-server.mjs tests/unit/routes.test.ts tests/unit/route-map.test.ts
git commit -m "refactor: centralizar mapa de rotas em api/_app/routes.ts"
```

---

## Task 3: Pipeline compartilhado (Fase 2, lado Vercel)

**Files:**

- Create: `api/_app/handle-request.ts`
- Create: `api/_http/vercel-adapter.ts`
- Modify: `api/[...path].ts` (vira casca fina)
- Test: `tests/unit/handle-request.test.ts`

**Interfaces:**

- Consumes: `routes` (Task 2), `isAuthenticated`/`getRouteName` de `api/_lib/auth.ts`, `checkRateLimitAsync` de `api/_lib/rate-limit.ts`, `wrapFunctionHandler` de `api/_lib/function-adapter.ts`, `VercelRequestLike`/`VercelResponseLike` de `api/_lib/types.ts`.
- Produces: `handleApiRequest(req: IncomingMessage, res: VercelResponseLike): Promise<void>` e `normalizeHandlerError(routeName: string, err: unknown): { statusCode: number; message: string }` — consumidos pelo Node adapter na Task 4.
- Produces: `createVercelHandler(handle): (req: VercelRequestLike, res: VercelResponseLike) => Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/handle-request.test.ts`:

```ts
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import type { VercelResponseLike } from '../api/_lib/types.js';
import { createHttpError } from '../api/_lib/http-error.js';
import { handleApiRequest, normalizeHandlerError } from '../api/_app/handle-request.js';

function fakeResponse() {
  let statusCode = 200;
  const bodies: unknown[] = [];
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      bodies.push(data);
    },
    send(_data: unknown) {},
    setHeader(_key: string, _value: string | number | string[]) {},
  } satisfies VercelResponseLike;
  return { res, lastStatus: () => statusCode, lastBody: () => bodies[bodies.length - 1] };
}

const SAVED_ENV: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(SAVED_ENV)) delete SAVED_ENV[key];
});

function withEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in SAVED_ENV)) SAVED_ENV[key] = process.env[key];
    process.env[key] = value;
  }
}

test('normalizeHandlerError: public-quotation vira 503 com mensagem fixa', () => {
  const result = normalizeHandlerError('public-quotation', new Error('detalhe interno'));
  assert.deepEqual(result, {
    statusCode: 503,
    message: 'Não foi possível consultar o orçamento. Tente novamente.',
  });
});

test('normalizeHandlerError: HttpError preserva statusCode e mensagem pública', () => {
  const result = normalizeHandlerError('quotations', createHttpError(422, 'Dados inválidos.'));
  assert.deepEqual(result, { statusCode: 422, message: 'Dados inválidos.' });
});

test('normalizeHandlerError: erro genérico vira 500 sem vazar detalhes', () => {
  const result = normalizeHandlerError('quotations', new Error('secret SQL detail'));
  assert.deepEqual(result, { statusCode: 500, message: 'Erro interno. Tente novamente.' });
});

test('handleApiRequest: sem autenticação responde 401', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: '', APP_PASSWORD_HASH: '', APP_SESSION_SECRET: '' });
  const req = { method: 'GET', url: '/api/products', headers: {} } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, lastBody } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 401);
  assert.deepEqual(lastBody(), { error: 'Não autorizado. Faça login em /api/login.' });
});

test('handleApiRequest: rota inexistente responde 404 via pipeline completo', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const req = { method: 'GET', url: '/api/rota-inexistente', headers: {} } as unknown as import('node:http').IncomingMessage;
  const { res, lastStatus, lastBody } = fakeResponse();
  await handleApiRequest(req, res);
  assert.equal(lastStatus(), 404);
  assert.deepEqual(lastBody(), { error: 'Endpoint não encontrado.' });
});
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `TZ=UTC node --test tests/unit/handle-request.test.ts`
Expected: FAIL com "Cannot find module" para `api/_app/handle-request.js`.

- [ ] **Step 3: Criar `api/_app/handle-request.ts`**

```ts
// Pipeline HTTP único: auth -> rate limit -> dispatch -> normalização de erro.
// Runtimes (Vercel, Node) apenas adaptam transporte para este contrato.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from '../_lib/types.js';
import { getRouteName, isAuthenticated } from '../_lib/auth.js';
import { checkRateLimitAsync } from '../_lib/rate-limit.js';
import { wrapFunctionHandler } from '../_lib/function-adapter.js';
import { routes } from './routes.js';

export function normalizeHandlerError(
  routeName: string,
  err: unknown
): { statusCode: number; message: string } {
  if (routeName === 'public-quotation') {
    return {
      statusCode: 503,
      message: 'Não foi possível consultar o orçamento. Tente novamente.',
    };
  }
  const statusCode =
    err !== null && typeof err === 'object' && Number.isInteger((err as { statusCode?: unknown }).statusCode)
      ? (err as { statusCode: number }).statusCode
      : 500;
  const message = statusCode !== 500 && err instanceof Error ? err.message : 'Erro interno. Tente novamente.';
  return { statusCode, message };
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: VercelResponseLike
): Promise<void> {
  const requestLike = req as unknown as VercelRequestLike;
  const routeName = getRouteName(requestLike);
  try {
    if (!isAuthenticated(requestLike)) {
      res.status(401).json({ error: 'Não autorizado. Faça login em /api/login.' });
      return;
    }
    if (!(await checkRateLimitAsync(requestLike))) {
      res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
      return;
    }
    const routeHandler = routes[routeName];
    if (!routeHandler) {
      res.status(404).json({ error: 'Endpoint não encontrado.' });
      return;
    }
    await wrapFunctionHandler(routeHandler)(req, res as unknown as ServerResponse);
  } catch (err) {
    console.error(`[api/${routeName}]`, err instanceof Error ? err.name : typeof err);
    const { statusCode, message } = normalizeHandlerError(routeName, err);
    res.status(statusCode).json({ error: message });
  }
}
```

Nota de comportamento: hoje o `app-server.mjs` normaliza erro com 503 para `public-quotation` e mensagem genérica para o resto, enquanto o catch-all Vercel deixava a plataforma responder 500 cru.
O pipeline unifica no comportamento mais seguro (mensagem fixa, sem vazar detalhes), preservando `statusCode` de `HttpError`.

- [ ] **Step 4: Criar `api/_http/vercel-adapter.ts`**

```ts
// Adapter de transporte para funções serverless da Vercel.
// A plataforma já entrega body/query parseados; só há casts para o contrato Node.
import type { IncomingMessage } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from '../_lib/types.js';

export function createVercelHandler(
  handle: (req: IncomingMessage, res: VercelResponseLike) => Promise<void>
) {
  return async function vercelApiHandler(
    req: VercelRequestLike,
    res: VercelResponseLike
  ): Promise<void> {
    return handle(req as unknown as IncomingMessage, res);
  };
}
```

- [ ] **Step 5: Reduzir o catch-all Vercel a uma casca**

Substituir o conteúdo de `api/[...path].ts` por:

```ts
import { handleApiRequest } from './_app/handle-request.js';
import { createVercelHandler } from './_http/vercel-adapter.js';

export default createVercelHandler(handleApiRequest);
```

- [ ] **Step 6: Rodar testes e type-check**

Run:

```bash
TZ=UTC node --test tests/unit/handle-request.test.ts
npm run type-check
```

Expected: PASS (5 testes) e type-check sem erros.

- [ ] **Step 7: Commit**

```bash
git add api/_app/handle-request.ts api/_http/vercel-adapter.ts 'api/[...path].ts' tests/unit/handle-request.test.ts
git commit -m "refactor: extrair pipeline HTTP compartilhado (handle-request)"
```

---

## Task 4: Node adapter e rewire do `app-server.mjs` (Fase 2, lado Node)

**Files:**

- Create: `api/_http/node-adapter.ts`
- Modify: `scripts/app-server.mjs`
- Test: `tests/unit/node-adapter.test.ts`

**Interfaces:**

- Consumes: `handleApiRequest` (Task 3).
- Produces: `createNodeHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>` — callback direto para `createServer`.
  Trata CORS, OPTIONS, parse de body e de query params antes de delegar ao pipeline.

Nota de ponytail: os arquivos `api/_http/request.ts` e `api/_http/response.ts` citados na spec não são criados agora — `node-adapter.ts` é o único consumidor dessas adaptações.
Extrair só quando houver um segundo consumidor.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/node-adapter.test.ts`:

```ts
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { afterEach } from 'node:test';
import { createNodeHandler } from '../api/_http/node-adapter.js';

async function withServer() {
  const server = createServer(createNodeHandler());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

const SAVED_ENV: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(SAVED_ENV)) delete SAVED_ENV[key];
});

function withEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in SAVED_ENV)) SAVED_ENV[key] = process.env[key];
    process.env[key] = value;
  }
}

test('node adapter: OPTIONS responde 204 com cabeçalhos CORS', async () => {
  const { baseUrl, close } = await withServer();
  try {
    const res = await fetch(`${baseUrl}/api/anything`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE, OPTIONS');
  } finally {
    await close();
  }
});

test('node adapter: rota inexistente responde 404 pelo pipeline', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  const { baseUrl, close } = await withServer();
  try {
    const res = await fetch(`${baseUrl}/api/rota-inexistente`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Endpoint não encontrado.' });
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `TZ=UTC node --test tests/unit/node-adapter.test.ts`
Expected: FAIL com "Cannot find module" para `api/_http/node-adapter.js`.

- [ ] **Step 3: Criar `api/_http/node-adapter.ts`**

```ts
// Adapter de transporte para node:http puro (dev local e staging VPS).
// Adapta CORS, OPTIONS, body e query para o contrato do pipeline compartilhado.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelResponseLike } from '../_lib/types.js';
import { handleApiRequest } from '../_app/handle-request.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const mediaType = String(req.headers['content-type'] || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (mediaType === 'application/x-www-form-urlencoded') {
        resolve(body);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function normalizeQueryParams(url: string): Record<string, string> {
  const params = new URL(url, 'http://localhost').searchParams;
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    // Em query strings, '+' representa espaço; Vercel dev pode codificar '+' como '%2B'.
    result[key] = value.replace(/\+/g, ' ');
  }
  return result;
}

function adaptResponse(res: ServerResponse): VercelResponseLike {
  const adapted: VercelResponseLike = {
    status(code) {
      res.statusCode = code;
      return adapted;
    },
    json(data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    },
    send(body) {
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
      res.end(body as string | Buffer);
    },
    setHeader(key, value) {
      res.setHeader(key, value);
    },
  };
  return adapted;
}

export function createNodeHandler() {
  return async function nodeApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const requestRecord = req as IncomingMessage & { query?: Record<string, string>; body?: unknown };
    requestRecord.query = normalizeQueryParams(req.url || '');
    if (req.method !== 'GET') requestRecord.body = await parseBody(req);
    await handleApiRequest(req, adaptResponse(res));
  };
}
```

- [ ] **Step 4: Rewire do `scripts/app-server.mjs`**

Trocar o bloco de imports de handlers (as 44 linhas) e os imports de `isAuthenticated`/`checkRateLimitAsync` por uma única linha:

```js
import { createNodeHandler } from '../api/_http/node-adapter.js';
```

O import de `load-env-side-effect.mjs` já existente permanece onde está (acima dos imports de `api/_lib`).

Remover de `scripts/app-server.mjs`:
O literal `const ROUTES = { ... };`, as funções `parseBody` e `normalizeQueryParams`, e os imports de `../api/_lib/auth.js` e `../api/_lib/rate-limit.js`.
Manter `load-env-side-effect.mjs`, `serveStatic`, `MIME_TYPES`, `PUBLIC_DIR` e o listener final.

Substituir o corpo do `createServer` por:

```js
const handleApiRequest = createNodeHandler();

const server = createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // API routes: pipeline compartilhado (auth, rate limit, dispatch, erro normalizado).
  if (urlPath.startsWith('/api/')) {
    await handleApiRequest(req, res);
    return;
  }

  // Static files / SPA
  if (!serveStatic(urlPath, res)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});
```

E o log final para:

```js
console.log(`App server on http://0.0.0.0:${PORT} (frontend: public/, API: pipeline compartilhado)`);
```

Mudança de comportamento aceita e intencional: `OPTIONS` fora de `/api/*` deixa de responder 204 e cai no static.
Nenhum cliente do app faz preflight fora de `/api`.

- [ ] **Step 5: Rodar testes e type-check**

Run:

```bash
TZ=UTC node --test tests/unit/node-adapter.test.ts
npm run type-check
```

Expected: PASS (2 testes) e type-check sem erros.

- [ ] **Step 6: Smoke test local**

Run:

```bash
npm run dev
```

Em outro terminal, com `APP_AUTH_BYPASS=true` presente no ambiente local (ou usando um cookie de sessão real):

```bash
curl -s http://localhost:8888/api/operational-status | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8888/api/rota-inexistente
```

Expected: `operational-status` responde JSON, `5173` responde 200 (SPA via vite), rota inexistente responde 404.

- [ ] **Step 7: Rodar a suíte completa**

Run: `npm run test:unit`
Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add api/_http/node-adapter.ts scripts/app-server.mjs tests/unit/node-adapter.test.ts
git commit -m "refactor: usar pipeline compartilhado no app-server via node-adapter"
```

---

## Task 5: Remover `dev-api-server.mjs` (Fase 3)

O `npm run dev` já usa `scripts/vite-dev.mjs`, que spawna `app-server.mjs` na porta 8888 e o Vite proxyia `/api` para lá (`vite.config.js` já tem `proxy: { '/api': { target: 'http://localhost:8888' } }`).
Ou seja, o estado alvo da Fase 3 já existe funcionalmente: `dev-api-server.mjs` é o terceiro mapa de rotas, sem consumidor em runtime.
Não há mudança necessária em `vite-dev.mjs` nem em `vite.config.js`.

**Files:**

- Delete: `scripts/dev-api-server.mjs`
- Modify: `AGENTS.md` (raiz)
- Modify: `scripts/AGENTS.md`

**Interfaces:**

- Consumes: nada.
- Produces: nenhum arquivo runtime referencia mais `dev-api-server.mjs`.

- [ ] **Step 1: Verificar que não há consumidor em runtime**

Run:

```bash
grep -rn "dev-api-server" --exclude-dir=node_modules --exclude-dir=.pi --exclude-dir=docs --exclude-dir=public --exclude-dir=aspen-vault .
```

Expected: apenas referências em `AGENTS.md` (raiz), `scripts/AGENTS.md` e no próprio arquivo.
Referências em `docs/superpowers/**` são históricas e ficam como estão.

- [ ] **Step 2: Apagar o servidor dev redundante**

Run:

```bash
git rm scripts/dev-api-server.mjs
```

- [ ] **Step 3: Atualizar a documentação de agentes**

Em `AGENTS.md` (raiz), substituir a linha:

```text
- **Local API development** uses `scripts/dev-api-server.mjs` on port 8888.
```

por:

```text
- **Local API development** uses `npm run dev` (`scripts/vite-dev.mjs`), which runs `scripts/app-server.mjs` on port 8888 behind the Vite `/api` proxy.
```

E substituir a linha:

```text
- `ROUTES` maps are duplicated across `api/[...path].ts`, `scripts/dev-api-server.mjs` and `scripts/app-server.mjs`.
- Keep all three route maps synchronized when adding or removing endpoints.
```

por:

```text
- `api/_app/routes.ts` is the single route map shared by the Vercel catch-all and `scripts/app-server.mjs`.
- Register new endpoints once in `api/_app/routes.ts`.
```

Em `scripts/AGENTS.md`, remover `dev-api-server.mjs` do diagrama de arquivos.

- [ ] **Step 4: Rodar testes e type-check**

Run:

```bash
npm run test:unit
npm run type-check
```

Expected: verde.

- [ ] **Step 5: Smoke test do fluxo dev completo**

Run:

```bash
npm run dev
```

Em outro terminal:

```bash
curl -s -o /dev/null -w "vite: %{http_code}\n" http://localhost:5173/
curl -s -o /dev/null -w "api via proxy: %{http_code}\n" http://localhost:5173/api/rota-inexistente
curl -s -o /dev/null -w "api direto: %{http_code}\n" http://localhost:8888/api/rota-inexistente
```

Expected: 200 (vite), 404 (proxy), 404 (direto) — um único servidor de API para desenvolvimento local.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-api-server.mjs AGENTS.md scripts/AGENTS.md
git commit -m "refactor: remover dev-api-server.mjs redundante"
```

---

## Verificação final do plano (Fases 0-3 completas)

Run:

```bash
npm run check
npm run test:unit
```

Expected: tudo verde.
Critério de conclusão da Fase 1: `tests/unit/routes.test.ts` garante que nenhum arquivo fora de `api/_app/routes.ts` define mapa de rotas.
Critério de conclusão da Fase 2: `api/[...path].ts` é uma casca de uma linha via `createVercelHandler`; `app-server.mjs` delega todo o fluxo HTTP ao `createNodeHandler`.
Critério de conclusão da Fase 3: um único servidor Node local (`app-server.mjs`) atrás do proxy do Vite.

---

## Próximos planos (fora do escopo deste documento)

A spec segue com os marcos abaixo; cada um vira um plano próprio quando este estiver concluído:

1. **Plano 2 — Backend por domínio (Fases 4, 5, 15):** migrar `api/_functions/*` e `api/_db/*` progressivamente para `api/modules/` (handlers + services + types) e `api/infrastructure/db/` (schema + repositories), mantendo Drizzle + PostgreSQL e o monólito.
2. **Plano 3 — Frontend por feature e rotas centrais (Fases 6, 7):** migrar `src/pages/*` e `src/components/*` para `src/features/`, criar `src/app/routes.ts` como fonte única de navegação hash, sem React Router.
3. **Plano 4 — Integrações centralizadas + ARCHITECTURE.md (Fases 19, 20):** clientes por integração em `api/infrastructure/integrations/` com configuração central, e documento de boundaries para agentes.
4. **Plano 5 — Preview staging + segurança (Fases 8, 9, 10):** Vercel Preview como staging principal, external write guards (`assertExternalWritesAllowed`), remoção de credenciais perigosas do Preview, transição e decommission do VPS.
5. **Plano 6 — CI e checks (Fases 11, 12, 13, 14):** GitHub Actions, `verify:fast`/`verify:full`, tags de Playwright por domínio, release lanes LOW/MEDIUM/HIGH.
6. **Plano 7 — Migrations e limpeza (Fases 16, 17, 18):** política de migrations additive/destructive com expand-migrate-contract, cleanup PostgreSQL-only (Frappe/ERPNext/legacy), redução de feature flags para `APP_ENV` + `EXTERNAL_WRITES_ENABLED`.
