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

  async applyReceipt(input: {
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

  async resolve(_input: ResolveDeliveryInput): Promise<DeliveryAggregate> {
    throw new Error('not used');
  }
}

class FakeTransport {
  readonly calls: Array<{ phone: string; step: FrozenDeliveryStep; document?: unknown }> = [];
  private failures = new Map<number, Error>();

  failAt(callNumber: number, error: Error): void {
    this.failures.set(callNumber, error);
  }

  async send(input: { phone: string; step: FrozenDeliveryStep; document?: unknown }) {
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
    logger?: (event: DeliveryLogEvent) => void;
    failAfterAcceptedPersistence?: boolean;
    transportSend?: (
      input: { phone: string; step: FrozenDeliveryStep; document?: unknown }
    ) => Promise<{ accepted: true; providerMessageId: string }>;
    sleep?: (delayMs: number) => Promise<void>;
  } = {}
) {
  const clock = options.clock || { value: new Date(start) };
  const repository =
    options.repository ||
    new FakeRepository(() => new Date(clock.value), {
      failAfterAcceptedPersistence: options.failAfterAcceptedPersistence,
    });
  const transport = options.transport || new FakeTransport();
  const planner = async () => plan(options.steps);
  const module = createQuotationDeliveryModule({
    repository,
    planner,
    transport: options.transportSend || transport.send.bind(transport),
    preparePdf:
      options.preparePdf ||
      (async () => ({
        pdf: Buffer.from('%PDF-test'),
        pdfSize: 9,
        pdfSignature: 'test',
        validUntil: new Date(clock.value.getTime() + 86_400_000),
      })),
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
  assert.deepEqual(batch, { processed: 0, remaining: false });
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

test('receipt aggregation is monotonic and unknown provider IDs are neutral', async () => {
  const { module, transport } = dependencies();
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
