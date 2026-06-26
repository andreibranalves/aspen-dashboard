# Tighten Frontend Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar casts inseguros, remover `unknown` index signatures e consolidar tipos de domínio do frontend em `src/types/`, mantendo `npm run type-check` passando.

**Architecture:** Criar quatro arquivos em `src/types/` (`api.ts`, `erpnext.ts`, `domain.ts`, `index.ts`) para centralizar o vocabulário tipado. Refatorar `src/lib/api.ts` para usar uma factory `createApiError` e substituir definições locais de `Product`, `DraftEdited` e dashboard por imports do novo módulo de tipos.

**Tech Stack:** TypeScript 5.9, React 19, Vite 6, `tsc --noEmit`.

## Global Constraints

- Nunca usar `any`. Usar `unknown` apenas com type guards.
- Manter `strict: true` e garantir que `npm run type-check` passe antes e depois de cada task.
- Casts `as` só são permitidos dentro de factories/guards com justificativa documentada.
- Tipos usados em mais de um arquivo devem ficar em `src/types/`; tipos estritamente locais podem permanecer no consumidor.
- Backend Vercel em `api/` está fora de escopo.
- Validação runtime com schemas está fora de escopo.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/types/api.ts` (novo) | `ApiError`, `ApiResponse<T>`, factory `createApiError`. |
| `src/types/erpnext.ts` (novo) | Shapes brutos do ERPNext (`ErpnextProduct`, `ErpnextQuotation`, etc.) — opcionais permitidos. |
| `src/types/domain.ts` (novo) | Entidades normalizadas usadas pela UI: `Product`, `DraftItem`, `DraftEdited`, `Draft`, `DashboardSummary`, etc. |
| `src/types/index.ts` (novo) | Re-exporta todos os tipos públicos. |
| `src/lib/api.ts` | Usa `ApiError` e `createApiError` de `@/types/api`. |
| `src/lib/productCache.ts` | Importa `Product` de `@/types/domain`; remove definição local e `[key: string]: unknown`. |
| `src/hooks/useExtractionDrafts.ts` | Importa `DraftItem`, `DraftEdited`, `Draft`, `ProductSearchEntry` de `@/types/domain`. |
| `src/pages/ProductsPage.tsx` | Importa `Product` e `ProductsApiResponse` de `@/types/domain`; remove definição local. |
| `src/pages/DashboardPage.tsx` | Importa tipos de dashboard de `@/types/domain`; remove definições locais. |
| `src/pages/ManualOrcamentoPage.tsx` | Substitui `OrcamentoResponse extends Record<string, unknown>` por tipo explícito. |

---

### Task 1: Criar tipos de API e refatorar `src/lib/api.ts`

**Files:**
- Create: `src/types/api.ts`
- Create: `src/types/index.ts`
- Modify: `src/lib/api.ts`
- Test: `npm run type-check`

**Interfaces:**
- Produces: `ApiError`, `createApiError(error: unknown): ApiError`, `ApiResponse<T>`.
- Consumes: nenhum.

- [ ] **Step 1: Criar `src/types/api.ts`**

```typescript
// src/types/api.ts
export interface ApiError extends Error {
  status: number;
  data?: unknown;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
}

export function createApiError(error: unknown): ApiError {
  if (error instanceof Error) {
    const apiErr = new Error(error.message) as ApiError;
    apiErr.status = (error as ApiError).status ?? 500;
    apiErr.data = (error as ApiError).data;
    return apiErr;
  }
  const apiErr = new Error(String(error || 'Erro desconhecido.')) as ApiError;
  apiErr.status = 500;
  return apiErr;
}
```

- [ ] **Step 2: Criar `src/types/index.ts` re-exportando `api.ts`**

```typescript
// src/types/index.ts
export * from './api';
```

- [ ] **Step 3: Refatorar `src/lib/api.ts` para usar `ApiError` e `createApiError`**

Substituir o conteúdo de `src/lib/api.ts` por:

```typescript
/**
 * API wrapper para chamadas ao backend Vercel.
 */
import { ApiError, createApiError } from '@/types/api';

const BASE = '/api';

async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE}${path}`;
  const opts: RequestInit = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = (await res.json().catch(() => null)) as unknown;

  if (res.status === 401 && path !== '/login') {
    window.location.hash = '#/login';
    const err = createApiError(new Error('Sessão expirada.'));
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Erro ${res.status}`;
    const err = createApiError(new Error(message));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

export { ApiError, createApiError };
export function apiGet<T = unknown>(path: string): Promise<T> {
  return request<T>('GET', path);
}
export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}
export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}
export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}
```

- [ ] **Step 4: Rodar type-check**

Run: `npm run type-check`
Expected: pass (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/types/index.ts src/lib/api.ts
git commit -m "types(api): centralize ApiError and add createApiError factory"
```

---

### Task 2: Consolidar tipo `Product` e remover index signature

**Files:**
- Modify: `src/types/domain.ts` (criado na Task 1, adicionar Product)
- Modify: `src/types/index.ts`
- Modify: `src/lib/productCache.ts`
- Modify: `src/pages/ProductsPage.tsx`
- Test: `npm run type-check`

**Interfaces:**
- Consumes: nenhum.
- Produces: `Product`, `ProductsApiResponse`.

- [ ] **Step 1: Adicionar `Product` em `src/types/domain.ts`**

Criar/atualizar `src/types/domain.ts`:

```typescript
// src/types/domain.ts

export interface Product {
  sku: string;
  item_code?: string;
  nome?: string;
  item_name?: string;
  descricao?: string;
  unidade?: string;
  stock_uom?: string;
  preco_minimo?: number | string;
}

export interface ProductsApiResponse {
  data?: Product[];
  pagination?: {
    total_pages?: number;
    total?: number;
  };
}
```

- [ ] **Step 2: Re-exportar domain em `src/types/index.ts`**

```typescript
// src/types/index.ts
export * from './api';
export * from './domain';
```

- [ ] **Step 3: Atualizar `src/lib/productCache.ts`**

Remover a definição local de `Product` e o `[key: string]: unknown`. O arquivo deve ficar assim:

```typescript
// src/lib/productCache.ts
// In-memory cache for product search results with configurable TTL.

import type { Product } from '@/types/domain';

const CACHE_TTL = 5 * 60 * 1000;

interface CacheEntry {
  data: Product[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function getKey(query: string | null | undefined, limit: number): string {
  return `${(query || '').toLowerCase().trim()}::${limit || 8}`;
}

interface ProductsApiResponse {
  data?: Product[];
}

export async function searchProducts(
  query?: string | null,
  limit = 8,
): Promise<Product[]> {
  const key = getKey(query, limit);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const url = `/api/products?search=${encodeURIComponent(String(query))}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn('[productCache] API error', res.status);
    return [];
  }
  const json = (await res.json().catch(() => ({ data: [] }))) as ProductsApiResponse;
  const data = json.data || [];

  cache.set(key, { data, ts: Date.now() });
  return data;
}

export function clearProductCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Atualizar `src/pages/ProductsPage.tsx`**

Remover as interfaces locais `Product` e `ProductsApiResponse` (linhas 34-51) e importar de `@/types/domain`:

```typescript
import type { Product, ProductsApiResponse } from '@/types/domain';
```

- [ ] **Step 5: Rodar type-check**

Run: `npm run type-check`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/domain.ts src/types/index.ts src/lib/productCache.ts src/pages/ProductsPage.tsx
git commit -m "types(product): centralize Product type and remove unknown index signature"
```

---

### Task 3: Consolidar tipos de Draft (DraftEdited, DraftItem, Draft)

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/hooks/useExtractionDrafts.ts`
- Modify: `src/components/SplitResultCard.tsx`
- Modify: `src/components/DraftReviewCard.tsx`
- Modify: `src/components/CustomerMetadataForm.tsx`
- Test: `npm run type-check`

**Interfaces:**
- Consumes: `Product` (Task 2), `Address` de `@/lib/clientMetadata`.
- Produces: `DraftItem`, `DraftEdited`, `Draft`, `ProductSearchEntry`.

- [ ] **Step 1: Adicionar tipos de Draft em `src/types/domain.ts`**

Adicionar ao final de `src/types/domain.ts`:

```typescript
import type { Address } from '@/lib/clientMetadata';

export interface DraftItem {
  item_code: string;
  qty: number;
  rate: number | null;
  item_name?: string;
  _rateManual?: boolean;
}

export interface DraftEdited {
  nome: string;
  email: string;
  telefone: string;
  urgente: boolean;
  origem: string;
  cnpj: string;
  endereco: Address;
  items: DraftItem[];
  prazo_producao: string;
  _showAddr?: boolean;
}

export interface Draft {
  index: number;
  original: Record<string, unknown>;
  edited: DraftEdited;
  approved: boolean;
  discarded: boolean;
  status?: 'processing' | 'done' | 'error';
  result?: { success: boolean; data?: Record<string, unknown>; error?: string };
}

export interface ProductSearchEntry {
  term?: string;
  results?: Product[];
  loading?: boolean;
  open?: boolean;
}
```

- [ ] **Step 2: Atualizar `src/hooks/useExtractionDrafts.ts`**

Remover as interfaces locais `DraftItem`, `DraftEdited`, `Draft`, `ProductSearchEntry` e importar de `@/types/domain`:

```typescript
import type {
  Draft,
  DraftEdited,
  DraftItem,
  ProductSearchEntry,
} from '@/types/domain';
```

A interface `Draft` permanece com `original: Record<string, unknown>` e `result.data?: Record<string, unknown>` porque representam payloads brutas do ERPNext — isso está documentado no design.

- [ ] **Step 3: Atualizar componentes consumidores**

Em `src/components/SplitResultCard.tsx`, `src/components/DraftReviewCard.tsx` e `src/components/CustomerMetadataForm.tsx`, substituir:

```typescript
import type { Draft, DraftItem, DraftEdited } from '@/hooks/useExtractionDrafts';
```

por:

```typescript
import type { Draft, DraftEdited, DraftItem } from '@/types/domain';
```

- [ ] **Step 4: Rodar type-check**

Run: `npm run type-check`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/domain.ts src/hooks/useExtractionDrafts.ts src/components/SplitResultCard.tsx src/components/DraftReviewCard.tsx src/components/CustomerMetadataForm.tsx
git commit -m "types(draft): centralize Draft types and remove unknown index signature"
```

---

### Task 4: Consolidar tipos de Dashboard

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/pages/DashboardPage.tsx`
- Test: `npm run type-check`

**Interfaces:**
- Consumes: nenhum.
- Produces: `DashboardSummary`, `TopProduct`, `TopCustomer`, `SalesByDay`, `StaleQuotation`, `DashboardData`.

- [ ] **Step 1: Adicionar tipos de Dashboard em `src/types/domain.ts`**

Adicionar ao final:

```typescript
export interface DashboardSummary {
  total_revenue?: number;
  revenue_delta?: number;
  orders_count?: number;
  orders_delta?: number;
  avg_ticket?: number;
  avg_ticket_delta?: number;
  open_orders?: number;
  conversion_rate?: number;
  conversion_delta?: number;
}

export interface TopProduct {
  sku?: string;
  product?: string;
  name?: string;
  quantity?: number;
  qty?: number;
  revenue?: number;
  total?: number;
  orders?: number;
  order_count?: number;
}

export interface TopCustomer {
  name?: string;
  customer?: string;
  revenue?: number;
  total?: number;
  orders?: number;
  order_count?: number;
}

export interface SalesByDay {
  date?: string;
  revenue?: number;
  total?: number;
}

export interface StaleQuotation {
  id?: string;
  customer?: string;
  client?: string;
  age?: number;
  days_old?: number;
  value?: number;
  total?: number;
  status?: string;
}

export interface DashboardData {
  summary?: DashboardSummary;
  top_products?: TopProduct[];
  top_customers?: TopCustomer[];
  sales_by_day?: SalesByDay[];
  stale_quotations?: StaleQuotation[];
}
```

- [ ] **Step 2: Atualizar `src/pages/DashboardPage.tsx`**

Remover as interfaces locais (`DashboardSummary`, `TopProduct`, `TopCustomer`, `SalesByDay`, `StaleQuotation`, `DashboardData`) e importar o tipo de dados de `@/types/domain`. Manter `DashboardPageProps` e `SummaryCard` locais, pois são específicos do componente:

```typescript
import type { DashboardData } from '@/types/domain';
```

- [ ] **Step 3: Rodar type-check**

Run: `npm run type-check`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/types/domain.ts src/pages/DashboardPage.tsx
git commit -m "types(dashboard): centralize dashboard data types"
```

---

### Task 5: Tipar `OrcamentoResponse` e limpar `Record<string, unknown>` restantes

**Files:**
- Modify: `src/types/erpnext.ts` (novo)
- Modify: `src/types/index.ts`
- Modify: `src/pages/ManualOrcamentoPage.tsx`
- Test: `npm run type-check`

**Interfaces:**
- Consumes: nenhum.
- Produces: `OrcamentoResponse`.

- [ ] **Step 1: Criar `src/types/erpnext.ts`**

```typescript
// src/types/erpnext.ts
// Shapes brutos vindos do ERPNext/Frappe. Campos opcionais e aliases são permitidos aqui.

export interface OrcamentoResponse {
  cliente?: string;
  quotation_id?: string;
  // outros campos retornados pelo endpoint /orcamento podem ser adicionados conforme necessário
}
```

- [ ] **Step 2: Re-exportar em `src/types/index.ts`**

```typescript
// src/types/index.ts
export * from './api';
export * from './domain';
export * from './erpnext';
```

- [ ] **Step 3: Atualizar `src/pages/ManualOrcamentoPage.tsx`**

Substituir:

```typescript
interface OrcamentoResponse extends Record<string, unknown> {
  cliente?: string;
  quotation_id?: string;
}
```

por:

```typescript
import type { OrcamentoResponse } from '@/types/erpnext';
```

- [ ] **Step 4: Verificar outros `Record<string, unknown>` genéricos**

Run:

```bash
rg "Record<string, unknown>" src/ --type tsx --type ts
```

Se houver outros casos em entidades de domínio (não em `Draft.original`/`result.data`, que são propsósitos), tipá-los ou mover para `src/types/erpnext.ts`. Não alterar `api/`.

- [ ] **Step 5: Rodar type-check e lint**

Run:

```bash
npm run type-check
npm run lint
```

Expected: ambos passam.

- [ ] **Step 6: Commit**

```bash
git add src/types/erpnext.ts src/types/index.ts src/pages/ManualOrcamentoPage.tsx
git commit -m "types(erpnext): type OrcamentoResponse explicitly and add erpnext module"
```

---

## Self-Review

### Spec coverage

- Criar `src/types/{api,erpnext,domain,index}.ts` → Tasks 1, 2, 4, 5.
- Refatorar `src/lib/api.ts` para usar `ApiError` via factory → Task 1.
- Substituir interfaces locais duplicadas → Tasks 2, 3, 4.
- Ajustar `Product`, `DraftEdited` e outras entidades com index signatures → Tasks 2, 3, 5.
- Critérios de sucesso (`type-check` passando, sem `any`, sem casts inseguros) → verificado ao final de cada task.

### Placeholder scan

Nenhum TBD/TODO. Cada step contém código real, comandos e output esperado.

### Type consistency

- `ApiError` e `createApiError` definidos em Task 1 e usados em `src/lib/api.ts`.
- `Product` definido em Task 2 e consumido por `productCache.ts` e `ProductsPage.tsx`.
- `Draft*` definidos em Task 3 e consumidos por hook e componentes.
- Dashboard types definidos em Task 4 e consumidos por `DashboardPage.tsx`.
- `OrcamentoResponse` definido em Task 5 e consumido por `ManualOrcamentoPage.tsx`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-tighten-frontend-types.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
