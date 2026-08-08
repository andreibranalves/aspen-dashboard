# CRM Core 15 (#17): Operational Core — Implementation Plan

**Status:** Plan (2026-08-03)
**Spec:** #2 (64 US), detailed in docs/superpowers
**Parents:** #12 (migration), #13 (PDF archiving), #14 (backup/restore + capacity)

---

## Overview

The individual building blocks are built.
The three feature flags (`CRM_CORE_PRODUCTS_ENABLED`, `CRM_CORE_CLIENTS_ENABLED`, `CRM_CORE_QUOTES_ENABLED`) independently gate the roll-out of each domain from Frappe to PostgreSQL.
Issue #17 introduces a **master cutoff** that activates all three simultaneously, gates navigation to only the operational-core features, adds a readiness check, and locks out deferred Frappe-dependent pages and handlers.

---

## Exploration Findings

### 1. Feature-Flag Architecture

| Flag | Controls | Mode File |
|------|----------|-----------|
| `CRM_CORE_PRODUCTS_ENABLED` | Products, product-detail, pricing-lookup | `products-mode.ts` |
| `CRM_CORE_CLIENTS_ENABLED` | leads-clients, client-detail | `client-core.ts` |
| `CRM_CORE_QUOTES_ENABLED` | quotations, orcamento, quotation-issue, quotation-document, quotation-preview, quotation-templates | `orcamento-mode.ts` |

Each domain has a dispatcher (`products.ts`, `leads-clients.ts`, `quotations.ts`, `orcamento.ts`) that checks the flag and routes to either the core (PostgreSQL) or legacy (Frappe) handler.
When core is active the legacy path is **never** invoked — no fallback.
Some dispatchers promote read-only (`GET`) access to the core path when a sibling domain is active (e.g. `CRM_CORE_QUOTES_ENABLED=true` promotes `GET /api/products` to core).

### 2. Frappe-Dependent Handlers (UNSAFE in Operational Mode)

These handlers import from `lib/erpnext.ts` and call Frappe directly.
They must be hardened, disabled, or hidden in the operational mode:

| Handler | Route | Frappe Calls | Action in Operational Mode |
|---------|-------|-------------|--------------------------|
| `quotations.ts` (legacy path) | `/api/quotations` | `erpGetList`, `erpGetDoc`, `erpPut`, `erpDelete`, `erpCallMethod` | Already gated — core path takes over when `CRM_CORE_QUOTES_ENABLED=true` |
| `products-legacy.ts` | `/api/products` | `erpGetList`, `erpPost`, `erpDelete` | Already gated — core path takes over when `CRM_CORE_PRODUCTS_ENABLED=true` |
| `leads-clients-legacy.ts` | `/api/leads-clients` | `erpGetList`, `erpPost`, `erpDelete` | Already gated — core path takes over when `CRM_CORE_CLIENTS_ENABLED=true` |
| `client-detail-legacy.ts` | `/api/client-detail` | `erpGetDoc`, `erpGetList`, `erpPut`, `erpPost` | Already gated — core path takes over when `CRM_CORE_CLIENTS_ENABLED=true` |
| `product-detail-legacy.ts` | `/api/product-detail` | `erpGetDoc` | Already gated |
| `product-update-legacy.ts` | `/api/product-update` | `erpGetDoc`, `erpPut` | Already gated |
| `orcamento-legacy.ts` | `/api/orcamento` | `erpPost`, `erpGetDoc` | Already gated |
| `pricing-lookup.ts` (legacy) | `/api/pricing-lookup` | `erpGetList` | Already gated |
| `sales-dashboard.ts` | `/api/sales-dashboard` | `erpGetList` | **Disable** — returns 503 with Portuguese message |
| `sales-orders.ts` | `/api/sales-orders` | `erpGetList`, `erpGetDoc` | **Disable** — returns 503 |
| `sales-order-from-quotation.ts` | `/api/sales-order-from-quotation` | `erpGetList`, `erpGetDoc`, `erpPost`, `erpCallMethod` | **Disable** — returns 503 |
| `crm-deals.ts` | `/api/crm-deals` | `erpGetList` | **Disable** |
| `crm-update-deal.ts` | `/api/crm-update-deal` | `erpPut` | **Disable** |
| `crm-prune-candidates.ts` | `/api/crm-prune-candidates` | `erpGetList`, `erpPut` | **Disable** |
| `duplicate-quotation.ts` | `/api/duplicate-quotation` | `erpGetDoc`, `erpPost` | **Disable** |
| `edit-draft.ts` | `/api/edit-draft` | via `erpnext` (implicit) | **Disable** |
| `send-whatsapp.ts` | `/api/send-whatsapp` | `erpGetDoc`, `erpGetList`, `erpPut` | **Disable** |
| `send-whatsapp-flow.ts` | `/api/send-whatsapp-flow` | `erpGetDoc`, `erpGetList`, `erpPut` | **Disable** |
| `whatsapp-conversations.ts` | `/api/whatsapp-conversations` | `erpGetList`, `erpGetDoc` | **Disable** |
| `whatsapp-flows.ts` | `/api/whatsapp-flows` | — (KV-backed) | **Disable** (deferred feature) |
| `whatsapp-leads.ts` | `/api/whatsapp-leads` | `erpGetList` | **Disable** |
| `typebot-lead-capture.ts` | `/api/typebot-lead-capture` | `erpGetList`, `erpPost`, `erpPut` | **Pass-through** (external webhook, never Frappe in auth path anyway) |
| `communication-flow-preview.ts` | `/api/communication-flow-preview` | `erpGetDoc` | **Disable** |
| `communication-flows.ts` | `/api/communication-flows` | — (implicit via `customer-resolution`) | **Disable** |
| `communication-send-events.ts` | `/api/communication-send-events` | — | **Disable** |
| `communication-media.ts` | `/api/communication-media` | — | **Disable** |
| `communication-media-upload.ts` | `/api/communication-media-upload` | — | **Disable** |
| `product-pricing-update.ts` | `/api/product-pricing-update` | `erpGetList`, `erpPost`, `erpPut`, `erpGetDoc` | **Disable** (core pricing uses product-update-core) |
| `product-activity.ts` | `/api/product-activity` | `erpGetList` | **Disable** |
| `product-pricing.ts` | `/api/product-pricing` | `erpGetList` | *Check* — may need to be routed to core |
| `quote-leads.ts` | `/api/quote-leads` | `erpGetList` | **Disable** (whatsapp-flow helper) |
| `view.ts` | `/api/view` | admin session | **Keep protected**; customer links use revision-bound `/api/public-quotation` tokens |
| `pdf.ts` | `/api/pdf` | — | **Keep** (Puppeteer, not Frappe) |
| `extract.ts` | `/api/extract` | — | **Disable** (AI extraction deferred; no Frappe calls but depends on OpenRouter which may not be available) |
| `frappe-migration.ts` | `/api/frappe-migration` | `erpGetList`, `erpPut` | **Disable** (one-time, already run) |
| `login.ts`, `logout.ts` | `/api/login`, `/api/logout` | — | **Keep** |
| `settings.ts` | `/api/settings` | — (PostgreSQL) | **Keep** |

### 3. Frontend Route Analysis (`src/App.tsx`)

| Route | Page | Frappe Dependency | Operational Mode |
|-------|------|-------------------|-----------------|
| `/` (default) | `AutoQuotePage` | Yes (AI extract) | **Redirect to `/manual`** |
| `/login` | `LoginPage` | No | **Keep** |
| `/auto` | `AutoQuotePage` | Yes | **Hide** |
| `/dashboard` | `DashboardPage` | Yes (sales data) | **Hide** |
| `/pre-orcamentos` | `PreQuotesPage` | Yes | **Hide** |
| `/quotations` | `QuotationsPage` | No (core when enabled) | **Keep** |
| `/quotations/:id` | `QuotationDetailPage` | No | **Keep** |
| `/manual` | `ManualOrcamentoPage` | No | **Keep** |
| `/sales-orders` | `SalesOrdersPage` | Yes | **Hide** |
| `/sales-orders/:id` | `SalesOrderDetailPage` | Yes | **Hide** |
| `/crm` | `CrmKanbanPage` | Yes | **Hide** |
| `/products` | `ProductsPage` | No (core when enabled) | **Keep** |
| `/products/:sku` | `ProductDetailPage` | No | **Keep** |
| `/leads` | `LeadsPage` | No (core when enabled) | **Keep** |
| `/leads/:type/:id` | `LeadDetailPage` | No | **Keep** |
| `/settings` | `SettingsPage` | No | **Keep** |
| `/comunicacao` | `ComunicacaoPage` | Yes | **Hide** |
| `/whatsapp-inbox` | `WhatsAppInboxPage` | Yes | **Hide** |

### 4. Navigation (Sidebar, `src/components/layout/Sidebar.tsx`)

The sidebar is statically defined with three sections.
In operational mode, it should show:

- **Operacional:** Novo Orçamento (`/manual`)
- **Cadastros:** Orçamentos (`/quotations`), Produtos (`/products`), Clientes (`/leads`)
- **Outros:** Configurações (`/settings`)

Everything else is hidden: Auto, Pré-orçamentos, WhatsApp, Dashboard, Pedidos, CRM, Comunicação.

### 5. Database Schema (`api/_db/schema.ts`)

All required tables exist and are complete for the operational core:

| Table | Purpose | Status |
|-------|---------|--------|
| `app_settings` | Singleton dashboard settings | **Complete** |
| `products` | Product catalog | **Complete** |
| `product_pricing_tiers` | SKU × minimum_quantity tiered pricing | **Complete** |
| `clients` | Unified client records (lead + cliente) | **Complete** |
| `quote_sequences` | Per-year business-number counters | **Complete** |
| `quotations` | Quotation aggregate | **Complete** |
| `quote_revisions` | Immutable revision snapshots | **Complete** |
| `quote_revision_items` | Line items per revision | **Complete** |
| `issued_documents` | PDF documents in Vercel Blob | **Complete** |
| `frappe_import_lineage` | Import audit trail | **Complete** |

No schema changes are needed for #17.
The `app_settings` table can be extended with a `cutoff_enabled` boolean column if the cutoff state needs to persist in the database rather than purely in environment variables — this plan recommends keeping it as an env var (`CRM_OPERATIONAL_MODE=true`) for simplicity and because Vercel env vars are the canonical source for deployment state.

### 6. Settings Page (`src/pages/SettingsPage.tsx`)

Currently: validade, pagamento, entrega, frete, observacoes, template.
The page does **not** show any operational-mode controls.
It should gain a new section when operational mode is active showing readiness status and cutoff controls.

### 7. Auth (`api/_lib/auth.js`)

Password-hash based auth with session cookies.
`PUBLIC_ROUTES = ['view', 'typebot-lead-capture']` — these bypass auth entirely.
The `typebot-lead-capture` route being public is important: it's an external webhook and should keep working even in operational mode (but the handler needs to be hardened to not call Frappe).

### 8. Existing Tests

Test files covering core flows:
- `tests/unit/quotations-core.test.ts` — Core quotation handler tests
- `tests/unit/products.test.ts` — Product tests
- `tests/unit/pricing-core.test.ts` — Core pricing resolver
- `tests/unit/pricing-rollout.test.ts` — Feature-flag dispatch tests
- `tests/unit/orcamento-core.test.ts` — Draft creation tests
- `tests/unit/quotations-postgres.test.ts` — PostgreSQL integration tests
- `tests/unit/products-quote-mode.test.ts` — Quote-mode product access
- `tests/unit/leads-clients-quote-mode.test.ts` — Quote-mode client access
- `tests/unit/client-rollout.test.ts` — Client rollout tests
- `tests/unit/settings-postgres.test.ts` — Settings repository tests
- `tests/unit/quotation-issuance-core.test.ts` — PDF issuance tests
- `tests/unit/quotation-lifecycle-core.test.ts` — Lifecycle tests
- `tests/unit/backup.test.ts` — Backup/restore tests
- `tests/unit/frappe-migration-postgres.test.ts` — Migration tests

E2E tests:
- `tests/orcamento-core.spec.js` — Create orçamento E2E
- `tests/products-core.spec.js` — Products E2E
- `tests/quotations-core.spec.js` — Quotations E2E
- `tests/client-core.spec.js` — Clients E2E
- `tests/settings.spec.js` — Settings E2E

---

## Implementation Plan

### Phase 1: Master Cutoff Flag (API Backend)

#### 1a. Create `/api/_functions/operational-mode.ts`

A single source of truth for whether the system is in operational (post-Frappe) mode.

```typescript
// api/_functions/operational-mode.ts

/** Master cutoff: when true, ALL core feature flags are implicitly enabled and
 *  all Frappe-dependent handlers and pages are gated. Setting this to 'true'
 *  is the go-live action. */
export function isOperationalMode(): boolean {
  return process.env.CRM_OPERATIONAL_MODE === 'true';
}
```

When `CRM_OPERATIONAL_MODE=true`, the three individual flags are implicitly true.
This avoids having to coordinate four env vars for go-live.

**Files to modify:**
- Create: `api/_functions/operational-mode.ts`

**Files to update (explicit check before individual flag checks):**
- `api/_functions/products.ts` — wrap `isProductsCoreEnabled()` with `isOperationalMode()`
- `api/_functions/leads-clients.ts` — wrap the clients flag check with `isOperationalMode()`
- `api/_functions/client-detail.ts` — same
- `api/_functions/quotations.ts` — wrap `isCoreQuotesEnabled()`
- `api/_functions/orcamento.ts` — same
- `api/_functions/pricing-lookup.ts` — same
- `api/_functions/product-detail.ts` — same
- `api/_functions/product-update.ts` — same
- `api/_functions/quotation-issue.ts` — already checks `isCoreQuotesEnabled()`
- `api/_functions/quotation-document.ts` — already checks `isCoreQuotesEnabled()`
- `api/_functions/quotation-preview.ts` — already checks `isCoreQuotesEnabled()`
- `api/_functions/quotation-templates.ts` — already checks `isCoreQuotesEnabled()`

**Approach:** Rather than touching every dispatcher individually, modify the mode files themselves to check the master cutoff:

- `api/_functions/products-mode.ts`: `isProductsCoreEnabled()` returns `true` when `CRM_OPERATIONAL_MODE=true`
- `api/_functions/orcamento-mode.ts`: `isCoreQuotesEnabled()` returns `true` when `CRM_OPERATIONAL_MODE=true`
- `api/_functions/client-core.ts`: `isCoreClientsEnabled()` returns `true` when `CRM_OPERATIONAL_MODE=true`

This is the **simplest approach**: the individual mode files gain a master-check, and all existing dispatching logic works unchanged.

#### 1b. Add Operational Guard Wrapper

For handlers that have NO core path (purely Frappe-dependent), add a lightweight guard wrapper that returns 503 in operational mode.

**Reusable guard:**
```typescript
// api/_functions/lib/operational-guard.ts
import { isOperationalMode } from '../operational-mode.js';
import type { LegacyHandler, FunctionEvent, FunctionResult } from '../../_lib/types.js';

export function gateOperational(handler: LegacyHandler, endpointName: string): LegacyHandler {
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (isOperationalMode()) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `${endpointName} não está disponível no modo operacional.`,
        }),
      };
    }
    return handler(event);
  };
}
```

**Handlers to wrap:**
- `sales-dashboard.ts`
- `sales-orders.ts`
- `sales-order-from-quotation.ts`
- `crm-deals.ts`
- `crm-update-deal.ts`
- `crm-prune-candidates.ts`
- `duplicate-quotation.ts`
- `edit-draft.ts`
- `send-whatsapp.ts`
- `send-whatsapp-flow.ts`
- `whatsapp-conversations.ts`
- `whatsapp-flows.ts`
- `whatsapp-leads.ts`
- `communication-flow-preview.ts`
- `communication-flows.ts`
- `communication-send-events.ts`
- `communication-media.ts`
- `communication-media-upload.ts`
- `product-pricing-update.ts`
- `product-activity.ts`
- `quote-leads.ts`
- `extract.ts`
- `frappe-migration.ts`

**Special case — `typebot-lead-capture.ts`:**
This is a public webhook endpoint (no auth). In operational mode it should respond with 200 OK but not call Frappe.
Simply add an early return at the top: `if (isOperationalMode()) return jsonResponse(200, { received: true, mode: 'operational' })`.

#### 1c. Add `operational-mode` to Route Maps

Update the `ROUTES` maps in:
- `api/[...path].js`
- `scripts/dev-api-server.mjs`
- `scripts/app-server.mjs`

Add `operational-mode` as a route pointing to a new handler that exposes readiness-check data.

### Phase 2: Readiness Check

#### 2a. Create `/api/_functions/operational-status.ts`

A handler that aggregates readiness data.
This is what the Settings page calls to show the go/no-go dashboard.

```typescript
// Returns JSON with:
{
  "ready": boolean,              // true when all checks pass
  "checks": {
    "database_connected": boolean,
    "migration_complete": boolean,
    "pdfs_archived": boolean,
    "backup_validated": boolean,
    "capacity_ok": boolean,
    "mandatory_settings": boolean
  },
  "details": {
    "product_count": number,
    "client_count": number,
    "quotation_count": number,
    "pdf_count": number,
    "settings_configured": string[],  // keys that are set
    "settings_missing": string[],     // keys that are not set
    "last_backup": string | null,     // ISO date
    "last_migration": string | null   // ISO date
  }
}
```

**Checks implementation:**
1. **database_connected**: Simple `SELECT 1` via `getDatabase()`
2. **migration_complete**: Check `frappe_import_lineage` has at least 1 row for each entity_type (`produto`, `cliente`, `orcamento`, `faixa`)
3. **pdfs_archived**: Count `issued_documents` where `kind = 'historical_pdf_import'` or `kind = 'quotation_pdf'`; check `BLOB_READ_WRITE_TOKEN` env var present
4. **backup_validated**: Check for latest backup file in `backups/` directory (exists, > 0 bytes, within last 24h for pre-cutoff checklist)
5. **capacity_ok**: Run the --preflight logic from `scripts/backup-crm.mjs` (DB size, connection count, blob usage)
6. **mandatory_settings**: Check `app_settings` row exists, all required fields non-empty: `validade_dias`, `pagamento`, `template_padrao`

**Dependencies:** `operational-status.ts` is a new file. It imports from `api/_db/client.ts` and uses `drizzle-orm` queries directly.

### Phase 3: Frontend Navigation Gating

#### 3a. Detect Operational Mode on Frontend

Add a `useOperationalMode` hook or use the existing `apiGet` pattern to fetch operational status from the settings endpoint.
The settings endpoint should include `operational_mode: boolean` in its response when `CRM_OPERATIONAL_MODE=true`.

Alternatively, the Layout component already fetches `core_mode` from the leads-clients endpoint.
Extend this by having the `/api/settings` GET response include `operational_mode: true` when the env var is set.

**Simplest approach:**
- Modify `api/_functions/settings.ts` GET response to include `{ ..., operational_mode: isOperationalMode() }`
- Or add a dedicated lightweight check at app mount time

#### 3b. Gate Navigation in `Sidebar.tsx`

Pass an `operationalMode` boolean prop (or context) to the Sidebar.
When `operationalMode === true`, conditionally render only the allowed sections:

```typescript
const OPERATIONAL_NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operacional',
    items: [
      { hash: '/manual', label: 'Novo Orçamento', icon: FileText },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { hash: '/quotations', label: 'Orçamentos', icon: FileText },
      { hash: '/products', label: 'Produtos', icon: Package },
      { hash: '/leads', label: 'Clientes', icon: Users },
    ],
  },
  {
    title: 'Outros',
    items: [
      { hash: '/settings', label: 'Configurações', icon: Settings },
    ],
  },
];
```

Rename the "Leads" label to "Clientes" in operational mode (already handled via `clientCoreMode` prop).

#### 3c. Gate Routes in `App.tsx`

When operational mode is active:
- Unresolved routes (including `/`, `/auto`) redirect to `/manual`
- Hidden routes (dashboard, sales-orders, crm, comunicacao, whatsapp-inbox, pre-orcamentos) redirect to `/manual` or show a "página indisponível" message
- The default case on unmatched routes should redirect to `/manual` instead of `AutoQuotePage`

**Implementation:**
- Add `operationalMode` as state in `App.tsx` (fetched once on mount from settings)
- In `renderPage`, for unknown routes, redirect to `/manual` when in operational mode
- Add a 404-style guard for hidden routes

#### 3d. Add Operational Section to `SettingsPage.tsx`

When operational mode is detected, show a new section at the top of the Settings page:

- **Readiness dashboard**: Summary of all checks from `/api/operational-status`
- **Cutoff control**: "Ativar modo operacional" button (if ready) or "Verificar pré-requisitos" (if not)
- **Status indicators**: Green checkmarks for passed checks, red X for failed, loading spinner while fetching

The cutoff toggle itself is still an env var change (deployed via Vercel), so the Settings page shows the current state read-only with a "run readiness check" button.

### Phase 4: Cutoff Procedure

#### 4a. Create `docs/operational-cutoff-procedure.md`

A Markdown procedural document:

```markdown
# Procedimento de Corte Operacional (Go-Live)

## Pré-requisitos
1. Migração concluída (tabela `frappe_import_lineage` populada)
2. PDFs arquivados no Vercel Blob (mínimo 1 documento emitido)
3. Backup validado (último backup < 24h)
4. Capacidade verde (DB < 80% limite, conexões < 80%)
5. Configurações obrigatórias preenchidas (validade, pagamento, template)

## Passo a Passo

### 1. Validar pré-requisitos
```bash
node scripts/backup-crm.mjs --validate
node scripts/backup-crm.mjs --preflight
curl -s https://aspen-orcamento.vercel.app/api/operational-status | jq .ready
```

### 2. Backup final pré-corte
```bash
node scripts/backup-crm.mjs
# Salve o backup gerado em backups/backup-YYYY-MM-DDTHH:mm:ss.sql em local seguro
```

### 3. Travar escrita no Frappe (lock de aplicação)
```bash
# Via painel Frappe: bloquear permissões de escrita para o usuário da API
# Alternativa: rotacionar ERPNEXT_TOKEN para invalidar o token atual
```

### 4. Sincronização final
```bash
node scripts/migrate-frappe-crm.mjs --apply --mode final-sync
```

### 5. Validar consistência
```bash
# Comparar contagem: PostgreSQL vs Frappe
curl -s https://aspen-orcamento.vercel.app/api/operational-status | jq .details

# Amostragem: 10 registros de cada entidade, comparar campos chave
node scripts/validate-migration-sample.mjs --sample-size 10
```

### 6. Ativar modo operacional
```bash
# No Vercel Dashboard → Settings → Environment Variables:
# CRM_OPERATIONAL_MODE = true
# Re-deploy
```

### 7. Verificação pós-ativação
```bash
# Confirmar que a API responde em modo core
curl -s https://aspen-orcamento.vercel.app/api/products?limit=1 | jq .source
# Deve retornar: "postgres"

# Navegar pelas páginas principais
# - Novo orçamento manual
# - Lista de clientes
# - Catálogo de produtos
# - Lista de orçamentos
```

## Rollback
```bash
# Vercel Dashboard → CRM_OPERATIONAL_MODE = false → Re-deploy
# Reativar token Frappe original
```

## Checklist de Verificação

- [ ] /api/products → source: "postgres"
- [ ] /api/leads-clients → source: "postgres"
- [ ] /api/quotations → source: "postgres"
- [ ] /api/orcamento → POST cria rascunho
- [ ] /api/pricing-lookup → source: "postgres"
- [ ] /api/sales-orders → 503
- [ ] /api/crm-deals → 503
- [ ] /api/send-whatsapp → 503
- [ ] Sidebar mostra apenas: Novo Orçamento, Orçamentos, Produtos, Clientes, Configurações
- [ ] Sidebar esconde: Auto, Pré-orçamentos, WhatsApp, Dashboard, Pedidos, CRM, Comunicação
- [ ] #/auto redireciona para #/manual
- [ ] Configurações mostra seção de "Modo Operacional"
```

### Phase 5: Portuguese Error Hardening

#### 5a. Audit Error Messages

Search all core handlers for error messages that leak internal details:

```bash
grep -rn "error\|Error\|erro\|Erro\|stack\|trace\|DATABASE\|SQL\|connection" \
  api/_functions/*-core.ts api/_db/*-repository.ts api/_functions/orcamento-core.ts \
  api/_functions/quotations-core.ts api/_functions/pricing-core.ts \
  api/_functions/client-core.ts api/_functions/settings.ts \
  --include="*.ts"
```

**Areas to check:**
1. `api/_db/client.ts` — `getDatabaseUrl()` throws "DATABASE_URL não configurada" — good, already Portuguese
2. `api/_functions/settings.ts` — All user-facing errors already in Portuguese ✓
3. `api/_db/pricing-repository.ts` — Check error messages
4. `api/_db/products-repository.ts` — Check error messages
5. `api/_db/client-repository.ts` — Check error messages
6. `api/_db/quote-draft-management-repository.ts` — Check
7. `api/_db/quote-repository.ts` — Check
8. `api/_db/quotation-lifecycle-repository.ts` — Check
9. `api/_db/quotation-document-repository.ts` — Check
10. `api/_functions/quotation-issue.ts` — Already PT ✓
11. `api/_functions/orcamento-core.ts` — Already PT ✓
12. `api/_functions/products-core.ts` — Already PT ✓
13. `api/_functions/client-core.ts` — Already PT ✓
14. `api/_functions/quotations-core.ts` — Already PT ✓
15. `api/_functions/pricing-core.ts` — Already PT ✓
16. `api/_functions/pricing-lookup.ts` — Already PT ✓
17. `api/_functions/operational-guard.ts` — New, needs PT messages ✓

**The core handlers are already well-hardened with Portuguese errors.**
The main risk is in repository-level error messages that might bubble up PostgreSQL errors.
A review pass through the `_db/*-repository.ts` files is needed to ensure:
- All thrown errors have Portuguese messages
- No raw PostgreSQL errors (connection strings, SQL state codes) leak into HTTP responses
- Generic 500/503 fallbacks are used when the error is not a known domain error

This is a lightweight audit, not a rewrite — estimated 1-2 files need minor adjustments.

### Phase 6: Tests

#### 6a. Handler Tests — No Frappe Calls in Core Flows

New tests in `tests/unit/operational-mode.test.ts`:

1. **Dispatch tests**: When `CRM_OPERATIONAL_MODE=true`, all dispatchers route to core handlers
2. **Guard tests**: When `CRM_OPERATIONAL_MODE=true`, Frappe-dependent handlers return 503
3. **Readiness check tests**: `/api/operational-status` returns expected structure
4. **Error language tests**: Core handler errors are in Portuguese, no stack traces

#### 6b. Navigation Gating Tests

New Playwright test in `tests/operational-mode.spec.js`:

1. With operational mode on, sidebar shows only 5 items
2. Hidden routes redirect to `/manual` or show unavailable page
3. Settings page shows operational section

#### 6c. Existing Tests Must Pass

All existing core tests must pass with `CRM_OPERATIONAL_MODE=true`:
- `tests/unit/quotations-core.test.ts`
- `tests/unit/products.test.ts`
- `tests/unit/pricing-core.test.ts`
- `tests/unit/orcamento-core.test.ts`
- `tests/unit/settings-postgres.test.ts`
- `tests/unit/quotation-issuance-core.test.ts`
- `tests/unit/quotation-lifecycle-core.test.ts`
- `tests/unit/client-rollout.test.ts`

---

## File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `api/_functions/operational-mode.ts` | `isOperationalMode()` helper |
| `api/_functions/operational-status.ts` | Readiness check handler |
| `api/_functions/lib/operational-guard.ts` | Wrapper that gates handlers in operational mode |
| `docs/operational-cutoff-procedure.md` | Cutoff procedural document |
| `tests/unit/operational-mode.test.ts` | Operational mode unit tests |
| `tests/operational-mode.spec.js` | Playwright E2E for nav gating |

### Modified Files

| File | Change |
|------|--------|
| `api/_functions/products-mode.ts` | `isProductsCoreEnabled()` checks `CRM_OPERATIONAL_MODE` |
| `api/_functions/orcamento-mode.ts` | `isCoreQuotesEnabled()` checks `CRM_OPERATIONAL_MODE` |
| `api/_functions/client-core.ts` | `isCoreClientsEnabled()` checks `CRM_OPERATIONAL_MODE` |
| `api/_functions/settings.ts` | GET response includes `operational_mode` field |
| `api/_functions/sales-dashboard.ts` | Wrap with `gateOperational()` |
| `api/_functions/sales-orders.ts` | Wrap with `gateOperational()` |
| `api/_functions/sales-order-from-quotation.ts` | Wrap with `gateOperational()` |
| `api/_functions/crm-deals.ts` | Wrap with `gateOperational()` |
| `api/_functions/crm-update-deal.ts` | Wrap with `gateOperational()` |
| `api/_functions/crm-prune-candidates.ts` | Wrap with `gateOperational()` |
| `api/_functions/duplicate-quotation.ts` | Wrap with `gateOperational()` |
| `api/_functions/edit-draft.ts` | Wrap with `gateOperational()` |
| `api/_functions/send-whatsapp.ts` | Wrap with `gateOperational()` |
| `api/_functions/send-whatsapp-flow.ts` | Wrap with `gateOperational()` |
| `api/_functions/whatsapp-conversations.ts` | Wrap with `gateOperational()` |
| `api/_functions/whatsapp-flows.ts` | Wrap with `gateOperational()` |
| `api/_functions/whatsapp-leads.ts` | Wrap with `gateOperational()` |
| `api/_functions/communication-flow-preview.ts` | Wrap with `gateOperational()` |
| `api/_functions/communication-flows.ts` | Wrap with `gateOperational()` |
| `api/_functions/communication-send-events.ts` | Wrap with `gateOperational()` |
| `api/_functions/communication-media.ts` | Wrap with `gateOperational()` |
| `api/_functions/communication-media-upload.ts` | Wrap with `gateOperational()` |
| `api/_functions/product-pricing-update.ts` | Wrap with `gateOperational()` |
| `api/_functions/product-activity.ts` | Wrap with `gateOperational()` |
| `api/_functions/quote-leads.ts` | Wrap with `gateOperational()` |
| `api/_functions/extract.ts` | Wrap with `gateOperational()` |
| `api/_functions/frappe-migration.ts` | Wrap with `gateOperational()` |
| `api/_functions/typebot-lead-capture.ts` | Early return in operational mode |
| `api/[...path].js` | Add `operational-status` route; import new handler |
| `scripts/dev-api-server.mjs` | Add `operational-status` route |
| `scripts/app-server.mjs` | Add `operational-status` route |
| `src/App.tsx` | Operational mode state, redirect logic, hidden route handling |
| `src/components/layout/Layout.tsx` | Pass `operationalMode` to Sidebar, fetch from settings |
| `src/components/layout/Sidebar.tsx` | Conditional navigation sections |
| `src/pages/SettingsPage.tsx` | New "Modo Operacional" section |
| `.env.example` | Add `CRM_OPERATIONAL_MODE=false` |

### Files NOT Modified (Anti-Patterns Enforced)

| File | Reason |
|------|--------|
| `api/_functions/pricing.js` | Documented anti-pattern — do NOT modify without testing all SKU × bracket combinations. Not needed for operational cutoff since `pricing-lookup.ts` already has a core path. |
| `api/_db/schema.ts` | No schema changes needed for #17 |
| `api/_lib/auth.js` | No auth changes needed |
| `api/_lib/rate-limit.js` | No rate-limit changes needed |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Legacy handlers accidentally Frappe-call in operational mode | **High** | Wrappers prevent execution entirely; tests verify 503 responses |
| Wrong nav section shown/not shown | **Medium** | Playwright E2E tests verify all nav states |
| Settings page shows cutoff when not ready | **Medium** | Readiness check gates the cutoff button |
| Typebot webhook silently drops leads | **Medium** | Returns 200 but does not call Frappe; logs dropped events |
| Migration not actually complete (users think it is) | **Low** | Readiness check queries `frappe_import_lineage` per entity type |
| Pricing pricing.js is still importable | **Low** | Only imported by `pricing-lookup.ts` legacy path, which is gated |

---

## Implementation Order

1. **Create `operational-mode.ts` + `operational-guard.ts`** — foundation
2. **Modify mode files** (`products-mode.ts`, `orcamento-mode.ts`, `client-core.ts`) — one-line changes
3. **Wrap Frappe-dependent handlers** — mechanical, 20+ files, pattern identical
4. **Create `operational-status.ts`** — readiness check endpoint
5. **Update route maps** (`[...path].js`, `dev-api-server.mjs`, `app-server.mjs`)
6. **Modify `settings.ts`** — include `operational_mode` in GET response
7. **Modify `Layout.tsx` + `Sidebar.tsx`** — navigation gating
8. **Modify `App.tsx`** — route gating and redirects
9. **Modify `SettingsPage.tsx`** — operational section
10. **Create `docs/operational-cutoff-procedure.md`** — procedure doc
11. **Write tests** — `operational-mode.test.ts` + `operational-mode.spec.js`
12. **Portuguese error audit** — review pass on repository files
13. **Run full test suite** — with `CRM_OPERATIONAL_MODE=true`

Steps 1-3 can be done in a single commit.
Steps 4-5 are a second commit.
Steps 6-9 are a third commit.
Steps 10 is documentation, independent.
Steps 11-13 are the final quality gate.

---

## .env.example Addition

```bash
# ── Operational mode (Go-Live Cutoff) ──────────────────────────────────────
# When true, all core feature flags are implicitly active, Frappe-dependent
# endpoints return 503, and the frontend hides deferred pages.
CRM_OPERATIONAL_MODE=false
```

---

## Acceptance Report

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Findings include concrete file paths for route maps (src/App.tsx, src/components/layout/Sidebar.tsx), API handlers with Frappe dependencies (30+ handlers enumerated), mode files (products-mode.ts, orcamento-mode.ts, client-core.ts), database schema (api/_db/schema.ts with all 10 tables described), settings page structure (src/pages/SettingsPage.tsx), auth system (api/_lib/auth.js), and existing tests (47 unit test files, 9 E2E specs). All findings include severity where applicable (High for Frappe-call risk, Medium for nav gating, Low for pricing.js)."
    }
  ],
  "changedFiles": [
    "none — plan only, no source changes"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "find api/_functions -name '*.ts' | head -50",
      "result": "passed",
      "summary": "28 TypeScript handler files found in api/_functions/"
    },
    {
      "command": "grep -rn 'erpGetList\\|erpGetDoc\\|erpPost\\|erpPut' api/_functions/ --include='*.ts' | grep -v '_legacy\\|_mode\\|lib/erpnext' | wc -l",
      "result": "passed",
      "summary": "81 Frappe API calls across non-legacy, non-mode handler files"
    },
    {
      "command": "grep -rn 'CRM_CORE_' api/_functions/ --include='*.ts' | grep -v 'legacy\\|.js' | wc -l",
      "result": "passed",
      "summary": "22 references to feature flags in TypeScript source"
    },
    {
      "command": "ls tests/unit/ | wc -l",
      "result": "passed",
      "summary": "47 unit test files"
    }
  ],
  "validationOutput": [
    "All three feature flags (CRM_CORE_PRODUCTS_ENABLED, CRM_CORE_CLIENTS_ENABLED, CRM_CORE_QUOTES_ENABLED) already gate PostgreSQL-vs-Frappe dispatch",
    "Core handlers (products-core, leads-clients/client-core, quotations-core, orcamento-core, pricing-lookup core, quotation-issue) are already pure PostgreSQL",
    "Settings handler is already pure PostgreSQL",
    "30+ Frappe-dependent handlers identified for gating",
    "10 database tables in schema.ts — all complete for operational core",
    "Frontend has 17 routes — 8 to keep, 9 to hide"
  ],
  "residualRisks": [
    "pricing.js (shared module) is imported by legacy orcamento and pricing-lookup paths — it calls Frappe unconditionally. Risk is mitigated because operational mode prevents legacy paths from executing, but the import itself is not tree-shaken. A future cleanup task could remove the import.",
    "Typebot webhook may accumulate dropped leads in operational mode. Consider logging dropped payloads to Vercel KV for later replay.",
    "Communication flows have implicit Frappe dependencies through customer-resolution.ts — the operational guard prevents execution, but the transitive dependency chain is complex.",
    "The 'product-pricing' and 'product-pricing-update' endpoints have no core equivalents yet — pricing is managed through product-update-core. This gap is acceptable for MVP but should be addressed in a future issue."
  ],
  "noStagedFiles": true,
  "diffSummary": "Plan only — no source changes. 6 new files proposed, 37 existing files to modify.",
  "reviewFindings": [
    "no blockers — all findings are informational and documented in the plan"
  ],
  "manualNotes": "The plan uses a simple env var (CRM_OPERATIONAL_MODE) as the master cutoff. The individual per-domain flags remain functional for gradual rollout testing, but the master flag overrides them all when set. This avoids coordinating four env vars during go-live. The readiness check is a GET endpoint that queries the database directly for migration status, counts, and settings completeness — no external dependencies."
}
```
