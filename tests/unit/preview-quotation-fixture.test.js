import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planPreviewQuotationReset,
  restorePreviewQuotationFixture,
} from '../../scripts/lib/preview-quotation-fixture.mjs';

const SAFE_ENV = {
  APP_ENV: 'preview',
  EXTERNAL_WRITES_ENABLED: '0',
  PREVIEW_FIXTURE_RESET: '1',
  KNOWN_POSTGRES_QUOTATION_ID: 'ORC-20260001',
  KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: 'ORC-20269999',
  DATABASE_URL: 'postgresql://preview:password@preview.example:5432/aspen_preview',
  PRODUCTION_DATABASE_URL: 'postgresql://production:password@production.example:5432/aspen',
};

const NOW = new Date('2026-09-14T12:00:00.000Z');

function baselineState(overrides = {}) {
  return {
    quotation: {
      id: 'quotation-uuid',
      business_number: 'ORC-20269999',
      status: 'emitido',
      issued_at: '2026-09-10T12:00:00.000Z',
      loss_reason: null,
    },
    revisions: [
      {
        id: 'revision-one-uuid',
        version: 1,
        status: 'emitido',
        issued_at: '2026-09-10T12:00:00.000Z',
        validade_dias: 30,
      },
    ],
    issuedDocuments: [],
    draft: null,
    ...overrides,
  };
}

function draftState(overrides = {}) {
  return baselineState({
    quotation: {
      ...baselineState().quotation,
      status: 'rascunho',
    },
    revisions: [
      ...baselineState().revisions,
      {
        id: 'revision-two-uuid',
        version: 2,
        status: 'rascunho',
        issued_at: null,
        validade_dias: 30,
      },
    ],
    draft: {
      itemCount: 2,
      activityEventCount: 4,
      blockedReferences: {
        issuedDocuments: 0,
        opportunityDeliveryAnchors: 0,
        quotationDeliveries: 0,
        quotationEmailDeliveries: 0,
        quotationFollowUps: 0,
        quotationIssueRequests: 0,
        salesOrders: 0,
      },
    },
    ...overrides,
  });
}

test('configuração/identidade coincidente falha antes de abrir conexão', async () => {
  let connections = 0;

  await assert.rejects(
    () =>
      restorePreviewQuotationFixture(
        { ...SAFE_ENV, PRODUCTION_DATABASE_URL: SAFE_ENV.DATABASE_URL },
        { connect: () => { connections += 1; } },
      ),
    /mesmo banco/,
  );

  assert.equal(connections, 0);
});

test('IDs primário e scratch coincidentes falham antes de abrir conexão', async () => {
  let connections = 0;

  await assert.rejects(
    () =>
      restorePreviewQuotationFixture(
        {
          ...SAFE_ENV,
          KNOWN_POSTGRES_QUOTATION_ID: ' orc-20269999 ',
        },
        { connect: () => { connections += 1; } },
      ),
    /mesmo orçamento/,
  );

  assert.equal(connections, 0);
});

test('baseline emitido válido é no-op validado', () => {
  assert.deepEqual(planPreviewQuotationReset(baselineState(), NOW), { kind: 'noop' });
});

test('helper valida baseline dentro de transação e não emite mutação', async () => {
  const statements = [];
  const tx = async (strings) => {
    const statement = strings.join(' ');
    statements.push(statement);
    if (/^SET LOCAL|pg_advisory_xact_lock/.test(statement.trim())) return [];
    if (statement.includes('FROM quotations')) {
      return [baselineState().quotation];
    }
    if (statement.includes('FROM quote_revisions')) {
      return baselineState().revisions;
    }
    if (statement.includes('FROM issued_documents')) {
      return baselineState().issuedDocuments;
    }
    throw new Error('unexpected query');
  };
  let ended = false;
  const client = {
    begin: async (callback) => callback(tx),
    end: async () => { ended = true; },
  };

  await restorePreviewQuotationFixture(SAFE_ENV, {
    connect: () => client,
    now: () => NOW,
  });

  assert.equal(ended, true);
  assert.equal(statements.some((statement) => /^\s*(DELETE|UPDATE)\b/im.test(statement)), false);
});

test('R1 emitida mais R2 rascunho produz plano restrito', () => {
  assert.deepEqual(planPreviewQuotationReset(draftState(), NOW), {
    kind: 'restore',
    quotationId: 'quotation-uuid',
    draftRevisionId: 'revision-two-uuid',
    activityReferencePrefix: 'orcamento:quotation-uuid:revision-two-uuid:',
    itemCount: 2,
    activityEventCount: 4,
  });
});

test('estados, versões, referências e cardinalidades inesperados falham fechados', () => {
  const cases = [
    { quotation: { ...baselineState().quotation, status: 'aprovado' } },
    { quotation: { ...draftState().quotation, loss_reason: 'não esperado' } },
    { revisions: [{ ...baselineState().revisions[0], status: 'rascunho' }] },
    {
      revisions: [
        ...draftState().revisions,
        { id: 'revision-three-uuid', version: 3, status: 'rascunho', issued_at: null, validade_dias: 30 },
      ],
    },
    {
      revisions: draftState().revisions.map((revision) =>
        revision.version === 2 ? { ...revision, status: 'emitido', issued_at: NOW.toISOString() } : revision,
      ),
    },
    { draft: { ...draftState().draft, itemCount: 0 } },
    { draft: { ...draftState().draft, activityEventCount: 3 } },
    {
      draft: {
        ...draftState().draft,
        blockedReferences: { ...draftState().draft.blockedReferences, salesOrders: 1 },
      },
    },
    {
      revisions: [{ ...baselineState().revisions[0], issued_at: '2020-01-01T00:00:00.000Z' }],
    },
  ];

  for (const overrides of cases) {
    assert.throws(() => planPreviewQuotationReset(draftState(overrides), NOW));
  }
});

test('configuração insegura e ID fora do contrato falham antes da conexão', async () => {
  for (const overrides of [
    { APP_ENV: 'production' },
    { EXTERNAL_WRITES_ENABLED: '1' },
    { PREVIEW_FIXTURE_RESET: '0' },
    { KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: '00000000-0000-4000-8000-000000000001' },
    { DATABASE_URL: 'not-a-postgres-url' },
    { PRODUCTION_DATABASE_URL: '' },
  ]) {
    let connections = 0;
    await assert.rejects(
      () => restorePreviewQuotationFixture({ ...SAFE_ENV, ...overrides }, { connect: () => { connections += 1; } }),
    );
    assert.equal(connections, 0, JSON.stringify(overrides));
  }
});
