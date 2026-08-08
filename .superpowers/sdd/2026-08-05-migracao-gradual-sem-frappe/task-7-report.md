# Task 7 - Transactional quotation outbox producer and worker

## Status

COMPLETED.

## Commit

the task commit (`feat: queue quotation external effects`)

## Implementation

- Added `quotation_outbox_events` schema and migration `drizzle/0016_ambiguous_butterfly.sql`.
- Persisted event type, provider, aggregate reference, canonical payload reference, idempotency key, status, attempts, lease owner and expiry, retry time, error class, provider message ID, timestamps and delivery timestamp.
- Enforced event, provider, status, attempts and idempotency invariants in PostgreSQL.
- Added idempotent enqueue with `ON CONFLICT DO NOTHING` and existing-event recovery.
- Added PostgreSQL and deterministic in-memory repositories.
- Added SQL row-lock plus `SKIP LOCKED` lease claiming.
- Added ownership and expiry checks when acknowledging success or failure.
- Added exponential retry backoff and terminal `dead_letter` state.
- Added provider adapter boundaries for N8N, Evolution and CRM.
- Worker adapters receive canonical quotation and revision references only.
- Provider secrets, customer PII and raw provider payloads never enter the outbox payload reference.
- PostgreSQL quotation creation queues `quotation.created` inside the aggregate transaction.
- PostgreSQL quotation edits and lifecycle mutations queue `quotation.updated` inside their aggregate transactions.
- Public PostgreSQL document rendering queues `quotation.issued` only after HTML/PDF rendering succeeds.
- Legacy WhatsApp sends queue `quotation.sent` only after Evolution accepts the send request and only when a PostgreSQL revision reference is supplied.
- `orcamento-core` exposes queued creation metadata without changing legacy repository seams.

## Tests added

- Duplicate idempotency key recovery.
- Canonical-reference-only payload assertion.
- Concurrent lease exclusion.
- Lease retry and exponential backoff assertion.
- Dead-letter after exhausted attempts.
- Provider failure preserving saved quotation state.
- Provider acceptance and message ID persistence.
- Provider rejection retry behavior.
- Issuance timing after successful immutable document rendering.
- Transactional producer source assertion.

## Commands and results

- `node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts` - 13 passed.
- `npm run test:unit` - 561 passed, 12 skipped, 0 failed.
- `npm run build:api` - passed.
- `npm run build` - passed.
- `npm run lint` - 0 errors, 196 existing warnings.
- `npx drizzle-kit check` - passed.
- `git diff --check` - passed.
- `git status --short` - clean after commit.

## Residual concerns

- PostgreSQL-backed runtime tests were skipped because `TEST_DATABASE_URL` is unavailable in this environment.
- Provider operations remain explicit worker injection seams, preserving current N8N, Evolution and CRM adapters without duplicating provider HTTP clients.
- Legacy WhatsApp requests without a PostgreSQL revision continue their existing behavior and do not claim PostgreSQL outbox capability.

## Acceptance

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "the task commit adds schema, transactional producers, worker leases/retries/dead-letter handling, issuance/send timing and focused tests without new dependencies."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report records changed files, tests, commands, validation, residual risks and clean worktree evidence."
    }
  ],
  "changedFiles": [
    "api/_db/schema.ts",
    "api/_db/quotation-outbox-repository.ts",
    "api/_db/quote-repository.ts",
    "api/_db/quote-draft-management-repository.ts",
    "api/_db/quotation-lifecycle-repository.ts",
    "api/_functions/quotation-outbox-worker.ts",
    "api/_functions/orcamento-core.ts",
    "api/_functions/public-quotation.ts",
    "api/_functions/send-whatsapp.ts",
    "drizzle/0016_ambiguous_butterfly.sql",
    "drizzle/meta/0016_snapshot.json",
    "drizzle/meta/_journal.json",
    "tests/unit/quotation-outbox.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/quotation-outbox.test.ts"
  ],
  "commandsRun": [
    {
      "command": "node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts",
      "result": "passed",
      "summary": "13 passed"
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "561 passed, 12 skipped, 0 failed"
    },
    {
      "command": "npm run build:api",
      "result": "passed",
      "summary": "TypeScript API build passed"
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
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors"
    }
  ],
  "validationOutput": [
    "Outbox payload references contain only quotationId, revisionId and businessNumber.",
    "Worker lease ownership, expiry, retry backoff, provider acceptance and dead-letter transitions are asserted.",
    "Worktree has no staged or unstaged files after the task commit."
  ],
  "residualRisks": [
    "TEST_DATABASE_URL was unavailable, so live PostgreSQL transaction and SKIP LOCKED behavior remains deployment validation work.",
    "Provider adapters require explicit runtime wiring to existing N8N, Evolution and CRM clients."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds PostgreSQL transactional quotation outbox with canonical references, idempotency, leases, retries, dead-letter state, provider worker seams and event timing integrations.",
  "reviewFindings": [
    "No self-review blockers found."
  ],
  "manualNotes": "the task commit is ready for independent review."
}
```
