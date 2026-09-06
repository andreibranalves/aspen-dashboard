import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAdsOfflineArgs,
  runAdsOffline,
} from '../../scripts/ads-offline.mjs';

const VALID_ARGS = ['--from', '2026-09-01T00:00:00Z', '--to', '2026-09-02T00:00:00Z'];

test('ads offline CLI requires one explicit mode and refuses force', () => {
  assert.equal(parseAdsOfflineArgs([...VALID_ARGS, '--dry-run']).mode, 'dry-run');
  assert.equal(
    parseAdsOfflineArgs([
      ...VALID_ARGS,
      '--apply',
      '--approved-orders',
      'orders.json',
      '--preflight-proof',
      'proof.json',
    ]).mode,
    'apply'
  );
  assert.throws(() => parseAdsOfflineArgs(VALID_ARGS), /exatamente/);
  assert.throws(() => parseAdsOfflineArgs([...VALID_ARGS, '--dry-run', '--apply']), /exatamente/);
  assert.throws(() => parseAdsOfflineArgs([...VALID_ARGS, '--dry-run', '--force']), /Argumento inválido/);
  assert.throws(() => parseAdsOfflineArgs([...VALID_ARGS, '--apply']), /approved-orders/);
});

test('ads offline CLI dry-run has no database connection or transport call in the seam', async () => {
  let databaseCalls = 0;
  let transportCalls = 0;
  let stdout = '';
  let stderr = '';
  const exitCode = await runAdsOffline({
    argv: [...VALID_ARGS, '--dry-run'],
    env: {},
    getDatabase: () => {
      databaseCalls += 1;
      throw new Error('database should be opened by repository only');
    },
    createRepository: () => ({
      listOrderEvidence: async () => [],
      getByIdentity: async () => null,
    }),
    createTransport: () => ({
      ingest: async () => {
        transportCalls += 1;
        throw new Error('transport should not run');
      },
      retrieveStatus: async () => {
        transportCalls += 1;
        throw new Error('diagnostic should not run');
      },
    }),
    closeDatabase: async () => undefined,
    stdout: { write: (value: string) => { stdout += value; return true; } },
    stderr: { write: (value: string) => { stderr += value; return true; } },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout), {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
    destination: 'unverified',
    preflightVerified: false,
    counts: {},
    rows: [],
  });
  assert.equal(databaseCalls, 0);
  assert.equal(transportCalls, 0);
  assert.equal(stderr, '');
});

test('ads offline CLI sanitizes infrastructure errors', async () => {
  let stderr = '';
  const secret = 'synthetic-password';
  const exitCode = await runAdsOffline({
    argv: [...VALID_ARGS, '--dry-run'],
    env: {},
    createRepository: () => {
      throw new Error(`password=${secret}`);
    },
    closeDatabase: async () => undefined,
    stdout: { write: () => true },
    stderr: { write: (value: string) => { stderr += value; return true; } },
  });
  assert.equal(exitCode, 1);
  assert.equal(stderr, 'Falha ao executar exportação offline.\n');
  assert.equal(stderr.includes(secret), false);
});

