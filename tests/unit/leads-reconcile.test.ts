import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  assertApplyPreflight,
  buildSanityQuery,
  parseReconcileArgs,
  runReconciliation,
} from '../../scripts/leads-reconcile.mjs';

const from = '2026-09-01T00:00:00.000Z';
const to = '2026-09-02T00:00:00.000Z';

test('reconciliation requires an explicit valid half-open interval and mode', () => {
  assert.throws(() => parseReconcileArgs(['--dry-run']), /--from/);
  assert.throws(() => parseReconcileArgs(['--from', to, '--to', from, '--dry-run']), /intervalo/);
  assert.deepEqual(parseReconcileArgs(['--from', from, '--to', to, '--dry-run']), {
    from,
    to,
    mode: 'dry-run',
    target: null,
  });
});

test('Sanity query is deterministic and excludes drafts and versions', () => {
  const query = buildSanityQuery();
  assert.match(query, /order\(createdAt asc, _id asc\)/);
  assert.match(query, /drafts\.\*\*/);
  assert.match(query, /versions\.\*\*/);
  assert.match(query, /createdAt >= \$from/);
  assert.match(query, /createdAt < \$to/);
});

test('dry-run paginates without writes and reports create, deduplicate, reject, conflict and errors', async () => {
  const documents = [
    {
      _id: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
      createdAt: from,
      payloadFingerprint: 'a'.repeat(64),
      name: 'A',
      email: 'a@example.invalid',
      whatsapp: '21999990000',
      product: 'Canga',
      quantity: 100,
    },
    {
      _id: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abd',
      createdAt: from,
      payloadFingerprint: 'b'.repeat(64),
      name: 'B',
      email: 'b@example.invalid',
      whatsapp: '21999990001',
      product: 'Canga',
      quantity: 100,
    },
    { _id: 'zz invalid', createdAt: from },
  ];
  let writes = 0;
  let pages = 0;
  const report = await runReconciliation(
    { from, to, mode: 'dry-run', target: null },
    {
      readPage: async ({ cursorId }) => {
        pages += 1;
        if (!cursorId) return documents.slice(0, 2);
        if (cursorId === documents[1]._id) return documents.slice(2);
        return [];
      },
      inspect: async (input) => (input.externalId === documents[0]._id ? 'create' : 'deduplicate'),
      ingest: async () => {
        writes += 1;
        return { result: 'created' };
      },
    }
  );
  assert.equal(pages, 3);
  assert.equal(writes, 0);
  assert.deepEqual(report, {
    lidos: 3,
    rejeitados: 1,
    erros: 0,
    conflitos: 0,
    criaria: 1,
    deduplicaria: 1,
  });
});

test('apply reexecution reports committed results separately and does not skip after an intermediate failure', async () => {
  const document = {
    _id: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
    createdAt: from,
    payloadFingerprint: 'a'.repeat(64),
    name: 'A',
    email: 'a@example.invalid',
    whatsapp: '21999990000',
    product: 'Canga',
    quantity: 100,
    consentGiven: true,
  };
  const committed = new Set<string>();
  const applyOnce = (failAfterFirstPage = false) => {
    let pages = 0;
    return runReconciliation(
      { from, to, mode: 'apply', target: 'staging' },
      {
        readPage: async () => {
          pages += 1;
          if (pages === 1) return [document];
          if (failAfterFirstPage) throw new Error('synthetic_read_failure');
          return [];
        },
        inspect: async () => 'create',
        ingest: async (input) => {
          const result = committed.has(input.externalId) ? 'deduplicated' : 'created';
          committed.add(input.externalId);
          return { result };
        },
      }
    );
  };

  assert.deepEqual(await applyOnce(true), {
    lidos: 1,
    rejeitados: 0,
    erros: 1,
    conflitos: 0,
    criados: 1,
    deduplicados: 0,
  });
  assert.deepEqual(await applyOnce(), {
    lidos: 1,
    rejeitados: 0,
    erros: 0,
    conflitos: 0,
    criados: 0,
    deduplicados: 1,
  });
});

test('apply requires an explicit approved target and matching database and Sanity identities', () => {
  const databaseUrl = 'postgresql://ignored:ignored@db.internal:5433/aspen_test';
  const databaseFingerprint = createHash('sha256')
    .update('db.internal|5433|aspen_test')
    .digest('hex');
  const options = parseReconcileArgs([
    '--from',
    from,
    '--to',
    to,
    '--apply',
    '--target',
    'staging',
  ]);
  const environment = {
    APP_ENV: 'staging',
    LEADS_RECONCILE_APPROVED_TARGET: 'staging',
    LEADS_RECONCILE_APPLY_APPROVED: '1',
    DATABASE_URL: databaseUrl,
    LEADS_RECONCILE_DATABASE_FINGERPRINT: databaseFingerprint,
    SANITY_PROJECT_ID: 'site-project',
    SANITY_DATASET: 'staging',
    LEADS_RECONCILE_SANITY_PROJECT_ID: 'site-project',
    LEADS_RECONCILE_SANITY_DATASET: 'staging',
  };

  assert.doesNotThrow(() => assertApplyPreflight(options, environment));
  assert.throws(
    () => assertApplyPreflight(options, { ...environment, LEADS_RECONCILE_APPLY_APPROVED: '0' }),
    /alvo aprovado/
  );
  assert.throws(
    () => assertApplyPreflight(options, { ...environment, SANITY_DATASET: 'production' }),
    /alvo aprovado/
  );
});
