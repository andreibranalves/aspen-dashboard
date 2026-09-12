#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExistingBackupDirectory } from './backup-crm.mjs';
import {
  assertSamePostgresTarget,
  parsePostgresUrl,
  postgresIdentity,
  postgresServiceEnvironment,
  readPostgresServiceTarget,
} from './postgres-target.mjs';
import { checkOperationEnv, loadOperationEnv, missingOperationKeys } from './lib/operation-env.mjs';

function assertMigrationEnvironment(env) {
  const result = checkOperationEnv('migration', env);
  if (!result.ok) {
    throw new Error(`Ambiente incompleto para a operação migration: ${missingOperationKeys(result).join(', ')}.`);
  }
}

function assertProductionMigrationEnvironment(env) {
  const result = checkOperationEnv('migration-production', env);
  if (!result.ok) {
    throw new Error(
      `Ambiente incompleto para a operação migration-production: ${missingOperationKeys(result).join(', ')}.`
    );
  }
}

function probeServiceDatabase(service, env, execute) {
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
  if (currentDatabase !== service.expectedDatabase) {
    throw new Error('PRODUCTION_PG_SERVICE apontou para database inesperado.');
  }
  return currentDatabase;
}

/**
 * Prova, somente leitura, que a seleção explícita de produção aponta para um
 * único alvo antes de qualquer backup ou apply: PRODUCTION_DATABASE_URL e
 * DATABASE_URL são o mesmo database, PRODUCTION_PG_SERVICE e o serviço de
 * cutover confirmam esse database, o database efetivo é confirmado via psql e
 * o diretório de backup externo está presente.
 */
export function runProductionMigrationPreflight({
  env = process.env,
  execute = execFileSync,
  now = () => new Date(),
} = {}) {
  assertProductionMigrationEnvironment(env);

  const production = parseMigrationPostgresUrl(env.PRODUCTION_DATABASE_URL, 'PRODUCTION_DATABASE_URL');
  const active = parseMigrationPostgresUrl(env.DATABASE_URL, 'DATABASE_URL');
  if (postgresIdentity(production) !== postgresIdentity(active)) {
    throw new Error('PRODUCTION_DATABASE_URL e DATABASE_URL não apontam para o mesmo destino.');
  }

  const service = readPostgresServiceTarget({
    serviceName: env.PRODUCTION_PG_SERVICE,
    serviceFile: env.PGSERVICEFILE,
    expectedDatabase: production.database,
    label: 'PRODUCTION_PG_SERVICE',
  });
  assertSamePostgresTarget(
    production,
    service,
    'PRODUCTION_DATABASE_URL e PRODUCTION_PG_SERVICE não apontam para o mesmo destino.'
  );
  probeServiceDatabase(service, env, execute);

  const cutover = readPostgresServiceTarget({
    serviceName: env.CUTOVER_PG_SERVICE,
    serviceFile: env.PGSERVICEFILE,
    expectedDatabase: env.CUTOVER_EXPECTED_DATABASE,
    label: 'CUTOVER_PG_SERVICE',
  });
  assertSamePostgresTarget(
    production,
    cutover,
    'PRODUCTION_DATABASE_URL e CUTOVER_PG_SERVICE não apontam para o mesmo destino.'
  );

  assertExistingBackupDirectory(env);

  return {
    timestamp: now().toISOString(),
    checks: [
      'arquivos PostgreSQL protegidos',
      'URL de produção corresponde à base ativa',
      'URL de produção corresponde ao serviço nomeado',
      'database efetivo confirmado',
      'serviço de backup corresponde ao alvo',
      'diretório de backup externo presente',
    ],
  };
}

function parseMigrationPostgresUrl(raw, name) {
  try {
    return parsePostgresUrl(raw, name);
  } catch (error) {
    if (error instanceof URIError) throw new Error(`${name} inválida.`, { cause: error });
    throw error;
  }
}

export function runMigrationPreflight({
  env = process.env,
  execute = execFileSync,
  now = () => new Date(),
} = {}) {
  assertMigrationEnvironment(env);

  const staging = parseMigrationPostgresUrl(env.STAGING_DATABASE_URL, 'STAGING_DATABASE_URL');
  const production = parseMigrationPostgresUrl(
    env.PRODUCTION_DATABASE_URL,
    'PRODUCTION_DATABASE_URL'
  );
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
  let message;
  if (error instanceof URIError) message = 'URL PostgreSQL inválida.';
  else if (error instanceof Error) message = error.message;
  else message = 'Falha inesperada.';
  return `timestamp: ${now().toISOString()}\nFAIL preflight de migration: ${message}\n`;
}

function isCli() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  try {
    // Origem externa única: preenche variáveis ausentes e valida o contrato
    // da operação antes de qualquer acesso a Postgres.
    loadOperationEnv('migration');
    process.stdout.write(formatMigrationPreflight(runMigrationPreflight()));
  } catch (error) {
    process.stderr.write(formatMigrationPreflightFailure(error));
    process.exitCode = 1;
  }
}
