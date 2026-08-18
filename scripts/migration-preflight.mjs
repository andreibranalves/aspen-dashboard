#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProtectedFile,
  assertSamePostgresTarget,
  parsePostgresUrl,
  postgresIdentity,
  postgresServiceEnvironment,
  readPostgresServiceTarget,
} from './postgres-target.mjs';

const REQUIRED_KEYS = [
  'STAGING_DATABASE_URL',
  'STAGING_PG_SERVICE',
  'PRODUCTION_DATABASE_URL',
  'PGSERVICEFILE',
  'PGPASSFILE',
];

function requiredEnvironment(env) {
  for (const key of REQUIRED_KEYS) {
    if (!String(env[key] || '').trim()) {
      throw new Error(`${key} é obrigatória para o preflight de migration.`);
    }
  }
}

export function runMigrationPreflight({
  env = process.env,
  execute = execFileSync,
  now = () => new Date(),
} = {}) {
  requiredEnvironment(env);
  assertProtectedFile(env.PGSERVICEFILE, 'PGSERVICEFILE');
  assertProtectedFile(env.PGPASSFILE, 'PGPASSFILE');

  const staging = parsePostgresUrl(env.STAGING_DATABASE_URL, 'STAGING_DATABASE_URL');
  const production = parsePostgresUrl(env.PRODUCTION_DATABASE_URL, 'PRODUCTION_DATABASE_URL');
  const service = readPostgresServiceTarget({
    serviceName: env.STAGING_PG_SERVICE,
    serviceFile: env.PGSERVICEFILE,
    expectedDatabase: staging.database,
    label: 'STAGING_PG_SERVICE',
  });
  assertSamePostgresTarget(
    staging,
    service,
    'STAGING_DATABASE_URL e STAGING_PG_SERVICE não apontam para o mesmo destino.'
  );
  if (postgresIdentity(staging) === postgresIdentity(production)) {
    throw new Error('STAGING_DATABASE_URL não pode apontar para produção.');
  }

  let currentDatabase;
  try {
    currentDatabase = execute(
      'psql',
      [
        '--no-psqlrc',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--set=ON_ERROR_STOP=1',
        '--dbname',
        `service=${service.name}`,
        '--command',
        'SELECT current_database();',
      ],
      {
        env: postgresServiceEnvironment(service, env),
        encoding: 'utf8',
      }
    ).trim();
  } catch {
    throw new Error('Falha ao validar database efetivo no serviço PostgreSQL.');
  }
  if (currentDatabase !== staging.database) {
    throw new Error('STAGING_PG_SERVICE apontou para database inesperado.');
  }

  return {
    timestamp: now().toISOString(),
    checks: [
      'arquivos PostgreSQL protegidos',
      'URL staging corresponde ao serviço nomeado',
      'staging difere de produção',
      'database efetivo confirmado',
    ],
  };
}

export function formatMigrationPreflight(result) {
  return (
    [`timestamp: ${result.timestamp}`, ...result.checks.map((check) => `PASS ${check}`)].join(
      '\n'
    ) + '\n'
  );
}

export function formatMigrationPreflightFailure(error, now = () => new Date()) {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  return `timestamp: ${now().toISOString()}\nFAIL preflight de migration: ${message}\n`;
}

function isCli() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  try {
    process.stdout.write(formatMigrationPreflight(runMigrationPreflight()));
  } catch (error) {
    process.stderr.write(formatMigrationPreflightFailure(error));
    process.exitCode = 1;
  }
}
