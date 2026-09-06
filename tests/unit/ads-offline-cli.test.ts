import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { parseAdsOfflineArgs, runAdsOffline } from '../../scripts/ads-offline.mjs';

const VALID_ARGS = ['--from', '2026-09-01T00:00:00Z', '--to', '2026-09-02T00:00:00Z'];
const EXPORT_ID = '55555555-5555-4555-8555-555555555555';
const DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:55434/aspen_test';
const DATABASE_FINGERPRINT = createHash('sha256')
  .update('127.0.0.1|55434|aspen_test')
  .digest('hex');
const RUNTIME_ENV = {
  DATABASE_URL,
  ADS_OFFLINE_RUNTIME_TARGET: 'synthetic-disposable',
  ADS_OFFLINE_RUNTIME_OWNER: 'synthetic-operator',
  ADS_OFFLINE_RUNTIME_DEPLOYMENT_REF: 'synthetic-deployment',
  GOOGLE_DATA_MANAGER_CLIENT_ID: 'synthetic-client',
  GOOGLE_DATA_MANAGER_CLIENT_SECRET: 'synthetic-secret',
  GOOGLE_DATA_MANAGER_REFRESH_TOKEN: 'synthetic-refresh',
  GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: '1234567890',
  GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: '9876543210',
};

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
  assert.throws(
    () => parseAdsOfflineArgs([...VALID_ARGS, '--dry-run', '--force']),
    /Argumento inválido/
  );
  assert.throws(() => parseAdsOfflineArgs([...VALID_ARGS, '--apply']), /approved-orders/);
  assert.equal(
    parseAdsOfflineArgs(['--diagnose', EXPORT_ID, '--preflight-proof', 'proof.json']).mode,
    'diagnose'
  );
  assert.throws(() => parseAdsOfflineArgs(['--diagnose', EXPORT_ID]), /preflight-proof/);
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
    stdout: {
      write: (value: string) => {
        stdout += value;
        return true;
      },
    },
    stderr: {
      write: (value: string) => {
        stderr += value;
        return true;
      },
    },
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
    stderr: {
      write: (value: string) => {
        stderr += value;
        return true;
      },
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(stderr, 'Falha ao executar exportação offline.\n');
  assert.equal(stderr.includes(secret), false);
});

test('ads offline CLI runs the protected diagnostic path without ingesting', async () => {
  let ingestCalls = 0;
  let diagnosticCalls = 0;
  let recordedStatus = '';
  let stdout = '';
  const proof = {
    target: RUNTIME_ENV.ADS_OFFLINE_RUNTIME_TARGET,
    owner: RUNTIME_ENV.ADS_OFFLINE_RUNTIME_OWNER,
    databaseFingerprint: DATABASE_FINGERPRINT,
    deploymentRef: RUNTIME_ENV.ADS_OFFLINE_RUNTIME_DEPLOYMENT_REF,
    operatingAccountId: RUNTIME_ENV.GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID,
    productDestinationId: RUNTIME_ENV.GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID,
    productDestinationType: 'UPLOAD_CLICKS',
    oauthScope: 'https://www.googleapis.com/auth/datamanager',
    verifiedAt: '2026-09-01T12:00:00.000Z',
  };
  const exitCode = await runAdsOffline({
    argv: ['--diagnose', EXPORT_ID, '--preflight-proof', 'proof.json'],
    env: RUNTIME_ENV,
    createRepository: () => ({
      get: async (id: string) =>
        id === EXPORT_ID ? { state: 'accepted_pending_diagnostic' } : null,
      getLatestAcceptedAttempt: async () => ({
        id: '66666666-6666-4666-8666-666666666666',
        requestId: 'request-synthetic',
      }),
      recordDiagnostic: async ({ result }: { result: { status: string } }) => {
        recordedStatus = result.status;
        return true;
      },
    }),
    createTransport: () => ({
      ingest: async () => {
        ingestCalls += 1;
        throw new Error('ingest must not run');
      },
      retrieveStatus: async () => {
        diagnosticCalls += 1;
        return { status: 'success' as const };
      },
    }),
    readFile: () => JSON.stringify(proof),
    closeDatabase: async () => undefined,
    stdout: {
      write: (value: string) => {
        stdout += value;
        return true;
      },
    },
    stderr: { write: () => true },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout), { exportId: EXPORT_ID, diagnosed: true });
  assert.equal(diagnosticCalls, 1);
  assert.equal(ingestCalls, 0);
  assert.equal(recordedStatus, 'success');
});
