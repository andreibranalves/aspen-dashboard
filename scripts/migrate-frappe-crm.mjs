#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

export function parseArgs(argv) {
  let mode = null;
  let fixture = null;
  let expectedManifestHash = null;
  const approvedDivergences = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run' || arg === '--apply') {
      if (mode) throw new Error('Informe exatamente um modo: --dry-run ou --apply.');
      mode = arg.slice(2);
      continue;
    }
    if (arg === '--fixture') {
      fixture = argv[index + 1];
      if (!fixture || fixture.startsWith('--')) throw new Error('Informe o caminho da fixture após --fixture.');
      index += 1;
      continue;
    }
    if (arg === '--expected-manifest-hash') {
      const value = argv[index + 1];
      if (!value || !/^[0-9a-f]{64}$/i.test(value))
        throw new Error('Informe um manifest hash SHA-256 após --expected-manifest-hash.');
      expectedManifestHash = value.toLowerCase();
      index += 1;
      continue;
    }
    if (arg === '--approve-divergence') {
      const key = argv[index + 1];
      const parts = key ? key.split(':') : [];
      if (
        !key ||
        key.startsWith('--') ||
        parts.length !== 2 ||
        !parts[0].trim() ||
        !parts[1].trim()
      )
        throw new Error('Informe source_doctype:source_id após --approve-divergence.');
      approvedDivergences.push(key);
      index += 1;
      continue;
    }
    throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!mode) throw new Error('Informe exatamente um modo: --dry-run ou --apply.');
  const normalizedMode = mode === 'dry-run' ? 'dry-run' : 'apply';
  if (normalizedMode === 'apply' && !expectedManifestHash) {
    throw new Error('--expected-manifest-hash é obrigatório para --apply.');
  }
  if (normalizedMode === 'apply' && fixture) {
    throw new Error('--fixture só pode ser usado explicitamente com --dry-run.');
  }
  return { mode: normalizedMode, fixture, expectedManifestHash, approvedDivergences };
}

function parseServiceFile(contents, serviceName) {
  let section = null;
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (section !== serviceName) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const host = values.host;
  const port = values.port || '5432';
  const database = values.dbname || values.database;
  if (!host || !database) {
    throw new Error('CUTOVER_PG_SERVICE não informa host e database no PGSERVICEFILE.');
  }
  if (values.hostaddr && values.hostaddr !== host) {
    throw new Error('CUTOVER_PG_SERVICE não pode sobrescrever host com hostaddr.');
  }
  return { host, port, database };
}

export function readPgServiceTarget(env = process.env, serviceName = env.CUTOVER_PG_SERVICE?.trim()) {
  const serviceFile = env.PGSERVICEFILE?.trim();
  if (!serviceName || !serviceFile) {
    throw new Error('CUTOVER_PG_SERVICE exige PGSERVICEFILE para validar o destino real.');
  }
  let contents;
  try {
    contents = readFileSync(serviceFile, 'utf8');
  } catch {
    throw new Error('PGSERVICEFILE não pôde ser lido.');
  }
  return parseServiceFile(contents, serviceName);
}

function parseDatabaseTarget(rawUrl, variableName) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${variableName} inválida para o contrato de cutover.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!url.hostname || !database) {
    throw new Error(`${variableName} inválida para o contrato de cutover.`);
  }
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database,
  };
}

function sameDatabaseTarget(left, right) {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function assertDistinctDatabaseTargets(env) {
  const configured = ['DATABASE_URL', 'TEST_DATABASE_URL', 'RESTORE_DATABASE_URL']
    .filter((name) => env[name])
    .map((name) => [name, parseDatabaseTarget(env[name], name)]);
  for (let index = 0; index < configured.length; index += 1) {
    for (let other = index + 1; other < configured.length; other += 1) {
      const [leftName, leftTarget] = configured[index];
      const [rightName, rightTarget] = configured[other];
      if (sameDatabaseTarget(leftTarget, rightTarget)) {
        throw new Error(`${leftName} e ${rightName} não podem apontar para o mesmo destino.`);
      }
    }
  }
}

export function assertDatabaseContract(env = process.env) {
  assertDistinctDatabaseTargets(env);
  const serviceName = env.CUTOVER_PG_SERVICE?.trim();
  if (!serviceName) {
    throw new Error('CUTOVER_PG_SERVICE é obrigatório para validar o destino de apply.');
  }
  if (!env.DATABASE_URL) {
    throw new Error('CUTOVER_PG_SERVICE exige DATABASE_URL para validar o destino.');
  }
  if (!env.PGSERVICEFILE?.trim() || !env.PGPASSFILE?.trim()) {
    throw new Error('CUTOVER_PG_SERVICE exige PGSERVICEFILE e PGPASSFILE protegidos.');
  }
  const serviceTarget = readPgServiceTarget(env, serviceName);
  const databaseTarget = parseDatabaseTarget(env.DATABASE_URL, 'DATABASE_URL');
  if (!sameDatabaseTarget(databaseTarget, {
    host: serviceTarget.host.toLowerCase(),
    port: serviceTarget.port,
    database: serviceTarget.database,
  })) {
    throw new Error('DATABASE_URL e CUTOVER_PG_SERVICE não apontam para o mesmo destino.');
  }
  if (env.RESTORE_PG_SERVICE?.trim()) {
    if (!env.RESTORE_DATABASE_URL) {
      throw new Error('RESTORE_PG_SERVICE exige RESTORE_DATABASE_URL para validar o destino.');
    }
    const restoreServiceTarget = readPgServiceTarget(env, env.RESTORE_PG_SERVICE.trim());
    const restoreDatabaseTarget = parseDatabaseTarget(env.RESTORE_DATABASE_URL, 'RESTORE_DATABASE_URL');
    if (!sameDatabaseTarget(restoreDatabaseTarget, {
      host: restoreServiceTarget.host.toLowerCase(),
      port: restoreServiceTarget.port,
      database: restoreServiceTarget.database,
    })) {
      throw new Error('RESTORE_DATABASE_URL e RESTORE_PG_SERVICE não apontam para o mesmo destino.');
    }
  }
  return serviceTarget;
}

export function resolveRepositoryMode({ mode, hasFixture, hasDatabaseUrl }) {
  if (mode === 'apply' && hasFixture) {
    throw new Error('Fixture não pode ser usada com --apply; use --dry-run explicitamente.');
  }
  if (mode === 'apply' && !hasDatabaseUrl) {
    throw new Error('DATABASE_URL é obrigatória para --apply; fixture não pode simular uma aplicação.');
  }
  if (hasDatabaseUrl) return 'postgres';
  if (mode === 'dry-run' && hasFixture) return 'memory';
  throw new Error('DATABASE_URL é obrigatória para consultar o estado local; use fixture apenas com --dry-run.');
}

async function loadFixture(pathname) {
  const absolute = resolve(pathname);
  if (extname(absolute).toLowerCase() === '.json') {
    return JSON.parse(await readFile(absolute, 'utf8'));
  }
  const module = await import(pathToFileURL(absolute).href);
  return module.default || module.dataset || module;
}

async function main() {
  const { mode, fixture, expectedManifestHash, approvedDivergences } = parseArgs(process.argv.slice(2));
  if (mode === 'apply' && process.env.FRAPPE_MIGRATION_FIXTURE) {
    throw new Error('FRAPPE_MIGRATION_FIXTURE não pode ser usada com --apply; remova a variável.');
  }
  if (mode === 'apply') assertDatabaseContract();
  // API sources are compiled by the package script before this CLI runs. The
  // explicit dynamic import keeps this standalone entrypoint ESM-only.
  const migration = await import('../api/_functions/frappe-migration.js');
  const repositoryModule = await import('../api/_db/frappe-migration-repository.js');
  const dataset = fixture || process.env.FRAPPE_MIGRATION_FIXTURE
    ? await loadFixture(fixture || process.env.FRAPPE_MIGRATION_FIXTURE)
    : undefined;
  const repositoryMode = resolveRepositoryMode({ mode, hasFixture: Boolean(dataset), hasDatabaseUrl: Boolean(process.env.DATABASE_URL) });
  const repository = repositoryMode === 'memory'
    ? new repositoryModule.MemoryFrappeMigrationRepository()
    : undefined;
  const source = dataset ? undefined : migration.createFrappeSource();
  const result = await migration.runFrappeMigration({
    mode,
    dataset,
    source,
    repository,
    // Apply may render historical PDF bytes for validation, but the current
    // PostgreSQL repository does not persist historical PDF documents.
    pdfPipeline: mode === 'apply' ? migration.createDefaultHistoricalPdfPipeline() : undefined,
    approvedDivergences,
    expectedManifestHash,
  });
  const safeApprovedDivergences = approvedDivergences.map((key) => migration.safeApprovalKey(key));
  process.stdout.write(`${JSON.stringify({
    ...result.report,
    manifest: result.manifest,
    approvedDivergenceKeys: safeApprovedDivergences,
  })}\n`);
  // Non-zero exit on blocking errors, failed batches or failed run.
  const hasBlocking = result.report.total.divergentes + result.report.total.erros > 0;
  const runFailed = result.manifest.status === 'failed';
  if (hasBlocking || runFailed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Falha na migração Frappe.');
  }
}
