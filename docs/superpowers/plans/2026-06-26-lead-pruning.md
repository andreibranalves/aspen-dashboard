# Lead Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semi-automatic Kanban cleanup that lets the user review old **Orcamento Enviado** deals and move selected stale opportunities to **Perdido**.

**Architecture:** Backend computes and revalidates prune candidates from ERPNext/Frappe CRM in a focused helper module, then exposes one API handler for GET/POST. Frontend adds a small banner and review modal to `CrmKanbanPage` without changing Kanban drag/drop behavior.

**Tech Stack:** React 19 + Vite 6 frontend; Node.js ESM Vercel serverless API; TypeScript source compiled to checked-in JavaScript via `npm run build:api`; `node:test` unit tests and Playwright e2e.

## Global Constraints

- ESM only; local API imports require explicit `.js` extensions.
- Add new API endpoints to `api/[...path].ts`, `scripts/dev-api-server.mjs`, and `scripts/app-server.mjs` route maps.
- Do not add dependencies.
- Do not delete Lead, Quotation, or CRM Deal records.
- Do not create new ERPNext/Frappe fields.
- Do not expose raw ERPNext errors or stack traces in HTTP responses.
- User-facing API errors must be in Brazilian Portuguese.
- Backend must revalidate every selected deal during POST before updating it.
- Prune rule: `CRM Deal.status === "Orcamento Enviado"`, deal has `custom_quotation`, linked `Quotation.transaction_date` is 30+ days old, linked quotation has no Sales Order Item, and `CRM Deal.modified` is not within the last 7 days.

---

## File Structure

- Create `api/_functions/lib/crm-prune.ts`: pure prune rules, ERPNext list orchestration, and update orchestration with dependency injection for tests.
- Create `api/_functions/crm-prune-candidates.ts`: API handler for `GET` candidates and `POST` selected deal IDs.
- Modify `api/[...path].ts`: production Vercel route registration.
- Modify `scripts/dev-api-server.mjs`: local dev API route registration.
- Modify `scripts/app-server.mjs`: combined app server route registration.
- Modify generated API files after `npm run build:api`: `api/_functions/lib/crm-prune.js`, `api/_functions/lib/crm-prune.js.map`, `api/_functions/crm-prune-candidates.js`, `api/_functions/crm-prune-candidates.js.map`, `api/[...path].js`, `api/[...path].js.map`.
- Create `tests/unit/crm-prune.test.ts`: unit tests for eligibility and POST revalidation.
- Modify `src/pages/CrmKanbanPage.tsx`: banner, modal, selection state, API calls, and summary/error messages.
- Create `tests/crm-prune.spec.js`: Playwright coverage for the Kanban prune workflow.

---

### Task 1: Backend prune rule helper

**Files:**

- Create: `api/_functions/lib/crm-prune.ts`
- Create: `tests/unit/crm-prune.test.ts`

**Interfaces:**

- Produces:
  - `getPruneCandidates(deps: CrmPruneDeps, now?: Date): Promise<CrmPruneCandidate[]>`
  - `pruneDeals(dealIds: string[], deps: CrmPruneDeps, now?: Date): Promise<CrmPruneResult>`
  - `parseDealIds(payload: unknown): string[]`
  - constants `PRUNE_TARGET_STATUS`, `PRUNE_LOST_STATUS`, `PRUNE_THRESHOLD_DAYS`, `PRUNE_PROTECT_RECENT_DAYS`
- Consumes:
  - ERP-like dependencies with `erpGetList(doctype, opts)` and `erpPut(doctype, name, payload)`.

- [ ] **Step 1: Write failing helper tests**

Create `tests/unit/crm-prune.test.ts` with this content:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPruneCandidates,
  parseDealIds,
  pruneDeals,
} from '../../api/_functions/lib/crm-prune.js';

function makeDeps(data: {
  deals: Record<string, unknown>[];
  quotations: Record<string, unknown>[];
  linkedItems?: Record<string, unknown>[];
}) {
  const puts: Array<{ doctype: string; name: string; payload: Record<string, unknown> }> = [];

  return {
    deps: {
      erpGetList: async (doctype: string) => {
        if (doctype === 'CRM Deal') return data.deals;
        if (doctype === 'Quotation') return data.quotations;
        if (doctype === 'Sales Order Item') return data.linkedItems || [];
        throw new Error(`Unexpected doctype: ${doctype}`);
      },
      erpPut: async (doctype: string, name: string, payload: Record<string, unknown>) => {
        puts.push({ doctype, name, payload });
        return { name, ...payload };
      },
    },
    puts,
  };
}

const NOW = new Date('2026-06-26T12:00:00.000Z');

describe('crm-prune helper', () => {
  it('returns only old quotation deals that were not recently modified and have no sales order', async () => {
    const { deps } = makeDeps({
      deals: [
        {
          name: 'DEAL-OLD',
          lead_name: 'Cliente Antigo',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-OLD',
          modified: '2026-06-01T10:00:00.000Z',
        },
        {
          name: 'DEAL-RECENT-DEAL',
          lead_name: 'Cliente Mexido',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-OLD-2',
          modified: '2026-06-24T10:00:00.000Z',
        },
        {
          name: 'DEAL-NO-QUOTE',
          lead_name: 'Sem orçamento',
          status: 'Orcamento Enviado',
          custom_quotation: '',
          modified: '2026-06-01T10:00:00.000Z',
        },
        {
          name: 'DEAL-WRONG-STATUS',
          lead_name: 'Negociando',
          status: 'Em Negociacao',
          custom_quotation: 'QTN-OLD-3',
          modified: '2026-06-01T10:00:00.000Z',
        },
      ],
      quotations: [
        { name: 'QTN-OLD', transaction_date: '2026-05-20', grand_total: 1234.56, status: 'Open' },
        { name: 'QTN-OLD-2', transaction_date: '2026-05-20', grand_total: 999, status: 'Open' },
        { name: 'QTN-OLD-3', transaction_date: '2026-05-20', grand_total: 888, status: 'Open' },
      ],
      linkedItems: [],
    });

    const candidates = await getPruneCandidates(deps, NOW);

    assert.deepEqual(candidates, [
      {
        deal_id: 'DEAL-OLD',
        lead_name: 'Cliente Antigo',
        quotation: 'QTN-OLD',
        quotation_date: '2026-05-20',
        age_days: 37,
        deal_modified: '2026-06-01T10:00:00.000Z',
        grand_total: 1234.56,
      },
    ]);
  });

  it('excludes old quotations that already have linked sales orders', async () => {
    const { deps } = makeDeps({
      deals: [
        {
          name: 'DEAL-LINKED',
          lead_name: 'Cliente Fechado',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-LINKED',
          modified: '2026-06-01T10:00:00.000Z',
        },
      ],
      quotations: [
        { name: 'QTN-LINKED', transaction_date: '2026-05-01', grand_total: 2000, status: 'Open' },
      ],
      linkedItems: [{ prevdoc_docname: 'QTN-LINKED' }],
    });

    assert.deepEqual(await getPruneCandidates(deps, NOW), []);
  });

  it('revalidates selected deals before marking them as Perdido', async () => {
    const { deps, puts } = makeDeps({
      deals: [
        {
          name: 'DEAL-VALID',
          lead_name: 'Cliente Valido',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-VALID',
          modified: '2026-06-01T10:00:00.000Z',
        },
        {
          name: 'DEAL-RECENT',
          lead_name: 'Cliente Recente',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-RECENT',
          modified: '2026-06-25T10:00:00.000Z',
        },
      ],
      quotations: [
        { name: 'QTN-VALID', transaction_date: '2026-05-01', grand_total: 1000, status: 'Open' },
        { name: 'QTN-RECENT', transaction_date: '2026-05-01', grand_total: 1000, status: 'Open' },
      ],
    });

    const result = await pruneDeals(['DEAL-VALID', 'DEAL-RECENT', 'DEAL-MISSING'], deps, NOW);

    assert.equal(result.success, true);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 2);
    assert.deepEqual(result.skipped_deals, [
      { deal_id: 'DEAL-RECENT', reason: 'Deal não está mais elegível para limpeza.' },
      { deal_id: 'DEAL-MISSING', reason: 'Deal não está mais elegível para limpeza.' },
    ]);
    assert.deepEqual(puts, [
      {
        doctype: 'CRM Deal',
        name: 'DEAL-VALID',
        payload: {
          status: 'Perdido',
          next_step: 'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.',
        },
      },
    ]);
  });

  it('validates POST deal_ids payload', () => {
    assert.deepEqual(parseDealIds({ deal_ids: ['A', 'B', 'A', '', 123] }), ['A', 'B']);
    assert.throws(() => parseDealIds({ deal_ids: [] }), /Selecione ao menos uma oportunidade/);
    assert.throws(() => parseDealIds({}), /deal_ids deve ser uma lista/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
TZ=UTC node --test tests/unit/crm-prune.test.ts
```

Expected: FAIL with module-not-found for `api/_functions/lib/crm-prune.js`.

- [ ] **Step 3: Implement helper module**

Create `api/_functions/lib/crm-prune.ts` with this content:

```ts
import { createHttpError } from './erpnext.js';

export const PRUNE_TARGET_STATUS = 'Orcamento Enviado';
export const PRUNE_LOST_STATUS = 'Perdido';
export const PRUNE_THRESHOLD_DAYS = 30;
export const PRUNE_PROTECT_RECENT_DAYS = 7;
export const PRUNE_NEXT_STEP =
  'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.';

export interface CrmPruneCandidate {
  deal_id: string;
  lead_name: string;
  quotation: string;
  quotation_date: string;
  age_days: number;
  deal_modified: string;
  grand_total: number;
}

export interface CrmPruneResult {
  success: true;
  updated: number;
  skipped: number;
  skipped_deals: Array<{ deal_id: string; reason: string }>;
}

export interface CrmPruneDeps {
  erpGetList: (
    doctype: string,
    opts?: {
      fields?: string[];
      filters?: Array<Array<any>>;
      order_by?: string;
      limit?: number;
    }
  ) => Promise<Array<Record<string, any>>>;
  erpPut: (
    doctype: string,
    name: string,
    payload: Record<string, unknown>
  ) => Promise<Record<string, any>>;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseTime(value: unknown): number {
  if (!value || typeof value !== 'string') return Number.NaN;
  return new Date(value).getTime();
}

function ageInDays(date: string, now: Date): number {
  const time = parseTime(`${date}T00:00:00.000Z`);
  if (Number.isNaN(time)) return -1;
  return Math.floor((now.getTime() - time) / (1000 * 60 * 60 * 24));
}

function isRecentlyModified(modified: unknown, now: Date): boolean {
  const time = parseTime(modified);
  if (Number.isNaN(time)) return false;
  const protectAfter = addDays(now, -PRUNE_PROTECT_RECENT_DAYS).getTime();
  return time > protectAfter;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseDealIds(payload: unknown): string[] {
  const dealIds = (payload as { deal_ids?: unknown })?.deal_ids;
  if (!Array.isArray(dealIds)) {
    throw createHttpError(400, 'deal_ids deve ser uma lista de oportunidades.');
  }

  const unique = Array.from(new Set(dealIds.map(cleanString).filter(Boolean)));

  if (unique.length === 0) {
    throw createHttpError(400, 'Selecione ao menos uma oportunidade para limpar.');
  }

  return unique;
}

async function fetchLinkedQuotationNames(
  quotationNames: string[],
  deps: Pick<CrmPruneDeps, 'erpGetList'>
): Promise<Set<string>> {
  if (quotationNames.length === 0) return new Set();

  const rows = await deps.erpGetList('Sales Order Item', {
    fields: ['prevdoc_docname'],
    filters: [['prevdoc_docname', 'in', quotationNames]],
    limit: 10000,
  });

  return new Set(rows.map((row) => cleanString(row.prevdoc_docname)).filter(Boolean));
}

export async function getPruneCandidates(
  deps: Pick<CrmPruneDeps, 'erpGetList'>,
  now = new Date()
): Promise<CrmPruneCandidate[]> {
  const deals = await deps.erpGetList('CRM Deal', {
    fields: ['name', 'lead_name', 'status', 'custom_quotation', 'modified'],
    filters: [['status', '=', PRUNE_TARGET_STATUS]],
    order_by: 'modified asc',
    limit: 10000,
  });

  const oldEnoughCutoff = dateOnly(addDays(now, -PRUNE_THRESHOLD_DAYS));
  const dealsByQuotation = new Map<string, Record<string, any>>();

  for (const deal of deals) {
    const quotation = cleanString(deal.custom_quotation);
    if (!quotation) continue;
    if (cleanString(deal.status) !== PRUNE_TARGET_STATUS) continue;
    if (isRecentlyModified(deal.modified, now)) continue;
    if (!dealsByQuotation.has(quotation)) dealsByQuotation.set(quotation, deal);
  }

  const quotationNames = Array.from(dealsByQuotation.keys());
  if (quotationNames.length === 0) return [];

  const quotations = await deps.erpGetList('Quotation', {
    fields: ['name', 'transaction_date', 'grand_total', 'status'],
    filters: [
      ['name', 'in', quotationNames],
      ['transaction_date', '<=', oldEnoughCutoff],
    ],
    order_by: 'transaction_date asc',
    limit: 10000,
  });

  const linkedQuotationNames = await fetchLinkedQuotationNames(quotationNames, deps);

  return quotations
    .filter((quotation) => !linkedQuotationNames.has(cleanString(quotation.name)))
    .map((quotation) => {
      const quotationName = cleanString(quotation.name);
      const deal = dealsByQuotation.get(quotationName) || {};
      const quotationDate = cleanString(quotation.transaction_date);

      return {
        deal_id: cleanString(deal.name),
        lead_name: cleanString(deal.lead_name) || 'Sem nome',
        quotation: quotationName,
        quotation_date: quotationDate,
        age_days: ageInDays(quotationDate, now),
        deal_modified: cleanString(deal.modified),
        grand_total: Number(quotation.grand_total || 0),
      };
    })
    .filter(
      (candidate) =>
        candidate.deal_id && candidate.quotation && candidate.age_days >= PRUNE_THRESHOLD_DAYS
    )
    .sort((a, b) => b.age_days - a.age_days);
}

export async function pruneDeals(
  dealIds: string[],
  deps: CrmPruneDeps,
  now = new Date()
): Promise<CrmPruneResult> {
  const selected = new Set(dealIds.map(cleanString).filter(Boolean));
  const eligible = new Set(
    (await getPruneCandidates(deps, now))
      .filter((candidate) => selected.has(candidate.deal_id))
      .map((candidate) => candidate.deal_id)
  );

  let updated = 0;
  const skipped_deals: Array<{ deal_id: string; reason: string }> = [];

  for (const dealId of selected) {
    if (!eligible.has(dealId)) {
      skipped_deals.push({ deal_id: dealId, reason: 'Deal não está mais elegível para limpeza.' });
      continue;
    }

    await deps.erpPut('CRM Deal', dealId, {
      status: PRUNE_LOST_STATUS,
      next_step: PRUNE_NEXT_STEP,
    });
    updated += 1;
  }

  return {
    success: true,
    updated,
    skipped: skipped_deals.length,
    skipped_deals,
  };
}
```

- [ ] **Step 4: Build API JavaScript for helper**

Run:

```bash
npm run build:api
```

Expected: PASS and generated `api/_functions/lib/crm-prune.js` exists.

- [ ] **Step 5: Run helper tests to verify pass**

Run:

```bash
TZ=UTC node --test tests/unit/crm-prune.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit helper**

```bash
git add api/_functions/lib/crm-prune.ts api/_functions/lib/crm-prune.js api/_functions/lib/crm-prune.js.map tests/unit/crm-prune.test.ts
git commit -m "feat(api): add CRM prune eligibility helper"
```

---

### Task 2: API endpoint and route registration

**Files:**

- Create: `api/_functions/crm-prune-candidates.ts`
- Modify: `api/[...path].ts`
- Modify: `scripts/dev-api-server.mjs`
- Modify: `scripts/app-server.mjs`
- Generated by build: `api/_functions/crm-prune-candidates.js`, `api/_functions/crm-prune-candidates.js.map`, `api/[...path].js`, `api/[...path].js.map`

**Interfaces:**

- Consumes Task 1:
  - `getPruneCandidates`, `parseDealIds`, `pruneDeals`
- Produces:
  - `GET /api/crm-prune-candidates` response `{ candidates, meta }`
  - `POST /api/crm-prune-candidates` payload `{ deal_ids: string[] }` response `{ success, updated, skipped, skipped_deals }`

- [ ] **Step 1: Create endpoint handler**

Create `api/_functions/crm-prune-candidates.ts` with this content:

```ts
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { createHttpError, erpGetList, erpPut } from './lib/erpnext.js';
import {
  getPruneCandidates,
  parseDealIds,
  pruneDeals,
  PRUNE_PROTECT_RECENT_DAYS,
  PRUNE_THRESHOLD_DAYS,
} from './lib/crm-prune.js';

const deps = { erpGetList, erpPut };

function json(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(body: string | undefined | null): unknown {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  try {
    if (event.httpMethod === 'GET') {
      const candidates = await getPruneCandidates(deps);
      return json(200, {
        candidates,
        meta: {
          threshold_days: PRUNE_THRESHOLD_DAYS,
          protect_recent_days: PRUNE_PROTECT_RECENT_DAYS,
          count: candidates.length,
        },
      });
    }

    if (event.httpMethod === 'POST') {
      const dealIds = parseDealIds(parseJsonBody(event.body));
      return json(200, await pruneDeals(dealIds, deps));
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[crm-prune-candidates]', err?.logMessage || err?.message || err);
    return json(code, { error: err?.statusCode ? err.message : 'Erro interno.' });
  }
}
```

- [ ] **Step 2: Register production Vercel route**

Modify `api/[...path].ts`:

Add import near other CRM imports:

```ts
import { handler as crmPruneCandidates } from './_functions/crm-prune-candidates.js';
```

Add route entry near `crm-deals`:

```ts
  'crm-prune-candidates': crmPruneCandidates,
```

- [ ] **Step 3: Register local dev API route**

Modify `scripts/dev-api-server.mjs`:

Add import near other CRM imports:

```js
import { handler as crmPruneCandidates } from '../api/_functions/crm-prune-candidates.js';
```

Add route entry near `crm-deals`:

```js
  'crm-prune-candidates': crmPruneCandidates,
```

- [ ] **Step 4: Register combined app server route**

Modify `scripts/app-server.mjs`:

Add import near other CRM imports:

```js
import { handler as crmPruneCandidates } from '../api/_functions/crm-prune-candidates.js';
```

Add route entry near `crm-deals`:

```js
  'crm-prune-candidates': crmPruneCandidates,
```

- [ ] **Step 5: Build API generated files**

Run:

```bash
npm run build:api
```

Expected: PASS and generated files exist for `crm-prune-candidates` and updated `api/[...path].js`.

- [ ] **Step 6: Run focused unit tests**

Run:

```bash
TZ=UTC node --test tests/unit/crm-prune.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit endpoint and routes**

```bash
git add api/_functions/crm-prune-candidates.ts api/_functions/crm-prune-candidates.js api/_functions/crm-prune-candidates.js.map api/[...path].ts api/[...path].js api/[...path].js.map scripts/dev-api-server.mjs scripts/app-server.mjs
git commit -m "feat(api): expose CRM prune candidates endpoint"
```

---

### Task 3: Kanban banner and review modal

**Files:**

- Modify: `src/pages/CrmKanbanPage.tsx`

**Interfaces:**

- Consumes Task 2:
  - `GET /api/crm-prune-candidates`
  - `POST /api/crm-prune-candidates` with `{ deal_ids: string[] }`
- Produces:
  - Banner when candidates exist.
  - Review modal with checkboxes.
  - Summary after POST.

- [ ] **Step 1: Update imports**

In `src/pages/CrmKanbanPage.tsx`, replace:

```ts
import { Search, AlertTriangle, BarChart3, Clipboard, Send } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
```

with:

```ts
import { Search, AlertTriangle, BarChart3, Clipboard, Send, X } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
```

- [ ] **Step 2: Add prune interfaces**

After `interface UpdateDealResult`, add:

```ts
interface PruneCandidate {
  deal_id: string;
  lead_name: string;
  quotation: string;
  quotation_date: string;
  age_days: number;
  deal_modified: string;
  grand_total: number;
}

interface PruneCandidatesResponse {
  candidates: PruneCandidate[];
  meta: {
    threshold_days: number;
    protect_recent_days: number;
    count: number;
  };
}

interface PruneResult {
  success: boolean;
  updated: number;
  skipped: number;
  skipped_deals: Array<{ deal_id: string; reason: string }>;
}
```

- [ ] **Step 3: Add local formatting helpers**

After `daysAgo`, add:

```ts
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDateBR(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
```

- [ ] **Step 4: Add prune state and fetch function**

Inside `CrmKanbanPage`, after existing `useState` declarations, add:

```ts
const [pruneCandidates, setPruneCandidates] = useState<PruneCandidate[]>([]);
const [pruneLoading, setPruneLoading] = useState<boolean>(false);
const [pruneError, setPruneError] = useState<string | null>(null);
const [pruneOpen, setPruneOpen] = useState<boolean>(false);
const [selectedPruneIds, setSelectedPruneIds] = useState<Set<string>>(new Set());
const [pruneSubmitting, setPruneSubmitting] = useState<boolean>(false);
const [pruneSummary, setPruneSummary] = useState<string | null>(null);
```

After `fetchData`, add:

```ts
const fetchPruneCandidates = useCallback(async () => {
  setPruneLoading(true);
  setPruneError(null);
  try {
    const data = await apiGet<PruneCandidatesResponse>('/crm-prune-candidates');
    const candidates = data.candidates || [];
    setPruneCandidates(candidates);
    setSelectedPruneIds(new Set(candidates.map((candidate) => candidate.deal_id)));
  } catch (err) {
    setPruneError((err as Error).message || 'Erro ao carregar limpeza de pipeline.');
  } finally {
    setPruneLoading(false);
  }
}, []);
```

- [ ] **Step 5: Load candidates with Kanban**

Replace the existing `useEffect`:

```ts
useEffect(() => {
  fetchData(search);
}, [fetchData]);
```

with:

```ts
useEffect(() => {
  fetchData(search);
  fetchPruneCandidates();
}, [fetchData, fetchPruneCandidates]);
```

- [ ] **Step 6: Add selection and submit handlers**

Before `const orderedColumns = ...`, add:

```ts
const togglePruneSelection = useCallback((dealId: string) => {
  setSelectedPruneIds((prev) => {
    const next = new Set(prev);
    if (next.has(dealId)) next.delete(dealId);
    else next.add(dealId);
    return next;
  });
}, []);

const submitPrune = useCallback(async () => {
  const deal_ids = Array.from(selectedPruneIds);
  if (deal_ids.length === 0) {
    setPruneError('Selecione ao menos uma oportunidade para limpar.');
    return;
  }

  setPruneSubmitting(true);
  setPruneError(null);
  setPruneSummary(null);
  try {
    const result = await apiPost<PruneResult>('/crm-prune-candidates', { deal_ids });
    setPruneSummary(
      `${result.updated} oportunidades marcadas como Perdido. ${result.skipped} ignoradas.`
    );
    setPruneOpen(false);
    await Promise.all([fetchData(search), fetchPruneCandidates()]);
  } catch (err) {
    setPruneError((err as Error).message || 'Erro ao limpar pipeline.');
  } finally {
    setPruneSubmitting(false);
  }
}, [fetchData, fetchPruneCandidates, search, selectedPruneIds]);
```

- [ ] **Step 7: Add banner JSX**

In the `return`, immediately after the search `<div className="relative max-w-md">...</div>`, insert:

```tsx
{
  pruneSummary && (
    <div className="rounded-lg border border-success/30 bg-success/10 text-success px-4 py-3 text-sm">
      {pruneSummary}
    </div>
  );
}

{
  pruneError && (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
      {pruneError}
    </div>
  );
}

{
  !pruneLoading && pruneCandidates.length > 0 && (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <p className="font-medium text-sm text-fg">Limpeza de pipeline disponível</p>
        <p className="text-sm text-fg-muted">
          Existem {pruneCandidates.length} orçamentos enviados há 30 dias ou mais sem pedido fechado
          e sem atualização nos últimos 7 dias.
        </p>
      </div>
      <Button variant="outline" onClick={() => setPruneOpen(true)}>
        Revisar e marcar como Perdido
      </Button>
    </div>
  );
}
```

If Tailwind does not have `border-warning`, `bg-warning`, or `text-success` tokens in this project, replace those classes with existing token-safe equivalents:

```tsx
border-line bg-surface-muted text-fg
```

for the container and keep destructive classes only if they already exist elsewhere.

- [ ] **Step 8: Add modal JSX**

Before the closing `</div>` of the page root, after the Kanban board block, insert:

```tsx
{
  pruneOpen && (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-fg">Revisar limpeza de pipeline</h2>
            <p className="text-sm text-fg-muted mt-1">
              Selecione os orçamentos antigos que devem ser marcados como Perdido.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPruneOpen(false)}
            className="text-fg-muted hover:text-fg"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-auto p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left py-2 pr-2 w-10">&nbsp;</th>
                <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                  Lead
                </th>
                <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                  Orçamento
                </th>
                <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                  Idade
                </th>
                <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                  Última alteração
                </th>
                <th className="text-right py-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {pruneCandidates.map((candidate) => (
                <tr key={candidate.deal_id} className="border-b border-line/50 last:border-0">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedPruneIds.has(candidate.deal_id)}
                      onChange={() => togglePruneSelection(candidate.deal_id)}
                      aria-label={`Selecionar ${candidate.lead_name}`}
                    />
                  </td>
                  <td className="py-2 pr-2 text-fg">{candidate.lead_name || 'Sem nome'}</td>
                  <td className="py-2 pr-2 font-mono text-xs text-primary">
                    {candidate.quotation}
                  </td>
                  <td className="py-2 pr-2 text-fg-muted">{candidate.age_days} dias</td>
                  <td className="py-2 pr-2 text-fg-muted">
                    {formatDateBR(candidate.deal_modified)}
                  </td>
                  <td className="py-2 text-right text-fg font-medium">
                    {formatBRL(candidate.grand_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 border-t border-line flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <p className="text-sm text-fg-muted">
            {selectedPruneIds.size} de {pruneCandidates.length} selecionadas
          </p>
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setPruneOpen(false)}
              disabled={pruneSubmitting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={submitPrune}
              disabled={pruneSubmitting || selectedPruneIds.size === 0}
            >
              {pruneSubmitting ? 'Marcando...' : 'Marcar selecionados como Perdido'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run frontend type/build check**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 10: Commit frontend UI**

```bash
git add src/pages/CrmKanbanPage.tsx public/index.html public/assets
git commit -m "feat(crm): add Kanban prune review UI"
```

If `npm run build` changes generated `public/assets/*`, include only generated files from this build. Do not add unrelated public files.

---

### Task 4: Playwright coverage for prune workflow

**Files:**

- Create: `tests/crm-prune.spec.js`

**Interfaces:**

- Consumes Task 3 UI.
- Verifies mocked `/api/crm-deals`, `/api/crm-prune-candidates`, and POST workflow.

- [ ] **Step 1: Write failing e2e test**

Create `tests/crm-prune.spec.js` with this content:

```js
// @ts-check
import { test, expect } from '@playwright/test';

const CRM_DEALS_INITIAL = {
  columns: [
    { status: 'Novo Lead', count: 0, deals: [] },
    { status: 'Contato Feito', count: 0, deals: [] },
    {
      status: 'Orcamento Enviado',
      count: 1,
      deals: [
        {
          id: 'DEAL-OLD',
          lead_name: 'Cliente Antigo',
          email: 'antigo@example.com',
          quotation: 'QTN-OLD',
          follow_up_stage: 0,
          modificado_em: '2026-06-01T10:00:00.000Z',
          criado_em: '2026-05-01T10:00:00.000Z',
          status: 'Orcamento Enviado',
        },
      ],
    },
    { status: 'Em Negociacao', count: 0, deals: [] },
    { status: 'Arte Aprovada', count: 0, deals: [] },
    { status: 'Pedido Fechado', count: 0, deals: [] },
    { status: 'Perdido', count: 0, deals: [] },
  ],
};

const CRM_DEALS_AFTER = {
  columns: CRM_DEALS_INITIAL.columns.map((column) =>
    column.status === 'Orcamento Enviado'
      ? { ...column, count: 0, deals: [] }
      : column.status === 'Perdido'
        ? {
            ...column,
            count: 1,
            deals: [{ ...CRM_DEALS_INITIAL.columns[2].deals[0], status: 'Perdido' }],
          }
        : column
  ),
};

const PRUNE_CANDIDATES_INITIAL = {
  candidates: [
    {
      deal_id: 'DEAL-OLD',
      lead_name: 'Cliente Antigo',
      quotation: 'QTN-OLD',
      quotation_date: '2026-05-01',
      age_days: 56,
      deal_modified: '2026-06-01T10:00:00.000Z',
      grand_total: 1500,
    },
  ],
  meta: { threshold_days: 30, protect_recent_days: 7, count: 1 },
};

const PRUNE_CANDIDATES_EMPTY = {
  candidates: [],
  meta: { threshold_days: 30, protect_recent_days: 7, count: 0 },
};

test('reviews and marks stale Kanban deals as Perdido', async ({ page }) => {
  let pruned = false;
  let postedBody = null;

  await page.route('**/api/crm-deals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pruned ? CRM_DEALS_AFTER : CRM_DEALS_INITIAL),
    });
  });

  await page.route('**/api/crm-prune-candidates', async (route) => {
    if (route.request().method() === 'POST') {
      postedBody = route.request().postDataJSON();
      pruned = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, updated: 1, skipped: 0, skipped_deals: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pruned ? PRUNE_CANDIDATES_EMPTY : PRUNE_CANDIDATES_INITIAL),
    });
  });

  await page.goto('/#/crm');

  await expect(page.getByText('Limpeza de pipeline disponível')).toBeVisible();
  await page.getByRole('button', { name: 'Revisar e marcar como Perdido' }).click();

  await expect(page.getByText('Revisar limpeza de pipeline')).toBeVisible();
  await expect(page.getByText('Cliente Antigo')).toBeVisible();
  await expect(page.getByText('QTN-OLD')).toBeVisible();

  await page.getByRole('button', { name: 'Marcar selecionados como Perdido' }).click();

  await expect.poll(() => postedBody).toEqual({ deal_ids: ['DEAL-OLD'] });
  await expect(page.getByText('1 oportunidades marcadas como Perdido. 0 ignoradas.')).toBeVisible();
  await expect(page.getByText('Limpeza de pipeline disponível')).toHaveCount(0);
});
```

- [ ] **Step 2: Run e2e test to verify behavior**

Run:

```bash
npx playwright test tests/crm-prune.spec.js
```

Expected: PASS after Task 3. If it fails because the browser dependencies are missing, stop and ask the user whether to install Playwright browsers or skip e2e; do not silently substitute another tool.

- [ ] **Step 3: Commit e2e test**

```bash
git add tests/crm-prune.spec.js
git commit -m "test(crm): cover Kanban prune workflow"
```

---

### Task 5: Final verification

**Files:**

- No new source files.
- May update generated build output if `npm run build` emits changed assets.

**Interfaces:**

- Verifies all previous tasks work together.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run focused e2e test**

Run:

```bash
npx playwright test tests/crm-prune.spec.js
```

Expected: PASS.

- [ ] **Step 5: Check diagnostics**

Run tool-level diagnostics for edited files:

```text
lens_diagnostics mode=all severity=all
```

Expected: no blocking errors in edited files.

- [ ] **Step 6: Commit final generated output if needed**

If `npm run build` produced additional generated asset changes, commit only those relevant files:

```bash
git status --short
git add public/index.html public/assets
git commit -m "build: update generated frontend assets for CRM prune"
```

Skip this commit if there are no relevant generated frontend asset changes.
