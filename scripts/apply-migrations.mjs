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
  runProductionMigrationPreflight,
} from './migration-preflight.mjs';

const CONNECTION_STRING = /(postgres(?:ql)?:\/\/)[^\s"']+/gi;
const APPLY_TARGETS = new Set(['staging', 'production']);

export function redactOperationalOutput(text) {
  return String(text || '').replace(CONNECTION_STRING, '$1***');
}

export function normalizeMigrationApplyTarget(value) {
  const target = String(value ?? '').trim();
  if (!APPLY_TARGETS.has(target)) {
    throw new Error('Alvo de apply inválido. Use staging ou production.');
  }
  return target;
}

export function parseApplyArgs(argv, { defaultTarget = 'staging' } = {}) {
  let target = normalizeMigrationApplyTarget(defaultTarget);
  let targetProvided = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      if (targetProvided) throw new Error('--target foi informado mais de uma vez.');
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Informe um alvo após --target.');
      target = normalizeMigrationApplyTarget(value);
      targetProvided = true;
      index += 1;
    } else {
      throw new Error(`Opção desconhecida: ${arg}`);
    }
  }
  return { target };
}

function emptyResult() {
  return {
    target: 'staging',
    preflightFailed: false,
    backupAttempted: false,
    backupSucceeded: false,
    applyAttempted: false,
    applySucceeded: false,
    backupOutput: '',
    output: '',
    error: null,
    exitCode: 0,
  };
}

function executeOperationalApply(executeApply, env, targetUrl, result) {
  // MIGRATION_TARGET_DATABASE_URL existe apenas no processo filho e só é
  // definida depois da prova de identidade (e, em produção, do backup).
  const childEnv = { ...env, MIGRATION_TARGET_DATABASE_URL: targetUrl };
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
}

function executeProductionBackup(executeBackup, env, result) {
  result.backupAttempted = true;
  let backupOutput;
  try {
    backupOutput = executeBackup(
      'npm',
      ['run', 'db:backup'],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error) {
    result.backupSucceeded = false;
    result.error = error;
    result.exitCode = error.status && Number.isInteger(error.status) ? error.status : 1;
    return result;
  }
  result.backupSucceeded = true;
  result.backupOutput = redactOperationalOutput(backupOutput);
  return result;
}

export function runMigrationApplyPipeline({
  env = process.env,
  target = 'staging',
  executePreflightProbe = execFileSync,
  executeApply = execFileSync,
  executeBackup = execFileSync,
  now = () => new Date(),
} = {}) {
  const result = emptyResult();
  result.timestamp = now().toISOString();
  try {
    result.target = normalizeMigrationApplyTarget(target);
  } catch (error) {
    result.error = error;
    result.exitCode = 1;
    return result;
  }
  try {
    if (result.target === 'production') {
      // Origem externa única + contrato de produção antes de qualquer acesso
      // a Postgres ou ao caminho de backup.
      loadOperationEnv('migration-production', { env });
      const preflight = runProductionMigrationPreflight({ env, execute: executePreflightProbe, now });
      result.preflight = preflight;
      process.stdout.write(formatMigrationPreflight(preflight));

      // A prova de identidade passou; o backup existente precisa concluir com
      // sucesso antes de abrir o caminho de apply.
      executeProductionBackup(executeBackup, env, result);
      if (!result.backupSucceeded) return result;
      if (result.backupOutput.trim()) process.stdout.write(`${result.backupOutput}\n`);

      // Somente PRODUCTION_DATABASE_URL é injetada como alvo do apply.
      return executeOperationalApply(executeApply, env, env.PRODUCTION_DATABASE_URL, result);
    }

    // Origem externa única + contrato da operação 'migration' antes de
    // qualquer acesso a Postgres. Falha aqui encerra antes do preflight.
    loadOperationEnv('migration', { env });
    const preflight = runMigrationPreflight({ env, execute: executePreflightProbe, now });
    result.preflight = preflight;
    process.stdout.write(formatMigrationPreflight(preflight));

    // O preflight provou identidade; agora sim abrimos o caminho de apply.
    return executeOperationalApply(executeApply, env, env.STAGING_DATABASE_URL, result);
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
  let parsed;
  try {
    parsed = parseApplyArgs(process.argv.slice(2));
  } catch (error) {
    const message = redactOperationalOutput(String(error?.message || '').trim());
    process.stderr.write(`FAIL apply operacional de migrations: ${message || 'Falha inesperada.'}\n`);
    process.exitCode = 1;
  }
  if (parsed) {
    const result = runMigrationApplyPipeline({ env: process.env, target: parsed.target });
    if (result.applySucceeded) {
      if (result.output.trim()) {
        process.stdout.write(`${redactOperationalOutput(result.output)}\n`);
      }
      process.stdout.write('PASS apply de migrations concluído.\n');
    } else {
      // Preflight, contrato de ambiente, backup ou o próprio apply falharam:
      // caminho de saída único, fail-closed e redigido.
      const message = redactOperationalOutput(String(result.error?.message || '').trim());
      process.stderr.write(`FAIL apply operacional de migrations: ${message || 'Falha inesperada.'}\n`);
      process.exitCode = 1;
    }
  }
}
