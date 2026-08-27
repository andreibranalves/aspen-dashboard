# Task 7 - Transactional quotation outbox

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

## Status

COMPLETED.

## Base

Preserved `cf29980 feat: queue quotation external effects`.

## Fix round 1

- Added a transaction-aware in-memory outbox seam with rollback snapshots and injected aggregate-failure coverage.
- Replaced the previous loose failure test with a same-transaction aggregate and outbox assertion, provider failure assertion and rollback injection.
- Made lifecycle outbox insertion mandatory whenever lifecycle persistence runs.
- Updated lifecycle lock tests with a real insert seam instead of silently skipping the producer.
- Added idempotency conflict comparison across event type, provider, aggregate ID and canonical reference.
- Added exact lease-expiry reclaim, stale-owner acknowledgement and retry ownership tests.
- Added PostgreSQL quotation/revision/business-number ownership validation before `quotation.sent`.
- Added canonical payload normalization so persisted provider data cannot leak into worker context.
- Added a deployable `scripts/quotation-outbox-worker.mjs` entrypoint and `worker:quotation-outbox` package script.
- Added concrete HTTPS/HTTP webhook adapter configuration for N8N, Evolution bridge and CRM bridge.
- Adapter requests contain only event type, provider, quotation ID, revision ID, business number and idempotency key.
- Adapter tokens remain in process headers and are never serialized into outbox rows or request bodies.
- Integrated PostgreSQL references into the main frontend `send-whatsapp-flow` call.
- Sent events now validate aggregate ownership before queue insertion.
- Sent outbox enqueue failures now return an explicit provider-accepted, outbox-not-durable response with an alert ID.
- The frontend marks provider-accepted durability failures as sent and tells operators not to retry automatically.
- Legacy Frappe WhatsApp callers without PostgreSQL references keep their prior behavior.

## Changed files

- `api/_db/quotation-lifecycle-repository.ts`
- `api/_db/quotation-outbox-repository.ts`
- `api/_functions/quotation-outbox-worker.ts`
- `api/_functions/send-whatsapp-flow.ts`
- `api/_functions/send-whatsapp.ts`
- `package.json`
- `scripts/quotation-outbox-worker.mjs`
- `src/lib/communicationApi.ts`
- `src/pages/AutoQuotePage.tsx`
- `tests/unit/quotation-outbox.test.ts`
- `tests/unit/quotation-template-migration.test.ts`
- `tests/unit/quotations-core.test.ts`

## Validation

- `node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts` - 18 passed, 1 skipped.
- `npm run test:unit` - 565 passed, 13 skipped, 0 failed.
- `npm run build` - passed.
- `npm run lint` - 0 errors, 196 existing warnings.
- `npx drizzle-kit check` - passed.
- `node scripts/quotation-outbox-worker.mjs` without configuration - exited 1 and reported missing safe configuration rather than starting an unsafe worker.
- `git diff --check` - passed.

## Honest limits

- `TEST_DATABASE_URL` remains unavailable, so live PostgreSQL transaction rollback, ownership join and `SKIP LOCKED` behavior are not claimed as executed here.
- The deployable worker requires `DATABASE_URL`, `OUTBOX_N8N_URL` or `N8N_OUTBOX_WEBHOOK_URL`, `OUTBOX_EVOLUTION_URL` and `OUTBOX_CRM_URL`.
- Those URLs are provider bridge endpoints that accept canonical references and resolve provider-specific data outside PostgreSQL.
- Existing Frappe send paths remain rollback-compatible and are deliberately not converted without PostgreSQL aggregate references.
- The durable-failure alert is surfaced in the response and structured logs with an alert ID; a separate alerting service is still an operational deployment concern.

## Acceptance

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Fix round 1 preserves cf29980 while adding transaction rollback coverage, mandatory lifecycle insertion, safe deployable worker wiring, ownership validation, frontend send integration and explicit durable-failure handling without dependencies."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "This report lists changed files, focused and full test results, build/lint/Drizzle checks, configuration evidence, risks and clean-worktree requirement."
    }
  ],
  "changedFiles": [
    "api/_db/quotation-lifecycle-repository.ts",
    "api/_db/quotation-outbox-repository.ts",
    "api/_functions/quotation-outbox-worker.ts",
    "api/_functions/send-whatsapp-flow.ts",
    "api/_functions/send-whatsapp.ts",
    "package.json",
    "scripts/quotation-outbox-worker.mjs",
    "src/lib/communicationApi.ts",
    "src/pages/AutoQuotePage.tsx",
    "tests/unit/quotation-outbox.test.ts",
    "tests/unit/quotation-template-migration.test.ts",
    "tests/unit/quotations-core.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/quotation-outbox.test.ts",
    "tests/unit/quotation-template-migration.test.ts",
    "tests/unit/quotations-core.test.ts"
  ],
  "commandsRun": [
    {
      "command": "node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts",
      "result": "passed",
      "summary": "18 passed, 1 skipped"
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "565 passed, 13 skipped, 0 failed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "API and Vite production build passed"
    },
    {
      "command": "npm run lint",
      "result": "passed",
      "summary": "0 errors, 196 existing warnings"
    },
    {
      "command": "npx drizzle-kit check",
      "result": "passed",
      "summary": "Schema and migration check passed"
    },
    {
      "command": "node scripts/quotation-outbox-worker.mjs",
      "result": "passed",
      "summary": "Safe configuration validation exited 1 with explicit missing-variable report"
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors"
    }
  ],
  "validationOutput": [
    "Aggregate and outbox rollback is asserted through a transaction-aware memory seam with injected failure, with a real PostgreSQL rollback test enabled when TEST_DATABASE_URL is available.",
    "quotation.sent ownership requires matching PostgreSQL quotation, revision and business number.",
    "Provider adapter payload tests reject PII and secrets.",
    "Sent durability failures expose provider_accepted, outbox_durable=false and alert_id.",
    "No staged files remain after the single fix commit."
  ],
  "residualRisks": [
    "Live PostgreSQL integration remains unexecuted because TEST_DATABASE_URL is unavailable.",
    "Provider bridge URLs and external alert routing require production configuration."
  ],
  "noStagedFiles": true,
  "diffSummary": "Hardens transactional outbox atomicity, ownership, idempotency and lease semantics, adds deployable safe adapter wiring, integrates frontend PostgreSQL send references and surfaces post-provider durability failures.",
  "reviewFindings": [
    "No known fix-round blockers remain; live PostgreSQL behavior remains an explicit unexecuted validation risk."
  ],
  "manualNotes": "Single follow-up commit will preserve cf29980 and contain fix round 1."
}
```

## Fix round 2

- Added bounded provider timeout and `AbortSignal` propagation.
- Timeout is capped below the requested lease and timeout failures use the normal retry/dead-letter path.
- Timeout failures clear lease ownership through `markFailed`; timeout test asserts abort, retry classification and released owner.
- Added scoped SHA-256 opaque idempotency derivation for caller-supplied keys.
- Arbitrary objects and oversized external keys are rejected before persistence or provider transmission.
- Added assertions that email-like values and secrets never appear in persisted/transmitted keys.
- Added `closeDatabase()` and one-shot worker `finally` cleanup for the cached PostgreSQL pool.

### Fix round 2 validation

- `node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts` - 20 passed, 1 skipped.
- `npm run test:unit` - 567 passed, 13 skipped, 0 failed.
- `npm run build` - passed.
- `npm run lint` - 0 errors, 196 existing warnings.
- `npx drizzle-kit check` - passed.
- `node scripts/quotation-outbox-worker.mjs` without configuration - exited 1 with explicit missing configuration and no open pool.
- `git diff --check` - passed.

### Fix round 2 limits

- PostgreSQL-backed rollback, lease and ownership tests remain skipped because `TEST_DATABASE_URL` is unavailable.
- Provider bridge timeout behavior is tested through the injected abort-aware adapter seam; live bridge cancellation remains deployment validation.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Fix round 2 preserves 4ea1f48 and adds lease-bounded cancellation, opaque external idempotency keys, and one-shot database cleanup without dependencies or timing changes."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "This report now includes fix-round-2 implementation, focused/full validation, changed scope and honest PostgreSQL/provider limits."
    }
  ],
  "changedFiles": [
    "api/_db/client.ts",
    "api/_db/quotation-outbox-repository.ts",
    "api/_functions/quotation-outbox-worker.ts",
    "api/_functions/send-whatsapp-flow.ts",
    "api/_functions/send-whatsapp.ts",
    "scripts/quotation-outbox-worker.mjs",
    "tests/unit/quotation-outbox.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/quotation-outbox.test.ts"
  ],
  "commandsRun": [
    {
      "command": "node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts",
      "result": "passed",
      "summary": "20 passed, 1 skipped"
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "567 passed, 13 skipped, 0 failed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "Production build passed"
    },
    {
      "command": "npm run lint",
      "result": "passed",
      "summary": "0 errors, 196 existing warnings"
    },
    {
      "command": "npx drizzle-kit check",
      "result": "passed",
      "summary": "Schema check passed"
    },
    {
      "command": "node scripts/quotation-outbox-worker.mjs",
      "result": "passed",
      "summary": "Missing configuration rejected safely"
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors"
    }
  ],
  "validationOutput": [
    "Provider timeout aborts before lease expiry and releases ownership into retry state.",
    "Caller keys become scoped client SHA-256 identifiers; raw PII and secrets are rejected from output.",
    "One-shot worker closes the cached PostgreSQL client in finally cleanup.",
    "Worktree is clean after the single fix-round-2 commit."
  ],
  "residualRisks": [
    "Live PostgreSQL and provider bridge cancellation remain unexecuted environment validation."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds lease-bounded provider cancellation, safe opaque caller idempotency handling and one-shot database cleanup.",
  "reviewFindings": [
    "No known fix-round-2 blockers remain."
  ],
  "manualNotes": "Single follow-up commit preserves 4ea1f48."
}
```

## Fix round 3

- Provider timeout is computed separately for each claimed event from its own lease expiry and the worker clock immediately before invocation.
- The timeout leaves a one millisecond guard before expiry.
- Events with less than two milliseconds remaining are retried without invoking a provider.
- Added deterministic timeout calculations, multi-event claim-latency coverage, and short-lease safety coverage.
- External idempotency keys are trimmed before size validation and hashing, so formatting-only whitespace variants are equivalent.
- The missing-configuration probe is explicitly an expected nonzero safety check, not a successful worker run.
- Timeout validation uses an injected clock and one bounded real timer assertion; no fixed-clock test is presented as wall-clock proof.

### Fix round 3 validation

- Focused outbox and quotation tests passed: 22 passed, 1 skipped.
- Full unit tests passed: 569 passed, 13 skipped, 0 failed.
- Production build passed.
- Lint passed with 0 errors and 196 existing warnings.
- Drizzle schema check passed.
- Diff whitespace check passed.

### Fix round 3 limits

- Live PostgreSQL lease and transaction behavior remains unexecuted because `TEST_DATABASE_URL` is unavailable.
- Provider bridge cancellation remains covered through the injected `AbortSignal` seam rather than a live bridge.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Round 3 computes timeout per event lease after claim latency, safely skips provider calls without a two-millisecond window, and trims external idempotency keys before validation and hashing."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused and full tests, build, lint, Drizzle and diff checks passed, with live PostgreSQL and provider bridge limits recorded explicitly."
    }
  ],
  "changedFiles": [
    "api/_db/quotation-outbox-repository.ts",
    "api/_functions/quotation-outbox-worker.ts",
    "tests/unit/quotation-outbox.test.ts",
    ".superpowers/sdd/2026-08-05-migracao-gradual-sem-frappe/task-7-report.md"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/quotation-outbox.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm run build:api",
      "result": "passed",
      "summary": "TypeScript API build passed"
    },
    {
      "command": "node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts",
      "result": "passed",
      "summary": "22 passed, 1 skipped"
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "569 passed, 13 skipped, 0 failed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "Production build passed"
    },
    {
      "command": "npm run lint",
      "result": "passed",
      "summary": "0 errors, 196 existing warnings"
    },
    {
      "command": "npx drizzle-kit check",
      "result": "passed",
      "summary": "Schema check passed"
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors"
    }
  ],
  "validationOutput": [
    "Two claimed events use separate remaining-lease timeouts after the first event advances the injected clock by 60 milliseconds.",
    "A one-millisecond lease retries without invoking the provider.",
    "Whitespace-only idempotency formatting normalizes to the same opaque key, while 513 meaningful characters are rejected after trimming."
  ],
  "residualRisks": [
    "TEST_DATABASE_URL is unavailable, so live PostgreSQL lease and transaction behavior remains unexecuted.",
    "Provider bridge cancellation remains covered through injected AbortSignal tests rather than a live bridge."
  ],
  "noStagedFiles": true,
  "diffSummary": "Computes lease-aware per-event provider timeouts, safely handles short leases, and normalizes external idempotency keys with focused coverage.",
  "reviewFindings": [
    "No known blockers in this fix round."
  ],
  "manualNotes": "The missing-configuration worker probe is intentionally nonzero and is documented as an expected safety rejection."
}
```
