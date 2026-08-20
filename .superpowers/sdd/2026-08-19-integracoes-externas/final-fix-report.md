# Final-review fix report

## Scope

Applied only the three accepted final-review corrections on top of `a8602df`:

- Added an explicit per-request OpenRouter referer opt-out for WhatsApp leads. Default OpenRouter behavior remains unchanged; extract and edit-draft keep the referer.
- Corrected WhatsApp-leads test environment cleanup and isolated KV as unconfigured during the handler call.
- Added `VERCEL_OIDC_TOKEN` to the Blob configuration seam, consumed it from `postgres-media`, and enforced the runtime boundary.

## Changed files

- `api/_infrastructure/integrations/blob/config.ts`
- `api/_infrastructure/integrations/openrouter/client.ts`
- `api/_modules/postgres-media.ts`
- `api/_modules/whatsapp-leads.ts`
- `scripts/check-external-integration-boundary.mjs`
- `tests/unit/blob-integration.test.ts`
- `tests/unit/external-integration-boundary.test.ts`
- `tests/unit/postgres-media.test.ts`
- `tests/unit/whatsapp-leads.test.ts`
- `.superpowers/sdd/2026-08-19-integracoes-externas/final-fix-report.md`

No migrations, dependencies, generated Vite files, provider calls, or unrelated runtime code changed.

## Commands and exit codes

| Command | Exit code | Result |
| --- | ---: | --- |
| `npm run build:api && node --test --test-concurrency=1 tests/unit/openrouter-integration.test.ts tests/unit/whatsapp-leads.test.ts tests/unit/blob-integration.test.ts tests/unit/postgres-media.test.ts tests/unit/external-integration-boundary.test.ts` | 0 | Passed; 78 tests passed. |
| `npm run verify:fast` | 0 | Passed; 772 tests, 744 passed, 28 skipped. |
| `npm run verify:full` | 0 | Passed; fast verification passed, Vite build passed, 89 Playwright tests passed. |
| `npm run check:integration-boundary` | 0 | No runtime boundary violations. |
| Initial `git add ... final-fix-report.md` | 1 | Git ignored `.superpowers`; retried with `git add -f` as required for the requested report artifact. |
| `git diff --check` | 0 | No whitespace errors. |
| `git diff --name-only -- drizzle public` | 0 | No changed paths. |
| `git commit` | 0 | Fixes committed after validation. |

## Results

- `OpenRouterRequestOptions.includeReferer` defaults to enabled and leads pass `false`; the lead regression asserts no `HTTP-Referer` even when a site URL exists. Existing client, extract, and edit-draft referer assertions pass.
- WhatsApp-leads cleanup now saves/restores `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, and `EVOLUTION_INSTANCE` under their actual names. The handler test saves, unsets, and restores `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
- `getBlobConfig()` trims and exposes `oidcToken`; `postgres-media` reads that config value and preserves existing option precedence and request behavior.
- Boundary checker and unit coverage reject direct `VERCEL_OIDC_TOKEN` reads from `api/_modules` and `api/_shared`.

## Self-review

- Reviewed the final diff for scope, error handling, secret logging, provider fallback, and behavior changes.
- Confirmed no direct `process.env.VERCEL_OIDC_TOKEN` remains under `api/_modules`.
- Confirmed no changes under `drizzle/` or tracked `public/` paths.
- Optional checker hardening for export-from imports and env destructuring remains deferred as approved.

## Concerns

None. Expected Portuguese error/log output appeared during negative-path tests; all commands exited successfully.
