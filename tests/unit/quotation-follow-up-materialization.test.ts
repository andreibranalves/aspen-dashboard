import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelQuotationFollowUpForFact,
  materializeQuotationFollowUpQueue,
  type FollowUpFactsDatabase,
} from '../../api/_infrastructure/db/repositories/quotation-follow-up-facts.js';
import { MemoryClientRepository } from '../../api/_modules/client-repository.js';
import type { ClientRecord } from '../../api/_modules/client-schema.js';

function queryText(query: unknown): string {
  if (typeof query === 'string') return query;
  if (!query || typeof query !== 'object') return '';
  if ('queryChunks' in query && Array.isArray(query.queryChunks)) {
    return query.queryChunks.map((chunk) => queryText(chunk)).join('');
  }
  if ('value' in query) {
    const value = query.value;
    return Array.isArray(value) ? value.map((part) => queryText(part)).join('') : String(value ?? '');
  }
  return '';
}

test('materialization is an explicit no-op without a tracking cut or instance', async () => {
  let executions = 0;
  const database: FollowUpFactsDatabase = {
    async execute() {
      executions += 1;
      return [];
    },
  };

  assert.equal(
    await materializeQuotationFollowUpQueue(database, {
      trackingStartedAt: new Date('2026-08-01T00:00:00.000Z'),
      instance: '',
    }),
    0,
  );
  assert.equal(executions, 0);
});

test('commercial cancel leaves transport-started processing candidates untouched', async () => {
  const queries: unknown[] = [];
  const database: FollowUpFactsDatabase = {
    async execute(query) {
      queries.push(query);
      return [];
    },
  };

  await cancelQuotationFollowUpForFact(
    database,
    '11111111-1111-4111-8111-111111111111',
    'crm_not_eligible',
    new Date('2026-08-31T00:00:00.000Z'),
  );

  assert.equal(queries.length, 3);
  const text = queries.map(queryText).join('\n');
  assert.match(text, /approved/);
  assert.match(text, /processing/);
  assert.match(text, /transport_started_at IS NULL/);
  assert.match(text, /crm_not_eligible/);
  assert.match(text, /quotation-follow-up-commercial-facts/);
});

test('materialization performs one idempotent insert and never copies provider message ids', async () => {
  const queries: unknown[] = [];
  const database: FollowUpFactsDatabase = {
    async execute(query) {
      queries.push(query);
      return [{ id: 'candidate-1' }, { id: 'candidate-2' }];
    },
  };

  const count = await materializeQuotationFollowUpQueue(database, {
    trackingStartedAt: new Date('2026-08-01T00:00:00.000Z'),
    instance: 'instance-a',
    now: new Date('2026-08-31T00:00:00.000Z'),
  });

  assert.equal(count, 2);
  assert.equal(queries.length, 1);
  const text = queryText(queries[0]);
  assert.match(text, /ON CONFLICT/);
  assert.match(text, /provider_message_id/);
  assert.match(text, /provider_accepted/);
  assert.match(text, /has_accepted_step/);
  assert.match(text, /@lid/);
  assert.match(text, /THEN 'held'/);
  assert.match(text, /completion_source = 'provider_receipt'/);
  assert.match(text, /quotation_status IS DISTINCT FROM 'emitido'/);
  assert.match(text, /client_archived/);
  assert.match(text, /crm_eligible/);
  assert.match(text, /GROUP BY d\.delivery_id/);
  assert.doesNotMatch(text, /GROUP BY d\.id\b/);
});

test('memory client archive hook projects the durable archive fact', async () => {
  const archived: string[] = [];
  const record: ClientRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    nome: 'Cliente',
    documento: null,
    email: null,
    telefone: null,
    notes: null,
    address: null,
    arquivado: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
  };
  const repository = new MemoryClientRepository({
    initial: [record],
    now: () => new Date('2026-08-31T00:00:00.000Z'),
    onArchived: (clientId) => {
      archived.push(clientId);
    },
  });

  await repository.archive(record.id);

  assert.deepEqual(archived, [record.id]);
  assert.equal((await repository.get(record.id))?.arquivado, true);
});
