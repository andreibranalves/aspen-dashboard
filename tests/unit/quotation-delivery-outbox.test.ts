import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EvolutionTransportError,
  sendFrozenStep,
} from '../../api/_modules/evolution-transport.js';
import {
  aggregateDeliveryState,
  applyReceipt,
  retryDelayMs,
} from '../../api/_modules/quotation-delivery-state.js';
import {
  createQuotationDeliveryModule,
  type DeliveryLogEvent,
} from '../../api/_modules/quotation-delivery-outbox.js';
import type {
  ClaimedDeliveryStep,
  DeliveryAggregate,
  DeliveryIdentity,
  DeliveryListFilters,
  DeliveryListResult,
  DeliveryStepView,
  EnqueueDeliveryRecord,
  FrozenDeliveryStep,
  ResolveDeliveryInput,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';

type FakeStep = DeliveryStepView & { reconciliationDeadline: Date | null };
type FakeAggregate = Omit<DeliveryAggregate, 'steps'> & { steps: FakeStep[] };

type PreparedDocument = {
  pdf: Buffer;
  pdfSize: number;
  pdfSignature: string;
  validUntil: Date;
};

type PreparedImage = {
  webp: Buffer;
  webpSize: number;
  webpSignature: string;
  page: number;
  pageCount: number;
  validUntil: Date;
};

const identity: DeliveryIdentity = {
  revisionId: '22222222-2222-4222-8222-222222222222',
  flowId: 'flow-test',
};
const start = new Date('2026-08-17T12:00:00.000Z');

function textStep(position: number, delayMs = 0): FrozenDeliveryStep {
  return {
    position,
    type: 'text',
    payload: { text: `step-${position}` },
    delayMs,
  };
}

function pdfStep(position: number, delayMs = 0): FrozenDeliveryStep {
  return {
    position,
    type: 'quotation_pdf',
    payload: {
      revisionId: identity.revisionId,
      fileName: 'ORC-1.pdf',
      caption: '',
    },
    delayMs,
  };
}

function webpPlaceholderStep(position: number, delayMs = 0): FrozenDeliveryStep {
  return {
    position,
    type: 'quotation_webp',
    payload: {
      revisionId: identity.revisionId,
      fileName: 'ORC-1.webp',
      caption: 'Orçamento',
      page: 0,
      pageCount: 0,
    },
    delayMs,
  };
}

function plan(steps: FrozenDeliveryStep[] = [textStep(0), textStep(1)]): {
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  steps: FrozenDeliveryStep[];
} {
  return {
    revisionId: identity.revisionId,
    businessNumber: 'ORC-1',
    clientName: 'Cliente',
    phone: '5511999990000',
    flowId: identity.flowId,
    flowName: 'Fluxo teste',
    steps,
  };
}

function copyStep(step: FakeStep): FakeStep {
  return {
    ...step,
    reconciliationDeadline: step.reconciliationDeadline && new Date(step.reconciliationDeadline),
    nextAttemptAt: step.nextAttemptAt && new Date(step.nextAttemptAt),
    acceptedAt: step.acceptedAt && new Date(step.acceptedAt),
    deliveredAt: step.deliveredAt && new Date(step.deliveredAt),
    readAt: step.readAt && new Date(step.readAt),
    updatedAt: new Date(step.updatedAt),
  };
}

class FakeRepository {
  readonly rows = new Map<
    string,
    {
      aggregate: FakeAggregate;
      snapshots: FrozenDeliveryStep[];
      leaseToken?: string;
      leaseUntil?: Date;
      providerIds?: Map<string, string>;
    }
  >();
  private sequence = 0;
  readonly clock: () => Date;
  readonly failAfterAcceptedPersistence: boolean;
  constructor(clock: () => Date, options: { failAfterAcceptedPersistence?: boolean } = {}) {
    this.clock = clock;
    this.failAfterAcceptedPersistence = options.failAfterAcceptedPersistence === true;
  }

  private clone(row: {
    aggregate: FakeAggregate;
    snapshots: FrozenDeliveryStep[];
  }): DeliveryAggregate {
    return {
      ...row.aggregate,
      createdAt: new Date(row.aggregate.createdAt),
      updatedAt: new Date(row.aggregate.updatedAt),
      nextAttemptAt: row.aggregate.nextAttemptAt && new Date(row.aggregate.nextAttemptAt),
      actionDeadline: row.aggregate.actionDeadline && new Date(row.aggregate.actionDeadline),
      reconciliationDeadline:
        row.aggregate.reconciliationDeadline && new Date(row.aggregate.reconciliationDeadline),
      deliveredAt: row.aggregate.deliveredAt && new Date(row.aggregate.deliveredAt),
      steps: row.aggregate.steps.map(copyStep),
    };
  }

  private sync(row: { aggregate: FakeAggregate; snapshots: FrozenDeliveryStep[] }): void {
    const now = this.clock();
    row.aggregate.state = aggregateDeliveryState(row.aggregate.steps.map((step) => step.state));
    row.aggregate.nextAttemptAt =
      row.aggregate.steps
        .filter(
          (step) =>
            (step.state === 'queued' || step.state === 'retry_scheduled') && step.nextAttemptAt
        )
        .map((step) => step.nextAttemptAt!)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;
    row.aggregate.reconciliationDeadline =
      row.aggregate.steps
        .filter((step) => step.state === 'reconciling' && step.reconciliationDeadline)
        .map((step) => step.reconciliationDeadline!)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;
    row.aggregate.updatedAt = now;
    row.aggregate.actionDeadline =
      row.aggregate.state === 'provider_accepted' ? new Date(now.getTime() + 86_400_000) : null;
    if (row.aggregate.state === 'delivered') {
      row.aggregate.deliveredAt ||= now;
      row.aggregate.publicError = null;
    }
  }

  async enqueue(input: EnqueueDeliveryRecord): Promise<DeliveryAggregate> {
    const existing = [...this.rows.values()].find(
      (row) =>
        row.aggregate.revisionId === input.revisionId && row.aggregate.flowId === input.flowId
    );
    if (existing) return this.clone(existing);
    const now = this.clock();
    const id = `delivery-${++this.sequence}`;
    const aggregate: FakeAggregate = {
      id,
      revisionId: input.revisionId,
      businessNumber: 'ORC-1',
      clientName: 'Cliente',
      phone: input.phone,
      flowId: input.flowId,
      flowName: input.flowName,
      state: 'queued',
      completionSource: null,
      publicError: null,
      nextAttemptAt: null,
      actionDeadline: null,
      reconciliationDeadline: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
      steps: input.steps.map((snapshot) => ({
        id: `${id}-step-${snapshot.position}`,
        position: snapshot.position,
        type: snapshot.type,
        state: 'queued',
        attemptCount: 0,
        publicError: null,
        nextAttemptAt: snapshot.position === 0 ? new Date(now.getTime() + snapshot.delayMs) : null,
        reconciliationDeadline: null,
        acceptedAt: null,
        deliveredAt: null,
        readAt: null,
        updatedAt: now,
      })),
    };
    const row = { aggregate, snapshots: input.steps };
    this.rows.set(id, row);
    return this.clone(row);
  }

  async get(id: string): Promise<DeliveryAggregate | null> {
    const row = this.rows.get(id);
    return row ? this.clone(row) : null;
  }

  async getByIdentity(value: DeliveryIdentity): Promise<DeliveryAggregate | null> {
    const row = [...this.rows.values()].find(
      (candidate) =>
        candidate.aggregate.revisionId === value.revisionId &&
        candidate.aggregate.flowId === value.flowId
    );
    return row ? this.clone(row) : null;
  }

  async list(_filters: DeliveryListFilters): Promise<DeliveryListResult> {
    const data = [...this.rows.values()].map((row) => this.clone(row));
    return {
      data,
      total: data.length,
      summary: {
        active: 0,
        requiresAction: 0,
        retryScheduled: 0,
        delayed: 0,
        deliveredLast24Hours: 0,
      },
    };
  }

  async claim(input: { deliveryId?: string } = {}): Promise<ClaimedDeliveryStep | null> {
    const now = this.clock();
    const rows = [...this.rows.values()].filter(
      (row) => !input.deliveryId || row.aggregate.id === input.deliveryId
    );
    for (const row of rows) {
      if (row.leaseToken && row.leaseUntil && row.leaseUntil > now) continue;
      if (row.leaseToken && row.leaseUntil && row.leaseUntil <= now) {
        for (const step of row.aggregate.steps) {
          if (step.state === 'sending' && !step.acceptedAt) {
            step.state = 'reconciling';
            step.reconciliationDeadline = new Date(now.getTime() + 120_000);
            step.nextAttemptAt = null;
            step.updatedAt = now;
          }
        }
        row.leaseToken = undefined;
        row.leaseUntil = undefined;
        this.sync(row);
      }
      for (const step of row.aggregate.steps) {
        const previous = row.aggregate.steps
          .filter((candidate) => candidate.position < step.position)
          .some((candidate) => !['server_ack', 'delivered', 'read'].includes(candidate.state));
        if (previous) continue;
        const due = Boolean(step.nextAttemptAt && step.nextAttemptAt <= now);
        if (!due || !['queued', 'retry_scheduled'].includes(step.state)) continue;
        step.state = 'sending';
        step.attemptCount += 1;
        step.nextAttemptAt = null;
        step.updatedAt = now;
        row.leaseToken = `lease-${++this.sequence}`;
        row.leaseUntil = new Date(now.getTime() + 90_000);
        this.sync(row);
        return {
          delivery: this.clone(row),
          step: {
            ...copyStep(step),
            snapshot: row.snapshots[step.position]!,
          },
          leaseToken: row.leaseToken,
        };
      }
    }
    return null;
  }

  async renewLease(input: {
    deliveryId: string;
    stepId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.deliveryId)!;
    const step = row.aggregate.steps.find((candidate) => candidate.id === input.stepId);
    if (!step || step.state !== 'sending') return false;
    if (row.leaseToken !== input.leaseToken) return false;
    row.leaseUntil = new Date(this.clock().getTime() + 90_000);
    return true;
  }

  async markAccepted(input: {
    deliveryId: string;
    stepId: string;
    leaseToken: string;
    providerMessageId: string;
  }): Promise<DeliveryAggregate> {
    const row = this.rows.get(input.deliveryId)!;
    assert.equal(row.leaseToken, input.leaseToken);
    const step = row.aggregate.steps.find((candidate) => candidate.id === input.stepId)!;
    step.state = 'server_ack';
    step.acceptedAt = this.clock();
    step.publicError = null;
    step.updatedAt = this.clock();
    const next = row.aggregate.steps.find((candidate) => candidate.position === step.position + 1);
    if (next && next.state === 'queued') {
      const delay = row.snapshots[next.position]!.delayMs;
      next.nextAttemptAt = new Date(this.clock().getTime() + delay);
    }
    row.leaseToken = undefined;
    row.leaseUntil = undefined;
    this.sync(row);
    (row.providerIds ||= new Map()).set(step.id, input.providerMessageId);
    if (this.failAfterAcceptedPersistence) throw new Error('bookkeeping failed after acceptance');
    return this.clone(row);
  }

  async markFailure(input: {
    deliveryId: string;
    stepId: string;
    leaseToken: string;
    kind: 'transient_pre_transport' | 'permanent_pre_transport' | 'ambiguous';
    code: string;
    publicError: string;
  }): Promise<DeliveryAggregate> {
    const row = this.rows.get(input.deliveryId)!;
    assert.equal(row.leaseToken, input.leaseToken);
    const step = row.aggregate.steps.find((candidate) => candidate.id === input.stepId)!;
    const now = this.clock();
    const delay = input.kind === 'transient_pre_transport' ? retryDelayMs(step.attemptCount) : null;
    step.state =
      delay === null && input.kind === 'transient_pre_transport'
        ? 'failed'
        : input.kind === 'transient_pre_transport'
          ? 'retry_scheduled'
          : input.kind === 'permanent_pre_transport'
            ? 'failed'
            : 'reconciling';
    step.nextAttemptAt = step.state === 'retry_scheduled' ? new Date(now.getTime() + delay!) : null;
    step.reconciliationDeadline =
      step.state === 'reconciling' ? new Date(now.getTime() + 120_000) : null;
    step.publicError = input.publicError;
    step.updatedAt = now;
    row.aggregate.publicError = input.publicError;
    row.leaseToken = undefined;
    row.leaseUntil = undefined;
    this.sync(row);
    return this.clone(row);
  }

  async receiveReceipt(input: {
    providerMessageId: string;
    status: 'ERROR' | 'PENDING' | 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ' | 'PLAYED';
  }): Promise<DeliveryAggregate | null> {
    for (const row of this.rows.values()) {
      const step =
        row.providerIds &&
        [...row.providerIds.entries()].find(([, id]) => id === input.providerMessageId)?.[0];
      const view = step && row.aggregate.steps.find((candidate) => candidate.id === step);
      if (!view) continue;
      const state = applyReceipt(view.state, input.status);
      view.state = state;
      const now = this.clock();
      if (state === 'delivered' || state === 'read') view.deliveredAt ||= now;
      if (state === 'read') view.readAt ||= now;
      view.updatedAt = now;
      this.sync(row);
      if (row.aggregate.state === 'delivered' && row.aggregate.completionSource !== 'operator') {
        row.aggregate.completionSource = 'provider_receipt';
      }
      return this.clone(row);
    }
    return null;
  }

  async expireReconciliations(limit: number): Promise<number> {
    const now = this.clock();
    let count = 0;
    for (const row of this.rows.values()) {
      if (count >= limit) break;
      if (row.aggregate.state !== 'reconciling') continue;
      if (!row.aggregate.reconciliationDeadline || row.aggregate.reconciliationDeadline > now)
        continue;
      for (const step of row.aggregate.steps) {
        if (step.state === 'reconciling') {
          step.state = 'needs_review';
          step.reconciliationDeadline = null;
          step.updatedAt = now;
        }
      }
      this.sync(row);
      count += 1;
    }
    return count;
  }

  async cancelPending(): Promise<number> {
    const now = this.clock();
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.aggregate.state !== 'queued' && row.aggregate.state !== 'retry_scheduled') continue;
      if (row.leaseToken) continue;
      for (const step of row.aggregate.steps) {
        if (step.state === 'queued' || step.state === 'retry_scheduled') {
          step.state = 'failed';
          step.nextAttemptAt = null;
          step.publicError = 'Cancelada pelo operador.';
          step.updatedAt = now;
        }
      }
      row.aggregate.state = 'failed';
      row.aggregate.completionSource = 'operator';
      row.aggregate.publicError = 'Cancelada pelo operador.';
      row.aggregate.nextAttemptAt = null;
      row.aggregate.updatedAt = now;
      count += 1;
    }
    return count;
  }

  async expandQuotationWebpStep(input: {
    deliveryId: string;
    stepId: string;
    leaseToken: string;
    steps: Array<Extract<FrozenDeliveryStep, { type: 'quotation_webp' }>>;
  }): Promise<void> {
    const row = this.rows.get(input.deliveryId)!;
    assert.equal(row.leaseToken, input.leaseToken);
    const index = row.aggregate.steps.findIndex((step) => step.id === input.stepId);
    assert.ok(index >= 0);
    const current = row.aggregate.steps[index]!;
    assert.equal(current.state, 'sending');
    const now = this.clock();
    row.snapshots = [
      ...row.snapshots.slice(0, index),
      ...input.steps,
      ...row.snapshots.slice(index + 1),
    ].map((snapshot, position) => ({ ...snapshot, position }));
    row.aggregate.steps = [
      ...row.aggregate.steps.slice(0, index),
      ...input.steps.map((snapshot, pageIndex) => ({
        ...current,
        id: pageIndex === 0 ? current.id : `${current.id}-page-${pageIndex + 1}`,
        position: index + pageIndex,
        type: snapshot.type,
        state: 'queued' as const,
        attemptCount: 0,
        publicError: null,
        nextAttemptAt: pageIndex === 0 ? now : null,
        reconciliationDeadline: null,
        acceptedAt: null,
        deliveredAt: null,
        readAt: null,
        updatedAt: now,
      })),
      ...row.aggregate.steps.slice(index + 1).map((step) => ({
        ...step,
        position: step.position + input.steps.length - 1,
      })),
    ];
    row.leaseToken = undefined;
    row.leaseUntil = undefined;
    this.sync(row);
  }

  async resolve(_input: ResolveDeliveryInput): Promise<DeliveryAggregate> {
    throw new Error('not used');
  }
}

class FakeTransport {
  readonly calls: Array<{ phone: string; step: FrozenDeliveryStep; document?: unknown; image?: unknown }> = [];
  private failures = new Map<number, Error>();

  failAt(callNumber: number, error: Error): void {
    this.failures.set(callNumber, error);
  }

  async send(input: { phone: string; step: FrozenDeliveryStep; document?: unknown; image?: unknown }) {
    this.calls.push(input);
    const failure = this.failures.get(this.calls.length);
    if (failure) throw failure;
    return { accepted: true as const, providerMessageId: `provider-${this.calls.length}` };
  }
}

function dependencies(
  options: {
    steps?: FrozenDeliveryStep[];
    clock?: { value: Date };
    repository?: FakeRepository;
    transport?: FakeTransport;
    preparePdf?: (revisionId: string) => Promise<PreparedDocument>;
    prepareImages?: (revisionId: string) => Promise<PreparedImage[]>;
    logger?: (event: DeliveryLogEvent) => void;
    failAfterAcceptedPersistence?: boolean;
    transportSend?: (
      input: { phone: string; step: FrozenDeliveryStep; document?: unknown; image?: unknown }
    ) => Promise<{ accepted: true; providerMessageId: string }>;
    followUpUpserts?: Array<Record<string, string>>;
    followUpReceiptUpserts?: Array<Record<string, unknown>>;
    activities?: Array<Record<string, unknown>>;
    sleep?: (delayMs: number) => Promise<void>;
    rejectFollowUpUpsert?: boolean;
  } = {}
) {
  const clock = options.clock || { value: new Date(start) };
  const repository =
    options.repository ||
    new FakeRepository(() => new Date(clock.value), {
      failAfterAcceptedPersistence: options.failAfterAcceptedPersistence,
    });
  const transport = options.transport || new FakeTransport();
  const followUpRepository = options.followUpUpserts || options.followUpReceiptUpserts || options.rejectFollowUpUpsert
    ? {
        upsertAwaitingReceiptFromAcceptedDelivery: async (input: Record<string, string>) => {
          if (options.rejectFollowUpUpsert) throw new Error('follow-up db unavailable');
          options.followUpUpserts?.push(input);
        },
        upsertFromDeliveryReceipt: async (input: Record<string, unknown>) => {
          options.followUpReceiptUpserts?.push(input);
        },
      }
    : undefined;
  const planner = async () => plan(options.steps);
  const module = createQuotationDeliveryModule({
    repository,
    planner,
    transport: options.transportSend || transport.send.bind(transport),
    ...(followUpRepository ? { followUpRepository } : {}),
    ...(options.activities
      ? {
          activityRepository: {
            recordActivity: async (input: Record<string, unknown>) => {
              options.activities!.push(input);
            },
          },
        }
      : {}),
    preparePdf:
      options.preparePdf ||
      (async () => ({
        pdf: Buffer.from('%PDF-test'),
        pdfSize: 9,
        pdfSignature: 'test',
        validUntil: new Date(clock.value.getTime() + 86_400_000),
      })),
    ...(options.prepareImages ? { prepareDeliveryImages: options.prepareImages } : {}),
    now: () => new Date(clock.value),
    instance: 'test-instance',
    logger: options.logger || (() => {}),
    sleep: options.sleep,
  });
  return { module, repository, transport, clock };
}

function httpResponse(status: number, body: unknown): Response {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

test('enqueue starts immediately and never resends an accepted step', async () => {
  const { module, transport } = dependencies();
  const first = await module.enqueue(identity);
  assert.equal(first.state, 'provider_accepted');
  assert.equal(transport.calls.length, 2);
  const replay = await module.enqueue(identity);
  assert.equal(replay.id, first.id);
  assert.equal(transport.calls.length, 2);
});

test('accepted first delivery step upserts one follow-up candidate and records numeric outbound activity', async () => {
  const followUpUpserts: Array<Record<string, string>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const { module } = dependencies({
    steps: [textStep(0), textStep(1)],
    followUpUpserts,
    activities,
  });
  const delivery = await module.enqueue(identity);
  assert.equal(delivery.state, 'provider_accepted');
  assert.equal(followUpUpserts.length, 1);
  assert.deepEqual(followUpUpserts[0], {
    deliveryId: delivery.id,
    revisionId: identity.revisionId,
    phone: '5511999990000',
    providerMessageId: 'provider-1',
  });
  assert.deepEqual(activities, [
    {
      instance: 'test-instance',
      providerConversationId: '5511999990000@s.whatsapp.net',
      providerMessageId: 'provider-1',
      fromMe: true,
      occurredAt: new Date(start),
      identityStatus: 'derived',
      canonicalPhone: '5511999990000',
    },
  ]);
});

test('follow-up persistence failure retries after the accepted step is no longer claimable', async () => {
  let fail = true;
  const followUpUpserts: Array<Record<string, string>> = [];
  const events: DeliveryLogEvent[] = [];
  const repository = new FakeRepository(() => new Date(start));
  const followUpRepository = {
    upsertAwaitingReceiptFromAcceptedDelivery: async (input: Record<string, string>) => {
      if (fail) throw new Error('follow-up db unavailable');
      followUpUpserts.push(input);
    },
    listAcceptedDeliveriesMissingFollowUp: async () => {
      const missing: Array<Record<string, string>> = [];
      for (const row of repository.rows.values()) {
        const step = row.aggregate.steps.find((candidate) => candidate.acceptedAt);
        const providerMessageId = step && row.providerIds?.get(step.id);
        if (!step || !providerMessageId) continue;
        if (followUpUpserts.some((entry) => entry.deliveryId === row.aggregate.id)) continue;
        missing.push({
          deliveryId: row.aggregate.id,
          revisionId: row.aggregate.revisionId,
          phone: row.aggregate.phone,
          providerMessageId,
        });
      }
      return { data: missing, hasMore: false };
    },
  };
  const transport = new FakeTransport();
  const module = createQuotationDeliveryModule({
    repository,
    planner: async () => plan([textStep(0)]),
    transport: transport.send.bind(transport),
    followUpRepository,
    logger: (event) => events.push(event),
    now: () => new Date(start),
    instance: 'test-instance',
  });

  const delivery = await module.enqueue(identity);
  assert.equal(delivery.steps[0]!.state, 'server_ack');
  assert.equal(transport.calls.length, 1);
  assert.equal(followUpUpserts.length, 0);
  assert.equal(
    events.some((event) => event.errorCode === 'FOLLOW_UP_ACCEPTANCE_PERSISTENCE'),
    true,
  );

  fail = false;
  await module.process(delivery.id);
  assert.equal(followUpUpserts.length, 1);
  assert.deepEqual(followUpUpserts[0], {
    deliveryId: delivery.id,
    revisionId: identity.revisionId,
    phone: '5511999990000',
    providerMessageId: 'provider-1',
  });
  assert.equal(transport.calls.length, 1);
});

test('duplicate enqueue reuses the durable identity without replanning', async () => {
  const repository = new FakeRepository(() => new Date(start));
  const transport = new FakeTransport();
  let plans = 0;
  const module = createQuotationDeliveryModule({
    repository,
    planner: async () => {
      plans += 1;
      return plan([textStep(0)]);
    },
    transport: transport.send.bind(transport),
    now: () => new Date(start),
    logger: () => {},
  });

  const first = await module.enqueue(identity);
  const replay = await module.enqueue(identity);

  assert.equal(replay.id, first.id);
  assert.equal(plans, 1);
  assert.equal(transport.calls.length, 1);
});

test('ambiguous outcome stops later steps and requires reconciliation', async () => {
  const transport = new FakeTransport();
  transport.failAt(
    1,
    new EvolutionTransportError('Resposta ambígua.', 'ambiguous', 'EVOLUTION_AMBIGUOUS')
  );
  const { module } = dependencies({ transport });
  const result = await module.enqueue(identity);
  assert.equal(result.state, 'reconciling');
  assert.equal(result.steps[0]?.state, 'reconciling');
  assert.equal(transport.calls.length, 1);
});

test('HTTP 5xx and malformed HTTP 2xx never retry an ambiguous transport', async () => {
  for (const [suffix, response] of [
    ['server-error', httpResponse(503, { error: 'provider detail' })],
    ['malformed-success', httpResponse(200, '{')],
  ] as const) {
    let transportCalls = 0;
    const { module } = dependencies({
      transportSend: async (input) => {
        transportCalls += 1;
        return sendFrozenStep(input as Parameters<typeof sendFrozenStep>[0], {
          baseUrl: 'https://evolution.test',
          apiKey: 'test-key',
          instance: 'test-instance',
          fetch: async () => response,
        });
      },
    });
    const result = await module.enqueue({ ...identity, flowId: `http-${suffix}` });
    assert.equal(transportCalls, 1);
    assert.equal(result.state, 'reconciling');
    assert.equal(result.steps[0]?.state, 'reconciling');
    assert.equal((await module.process(result.id))?.state, 'reconciling');
    assert.equal(transportCalls, 1);
  }
});

test('transient failure schedules a bounded retry and permanent failure does not retry', async () => {
  const clock = { value: new Date(start) };
  const transientTransport = new FakeTransport();
  transientTransport.failAt(
    1,
    new EvolutionTransportError(
      'Tente novamente.',
      'transient_pre_transport',
      'EVOLUTION_RATE_LIMIT'
    )
  );
  const transient = dependencies({ clock, transport: transientTransport });
  const retry = await transient.module.enqueue(identity);
  assert.equal(retry.state, 'retry_scheduled');
  assert.equal(retry.steps[0]?.nextAttemptAt?.getTime(), start.getTime() + 60_000);
  clock.value = new Date(start.getTime() + 60_000);
  const retried = await transient.module.process(retry.id);
  assert.equal(retried?.state, 'provider_accepted');
  assert.equal(retried?.steps[0]?.state, 'server_ack');
  assert.equal(retried?.steps[1]?.state, 'server_ack');
  assert.equal(transientTransport.calls.length, 3);

  const permanentTransport = new FakeTransport();
  permanentTransport.failAt(
    1,
    new EvolutionTransportError(
      'Dados inválidos.',
      'permanent_pre_transport',
      'EVOLUTION_INVALID_INPUT'
    )
  );
  const permanent = dependencies({ transport: permanentTransport });
  const failed = await permanent.module.enqueue({ ...identity, flowId: 'permanent' });
  assert.equal(failed.state, 'failed');
  assert.equal(permanentTransport.calls.length, 1);
  assert.equal((await permanent.module.process(failed.id))?.state, 'failed');
  assert.equal(permanentTransport.calls.length, 1);
  // A permanent pre-transport failure leaves the same revision re-sendable: the
  // copy states the cause and never claims the revision is dead.
  assert.equal(
    failed.steps[0]?.publicError,
    'O envio foi rejeitado antes do transporte.'
  );
  assert.doesNotMatch(failed.steps[0]!.publicError!, /não pode ser reenviada|nova revisão/i);
});

test('exhausted transient failures drop the retry instruction for transport and document preparation', async () => {
  const clock = { value: new Date(start) };
  const transportRun = dependencies({
    clock,
    transportSend: async () => {
      throw new EvolutionTransportError(
        'Tente novamente.',
        'transient_pre_transport',
        'EVOLUTION_RATE_LIMIT',
      );
    },
  });
  let result = await transportRun.module.enqueue(identity);
  for (const delay of [60_000, 300_000, 900_000]) {
    assert.equal(result.state, 'retry_scheduled');
    assert.equal(result.steps[0]?.publicError, 'Falha transitória antes do transporte. Tente novamente.');
    clock.value = new Date(clock.value.getTime() + delay);
    result = (await transportRun.module.process(result.id))!;
  }
  assert.equal(result.state, 'failed');
  assert.equal(
    result.steps[0]?.publicError,
    'As tentativas de envio se esgotaram antes do transporte.'
  );
  assert.doesNotMatch(result.steps[0]!.publicError!, /não pode ser reenviada|nova revisão/i);

  const pdfClock = { value: new Date(start) };
  const pdfTransport = new FakeTransport();
  const pdfRun = dependencies({
    clock: pdfClock,
    transport: pdfTransport,
    steps: [pdfStep(0)],
    preparePdf: async () => {
      throw new Error('pdf render failed');
    },
  });
  let pdf = await pdfRun.module.enqueue(identity);
  for (const delay of [60_000, 300_000, 900_000]) {
    assert.equal(pdf.state, 'retry_scheduled');
    assert.equal(pdf.steps[0]?.publicError, 'PDF indisponível. Tentar novamente.');
    pdfClock.value = new Date(pdfClock.value.getTime() + delay);
    pdf = (await pdfRun.module.process(pdf.id))!;
  }
  assert.equal(pdf.state, 'failed');
  assert.equal(pdfTransport.calls.length, 0);
  assert.doesNotMatch(pdf.steps[0]!.publicError!, /tentar novamente/i);
  assert.match(pdf.steps[0]!.publicError!, /se esgotaram antes do transporte/i);
});

test('enqueue processes short inter-step delays without waiting for the scheduler', async () => {
  const clock = { value: new Date(start) };
  const sleeps: number[] = [];
  const delayed = dependencies({
    clock,
    steps: [textStep(0), textStep(1, 1_000), textStep(2, 2_000)],
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      clock.value = new Date(clock.value.getTime() + delayMs);
    },
  });

  const completed = await delayed.module.enqueue(identity);

  assert.equal(completed.state, 'provider_accepted');
  assert.deepEqual(sleeps, [1_000, 2_000]);
  assert.deepEqual(
    delayed.transport.calls.map((call) => call.step.position),
    [0, 1, 2]
  );
});

test('cancelPending stops queued retries but leaves a processing lease untouched', async () => {
  const { module, repository, clock, transport } = dependencies({ steps: [textStep(0)] });
  const pending = await repository.enqueue({ ...plan([textStep(0)]), flowId: 'cancel-pending' });
  const processing = await repository.enqueue({ ...plan([textStep(0)]), flowId: 'cancel-processing' });
  assert.ok(await repository.claim({ deliveryId: processing.id }));

  assert.equal(await module.cancelPending(), 1);
  assert.equal((await module.get({ deliveryId: pending.id }))?.state, 'failed');
  assert.equal((await module.get({ deliveryId: processing.id }))?.state, 'processing');
  assert.equal(transport.calls.length, 0);
  assert.equal(clock.value.getTime(), start.getTime());
});

test('worker crash after claim but before transport reconciles without a provider call', async () => {
  const clock = { value: new Date(start) };
  const { repository, transport } = dependencies({
    clock,
    steps: [textStep(0)],
  });
  const queued = await repository.enqueue({ ...plan([textStep(0)]), flowId: 'crash-before-transport' });
  assert.ok(await repository.claim({ deliveryId: queued.id }));
  assert.equal(transport.calls.length, 0);
  assert.equal((await repository.get(queued.id))?.state, 'processing');

  clock.value = new Date(start.getTime() + 90_000);
  const recovered = await dependencies({ repository, transport, clock }).module.process(queued.id);
  assert.equal(recovered?.state, 'reconciling');
  assert.equal(recovered?.steps[0]?.state, 'reconciling');
  assert.equal(transport.calls.length, 0);
});

test('worker crash after provider acceptance does not resend after lease expiry', async () => {
  const clock = { value: new Date(start) };
  const { repository, transport } = dependencies({
    clock,
    steps: [textStep(0)],
  });
  const queued = await repository.enqueue({ ...plan([textStep(0)]), flowId: 'crash-after-provider' });
  const claimed = await repository.claim({ deliveryId: queued.id });
  assert.ok(claimed);
  const accepted = await transport.send({
    phone: claimed.delivery.phone,
    step: claimed.step.snapshot,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(transport.calls.length, 1);
  assert.equal((await repository.get(queued.id))?.state, 'processing');

  clock.value = new Date(start.getTime() + 90_000);
  const recovered = await dependencies({ repository, transport, clock }).module.process(queued.id);
  assert.equal(recovered?.state, 'reconciling');
  assert.equal(recovered?.steps[0]?.state, 'reconciling');
  assert.equal(transport.calls.length, 1);
});

test('two independent workers claim one due step and make one transport call', async () => {
  const repository = new FakeRepository(() => new Date(start));
  const transport = new FakeTransport();
  const first = dependencies({ repository, transport });
  const second = dependencies({ repository, transport });
  const queued = await repository.enqueue({ ...plan([textStep(0)]), flowId: 'two-workers' });

  const [a, b] = await Promise.all([
    first.module.process(queued.id),
    second.module.process(queued.id),
  ]);
  assert.ok(['processing', 'provider_accepted'].includes(a?.state || ''));
  assert.ok(['processing', 'provider_accepted'].includes(b?.state || ''));
  assert.equal((await repository.get(queued.id))?.state, 'provider_accepted');
  assert.equal(transport.calls.length, 1);
});

test('provider key survives a later bookkeeping failure without a resend', async () => {
  const { module, repository, transport } = dependencies({
    steps: [textStep(0)],
    failAfterAcceptedPersistence: true,
  });
  const result = await module.enqueue({ ...identity, flowId: 'bookkeeping-failure' });
  const persisted = repository.rows.get(result.id);
  assert.ok(persisted?.providerIds?.get(result.steps[0]!.id));
  assert.equal(result.state, 'provider_accepted');
  assert.equal(result.steps[0]?.state, 'server_ack');
  assert.equal(transport.calls.length, 1);

  const replay = await module.process(result.id);
  assert.equal(replay?.state, 'provider_accepted');
  assert.equal(transport.calls.length, 1);
});

test('expired reconciliation is promoted before due processing', async () => {
  const clock = { value: new Date(start) };
  const transport = new FakeTransport();
  transport.failAt(1, new EvolutionTransportError('Ambíguo.', 'ambiguous', 'EVOLUTION_NETWORK'));
  const { module } = dependencies({ clock, transport });
  const reconciling = await module.enqueue({ ...identity, flowId: 'expiry' });
  assert.equal(reconciling.state, 'reconciling');
  clock.value = new Date(start.getTime() + 120_000);
  const batch = await module.processDue(20);
  assert.deepEqual(batch, { processed: 1, remaining: false });
  assert.equal((await module.get({ deliveryId: reconciling.id }))?.state, 'needs_review');
});

test('duplicate process calls share one in-flight attempt', async () => {
  const clock = { value: new Date(start) };
  const repository = new FakeRepository(() => new Date(clock.value));
  const transport = new FakeTransport();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const module = createQuotationDeliveryModule({
    repository,
    planner: async () => plan([textStep(0)]),
    transport: async (input) => {
      transport.calls.push(input);
      await blocked;
      return { accepted: true as const, providerMessageId: 'provider-duplicate' };
    },
    now: () => new Date(clock.value),
    logger: () => {},
  });
  const queued = await repository.enqueue({ ...plan([textStep(0)]), phone: '5511999990000' });
  const first = module.process(queued.id);
  const second = module.process(queued.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.calls.length, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a?.state, 'provider_accepted');
  assert.equal(b?.state, 'provider_accepted');
});

test('receipt aggregation is monotonic and does not replace outbound activity', async () => {
  const activities: Array<Record<string, unknown>> = [];
  const followUpUpserts: Array<Record<string, string>> = [];
  const followUpReceiptUpserts: Array<Record<string, unknown>> = [];
  const { module, transport } = dependencies({ activities, followUpUpserts, followUpReceiptUpserts });
  const accepted = await module.enqueue({ ...identity, flowId: 'receipts' });
  const first = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'SERVER_ACK',
  });
  assert.equal(first?.state, 'provider_accepted');
  const duplicate = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'SERVER_ACK',
  });
  assert.equal(duplicate?.state, 'provider_accepted');
  const deliveryAck = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'DELIVERY_ACK',
  });
  assert.equal(deliveryAck?.state, 'provider_accepted');
  const second = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-2',
    fromMe: true,
    status: 'READ',
  });
  assert.equal(second?.state, 'delivered');
  assert.equal(transport.calls.length, 2);
  assert.equal(activities.length, 1);
  assert.deepEqual(
    followUpReceiptUpserts.map((input) => input.allStepsDelivered),
    [false, true],
  );
  assert.equal(
    await module.applyEvolutionEvent({
      instance: 'test-instance',
      providerMessageId: 'unknown',
      fromMe: true,
      status: 'READ',
    }),
    null
  );
  assert.equal(accepted.steps.length, 2);
});

test('operator completion plus one provider receipt does not start the follow-up clock', async () => {
  const followUpUpserts: Array<Record<string, string>> = [];
  const followUpReceiptUpserts: Array<Record<string, unknown>> = [];
  const { module, repository } = dependencies({ followUpUpserts, followUpReceiptUpserts });
  const accepted = await module.enqueue({ ...identity, flowId: 'operator-receipt' });
  const row = repository.rows.get(accepted.id)!;
  row.aggregate.state = 'delivered';
  row.aggregate.completionSource = 'operator';

  await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'DELIVERY_ACK',
  });

  assert.equal(followUpReceiptUpserts[0]?.allStepsDelivered, false);
});

test('a provider PENDING receipt never promotes a step to delivered', async () => {
  const { module, repository, transport } = dependencies({ steps: [textStep(0)] });
  const accepted = await module.enqueue({ ...identity, flowId: 'pending-receipt' });
  const pending = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'PENDING',
  });
  assert.equal(pending?.state, 'provider_accepted');
  assert.equal(pending?.steps[0]?.state, 'server_ack');
  assert.equal(repository.rows.get(accepted.id)?.aggregate.state, 'provider_accepted');
  assert.equal(transport.calls.length, 1);
});

test('a delayed DELIVERY_ACK resolves a needs_review step without another transport call', async () => {
  const { module, repository, transport } = dependencies({ steps: [textStep(0)] });
  const accepted = await module.enqueue({ ...identity, flowId: 'delayed-delivery-ack' });
  const row = repository.rows.get(accepted.id)!;
  row.aggregate.steps[0]!.state = 'needs_review';
  row.aggregate.steps[0]!.publicError = 'Aguardando recibo.';
  row.aggregate.state = 'needs_review';
  row.aggregate.publicError = 'Aguardando recibo.';
  const resolved = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'DELIVERY_ACK',
  });
  assert.equal(resolved?.state, 'delivered');
  assert.equal(resolved?.steps[0]?.state, 'delivered');
  assert.equal(transport.calls.length, 1);
});

test('READ before DELIVERY_ACK remains delivered and never resends', async () => {
  const { module, transport } = dependencies({ steps: [textStep(0)] });
  const accepted = await module.enqueue({ ...identity, flowId: 'read-before-delivery' });
  const read = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'READ',
  });
  assert.equal(read?.state, 'delivered');
  const lateDelivery = await module.applyEvolutionEvent({
    instance: 'test-instance',
    providerMessageId: 'provider-1',
    fromMe: true,
    status: 'DELIVERY_ACK',
  });
  assert.equal(lateDelivery?.state, 'delivered');
  assert.equal(lateDelivery?.steps[0]?.state, 'read');
  assert.equal(transport.calls.length, 1);
  assert.equal(accepted.steps[0]?.state, 'server_ack');
});

test('PDF is prepared only for the due PDF step and failures are classified before transport', async () => {
  let prepares = 0;
  const clock = { value: new Date(start) };
  const prepared = dependencies({
    clock,
    steps: [textStep(0), pdfStep(1, 60_000)],
    preparePdf: async () => {
      prepares += 1;
      return {
        pdf: Buffer.from('%PDF-test'),
        pdfSize: 9,
        pdfSignature: 'test',
        validUntil: new Date(clock.value.getTime() + 86_400_000),
      };
    },
  });
  const queued = await prepared.module.enqueue({ ...identity, flowId: 'pdf' });
  assert.equal(prepares, 0);
  clock.value = new Date(start.getTime() + 60_000);
  await prepared.module.process(queued.id);
  assert.equal(prepares, 1);
  assert.ok(prepared.transport.calls[1]?.document);

  const transient = dependencies({
    steps: [pdfStep(0)],
    preparePdf: async () => {
      throw new Error('renderer unavailable');
    },
  });
  const retry = await transient.module.enqueue({ ...identity, flowId: 'pdf-transient' });
  assert.equal(retry.state, 'retry_scheduled');
  assert.equal(transient.transport.calls.length, 0);

  const permanent = dependencies({
    steps: [pdfStep(0)],
    preparePdf: async () => {
      const error = new Error('A revisão está vencida.');
      Object.assign(error, { statusCode: 409 });
      throw error;
    },
  });
  const failed = await permanent.module.enqueue({ ...identity, flowId: 'pdf-permanent' });
  assert.equal(failed.state, 'failed');
  assert.equal(permanent.transport.calls.length, 0);
});

test('WebP quotation expands into durable page messages without replaying accepted pages', async () => {
  let prepares = 0;
  const page = (number: number): PreparedImage => ({
    webp: Buffer.from(`RIFF-page-${number}-WEBP`),
    webpSize: `RIFF-page-${number}-WEBP`.length,
    webpSignature: `page-${number}`,
    page: number,
    pageCount: 2,
    validUntil: new Date(start.getTime() + 86_400_000),
  });
  const prepared = dependencies({
    steps: [webpPlaceholderStep(0)],
    prepareImages: async () => {
      prepares += 1;
      return [page(1), page(2)];
    },
  });
  const first = await prepared.module.enqueue({ ...identity, flowId: 'webp' });
  assert.equal(first.state, 'provider_accepted');
  assert.equal(first.steps.length, 2);
  assert.deepEqual(first.steps.map((step) => [step.position, step.type]), [
    [0, 'quotation_webp'],
    [1, 'quotation_webp'],
  ]);
  assert.equal(prepares, 1);
  assert.equal(prepared.transport.calls.length, 2);
  assert.equal((prepared.transport.calls[0]?.image as PreparedImage).page, 1);
  assert.equal((prepared.transport.calls[1]?.image as PreparedImage).page, 2);
  const replay = await prepared.module.enqueue({ ...identity, flowId: 'webp' });
  assert.equal(replay.id, first.id);
  assert.equal(prepares, 1);
  assert.equal(prepared.transport.calls.length, 2);
});

test('structured logs contain only internal IDs, state, error code and duration', async () => {
  const logs: DeliveryLogEvent[] = [];
  const { module } = dependencies({ logger: (event) => logs.push(event) });
  await module.enqueue(identity);
  assert.ok(logs.length > 0);
  assert.deepEqual(Object.keys(logs[0]!).sort(), [
    'deliveryId',
    'duration',
    'errorCode',
    'state',
    'stepId',
  ]);
  assert.equal(JSON.stringify(logs).includes('provider-'), false);
});

test('processDue is bounded and rejects invalid limits', async () => {
  const { module, repository, transport } = dependencies({ steps: [textStep(0)] });
  await repository.enqueue({ ...plan([textStep(0)]), flowId: 'batch-a' });
  await repository.enqueue({ ...plan([textStep(0)]), flowId: 'batch-b' });
  const first = await module.processDue(1);
  assert.equal(first.processed, 1);
  assert.equal(first.remaining, true);
  assert.equal(transport.calls.length, 1);
  const second = await module.processDue(50);
  assert.equal(second.processed, 1);
  assert.equal(second.remaining, false);
  assert.equal(transport.calls.length, 2);
  await assert.rejects(module.processDue(0), /Limite/i);
  await assert.rejects(module.processDue(51), /Limite/i);
});

test('an uninspectable acceptance source fails closed and still claims due outbound work', async () => {
  const clock = { value: new Date(start) };
  const repository = new FakeRepository(() => new Date(clock.value));
  const transport = new FakeTransport();
  await repository.enqueue({ ...plan([textStep(0)]), flowId: 'acceptance-source-failure' });
  const module = createQuotationDeliveryModule({
    repository,
    followUpRepository: {
      listAcceptedDeliveriesMissingFollowUp: async () => {
        throw new Error('acceptance source unavailable');
      },
      upsertAwaitingReceiptFromAcceptedDelivery: async () => {},
    },
    transport: transport.send.bind(transport),
    now: () => new Date(clock.value),
    logger: () => {},
  });

  const batch = await module.processDue(20);
  // Unknown reconciliation state is never reported drained, and the outbound
  // claim path still gets its share of the invocation.
  assert.equal(batch.remaining, true);
  assert.equal(batch.processed, 1);
  assert.equal(transport.calls.length, 1);
});

test('an uninspectable receipt source fails closed and still claims due outbound work', async () => {
  const clock = { value: new Date(start) };
  const repository = new FakeRepository(() => new Date(clock.value));
  const transport = new FakeTransport();
  await repository.enqueue({ ...plan([textStep(0)]), flowId: 'receipt-source-failure' });
  const module = createQuotationDeliveryModule({
    repository,
    followUpRepository: {
      listAcceptedDeliveriesMissingFollowUp: async () => ({ data: [], hasMore: false }),
      upsertAwaitingReceiptFromAcceptedDelivery: async () => {},
      listAwaitingReceiptWithCompletedDelivery: async () => {
        throw new Error('receipt source unavailable');
      },
      upsertFromDeliveryReceipt: async () => {},
      markReceiptProjectionAttempt: async () => {},
    },
    transport: transport.send.bind(transport),
    now: () => new Date(clock.value),
    logger: () => {},
  });

  const batch = await module.processDue(20);
  assert.equal(batch.remaining, true);
  assert.equal(batch.processed, 1);
  assert.equal(transport.calls.length, 1);
});

test('a held reconciliation source is bounded and never consumes outbound claim capacity', async () => {
  const clock = { value: new Date(start) };
  const repository = new FakeRepository(() => new Date(clock.value));
  const transport = new FakeTransport();
  await repository.enqueue({ ...plan([textStep(0)]), flowId: 'held-receipt-source' });
  let listCalls = 0;
  const held = new Promise<never>(() => {});
  const module = createQuotationDeliveryModule({
    repository,
    followUpRepository: {
      listAcceptedDeliveriesMissingFollowUp: async () => ({ data: [], hasMore: false }),
      upsertAwaitingReceiptFromAcceptedDelivery: async () => {},
      listAwaitingReceiptWithCompletedDelivery: () => {
        listCalls += 1;
        return held;
      },
      upsertFromDeliveryReceipt: async () => {},
      markReceiptProjectionAttempt: async () => {},
    },
    transport: transport.send.bind(transport),
    now: () => new Date(clock.value),
    logger: () => {},
  });

  const startedAt = Date.now();
  // 18s budget leaves a ~3s reconciliation window before the 15s reserve.
  const batch = await module.processDue(1, 18_000);
  const elapsed = Date.now() - startedAt;
  assert.equal(listCalls, 1);
  assert.equal(batch.processed, 1);
  assert.equal(batch.remaining, true);
  assert.equal(transport.calls.length, 1);
  assert.ok(elapsed < 15_000, `bounded pass must not wait for the held source (took ${elapsed}ms)`);
});

test('processDue continues short inter-step delays within its time budget', async () => {
  const clock = { value: new Date(start) };
  const sleeps: number[] = [];
  const steps = [textStep(0), textStep(1, 1_000), textStep(2, 2_000)];
  const delayed = dependencies({
    clock,
    steps,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      clock.value = new Date(clock.value.getTime() + delayMs);
    },
  });
  await delayed.repository.enqueue({ ...plan(steps), flowId: 'worker-delayed' });

  const batch = await delayed.module.processDue(3);

  assert.equal(batch.processed, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
  assert.deepEqual(
    delayed.transport.calls.map((call) => call.step.position),
    [0, 1, 2]
  );
});

test('processDue stops before the next claim once the worker is stopping', async () => {
  const stop = new AbortController();
  const steps = [textStep(0), textStep(1, 1_000)];
  const delayed = dependencies({
    steps,
    // Only the stop ends this wait.
    sleep: () => {
      stop.abort();
      return new Promise<void>(() => {});
    },
  });
  await delayed.repository.enqueue({ ...plan(steps), flowId: 'worker-stopping' });

  const batch = await delayed.module.processDue(3, undefined, stop.signal);

  assert.deepEqual(batch, { processed: 1, remaining: true });
  assert.deepEqual(
    delayed.transport.calls.map((call) => call.step.position),
    [0]
  );
});

test('processDue counts expired reconciliations and keeps a full expiry batch remaining', async () => {
  const { module, repository } = dependencies({ steps: [textStep(0)] });
  repository.expireReconciliations = async (limit: number) => limit;

  assert.deepEqual(await module.processDue(2), { processed: 2, remaining: true });
});

// Instrument the deadline timers created by `processDue` (two per invocation:
// the overall budget and the earlier reconciliation budget). Every timer must be
// disposed in `finally`, including when the body throws or returns early.
async function withTimerInstrumentation<T>(run: () => Promise<T>): Promise<{
  result: T;
  created: number;
  cleared: number;
}> {
  const created: unknown[] = [];
  const cleared: unknown[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const fakeTimer = { unref() {} };
  globalThis.setTimeout = ((..._args: unknown[]) => {
    created.push(fakeTimer);
    return fakeTimer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: unknown) => {
    cleared.push(timer);
  }) as typeof clearTimeout;
  try {
    const result = await run();
    return { result, created: created.length, cleared: cleared.length };
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test('an exceptional claim disposes every deadline timer', async () => {
  const repository = new FakeRepository(() => new Date(start));
  (repository as unknown as { claim: () => Promise<never> }).claim = async () => {
    throw new Error('claim exploded');
  };
  const module = createQuotationDeliveryModule({
    repository,
    planner: async () => plan(),
    transport: async () => ({ accepted: true as const, providerMessageId: 'provider-timer' }),
    now: () => new Date(start),
    instance: 'test-instance',
    logger: () => {},
  });

  let caught: unknown;
  const { created, cleared } = await withTimerInstrumentation(async () => {
    try {
      await module.processDue(1, 5_000);
    } catch (error) {
      caught = error;
    }
  });

  assert.ok(caught instanceof Error, 'the exceptional claim must propagate');
  assert.equal(created, 2, 'the overall and reconciliation budgets each create one timer');
  assert.equal(cleared, 2, 'an exceptional claim must still clear both timers');
});

test('an early return with no due work disposes every deadline timer', async () => {
  const repository = new FakeRepository(() => new Date(start));
  (repository as unknown as { claim: () => Promise<null> }).claim = async () => null;
  const module = createQuotationDeliveryModule({
    repository,
    planner: async () => plan(),
    transport: async () => ({ accepted: true as const, providerMessageId: 'provider-timer' }),
    now: () => new Date(start),
    instance: 'test-instance',
    logger: () => {},
  });

  const { result, created, cleared } = await withTimerInstrumentation(() =>
    module.processDue(1, 5_000)
  );

  assert.equal(result.processed, 0);
  assert.equal(created, 2, 'the overall and reconciliation budgets each create one timer');
  assert.equal(cleared, 2, 'an early return must still clear both timers');
});
