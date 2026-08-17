# WhatsApp Delivery Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PostgreSQL-backed WhatsApp delivery outbox that starts immediately, recovers interrupted work, confirms every flow step through Evolution delivery receipts, and exposes the same operational state in each quotation and a global outbox.

**Architecture:** A pure state module defines monotonic delivery transitions and safe retry classification. A PostgreSQL repository owns idempotent enqueue, leases, step persistence, receipt application, listing, and manual resolution; a delivery module hides those mechanics behind `enqueue`, `process`, `applyEvolutionEvent`, `get`, `list`, and `resolve`. Existing send and status handlers become compatibility adapters while new webhook, worker, list, polling, and outbox interfaces use the durable module directly.

**Tech Stack:** TypeScript, Node.js ESM, React 19, Vite 6, PostgreSQL, Drizzle ORM, Vercel Functions and Cron, Evolution API `MESSAGES_UPDATE`, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-whatsapp-delivery-outbox-design.md`

## Global Constraints

- PostgreSQL is the sole correctness source for delivery state.
- No new dependency or external queue may be added.
- Evolution remains the only WhatsApp transport.
- Every backend `.js` import keeps its explicit extension.
- A delivery is unique by `revision_id + flow_id`.
- `delivered` requires every mandatory step to reach `DELIVERY_ACK`, `READ`, or `PLAYED`.
- Accepted or ambiguous steps are never retried automatically.
- Only transient failures proven to precede transport receive automatic retry.
- Current CRM, `quote_leads`, quotation revisions, and historical data remain intact.
- Existing files under `drizzle/` are never modified; create migration `0020`.
- Generated Vite output under `public/` is never edited directly.
- Local `npm test` never invokes staging or real WhatsApp transport.
- Staging verification never creates a fictitious quotation automatically.
- Public errors remain in Brazilian Portuguese and never expose database, provider, secret, payload, or personal data.
- Runtime logs use internal IDs and error codes only.
- Manual resolution records `resolved_by = authenticated-operator` because authentication uses one shared credential.
- Route maps remain synchronized in `api/[...path].ts`, `scripts/dev-api-server.mjs`, and `scripts/app-server.mjs`.

## File Map

### New backend modules

- `api/_functions/lib/quotation-delivery-state.ts`: pure states, receipt ordering, aggregate state, retry schedule, and error disposition.
- `api/_db/quotation-delivery-outbox-repository.ts`: PostgreSQL enqueue, claim, lease, step updates, list, read, and resolution.
- `api/_functions/lib/quotation-delivery-plan.ts`: freeze rendered flow steps without provider transport details.
- `api/_functions/lib/evolution-transport.ts`: typed Evolution send outcomes and safe failure classification.
- `api/_functions/lib/quotation-delivery-outbox.ts`: deep delivery module and process loop.
- `api/_functions/quotation-deliveries.ts`: authenticated list, detail, and manual resolution handler.
- `api/_functions/evolution-webhook.ts`: machine-authenticated Evolution receipt handler.
- `api/_functions/quotation-delivery-worker.ts`: cron-authenticated recovery handler.

### New frontend modules

- `src/lib/quotationDeliveryApi.ts`: validated public delivery types and HTTP calls.
- `src/hooks/useQuotationDeliveries.ts`: shared backend polling and enqueue state.
- `src/components/QuotationDeliveryStatus.tsx`: flow progress, status, details, and manual actions.
- `src/pages/WhatsAppDeliveriesPage.tsx`: global operational outbox.

### Existing files with focused changes

- `api/_db/schema.ts`: durable delivery columns, composite identity, and step table.
- `api/_db/quotation-delivery-repository.ts`: expose immutable PDF preparation without reserving transport state.
- `api/_functions/send-whatsapp-flow.ts`: preserve dry-run preparation and replace live reservation orchestration with the outbox module.
- `api/_functions/whatsapp-send-status.ts`: compatibility adapter over PostgreSQL delivery state.
- `api/[...path].ts`: register three routes and permit machine-authenticated endpoints through the outer session guard.
- `scripts/dev-api-server.mjs`: register three routes.
- `scripts/app-server.mjs`: register three routes and permit machine-authenticated endpoints through the outer session guard.
- `api/_lib/auth.ts`: identify machine routes without granting them user-session semantics.
- `api/_lib/types.ts`: include `PATCH` in `HttpMethod`.
- `vercel.json`: schedule one-minute worker invocation.
- `src/lib/communicationApi.ts`: retain communication flow calls and delegate delivery projection to the new client.
- `src/components/WhatsAppSendPanel.tsx`: consume durable delivery presentation states.
- `src/components/SplitResultCard.tsx`: display durable progress instead of transient send status.
- `src/pages/AutoQuotePage.tsx`: enqueue and poll each revision-flow identity.
- `src/pages/QuotationDetailPage.tsx`: enqueue and poll the current revision-flow identity.
- `src/App.tsx`: lazy-load `/whatsapp-deliveries`.
- `src/components/layout/Sidebar.tsx`: add **Envios WhatsApp**.
- `tests/unit/route-map.test.ts`: require 47 synchronized routes.
- `docs/operational-cutoff-procedure.md`: document secrets, webhook, cron, and controlled verification.

---

### Task 1: Pure Delivery State Machine

**Files:**

- Create: `api/_functions/lib/quotation-delivery-state.ts`
- Create: `tests/unit/quotation-delivery-state.test.ts`

**Interfaces:**

- Consumes: Evolution status names `ERROR`, `PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ`, and `PLAYED`.
- Produces: `DeliveryState`, `DeliveryStepState`, `TransportFailureKind`, `applyReceipt`, `aggregateDeliveryState`, `retryDelayMs`, and `failureTargetState`.

- [ ] **Step 1: Write the failing state-machine test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateDeliveryState,
  applyReceipt,
  failureTargetState,
  retryDelayMs,
} from '../../api/_functions/lib/quotation-delivery-state.js';

test('receipts advance monotonically and all steps must be delivered', () => {
  assert.equal(applyReceipt('server_ack', 'DELIVERY_ACK'), 'delivered');
  assert.equal(applyReceipt('delivered', 'SERVER_ACK'), 'delivered');
  assert.equal(applyReceipt('read', 'DELIVERY_ACK'), 'read');
  assert.equal(applyReceipt('server_ack', 'ERROR'), 'needs_review');
  assert.equal(applyReceipt('delivered', 'ERROR'), 'delivered');
  assert.equal(aggregateDeliveryState(['delivered', 'read']), 'delivered');
  assert.equal(aggregateDeliveryState(['delivered', 'server_ack']), 'provider_accepted');
});

test('only transient pre-transport failures retry', () => {
  assert.equal(failureTargetState('transient_pre_transport'), 'retry_scheduled');
  assert.equal(failureTargetState('permanent_pre_transport'), 'failed');
  assert.equal(failureTargetState('ambiguous'), 'reconciling');
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMs), [60_000, 300_000, 900_000, null]);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-state.test.ts
```

Expected: FAIL because `quotation-delivery-state.js` does not exist.

- [ ] **Step 3: Implement the pure state module**

Use these exact public types and functions:

```ts
export type DeliveryState =
  | 'queued'
  | 'processing'
  | 'provider_accepted'
  | 'reconciling'
  | 'retry_scheduled'
  | 'needs_review'
  | 'delivered'
  | 'failed';

export type DeliveryStepState =
  | 'queued'
  | 'sending'
  | 'server_ack'
  | 'reconciling'
  | 'retry_scheduled'
  | 'needs_review'
  | 'delivered'
  | 'read'
  | 'failed';

export type EvolutionReceiptStatus =
  | 'ERROR'
  | 'PENDING'
  | 'SERVER_ACK'
  | 'DELIVERY_ACK'
  | 'READ'
  | 'PLAYED';

export type TransportFailureKind =
  | 'transient_pre_transport'
  | 'permanent_pre_transport'
  | 'ambiguous';

const RECEIPT_RANK: Record<DeliveryStepState, number> = {
  queued: 0,
  retry_scheduled: 0,
  sending: 1,
  reconciling: 1,
  needs_review: 1,
  server_ack: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

const RECEIPT_STATE: Partial<Record<EvolutionReceiptStatus, DeliveryStepState>> = {
  SERVER_ACK: 'server_ack',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
};

export function applyReceipt(
  current: DeliveryStepState,
  receipt: EvolutionReceiptStatus
): DeliveryStepState {
  if (receipt === 'ERROR') {
    return current === 'delivered' || current === 'read' || current === 'failed'
      ? current
      : 'needs_review';
  }
  const candidate = RECEIPT_STATE[receipt];
  if (!candidate || current === 'failed') return current;
  return RECEIPT_RANK[candidate] > RECEIPT_RANK[current] ? candidate : current;
}

export function aggregateDeliveryState(states: DeliveryStepState[]): DeliveryState {
  if (states.length > 0 && states.every((state) => state === 'delivered' || state === 'read'))
    return 'delivered';
  if (states.some((state) => state === 'needs_review')) return 'needs_review';
  if (states.some((state) => state === 'reconciling')) return 'reconciling';
  if (states.some((state) => state === 'failed')) return 'failed';
  if (states.some((state) => state === 'retry_scheduled')) return 'retry_scheduled';
  if (states.every((state) => ['server_ack', 'delivered', 'read'].includes(state)))
    return 'provider_accepted';
  if (states.some((state) => state === 'sending')) return 'processing';
  return 'queued';
}

export function failureTargetState(kind: TransportFailureKind): DeliveryStepState {
  if (kind === 'transient_pre_transport') return 'retry_scheduled';
  if (kind === 'permanent_pre_transport') return 'failed';
  return 'reconciling';
}

export function retryDelayMs(attempt: number): number | null {
  return [60_000, 300_000, 900_000][attempt - 1] ?? null;
}
```

Keep parsing and validation strict.
Do not add a generic transition framework.

- [ ] **Step 4: Run the focused test and full unit suite**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-state.test.ts
npm run test:unit
```

Expected: focused test PASS; all unit tests PASS.

- [ ] **Step 5: Commit the state machine**

```bash
git add api/_functions/lib/quotation-delivery-state.ts tests/unit/quotation-delivery-state.test.ts
git commit -m "feat(whatsapp): add delivery state machine"
```

### Task 2: PostgreSQL Schema and Conservative Migration

**Files:**

- Modify: `api/_db/schema.ts:403-424`
- Create: `drizzle/0020_quotation_delivery_outbox.sql`
- Create: `drizzle/meta/0020_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/unit/quotation-schema.test.ts`
- Create: `tests/unit/quotation-delivery-outbox-migration.test.ts`

**Interfaces:**

- Consumes: `DeliveryState` and `DeliveryStepState` literals from Task 1.
- Produces: exported `quotationDeliveries` and `quotationDeliverySteps` Drizzle tables with composite identity and provider message lookup.

- [ ] **Step 1: Add failing schema assertions**

Add assertions using Drizzle table metadata:

```ts
import { getTableColumns } from 'drizzle-orm';
import { quotationDeliveries, quotationDeliverySteps } from '../../api/_db/schema.js';

test('delivery outbox schema exposes leases, manual resolution and steps', () => {
  const delivery = getTableColumns(quotationDeliveries);
  const step = getTableColumns(quotationDeliverySteps);
  for (const key of [
    'flowName',
    'attemptCount',
    'nextAttemptAt',
    'leaseToken',
    'leaseUntil',
    'reconciliationDeadline',
    'completionSource',
    'resolvedBy',
    'resolvedAt',
    'resolutionNote',
    'deliveredAt',
  ]) {
    assert.ok(delivery[key as keyof typeof delivery], `missing delivery column ${key}`);
  }
  for (const key of [
    'deliveryId',
    'position',
    'type',
    'payloadSnapshot',
    'state',
    'providerMessageId',
    'attemptCount',
    'nextAttemptAt',
    'reconciliationDeadline',
  ]) {
    assert.ok(step[key as keyof typeof step], `missing step column ${key}`);
  }
});
```

Create a migration test that opens a transaction in `TEST_DATABASE_URL`, creates the minimal `0019` versions of `quote_revisions` and `quotation_deliveries` in a temporary schema, inserts one row for each legacy state, executes the statements from `0020_quotation_delivery_outbox.sql`, and verifies none become `queued`, `processing`, or `retry_scheduled`.
Roll the transaction back so repeated runs remain isolated.
The test must skip with an explicit message when `TEST_DATABASE_URL` is absent, and the task may not be accepted from a skipped run.

- [ ] **Step 2: Run schema tests and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-schema.test.ts tests/unit/quotation-delivery-outbox-migration.test.ts
```

Expected: FAIL because new columns, table, and migration do not exist.

- [ ] **Step 3: Extend `schema.ts`**

Use these columns and constraints:

```ts
export const quotationDeliveries = pgTable(
  'quotation_deliveries',
  {
    id: uuid('id').primaryKey(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id),
    phone: text('phone').notNull(),
    flowId: text('flow_id').notNull(),
    flowName: text('flow_name').notNull(),
    state: text('state').notNull(),
    providerAcceptanceId: text('provider_acceptance_id'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    reconciliationDeadline: timestamp('reconciliation_deadline', { withTimezone: true }),
    publicError: text('public_error'),
    completionSource: text('completion_source'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    diagnosticsExpiresAt: timestamp('diagnostics_expires_at', { withTimezone: true }),
    resumableUntil: timestamp('resumable_until', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('quotation_deliveries_revision_flow_unique').on(table.revisionId, table.flowId),
    index('quotation_deliveries_due_idx').on(table.state, table.nextAttemptAt),
  ]
);

export const quotationDeliverySteps = pgTable(
  'quotation_delivery_steps',
  {
    id: uuid('id').primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => quotationDeliveries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    payloadSnapshot: jsonb('payload_snapshot').notNull(),
    state: text('state').notNull(),
    providerMessageId: text('provider_message_id').unique(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    reconciliationDeadline: timestamp('reconciliation_deadline', { withTimezone: true }),
    publicError: text('public_error'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('quotation_delivery_steps_delivery_position_unique').on(
      table.deliveryId,
      table.position
    ),
    index('quotation_delivery_steps_due_idx').on(table.state, table.nextAttemptAt),
  ]
);
```

Add explicit check constraints for the state and completion-source literals from the spec.

- [ ] **Step 4: Generate migration `0020` and add conservative data mapping**

Run:

```bash
npx drizzle-kit generate --name=quotation_delivery_outbox
```

Confirm generated paths are exactly:

```text
drizzle/0020_quotation_delivery_outbox.sql
drizzle/meta/0020_snapshot.json
```

In the new `0020` migration only, ensure the old state check is removed before mapping and the new check is added after mapping:

```sql
UPDATE "quotation_deliveries"
SET
  "state" = CASE
    WHEN "state" = 'completed' THEN 'provider_accepted'
    ELSE 'needs_review'
  END,
  "completion_source" = CASE
    WHEN "state" = 'completed' THEN 'legacy_provider_ack'
    ELSE NULL
  END,
  "flow_name" = "flow_id",
  "next_attempt_at" = NULL,
  "lease_token" = NULL,
  "lease_until" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;
```

Drop `quotation_deliveries_revision_id_unique` and add `quotation_deliveries_revision_flow_unique`.
Do not insert step rows for legacy deliveries.
Do not modify `0019_quotation_issue_delivery.sql` or older migrations.

- [ ] **Step 5: Run migration and schema verification**

Run with an isolated PostgreSQL test database:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-schema.test.ts tests/unit/quotation-delivery-outbox-migration.test.ts
```

Expected: all tests PASS with no skips.

- [ ] **Step 6: Commit schema and migration**

```bash
git add api/_db/schema.ts drizzle/0020_quotation_delivery_outbox.sql drizzle/meta/0020_snapshot.json drizzle/meta/_journal.json tests/unit/quotation-schema.test.ts tests/unit/quotation-delivery-outbox-migration.test.ts
git commit -m "feat(db): add WhatsApp delivery outbox"
```

### Task 3: PostgreSQL Outbox Repository

**Files:**

- Create: `api/_db/quotation-delivery-outbox-repository.ts`
- Create: `tests/unit/quotation-delivery-outbox-postgres.test.ts`

**Interfaces:**

- Consumes: schema from Task 2 and state helpers from Task 1.
- Produces: `QuotationDeliveryOutboxRepository`, `DeliveryAggregate`, `DeliveryIdentity`, `FrozenDeliveryStep`, and `createPostgresQuotationDeliveryOutboxRepository`.

- [ ] **Step 1: Write failing repository integration tests**

Cover these exact scenarios against `TEST_DATABASE_URL`:

```ts
test('enqueue is idempotent by revision and flow but independent across flows', async () => {
  const first = await repository.enqueue(input({ flowId: 'flow-a' }));
  const replay = await repository.enqueue(input({ flowId: 'flow-a' }));
  const other = await repository.enqueue(input({ flowId: 'flow-b' }));
  assert.equal(replay.id, first.id);
  assert.notEqual(other.id, first.id);
  assert.equal((await repository.get(first.id))?.steps.length, 2);
});

test('two claims produce one lease and accepted steps never reclaim', async () => {
  const delivery = await repository.enqueue(input());
  const [a, b] = await Promise.all([
    repository.claim({ deliveryId: delivery.id }),
    repository.claim({ deliveryId: delivery.id }),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const claim = a || b;
  await repository.markAccepted({
    deliveryId: delivery.id,
    stepId: claim!.step.id,
    leaseToken: claim!.leaseToken,
    providerMessageId: 'provider-1',
  });
  assert.equal(await repository.claim({ deliveryId: delivery.id }), null);
});
```

Also test:

- expired lease is reclaimable;
- `providerMessageId` is unique;
- duplicate receipt is neutral;
- out-of-order receipt cannot regress;
- list filtering and pagination;
- `confirmed_received` records operator completion;
- `confirmed_not_received` requeues only unresolved steps;
- an invalid lease cannot update a step.

- [ ] **Step 2: Run the repository tests and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-outbox-postgres.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Define repository contracts**

Use these exact external shapes:

```ts
export interface DeliveryIdentity {
  revisionId: string;
  flowId: string;
}

export type FrozenDeliveryStep =
  | { position: number; type: 'text'; payload: { text: string }; delayMs: number }
  | {
      position: number;
      type: 'media';
      payload: { mediaType: 'image' | 'document'; url: string; fileName: string; caption: string };
      delayMs: number;
    }
  | {
      position: number;
      type: 'quotation_pdf';
      payload: { revisionId: string; fileName: string; caption: string };
      delayMs: number;
    };

export interface DeliveryStepView {
  id: string;
  position: number;
  type: FrozenDeliveryStep['type'];
  state: DeliveryStepState;
  attemptCount: number;
  publicError: string | null;
  nextAttemptAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  updatedAt: Date;
}

export interface EnqueueDeliveryRecord extends DeliveryIdentity {
  phone: string;
  flowName: string;
  steps: FrozenDeliveryStep[];
}

export interface DeliveryListFilters {
  states?: DeliveryState[];
  search?: string;
  from?: Date;
  to?: Date;
  requiresAction?: boolean;
  includeActive?: boolean;
  delayed?: boolean;
  page: number;
  pageSize: number;
}

export interface DeliveryAggregate {
  id: string;
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  state: DeliveryState;
  completionSource: 'provider_receipt' | 'operator' | 'legacy_provider_ack' | null;
  publicError: string | null;
  nextAttemptAt: Date | null;
  reconciliationDeadline: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  steps: DeliveryStepView[];
}

export interface DeliveryListResult {
  data: DeliveryAggregate[];
  total: number;
  summary: {
    active: number;
    requiresAction: number;
    retryScheduled: number;
    delayed: number;
    deliveredLast24Hours: number;
  };
}

export interface ClaimedDeliveryStep {
  delivery: DeliveryAggregate;
  step: DeliveryStepView & { snapshot: FrozenDeliveryStep };
  leaseToken: string;
}

export interface MarkAcceptedInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  providerMessageId: string;
}

export interface MarkFailureInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  kind: TransportFailureKind;
  code: string;
  publicError: string;
}

export interface ApplyReceiptInput {
  providerMessageId: string;
  status: EvolutionReceiptStatus;
}

export interface QuotationDeliveryOutboxRepository {
  enqueue(input: EnqueueDeliveryRecord): Promise<DeliveryAggregate>;
  get(deliveryId: string): Promise<DeliveryAggregate | null>;
  getByIdentity(identity: DeliveryIdentity): Promise<DeliveryAggregate | null>;
  list(filters: DeliveryListFilters): Promise<DeliveryListResult>;
  claim(input?: { deliveryId?: string }): Promise<ClaimedDeliveryStep | null>;
  markAccepted(input: MarkAcceptedInput): Promise<DeliveryAggregate>;
  markFailure(input: MarkFailureInput): Promise<DeliveryAggregate>;
  applyReceipt(input: ApplyReceiptInput): Promise<DeliveryAggregate | null>;
  expireReconciliations(limit: number): Promise<number>;
  resolve(input: ResolveDeliveryInput): Promise<DeliveryAggregate>;
}
```

Validate UUIDs, flow IDs, phone, note length, page size, snapshots, and public error length at the repository seam.

- [ ] **Step 4: Implement transactional enqueue and claims**

Use one short transaction for enqueue.
Insert the delivery with `onConflictDoNothing`, read the winning row, and insert steps only when this call created the row.
Reject phone or frozen-step mismatch if a replay attempts to mutate the existing identity.

Use a short raw SQL claim with `FOR UPDATE SKIP LOCKED`:

```sql
SELECT s.id
FROM quotation_delivery_steps s
JOIN quotation_deliveries d ON d.id = s.delivery_id
WHERE s.state IN ('queued', 'retry_scheduled')
  AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= CURRENT_TIMESTAMP)
  AND (d.lease_until IS NULL OR d.lease_until <= CURRENT_TIMESTAMP)
  AND ($1::uuid IS NULL OR d.id = $1)
ORDER BY COALESCE(s.next_attempt_at, s.created_at), s.position
FOR UPDATE OF d, s SKIP LOCKED
LIMIT 1
```

Set a fresh `lease_token`, a bounded `lease_until`, delivery `processing`, and step `sending` in the same transaction.
Perform no network I/O inside the transaction.

- [ ] **Step 5: Implement monotonic updates, list, and resolution**

Every step update must compare `delivery_id`, `step_id`, and `lease_token`.
`markAccepted` stores the provider ID before clearing the lease.
`markFailure` uses `failureTargetState` and `retryDelayMs`.
`applyReceipt` locks by `provider_message_id`, advances with `applyReceipt`, and recomputes the aggregate state.
`resolve` accepts only:

```ts
export type ResolveDeliveryInput =
  | {
      deliveryId: string;
      decision: 'confirmed_received';
      note: string;
      resolvedBy: 'authenticated-operator';
    }
  | {
      deliveryId: string;
      decision: 'confirmed_not_received';
      note: string;
      resolvedBy: 'authenticated-operator';
    };
```

Permit resolution only for `needs_review` or `provider_accepted` older than 24 hours.
`confirmed_not_received` requeues only unresolved steps and clears no provider ID from an accepted step without the explicit operator decision being recorded.
Sanitize list output so provider payloads and internal diagnostics never leave the repository module.

- [ ] **Step 6: Run repository and full unit tests**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-delivery-outbox-postgres.test.ts
npm run test:unit
```

Expected: all tests PASS; PostgreSQL test reports no skips.

- [ ] **Step 7: Commit the repository**

```bash
git add api/_db/quotation-delivery-outbox-repository.ts tests/unit/quotation-delivery-outbox-postgres.test.ts
git commit -m "feat(whatsapp): persist delivery outbox"
```

### Task 4: Frozen Flow Plan and Typed Evolution Transport

**Files:**

- Create: `api/_functions/lib/quotation-delivery-plan.ts`
- Create: `api/_functions/lib/evolution-transport.ts`
- Modify: `api/_db/quotation-delivery-repository.ts:109-119,357-500`
- Modify: `api/_functions/send-whatsapp-flow.ts:57-648`
- Create: `tests/unit/quotation-delivery-plan.test.ts`
- Create: `tests/unit/evolution-transport.test.ts`
- Modify: `tests/unit/send-whatsapp.test.ts`

**Interfaces:**

- Consumes: `FrozenDeliveryStep` from Task 3, immutable revision rendering, existing communication flows, and `normalizeEvolutionDelivery`.
- Produces: `createDeliveryPlan`, `EvolutionTransportError`, `sendFrozenStep`, and `prepareDeliveryDocument`.

- [ ] **Step 1: Write failing plan and transport tests**

```ts
test('plan freezes rendered text, approved media and exactly one quotation PDF', async () => {
  const plan = await createDeliveryPlan(fixtureInput);
  assert.deepEqual(
    plan.steps.map((step) => step.type),
    ['text', 'media', 'quotation_pdf']
  );
  assert.equal(plan.steps[0].payload.text, 'Olá Cliente');
  assert.equal(plan.steps[2].payload.revisionId, fixtureInput.revisionId);
  assert.equal(JSON.stringify(plan.steps).includes('base64'), false);
});

test('transport classifies provider outcomes without guessing network delivery', async () => {
  await assert.rejects(
    sendFrozenStep(input, {
      fetch: async () => {
        throw new Error('socket closed');
      },
    }),
    (error: unknown) => error instanceof EvolutionTransportError && error.kind === 'ambiguous'
  );
  await assert.rejects(
    sendFrozenStep(input, { fetch: async () => response(429, { error: 'rate limit' }) }),
    (error: unknown) =>
      error instanceof EvolutionTransportError && error.kind === 'transient_pre_transport'
  );
});
```

Also cover malformed `2xx`, `5xx`, explicit `4xx` validation rejection, missing configuration, and accepted `key.id`.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-plan.test.ts tests/unit/evolution-transport.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Expose immutable PDF preparation without transport reservation**

Add this repository method:

```ts
export interface PreparedDeliveryDocument {
  pdf: Buffer;
  pdfSize: number;
  pdfSignature: string;
  validUntil: Date;
}

prepareDeliveryDocument(revisionId: string): Promise<PreparedDeliveryDocument>;
```

Move revision/template/item loading and PDF rendering from `prepareDelivery` behind this method.
Keep the old `prepareDelivery` adapter temporarily by calling `reserve` and `prepareDeliveryDocument` until Task 11 removes it.

- [ ] **Step 4: Extract flow planning from the live handler**

`createDeliveryPlan` must:

- resolve one enabled flow;
- load immutable quotation context;
- require exactly one quotation PDF step;
- render text variables once;
- resolve approved product media once;
- freeze media URL, filename, caption, and type;
- freeze a PDF reference containing revision ID, filename, and caption without base64 bytes;
- assign each step its position and delay;
- reject more than 64 expanded steps;
- reject a delay plan exceeding 45 seconds.

Use this return type:

```ts
export interface DeliveryPlan {
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  steps: FrozenDeliveryStep[];
}
```

Delete duplicated planner logic from `send-whatsapp-flow.ts` only after its existing dry-run tests use `createDeliveryPlan` successfully.

- [ ] **Step 5: Implement typed Evolution transport**

Use one error class:

```ts
export class EvolutionTransportError extends Error {
  constructor(
    message: string,
    readonly kind: TransportFailureKind,
    readonly code: string
  ) {
    super(message);
    this.name = 'EvolutionTransportError';
  }
}

export interface EvolutionAccepted {
  accepted: true;
  providerMessageId: string;
}

export async function sendFrozenStep(
  input: { phone: string; step: FrozenDeliveryStep; document?: PreparedDeliveryDocument },
  dependencies: EvolutionTransportDependencies = defaultDependencies
): Promise<EvolutionAccepted>;
```

Classification rules:

- missing or invalid local input: `permanent_pre_transport`;
- explicit `429` rejection: `transient_pre_transport`;
- explicit non-retryable `4xx` rejection: `permanent_pre_transport`;
- fetch exception, timeout, `5xx`, malformed `2xx`, or absent provider ID: `ambiguous`.

Do not log request bodies, phone, text, media URLs, or provider response bodies.

- [ ] **Step 6: Run focused and compatibility tests**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-delivery-plan.test.ts tests/unit/evolution-transport.test.ts tests/unit/send-whatsapp.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit planning and transport**

```bash
git add api/_functions/lib/quotation-delivery-plan.ts api/_functions/lib/evolution-transport.ts api/_db/quotation-delivery-repository.ts api/_functions/send-whatsapp-flow.ts tests/unit/quotation-delivery-plan.test.ts tests/unit/evolution-transport.test.ts tests/unit/send-whatsapp.test.ts
git commit -m "refactor(whatsapp): freeze delivery steps"
```

### Task 5: Deep Delivery Module and Immediate Processing

**Files:**

- Create: `api/_functions/lib/quotation-delivery-outbox.ts`
- Create: `tests/unit/quotation-delivery-outbox.test.ts`

**Interfaces:**

- Consumes: planner and transport from Task 4, repository from Task 3.
- Produces: `QuotationDeliveryModule` and `createQuotationDeliveryModule`.

- [ ] **Step 1: Write failing module tests with fake adapters**

```ts
test('enqueue starts immediately and never resends an accepted step', async () => {
  const module = createQuotationDeliveryModule(dependencies());
  const first = await module.enqueue(identity);
  assert.equal(first.state, 'provider_accepted');
  assert.equal(fakeTransport.calls.length, 2);
  const replay = await module.enqueue(identity);
  assert.equal(replay.id, first.id);
  assert.equal(fakeTransport.calls.length, 2);
});

test('ambiguous outcome stops later steps and requires reconciliation', async () => {
  fakeTransport.failAt(
    1,
    new EvolutionTransportError('Resposta ambígua.', 'ambiguous', 'EVOLUTION_AMBIGUOUS')
  );
  const result = await module.enqueue(identity);
  assert.equal(result.state, 'reconciling');
  assert.equal(fakeTransport.calls.length, 1);
});
```

Also test transient retry scheduling, permanent failure, zero-delay multi-step processing, delayed next step, expired reconciliation promotion, duplicate process calls, and receipt aggregation.

- [ ] **Step 2: Run focused test and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-outbox.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the deep interface**

```ts
export interface QuotationDeliveryModule {
  enqueue(input: DeliveryIdentity): Promise<DeliveryAggregate>;
  process(deliveryId?: string): Promise<DeliveryAggregate | null>;
  processDue(limit: number): Promise<{ processed: number; remaining: boolean }>;
  applyEvolutionEvent(event: EvolutionMessageEvent): Promise<DeliveryAggregate | null>;
  get(input: {
    deliveryId?: string;
    identity?: DeliveryIdentity;
  }): Promise<DeliveryAggregate | null>;
  list(filters: DeliveryListFilters): Promise<DeliveryListResult>;
  resolve(input: ResolveDeliveryInput): Promise<DeliveryAggregate>;
}
```

`enqueue` creates the plan, calls repository `enqueue`, and calls `process(delivery.id)`.
`process` claims one due step at a time and loops only while another step is already due.
It never sleeps for a future delay.
It prepares the PDF only for a due `quotation_pdf` step.
A transient PDF renderer failure becomes `transient_pre_transport`; an expired or invalid revision becomes `permanent_pre_transport`.
It persists provider acceptance before attempting another step.
It passes typed transport failures directly to repository `markFailure`.
It returns the latest aggregate after every path.
Use `DELIVERY_LEASE_MS = 90_000`, `RECONCILIATION_WAIT_MS = 120_000`, and `PROVIDER_DELAY_WARNING_MS = 86_400_000`.
Structured logs contain only delivery ID, step ID, state, error code, and duration.

- [ ] **Step 4: Implement receipt and reconciliation entry points**

`applyEvolutionEvent` accepts only normalized events:

```ts
export interface EvolutionMessageEvent {
  instance: string;
  providerMessageId: string;
  fromMe: true;
  status: EvolutionReceiptStatus;
}
```

Unknown provider IDs return `null` without error.
`processDue` first expires elapsed `reconciling` rows to `needs_review`, then processes at most `limit` claims.
Use a default batch limit of 20 and reject values outside `1..50`.

- [ ] **Step 5: Run module, repository, and transport tests**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-delivery-outbox.test.ts tests/unit/quotation-delivery-outbox-postgres.test.ts tests/unit/evolution-transport.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the delivery module**

```bash
git add api/_functions/lib/quotation-delivery-outbox.ts tests/unit/quotation-delivery-outbox.test.ts
git commit -m "feat(whatsapp): process durable deliveries"
```

### Task 6: User APIs and Compatibility Adapters

**Files:**

- Create: `api/_functions/quotation-deliveries.ts`
- Create: `tests/unit/quotation-deliveries.test.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts:662-1190`
- Modify: `api/_functions/whatsapp-send-status.ts:18-303`
- Modify: `api/_lib/types.ts:5`
- Modify: `tests/unit/send-whatsapp.test.ts`
- Modify: `tests/unit/whatsapp-send-status.test.ts`

**Interfaces:**

- Consumes: `QuotationDeliveryModule` from Task 5.
- Produces: stable JSON `DeliveryView`, list endpoint, manual resolution endpoint, and legacy send/status response projection.

- [ ] **Step 1: Write failing handler contract tests**

Test direct handlers with injected modules:

```ts
test('POST send returns durable state instead of false success', async () => {
  const result = await sendWhatsappFlow(event('POST', payload), { deliveryModule });
  const body = JSON.parse(result.body!);
  assert.equal(result.statusCode, 202);
  assert.equal(body.success, true);
  assert.equal(body.delivery_id, 'delivery-1');
  assert.equal(body.send_status, 'provider_accepted');
  assert.equal(body.delivery.state, 'provider_accepted');
  assert.equal(body.delivery.progress.total, 2);
});

test('PATCH resolution never accepts operator identity from the body', async () => {
  const result = await quotationDeliveries(
    event('PATCH', {
      id: 'delivery-1',
      decision: 'confirmed_received',
      note: 'Cliente confirmou pelo telefone.',
      resolved_by: 'forged-user',
    }),
    { deliveryModule }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(resolveCalls[0].resolvedBy, 'authenticated-operator');
});
```

Also test GET list/detail, invalid filters, missing note, invalid decision, legacy GET status projection, dry-run compatibility, and error sanitization.

- [ ] **Step 2: Run handler tests and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-deliveries.test.ts tests/unit/send-whatsapp.test.ts tests/unit/whatsapp-send-status.test.ts
```

Expected: FAIL on missing handler and old live-send behavior.

- [ ] **Step 3: Implement `quotation-deliveries` GET and PATCH**

GET behavior:

- `id` returns one delivery with steps or `404`;
- no `id` returns `{ data, total, summary, page, page_size }`;
- `summary` contains `active`, `requires_action`, `retry_scheduled`, `delayed`, and `delivered_last_24_hours`;
- filters are `state`, `search`, `from`, `to`, `requires_action`, `include_active`, `delayed`, `page`, and `page_size`;
- page size defaults to 25 and caps at 100.

PATCH payload:

```ts
interface ResolutionBody {
  decision: 'confirmed_received' | 'confirmed_not_received';
  note: string;
}
```

Normalize note, require `3..500` characters, and inject `resolvedBy: 'authenticated-operator'` server-side.

- [ ] **Step 4: Replace live send orchestration with the outbox module**

Keep current dry-run behavior.
For non-dry-run requests:

1. validate `revision_id`, `flow_id`, and quotation identity;
2. call `deliveryModule.enqueue({ revisionId, flowId })`;
3. return `200` only for `delivered`;
4. return `202` for active, accepted, retry, or review states;
5. return a safe `4xx` or `5xx` only for rejected input or module failure.

Use this minimal response:

```ts
{
  success: true,
  delivery_id: delivery.id,
  send_status: delivery.state,
  revision_id: delivery.revisionId,
  flow_id: delivery.flowId,
  delivery: toPublicDeliveryView(delivery),
}
```

Do not return phone, provider IDs, payload snapshots, or diagnostic details.

- [ ] **Step 5: Convert `whatsapp-send-status` to a PostgreSQL adapter**

GET resolves by `revision_id + flow_id` and returns:

```ts
{
  delivery_id: delivery.id,
  revision_id: delivery.revisionId,
  flow_id: delivery.flowId,
  phase: delivery.state,
  error: delivery.publicError,
  updated_at: delivery.updatedAt.toISOString(),
}
```

PATCH delegates to the same `resolve` method as `quotation-deliveries`.
Remove Redis reads from this handler.
Keep accepted old query aliases only for compatibility.

- [ ] **Step 6: Add `PATCH` to `HttpMethod` and run focused tests**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-deliveries.test.ts tests/unit/send-whatsapp.test.ts tests/unit/whatsapp-send-status.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit user APIs and adapters**

```bash
git add api/_functions/quotation-deliveries.ts api/_functions/send-whatsapp-flow.ts api/_functions/whatsapp-send-status.ts api/_lib/types.ts tests/unit/quotation-deliveries.test.ts tests/unit/send-whatsapp.test.ts tests/unit/whatsapp-send-status.test.ts
git commit -m "feat(api): expose durable delivery status"
```

### Task 7: Evolution Webhook, Recovery Worker, and Route Security

**Files:**

- Create: `api/_functions/evolution-webhook.ts`
- Create: `api/_functions/quotation-delivery-worker.ts`
- Create: `tests/unit/evolution-webhook.test.ts`
- Create: `tests/unit/quotation-delivery-worker.test.ts`
- Modify: `api/_lib/auth.ts:5-50`
- Modify: `api/[...path].ts:12-104,106-134`
- Modify: `scripts/dev-api-server.mjs:8-104`
- Modify: `scripts/app-server.mjs:16-111,200-220`
- Modify: `tests/unit/route-map.test.ts:6-63`
- Modify: `vercel.json`

**Interfaces:**

- Consumes: `applyEvolutionEvent` and `processDue` from Task 5.
- Produces: machine-authenticated `/api/evolution-webhook`, `/api/quotation-delivery-worker`, and registered `/api/quotation-deliveries`.

- [ ] **Step 1: Write failing webhook and worker authentication tests**

```ts
test('webhook rejects missing secret and accepts duplicate known event neutrally', async () => {
  assert.equal((await webhook(event({ authorization: '' }), deps)).statusCode, 401);
  const result = await webhook(event({ authorization: 'Bearer webhook-secret' }), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body!), { received: true });
});

test('worker requires CRON_SECRET and bounds the batch', async () => {
  assert.equal((await worker(event({ authorization: 'Bearer wrong' }), deps)).statusCode, 401);
  const result = await worker(event({ authorization: 'Bearer cron-secret' }), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(processDueCalls, [20]);
});
```

Also test wrong instance, non-`MESSAGES_UPDATE`, `fromMe: false`, missing `keyId`, invalid status, oversized body, and no secret configured.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/evolution-webhook.test.ts tests/unit/quotation-delivery-worker.test.ts tests/unit/route-map.test.ts
```

Expected: FAIL because handlers and routes do not exist.

- [ ] **Step 3: Implement constant-time bearer authentication**

Use a shared local helper in each handler or a focused helper in `api/_lib/machine-auth.ts` only if both implementations are byte-identical.
The comparison must reject absent secrets and length mismatch before `timingSafeEqual`.

Webhook requirements:

- `POST` only;
- body limit of 64 KiB enforced before JSON parsing;
- `Authorization` checked against `EVOLUTION_WEBHOOK_SECRET`;
- both machine secrets must contain at least 32 UTF-8 bytes;
- `instance` equals configured `EVOLUTION_INSTANCE`;
- `event` normalizes to `messages.update`;
- only `fromMe === true` and known statuses reach the module;
- unknown message IDs still return `200`.

Worker requirements:

- `GET` or `POST`;
- `Authorization` checked against `CRON_SECRET`;
- call `processDue(20)`;
- return counts only.

- [ ] **Step 4: Mark machine routes explicitly at the outer boundary**

Add to `api/_lib/auth.ts`:

```ts
const MACHINE_ROUTES = new Set(['evolution-webhook', 'quotation-delivery-worker']);

export function isMachineRoute(routeName: string): boolean {
  return MACHINE_ROUTES.has(routeName);
}
```

`isAuthenticated` returns true for machine routes only so their own bearer guard can run.
In `api/[...path].ts` and `scripts/app-server.mjs`, skip the generic per-user rate limiter for machine routes.
Do not skip each handler's bearer authentication.
The local development server continues its documented auth bypass.

- [ ] **Step 5: Register all three routes in all maps**

Add imports and entries for:

```text
evolution-webhook
quotation-deliveries
quotation-delivery-worker
```

Update the route-map test from 44 to 47 and add all three names to its required list.

- [ ] **Step 6: Configure Vercel cron**

Add:

```json
"crons": [
  {
    "path": "/api/quotation-delivery-worker",
    "schedule": "* * * * *"
  }
]
```

Keep `api/[...path].ts` at `maxDuration: 60`.
Do not place secret values in `vercel.json`.

- [ ] **Step 7: Run machine endpoint, route, and auth tests**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/evolution-webhook.test.ts tests/unit/quotation-delivery-worker.test.ts tests/unit/route-map.test.ts tests/unit/auth.test.ts tests/unit/rate-limit.test.ts
```

Expected: all tests PASS and route count is exactly 47 in every map.

- [ ] **Step 8: Commit machine endpoints and routes**

```bash
git add api/_functions/evolution-webhook.ts api/_functions/quotation-delivery-worker.ts api/_lib/auth.ts 'api/[...path].ts' scripts/dev-api-server.mjs scripts/app-server.mjs tests/unit/evolution-webhook.test.ts tests/unit/quotation-delivery-worker.test.ts tests/unit/route-map.test.ts vercel.json
git commit -m "feat(whatsapp): reconcile delivery receipts"
```

### Task 8: Frontend Delivery Client, Polling, and Shared Status

**Files:**

- Create: `src/lib/quotationDeliveryApi.ts`
- Create: `src/hooks/useQuotationDeliveries.ts`
- Create: `src/components/QuotationDeliveryStatus.tsx`
- Create: `tests/unit/quotation-delivery-api.test.ts`
- Modify: `src/lib/communicationApi.ts:334-493`
- Modify: `src/components/WhatsAppSendPanel.tsx:10-109`

**Interfaces:**

- Consumes: public JSON from Task 6.
- Produces: `DeliveryView`, `DeliveryIdentity`, `fetchDelivery`, `listDeliveries`, `enqueueDelivery`, `resolveDelivery`, `useQuotationDeliveries`, and shared status rendering.

- [ ] **Step 1: Write failing projection and polling-policy tests**

```ts
test('projector distinguishes provider acceptance from device delivery', () => {
  assert.equal(
    projectDelivery(fixture({ state: 'provider_accepted' })).label,
    'Aceito pela Evolution'
  );
  assert.equal(projectDelivery(fixture({ state: 'delivered' })).label, 'Entregue');
  assert.equal(projectDelivery(fixture({ state: 'needs_review' })).requiresAction, true);
});

test('polling stops only for terminal states', () => {
  assert.equal(deliveryPollDelay('processing'), 1_500);
  assert.equal(deliveryPollDelay('provider_accepted'), 5_000);
  assert.equal(deliveryPollDelay('reconciling'), 5_000);
  assert.equal(deliveryPollDelay('retry_scheduled'), 15_000);
  assert.equal(deliveryPollDelay('delivered'), null);
  assert.equal(deliveryPollDelay('failed'), null);
  assert.equal(deliveryPollDelay('needs_review'), null);
});
```

Also reject missing IDs, unknown states, invalid steps, invalid timestamps, and unbounded list metadata.

- [ ] **Step 2: Run client test and verify red**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/quotation-delivery-api.test.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement strict public types and HTTP functions**

```ts
export type DeliveryState =
  | 'queued'
  | 'processing'
  | 'provider_accepted'
  | 'reconciling'
  | 'retry_scheduled'
  | 'needs_review'
  | 'delivered'
  | 'failed';

export type DeliveryIdentity = { revisionId: string; flowId: string };
export type DeliveryResolution = 'confirmed_received' | 'confirmed_not_received';

export interface DeliveryListFilters {
  states?: DeliveryState[];
  search?: string;
  from?: string;
  to?: string;
  requiresAction?: boolean;
  includeActive?: boolean;
  delayed?: boolean;
  page: number;
  pageSize: number;
}

export interface DeliveryStepView {
  id: string;
  position: number;
  type: 'text' | 'media' | 'quotation_pdf';
  state:
    | 'queued'
    | 'sending'
    | 'server_ack'
    | 'reconciling'
    | 'retry_scheduled'
    | 'needs_review'
    | 'delivered'
    | 'read'
    | 'failed';
  attemptCount: number;
  publicError: string | null;
  updatedAt: string;
}

export interface DeliveryPage {
  data: DeliveryView[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    active: number;
    requiresAction: number;
    retryScheduled: number;
    delayed: number;
    deliveredLast24Hours: number;
  };
}

export interface DeliveryView {
  id: string;
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  state: DeliveryState;
  publicError: string | null;
  completionSource: 'provider_receipt' | 'operator' | 'legacy_provider_ack' | null;
  progress: { delivered: number; total: number };
  steps: DeliveryStepView[];
  nextAttemptAt: string | null;
  reconciliationDeadline: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}
```

Functions:

```ts
fetchDelivery(identityOrId: DeliveryIdentity | { id: string }): Promise<DeliveryView | null>;
listDeliveries(filters: DeliveryListFilters): Promise<DeliveryPage>;
enqueueDelivery(input: DeliveryIdentity & { quotationId: string }): Promise<DeliveryView>;
resolveDelivery(id: string, decision: DeliveryResolution, note: string): Promise<DeliveryView>;
deliveryPollDelay(state: DeliveryState): number | null;
```

Validate every response before returning it.

- [ ] **Step 4: Implement one shared polling hook**

```ts
export function useQuotationDeliveries(identities: DeliveryIdentity[]) {
  return {
    deliveriesByKey,
    pendingKeys,
    errorByKey,
    enqueue,
    refresh,
  };
}
```

Requirements:

- deduplicate identities by `revisionId + flowId`;
- fetch on mount and identity changes;
- schedule one timer for the earliest active delivery;
- clear timers on unmount;
- keep last durable state if one poll fails;
- never expire or delete reconciliation state locally;
- update the map immediately from enqueue and resolution responses.

- [ ] **Step 5: Update shared status presentation**

`QuotationDeliveryStatus` displays:

- `Na fila`;
- `Enviando`;
- `Aceito pela Evolution`;
- `Reconciliação em andamento`;
- `Nova tentativa agendada`;
- `Revisão necessária`;
- `Entregue`;
- `Falhou`.

Show delivered-step progress and last update.
Show manual actions only when `needs_review` or delayed provider acceptance permits them.
Require a confirmation dialog and a 3-to-500-character note.
Use `aria-live="polite"` for status and keep buttons keyboard-accessible.

Update `WhatsAppSendPanel` to accept `DeliveryView | null` plus pending state instead of the old transient union.
Keep the flow selector unchanged.

- [ ] **Step 6: Run frontend client tests and build**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-delivery-api.test.ts tests/unit/communication-api.test.ts
npm run build
```

Expected: tests PASS and Vite build succeeds.

- [ ] **Step 7: Commit frontend delivery primitives**

```bash
git add src/lib/quotationDeliveryApi.ts src/hooks/useQuotationDeliveries.ts src/components/QuotationDeliveryStatus.tsx src/lib/communicationApi.ts src/components/WhatsAppSendPanel.tsx tests/unit/quotation-delivery-api.test.ts
git commit -m "feat(ui): track durable WhatsApp delivery"
```

### Task 9: Integrate Auto Quote and Quotation Detail

**Files:**

- Modify: `src/pages/AutoQuotePage.tsx:45-49,515-680`
- Modify: `src/components/SplitResultCard.tsx:42-64,561-566,634-743`
- Modify: `src/pages/QuotationDetailPage.tsx:157-245,699-717,1170-1191`
- Create: `tests/quotation-delivery-status.spec.js`
- Modify: `tests/task-8-fix-r4.spec.js`

**Interfaces:**

- Consumes: `useQuotationDeliveries` and `QuotationDeliveryStatus` from Task 8.
- Produces: durable per-revision-flow state on both quotation surfaces.

- [ ] **Step 1: Write failing Playwright tests for the exact user experience**

Test Auto Quote:

```js
test('single click persists status across reload and never offers blind retry', async ({
  page,
}) => {
  await mockIssuedQuotation(page);
  await mockDeliveryLifecycle(page, ['queued', 'processing', 'provider_accepted', 'delivered']);
  await page.goto('/#/auto');
  await issueAndSend(page);
  await expect(page.getByText('Aceito pela Evolution')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Aceito pela Evolution')).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar via whatsapp/i })).toBeDisabled();
  await expect(page.getByText('Entregue')).toBeVisible();
});
```

Test Quotation Detail loads the same mocked delivery without clicking send.
Test flow switching uses a distinct `revisionId + flowId` status.
Test `needs_review` exposes only the two explicit manual decisions.
Test polling failure keeps the last status and shows a non-destructive warning.

- [ ] **Step 2: Run Playwright test and verify red**

Run:

```bash
npx playwright test tests/quotation-delivery-status.spec.js
```

Expected: FAIL because pages still use transient state.

- [ ] **Step 3: Replace Auto Quote transient status**

Build identities from issued drafts and selected flows with `useMemo`.
Call `useQuotationDeliveries` once at page level.
Replace `waStatusByContext`, reconciliation expiry timers, and local success projection with hook state.
`handleSendWhatsApp` calls hook `enqueue` once and does not manufacture `sent` or `reconciling` labels.
Keep `activeSendKeys` only as a same-render click optimization; backend idempotency remains authoritative.

Remove `scheduleReconciliationExpiry` entirely.
Never delete a durable status after a timeout.

- [ ] **Step 4: Update Split Result Card**

Pass `DeliveryView | null` and pending state to `WhatsAppSendPanel` and `QuotationDeliveryStatus`.
Disable send when the state is not `failed` and not absent.
A `failed` delivery requires a new revision unless the backend reports an explicit allowed action.
Keep PDF preview and revision controls unchanged.

- [ ] **Step 5: Replace Quotation Detail one-shot status**

Use the same hook with one identity.
Remove the `fetchFlows().then(...fetchDeliveryStatus...)` one-shot chain.
Send through hook `enqueue`.
Render `QuotationDeliveryStatus` under the flow selector.
Do not map provider acceptance to `completed` locally.

- [ ] **Step 6: Run focused E2E and existing WhatsApp UI tests**

Run:

```bash
npx playwright test tests/quotation-delivery-status.spec.js tests/task-8-fix-r4.spec.js tests/quotation-issue.spec.js
```

Expected: all tests PASS.
Update obsolete assertions only where the approved delivery vocabulary changed.
Do not weaken duplicate-send assertions.

- [ ] **Step 7: Commit quotation surface integration**

```bash
git add src/pages/AutoQuotePage.tsx src/components/SplitResultCard.tsx src/pages/QuotationDetailPage.tsx tests/quotation-delivery-status.spec.js tests/task-8-fix-r4.spec.js
git commit -m "feat(ui): show persistent delivery status"
```

### Task 10: Global WhatsApp Delivery Outbox

**Files:**

- Create: `src/pages/WhatsAppDeliveriesPage.tsx`
- Modify: `src/App.tsx:8-23,65-105`
- Modify: `src/components/layout/Sidebar.tsx:3-55`
- Create: `tests/whatsapp-deliveries.spec.js`

**Interfaces:**

- Consumes: `listDeliveries`, `resolveDelivery`, and `QuotationDeliveryStatus` from Task 8.
- Produces: `/whatsapp-deliveries` operational page and **Envios WhatsApp** navigation item.

- [ ] **Step 1: Write failing global-outbox E2E test**

```js
test('outbox defaults to actionable work and resolves one delivery', async ({ page }) => {
  await mockDeliveryList(page, [needsReviewDelivery, processingDelivery, deliveredDelivery]);
  await page.goto('/#/whatsapp-deliveries');
  await expect(page.getByRole('heading', { name: 'Envios WhatsApp' })).toBeVisible();
  await expect(page.getByText(needsReviewDelivery.business_number)).toBeVisible();
  await expect(page.getByText(processingDelivery.business_number)).toBeVisible();
  await expect(page.getByText(deliveredDelivery.business_number)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cliente confirmou recebimento' }).click();
  await page.getByLabel('Justificativa').fill('Cliente confirmou recebimento por ligação.');
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect(page.getByText('Entregue')).toBeVisible();
});
```

Also test state filters, search, pagination, delayed accepted delivery, empty state, API failure, phone formatting, and no raw provider ID.

- [ ] **Step 2: Run page test and verify red**

Run:

```bash
npx playwright test tests/whatsapp-deliveries.spec.js
```

Expected: FAIL because route and page do not exist.

- [ ] **Step 3: Implement the page**

Use existing `PageHeader`, button, input, badge, and table patterns.
Default query:

```ts
{
  requiresAction: true,
  includeActive: true,
  page: 1,
  pageSize: 25,
}
```

When both flags are true, the backend returns the union of actionable and active rows rather than requiring both predicates.

Render summary counters for active, requires action, retry scheduled, delayed, and delivered in the last 24 hours.

Render columns:

- orçamento;
- cliente;
- telefone formatado;
- fluxo;
- passos entregues/total;
- estado;
- última atualização;
- ação.

Filters:

- requer ação;
- em processamento;
- retry agendado;
- atrasados;
- entregues;
- falhos;
- busca;
- período.

Reuse `QuotationDeliveryStatus` for expanded detail and resolution.
Do not add charting, export, bulk retry, websocket, or notification infrastructure.

- [ ] **Step 4: Register route and navigation**

Lazy-load `WhatsAppDeliveriesPage` in `App.tsx`.
Map `/whatsapp-deliveries` to the page.
Add `{ hash: '/whatsapp-deliveries', label: 'Envios WhatsApp', icon: Send }` to the **Operacional** section after WhatsApp.

- [ ] **Step 5: Run page E2E and accessibility-focused assertions**

Run:

```bash
npx playwright test tests/whatsapp-deliveries.spec.js
npm run build
```

Expected: E2E PASS and build succeeds.
Manually inspect desktop and mobile screenshots generated by Playwright for overflow, clipped actions, ambiguous labels, and color-only state communication.

- [ ] **Step 6: Commit the outbox page**

```bash
git add src/pages/WhatsAppDeliveriesPage.tsx src/App.tsx src/components/layout/Sidebar.tsx tests/whatsapp-deliveries.spec.js
git commit -m "feat(ui): add WhatsApp delivery outbox"
```

### Task 11: Fault-Injection Coverage, Legacy Cleanup, and Operations

**Files:**

- Modify: `tests/unit/quotation-delivery-outbox.test.ts`
- Modify: `tests/unit/quotation-delivery-outbox-postgres.test.ts`
- Modify: `tests/quotation-delivery-status.spec.js`
- Modify: `tests/whatsapp-deliveries.spec.js`
- Modify: `docs/operational-cutoff-procedure.md`
- Modify: `scripts/check-no-legacy-provider.mjs`
- Delete after controlled staging validation: `api/_functions/lib/whatsapp-send-reservation-store.ts`
- Delete after controlled staging validation: `api/_functions/lib/quotation-delivery.ts`
- Modify after controlled staging validation: `api/_functions/send-whatsapp-flow.ts`
- Modify after controlled staging validation: `tests/unit/send-whatsapp-idempotency.test.ts`
- Modify after controlled staging validation: `tests/unit/send-whatsapp-review-r1.test.ts`

**Interfaces:**

- Consumes: complete backend and frontend lifecycle from Tasks 1 through 10.
- Produces: regression evidence for crashes, ambiguity, duplicate events, operator recovery, and removal of Redis reservation correctness.

- [ ] **Step 1: Add the complete fault matrix before cleanup**

Add deterministic tests for:

```text
worker crash after claim but before transport
worker crash after provider acceptance but before local persistence
two workers claiming the same due step
HTTP 5xx after provider may have accepted
malformed HTTP 2xx
provider key persisted before later bookkeeping failure
duplicate SERVER_ACK
delayed DELIVERY_ACK after needs_review
READ arriving before DELIVERY_ACK
accepted step followed by retryable next step
browser reload during processing
browser absent while cron completes delivery
manual confirmed_not_received requeues unresolved steps only
```

Every case must assert transport call count and final persisted state.
No test may assert only an HTTP status.

- [ ] **Step 2: Run the fault matrix**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/quotation-delivery-outbox.test.ts tests/unit/quotation-delivery-outbox-postgres.test.ts tests/unit/evolution-webhook.test.ts
npx playwright test tests/quotation-delivery-status.spec.js tests/whatsapp-deliveries.spec.js
```

Expected: all tests PASS; PostgreSQL tests report no skips.

- [ ] **Step 3: Document operational configuration without values**

Add names only:

```text
EVOLUTION_WEBHOOK_SECRET
CRON_SECRET
EVOLUTION_INSTANCE
```

Document:

1. configure Evolution `MESSAGES_UPDATE` webhook with custom `Authorization` header;
2. confirm `/api/evolution-webhook` rejects missing or wrong bearer;
3. confirm Vercel cron invokes `/api/quotation-delivery-worker` every minute;
4. inspect **Envios WhatsApp** for active and actionable rows;
5. execute one real controlled delivery using an existing approved quotation and designated recipient;
6. verify every provider message ID reaches `DELIVERY_ACK`;
7. verify no secrets or phone numbers appear in logs;
8. roll back code without rolling back migration because the migration is additive and legacy rows remain readable.

Never write secret values into the repository or command output.

- [ ] **Step 4: Perform controlled staging validation**

Run preflight first:

```bash
node scripts/cutover-env-status.mjs
npm run test:e2e:staging -- --list
```

Then execute the existing controlled quotation identified by operator environment variables.
Do not create a quotation fixture.
Confirm webhook receipt, worker run, device delivery, page state, and no duplicate message.

If staging cannot produce `DELIVERY_ACK`, stop here and keep Redis reservation code until the provider configuration is corrected.

- [ ] **Step 5: Remove Redis reservation correctness after staging passes**

Delete `whatsapp-send-reservation-store.ts` and remove imports from live send and status handlers.
Delete the unused `createDeliverQuotation` module.
Rewrite old idempotency tests against the PostgreSQL outbox identity and transport-call count.
Extend `scripts/check-no-legacy-provider.mjs` to reject new imports of either deleted module.
Keep `/api/whatsapp-send-status` as a PostgreSQL compatibility adapter.

- [ ] **Step 6: Run complete local verification**

Run:

```bash
npm test
npm run check
node scripts/check-no-legacy-provider.mjs
git diff --check
```

Expected:

- all unit tests PASS;
- all local E2E tests PASS;
- lint PASS;
- type-check PASS;
- Tailwind check PASS;
- API build PASS;
- Vite build PASS;
- legacy-provider check PASS;
- diff check produces no output.

- [ ] **Step 7: Run final diagnostics**

Run LSP diagnostics on all changed TypeScript and TSX files.
Run `lens_diagnostics` with `mode=all` and resolve every blocking error and actionable warning introduced by this work.

- [ ] **Step 8: Commit cleanup and operations**

```bash
git add api src tests scripts docs vercel.json drizzle
git commit -m "refactor(whatsapp): retire Redis send locks" -m "PostgreSQL outbox and Evolution receipts now own delivery correctness. Legacy state remains readable through the compatibility endpoint."
```

## Final Acceptance Audit

Before push or deployment, verify each spec criterion against fresh evidence:

- [ ] One click creates one durable row visible on both quotation surfaces and the global outbox.
- [ ] Closing the browser does not stop processing or recovery.
- [ ] Duplicate clicks, tabs, and workers do not duplicate delivery.
- [ ] Two flows for one revision create independent identities.
- [ ] Success appears only after all mandatory steps are delivered or read.
- [ ] Accepted steps never resend automatically.
- [ ] Only transient pre-transport failures retry automatically.
- [ ] Ambiguous outcomes never retry automatically.
- [ ] Unresolved ambiguity becomes visible `needs_review` work.
- [ ] Auto Quote, Detail, and Envios WhatsApp show one consistent state.
- [ ] Duplicate and out-of-order webhooks remain monotonic.
- [ ] Legacy rows, CRM, revisions, and quote leads remain intact.
- [ ] Logs and HTTP responses contain no personal data, secrets, or internal provider payloads.
- [ ] Local tests perform no staging or real transport.
- [ ] Controlled staging verifies actual `DELIVERY_ACK` without creating a fictitious quotation.
