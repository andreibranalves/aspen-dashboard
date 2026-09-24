import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OPERATION_ENV_CONTRACTS,
  checkOperationEnv,
  fillFromExternalConfig,
  inspectOperationEnv,
  loadOperationEnv,
  operationNames,
  assertOperationEnv,
} from '../../scripts/lib/operation-env.mjs';

const secret = 'sentinel-secret-value';

function withTempDir(callback) {
  const root = mkdtempSync(join(tmpdir(), 'operation-env-'));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function externalFileFixture(root, values) {
  const filePath = join(root, 'external.env');
  writeFileSync(
    filePath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n'
  );
  return filePath;
}

function contractValues(operation, root, overrides = {}) {
  const contract = OPERATION_ENV_CONTRACTS[operation];
  const values = {};
  const protectedPaths = {};
  let index = 0;
  for (const key of [...contract.keys, ...contract.anyOf.flat()]) {
    if (contract.paths[key]) {
      const filePath = join(root, `protected-${index++}.conf`);
      writeFileSync(filePath, `# arquivo protegido para ${key}\n`);
      chmodSync(filePath, 0o600);
      values[key] = filePath;
      protectedPaths[key] = filePath;
    } else {
      values[key] = `valor-de-${key}`;
    }
  }
  return { ...values, ...overrides };
}

const OPERATIONS = operationNames();

test('contratos existem para as operações e são distintos entre si', () => {
  assert.deepEqual([...OPERATIONS].sort(), [
    'backup-restore',
    'migration',
    'migration-production',
    'preview-e2e',
    'runtime',
  ]);
});

test('migration-production exige os guardas de identidade de produção, não os de staging', () => {
  const contract = OPERATION_ENV_CONTRACTS['migration-production'];
  for (const key of [
    'PRODUCTION_DATABASE_URL',
    'DATABASE_URL',
    'PRODUCTION_PG_SERVICE',
    'CUTOVER_PG_SERVICE',
    'CUTOVER_EXPECTED_DATABASE',
    'PGSERVICEFILE',
    'PGPASSFILE',
  ])
    assert.ok(contract.keys.includes(key), `migration-production deve exigir ${key}`);
  assert.ok(!contract.keys.includes('STAGING_DATABASE_URL'));
  assert.ok(!contract.keys.includes('STAGING_PG_SERVICE'));
  assert.equal(contract.paths.PGSERVICEFILE, true);
  assert.equal(contract.paths.PGPASSFILE, true);
});

test('migration-production exige CUTOVER_BACKUP_DIR ou BACKUP_DIR e marca o irmão como not-needed', () => {
  withTempDir((root) => {
    const base = contractValues('migration-production', root);
    const withoutBackup: NodeJS.ProcessEnv = { ...base, CUTOVER_ENV_FILE: '/nao/existe.env' };
    delete withoutBackup.CUTOVER_BACKUP_DIR;
    delete withoutBackup.BACKUP_DIR;

    const missingBoth = inspectOperationEnv('migration-production', { env: withoutBackup });
    assert.equal(missingBoth.ok, false);
    assert.deepEqual(
      missingBoth.keys.find(({ name }) => name === 'CUTOVER_BACKUP_DIR'),
      {
        name: 'CUTOVER_BACKUP_DIR',
        status: 'missing',
      }
    );

    const withOne = inspectOperationEnv('migration-production', {
      env: { ...withoutBackup, BACKUP_DIR: 'valor-de-BACKUP_DIR' },
    });
    assert.equal(withOne.ok, true);
    assert.deepEqual(
      withOne.keys.find(({ name }) => name === 'CUTOVER_BACKUP_DIR'),
      {
        name: 'CUTOVER_BACKUP_DIR',
        status: 'not-needed',
      }
    );
  });
});

test('checkOperationEnv satisfaz anyOf de backup com um membro e falha sem nenhum', () => {
  withTempDir((root) => {
    const values = contractValues('migration-production', root);
    delete values.CUTOVER_BACKUP_DIR;
    const withOne = checkOperationEnv('migration-production', values);
    assert.equal(withOne.ok, true);
    assert.deepEqual(
      withOne.keys.find(({ name }) => name === 'CUTOVER_BACKUP_DIR'),
      {
        name: 'CUTOVER_BACKUP_DIR',
        status: 'not-needed',
      }
    );

    const withoutBoth = checkOperationEnv('migration-production', {
      ...values,
      BACKUP_DIR: '',
    });
    assert.equal(withoutBoth.ok, false);
  });
});

test('operações não exigem credenciais de workflows não relacionados', () => {
  const separations = [
    ['migration', ['RESEND_API_KEY', 'BLOB_READ_WRITE_TOKEN']],
    [
      'preview-e2e',
      [
        'RESEND_API_KEY',
        'BLOB_READ_WRITE_TOKEN',
        'STAGING_DATABASE_URL',
        'STAGING_PG_SERVICE',
      ],
    ],
    ['backup-restore', ['RESEND_API_KEY', 'E2E_PASSWORD', 'STAGING_DATABASE_URL']],
  ] as const;

  for (const [operation, unrelated] of separations) {
    const contract = OPERATION_ENV_CONTRACTS[operation];
    for (const key of unrelated) {
      assert.ok(!contract.keys.includes(key), `${operation} não deve exigir ${key} em keys`);
      assert.ok(
        !contract.anyOf.some((group) => group.includes(key)),
        `${operation} não deve exigir ${key} em anyOf`
      );
    }
  }
});

test('Preview E2E usa o contrato do deployment e não o alvo técnico de migrations', () => {
  const contract = OPERATION_ENV_CONTRACTS['preview-e2e'];
  for (const key of [
    'PREVIEW_BASE_URL',
    'DATABASE_URL',
    'PRODUCTION_DATABASE_URL',
    'E2E_USERNAME',
    'E2E_PASSWORD',
    'PREVIEW_E2E_USERNAME',
    'VERCEL_AUTOMATION_BYPASS_SECRET',
    'PREVIEW_EGRESS_BLOCKED',
    'PREVIEW_FIXTURE_RESET',
  ]) {
    assert.ok(contract.keys.includes(key), `preview-e2e deve exigir ${key}`);
  }
  for (const key of ['STAGING_DATABASE_URL', 'STAGING_PG_SERVICE']) {
    assert.ok(!contract.keys.includes(key), `preview-e2e não deve exigir ${key}`);
  }
});

for (const operation of OPERATIONS) {
  test(`[${operation}] origem externa completa -> ok sem expor valores`, () => {
    withTempDir((root) => {
      const filePath = externalFileFixture(root, contractValues(operation, root));
      const result = inspectOperationEnv(operation, { env: { CUTOVER_ENV_FILE: filePath } });

      assert.equal(result.ok, true);
      assert.equal(result.files[0].status, 'present');
      assert.doesNotMatch(JSON.stringify(result), /valor-de-/);
    });
  });

  test(`[${operation}] sem origem carregável falha fechada apenas com nomes`, () => {
    const result = inspectOperationEnv(operation, {
      env: {
        CUTOVER_ENV_FILE: '/nao/existe.env',
        CUTOVER_EXPECTED_DATABASE: undefined,
      } as NodeJS.ProcessEnv,
    });
    assert.equal(result.ok, false);
    const firstRequired = OPERATION_ENV_CONTRACTS[operation].keys[0];
    assert.deepEqual(
      result.keys.find(({ name }) => name === firstRequired),
      { name: firstRequired, status: 'missing' }
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  });
}

test('valores vazios ou somente aspas contam como ausentes', () => {
  withTempDir((root) => {
    const filePath = externalFileFixture(root, {
      DATABASE_URL: '   ',
      APP_ENV: "''",
      EXTERNAL_WRITES_ENABLED: '"  "',
      RESEND_API_KEY: secret,
      RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>',
    });
    assert.throws(
      () => loadOperationEnv('runtime', { env: { CUTOVER_ENV_FILE: filePath } }),
      /Ambiente incompleto para a operação runtime/
    );
  });
});

test('checkOperationEnv valida o ambiente fornecido e protege arquivos 0600', () => {
  withTempDir((root) => {
    const insecure = join(root, 'pgpass-insecure');
    writeFileSync(insecure, '# pass');
    chmodSync(insecure, 0o644);
    const secure = join(root, 'pgpass-secure');
    writeFileSync(secure, '# pass');
    chmodSync(secure, 0o600);

    const env = {
      STAGING_DATABASE_URL: 'postgresql://staging.test/aspen_stage',
      STAGING_PG_SERVICE: 'staging',
      PRODUCTION_DATABASE_URL: 'postgresql://prod.test/aspen',
      PGSERVICEFILE: secure,
      PGPASSFILE: insecure,
    };
    const result = checkOperationEnv('migration', env);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.keys.find(({ name }) => name === 'PGPASSFILE'),
      { name: 'PGPASSFILE', status: 'invalid-permission' }
    );
    assert.doesNotMatch(String(env.PGPASSFILE), new RegExp(secret));

    chmodSync(insecure, 0o600);
    assert.equal(checkOperationEnv('migration', env).ok, true);

    try {
      assertOperationEnv('migration', {
        env: { ...env, STAGING_DATABASE_URL: '' },
        exists: () => false,
      });
      assert.fail('deveria lançar');
    } catch (error) {
      assert.match(
        String((error as Error).message),
        /Ambiente incompleto para a operação migration/
      );
    }
  });
});

test('symlink não é aceito como arquivo protegido', () => {
  withTempDir((root) => {
    const target = join(root, 'real');
    writeFileSync(target, '# pass');
    chmodSync(target, 0o600);
    const link = join(root, 'link');
    try {
      symlinkSync(target, link);
    } catch {
      return; // plataforma sem suporte
    }
    const result = checkOperationEnv('migration', {
      STAGING_DATABASE_URL: 'x',
      STAGING_PG_SERVICE: 'y',
      PRODUCTION_DATABASE_URL: 'z',
      PGSERVICEFILE: link,
      PGPASSFILE: link,
    });
    assert.equal(result.ok, false);
  });
});

test('anyOf de tokens: basta um membro presente; o irmão fica not-needed', () => {
  withTempDir((root) => {
    const filePath = externalFileFixture(root, {
      DATABASE_URL: 'postgresql://prod.test/aspen',
      BLOB_READ_WRITE_TOKEN: secret,
      CUTOVER_PG_SERVICE: 'svc',
      CUTOVER_EXPECTED_DATABASE: 'aspen',
    });
    const result = inspectOperationEnv('backup-restore', { env: { CUTOVER_ENV_FILE: filePath } });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.keys.find(({ name }) => name === 'QUOTATION_BLOB_READ_WRITE_TOKEN'),
      {
        name: 'QUOTATION_BLOB_READ_WRITE_TOKEN',
        status: 'not-needed',
      }
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  });
});

test('loadOperationEnv preenche ausentes da origem externa e falha fechada sem origem', () => {
  withTempDir((root) => {
    const filePath = externalFileFixture(
      root,
      contractValues('backup-restore', root, { DATABASE_URL: secret })
    );
    const env = { CUTOVER_ENV_FILE: filePath };
    const result = loadOperationEnv('backup-restore', { env });
    assert.equal(result.ok, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));

    assert.throws(
      () => loadOperationEnv('backup-restore', { env: { CUTOVER_ENV_FILE: '/nao/existe.env' } }),
      /Ambiente incompleto para a operação backup-restore: DATABASE_URL \(missing\)/
    );
  });
});

test('fillFromExternalConfig nunca sobrescreve variáveis presentes no processo', () => {
  withTempDir((root) => {
    const secure = join(root, 'pg_service.conf');
    writeFileSync(secure, '[staging]\nhost=from-file\nport=5433\ndbname=aspen_test\n');
    chmodSync(secure, 0o600);
    const insecure = join(root, 'pgpass-inseguro');
    writeFileSync(insecure, '# pass');
    chmodSync(insecure, 0o644);

    const filePath = externalFileFixture(root, {
      STAGING_DATABASE_URL: 'x',
      STAGING_PG_SERVICE: 'y',
      PRODUCTION_DATABASE_URL: 'z',
      PGSERVICEFILE: secure,
      PGPASSFILE: secure,
    });
    fillFromExternalConfig({
      CUTOVER_ENV_FILE: filePath,
      PGPASSFILE: insecure,
    } as NodeJS.ProcessEnv);
    // prova de precedência: o valor do processo venceu e rejeita modo 0644
    assert.equal(
      checkOperationEnv('migration', {
        STAGING_DATABASE_URL: 'x',
        STAGING_PG_SERVICE: 'y',
        PRODUCTION_DATABASE_URL: 'z',
        PGSERVICEFILE: secure,
        PGPASSFILE: insecure,
      }).ok,
      false
    );
    assert.match(readFileSync(filePath, 'utf8'), /PGPASSFILE=/);
  });
});
