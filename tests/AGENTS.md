# AGENTS.md — Aspen Tests

## OVERVIEW

Two test stacks: `node:test` unit tests under `tests/unit/` and Playwright e2e specs under `tests/`.

## STRUCTURE
```
tests/
├── orcamento.spec.js                  # Playwright: /auto + /leads fluxos
└── unit/
    ├── client-metadata.test.js        # metadados de lead/endereço
    ├── extract-rules.test.js          # regras do prompt de extração
    ├── pricing.test.js                # motor de precificação
    ├── typebot-lead-capture.test.js   # webhook Typebot → ERPNext
    ├── whatsapp-flows.test.js         # templates e normalização de fluxos
    └── whatsapp-leads.test.js         # helpers de leads do WhatsApp
```

## WHERE TO LOOK
| Task | Location |
|---|---|
| Add API handler unit test | `tests/unit/<handler>.test.js` |
| Add frontend page e2e test | `tests/<feature>.spec.js` |
| Mock ERPNext/Typebot in unit test | `mockFetch()` overrideando `globalThis.fetch` |
| Mock API routes in e2e | `page.route('**/api/...', ...)` |
| Run unit tests | `npm run test:unit` |
| Run e2e tests | `npm run test:e2e` |

## CONVENTIONS
- Unit tests import production code with relative paths from project root (`../../api/_functions/...`, `../../src/lib/...`).
- Use `node:assert/strict` (`assert.equal`, `assert.deepEqual`, `assert.rejects`).
- E2E specs use hash-based routes: `/#/auto`, `/#/leads`, `/#/leads/lead/LEAD-001`.
- Playwright auto-starts Vite on port 5173 (`playwright.config.js`); do not start it manually.
- Restore mocked globals (`fetch`, `process.env`) in `afterEach`.

## ANTI-PATTERNS / NOTES
- NÃO importar handlers de `api/[...path].js` nos testes unitários; importar o módulo em `api/_functions/*.js` diretamente.
- NÃO chamar ERPNext/Frappe de verdade nos testes; sempre mockar `fetch`.
- NÃO adicionar testes Playwright que dependam de respostas reais da API — mockar via `page.route`.
- Cuidado ao testar `pricing.js`: `getRate` dispara múltiplas chamadas ERPNext em sequência; o mock deve cobrir a cadeia de fallback (tiered → flat → Item Price).
- `process.env.ERPNEXT_TOKEN` precisa estar setado no `beforeEach` de testes que importam `api/_functions/lib/erpnext.js`, pois o módulo lê a variável no carregamento.
