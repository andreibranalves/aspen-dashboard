#!/usr/bin/env node

import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOperationEnv } from './lib/operation-env.mjs';

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

function assertProductionBaseline(env = process.env) {
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'production') return;
  const backup = String(env.LITE_BASELINE_BACKUP_FILE || '').trim();
  if (String(env.LITE_BASELINE_RESTORE_CONFIRMED || '').trim() !== '1' || !String(env.LITE_BASELINE_TAG || '').trim() || !backup) {
    throw new Error('Baseline #41 não foi comprovado; --apply em produção bloqueado.');
  }
  let stat;
  try { stat = lstatSync(resolve(backup)); } catch { throw new Error('Backup #41 não encontrado; --apply em produção bloqueado.'); }
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

export { parseArgs, readCandidates, assertProductionBaseline, safePlan };

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    // Origem externa única de configuração — arquivos do checkout nunca selecionam alvo.
    loadOperationEnv('cleanup');
    const args = parseArgs(process.argv.slice(2));
    assertProductionBaseline();
    const { parseBetaCleanupCandidates, createPostgresBetaCleanupRepository } = await import('../api/_infrastructure/db/repositories/beta-cleanup-repository.js');
    const { createDatabaseConnection } = await import('../api/_infrastructure/db/client.js');
    const candidates = parseBetaCleanupCandidates(readCandidates(args.ids));
    const databaseUrl = String(process.env.DATABASE_URL || '').trim();
    if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
    const connection = createDatabaseConnection(databaseUrl);
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
