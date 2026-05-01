# netlify/functions/ Knowledge Base

**Generated:** 2026-05-01 15:52:15
**Commit:** 9d8565d
**Branch:** master

## OVERVIEW
Netlify serverless function handlers for the quotation pipeline. JavaScript ESM, esbuild-bundled via `netlify.toml`.

## STRUCTURE
```
functions/
├── extract.js        # POST /api/extract — NL extraction via OpenRouter
├── orcamento.js      # POST /api/orcamento — ERPNext Quotation + CRM Deal
├── edit-draft.js     # POST /api/edit-draft — NL draft editing via OpenRouter
├── view.js           # GET /api/view — renders quotation HTML for print
└── pricing.js        # Shared lib — getBracket, getRate, getUrgentRate (no handler export)
```
⚠️ `send-email.js` source is MISSING (only Zone.Identifier artifact remains).

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Extract orders from text/image | `extract.js` → `handler` | OpenRouter call, returns structured orders |
| Create quotation + CRM Deal | `orcamento.js` → `handler` | Imports `pricing.js`; upserts Customer/Contact/Deal |
| Edit draft via natural language | `edit-draft.js` → `handler` | Mirrors extract.js error handling pattern |
| Render quotation HTML | `view.js` → `handler` | GET only; returns `text/html` |
| Resolve item pricing | `pricing.js` → `getRate(sku, qty, urgent)` | See root AGENTS.md for full pricing resolution order |
| Quantity bracket | `pricing.js` → `getBracket(qty)` | Returns '30', '100', '300', '500', '1000' |
| Urgent surcharge | `pricing.js` → `getUrgentRate(rate)` | rate × 1.3 |

## CONVENTIONS

### Handler Skeleton
```js
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }
  try {
    // ... core logic ...
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, ... }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[functionName]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
    };
  }
}
```
Exception: `view.js` — GET handler, skips method guard, returns `text/html`.

### Error Handling
- **Prefer** `createHttpError(statusCode, publicMsg, logMsg)` from `extract.js`/`edit-draft.js`
- Catch reads `err?.statusCode` and `err?.logMessage || err?.message || err`
- User-facing messages in Brazilian Portuguese
- Never expose raw ERPNext error strings to the client

### Imports
- ESM only: `import { x } from './module.js'` — explicit `.js` extension is MANDATORY
- `pricing.js` is the only shared module; other functions are self-contained
- Dynamic imports `await import(...)` used only in test/dev scripts, not in deployed functions

### Logging
- `console.error('[functionName]', message)` — tagged (extract.js, edit-draft.js style)
- `console.warn(...)` for non-fatal issues

### Naming
- Functions: camelCase (`createHttpError`, `parseJsonSafely`)
- Constants: UPPER_SNAKE_CASE (`ERPNEXT_BASE`, `SYSTEM_PROMPT`, `MAX_TEXT_LENGTH`)
- Files: kebab-case (`edit-draft.js`) or single-word (`view.js`)

### ERPNext API Pattern
```js
async function erpGet(doctype, filters) {
  const params = new URLSearchParams({ filters: JSON.stringify(filters) });
  const res = await fetch(`${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}?${params}`, { headers });
  return (await res.json()).data || [];
}
```
`erpPost(doctype, payload)` and `erpPut(doctype, name, payload)` follow the same pattern.
Defined in `orcamento.js`; `pricing.js` has a private `erpGet` variant with different signature (takes URL prefix).

### Code Organization
- Helpers first, `handler` export last
- Section comments: `// ── Section Name ──`

## ANTI-PATTERNS
- **Do not use `require()`** — ESM only
- **Do not skip `.js` extension** on imports
- **Do not suppress errors** with empty `catch(e) {}`
- **Do not expose ERPNext error messages** to HTTP responses
- **Do not modify `pricing.js`** without testing all SKU × bracket combinations
- **Do not add dependencies** to `package.json` without explicit approval
