#!/usr/bin/env node

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
    throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!mode) throw new Error('Informe exatamente um modo: --dry-run ou --apply.');
  return { mode: mode === 'dry-run' ? 'dry-run' : 'apply', fixture };
}

export function resolveRepositoryMode({ mode, hasFixture, hasDatabaseUrl }) {
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
  const { mode, fixture } = parseArgs(process.argv.slice(2));
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
  const result = await migration.runFrappeMigration({ mode, dataset, source, repository });
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Falha na migração Frappe.');
  }
}
