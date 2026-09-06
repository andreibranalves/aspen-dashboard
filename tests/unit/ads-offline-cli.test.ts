import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createDatabaseConnection } from '../../api/_infrastructure/db/client.js';
import {
  parsePostgresRuntimeUrl,
  postgresRuntimeIdentity,
} from '../../api/_shared/postgres-target.js';
import {
  parseAdsOfflineArgs,
  resolveAdsOfflineRuntimeTarget,
  runAdsOffline,
} from '../../scripts/ads-offline.mjs';

const VALID_ARGS = ['--from', '2026-09-01T00:00:00Z', '--to', '2026-09-02T00:00:00Z'];
const EXPORT_ID = '55555555-5555-4555-8555-555555555555';
const DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:55434/aspen_test';
const INVALID_RUNTIME_HOSTS = [
  '[::1]',
  '%5B%3A%3A1%5D',
  '%3A%3A1',
  '%5b%3a%3a1%5d',
  '%255B%253A%253A1%255D',
];
const DATABASE_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(['127.0.0.1', '55434', 'aspen_test', 'synthetic']))
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

test('ads offline preflight rejects ambiguous PostgreSQL selectors before any effect', async () => {
  const proof = JSON.stringify({ databaseFingerprint: DATABASE_FINGERPRINT });
  const cases = [
    {
      ...RUNTIME_ENV,
      DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1/aspen_test',
      PGPORT: '55434',
    },
    {
      ...RUNTIME_ENV,
      DATABASE_URL: 'postgresql://:synthetic@127.0.0.1:55434/aspen_test',
      PGUSER: 'synthetic',
    },
    {
      ...RUNTIME_ENV,
      DATABASE_URL: `${DATABASE_URL}?service=synthetic-service`,
    },
    { ...RUNTIME_ENV, PGSERVICE: 'synthetic-service' },
    { ...RUNTIME_ENV, PGPASSFILE: '/synthetic/passfile' },
    { ...RUNTIME_ENV, PGOPTIONS: '-c search_path=synthetic' },
  ];

  for (const env of cases) {
    assert.throws(() => resolveAdsOfflineRuntimeTarget(env), /DATABASE_URL|ambíguo|explícit/);
  }

  const effects: string[] = [];
  let fileReads = 0;
  let stderr = '';
  const exitCode = await runAdsOffline({
    argv: [
      '--from',
      '2026-09-01T00:00:00Z',
      '--to',
      '2026-09-02T00:00:00Z',
      '--apply',
      '--approved-orders',
      'orders.json',
      '--preflight-proof',
      'proof.json',
    ],
    env: {
      ...RUNTIME_ENV,
      DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1/aspen_test',
      PGPORT: '55434',
    },
    getDatabase: () => {
      effects.push('database');
      throw new Error('database must not be constructed');
    },
    createRepository: () => {
      effects.push('repository');
      throw new Error('repository must not be constructed');
    },
    createTransport: () => {
      effects.push('transport');
      throw new Error('transport must not be constructed');
    },
    readFile: () => {
      fileReads += 1;
      return proof;
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
  assert.deepEqual(effects, []);
  assert.equal(fileReads, 0);
  assert.doesNotMatch(stderr, /55434|synthetic/);
});

test('PostgreSQL runtime identity is collision-free after URL decoding', () => {
  const parsed = (user: string, database: string, password = 'synthetic') =>
    parsePostgresRuntimeUrl(
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:55434/${encodeURIComponent(database)}`,
      {}
    );
  const decodedTargets = [
    parsed('c', 'a|b'),
    parsed('b|c', 'a'),
    parsed('usuário', 'base/☃'),
    parsed('usuario\u0301', 'base/☃'),
    parsed('percent%value', 'base|%'),
  ];
  const identities = decodedTargets.map(postgresRuntimeIdentity);

  assert.equal(new Set(identities).size, decodedTargets.length);
  assert.notEqual(identities[0], identities[1]);
  assert.equal(identities[0], postgresRuntimeIdentity(parsed('c', 'a|b', 'other-password')));
  assert.equal(decodedTargets[2].user, 'usuário');
  assert.equal(decodedTargets[4].database, 'base|%');

  const emptyTargets = [
    ['', ''],
    ['', '|'],
    ['|', ''],
    ['a', 'b|c'],
    ['a|b', 'c'],
  ].map(([user, database]) => ({
    raw: '',
    host: '127.0.0.1',
    port: '55434',
    user,
    password: '',
    database,
  }));
  assert.equal(new Set(emptyTargets.map(postgresRuntimeIdentity)).size, emptyTargets.length);
});

test('ads offline rejects a colliding proof/runtime database before protected reads or DB setup', async () => {
  const proofDatabaseUrl = 'postgresql://c:synthetic@127.0.0.1:55434/a%7Cb';
  const runtimeDatabaseUrl = 'postgresql://b%7Cc:synthetic@127.0.0.1:55434/a';
  const proof = JSON.stringify({
    target: RUNTIME_ENV.ADS_OFFLINE_RUNTIME_TARGET,
    owner: RUNTIME_ENV.ADS_OFFLINE_RUNTIME_OWNER,
    databaseFingerprint: createHash('sha256')
      .update(postgresRuntimeIdentity(parsePostgresRuntimeUrl(proofDatabaseUrl, {})))
      .digest('hex'),
    deploymentRef: RUNTIME_ENV.ADS_OFFLINE_RUNTIME_DEPLOYMENT_REF,
    operatingAccountId: RUNTIME_ENV.GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID,
    productDestinationId: RUNTIME_ENV.GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID,
    productDestinationType: 'UPLOAD_CLICKS',
    oauthScope: 'https://www.googleapis.com/auth/datamanager',
    verifiedAt: '2026-09-01T12:00:00.000Z',
  });
  let proofReads = 0;
  let approvedReads = 0;
  const effects: string[] = [];
  let stderr = '';
  const exitCode = await runAdsOffline({
    argv: [
      ...VALID_ARGS,
      '--apply',
      '--approved-orders',
      'orders.json',
      '--preflight-proof',
      'proof.json',
    ],
    env: { ...RUNTIME_ENV, DATABASE_URL: runtimeDatabaseUrl },
    readFile: (path: string) => {
      if (path === 'proof.json') proofReads += 1;
      else approvedReads += 1;
      return path === 'proof.json' ? proof : JSON.stringify([EXPORT_ID]);
    },
    createRepository: () => {
      effects.push('repository');
      throw new Error('repository must not be constructed');
    },
    createTransport: () => {
      effects.push('transport');
      throw new Error('transport must not be constructed');
    },
    stdout: { write: () => true },
    stderr: {
      write: (value: string) => {
        stderr += value;
        return true;
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(proofReads, 1);
  assert.equal(approvedReads, 0);
  assert.deepEqual(effects, []);
  assert.equal(stderr, 'Preflight recusado: preflight_databaseFingerprint_mismatch.\n');
});

test('strict PostgreSQL runtime parser rejects literal and encoded host delimiters', () => {
  for (const host of INVALID_RUNTIME_HOSTS) {
    assert.throws(
      () =>
        parsePostgresRuntimeUrl(`postgresql://synthetic:synthetic@${host}:55434/aspen_test`, {}),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'DATABASE_URL precisa informar um alvo PostgreSQL explícito e não ambíguo.'
    );
  }
});

test('ads offline apply and diagnose reject encoded host delimiters before protected effects', async () => {
  const modes = [
    [
      ...VALID_ARGS,
      '--apply',
      '--approved-orders',
      'orders.json',
      '--preflight-proof',
      'proof.json',
    ],
    ['--diagnose', EXPORT_ID, '--preflight-proof', 'proof.json'],
  ];

  for (const host of INVALID_RUNTIME_HOSTS) {
    for (const argv of modes) {
      let fileReads = 0;
      const effects: string[] = [];
      let stderr = '';
      const exitCode = await runAdsOffline({
        argv,
        env: {
          ...RUNTIME_ENV,
          DATABASE_URL: `postgresql://synthetic:synthetic@${host}:55434/aspen_test`,
        },
        readFile: () => {
          fileReads += 1;
          return '{}';
        },
        getDatabase: () => {
          effects.push('database');
          throw new Error('database must not be constructed');
        },
        createRepository: () => {
          effects.push('repository');
          throw new Error('repository must not be constructed');
        },
        createTransport: () => {
          effects.push('transport');
          throw new Error('transport must not be constructed');
        },
        stdout: { write: () => true },
        stderr: {
          write: (value: string) => {
            stderr += value;
            return true;
          },
        },
      });

      assert.equal(exitCode, 1);
      assert.equal(fileReads, 0);
      assert.deepEqual(effects, []);
      assert.equal(stderr, 'DATABASE_URL ambígua ou inválida para o preflight.\n');
    }
  }
});

test('explicit PostgreSQL URL identity is the same proof and client target', async () => {
  const connection = parsePostgresRuntimeUrl(DATABASE_URL, RUNTIME_ENV);
  const runtimeTarget = resolveAdsOfflineRuntimeTarget(RUNTIME_ENV);
  assert.equal(
    postgresRuntimeIdentity(connection),
    JSON.stringify(['127.0.0.1', '55434', 'aspen_test', 'synthetic'])
  );
  assert.equal(runtimeTarget.databaseFingerprint, DATABASE_FINGERPRINT);

  const database = createDatabaseConnection(DATABASE_URL, { strictTarget: true });
  try {
    assert.deepEqual(
      {
        host: database.client.options.host,
        port: database.client.options.port,
        user: database.client.options.user,
        database: database.client.options.database,
      },
      {
        host: ['127.0.0.1'],
        port: [55434],
        user: 'synthetic',
        database: 'aspen_test',
      }
    );
  } finally {
    await database.client.end({ timeout: 0 });
  }
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
        id === EXPORT_ID
          ? {
              state: 'accepted_pending_diagnostic',
              destinationAccountId: RUNTIME_ENV.GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID,
              destinationActionId: RUNTIME_ENV.GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID,
            }
          : null,
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
