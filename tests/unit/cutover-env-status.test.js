import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

import { OPERATION_ENV_CONTRACTS } from '../../scripts/lib/operation-env.mjs';

const scriptPath = fileURLToPath(new URL('../../scripts/cutover-env-status.mjs', import.meta.url));
const secret = 'sentinel-secret-value';
const OPERATIONS = Object.keys(OPERATION_ENV_CONTRACTS);

function withTempDir(callback) {
  const root = mkdtempSync(join(tmpdir(), 'cutover-env-status-'));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeCompleteFixture(root) {
  const protectedIndex = { n: 0 };
  const lines = [];
  for (const [operation, contract] of Object.entries(OPERATION_ENV_CONTRACTS)) {
    void operation;
    for (const key of [...contract.keys, ...contract.anyOf.slice(0, 1).flat()]) {
      if (lines.some((line) => line.startsWith(`${key}=`))) continue;
      if (contract.paths[key]) {
        const filePath = join(root, `protected-${protectedIndex.n++}.conf`);
        writeFileSync(filePath, '# protegido\n');
        chmodSync(filePath, 0o600);
        lines.push(`${key}=${filePath}`);
      } else {
        lines.push(`${key}=valor-operacional`);
      }
    }
  }
  const path = join(root, 'external.env');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function runCli(args, env) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('CLI sem argumento lista todas as operações e sai limpo quando completo', () => {
  withTempDir((root) => {
    const fixture = writeCompleteFixture(root);
    const result = runCli([], { CUTOVER_ENV_FILE: fixture });

    assert.equal(result.status, 0, result.stderr);
    for (const operation of OPERATIONS) {
      assert.match(result.stdout, new RegExp(`operacao: ${operation}`));
    }
    assert.doesNotMatch(result.stdout, /valor-operacional|sentinel/);
    assert.equal(result.stderr, '');
  });
});

test('CLI falha quando uma chave obrigatória está ausente e sugere o detalhamento', () => {
  withTempDir((root) => {
    const fixture = writeCompleteFixture(root);
    const content = readFileSync(fixture, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('RESEND_FROM_EMAIL='))
      .join('\n');
    writeFileSync(fixture, content);

    const result = runCli([], { CUTOVER_ENV_FILE: fixture });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /RESEND_FROM_EMAIL: missing/);
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.match(result.stderr, /use <operacao> para detalhes/);
  });
});

test('CLI filtra por operação solicitada', () => {
  withTempDir((root) => {
    const fixture = writeCompleteFixture(root);
    const result = runCli(['migration'], { CUTOVER_ENV_FILE: fixture });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /operacao: migration/);
    assert.doesNotMatch(result.stdout, /operacao: backup-restore/);
  });
});

test('CLI falha fechada para operação desconhecida', () => {
  const result = runCli(['nao-existe'], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Operação desconhecida/);
});

test('saída nunca contém valores das variáveis', () => {
  withTempDir((root) => {
    const filePath = join(root, 'external.env');
    const contract = OPERATION_ENV_CONTRACTS['backup-restore'];
    const lines = [...contract.keys, ...contract.anyOf.flat()].map((key) => `${key}=${secret}`);
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const result = runCli(['backup-restore'], { CUTOVER_ENV_FILE: filePath });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.match(result.stdout, /DATABASE_URL: present/);
  });
});
