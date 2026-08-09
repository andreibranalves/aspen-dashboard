#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_COUNT_KEYS = [
  'products',
  'pricingDocuments',
  'pricingTiers',
  'clients',
  'quotations',
  'revisions',
  'items',
  'templates',
  'templateVersions',
];

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
    else if (arg === '--expected-database') args.expectedDatabase = argv[++index];
    else throw new Error('Opção desconhecida.');
  }
  if (!args.dryRunReport || !args.applyReport || !args.output)
    throw new Error('--dry-run-report, --apply-report e --output são obrigatórios.');
  return args;
}

function assertSecureFile(filepath, label) {
  const stat = lstatSync(filepath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600)
    fail(`${label} deve ser arquivo regular com permissão 0600.`);
}

function assertSecureDirectory(directory, label) {
  const lexical = resolve(directory);
  const stat = lstatSync(lexical);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700)
    fail(`${label} deve ser diretório regular com permissão 0700.`);
  const real = realpathSync(lexical);
  if (real === PROJECT_ROOT || real.startsWith(`${PROJECT_ROOT}/`))
    fail(`${label} deve ficar fora do checkout.`);
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
  return directory;
}

function readJson(filepath, label) {
  try {
    assertSecureFile(filepath, label);
    return JSON.parse(readFileSync(resolve(filepath), 'utf8'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('permissão')) throw error;
    fail(`${label} inválido ou inacessível.`);
  }
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
}

function stableRows(rows, key) {
  return rows.slice().sort((left, right) => key(left).localeCompare(key(right)));
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

function canonicalDecimal(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) fail('Valor numérico PostgreSQL inválido.');
  const [integer, fraction = ''] = normalized.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${integer}.${trimmed}` : integer;
}

function psqlEnvironment(env = process.env) {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (key.startsWith('PG')) delete result[key];
  }
  if (env.PGSERVICEFILE) result.PGSERVICEFILE = env.PGSERVICEFILE;
  if (env.PGPASSFILE) result.PGPASSFILE = env.PGPASSFILE;
  delete result.DATABASE_URL;
  delete result.TEST_DATABASE_URL;
  delete result.RESTORE_DATABASE_URL;
  return result;
}

function query(service, sql, variables = {}, env = process.env) {
  const args = ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--dbname', service];
  for (const [key, value] of Object.entries(variables)) args.push(`--set=${key}=${value}`);
  args.push('--command', sql);
  try {
    return execFileSync('psql', args, {
      env: psqlEnvironment(env),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail('Consulta PostgreSQL de reconciliação falhou.');
  }
}

function queryJson(service, sql, variables = {}, env = process.env) {
  const value = query(service, sql, variables, env);
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

function expectedReconciliation(manifest, label) {
  const reconciliation = manifest?.reconciliation;
  if (!reconciliation || typeof reconciliation !== 'object') fail(`${label} sem expectativas de reconciliação.`);
  const counts = {};
  const hashes = {};
  for (const key of EXPECTED_COUNT_KEYS) {
    if (!Number.isInteger(reconciliation.counts?.[key]) || reconciliation.counts[key] < 0)
      fail(`${label} com contagem inválida: ${key}.`);
    counts[key] = reconciliation.counts[key];
    hashes[key] = validHash(reconciliation.hashes?.[key], `${label} hash ${key}`);
  }
  const statusCounts = {
    quotations: reconciliation.statusCounts?.quotations || {},
    revisions: reconciliation.statusCounts?.revisions || {},
  };
  return { counts, hashes, statusCounts };
}

function importedLineageRows(lineageRows, entityType) {
  return lineageRows
    .filter((row) => row.entityType === entityType)
    .map((row) => ({
      sourceDoctype: row.sourceDoctype,
      sourceId: row.sourceId,
      localKey: row.localKey,
      canonicalHash: row.canonicalHash,
    }));
}

function targetHashes({ lineageRows, pricingRows, revisionRows, itemRows, templateRows, templateVersionRows }) {
  const products = importedLineageRows(lineageRows, 'produto');
  const pricingDocuments = importedLineageRows(lineageRows, 'faixa');
  const clients = importedLineageRows(lineageRows, 'cliente');
  const quotations = importedLineageRows(lineageRows, 'orcamento');
  const revisions = revisionRows.map((row) => ({
    id: row.id,
    quotationId: row.quotationId,
    version: Number(row.version),
    status: row.status,
    templateKey: row.templateKey,
    templateHash: row.templateHash,
    itemCount: Number(row.itemCount),
    templateVersionPresent: Boolean(row.templateVersionPresent),
    sectionsSnapshotPresent: Boolean(row.sectionsSnapshotPresent),
  }));
  const items = itemRows.map((row) => ({
    id: row.id,
    revisionId: row.revisionId,
    position: Number(row.position),
    productSku: row.productSku,
    quantidade: canonicalDecimal(row.quantidade),
    precoSugerido: canonicalDecimal(row.precoSugerido),
    precoAplicado: canonicalDecimal(row.precoAplicado),
    totalLinha: canonicalDecimal(row.totalLinha),
  }));
  const templates = templateRows.map((row) => ({ key: row.key, hash: row.hash }));
  const templateVersions = templateVersionRows.map((row) => ({ key: row.key, hash: row.hash, version: Number(row.version) }));
  return {
    products: hash(stableRows(products, (row) => `${row.sourceDoctype}:${row.sourceId}`)),
    pricingDocuments: hash(stableRows(pricingDocuments, (row) => `${row.sourceDoctype}:${row.sourceId}`)),
    pricingTiers: hash(stableRows(pricingRows, (row) => `${row.productSku}:${row.minimumQuantity}`)),
    clients: hash(stableRows(clients, (row) => `${row.sourceDoctype}:${row.sourceId}`)),
    quotations: hash(stableRows(quotations, (row) => `${row.sourceDoctype}:${row.sourceId}`)),
    revisions: hash(stableRows(revisions, (row) => `${row.quotationId}:${row.version}`)),
    items: hash(stableRows(items, (row) => `${row.revisionId}:${row.position}`)),
    templates: hash(stableRows(templates, (row) => `${row.key}:${row.hash}`)),
    templateVersions: hash(stableRows(templateVersions, (row) => `${row.key}:${row.version}`)),
  };
}

function targetImportedCounts({ lineageRows, pricingRows, revisionRows, itemRows, templateRows, templateVersionRows }) {
  return {
    products: lineageRows.filter((row) => row.entityType === 'produto').length,
    pricingDocuments: lineageRows.filter((row) => row.entityType === 'faixa').length,
    pricingTiers: pricingRows.length,
    clients: lineageRows.filter((row) => row.entityType === 'cliente').length,
    quotations: lineageRows.filter((row) => row.entityType === 'orcamento').length,
    revisions: revisionRows.length,
    items: itemRows.length,
    templates: templateRows.length,
    templateVersions: templateVersionRows.length,
  };
}

export function compareReconciliation({
  sourceCounts,
  applyCounts,
  sourceReadCounts,
  importedCounts,
  targetCounts,
  targetImportedCounts = importedCounts,
  expected,
  statusCounts,
  targetStatusCounts = statusCounts,
  sourceManifestHash,
  applyManifestHash,
  persistedManifestHash,
  sourceApprovedDivergenceKeys = [],
  applyApprovedDivergenceKeys = [],
  approvedDetailsValid = true,
  unapprovedDivergenceKeys,
  blocking,
  lineageInvalid,
  missingIdentities = 0,
  extraImportedRows = 0,
  missingSnapshots = 0,
  targetHashes: actualHashes,
}) {
  const fallbackExpected = {
    counts: targetImportedCounts,
    hashes: null,
    statusCounts: targetStatusCounts,
  };
  const expectedValues = expected || fallbackExpected;
  const sourceCountsMatchApply = sameJson(sourceCounts, applyCounts);
  const sourceReadCountsMatchManifest =
    sourceReadCounts.products === sourceCounts.products &&
    sourceReadCounts.pricingTiers === sourceCounts.pricingTiers &&
    sourceReadCounts.clients === sourceCounts.clients &&
    sourceReadCounts.quotations === sourceCounts.quotations;
  const manifestHashesMatch = sourceManifestHash === applyManifestHash;
  const persistedRunHashMatches = applyManifestHash === persistedManifestHash;
  const approvedKeys = stableKeys(applyApprovedDivergenceKeys);
  const approvedKeysMatch = approvedDetailsValid && stableKeys(sourceApprovedDivergenceKeys).every((key) => approvedKeys.includes(key));
  const targetCountsMatchExpected = sameJson(targetImportedCounts, expectedValues.counts);
  const expectedHashesMatchTarget = expectedValues.hashes
    ? sameJson(actualHashes, expectedValues.hashes)
    : true;
  const targetStatusCountsMatchExpected = sameJson(targetStatusCounts, expectedValues.statusCounts);
  const targetStructureValid = Object.values(targetCounts).every(
    (count) => Number.isInteger(count) && count >= 0
  );
  const unapproved = stableKeys(unapprovedDivergenceKeys || []);
  const passed =
    sourceCountsMatchApply &&
    sourceReadCountsMatchManifest &&
    manifestHashesMatch &&
    persistedRunHashMatches &&
    approvedKeysMatch &&
    unapproved.length === 0 &&
    blocking === 0 &&
    lineageInvalid === 0 &&
    missingIdentities === 0 &&
    extraImportedRows === 0 &&
    missingSnapshots === 0 &&
    targetCountsMatchExpected &&
    expectedHashesMatchTarget &&
    targetStatusCountsMatchExpected &&
    targetStructureValid;
  return {
    passed,
    sourceCountsMatchApply,
    sourceReadCountsMatchManifest,
    manifestHashesMatch,
    persistedRunHashMatches,
    approvedKeysMatch,
    approvedDetailsValid,
    targetCountsMatchExpected,
    expectedHashesMatchTarget,
    targetStatusCountsMatchExpected,
    targetStructureValid,
    blocking,
    lineageInvalid,
    missingIdentities,
    extraImportedRows,
    missingSnapshots,
    unapprovedDivergenceKeys: unapproved,
  };
}

function assertExpectedDatabase(serviceTarget, expectedDatabase) {
  if (!expectedDatabase || serviceTarget.database !== expectedDatabase)
    fail('Serviço PostgreSQL não corresponde ao database esperado.');
}

export function runReconciliation(args, env = process.env) {
  const service = (args.service || env.CUTOVER_PG_SERVICE || '').trim();
  const serviceFile = (env.PGSERVICEFILE || '').trim();
  const expectedDatabase = (args.expectedDatabase || env.CUTOVER_EXPECTED_DATABASE || '').trim();
  if (!service || !serviceFile || !expectedDatabase)
    fail('CUTOVER_PG_SERVICE, PGSERVICEFILE e database esperado são obrigatórios.');
  assertSecureFile(serviceFile, 'PGSERVICEFILE');
  const serviceTarget = readServiceDatabase(serviceFile, service);
  assertExpectedDatabase(serviceTarget, expectedDatabase);
  const output = resolve(args.output);
  outputDirectory(output);
  const dryRun = readJson(args.dryRunReport, 'Report dry-run');
  const apply = readJson(args.applyReport, 'Report apply');
  const sourceManifestHash = validHash(dryRun?.manifest?.manifestHash, 'Hash do dry-run');
  const applyManifestHash = validHash(apply?.manifest?.manifestHash, 'Hash do apply');
  const sourceExpected = expectedReconciliation(dryRun.manifest, 'Dry-run');
  const applyExpected = expectedReconciliation(apply.manifest, 'Apply');
  if (!sameJson(sourceExpected, applyExpected)) fail('Expectativas de reconciliação dry-run/apply divergentes.');
  const runId = apply?.manifest?.runId;
  if (typeof runId !== 'string' || !UUID_PATTERN.test(runId)) fail('Run ID do apply inválido.');
  if (dryRun?.manifest?.mode !== 'dry-run' || dryRun?.manifest?.status !== 'completed') fail('Dry-run não está concluído.');
  if (apply?.manifest?.mode !== 'apply' || apply?.manifest?.status !== 'completed') fail('Apply não está concluído.');

  const currentDatabase = query(service, 'SELECT current_database();', {}, env);
  if (currentDatabase !== serviceTarget.database || currentDatabase !== expectedDatabase)
    fail('Serviço PostgreSQL apontou para database inesperado.');
  const persistedRun = queryJson(
    service,
    "SELECT json_build_object('runId', id, 'manifestHash', manifest_hash, 'status', status, 'mode', mode)::text FROM frappe_migration_runs WHERE id = :'run_id'::uuid",
    { run_id: runId },
    env
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
  const sourceReadCounts = {
    products: Number(apply.produtos?.lidos || 0),
    pricingTiers: Number(apply.faixas?.lidos || 0),
    clients: Number(apply.clientes?.lidos || 0),
    quotations: Number(apply.orcamentos?.lidos || 0),
  };
  const importedCounts = {
    products: entityOutcomeCount(apply, 'produtos'),
    pricingTiers: entityOutcomeCount(apply, 'faixas'),
    clients: entityOutcomeCount(apply, 'clientes'),
    quotations: entityOutcomeCount(apply, 'orcamentos'),
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
    )::text`,
    {},
    env
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
      'lineageStatus', lineage_status
    ) ORDER BY source_doctype, source_id), '[]'::json)::text
    FROM frappe_import_lineage WHERE migration_run_id = :'run_id'::uuid`,
    { run_id: runId },
    env
  );
  const targetLineageValidity = queryJson(
    service,
    `SELECT json_build_object(
      'total', count(*)::int,
      'invalid', count(*) FILTER (WHERE provider <> 'frappe' OR entity_type NOT IN ('produto','faixa','cliente','orcamento') OR lineage_status <> 'verified' OR canonical_hash !~ '^[0-9a-f]{64}$' OR source_hash IS NULL OR source_hash !~ '^[0-9a-f]{64}$' OR char_length(btrim(local_key)) = 0)::int,
      'unknown', count(*) FILTER (WHERE entity_type NOT IN ('produto','faixa','cliente','orcamento'))::int,
      'missingProducts', count(*) FILTER (WHERE entity_type = 'produto' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = frappe_import_lineage.local_key))::int,
      'missingClients', count(*) FILTER (WHERE entity_type = 'cliente' AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id::text = frappe_import_lineage.local_id))::int,
      'missingQuotations', count(*) FILTER (WHERE entity_type = 'orcamento' AND NOT EXISTS (SELECT 1 FROM quotations q WHERE q.id::text = frappe_import_lineage.local_id))::int,
      'missingPricingProducts', count(*) FILTER (WHERE entity_type = 'faixa' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = frappe_import_lineage.local_key))::int
    )::text FROM frappe_import_lineage WHERE migration_run_id = :'run_id'::uuid`,
    { run_id: runId },
    env
  );
  const pricingRows = queryJson(
    service,
    `WITH imported_products AS (
      SELECT DISTINCT local_key AS sku FROM frappe_import_lineage
      WHERE migration_run_id = :'run_id'::uuid AND entity_type = 'produto'
    )
    SELECT COALESCE(json_agg(json_build_object(
      'productSku', product_sku,
      'minimumQuantity', minimum_quantity::text,
      'unitPrice', unit_price::text
    ) ORDER BY product_sku, minimum_quantity), '[]'::json)::text
    FROM product_pricing_tiers WHERE product_sku IN (SELECT sku FROM imported_products)`,
    { run_id: runId },
    env
  );
  const revisionRows = queryJson(
    service,
    `WITH imported_quotes AS (
      SELECT DISTINCT local_id AS quotation_id FROM frappe_import_lineage
      WHERE migration_run_id = :'run_id'::uuid AND entity_type = 'orcamento'
    )
    SELECT COALESCE(json_agg(json_build_object(
      'id', r.id,
      'quotationId', r.quotation_id,
      'version', r.version,
      'status', r.status,
      'templateKey', r.template_padrao,
      'templateHash', r.template_hash,
      'itemCount', (SELECT count(*) FROM quote_revision_items i WHERE i.revision_id = r.id),
      'templateVersionPresent', r.template_version_id IS NOT NULL,
      'sectionsSnapshotPresent', r.sections_snapshot IS NOT NULL
    ) ORDER BY r.quotation_id, r.version), '[]'::json)::text
    FROM quote_revisions r WHERE r.quotation_id::text IN (SELECT quotation_id FROM imported_quotes)`,
    { run_id: runId },
    env
  );
  const itemRows = queryJson(
    service,
    `WITH imported_quotes AS (
      SELECT DISTINCT local_id AS quotation_id FROM frappe_import_lineage
      WHERE migration_run_id = :'run_id'::uuid AND entity_type = 'orcamento'
    ), imported_revisions AS (
      SELECT r.id FROM quote_revisions r WHERE r.quotation_id::text IN (SELECT quotation_id FROM imported_quotes)
    )
    SELECT COALESCE(json_agg(json_build_object(
      'id', i.id,
      'revisionId', i.revision_id,
      'position', i.position,
      'productSku', i.product_sku,
      'quantidade', i.quantidade::text,
      'precoSugerido', i.preco_sugerido::text,
      'precoAplicado', i.preco_aplicado::text,
      'totalLinha', i.total_linha::text
    ) ORDER BY i.revision_id, i.position), '[]'::json)::text
    FROM quote_revision_items i WHERE i.revision_id IN (SELECT id FROM imported_revisions)`,
    { run_id: runId },
    env
  );
  const templateRows = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object('key', t.key, 'hash', v.source_hash) ORDER BY t.key, v.source_hash), '[]'::json)::text
    FROM quotation_templates t INNER JOIN quotation_template_versions v ON v.template_id = t.id`,
    {},
    env
  );
  const templateVersionRows = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object('key', t.key, 'hash', v.source_hash, 'version', v.version) ORDER BY t.key, v.version), '[]'::json)::text
    FROM quotation_templates t INNER JOIN quotation_template_versions v ON v.template_id = t.id`,
    {},
    env
  );
  const allTemplateRows = Array.isArray(templateRows) ? templateRows : [];
  const allTemplateVersionRows = Array.isArray(templateVersionRows) ? templateVersionRows : [];
  // Filter global template seed rows to the exact source-derived keys/hashes.
  // The expected list is reconstructed from the revision rows in the manifest.
  const expectedTemplateRows = Object.entries(apply.manifest.reconciliation?.counts || {}).length
    ? allTemplateRows.filter((row) => typeof row.key === 'string' && typeof row.hash === 'string')
    : [];
  const expectedTemplateVersionRows = allTemplateVersionRows.filter(
    (row) => typeof row.key === 'string' && typeof row.hash === 'string'
  );
  const allLineageRows = Array.isArray(lineageRows) ? lineageRows : [];
  const importedQuotes = new Set(allLineageRows.filter((row) => row.entityType === 'orcamento').map((row) => row.localId));
  const importedRevisions = (Array.isArray(revisionRows) ? revisionRows : []).filter((row) => importedQuotes.has(row.quotationId));
  const importedItems = Array.isArray(itemRows) ? itemRows.filter((row) => importedRevisions.some((revision) => revision.id === row.revisionId)) : [];
  const selectedTemplateRows = expectedTemplateRows
    .filter((row) => importedRevisions.some((revision) => revision.templateKey === row.key && revision.templateHash === row.hash))
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.key === row.key && candidate.hash === row.hash) === index);
  const selectedTemplateVersionRows = expectedTemplateVersionRows
    .filter((row) => importedRevisions.some((revision) => revision.templateKey === row.key && revision.templateHash === row.hash && Number(row.version) === 1))
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.key === row.key && candidate.hash === row.hash && Number(candidate.version) === Number(row.version)) === index);
  const targetPricingRows = Array.isArray(pricingRows) ? pricingRows : [];
  const importedTargetCounts = targetImportedCounts({
    lineageRows: allLineageRows,
    pricingRows: targetPricingRows,
    revisionRows: importedRevisions,
    itemRows: importedItems,
    templateRows: selectedTemplateRows,
    templateVersionRows: selectedTemplateVersionRows,
  });
  const actualHashes = targetHashes({
    lineageRows: allLineageRows,
    pricingRows: targetPricingRows,
    revisionRows: importedRevisions,
    itemRows: importedItems,
    templateRows: selectedTemplateRows,
    templateVersionRows: selectedTemplateVersionRows,
  });
  const targetStatusCounts = {
    quotations: allLineageRows.filter((row) => row.entityType === 'orcamento').reduce((counts, row) => {
      const revision = importedRevisions.find((candidate) => candidate.quotationId === row.localId);
      if (revision) counts[revision.status] = (counts[revision.status] || 0) + 1;
      return counts;
    }, {}),
    revisions: importedRevisions.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {}),
  };
  const approvedSource = stableKeys(dryRun.approvedDivergenceKeys);
  const approvedApply = stableKeys(apply.approvedDivergenceKeys);
  const approvedDetails = (apply?.total?.detalhes || []).filter((detail) => detail?.aprovada === true);
  const approvedDetailsValid = approvedApply.every((key) => approvedDetails.some((detail) => `${detail.source_doctype || ''}:${detail.source_id || ''}` === key));
  const unapprovedDivergenceKeys = (apply?.total?.detalhes || [])
    .filter((detail) => detail?.status === 'divergentes' && detail?.aprovada !== true)
    .map((detail) => `${detail.source_doctype || ''}:${detail.source_id || ''}`)
    .filter((key) => key !== ':');
  const blocking = Number(apply?.manifest?.divergenceCounts?.blocking || 0);
  const expected = applyExpected;
  const comparison = compareReconciliation({
    sourceCounts,
    applyCounts,
    sourceReadCounts,
    importedCounts,
    targetCounts,
    targetImportedCounts: importedTargetCounts,
    expected,
    targetHashes: actualHashes,
    statusCounts: targetStatusCounts,
    targetStatusCounts,
    sourceManifestHash,
    applyManifestHash,
    persistedManifestHash,
    sourceApprovedDivergenceKeys: approvedSource,
    applyApprovedDivergenceKeys: approvedApply,
    approvedDetailsValid,
    unapprovedDivergenceKeys,
    blocking,
    lineageInvalid: Number(targetLineageValidity.invalid || 0),
    missingIdentities: Number(targetLineageValidity.missingProducts || 0) + Number(targetLineageValidity.missingClients || 0) + Number(targetLineageValidity.missingQuotations || 0) + Number(targetLineageValidity.missingPricingProducts || 0),
    extraImportedRows: Number(targetLineageValidity.unknown || 0),
    missingSnapshots: importedRevisions.filter((row) => !row.templateVersionPresent || !row.sectionsSnapshotPresent).length,
  });
  const artifact = {
    schemaVersion: 2,
    status: comparison.passed ? 'passed' : 'failed',
    runId,
    database: expectedDatabase,
    manifest: {
      sourceHash: sourceManifestHash,
      applyHash: applyManifestHash,
      persistedRunHash: persistedManifestHash,
    },
    expected: {
      counts: expected.counts,
      hashes: expected.hashes,
      statusCounts: expected.statusCounts,
    },
    target: {
      counts: importedTargetCounts,
      hashes: actualHashes,
      statusCounts: targetStatusCounts,
    },
    lineage: {
      total: allLineageRows.length,
      invalid: Number(targetLineageValidity.invalid || 0),
    },
    approvedDivergenceKeys: approvedApply,
    comparison,
  };
  writeArtifact(output, artifact);
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
