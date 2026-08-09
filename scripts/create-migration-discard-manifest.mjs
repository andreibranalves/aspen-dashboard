#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseDiscardManifest } from '../api/_functions/lib/migration-discard.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function safeError(error) {
  const message = error instanceof Error ? error.message : '';
  const prefixes = [
    'Relatório dry-run',
    'Hash do snapshot',
    'Manifesto de descarte inválido',
    'Arquivo do relatório',
    'Arquivo de saída',
    'Manifesto de descarte',
  ];
  return prefixes.some((prefix) => message.startsWith(prefix))
    ? message
    : 'Falha ao gerar manifesto de descarte.';
}

function fail(message) {
  throw new Error(`Manifesto de descarte: ${message}`);
}

function parseArgs(argv) {
  const args = { report: null, snapshotManifestHash: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--report' || option === '--snapshot-manifest-hash' || option === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`informe o valor após ${option}.`);
      index += 1;
      if (option === '--report') args.report = value;
      else if (option === '--snapshot-manifest-hash') args.snapshotManifestHash = value;
      else args.output = value;
      continue;
    }
    fail('opção desconhecida.');
  }
  if (!args.report) fail('informe --report.');
  if (!args.output) fail('informe --output.');
  if (!args.snapshotManifestHash || !HASH_PATTERN.test(args.snapshotManifestHash))
    fail('Hash do snapshot deve ser SHA-256.');
  args.snapshotManifestHash = args.snapshotManifestHash.toLowerCase();
  return args;
}

async function readReport(pathname) {
  let contents;
  try {
    contents = await readFile(resolve(pathname), 'utf8');
  } catch {
    throw new Error('Arquivo do relatório dry-run não pôde ser lido.');
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error('Relatório dry-run inválido: JSON malformado.');
  }
}

function importReportFromCli(value) {
  if (!isRecord(value) || !isRecord(value.manifest))
    throw new Error('Relatório dry-run inválido: manifesto ausente.');
  if (value.manifest.mode !== 'dry-run')
    throw new Error('Relatório dry-run inválido: modo incompatível.');
  const report = { ...value };
  delete report.manifest;
  delete report.approvedDivergenceKeys;
  if (!report.modo || report.modo !== 'dry-run' || !isRecord(report.total))
    throw new Error('Relatório dry-run inválido: relatório ausente.');
  return report;
}

function projectionFromReport(value, sourceManifestHash) {
  if (!isRecord(value) || !isRecord(value.manifest))
    throw new Error('Relatório dry-run inválido: manifesto ausente.');
  const manifest = value.manifest;
  if (manifest.mode !== 'dry-run') throw new Error('Relatório dry-run inválido: modo incompatível.');
  if (manifest.status !== 'failed' && manifest.status !== 'completed')
    throw new Error('Relatório dry-run inválido: status desconhecido.');
  if (manifest.manifestHash !== sourceManifestHash)
    throw new Error('Hash do snapshot diverge do relatório dry-run.');
  const projection = manifest.discardPlan;
  if (!isRecord(projection)) throw new Error('Relatório dry-run inválido: plano de descarte ausente.');
  if (projection.sourceManifestHash !== sourceManifestHash)
    throw new Error('Hash do snapshot diverge do plano de descarte.');
  if (!HASH_PATTERN.test(String(projection.closureHash || '')))
    throw new Error('Manifesto de descarte inválido: closureHash deve ser SHA-256.');
  if (!Array.isArray(projection.entries))
    throw new Error('Manifesto de descarte inválido: entries deve ser uma lista.');
  const entries = projection.entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.entity !== 'string' || typeof entry.reason !== 'string' || !Array.isArray(entry.depends_on))
      throw new Error('Manifesto de descarte inválido: entrada redigida inválida.');
    if (entry.depends_on.some((key) => typeof key !== 'string'))
      throw new Error('Manifesto de descarte inválido: depends_on inválido.');
    const parts = entry.key.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1])
      throw new Error('Manifesto de descarte inválido: chave de origem inválida.');
    return {
      key: entry.key,
      source_doctype: parts[0],
      source_id: parts[1],
      entity: entry.entity,
      reason: entry.reason,
      depends_on: entry.depends_on,
    };
  });
  return { entries, closureHash: String(projection.closureHash).toLowerCase() };
}

function safeManifestValidationError(error) {
  const message = error instanceof Error ? error.message : '';
  const category = /schemaVersion|policy/i.test(message)
    ? 'schema inválido'
    : /hash/i.test(message)
      ? 'hash inválido'
      : /chave|origem/i.test(message)
        ? 'chave inválida'
        : 'validação rejeitada';
  return new Error(`Manifesto de descarte inválido: ${category}.`, { cause: error });
}

function countEntries(entries) {
  const counts = { total: entries.length, produtos: 0, faixas: 0, clientes: 0, orcamentos: 0 };
  const fields = { produto: 'produtos', faixa: 'faixas', cliente: 'clientes', orcamento: 'orcamentos' };
  for (const entry of entries) counts[fields[entry.entity]] += 1;
  return counts;
}

async function writeProtected(pathname, contents) {
  const output = resolve(pathname);
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, output);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('Arquivo de saída já existe.', { cause: error });
      throw new Error('Arquivo de saída não pôde ser criado.', { cause: error });
    }
    await chmod(output, 0o600);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
  return output;
}

export async function createDiscardManifest({ reportPath, snapshotManifestHash, outputPath }) {
  if (!HASH_PATTERN.test(String(snapshotManifestHash || '')))
    throw new Error('Hash do snapshot deve ser SHA-256.');
  const reportValue = await readReport(reportPath);
  const sourceManifestHash = String(snapshotManifestHash).toLowerCase();
  const projection = projectionFromReport(reportValue, sourceManifestHash);
  const report = importReportFromCli(reportValue);
  const entries = projection.entries;
  let manifest;
  try {
    manifest = parseDiscardManifest({
      schemaVersion: 1,
      policy: 'discard-all-blockers',
      sourceManifestHash,
      dryRunReportHash: canonicalHash(report),
      entries,
      closureHash: projection.closureHash,
    });
  } catch (error) {
    throw safeManifestValidationError(error);
  }
  const contents = `${JSON.stringify(manifest)}\n`;
  const output = await writeProtected(outputPath, contents);
  return {
    path: output,
    checksum: createHash('sha256').update(contents).digest('hex'),
    counts: countEntries(manifest.entries),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await createDiscardManifest({
    reportPath: args.report,
    snapshotManifestHash: args.snapshotManifestHash,
    outputPath: args.output,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 2;
  }
}
