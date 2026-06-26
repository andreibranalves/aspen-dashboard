# TypeScript Migration Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the gradual TypeScript migration without shipping visual regressions, while keeping backend risk low and verification explicit.

**Architecture:** Fix the frontend styling regression first, because the app currently renders HTML without the Tailwind utility CSS generated from `.tsx` files. Then close migration documentation, add backend type-safety via `// @ts-check` without converting Vercel handlers, convert remaining unit tests, and run a final validation gate.

**Tech Stack:** React 19, Vite 6, TypeScript 5.9, Tailwind CSS 3.4, Node 22 test runner, Vercel serverless JS handlers.

## Global Constraints

- Preserve current runtime behavior; do not refactor business logic while adding types.
- Keep frontend imports extensionless.
- Backend remains JavaScript for now; add `// @ts-check` only to selected pure backend libs.
- Do not migrate Vercel API handlers to `.ts` without a dedicated preview-deploy test phase.
- Every task must end with fresh verification before commit.
- Never push without explicit user approval.

---

## Current Root Cause Note — Broken Design

The screenshot `/home/andrei/temp/Captura de tela 2026-06-25 211451.png` shows React content rendering, but almost all layout/utility styling missing.

Root cause already identified:

```js
// tailwind.config.js — current broken content glob
content: ['./index.html', './src/**/*.{js,jsx}'],
```

After Phase 5, `src/` has only `.ts` / `.tsx`, so Tailwind no longer scans component/page class names. The current production build confirms this: generated CSS fell to about `7.23 kB`, while earlier Phase 2/3 builds were around `39–44 kB`.

---

## Files and Responsibilities

- `tailwind.config.js` — Tailwind content globs; must include `.ts` and `.tsx`.
- `docs/typescript-migration-fase4-fase5-report.md` — final report; remove stale placeholders and mention the Tailwind fix.
- `docs/superpowers/plans/2026-06-25-typescript-migration-remaining.md` — this plan.
- `api/_functions/lib/time-greeting.js` — pure backend date/greeting helper; add `// @ts-check` and JSDoc.
- `api/_functions/lib/client-metadata.js` — pure-ish backend normalization/validation helper; add `// @ts-check` and JSDoc types incrementally.
- `api/_functions/lib/quote-response.js` — response assembly helper; add `// @ts-check` and JSDoc.
- `tests/unit/*.test.js` — remaining JS unit tests; rename to `.ts` where Node 22 can run them unchanged or with minimal type-safe annotations.
- `package.json` — keep `test:unit` supporting both `.js` and `.ts` until all test scripts are converted or deliberately left JS.

---

## Task 1: Fix Tailwind content globs and verify visual styling

**Files:**

- Modify: `tailwind.config.js`
- Modify: `docs/typescript-migration-fase4-fase5-report.md`

**Interfaces:**

- Consumes: Tailwind CSS v3 `content` glob scanning.
- Produces: Build CSS containing utilities from `.tsx` files.

- [ ] **Step 1: Patch Tailwind content config**

Replace:

```js
content: ['./index.html', './src/**/*.{js,jsx}'],
```

with:

```js
content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
```

Keep `js,jsx` in the glob to avoid breaking if a temporary JS/JSX frontend file is reintroduced during debugging.

- [ ] **Step 2: Build and confirm CSS is no longer purged**

Run:

```bash
npm run build
```

Expected:

```txt
✓ built in ...
public/assets/index-*.css   >= 35 kB before gzip
```

Also run:

```bash
ls -lh public/assets/index-*.css | tail
```

Expected: the newest CSS file should be closer to the previous `39–44 kB` range, not `7.23 kB`.

- [ ] **Step 3: Run app and visually confirm layout**

Run one of:

```bash
npm run dev
```

or, if API routes are needed:

```bash
npm run dev:vercel
```

Open the route shown in the screenshot and verify:

- Sidebar has proper width/background.
- Icons and labels are aligned.
- Main content is not stacked as raw unstyled text.
- AutoQuote page has two-column/panel layout again.

- [ ] **Step 4: Update report with the actual root cause and fix**

In `docs/typescript-migration-fase4-fase5-report.md`, add a small section under “Ajustes pós-migração”:

```md
- `tailwind.config.js`: atualizado `content` de `./src/**/*.{js,jsx}` para `./src/**/*.{js,jsx,ts,tsx}` para restaurar a geração das classes Tailwind após a migração para `.tsx`.
```

Also replace the stale bullet that says the final commit is still pending with the actual Fase 5 commit plus the Tailwind fix commit. After committing this task, get the real short SHA with:

```bash
git rev-parse --short HEAD
```

Then edit the report so the commits list includes both the existing Fase 5 commit and the newly printed Tailwind-fix SHA. Do not leave a placeholder SHA in the report.

- [ ] **Step 5: Verify full frontend gate**

Run:

```bash
npm run check
npm run test:unit
node scripts/test-client-metadata.mjs
node scripts/test-whatsapp-flows.mjs
```

Expected:

- `npm run check`: lint, `tsc --noEmit`, and Vite build pass.
- Unit tests: 134 pass, 0 fail.
- Client metadata script: 35 pass, 0 fail.
- WhatsApp flows script: 29 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.js docs/typescript-migration-fase4-fase5-report.md
git commit -m "fix: include TypeScript files in Tailwind content globs"
```

---

## Task 2: Add a minimal guard against repeating the Tailwind purge regression

**Files:**

- Create: `scripts/check-tailwind-content.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: `tailwind.config.js` file contents.
- Produces: A fast check that fails if Tailwind content stops scanning `.ts` / `.tsx`.

- [ ] **Step 1: Create the guard script**

Create `scripts/check-tailwind-content.mjs`.

Important: do **not** import `tailwind.config.js` directly. This project is ESM (`"type": "module"`), while `tailwind.config.js` currently uses `require('tailwindcss-animate')`; importing it from a Node ESM script can crash before the assertion runs. Read the config as text instead:

```js
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const configText = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8');
const contentMatch = configText.match(/content\s*:\s*\[([\s\S]*?)\]/m);

assert.ok(contentMatch, 'tailwind.config.js must define a content array');

const content = contentMatch[1];

assert.match(content, /src/, 'tailwind.config.js content must scan src/');
assert.match(content, /ts/, 'tailwind.config.js content must include ts files');
assert.match(content, /tsx/, 'tailwind.config.js content must include tsx files');

console.log('✓ Tailwind content config scans TypeScript source files');
```

- [ ] **Step 2: Add npm script**

In `package.json`, add:

```json
"check:tailwind": "node scripts/check-tailwind-content.mjs"
```

Then update `check` from:

```json
"check": "npm run lint && npm run type-check && npm run build"
```

to:

```json
"check": "npm run lint && npm run type-check && npm run check:tailwind && npm run build"
```

- [ ] **Step 3: Verify the guard catches the actual failure mode**

Temporarily change the glob locally to the broken value:

```js
content: ['./index.html', './src/**/*.{js,jsx}'],
```

Run:

```bash
npm run check:tailwind
```

Expected: failure with:

```txt
tailwind.config.js content must include tsx files
```

Revert the temporary change back to:

```js
content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
```

Run:

```bash
npm run check:tailwind
```

Expected:

```txt
✓ Tailwind content config scans TypeScript source files
```

- [ ] **Step 4: Run full verification**

```bash
npm run check
npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/check-tailwind-content.mjs
git commit -m "test: guard Tailwind TypeScript content scanning"
```

---

## Task 3: Clean up migration reports and stale docs

**Files:**

- Modify: `docs/typescript-migration-fase4-fase5-report.md`
- Modify: `docs/pr-whatsapp-leads-name-resolution.md`
- Modify: `docs/typescript-migration-next-steps.md`

**Interfaces:**

- Consumes: Actual repo state after frontend migration.
- Produces: Docs that do not direct future agents to already-migrated `.js/.jsx` frontend files.

- [ ] **Step 1: Verify Phase 4/5 report final-state text**

Commit `5a71729` already fixed two stale statements in `docs/typescript-migration-fase4-fase5-report.md`:

- The `git status` wording now says the repo is clean after the final Fase 5 commit.
- The import wording now says imports are extensionless, with `@/*` used outside immediate-neighbor imports.

Do not reapply those edits if they are already present. Only add/update report text for the Tailwind fix from Task 1.

- [ ] **Step 2: Fix stale page extension in PR doc**

In `docs/pr-whatsapp-leads-name-resolution.md`, replace:

```md
src/pages/AutoQuotePage.jsx
```

with:

```md
src/pages/AutoQuotePage.tsx
```

Leave backend `.js` references intact.

- [ ] **Step 3: Mark next-steps doc as historical**

At the top of `docs/typescript-migration-next-steps.md`, add:

```md
> Historical note: this document describes the state after Phase 1. Frontend files listed below may already have been migrated in later phases. See `docs/typescript-migration-fase4-fase5-report.md` for the current frontend state.
```

Do not rewrite the whole historical document.

- [ ] **Step 4: Verify stale frontend references are intentional only**

Run:

```bash
rg "src/.*\.(jsx|js)|@/.*\.(jsx|js)" docs -n
```

Expected: any remaining `.js` references are backend, test, historical migration notes, or explicit before/after examples.

- [ ] **Step 5: Commit**

```bash
git add docs/typescript-migration-fase4-fase5-report.md docs/pr-whatsapp-leads-name-resolution.md docs/typescript-migration-next-steps.md
git commit -m "docs: align TypeScript migration status"
```

---

## Task 4: Add `// @ts-check` to pure backend helpers

**Files:**

- Modify: `api/_functions/lib/time-greeting.js`
- Modify: `api/_functions/lib/client-metadata.js`
- Modify: `api/_functions/lib/quote-response.js`

**Interfaces:**

- Consumes: Current JS backend modules imported by Vercel handlers.
- Produces: JS modules with local TypeScript checking via JSDoc, without changing filenames or deployment behavior.

- [ ] **Step 1: Add `// @ts-check` to `time-greeting.js`**

Top of file should become:

```js
// @ts-check

const WHATSAPP_TIME_ZONE = 'America/Sao_Paulo';
```

Add JSDoc:

```js
/**
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {number}
 */
function getHourInTimeZone(date = new Date(), timeZone = WHATSAPP_TIME_ZONE) {
```

and:

```js
/**
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {string}
 */
export function getTimeBasedGreeting(date = new Date(), timeZone = WHATSAPP_TIME_ZONE) {
```

- [ ] **Step 2: Add `// @ts-check` and local typedefs to `client-metadata.js`**

Add at top:

```js
// @ts-check
```

Add typedefs after imports:

```js
/**
 * @typedef {object} AddressPayload
 * @property {string} cep
 * @property {string} logradouro
 * @property {string} numero
 * @property {string} complemento
 * @property {string} bairro
 * @property {string} cidade
 * @property {string} uf
 */

/**
 * @typedef {object} BuildAddressPayloadOptions
 * @property {unknown} address
 * @property {string} nomeCliente
 * @property {string} email
 * @property {string} telefone
 * @property {'Customer' | 'Lead'} entityType
 * @property {string} entityId
 */
```

Update key JSDoc signatures:

```js
/** @param {unknown} value @returns {string} */
export function normalizeLeadSource(value) {
```

```js
/** @param {unknown} value @returns {boolean} */
export function isValidLeadSource(value) {
```

```js
/** @param {unknown} value @returns {string} */
export function onlyDigits(value) {
```

```js
/** @param {unknown} address @returns {AddressPayload} */
export function normalizeAddressPayload(address) {
```

```js
/** @param {unknown} address @returns {boolean} */
export function hasMinimumAddressForErp(address) {
```

```js
/**
 * @param {BuildAddressPayloadOptions} opts
 * @returns {Record<string, unknown>}
 */
export function buildAddressPayload({ address, nomeCliente, email, telefone, entityType, entityId }) {
```

- [ ] **Step 3: Add `// @ts-check` and typedefs to `quote-response.js`**

Top of file should become:

```js
// @ts-check
// api/_functions/lib/quote-response.js
```

Add typedefs after imports:

```js
/**
 * @typedef {object} VercelEventLike
 * @property {Record<string, string | undefined>} [headers]
 */

/**
 * @typedef {object} SavedQuoteItem
 * @property {string} item_code
 * @property {number} qty
 * @property {number} rate
 */

/**
 * @typedef {object} BuildQuoteResponseOptions
 * @property {VercelEventLike} event
 * @property {string} quotationId
 * @property {string} dealId
 * @property {string} entityId
 * @property {'Customer' | 'Lead' | string} entityType
 * @property {boolean} customerIsNew
 * @property {string} nomeCliente
 * @property {boolean} urgente
 * @property {SavedQuoteItem[]} savedItems
 * @property {string} origem
 * @property {unknown[]} [warnings]
 */
```

Update internal helpers:

```js
/** @param {string} baseUrl @param {string} quotationId @returns {string} */
function buildViewUrl(baseUrl, quotationId) {
```

```js
/** @param {VercelEventLike} event @returns {string} */
function buildBaseUrl(event) {
```

```js
/** @param {string} longUrl @returns {Promise<string>} */
async function shortenUrl(longUrl) {
```

```js
/** @param {BuildQuoteResponseOptions} opts @returns {Promise<Record<string, unknown>>} */
export async function buildQuoteResponse({
```

- [ ] **Step 4: Run targeted diagnostics**

Run:

```bash
npx tsc --noEmit --allowJs --checkJs api/_functions/lib/time-greeting.js api/_functions/lib/client-metadata.js api/_functions/lib/quote-response.js
```

Expected: no TypeScript diagnostics. If diagnostics appear, fix only JSDoc/type narrowing in these files; do not alter business behavior.

- [ ] **Step 5: Run existing backend-related tests**

```bash
npm run test:unit
node scripts/test-client-metadata.mjs
```

Expected:

- 134 unit tests pass.
- 35 client metadata script checks pass.

- [ ] **Step 6: Commit**

```bash
git add api/_functions/lib/time-greeting.js api/_functions/lib/client-metadata.js api/_functions/lib/quote-response.js
git commit -m "chore: enable ts-check on backend helper libs"
```

---

## Task 5: Convert remaining unit tests to TypeScript

**Files:**

- Rename: `tests/unit/client-metadata.test.js` → `tests/unit/client-metadata.test.ts`
- Rename: `tests/unit/extract-rules.test.js` → `tests/unit/extract-rules.test.ts`
- Rename: `tests/unit/pricing.test.js` → `tests/unit/pricing.test.ts`
- Rename: `tests/unit/typebot-lead-capture.test.js` → `tests/unit/typebot-lead-capture.test.ts`
- Rename: `tests/unit/whatsapp-flows.test.js` → `tests/unit/whatsapp-flows.test.ts`
- Rename: `tests/unit/whatsapp-leads.test.js` → `tests/unit/whatsapp-leads.test.ts`
- Keep: `tests/unit/formatters.test.ts`

**Interfaces:**

- Consumes: Node 22 test runner and TypeScript type stripping support already proven by `formatters.test.ts`.
- Produces: Unit test suite source files consistently in `.ts`.

- [ ] **Step 1: Rename one test file at a time**

For each file, use `git mv`, starting with the smallest/least coupled:

```bash
git mv tests/unit/extract-rules.test.js tests/unit/extract-rules.test.ts
npm run test:unit
```

Expected after each rename: 134 tests pass.

Suggested order:

```bash
git mv tests/unit/extract-rules.test.js tests/unit/extract-rules.test.ts
git mv tests/unit/whatsapp-flows.test.js tests/unit/whatsapp-flows.test.ts
git mv tests/unit/client-metadata.test.js tests/unit/client-metadata.test.ts
git mv tests/unit/whatsapp-leads.test.js tests/unit/whatsapp-leads.test.ts
git mv tests/unit/pricing.test.js tests/unit/pricing.test.ts
git mv tests/unit/typebot-lead-capture.test.js tests/unit/typebot-lead-capture.test.ts
```

- [ ] **Step 2: Fix TypeScript-only parse/type issues minimally**

Allowed fixes:

```ts
const mock = value as unknown as ExpectedShape;
```

```ts
const err = error as Error;
```

```ts
const payload: Record<string, unknown> = { ... };
```

Not allowed in this task:

```ts
// @ts-nocheck
```

Not allowed unless there is no narrower option:

```ts
as any
```

- [ ] **Step 3: Keep backend imports as `.js`**

Imports like this are correct because backend files remain JS:

```ts
import { getRate } from '../../api/_functions/pricing.js';
```

Do not change backend module imports to `.ts` in this task.

- [ ] **Step 4: Run full test/type gate**

```bash
npm run type-check
npm run test:unit
```

Expected:

- `tsc --noEmit` passes.
- 134 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit
git commit -m "chore: convert unit tests to TypeScript"
```

---

## Task 6: Final verification and handoff

**Files:**

- Modify if needed: `docs/typescript-migration-fase4-fase5-report.md`
- Create if needed: `docs/typescript-migration-final-report.md`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: final migration status and evidence.

- [ ] **Step 1: Fresh clean install check is optional but recommended**

If time permits:

```bash
rm -rf node_modules
npm install
npm run check
npm run test:unit
```

If not doing clean install, explicitly state it was not run.

- [ ] **Step 2: Run final commands**

```bash
npm run check
npm run test:unit
node scripts/test-client-metadata.mjs
node scripts/test-whatsapp-flows.mjs
```

Expected:

- `npm run check` passes.
- Unit tests pass with 134 tests, unless additional tests were added intentionally.
- Client metadata script passes with 35 checks.
- WhatsApp flows script passes with 29 checks.

- [ ] **Step 3: Run frontend source-state checks**

```bash
find src -type f \( -name '*.js' -o -name '*.jsx' \) -print
find src -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l
rg "@/.*\.(js|jsx)|from ['\"].*\.(js|jsx)['\"]" src -n || true
```

Expected:

- First command prints nothing.
- TS/TSX count is non-zero and reflects current source count.
- Third command prints nothing.

- [ ] **Step 4: Run visual smoke check**

Run:

```bash
npm run dev
```

Open the app route used in the screenshot. Confirm:

- Not raw unstyled HTML.
- Sidebar, topbar, cards, buttons and two-column layout render with expected spacing.
- Browser console has no fatal React/runtime errors.

- [ ] **Step 5: Update final report**

If using existing report, append:

```md
## Post-report fixes

- Fixed Tailwind content globs to include `.ts`/`.tsx`, restoring generated utility CSS after frontend migration.
- Added guard script `npm run check:tailwind` to prevent recurrence.
- Added `// @ts-check` to selected backend helper libs.
- Converted remaining unit test files to `.ts`.
```

- [ ] **Step 6: Check git status**

```bash
git status --short
```

Expected: clean working tree after commits.

- [ ] **Step 7: Stop before push**

Do not run `git push`. Ask the user for approval before pushing.
