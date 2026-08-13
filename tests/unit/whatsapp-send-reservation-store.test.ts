import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalWhatsappSendIdempotencyKey,
  createWhatsappSendReservationStore,
  isWhatsappSendReservationStale,
  parseWhatsappSendReservationRecord,
  sanitizeWhatsappSendTerminalResult,
  WHATSAPP_SEND_RESERVATION_CAS_SCRIPT,
  WHATSAPP_SEND_RESERVATION_COMPLETED_TTL_SECONDS,
  WHATSAPP_SEND_RESERVATION_MAX_CLOCK_SKEW_MS,
  WHATSAPP_SEND_RESERVATION_PREFIX,
  WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS,
  WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS,
  WHATSAPP_SEND_RESERVATION_RETRY_SCRIPT,
  WHATSAPP_SEND_RESERVATION_RETRY_TTL_SECONDS,
  WHATSAPP_SEND_RESERVATION_TAKEOVER_SCRIPT,
  WhatsappSendReservationStorageError,
} from '../../api/_functions/lib/whatsapp-send-reservation-store.js';

function fakeKv() {
  const values = new Map<string, any>();
  const expirations = new Map<string, number>();
  const evalCalls: Array<{ script: string; args: string[] }> = [];
  const read = (key: string) => {
    const expiresAt = expirations.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      values.delete(key);
      expirations.delete(key);
    }
    return values.get(key) ?? null;
  };
  const write = (key: string, value: any, ttl = 0) => {
    values.set(key, value);
    if (ttl > 0) expirations.set(key, Date.now() + ttl * 1000);
    else expirations.delete(key);
  };
  return {
    values,
    expirations,
    evalCalls,
    async set(key: string, value: unknown, options?: { nx?: boolean; ex?: number }) {
      if (options?.nx && read(key) !== null) return null;
      write(key, value, options?.ex || 0);
      return 'OK';
    },
    async get(key: string) {
      return read(key);
    },
    async eval(script: string, keys: string[], args: string[]) {
      evalCalls.push({ script, args });
      const key = keys[0]!;
      const current = read(key);
      if (!current) return ['missing'];
      const record = JSON.parse(JSON.stringify(current));
      if (script === WHATSAPP_SEND_RESERVATION_RETRY_SCRIPT) {
        if (record.schema !== 3 || record.phase !== 'retryable' || record.version !== Number(args[1])) return ['conflict', JSON.stringify(record)];
        record.owner = args[0];
        record.version += 1;
        record.phase = 'reserved';
        record.reservedAt = Number(args[2]);
        record.updatedAt = Number(args[2]);
        record.acceptedSteps = [];
        delete record.transportStartedAt;
        delete record.currentStep;
        delete record.result;
        delete record.errorMessage;
        write(key, record, Number(args[3]));
        return ['reserved', JSON.stringify(record)];
      }
      if (script === WHATSAPP_SEND_RESERVATION_TAKEOVER_SCRIPT) {
        if (record.schema !== 3 || record.phase !== 'reserved' || record.version !== Number(args[1]) || record.transportStartedAt != null || record.currentStep != null || !Array.isArray(record.acceptedSteps) || record.acceptedSteps.length > 0) return ['conflict', JSON.stringify(record)];
        if (Number(args[2]) - record.updatedAt < Number(args[3])) return ['conflict', JSON.stringify(record)];
        record.owner = args[0];
        record.version += 1;
        record.reservedAt = Number(args[2]);
        record.updatedAt = Number(args[2]);
        record.acceptedSteps = [];
        write(key, record, Number(args[4]));
        return ['reserved', JSON.stringify(record)];
      }
      if (script === WHATSAPP_SEND_RESERVATION_CAS_SCRIPT) {
        if (record.schema !== 3 || record.owner !== args[0] || record.version !== Number(args[1]) || record.phase !== args[2]) return ['conflict', JSON.stringify(record)];
        record.version += 1;
        record.phase = args[3];
        record.updatedAt = Number(args[4]);
        delete record.transportStartedAt;
        delete record.currentStep;
        delete record.result;
        delete record.errorMessage;
        if (args[5]) {
          record.currentStep = Number(args[5]);
          if (args[6]) record.transportStartedAt = record.updatedAt;
        }
        if (args[7]) record.acceptedSteps.push(JSON.parse(args[7]));
        if (args[8]) record.result = JSON.parse(args[8]);
        if (args[9]) record.errorMessage = args[9];
        write(key, record, Number(args[10]));

        return ['updated', JSON.stringify(record)];
      }
      throw new Error('unexpected script');
    },
  };
}

const input = {
  key: canonicalWhatsappSendIdempotencyKey('quote-1', 'revision-1', 'flow-1'),
  quotationId: 'quote-1',
  revisionId: 'revision-1',
  flowId: 'flow-1',
  stepsCount: 2,
};

function completedResult() {
  return {
    success: true,
    dry_run: false,
    send_status: 'completed',
    duplicate_warning: false,
    duplicate_message: '',
    flow_id: input.flowId,
    flow_name: 'Fluxo',
    quotation_id: input.quotationId,
    deal_id: null,
    product_summary: 'produtos',
    categories: [],
    steps_count: 2,
    steps: [{ type: 'text' }, { type: 'document' }],
    send_event_id: null,
  };
}

test('production factory uses SET NX and independently reserves the exact key', async () => {
  const client = fakeKv();
  const store = createWhatsappSendReservationStore(client as any);
  const [first, second] = await Promise.all([store.reserve(input), store.reserve(input)]);
  assert.deepEqual([first.kind, second.kind].sort(), ['existing', 'reserved']);
  assert.equal(first.record.schema, 3);
  assert.equal(second.record.schema, 3);
  assert.equal(client.values.size, 1);
  assert.equal(client.evalCalls.length, 0);
});

test('CAS records neutral progress before the next provider step and applies phase TTLs', async () => {
  const client = fakeKv();
  const store = createWhatsappSendReservationStore(client as any);
  const reserved = await store.reserve(input);
  const transporting = await store.compareAndSet({
    key: input.key,
    owner: reserved.record.owner,
    expectedVersion: reserved.record.version,
    from: 'reserved',
    to: 'transporting',
    currentStep: 0,
  });
  assert.equal(transporting.ok, true);
  if (!transporting.ok) return;
  const accepted = await store.compareAndSet({
    key: input.key,
    owner: reserved.record.owner,
    expectedVersion: transporting.record.version,
    from: 'transporting',
    to: 'accepted_partial',
    currentStep: 0,
    acceptedStep: { step: 0, kind: 'text' },
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.deepEqual(accepted.record.acceptedSteps.map((step) => step.step), [0]);
  assert.equal(JSON.stringify(accepted.record).includes('provider'), false);
  const next = await store.compareAndSet({
    key: input.key,
    owner: reserved.record.owner,
    expectedVersion: accepted.record.version,
    from: 'accepted_partial',
    to: 'transporting',
    currentStep: 1,
  });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  const final = await store.compareAndSet({
    key: input.key,
    owner: reserved.record.owner,
    expectedVersion: next.record.version,
    from: 'transporting',
    to: 'accepted_partial',
    currentStep: 1,
    acceptedStep: { step: 1, kind: 'document' },
  });
  assert.equal(final.ok, true);
  if (!final.ok) return;
  const completed = await store.compareAndSet({
    key: input.key,
    owner: reserved.record.owner,
    expectedVersion: final.record.version,
    from: 'accepted_partial',
    to: 'completed',
    result: completedResult(),
  });
  assert.equal(completed.ok, true);
  assert.equal(client.evalCalls.at(-1)?.args[10], String(WHATSAPP_SEND_RESERVATION_COMPLETED_TTL_SECONDS));
});

test('CAS conflicts are explicit and never become success', async () => {
  const client = fakeKv();
  const store = createWhatsappSendReservationStore(client as any);
  const reserved = await store.reserve(input);
  const conflict = await store.compareAndSet({
    key: input.key,
    owner: 'other-owner',
    expectedVersion: reserved.record.version,
    from: 'reserved',
    to: 'transporting',
    currentStep: 0,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'conflict');
});

test('only stale pre-transport reservations are atomically taken over', async () => {
  const client = fakeKv();
  const store = createWhatsappSendReservationStore(client as any);
  const reserved = await store.reserve(input);
  const key = `${WHATSAPP_SEND_RESERVATION_PREFIX}${encodeURIComponent(input.key)}`;
  const old = Date.now() - WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS - 1;
  client.values.set(key, { ...reserved.record, createdAt: old, updatedAt: old, reservedAt: old });
  const taken = await store.reserve(input);
  assert.equal(taken.kind, 'reserved');
  assert.notEqual(taken.record.owner, reserved.record.owner);
  assert.equal(taken.record.version, reserved.record.version + 1);
  assert.equal(client.evalCalls.at(-1)?.args[4], String(WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS));

  client.values.set(key, { ...taken.record, updatedAt: old, reservedAt: old, currentStep: 1, transportStartedAt: old, phase: 'reserved' });
  await assert.rejects(store.get(input.key), WhatsappSendReservationStorageError);
});

test('retryable and completed records receive bounded TTLs', async () => {
  const client = fakeKv();
  const store = createWhatsappSendReservationStore(client as any);
  const reserved = await store.reserve(input);
  const retryable = await store.compareAndSet({
    key: input.key,
    owner: reserved.record.owner,
    expectedVersion: reserved.record.version,
    from: 'reserved',
    to: 'retryable',
    errorMessage: 'Falha antes do transporte.',
  });
  assert.equal(retryable.ok, true);
  assert.equal(client.evalCalls.at(-1)?.args[10], String(WHATSAPP_SEND_RESERVATION_RETRY_TTL_SECONDS));
});

test('malformed, tampered, and future records fail closed before projection', async () => {
  assert.throws(() => sanitizeWhatsappSendTerminalResult({ success: true, provider_id: 'secret' }), WhatsappSendReservationStorageError);
  assert.throws(() => sanitizeWhatsappSendTerminalResult({ ...completedResult(), steps_count: 2, steps: [] }), WhatsappSendReservationStorageError);
  const now = Date.now();
  const future = {
    schema: 3,
    ...input,
    version: 1,
    owner: 'owner',
    phase: 'reserved',
    createdAt: now,
    updatedAt: now + WHATSAPP_SEND_RESERVATION_MAX_CLOCK_SKEW_MS + 1,
    reservedAt: now,
    acceptedSteps: [],
  };
  assert.throws(() => parseWhatsappSendReservationRecord(future, input.key, now), WhatsappSendReservationStorageError);
  assert.equal(isWhatsappSendReservationStale({ ...future, updatedAt: now - WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS - 1 } as any), true);
  assert.equal(isWhatsappSendReservationStale({
    ...future,
    updatedAt: now - WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS - 1,
    acceptedSteps: [{ step: 0, kind: 'text', acceptedAt: now - 1 }],
  } as any), false);
});

test('reservation parser enforces immutable step count and coherent progress', () => {
  const now = Date.now();
  const base = {
    schema: 3,
    ...input,
    version: 1,
    owner: 'owner',
    createdAt: now - 2_000,
    updatedAt: now,
    reservedAt: now - 2_000,
    acceptedSteps: [],
  };
  assert.throws(() => parseWhatsappSendReservationRecord({ ...base, stepsCount: null }, input.key, now), WhatsappSendReservationStorageError);
  const v2WithoutStepsCount = { ...base, schema: 2 };
  delete (v2WithoutStepsCount as { stepsCount?: number }).stepsCount;
  assert.throws(() => parseWhatsappSendReservationRecord(v2WithoutStepsCount, input.key, now), WhatsappSendReservationStorageError);
  assert.throws(() => parseWhatsappSendReservationRecord({
    ...base,
    phase: 'transporting',
    transportStartedAt: now - 100,
    currentStep: 0,
    acceptedSteps: [{ step: 0, kind: 'text', acceptedAt: now - 100 }],
  }, input.key, now), WhatsappSendReservationStorageError);
  assert.throws(() => parseWhatsappSendReservationRecord({
    ...base,
    phase: 'accepted_partial',
    currentStep: 0,
    acceptedSteps: [{ step: 1, kind: 'text', acceptedAt: now - 100 }],
  }, input.key, now), WhatsappSendReservationStorageError);
  assert.throws(() => parseWhatsappSendReservationRecord({
    ...base,
    phase: 'completed',
    acceptedSteps: [{ step: 0, kind: 'text', acceptedAt: now - 100 }, { step: 0, kind: 'document', acceptedAt: now - 90 }],
    result: completedResult(),
  }, input.key, now), WhatsappSendReservationStorageError);
  const completed = parseWhatsappSendReservationRecord({
    ...base,
    phase: 'completed',
    acceptedSteps: [
      { step: 0, kind: 'text', acceptedAt: now - 100 },
      { step: 1, kind: 'document', acceptedAt: now - 90 },
    ],
    currentStep: null,
    transportStartedAt: null,
    result: completedResult(),
    errorMessage: null,
    resolvedAt: null,
    resolution: null,
  }, input.key, now);
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.currentStep, undefined);
  assert.equal(completed.transportStartedAt, undefined);
});
