#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run-report') args.dryRunReport = argv[++index];
    else if (arg === '--apply-report') args.applyReport = argv[++index];
    else if (arg === '--output') args.output = argv[++index];
    else if (arg === '--service') args.service = argv[++index];
    else throw new Error('Opção desconhecida.');
  }
  if (!args.dryRunReport || !args.applyReport || !args.output)
    throw new Error('--dry-run-report, --apply-report e --output são obrigatórios.');
  return args;
}

function assertSecureFile(filepath, label) {
  const stat = statSync(filepath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600)
    fail(`${label} deve ser arquivo regular com permissão 0600.`);
}

function assertSecureDirectory(directory, label) {
  const stat = statSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700)
    fail(`${label} deve ser diretório regular com permissão 0700.`);
}

function readServiceDatabase(serviceFile, serviceName) {
  const contents = readFileSync(serviceFile, 'utf8');
  let active = false;
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      active = section[1].trim() === serviceName;
      continue;
    }
    if (!active || !line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator !== -1) values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const database = values.dbname || values.database;
  if (!database || !values.host) fail('CUTOVER_PG_SERVICE não informa host e database.');
  return { host: values.host, port: values.port || '5432', database };
}

function outputDirectory(output) {
  const directory = dirname(resolve(output));
  if (!existsSync(directory)) fail('Diretório do artefato de reconciliação não existe.');
  assertSecureDirectory(directory, 'Diretório do artefato de reconciliação');
  if (directory === PROJECT_ROOT || directory.startsWith(`${PROJECT_ROOT}/`))
    fail('Artefato de reconciliação deve ficar fora do checkout.');
  return directory;
}

function readJson(filepath, label) {
  try {
    return JSON.parse(readFileSync(resolve(filepath), 'utf8'));
  } catch {
    fail(`${label} inválido ou inacessível.`);
  }
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

function validHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) fail(`${label} inválido.`);
  return value;
}

function stableKeys(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

function sameJson(left, right) {
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

function entityOutcomeCount(report, key) {
  const entity = report?.[key];
  if (!entity || typeof entity !== 'object') fail(`Relatório sem entidade ${key}.`);
  return ['criados', 'atualizados', 'ignorados', 'aprovadas'].reduce(
    (total, status) => total + Number(entity[status] || 0),
    0
  );
}

function psqlEnvironment() {
  const env = { ...process.env };
  for (const key of [
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'RESTORE_DATABASE_URL',
    'PGHOST',
    'PGHOSTADDR',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
    'PGSERVICE',
  ]) delete env[key];
  return env;
}

function query(service, sql, variables = {}) {
  const args = ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--dbname', service];
  for (const [key, value] of Object.entries(variables)) args.push(`--set=${key}=${value}`);
  args.push('--command', sql);
  try {
    return execFileSync('psql', args, {
      env: psqlEnvironment(),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail('Consulta PostgreSQL de reconciliação falhou.');
  }
}

function queryJson(service, sql, variables = {}) {
  const value = query(service, sql, variables);
  try {
    return JSON.parse(value || '{}');
  } catch {
    fail('Resposta PostgreSQL de reconciliação inválida.');
  }
}

function writeArtifact(filepath, artifact) {
  const temporary = `${filepath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filepath);
  assertSecureFile(filepath, 'Artefato de reconciliação');
}

export function compareReconciliation({
  sourceCounts,
  applyCounts,
  sourceReadCounts,
  importedCounts,
  targetCounts,
  statusCounts,
  sourceManifestHash,
  applyManifestHash,
  persistedManifestHash,
  sourceApprovedDivergenceKeys,
  applyApprovedDivergenceKeys,
  unapprovedDivergenceKeys,
  blocking,
  lineageInvalid,
}) {
  const sourceCountsMatchApply = sameJson(sourceCounts, applyCounts);
  const sourceReadCountsMatchManifest = sameJson(sourceCounts, sourceReadCounts);
  const manifestHashesMatch = sourceManifestHash === applyManifestHash;
  const persistedRunHashMatches = applyManifestHash === persistedManifestHash;
  const approvedKeysMatch = sameJson(
    stableKeys(sourceApprovedDivergenceKeys),
    stableKeys(applyApprovedDivergenceKeys)
  );
  const targetContainsImported =
    targetCounts.products >= importedCounts.products &&
    targetCounts.pricingTiers >= importedCounts.pricingTiers &&
    targetCounts.clients >= importedCounts.clients &&
    targetCounts.quotations >= importedCounts.quotations;
  const statusCountTotal = (value) =>
    Object.values(value || {}).reduce((total, count) => total + Number(count || 0), 0);
  const statusCountsConsistent =
    statusCountTotal(statusCounts?.quotations) === targetCounts.quotations &&
    statusCountTotal(statusCounts?.revisions) === targetCounts.revisions;
  const targetStructureValid =
    targetCounts.revisions >= targetCounts.quotations &&
    targetCounts.templates > 0 &&
    targetCounts.templateVersions >= targetCounts.templates &&
    targetCounts.items >= 0;
  const passed =
    sourceCountsMatchApply &&
    sourceReadCountsMatchManifest &&
    manifestHashesMatch &&
    persistedRunHashMatches &&
    approvedKeysMatch &&
    unapprovedDivergenceKeys.length === 0 &&
    blocking === 0 &&
    lineageInvalid === 0 &&
    targetContainsImported &&
    targetStructureValid &&
    statusCountsConsistent;
  return {
    passed,
    sourceCountsMatchApply,
    sourceReadCountsMatchManifest,
    manifestHashesMatch,
    persistedRunHashMatches,
    approvedKeysMatch,
    targetContainsImported,
    targetStructureValid,
    statusCountsConsistent,
    blocking,
    lineageInvalid,
    unapprovedDivergenceKeys: stableKeys(unapprovedDivergenceKeys),
  };
}

export function runReconciliation(args, env = process.env) {
  const service = (args.service || env.CUTOVER_PG_SERVICE || '').trim();
  const serviceFile = (env.PGSERVICEFILE || '').trim();
  if (!service || !serviceFile) fail('CUTOVER_PG_SERVICE e PGSERVICEFILE são obrigatórios.');
  assertSecureFile(serviceFile, 'PGSERVICEFILE');
  const serviceTarget = readServiceDatabase(serviceFile, service);
  const output = resolve(args.output);
  const directory = outputDirectory(output);
  const dryRun = readJson(args.dryRunReport, 'Report dry-run');
  const apply = readJson(args.applyReport, 'Report apply');
  const sourceManifestHash = validHash(dryRun?.manifest?.manifestHash, 'Hash do dry-run');
  const applyManifestHash = validHash(apply?.manifest?.manifestHash, 'Hash do apply');
  const runId = apply?.manifest?.runId;
  if (typeof runId !== 'string' || !UUID_PATTERN.test(runId)) fail('Run ID do apply inválido.');
  if (dryRun?.manifest?.mode !== 'dry-run' || dryRun?.manifest?.status !== 'completed') fail('Dry-run não está concluído.');
  if (apply?.manifest?.mode !== 'apply' || apply?.manifest?.status !== 'completed') fail('Apply não está concluído.');

  const currentDatabase = query(service, 'SELECT current_database();');
  if (currentDatabase !== serviceTarget.database) fail('Serviço PostgreSQL apontou para database inesperado.');
  const persistedRun = queryJson(
    service,
    "SELECT json_build_object('runId', id, 'manifestHash', manifest_hash, 'status', status, 'mode', mode)::text FROM frappe_migration_runs WHERE id = :'run_id'::uuid",
    { run_id: runId }
  );
  const persistedManifestHash = validHash(persistedRun.manifestHash, 'Hash persistido');
  if (persistedRun.runId !== runId || persistedRun.status !== 'completed' || persistedRun.mode !== 'apply')
    fail('Run persistido não está concluído em modo apply.');

  const sourceCounts = dryRun.manifest.entityCounts;
  const applyCounts = apply.manifest.entityCounts;
  for (const key of ['products', 'pricingTiers', 'clients', 'quotations']) {
    if (!Number.isInteger(sourceCounts?.[key]) || sourceCounts[key] < 0) fail(`Contagem de origem inválida: ${key}.`);
    if (!Number.isInteger(applyCounts?.[key]) || applyCounts[key] < 0) fail(`Contagem de apply inválida: ${key}.`);
  }
  const importedCounts = {
    products: entityOutcomeCount(apply, 'produtos'),
    pricingTiers: entityOutcomeCount(apply, 'faixas'),
    clients: entityOutcomeCount(apply, 'clientes'),
    quotations: entityOutcomeCount(apply, 'orcamentos'),
  };
  const sourceReadCounts = {
    products: Number(apply.produtos?.lidos || 0),
    pricingTiers: Number(apply.faixas?.lidos || 0),
    clients: Number(apply.clientes?.lidos || 0),
    quotations: Number(apply.orcamentos?.lidos || 0),
  };
  const targetCounts = queryJson(
    service,
    `SELECT json_build_object(
      'products', (SELECT count(*)::int FROM products),
      'pricingTiers', (SELECT count(*)::int FROM product_pricing_tiers),
      'clients', (SELECT count(*)::int FROM clients),
      'quotations', (SELECT count(*)::int FROM quotations),
      'revisions', (SELECT count(*)::int FROM quote_revisions),
      'items', (SELECT count(*)::int FROM quote_revision_items),
      'templates', (SELECT count(*)::int FROM quotation_templates),
      'templateVersions', (SELECT count(*)::int FROM quotation_template_versions)
    )::text`
  );
  const statusCounts = queryJson(
    service,
    `SELECT json_build_object(
      'quotations', COALESCE((SELECT json_object_agg(status, count ORDER BY status) FROM (SELECT status, count(*)::int AS count FROM quotations GROUP BY status) q), '{}'::json),
      'revisions', COALESCE((SELECT json_object_agg(status, count ORDER BY status) FROM (SELECT status, count(*)::int AS count FROM quote_revisions GROUP BY status) r), '{}'::json)
    )::text`
  );
  const lineageValidity = queryJson(
    service,
    `SELECT json_build_object(
      'total', count(*)::int,
      'invalid', count(*) FILTER (WHERE lineage_status <> 'verified' OR canonical_hash !~ '^[0-9a-f]{64}$' OR source_hash IS NULL OR source_hash !~ '^[0-9a-f]{64}$' OR char_length(btrim(local_key)) = 0)::int
    )::text FROM frappe_import_lineage`
  );
  const lineageRows = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'provider', provider,
      'sourceDoctype', source_doctype,
      'sourceId', source_id,
      'entityType', entity_type,
      'localId', local_id,
      'localKey', local_key,
      'canonicalHash', canonical_hash,
      'sourceHash', source_hash,
      'businessNumber', business_number,
      'migrationRunId', migration_run_id,
      'sourceUpdatedAt', source_updated_at,
      'lineageStatus', lineage_status
    ) ORDER BY source_doctype, source_id), '[]'::json)::text FROM frappe_import_lineage`
  );
  const revisionRows = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'id', r.id,
      'quotationId', r.quotation_id,
      'version', r.version,
      'status', r.status,
      'statusOriginal', r.status_original,
      'orderLinkage', r.order_linkage,
      'orderPending', r.order_pending,
      'templateVersionId', r.template_version_id,
      'templateHash', r.template_hash,
      'sectionsSnapshot', r.sections_snapshot,
      'subtotal', r.subtotal,
      'total', r.total,
      'items', COALESCE((SELECT json_agg(json_build_object(
        'id', i.id,
        'position', i.position,
        'productSku', i.product_sku,
        'quantidade', i.quantidade,
        'precoFonte', i.preco_fonte,
        'precoMinimoFaixa', i.preco_minimo_faixa,
        'precoSugerido', i.preco_sugerido,
        'precoAplicado', i.preco_aplicado,
        'diferencaPreco', i.diferenca_preco,
        'totalLinha', i.total_linha,
        'manualRate', i.manual_rate
      ) ORDER BY i.position) FROM quote_revision_items i WHERE i.revision_id = r.id), '[]'::json)
    ) ORDER BY r.quotation_id, r.version), '[]'::json)::text FROM quote_revisions r`
  );
  const approvedSource = stableKeys(dryRun.approvedDivergenceKeys);
  const approvedApply = stableKeys(apply.approvedDivergenceKeys);
  const unapprovedDivergenceKeys = (apply?.total?.detalhes || [])
    .filter((detail) => detail?.status === 'divergentes' && detail?.aprovada !== true)
    .map((detail) => `${detail.source_doctype || ''}:${detail.source_id || ''}`)
    .filter((key) => key !== ':');
  const blocking = Number(apply?.manifest?.divergenceCounts?.blocking || 0);
  const comparison = compareReconciliation({
    sourceCounts,
    applyCounts,
    sourceReadCounts,
    importedCounts,
    targetCounts,
    statusCounts,
    sourceManifestHash,
    applyManifestHash,
    persistedManifestHash,
    sourceApprovedDivergenceKeys: approvedSource,
    applyApprovedDivergenceKeys: approvedApply,
    unapprovedDivergenceKeys,
    blocking,
    lineageInvalid: Number(lineageValidity.invalid || 0),
  });
  const artifact = {
    schemaVersion: 1,
    status: comparison.passed ? 'passed' : 'failed',
    runId,
    database: serviceTarget.database,
    manifest: {
      sourceHash: sourceManifestHash,
      applyHash: applyManifestHash,
      persistedRunHash: persistedManifestHash,
    },
    sourceReadCounts,
    importedCounts,
    targetCounts,
    statusCounts,
    lineage: {
      total: Number(lineageValidity.total || 0),
      invalid: Number(lineageValidity.invalid || 0),
      canonicalHash: hash(lineageRows),
    },
    revisions: {
      canonicalHash: hash(revisionRows),
    },
    approvedDivergenceKeys: approvedApply,
    comparison,
  };
  writeArtifact(output, artifact);
  chmodSync(directory, 0o700);
  if (!comparison.passed) fail('Reconciliação PostgreSQL falhou; artefato persistido para revisão.');
  return artifact;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const artifact = runReconciliation(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: artifact.status, runId: artifact.runId, manifestHash: artifact.manifest.applyHash })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Falha na reconciliação.'}\n`);
    process.exitCode = 1;
  }
}
