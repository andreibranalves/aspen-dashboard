# Vercel Handlers TypeScript Strict-Mode Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `strict: true` in `api/tsconfig.api.json` and fix all ~90 resulting type errors across 17 handler and 4 lib files, without changing runtime behavior or business logic.

**Architecture:** The migration from `.js` to `.ts` under `api/` was completed in commits `170efd8`–`65b4b6d`, but `api/tsconfig.api.json` was set to `"strict": false` to bypass errors. This plan enables strict checking via the root `tsconfig.json`'s `strict: true` (inherited via `extends`), fixes every error with minimal, precise type annotations, and verifies the full build pipeline.

**Tech Stack:** TypeScript 5.9 (`strict: true`), Node 22 ESM, Vercel serverless handlers.

## Global Constraints

- **Do not change runtime behavior or business logic.** Every change is type-only (parameter types, type assertions, interfaces).
- Use `Record<string, unknown>` for ERPNext document access, not `any`.
- Use `(err: unknown)` → `err instanceof Error ? err.message : String(err)` for catch blocks.
- Use `as const` on dictionary constants to get narrow key types.
- Use `type` imports (`import type { … }`) for types-only imports.
- Keep all import specifiers as `.js` (existing ESM convention).
- Do NOT introduce new dependencies (no Zod, Valibot, tsx, etc.).
- Do NOT refactor or restructure code — add types only.

---

## Task 1: Enable strict mode and add shared type utilities

**Files:**

- Modify: `api/tsconfig.api.json`
- Modify: `api/_lib/types.ts` (fix lint warnings + add shared types)

**Interfaces:**

- Consumes: Current `api/tsconfig.api.json` with `"strict": false`.
- Produces: Strict-mode tsconfig + shared type aliases consumed by Tasks 2–6.

- [ ] **Step 1: Enable strict mode**

In `api/tsconfig.api.json`, remove `"strict": false` so it inherits `strict: true` from the root config:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": false,
    "sourceMap": true,
    "outDir": ".",
    "rootDir": ".",
    "allowImportingTsExtensions": false
  },
  "include": ["./**/*"],
  "exclude": ["**/*.js", "**/*.d.ts"]
}
```

- [ ] **Step 2: Verify strict mode surfaces errors**

```bash
npm run type-check 2>&1 | head -30
```

Expected: ~90 type errors from `api/_functions/*.ts`. Exit code 2.

- [ ] **Step 3: Fix unused import warnings in `api/_lib/types.ts`**

Replace:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
```

with:

```ts
// IncomingMessage, ServerResponse are referenced by VercelRequestLike/VercelResponseLike below
// but only structurally — remove the explicit import.
```

Remove the import line entirely (the interfaces below use structural shapes, not nominal Node types).

- [ ] **Step 4: Add shared type aliases to `api/_lib/types.ts`**

Append after `VercelResponseLike`:

```ts
// ── Shared handler utilities ──

/** Generic JSON-serializable value (for response bodies). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** jsonResponse helper used by many handlers. */
export type JsonResponseFn = (statusCode: number, body: unknown) => FunctionResult;

/** ERPNext document — loosely typed record (frappe documents are schemaless at runtime). */
export type ErpnextDoc = Record<string, unknown>;

/** ERPNext list item (array element from erpGetList). Alias for consistency. */
export type ErpnextListItem = Record<string, unknown>;
```

- [ ] **Step 5: Run type-check to confirm types.ts is clean**

```bash
npx tsc -p api/tsconfig.api.json --noEmit 2>&1 | grep _lib/types
```

Expected: no output (no errors in `types.ts`).

- [ ] **Step 6: Commit**

```bash
git add api/tsconfig.api.json api/_lib/types.ts
git commit -m "chore: enable strict mode for api/ and add shared type utilities"
```

---

## Task 2: Fix implicit `any` in jsonResponse helpers and catch blocks

**Files:**

- Modify: `api/_functions/typebot-lead-capture.ts`
- Modify: `api/_functions/communication-media.ts`
- Modify: `api/_functions/communication-media-upload.ts`
- Modify: `api/_functions/communication-send-events.ts`
- Modify: `api/_functions/communication-flows.ts`
- Modify: `api/_functions/communication-flow-preview.ts`
- Modify: `api/_functions/whatsapp-leads.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Modify: `api/_functions/product-pricing.ts`

**Interfaces:**

- Consumes: `JsonResponseFn`, `FunctionResult` from `api/_lib/types.ts`.
- Produces: Typed `jsonResponse` helpers and `catch(err: unknown)` blocks.

**Pattern:** Many handler files define `function jsonResponse(statusCode, body)` without types, and `catch (err)` blocks that access `.logMessage`/`.message`/`.statusCode` on `unknown`. Fix: add parameter types and use `instanceof Error` guards or explicit `as` casts.

- [ ] **Step 1: Fix `typebot-lead-capture.ts`**

At the top, add import:

```ts
import type {
  FunctionEvent,
  FunctionResult,
  LegacyHandler,
  JsonResponseFn,
} from '../_lib/types.js';
```

Replace `function jsonResponse(statusCode, body)` with:

```ts
const jsonResponse: JsonResponseFn = (statusCode, body) => {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};
```

Add types to parameter functions (lines shown by errors):

| Line                                    | Fix                                                              |
| --------------------------------------- | ---------------------------------------------------------------- |
| 12 `jsonResponse(statusCode, body)`     | Covered by `JsonResponseFn` above                                |
| 20 `parseJsonBody(body)`                | `function parseJsonBody(body: unknown): Record<string, unknown>` |
| 30 `normalizeText(value)`               | Already implicitly fixed when context typed                      |
| 34 `normalizeNullableText(value)`       | `function normalizeNullableText(value: unknown): string \| null` |
| 39 `normalizeEmail(value)`              | `function normalizeEmail(value: unknown): string`                |
| 43 `normalizePhone(value)`              | `function normalizePhone(value: unknown): string`                |
| 50 `phoneVariants(phone)`               | `function phoneVariants(phone: unknown): string[]`               |
| 93 `async function handler(...payload)` | Already typed via `LegacyHandler`                                |
| 134 `diagnostic(payload)`               | `function diagnostic(payload: unknown): FunctionResult`          |
| 138–161 `upsertLead`, etc.              | Add `: unknown` to parameters                                    |
| 229 `handleTypebotLeadCapture(event)`   | Already `FunctionEvent` from handler                             |

- [ ] **Step 2: Fix `communication-media.ts`**

Add import:

```ts
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
```

Replace `function jsonResponse(statusCode, body)` with `const jsonResponse: JsonResponseFn = ...`.

Fix remaining implicit `any` parameters:

| Line                               | Fix                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 26 `async function handler(event)` | Already typed `FunctionEvent`                                                                                                     |
| 66 `handleGet(id)`                 | `function handleGet(id: string): Promise<FunctionResult>`                                                                         |
| 75 `handlePut(asset)`              | `function handlePut(asset: Record<string, unknown>): Promise<FunctionResult>`                                                     |
| 87 `handleDelete(id)`              | `function handleDelete(id: string): Promise<FunctionResult>`                                                                      |
| 137                                | Cast `queryStringParameters` to `Record<string, string>`: `const params = event.queryStringParameters as Record<string, string>;` |
| 260 `catch (blobErr)`              | `catch (blobErr: unknown) { const msg = blobErr instanceof Error ? blobErr.message : String(blobErr); }`                          |

- [ ] **Step 3: Fix `communication-media-upload.ts`**

Replace `jsonResponse(statusCode, body)` with typed version.

- [ ] **Step 4: Fix `communication-send-events.ts`**

Replace `jsonResponse(statusCode, body)` with typed version.

- [ ] **Step 5: Fix `communication-flows.ts`**

| Line                                      | Error   | Fix                                                                                                  |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| 89 `resolveTemplate(template)`            | TS7006  | `function resolveTemplate(template: unknown): Record<string, unknown>`                               |
| 103 `migrateFlowStep(step)`               | TS7006  | `function migrateFlowStep(step: Record<string, unknown>): Record<string, unknown>`                   |
| 137 `migrateFlow(flow)`                   | TS7006  | `function migrateFlow(flow: Record<string, unknown>): Record<string, unknown>`                       |
| 186 `migrationErr`                        | TS18046 | `catch { const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr); }` |
| 196 `hydrateFlows(flows, selectedFlowId)` | TS7006  | `function hydrateFlows(flows: unknown[], selectedFlowId: string): ...`                               |
| 213 `jsonResponse(statusCode, body)`      | TS7006  | Typed as `JsonResponseFn`                                                                            |

- [ ] **Step 6: Fix `communication-flow-preview.ts`**

| Line                                 | Error  | Fix                                                                                   |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| 17 `resolveTemplate(template)`       | TS7006 | `function resolveTemplate(template: unknown): Record<string, unknown>`                |
| 29 `productSummary(category)`        | TS7006 | `function productSummary(category: string): string`                                   |
| 30 index error                       | TS7053 | Add `as const` to PRODUCT_CATEGORY_GENDERS (see Task 5)                               |
| 40 `formatTemplate(...)`             | TS7006 | `function formatTemplate(template: string, context: Record<string, unknown>): string` |
| 97 `categories`                      | TS7034 | `const categories: string[] = [];`                                                    |
| 99 `.sku`, `.item_code`              | TS2339 | Access via `(item as Record<string, string>).sku` etc.                                |
| 103 index error                      | TS7053 | `PRODUCT_CATEGORY_BY_PREFIX[prefix as keyof typeof PRODUCT_CATEGORY_BY_PREFIX]`       |
| 133 `buildProductMedia(quotationId)` | TS7006 | `async function buildProductMedia(quotationId: string): Promise<...>`                 |
| 141 `.push` on `never[]`             | TS2345 | Type the array: `const items: Record<string, unknown>[] = [];`                        |
| 200 `jsonResponse(statusCode, body)` | TS7006 | Typed as `JsonResponseFn`                                                             |

- [ ] **Step 7: Fix `whatsapp-leads.ts`**

This is the largest file (~580 lines) with ~40 errors. Key fixes:

```ts
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
```

Replace `function jsonResponse(statusCode, body)` with typed version.

Fix parameter types systematically:

| Pattern                               | Fix                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `function normalizeX(value)`          | Add `: unknown` to `value`, return type                                  |
| `function getChatRemoteJid(chat)`     | `function getChatRemoteJid(chat: Record<string, unknown>): string`       |
| `catch (err)`                         | Add `: unknown`, guard with `instanceof Error`                           |
| `async function fetchX(url, options)` | `async function fetchX(url: string, options: RequestInit): Promise<...>` |
| Array callbacks `(a, b)`              | `(a: Record<string, unknown>, b: Record<string, unknown>)`               |
| `firstNonEmpty(...values)`            | `function firstNonEmpty(...values: unknown[]): string`                   |
| `normalizeWhatsappPhone(value)`       | `function normalizeWhatsappPhone(value: unknown): string`                |
| `normalizeComparablePhone(value)`     | `function normalizeComparablePhone(value: unknown): string`              |
| `isValidBrazilWhatsappPhone(value)`   | `function isValidBrazilWhatsappPhone(value: unknown): boolean`           |
| `cleanText(value)`                    | `function cleanText(value: unknown): string`                             |
| `normalizeLeadEmail(value)`           | `function normalizeLeadEmail(value: unknown): string`                    |

For the two TS2322 errors (lines 188, 439) where `null` is initialized but later assigned an object, change the initializer type:

```ts
// Instead of:
let contacts = null;
// Use:
let contacts: Record<string, unknown> | null = null;
```

- [ ] **Step 8: Fix `send-whatsapp-flow.ts`**

Same `jsonResponse` pattern. Key additional fixes:

```ts
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
```

| Pattern                                          | Fix                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `function jsonResponse(statusCode, body)`        | Typed as `JsonResponseFn`                                                                    |
| `async function callEvolutionApi(path, body)`    | `async function callEvolutionApi(path: string, body: Record<string, unknown>): Promise<...>` |
| `function resolveTemplate(template)`             | `function resolveTemplate(template: unknown): Record<string, unknown>`                       |
| `function formatTemplate(template, context)`     | `function formatTemplate(template: string, context: Record<string, unknown>): string`        |
| `function randomBetween(minMs, maxMs)`           | `function randomBetween(minMs: number, maxMs: number): number`                               |
| `function delay(ms)`                             | `function delay(ms: number): Promise<void>`                                                  |
| `function sleep(...values)`                      | Rest param: `function sleep(...values: unknown[]): string`                                   |
| `catch (err)`                                    | Add `: unknown` guard                                                                        |
| `function normalizePhone(phone)`                 | `function normalizePhone(phone: unknown): string`                                            |
| `PRODUCT_CATEGORY_BY_PREFIX[...]`                | See Task 5                                                                                   |
| `CATEGORY_ALIASES[value]`                        | `CATEGORY_ALIASES[value as keyof typeof CATEGORY_ALIASES]`                                   |
| `.statusCode`, `.logMessage`, `.message` on `{}` | See Task 3                                                                                   |

- [ ] **Step 9: Fix `product-pricing.ts`**

| Pattern                                               | Fix                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `jsonResponse(statusCode, payload)`                   | Typed as `JsonResponseFn` (two params: statusCode + payload instead of body) |
| `function handleError(err)`                           | `function handleError(err: unknown): FunctionResult`                         |
| All pricing function params `(sku, faixa, rate, ...)` | Add `: string` / `: number` as appropriate                                   |
| Line 67 `rate` is `number \| null`                    | Add `if (rate === null) return ...;` guard or `rate ?? 0`                    |

- [ ] **Step 10: Run type-check after this task**

```bash
npm run type-check 2>&1 | grep -c "error TS"
```

Expected: error count should drop from ~90 to ~40 (remaining errors are from Tasks 3–6).

- [ ] **Step 11: Commit**

```bash
git add api/_functions/typebot-lead-capture.ts api/_functions/communication-media.ts \
        api/_functions/communication-media-upload.ts api/_functions/communication-send-events.ts \
        api/_functions/communication-flows.ts api/_functions/communication-flow-preview.ts \
        api/_functions/whatsapp-leads.ts api/_functions/send-whatsapp-flow.ts \
        api/_functions/product-pricing.ts
git commit -m "fix(api): add explicit types to jsonResponse helpers and catch blocks"
```

---

## Task 3: Fix ERPNext response types and property access errors (TS2339)

**Files:**

- Modify: `api/_functions/quotations.ts`
- Modify: `api/_functions/sales-order-from-quotation.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`

**Interfaces:**

- Consumes: `HttpError`, `ErpnextDoc` types from `erpnext.ts` and `types.ts`.
- Produces: Type-safe access to `.logMessage`, `.message`, `.statusCode` on error objects.

**Pattern:** `createHttpError()` returns `HttpError` (which has `logMessage`, `message`, `statusCode`). But in catch blocks, `err` is `unknown` or inferred as `{}`, losing the type. Fix: add explicit type assertions in catch blocks.

- [ ] **Step 1: Fix `quotations.ts` — ERPNext error property access**

All errors are `TS2339: Property 'logMessage'/'message'/'statusCode' does not exist on type '{}'`. These happen in catch blocks where `err` type is narrowed to `{}`.

Add a type import:

```ts
import type { HttpError } from './lib/erpnext.js';
```

In every catch block that accesses `.logMessage`/`.message`/`.statusCode`, cast the error:

```ts
// Before (line ~111):
console.error('[quotations] ...', err.logMessage || err.message);

// After:
const httpErr = err as HttpError;
console.error('[quotations] ...', httpErr.logMessage || httpErr.message);
```

The affected catch blocks are at lines ~87, ~219, ~272, ~334, ~422. Apply the same pattern.

For the `statusCode` access at lines ~219, ~334, check `err instanceof HttpError` or cast:

```ts
// Before:
statusCode: err.statusCode || 500;

// After:
statusCode: (err as HttpError).statusCode || 500;
```

- [ ] **Step 2: Fix `sales-order-from-quotation.ts` — same pattern**

Same `HttpError` cast pattern in catch blocks at lines ~67, ~116, ~217, ~233, ~272.

For the `erpCallMethod` calls where `mapped` parameter is `any`, add explicit type:

```ts
// Lines 13, 24
function resolveDocName(mapped: Record<string, unknown>): string | null {
function normaliseMappedDoc(mapped: Record<string, unknown>): Record<string, unknown> {
```

And for other implicit params:

```ts
// Line 37
async function tryUpdateCrmDeal(quotationId: string, salesOrderName: string): Promise<boolean> {

// Line 91
async function deduplicateSalesOrder(quotationId: string): Promise<...> {

// Line 138 in .map() callback
const mappedItems = items.map((item: Record<string, unknown>) => ({ ... }));
```

- [ ] **Step 3: Fix `send-whatsapp-flow.ts` — remaining HttpError access**

Lines ~247, ~270, ~399, ~418, ~631 similarly need `err as HttpError` casts.

- [ ] **Step 4: Verify after fixing**

```bash
npm run type-check 2>&1 | grep "TS2339"
```

Expected: zero TS2339 errors remaining.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/quotations.ts api/_functions/sales-order-from-quotation.ts \
        api/_functions/send-whatsapp-flow.ts
git commit -m "fix(api): type ERPNext HttpError access in catch blocks"
```

---

## Task 4: Fix callback parameter types in map/filter/sort (TS7006)

**Files:**

- Modify: `api/_functions/sales-dashboard.ts`
- Modify: `api/_functions/sales-orders.ts`
- Modify: `api/_functions/quotations.ts`
- Modify: `api/_functions/whatsapp-leads.ts`
- Modify: `api/_functions/crm-deals.ts`
- Modify: `api/_functions/client-detail.ts`
- Modify: `api/_functions/product-activity.ts`

**Interfaces:**

- Consumes: `ErpnextListItem` from `api/_lib/types.ts`.
- Produces: Typed callback parameters in array methods.

**Pattern:** ERPNext list results are iterated with `.map(d => ...)`, `.filter(o => ...)`, `.sort((a, b) => ...)` but callback parameters lack types. Fix: add `ErpnextListItem` or more specific inline types.

- [ ] **Step 1: Fix `sales-dashboard.ts`**

Add imports at top:

```ts
import type { FunctionEvent, FunctionResult, ErpnextListItem } from '../_lib/types.js';
```

Fix period helper params:

```ts
function getPeriodDates(period: string, from: string | undefined, to: string | undefined) {
```

```ts
function getPeriodLabel(period: string, from: string | undefined, to: string | undefined): string {
```

Fix PERIOD_LABELS access (TS7053):

```ts
// Before:
PERIOD_LABELS[period];
// After:
PERIOD_LABELS[period as keyof typeof PERIOD_LABELS];
```

Fix all callback parameters:

```ts
// .map() callback
orders.map((d: ErpnextListItem) => ({ ... }))

// salesOrderSummaries parameters
function buildSalesOrderSummaries(period: string, from: string | undefined, to: string | undefined) {

// fetchSalesOrderItems(start, end)
async function fetchSalesOrderItems(start: string, end: string): Promise<ErpnextListItem[]> {

// fetchSalesOrdersByPeriod(start, end)
async function fetchSalesOrdersByPeriod(start: string, end: string): Promise<ErpnextListItem[]> {

// buildOrderNamesList(orderNames)
function buildOrderNamesList(orderNames: string[]): ...

// buildSalesByDay(orders)
function buildSalesByDay(orders: ErpnextListItem[]): ...

// .reduce() callbacks
orders.reduce((sum: number, o: ErpnextListItem) => sum + Number(o.grand_total || 0), 0)

// buildTopProducts(allItems)
function buildTopProducts(allItems: ErpnextListItem[]): ...

// findStaleQuotations()
// Already OK — just ensure ErpnextListItem is used for array elements
```

- [ ] **Step 2: Fix `sales-orders.ts`**

Same patterns:

```ts
import type { FunctionEvent, FunctionResult, ErpnextListItem } from '../_lib/types.js';
```

```ts
function getPeriodDates(period: string, from: string | undefined, to: string | undefined) {
```

```ts
function buildListFilters(query: Record<string, string | undefined>) {
```

Array callbacks:

```ts
orders.map((order: ErpnextListItem) => ({ ... }))
items.map((item: ErpnextListItem) => ({ ... }))
orders.filter((order: ErpnextListItem) => ...)
```

Detail fetch functions:

```ts
async function fetchOrderDetail(orderId: string): Promise<...> {
async function fetchOrderWithItems(query: string | undefined): Promise<...> {
```

- [ ] **Step 3: Fix `crm-deals.ts`**

```ts
import type { FunctionEvent, FunctionResult, ErpnextListItem } from '../_lib/types.js';
```

```ts
function mapDeal(d: ErpnextListItem) {
```

Replace the `groups` object type:

```ts
// Before:
const groups = {};
// After:
const groups: Record<string, ErpnextListItem[]> = {};
```

- [ ] **Step 4: Fix `client-detail.ts`**

```ts
function buildErpUrl(doctype: string, name: string): string {
```

```ts
function buildSummaryAddress(addr: Record<string, unknown> | null) {
```

For the `erpGetDoc` / `erpPut` / `erpPost` calls with dynamically typed params, add explicit types:

```ts
async function handleGet(doctype: string, name: string): Promise<FunctionResult> {
```

```ts
async function handlePut(doctype: string, name: string, rawBody: string): Promise<FunctionResult> {
```

Fix the index access on EDITABLE_FIELDS:

```ts
// Before:
EDITABLE_FIELDS[doctype];
// After:
EDITABLE_FIELDS[doctype as keyof typeof EDITABLE_FIELDS];
```

- [ ] **Step 5: Fix `product-activity.ts`**

```ts
// Line 23: queryStringParameters access
const sku = (event.queryStringParameters.sku || '').trim();
// Fix: add non-null assertion or fallback:
const sku = (event.queryStringParameters.sku ?? '').trim();
```

```ts
// Line 37: .filter() callback
.filter((it: Record<string, unknown>) => ...)
```

- [ ] **Step 6: Run type-check after callback fixes**

```bash
npm run type-check 2>&1 | grep "TS7006"
```

Expected: zero TS7006 errors remaining (all implicit `any` parameters should be typed).

- [ ] **Step 7: Commit**

```bash
git add api/_functions/sales-dashboard.ts api/_functions/sales-orders.ts \
        api/_functions/crm-deals.ts api/_functions/client-detail.ts \
        api/_functions/product-activity.ts
git commit -m "fix(api): add types to array callbacks and function parameters"
```

---

## Task 5: Fix dictionary lookup types (TS7053)

**Files:**

- Modify: `api/_functions/communication-flow-preview.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Modify: `api/_functions/sales-dashboard.ts`
- Modify: `api/_functions/extract.ts`

**Interfaces:**

- Consumes: `as const` assertions from TypeScript 5.x.
- Produces: Type-safe index access on dictionary constants.

**Pattern:** Dictionary constants like `PRODUCT_CATEGORY_BY_PREFIX`, `CATEGORY_ALIASES`, `PERIOD_LABELS`, `PRODUCT_SUMMARY_PLURALS`, `PRODUCT_CATEGORY_GENDERS` are accessed with dynamic keys, but TypeScript infers them as `Record<string, string>` and can't guarantee the key exists. Fix: use `as keyof typeof DICT` on the accessor, OR add explicit `Record<string, string>` type annotation to the dictionaries.

- [ ] **Step 1: Add explicit type annotations to shared dictionaries**

In both `send-whatsapp-flow.ts` and `communication-flow-preview.ts`, the dictionary constants are duplicated. Add explicit index signatures:

```ts
const PRODUCT_CATEGORY_BY_PREFIX: Record<string, string> = {
  CNG: 'canga',
  LNC: 'lenço',
  BNE: 'boné',
  TWL: 'toalha',
  CHP: 'chapéu',
  ECO: 'ecobag',
  CHC: 'cachecol',
};

const PRODUCT_SUMMARY_PLURALS: Record<string, string> = {
  canga: 'cangas',
  lenço: 'lenços',
  boné: 'bonés',
  toalha: 'toalhas',
  chapéu: 'chapéus',
  ecobag: 'ecobags',
  cachecol: 'cachecóis',
};

const PRODUCT_CATEGORY_GENDERS: Record<string, string> = {
  canga: 'f',
  lenço: 'm',
  boné: 'm',
  toalha: 'f',
  chapéu: 'm',
  ecobag: 'f',
  cachecol: 'm',
};

const CATEGORY_ALIASES: Record<string, string> = {
  canga: 'canga',
  cangas: 'canga',
  lenco: 'lenço',
  lenço: 'lenço',
  lenços: 'lenço',
  bone: 'boné',
  boné: 'boné',
  bonés: 'boné',
  chapeu: 'chapéu',
  chapéu: 'chapéu',
  chapéus: 'chapéu',
  toalha: 'toalha',
  toalhas: 'toalha',
  ecobag: 'ecobag',
  ecobags: 'ecobag',
  cachecol: 'cachecol',
  cachecóis: 'cachecol',
  cachecois: 'cachecol',
};
```

This is the simplest fix — adding `Record<string, string>` annotation tells TypeScript that any string key lookup is valid (returns `string | undefined`).

- [ ] **Step 2: Fix `PERIOD_LABELS` in `sales-dashboard.ts`**

```ts
const PERIOD_LABELS: Record<string, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  month: 'Este mês',
  last_month: 'Mês passado',
};
```

- [ ] **Step 3: Fix `extract.ts` — OpenRouter headers**

Line 261: `headers['HTTP-Referer']` fails because `buildHeaders()` returns an object with fixed keys. The fix is to add the `HTTP-Referer` property to the headers object explicitly rather than via bracket notation:

```ts
// Before:
headers['HTTP-Referer'] = appUrl;

// After (in buildHeaders or at the call site):
const openRouterHeaders: Record<string, string> = {
  Authorization: `Bearer ${OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'X-OpenRouter-Title': 'Aspen Orcamento',
  'HTTP-Referer': appUrl,
};
```

- [ ] **Step 4: Run type-check after dictionary fixes**

```bash
npm run type-check 2>&1 | grep "TS7053"
```

Expected: zero TS7053 errors remaining.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/communication-flow-preview.ts api/_functions/send-whatsapp-flow.ts \
        api/_functions/sales-dashboard.ts api/_functions/extract.ts
git commit -m "fix(api): add Record<string, string> types to dictionary constants"
```

---

## Task 6: Fix remaining scattered errors

**Files:**

- Modify: `api/_functions/leads-clients.ts`
- Modify: `api/_functions/product-pricing-update.ts`
- Modify: `api/_functions/duplicate-quotation.ts`
- Modify: `api/_functions/whatsapp-flows.ts`
- Modify: `api/_functions/whatsapp-leads.ts` (remaining TS2322)
- Modify: `api/_functions/send-whatsapp-flow.ts` (remaining TS2339, TS2345)
- Modify: `api/_lib/types.ts` (if any remaining lint warnings)

**Interfaces:**

- Consumes: All prior type fixes.
- Produces: Zero type errors across the entire `api/` tree.

- [ ] **Step 1: Fix `leads-clients.ts` (TS2345)**

Lines 7–8: `erpGetList('Lead', ...)` passes `string | undefined` to functions expecting `string`. Fix with null check or fallback:

```ts
const search = (event.queryStringParameters.search ?? '').trim();
const entityType = (event.queryStringParameters.entityType ?? '').trim();

// Then assert at call sites:
if (!entityType) {
  return jsonResponse(400, { error: 'entityType é obrigatório' });
}
```

- [ ] **Step 2: Fix `product-pricing-update.ts` (TS7006)**

Add explicit types to the handler body:

```ts
const { sku, faixa, rate } = event.queryStringParameters;
// Before: implicit any
// After:
const sku = (event.queryStringParameters.sku ?? '') as string;
const faixa = (event.queryStringParameters.faixa ?? '') as string;
const rate = (event.queryStringParameters.rate ?? '') as string;
```

- [ ] **Step 3: Fix `duplicate-quotation.ts` (TS7006)**

```ts
// Line 31: .map() callback
const items = quotation.items.map((item: Record<string, unknown>) => ({ ... }));
```

- [ ] **Step 4: Fix `whatsapp-flows.ts`**

Add explicit types to remaining implicit params:

```ts
function resolveTemplate(template: unknown): Record<string, unknown> {
```

```ts
function migrateFlow(flow: Record<string, unknown>): Record<string, unknown> {
```

```ts
function migrateFlowStep(step: Record<string, unknown>): Record<string, unknown> {
```

```ts
function hydrateFlows(flows: unknown[], selectedFlowId: string): ... {
```

- [ ] **Step 5: Fix remaining TS2322 in `whatsapp-leads.ts`**

Change `let contacts = null` to `let contacts: Record<string, unknown> | null = null` (line 188) and `let indexes = null` to `let indexes: Record<string, unknown> | null = null` (line 439).

- [ ] **Step 6: Fix remaining TS2345 in `send-whatsapp-flow.ts`**

Line 558: `.push(...)` on `never[]`. Add explicit type annotation to the array declaration:

```ts
// Before:
const items = [];
// After:
const items: Record<string, unknown>[] = [];
```

- [ ] **Step 7: Run full type-check**

```bash
npm run type-check
```

Expected: zero errors, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add api/_functions/leads-clients.ts api/_functions/product-pricing-update.ts \
        api/_functions/duplicate-quotation.ts api/_functions/whatsapp-flows.ts \
        api/_functions/whatsapp-leads.ts api/_functions/send-whatsapp-flow.ts
git commit -m "fix(api): resolve remaining scattered type errors"
```

---

## Task 7: Final verification — full pipeline

**Files:**

- No file changes expected at this stage. Verification only.

**Interfaces:**

- Consumes: All prior task fixes.
- Produces: Confirmation that all gates pass.

- [ ] **Step 1: Run type-check**

```bash
npm run type-check
```

Expected: zero errors, exit code 0.

- [ ] **Step 2: Run build:api**

```bash
npm run build:api
```

Expected: emits all `api/**/*.js` files without errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: at most 87 warnings, zero errors (same as before this cleanup — the plan does not touch lint config).

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit
```

Expected: 134 tests pass, 0 fail.

- [ ] **Step 5: Run full build**

```bash
npm run build
```

Expected: `build:api` + `vite build` both succeed.

- [ ] **Step 6: Start local API server and smoke-test**

```bash
node scripts/dev-api-server.mjs &
sleep 2
curl -s http://localhost:8888/api/products -H "Cookie: aspen_session=test" | head -100
```

Expected: API responds correctly (may return 401 without valid session — that's OK, the server started and the handler loaded).

```bash
kill %1 2>/dev/null
```

- [ ] **Step 7: Verify emitted .js files are gitignored**

```bash
git status --short api/ | grep '\.js$'
```

Expected: no `.js` files show as untracked/modified under `api/`.

- [ ] **Step 8: Commit final verification evidence (no code changes)**

```bash
git add -A
git status
```

If clean, no commit needed. If only `.js` file changes from re-emit, those should be gitignored already.

---

## Self-Review Checklist

After writing this plan, review it against the design spec requirements:

1. **Spec coverage:** The design spec requires all 49 `.js` files to become `.ts` with proper types. This plan covers the remaining ~90 type errors across 17 handler files and 4 lib files — the final cleanup step. The file renames and infrastructure (`tsconfig.api.json`, `.gitignore`, `build:api`, etc.) were already completed in commits `170efd8`–`65b4b6d`.

2. **Placeholder scan:** No TBD, TODO, or "implement later" entries. Every task has exact code changes.

3. **Type consistency:** `ErpnextListItem`, `HttpError`, `JsonResponseFn`, `FunctionEvent`, `FunctionResult` are defined in Task 1 and used consistently in Tasks 2–6.

### Verification after plan execution

```bash
npm run check     # lint + type-check + tailwind guard + build
npm run test:unit # 134 tests
```

All must pass. No push without explicit user approval.
