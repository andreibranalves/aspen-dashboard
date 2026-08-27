#!/usr/bin/env node

import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOperationEnv } from './lib/operation-env.mjs';
import { parsePostgresUrl, postgresIdentity } from './postgres-target.mjs';

function parseArgs(argv) {
  const args = { ids: '', apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ids') args.ids = String(argv[++index] || '').trim();
    else if (arg === '--apply') args.apply = true;
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!args.ids) throw new Error('--ids é obrigatório.');
  return args;
}

function readCandidates(filepath) {
  const absolute = resolve(filepath);
  let value;
  try {
    value = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    throw new Error('Arquivo de candidatos inválido.');
  }
  return value;
}

/**
 * Identidade positiva do alvo: a conexão só pode ser aberta contra o alvo
 * aprovado explicitamente na configuração externa da operação, seja qual for
 * o APP_ENV. Valores nunca aparecem nas mensagens.
 */
export function assertApprovedCleanupTarget(env = process.env) {
  const expected = String(env.CLEANUP_TARGET_IDENTITY || '').trim();
  if (!expected) {
    throw new Error('Identidade do alvo aprovada ausente (CLEANUP_TARGET_IDENTITY no formato host|porta|database); limpeza bloqueada.');
  }
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  let actual;
  try {
    actual = postgresIdentity(parsePostgresUrl(databaseUrl));
  } catch {
    throw new Error('DATABASE_URL inválida para a limpeza beta.');
  }
  if (actual !== expected) {
    throw new Error('DATABASE_URL não corresponde ao alvo aprovado da limpeza; execução bloqueada.');
  }
}

/**
 * Evidência de recuperação válida (baseline, backup e confirmação de restore)
 * é obrigatória para todo --apply, independentemente de APP_ENV.
 */
export function assertCleanupRecoveryEvidence(env = process.env) {
  const tag = String(env.LITE_BASELINE_TAG || '').trim();
  const backup = String(env.LITE_BASELINE_BACKUP_FILE || '').trim();
  const confirmed = String(env.LITE_BASELINE_RESTORE_CONFIRMED || '').trim();
  if (!tag || !backup || confirmed !== '1') {
    throw new Error('Baseline #41 e confirmação de restore não comprovados; --apply bloqueado.');
  }
  let stat;
  try { stat = lstatSync(resolve(backup)); } catch { throw new Error('Backup #41 não encontrado; --apply bloqueado.'); }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('Backup #41 deve ser arquivo regular com permissão 0600.');
  }
}

function safePlan(plan, applied = false) {
  return {
    mode: applied ? 'apply' : 'dry-run',
    candidates: plan.candidates,
    counts: plan.counts,
    ids: plan.ids,
    retainedSharedClients: plan.retainedSharedClients,
    blockers: plan.blockers,
    applied,
  };
}

export { parseArgs, readCandidates, safePlan };

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    // Origem externa única de configuração — arquivos do checkout nunca selecionam alvo.
    loadOperationEnv('cleanup');
    const args = parseArgs(process.argv.slice(2));
    assertApprovedCleanupTarget();
    if (args.apply) assertCleanupRecoveryEvidence();
    const { parseBetaCleanupCandidates, createPostgresBetaCleanupRepository } = await import('../api/_infrastructure/db/repositories/beta-cleanup-repository.js');
    const { createDatabaseConnection } = await import('../api/_infrastructure/db/client.js');
    const candidates = parseBetaCleanupCandidates(readCandidates(args.ids));
    const connection = createDatabaseConnection(String(process.env.DATABASE_URL));
    try {
      const repository = createPostgresBetaCleanupRepository(() => connection.db);
      const result = args.apply
        ? await repository.apply(candidates)
        : await repository.plan(candidates);
      process.stdout.write(`${JSON.stringify(safePlan(result, args.apply), null, 2)}\n`);
    } finally {
      await connection.client.end({ timeout: 5 });
    }
  } catch (error) {
    const message = error && typeof error === 'object' && 'statusCode' in error && Number(error.statusCode) === 409
      ? String(error.message || 'Limpeza bloqueada.')
      : error instanceof Error ? error.message : 'Falha na limpeza beta.';
    process.stderr.write(`FAIL limpeza beta: ${message}\n`);
    process.exitCode = 1;
  }
}
