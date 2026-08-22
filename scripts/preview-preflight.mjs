#!/usr/bin/env node

import { parsePostgresUrl, postgresIdentity } from './postgres-target.mjs';

export function previewDatabaseIdentity(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const productionUrl = String(env.PRODUCTION_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL é obrigatória no Preview.');
  if (!productionUrl) throw new Error('PRODUCTION_DATABASE_URL é obrigatória para provar o isolamento.');
  const preview = parsePostgresUrl(databaseUrl, 'DATABASE_URL');
  const production = parsePostgresUrl(productionUrl, 'PRODUCTION_DATABASE_URL');
  if (postgresIdentity(preview) === postgresIdentity(production)) {
    throw new Error('DATABASE_URL do Preview não pode apontar para produção.');
  }
  return { preview: postgresIdentity(preview), production: postgresIdentity(production) };
}

export function runPreviewPreflight(env = process.env, now = () => new Date()) {
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'preview') {
    throw new Error('APP_ENV=preview é obrigatório para o preflight de Preview.');
  }
  if (String(env.EXTERNAL_WRITES_ENABLED || '').trim() !== '0') {
    throw new Error('EXTERNAL_WRITES_ENABLED=0 é obrigatório no Preview.');
  }
  previewDatabaseIdentity(env);
  return {
    timestamp: now().toISOString(),
    checks: ['APP_ENV=preview', 'escritas externas desabilitadas', 'database do Preview distinto da produção'],
  };
}

export function formatPreviewPreflight(result) {
  return [`timestamp: ${result.timestamp}`, ...result.checks.map((check) => `PASS ${check}`)].join('\n') + '\n';
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    process.stdout.write(formatPreviewPreflight(runPreviewPreflight()));
  } catch (error) {
    process.stderr.write(`FAIL preflight de Preview: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
