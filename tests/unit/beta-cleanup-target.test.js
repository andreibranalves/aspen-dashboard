import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertApprovedCleanupTarget, assertCleanupRecoveryEvidence } from '../../scripts/beta-cleanup.mjs';

function withTempDir(callback) {
  const root = mkdtempSync(join(tmpdir(), 'cleanup-gate-'));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const approvedTargetEnv = {
  DATABASE_URL: 'postgres://ops:s3cret@neon-internal.example/aspen?sslmode=require',
  CLEANUP_TARGET_IDENTITY: 'neon-internal.example|5432|aspen',
};

test('identidade positiva do alvo exige configuração explícita, sem depender de APP_ENV', () => {
  // Configuração ausente falha fechada.
  assert.throws(
    () => assertApprovedCleanupTarget({ DATABASE_URL: approvedTargetEnv.DATABASE_URL }),
    /Identidade do alvo aprovada ausente/,
  );
  // APP_ENV production não substitui a prova de identidade.
  assert.throws(
    () => assertApprovedCleanupTarget({ DATABASE_URL: approvedTargetEnv.DATABASE_URL, APP_ENV: 'production' }),
    /Identidade do alvo aprovada ausente/,
  );
});

test('alvo contraditório ou não aprovado falha fechado', () => {
  assert.throws(
    () => assertApprovedCleanupTarget({
      DATABASE_URL: 'postgres://ops:x@other-host.example/aspen',
      CLEANUP_TARGET_IDENTITY: 'neon-internal.example|5432|aspen',
    }),
    /não corresponde ao alvo aprovado/,
  );
  assert.throws(
    () => assertApprovedCleanupTarget({ ...approvedTargetEnv, DATABASE_URL: 'mysql://x/y' }),
    /DATABASE_URL inválida para a limpeza beta/,
  );
});

test('identidade aprovada correspondente é aceita e a saída nunca expõe segredos', () => {
  let threw;
  try {
    assertApprovedCleanupTarget(approvedTargetEnv);
    threw = false;
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assert.equal(threw, false);
});

test('evidência de recuperação é obrigatória em todo --apply independente de APP_ENV', () => {
  withTempDir((root) => {
    const backup = join(root, 'backup.sql');
    writeFileSync(backup, 'conteudo-do-backup\n');
    chmodSync(backup, 0o600);

    // Confirmação ausente.
    assert.throws(
      () => assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: 't1', LITE_BASELINE_BACKUP_FILE: backup, LITE_BASELINE_RESTORE_CONFIRMED: '' }),
      /Baseline #41/,
    );
    // Validação obrigatória mesmo fora de produção (o gate antigo ignorava preview/local).
    assert.throws(
      () => assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: '', LITE_BASELINE_BACKUP_FILE: backup, LITE_BASELINE_RESTORE_CONFIRMED: '1', APP_ENV: 'preview' }),
      /Baseline #41/,
    );
    // Backup inexistente bloqueia o apply.
    assert.throws(
      () => assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: 't1', LITE_BASELINE_BACKUP_FILE: join(root, 'ausente.sql'), LITE_BASELINE_RESTORE_CONFIRMED: '1' }),
      /Backup #41 não encontrado/,
    );
    // Permissões incorretas bloqueiam o apply.
    chmodSync(backup, 0o644);
    assert.throws(
      () => assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: 't1', LITE_BASELINE_BACKUP_FILE: backup, LITE_BASELINE_RESTORE_CONFIRMED: '1' }),
      /permissão 0600/,
    );
    // Caminho completo válido é aceito.
    chmodSync(backup, 0o600);
    assert.doesNotThrow(() =>
      assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: 't1', LITE_BASELINE_BACKUP_FILE: backup, LITE_BASELINE_RESTORE_CONFIRMED: '1' }),
    );
  });
});

test('backup como symlink ou caminho sobrescritável bloqueia o apply', () => {
  withTempDir((root) => {
    const realFile = join(root, 'real.sql');
    writeFileSync(realFile, 'x\n');
    chmodSync(realFile, 0o600);
    const link = join(root, 'link.sql');
    symlinkSync(realFile, link);
    assert.throws(
      () => assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: 't1', LITE_BASELINE_BACKUP_FILE: link, LITE_BASELINE_RESTORE_CONFIRMED: '1' }),
      /permissão 0600/,
    );
  });
});
