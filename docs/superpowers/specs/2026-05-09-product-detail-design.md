# Product Detail Page — Spec

**Date:** 2026-05-09
**Status:** Approved
**Project:** aspen-orcamento

## Overview

Expand the Products page so users can click a product row, see full details, view pricing by quantity bracket, and edit rates. The detail page has its own hash route (`#/products/:sku`), allowing direct linking and browser back-button navigation.

## Architecture

### New routes

| Method | Route | Function file | Purpose |
|--------|-------|---------------|---------|
| `GET` | `/api/products/:sku` | `api/_functions/product-detail.js` | Full product info + all 5 bracket prices |
| `PUT` | `/api/products/:sku/pricing` | `api/_functions/product-pricing-update.js` | Update rate for one or more bracket(s) |

### New frontend route

| Hash | Component | Purpose |
|------|-----------|---------|
| `#/products` | `ProductsPage` (existing) | Product list with search + pagination |
| `#/products/:sku` | `ProductDetailPage` (new) | Full product detail + pricing table |

### Data flow

```
ProductsPage (list)
  │  click row → navigate('#/products/' + sku)
  ▼
ProductDetailPage
  │  useEffect → GET /api/products/:sku
  │  Renders: card (image + metadata) + pricing table + description
  │  User clicks "Editar preços" → inputs become editable
  │  User clicks "Salvar" → PUT /api/products/:sku/pricing
  │  Backend updates ERPNext Pricing Rules
  ▼
Toast: "Preços atualizados" / error per bracket
```

### Pricing resolution (backend)

For a given SKU, query 5 Pricing Rules by title: `{SKU}-30`, `{SKU}-100`, `{SKU}-300`, `{SKU}-500`, `{SKU}-1000`. Return the `rate` for each. Rules that don't exist return `null` (bracket not yet configured).

### Pricing update (backend)

For each `{ bracket, rate }` in the request body:
1. Look up Pricing Rule with title `{SKU}-{bracket}`
2. If found: `erpPut('Pricing Rule', rule.name, { rate })`
3. If not found: `erpPost('Pricing Rule', { title: '{SKU}-{bracket}', rate, ... })` — create new rule
4. Return per-bracket success/failure

## Layout

### Desktop (two columns)

```
┌─────────────────────────────────────────────────────┐
│  ← Voltar para produtos                             │
├──────────────────────┬──────────────────────────────┤
│                      │  SKU: LNC-SED-70              │
│   [FOTO DO PRODUTO]  │  Lenço Sublimado 70x70       │
│                      │  Categoria: Lenços            │
│   (placeholder if    │  Unidade: und  ·  Ativo ✓     │
│    no image)         │  Marca: Aspen                 │
│                      │                              │
│                      │  ── Preços ──                │
│                      │  ┌────────┬──────────┬─────┐ │
│                      │  │ Faixa  │  Preço   │     │ │
│                      │  │  30    │ R$ 8,50  │     │ │
│                      │  │  100   │ R$ 7,20  │     │ │
│                      │  │  300   │ R$ 6,10  │     │ │
│                      │  │  500   │ R$ 5,40  │     │ │
│                      │  │ 1000   │ R$ 4,80  │     │ │
│                      │  └────────┴──────────┴─────┘ │
│                      │  [Editar preços]             │
│                      │                              │
│                      │  ── Descrição ──             │
│                      │  (HTML formatted text)        │
├──────────────────────┴──────────────────────────────┤
│  Última modificação: 09/05/2026                     │
└─────────────────────────────────────────────────────┘
```

### Edit mode

After clicking "Editar preços":

```
│  ── Preços ──                                       │
│  ┌────────┬──────────────┬─────┐                    │
│  │ Faixa  │  Preço       │     │                    │
│  │  30    │ [R$ 8,50   ] │     │ ← editable input   │
│  │  100   │ [R$ 7,20   ] │     │                    │
│  │  300   │ [R$ 6,10   ] │     │                    │
│  │  500   │ [R$ 5,40   ] │     │                    │
│  │ 1000   │ [R$ 4,80   ] │     │                    │
│  └────────┴──────────────┴─────┘                    │
│  [Salvar]  [Cancelar]                               │
```

- **Salvar** → PUT, toast on success, exit edit mode
- **Cancelar** → revert to original values, exit edit mode
- Input type: number, step 0.01, BRL-formatted display (R$ X.XXX,XX)

### Mobile (stacked)

- Image on top, centered
- Metadata + pricing below
- Same edit mode behavior
- Back button at top

## Components

### New: `ProductDetailPage.jsx`

State:
- `product` — full product object (from GET /api/products/:sku)
- `loading` — boolean
- `error` — string | null
- `editing` — boolean
- `editedRates` — Map<bracket, rate> (only while editing)
- `saving` — boolean (loading state for PUT)

Sub-components (inline, no separate files unless complexity warrants):
- Breadcrumb bar: `← Voltar para produtos` (navigate back)
- Product hero: image (or placeholder), SKU, name, metadata badges
- Pricing table: read-only or editable based on `editing` state
- Description section: renders HTML (dangerouslySetInnerHTML, sanitized)
- Footer: last modified date

### Modified: `ProductsPage.jsx`

- Add `onClick` to each `<TableRow>` → `navigate('#/products/' + p.sku)`
- Add `cursor-pointer hover:bg-muted/50` classes to rows
- Import `useHashRoute` for navigation

### Modified: `App.jsx`

- Add route: `#/products/:sku` → `<ProductDetailPage />`
- `useHashRoute` already supports parameter extraction (pattern used by `#/quotations/:id`)

### New: `api/_functions/product-detail.js`

GET handler:
1. Extract SKU from path
2. Fetch Item from ERPNext by `item_code`
3. Parallel: fetch 5 Pricing Rules by title
4. Return unified JSON

### New: `api/_functions/product-pricing-update.js`

PUT handler:
1. Extract SKU from path
2. For each `{ bracket, rate }` in body:
   - Look up Pricing Rule `{SKU}-{bracket}`
   - Update or create
3. Return per-bracket results

### Modified: `api/[...path].js`

- Add import for `productDetailHandler` and `productPricingUpdateHandler`
- Add route blocks for `GET /api/products/:sku` and `PUT /api/products/:sku/pricing`

## Error handling

- Product not found → 404, "Produto não encontrado"
- ERPNext timeout → 504, "ERPNext indisponível"
- Pricing Rule update fails → per-bracket error in response, show which brackets failed
- Network error in frontend → error state with retry button

## Testing

- Playwright E2E test: navigate to products list → click row → verify detail page renders → verify pricing table shows 5 brackets → click "Editar preços" → change a value → save → verify success toast → reload page → verify value persisted
- Backend unit: `node --check` on both new function files
- Responsive: verify mobile layout stacks correctly

## Implementation order

1. Backend: `product-detail.js` + `product-pricing-update.js`
2. Backend: register routes in `api/[...path].js`
3. Frontend: `ProductDetailPage.jsx` component
4. Frontend: wire route in `App.jsx`
5. Frontend: add row click in `ProductsPage.jsx`
6. Test with Playwright
7. Deploy to VPS
