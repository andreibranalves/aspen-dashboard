import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isEmptyQuotationSections,
  snapshotFromLegacyRevision,
  templateSeedPlan,
} from '../../api/_db/quotation-template-migration.js';
import { acquireQuotationWriteLock } from '../../api/_db/quotation-write-lock.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_db/quotation-lifecycle-repository.ts';
import { parseQuotationSections, runQuotationTemplateMigration } from '../../scripts/migrate-quotation-templates.mjs';

test('legacy revision receives a frozen sections snapshot', () => {
  const snapshot = snapshotFromLegacyRevision({
    pagamento: 'À vista',
    entrega: '3 dias',
    observacoes: 'Aprovar arte',
    prazoProducao: '10 dias úteis',
  });
  assert.equal(snapshot.pagamento.current.body, 'À vista');
  assert.match(snapshot.condicoes_gerais.current.body, /Prazo de entrega:/);
  assert.match(snapshot.condicoes_gerais.current.body, /Observações:/);
  assert.equal(snapshot.prazo_producao.current.title, 'Prazo de produção');
  assert.notStrictEqual(snapshot.pagamento.base, snapshot.pagamento.current);
  assert.notStrictEqual(snapshot.condicoes_gerais.base, snapshot.condicoes_gerais.current);
});

test('legacy snake_case deadline controls snapshot enablement', () => {
  assert.equal(snapshotFromLegacyRevision({ prazo_producao: '' }).prazo_producao.current.enabled, false);
  assert.equal(snapshotFromLegacyRevision({ prazo_producao: '10 dias' }).prazo_producao.current.enabled, true);
});

test('empty sections detection is semantic and preserves meaningful settings', () => {
  assert.equal(isEmptyQuotationSections({
    condicoes_gerais: { body: '', title: 'Condições Gerais', enabled: true },
    pagamento: { body: '', title: 'Pagamento', enabled: true },
    prazo_producao: { title: 'Prazo de produção', enabled: true },
    schema_version: 1,
  }), true);
  assert.equal(isEmptyQuotationSections({
    ...JSON.parse(JSON.stringify({ schema_version: 1, prazo_producao: { enabled: true, title: 'Prazo de produção' }, pagamento: { enabled: true, title: 'Pagamento', body: 'Pix' }, condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' } })),
  }), false);
});

test('invalid quotation sections values are treated as empty', () => {
  for (const value of ['not-json', '"invalid-string"', { unknown: true }]) {
    assert.equal(isEmptyQuotationSections(parseQuotationSections(value)), true);
  }
});

function extractAdvisoryLockKey(queryOrStrings: unknown, values: unknown[] = []): bigint {
  if (typeof queryOrStrings === 'object' && queryOrStrings !== null && 'queryChunks' in queryOrStrings) {
    const chunks = (queryOrStrings as { queryChunks?: unknown[] }).queryChunks || [];
    const key = chunks.find((chunk): chunk is bigint => typeof chunk === 'bigint');
    if (key !== undefined) return key;
  }
  const strings = queryOrStrings as { raw?: readonly string[] };
  const text = (strings.raw || []).reduce((result, part, index) => `${result}${part}${values[index] === undefined ? '' : String(values[index])}`, '');
  const match = text.match(/pg_advisory_xact_lock\(\s*(\d+)\s*::bigint\s*\)/);
  if (!match) throw new Error(`Advisory lock key missing from query: ${text}`);
  return BigInt(match[1]);
}

test('postgres and Drizzle lock adapters expose their actual advisory key', async () => {
  let taggedKey: bigint | undefined;
  const postgresTx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    taggedKey = extractAdvisoryLockKey(strings, values);
    return Promise.resolve();
  };
  await acquireQuotationWriteLock(postgresTx);

  let drizzleKey: bigint | undefined;
  await acquireQuotationWriteLock({
    execute: async (query) => {
      drizzleKey = extractAdvisoryLockKey(query);
    },
  });
  assert.equal(taggedKey, drizzleKey);
});

test('built-in seed plan is stable and idempotent by key and hash', () => {
  const plan = templateSeedPlan();
  assert.ok(plan.length >= 3);
  assert.equal(new Set(plan.map((item) => item.key)).size, plan.length);
  for (const item of plan) assert.match(item.source_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(templateSeedPlan(), plan);
});

class AdvisoryLockSimulator {
  held = new Map<bigint, string>();
  waiters = new Map<bigint, Array<() => void>>();
  events: Array<{ state: 'attempt' | 'acquired'; owner: string; key: bigint }> = [];

  async acquire(key: bigint, owner: string): Promise<void> {
    this.events.push({ state: 'attempt', owner, key });
    while (this.held.has(key)) {
      await new Promise<void>((resolve) => {
        const waiters = this.waiters.get(key) || [];
        waiters.push(resolve);
        this.waiters.set(key, waiters);
      });
    }
    this.held.set(key, owner);
    this.events.push({ state: 'acquired', owner, key });
  }

  release(key: bigint, owner: string): void {
    assert.equal(this.held.get(key), owner);
    this.held.delete(key);
    this.waiters.get(key)?.shift()?.();
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('timed out waiting for advisory-lock evidence');
}

test('actual migration and lifecycle paths serialize on their extracted advisory key', async () => {
  const simulator = new AdvisoryLockSimulator();
  let migrationKey: bigint | undefined;
  let lifecycleKey: bigint | undefined;
  let releaseMigration!: () => void;
  const migrationGate = new Promise<void>((resolve) => { releaseMigration = resolve; });

  const migrationSql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.raw?.join('').includes('pg_advisory_xact_lock')) {
      migrationKey = extractAdvisoryLockKey(strings, values);
      await simulator.acquire(migrationKey, 'migration');
    }
    return [];
  };
  const migration = (async () => {
    try {
      await runQuotationTemplateMigration(migrationSql, {
        migration: { templateSeedPlan: () => [], isEmptyQuotationSections: () => true },
        acquireLock: acquireQuotationWriteLock,
      });
      await migrationGate;
    } finally {
      if (migrationKey !== undefined) simulator.release(migrationKey, 'migration');
    }
  })();

  await waitFor(() => simulator.events.some((event) => event.owner === 'migration' && event.state === 'acquired'));
  const quotation = { id: '11111111-1111-4111-8111-111111111111', businessNumber: 'ORC-1', status: 'enviado', updatedAt: new Date('2026-07-01T12:00:00.000Z') };
  const revision = { id: '22222222-2222-4222-8222-222222222222', quotationId: quotation.id, status: 'enviado' };
  let selectCount = 0;
  const lifecycleTx = {
    execute: async (query: unknown) => {
      lifecycleKey = extractAdvisoryLockKey(query);
      await simulator.acquire(lifecycleKey, 'lifecycle');
    },
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ limit: async () => (++selectCount === 1 ? [quotation] : [revision]) }),
          orderBy: () => ({ limit: async () => [revision] }),
          limit: async () => (++selectCount === 1 ? [quotation] : [revision]),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{
      id: '44444444-4444-4444-8444-444444444444',
      eventType: 'quotation.updated',
      provider: 'crm',
      aggregateType: 'quotation',
      aggregateId: quotation.id,
      payloadReference: {
        quotationId: quotation.id,
        revisionId: revision.id,
        businessNumber: quotation.businessNumber,
      },
      idempotencyKey: 'quotation.updated:crm:lock-test',
      status: 'pending',
      attempts: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: quotation.updatedAt,
      lastErrorClass: null,
      providerMessageId: null,
      createdAt: quotation.updatedAt,
      updatedAt: quotation.updatedAt,
      deliveredAt: null,
    }] }) }) }),
  };
  const lifecycle = createPostgresQuotationLifecycleRepository(
    () => ({ transaction: async (callback: (tx: typeof lifecycleTx) => Promise<unknown>) => {
      try {
        return await callback(lifecycleTx);
      } finally {
        if (lifecycleKey !== undefined) simulator.release(lifecycleKey, 'lifecycle');
      }
    } } as never),
    { readDetail: async () => ({
      quotation_id: quotation.businessNumber,
      status: 'Approved',
      status_canonical: 'aprovado',
    } as never) },
  );
  const writer = lifecycle.setStatus('ORC-1', { status: 'aprovado', concurrency_token: quotation.updatedAt.toISOString() });

  await waitFor(() => simulator.events.some((event) => event.owner === 'lifecycle' && event.state === 'attempt'));
  assert.equal(simulator.events.some((event) => event.owner === 'lifecycle' && event.state === 'acquired'), false);
  assert.equal(simulator.events.filter((event) => event.state === 'attempt').length, 2);
  assert.equal(migrationKey, lifecycleKey);

  releaseMigration();
  await Promise.all([migration, writer]);
  assert.deepEqual(simulator.events.map(({ state, owner }) => `${state}:${owner}`), [
    'attempt:migration', 'acquired:migration', 'attempt:lifecycle', 'acquired:lifecycle',
  ]);
});
