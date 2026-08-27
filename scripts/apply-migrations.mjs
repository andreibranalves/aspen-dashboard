#!/usr/bin/env node

// Apply operacional de migrations: um único comando que primeiro comprova a
// identidade do alvo (preflight completo, incluindo prova do database efetivo
// via serviço nomeado) e somente então abre o caminho de apply. Toda saída é
// redigida: nenhuma connection string ou segredo chega ao stdout/stderr.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOperationEnv } from './lib/operation-env.mjs';
import {
  formatMigrationPreflight,
  runMigrationPreflight,
} from './migration-preflight.mjs';

const CONNECTION_STRING = /(postgres(?:ql)?:\/\/)[^\s"']+/gi;

export function redactOperationalOutput(text) {
  return String(text || '').replace(CONNECTION_STRING, '$1***');
}

function emptyResult() {
  return {
    preflightFailed: false,
    applyAttempted: false,
    applySucceeded: false,
    output: '',
    error: null,
    exitCode: 0,
  };
}

export function runMigrationApplyPipeline({
  env = process.env,
  executePreflightProbe = execFileSync,
  executeApply = execFileSync,
  now = () => new Date(),
} = {}) {
  const result = emptyResult();
  result.timestamp = now().toISOString();
  try {
    // Origem externa única + contrato da operação 'migration' antes de
    // qualquer acesso a Postgres. Falha aqui encerra antes do preflight.
    loadOperationEnv('migration', { env });
    const preflight = runMigrationPreflight({ env, execute: executePreflightProbe, now });
    result.preflight = preflight;
    process.stdout.write(formatMigrationPreflight(preflight));

    // O preflight provou identidade; agora sim abrimos o caminho de apply.
    // MIGRATION_TARGET_DATABASE_URL existe apenas no processo filho e só é
    // definida depois da prova de identidade.
    const childEnv = { ...env, MIGRATION_TARGET_DATABASE_URL: env.STAGING_DATABASE_URL };
    result.applyAttempted = true;
    let childOutput;
    try {
      childOutput = executeApply(
        'npm',
        ['run', 'db:migrate:operational'],
        { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (error) {
      result.applySucceeded = false;
      result.error = error;
      result.exitCode = error.status && Number.isInteger(error.status) ? error.status : 1;
      return result;
    }
    result.applySucceeded = true;
    result.output = redactOperationalOutput(childOutput);
    return result;
  } catch (error) {
    result.preflightFailed = !result.applyAttempted;
    result.error = error;
    result.exitCode = 1;
    return result;
  }
}

function isCli() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const result = runMigrationApplyPipeline({ env: process.env });
  if (result.applySucceeded) {
    if (result.output.trim()) {
      process.stdout.write(`${redactOperationalOutput(result.output)}\n`);
    }
    process.stdout.write('PASS apply de migrations concluído.\n');
  } else {
    // Preflight, contrato de ambiente ou o próprio apply falharam: caminho
    // de saída único, fail-closed e redigido.
    const message = redactOperationalOutput(String(result.error?.message || '').trim());
    process.stderr.write(`FAIL apply operacional de migrations: ${message || 'Falha inesperada.'}\n`);
    process.exitCode = 1;
  }
}
