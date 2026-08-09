#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNT_KEYS = [
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
const HASH_KEYS = [...COUNT_KEYS, 'lineage'];

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
  const stat = lstatSync(resolve(filepath));
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600)
    fail(`${label} deve ser arquivo regular com permissão 0600.`);
}

function assertSecureDirectory(directory, label) {
  const lexical = resolve(directory);
  const stat = lstatSync(lexical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
    fail(`${label} deve ser diretório regular com permissão 0700.`);
  const real = realpathSync(lexical);
  if (real === PROJECT_ROOT || real.startsWith(`${PROJECT_ROOT}/`))
    fail(`${label} deve ficar fora do checkout.`);
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

function readServiceDatabase(serviceFile, serviceName) {
  let active = false;
  const values = {};
  try {
    for (const rawLine of readFileSync(serviceFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        active = section[1].trim() === serviceName;
        continue;
      }
      if (!active || !line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator !== -1)
        values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  } catch {
    fail('PGSERVICEFILE não pôde ser lido.');
  }
  const database = values.dbname || values.database;
  if (!values.host || !database) fail('CUTOVER_PG_SERVICE não informa host e database.');
  if (values.hostaddr && values.hostaddr !== values.host)
    fail('CUTOVER_PG_SERVICE não pode sobrescrever host com hostaddr.');
  return { host: values.host.toLowerCase(), port: values.port || '5432', database };
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

function hash(value) {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
}

function stableRows(rows, key) {
  return rows.slice().sort((left, right) => key(left).localeCompare(key(right)));
}

function sameJson(left, right) {
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

function validHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) fail(`${label} inválido.`);
  return value;
}

function stableKeys(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
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
  for (const key of Object.keys(result)) if (key.startsWith('PG')) delete result[key];
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
      maxBuffer: 64 * 1024 * 1024,
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
  const output = resolve(filepath);
  if (existsSync(output) && lstatSync(output).isSymbolicLink())
    fail('Artefato de reconciliação não pode ser link simbólico.');
  const temporary = `${output}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    created = true;
    writeSync(descriptor, `${JSON.stringify(artifact, null, 2)}\n`);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    renameSync(temporary, output);
    chmodSync(output, 0o600);
    assertSecureFile(output, 'Artefato de reconciliação');
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try {
        unlinkSync(temporary);
      } catch {
        // Keep the original sanitized error boundary.
      }
    }
    if (error instanceof Error && error.message.includes('Artefato')) throw error;
    fail('Não foi possível persistir o artefato de reconciliação.');
  }
}

function expectedReconciliation(manifest, label) {
  const reconciliation = manifest?.reconciliation;
  if (!reconciliation || typeof reconciliation !== 'object')
    fail(`${label} sem expectativas de reconciliação.`);
  const keys = {};
  for (const key of ['products', 'pricingDocuments', 'pricingTiers', 'clients', 'quotations']) {
    if (!Array.isArray(reconciliation.keys?.[key])) fail(`${label} com chaves inválidas: ${key}.`);
    keys[key] = stableKeys(reconciliation.keys[key].map(String));
  }
  const counts = {};
  for (const key of COUNT_KEYS) {
    if (!Number.isInteger(reconciliation.counts?.[key]) || reconciliation.counts[key] < 0)
      fail(`${label} com contagem inválida: ${key}.`);
    counts[key] = reconciliation.counts[key];
  }
  const hashes = {};
  for (const key of HASH_KEYS) hashes[key] = validHash(reconciliation.hashes?.[key], `${label} hash ${key}`);
  const statusCounts = {
    quotations: reconciliation.statusCounts?.quotations || {},
    revisions: reconciliation.statusCounts?.revisions || {},
  };
  const parseStatusRows = (rows) => (Array.isArray(rows) ? rows.map((row) => ({
    sourceId: String(row.sourceId),
    status: String(row.status),
    allowedStatuses: Array.isArray(row.allowedStatuses)
      ? [...new Set(row.allowedStatuses.map(String))].sort()
      : [String(row.status)],
  })) : []);
  const revisionExpectations = Array.isArray(reconciliation.revisionExpectations)
    ? reconciliation.revisionExpectations.map((row) => ({
        sourceId: String(row.sourceId),
        templateVersionKey: String(row.templateVersionKey),
        templateVersionHash: validHash(row.templateVersionHash, `${label} template hash`),
        templateVersion: Number(row.templateVersion),
        sectionsSnapshotHash: validHash(row.sectionsSnapshotHash, `${label} sections hash`),
      }))
    : [];
  const statusRows = {
    quotations: parseStatusRows(reconciliation.statusRows?.quotations),
    revisions: parseStatusRows(reconciliation.statusRows?.revisions),
  };
  const rows = {};
  for (const key of [...COUNT_KEYS, 'lineage']) {
    if (!Array.isArray(reconciliation.rows?.[key])) fail(`${label} com linhas inválidas: ${key}.`);
    rows[key] = reconciliation.rows[key].map((row) => ({ ...row }));
  }
  return { keys, counts, hashes, statusCounts, statusRows, revisionExpectations, rows };
}

function expectedWithoutApproved(expected, approvedKeys) {
  const approved = new Set(stableKeys(approvedKeys));
  if (approved.size === 0) return expected;
  const approvedSource = (doctype, sourceId) => approved.has(`${doctype}:${sourceId}`);
  const productRows = expected.rows.products.filter(
    (row) => !approvedSource(String(row.sourceDoctype || 'Item'), String(row.sourceId))
  );
  const productSkus = new Set(productRows.map((row) => String(row.sku)));
  const pricingDocuments = expected.rows.pricingDocuments.filter(
    (row) => !approvedSource(String(row.sourceDoctype), String(row.sourceId)) && productSkus.has(String(row.localKey))
  );
  const pricingTiers = expected.rows.pricingTiers.filter((row) => productSkus.has(String(row.productSku)));
  const clients = expected.rows.clients.filter(
    (row) => !Array.isArray(row.sourceKeys) || !row.sourceKeys.some((key) => approved.has(String(key)))
  );
  const quotations = expected.rows.quotations.filter(
    (row) => !approvedSource(String(row.sourceDoctype || 'Quotation'), String(row.sourceId))
  );
  const quotationSourceIds = new Set(quotations.map((row) => String(row.sourceId)));
  const revisions = expected.rows.revisions.filter((row) => quotationSourceIds.has(String(row.sourceId)));
  const items = expected.rows.items.filter((row) => quotationSourceIds.has(String(row.sourceId)));
  const revisionExpectations = expected.revisionExpectations.filter((row) => quotationSourceIds.has(row.sourceId));
  const templates = expected.rows.templates.filter((row) =>
    revisions.some((revision) => `${revision.templateVersionKey}:${revision.templateVersionHash}` === `${row.key}:${row.hash}`)
  );
  const templateVersions = expected.rows.templateVersions.filter((row) =>
    templates.some((template) => `${template.key}:${template.hash}` === `${row.key}:${row.hash}`)
  );
  const lineage = expected.rows.lineage.filter(
    (row) => !approvedSource(String(row.sourceDoctype), String(row.sourceId))
  );
  const rows = {
    products: productRows,
    pricingDocuments,
    pricingTiers,
    clients,
    quotations,
    revisions,
    items,
    templates,
    templateVersions,
    lineage,
  };
  const statusRows = {
    quotations: expected.statusRows.quotations.filter((row) => quotationSourceIds.has(row.sourceId)),
    revisions: expected.statusRows.revisions.filter((row) => quotationSourceIds.has(row.sourceId)),
  };
  const counts = {
    products: productRows.length,
    pricingDocuments: pricingDocuments.length,
    pricingTiers: pricingTiers.length,
    clients: clients.length,
    quotations: quotations.length,
    revisions: revisions.length,
    items: items.length,
    templates: templates.length,
    templateVersions: templateVersions.length,
  };
  const keys = {
    products: expected.keys.products.filter((key) => !approved.has(key)),
    pricingDocuments: expected.keys.pricingDocuments.filter((key) => !approved.has(key)),
    pricingTiers: pricingTiers.map((row) => `${row.productSku}:${row.minimumQuantity}`).sort(),
    clients: expected.keys.clients.filter((key) => !approved.has(key)),
    quotations: expected.keys.quotations.filter((key) => !approved.has(key)),
  };
  const hashes = targetHashes(rows);
  return {
    ...expected,
    keys,
    counts,
    hashes,
    statusCounts: {
      quotations: statusCounts(statusRows.quotations),
      revisions: statusCounts(statusRows.revisions),
    },
    statusRows,
    revisionExpectations,
    rows,
  };
}

function safeLineageSourceId(row) {
  if (row.sourceDoctype !== 'Customer' && row.sourceDoctype !== 'Lead') return String(row.sourceId);
  const value = String(row.sourceId);
  if (/^cliente-[0-9a-f]{12}$/i.test(value)) return value.toLowerCase();
  return `cliente-${hash(`${row.sourceDoctype}:${value}`).slice(0, 12)}`;
}

function sourceKey(row) {
  return `${row.sourceDoctype}:${safeLineageSourceId(row)}`;
}

function selectedLineageRows(allRows, expected) {
  const sets = new Map([
    ['produto', new Set(expected.keys.products)],
    ['faixa', new Set(expected.keys.pricingDocuments)],
    ['cliente', new Set(expected.keys.clients)],
    ['orcamento', new Set(expected.keys.quotations)],
  ]);
  const selected = allRows.filter((row) => sets.get(row.entityType)?.has(sourceKey(row)));
  const expectedKeyCount = [...sets.values()].reduce((total, set) => total + set.size, 0);
  const selectedKeys = new Set(selected.map((row) => `${row.entityType}:${sourceKey(row)}`));
  let missing = 0;
  for (const [entityType, set] of sets) {
    for (const key of set) if (!selectedKeys.has(`${entityType}:${key}`)) missing += 1;
  }
  const duplicate = selected.length - selectedKeys.size;
  return { selected, missing, duplicate, expectedKeyCount };
}

function productProjection(lineage, product) {
  return {
    sourceDoctype: lineage.sourceDoctype,
    sourceId: lineage.sourceId,
    sku: product.sku,
    identityHash: hash({
      sku: product.sku,
      nome: product.nome,
      descricao: product.descricao,
      unidade: product.unidade,
      categoria: product.categoria,
      marca: product.marca,
      ativo: product.ativo,
      precoBase: product.precoBase,
    }),
  };
}

function clientProjection(lineages, client) {
  const address =
    client.endereco === null &&
    client.numero === null &&
    client.bairro === null &&
    client.complemento === null &&
    client.municipio === null &&
    client.uf === null &&
    client.cep === null
      ? null
      : {
          endereco: client.endereco,
          numero: client.numero,
          bairro: client.bairro,
          complemento: client.complemento,
          municipio: client.municipio,
          uf: client.uf,
          cep: client.cep,
        };
  return {
    sourceKeys: lineages.map((lineage) => `${lineage.sourceDoctype}:${safeLineageSourceId(lineage)}`).sort(),
    sourceIds: lineages.map(safeLineageSourceId).sort(),
    // Keep PII out of the persisted artifact while still comparing the full
    // target identity against the source-derived opaque hash.
    identityHash: hash({
      nome: client.nome,
      documento: client.documento,
      email: client.email,
      telefone: client.telefone,
      notes: client.notes,
      address,
      arquivado: client.arquivado,
    }),
  };
}

function quotationProjection(lineage, quotation) {
  return {
    sourceDoctype: lineage.sourceDoctype,
    sourceId: lineage.sourceId,
    id: quotation.id,
    identityHash: hash({
      id: quotation.id,
      businessNumber: quotation.businessNumber,
      clientId: quotation.clientId,
    }),
  };
}

function revisionProjection(sourceId, revision) {
  const templateVersionKey = revision.templateVersionKey;
  const templateVersionHash = revision.templateVersionHash;
  const templateVersion = Number(revision.templateVersion);
  const sectionsSnapshotHash = hash(revision.sectionsSnapshot);
  return {
    sourceId,
    templateKey: revision.templateKey,
    templateHash: revision.templateHash,
    templateVersionKey,
    templateVersionHash,
    templateVersion,
    sectionsSnapshotHash,
    identityHash: hash({
      statusOriginal: revision.statusOriginal,
      orderLinkage: revision.orderLinkage,
      orderPending: revision.orderPending,
      validadeDias: Number(revision.validadeDias),
      pagamento: revision.pagamento,
      entrega: revision.entrega,
      fretePadrao: canonicalDecimal(revision.fretePadrao),
      frete: canonicalDecimal(revision.frete),
      observacoes: revision.observacoes,
      prazoProducao: revision.prazoProducao,
      templateKey: revision.templateKey,
      templateHash: revision.templateHash,
      templateVersionKey,
      templateVersionHash,
      templateVersion,
      sectionsSnapshotHash,
      subtotal: canonicalDecimal(revision.subtotal),
      total: canonicalDecimal(revision.total),
      itemCount: Number(revision.itemCount),
    }),
  };
}

function itemProjection(sourceId, item) {
  const position = Number(item.position);
  const productSku = item.productSku;
  const quantidade = canonicalDecimal(item.quantidade);
  const precoSugerido = canonicalDecimal(item.precoSugerido);
  const precoAplicado = canonicalDecimal(item.precoAplicado);
  const totalLinha = canonicalDecimal(item.totalLinha);
  return {
    sourceId,
    position,
    identityHash: hash({ position, productSku, quantidade, precoSugerido, precoAplicado, totalLinha }),
  };
}

function targetHashes({ products, pricingDocuments, pricingTiers, clients, quotations, revisions, items, templates, templateVersions, lineage }) {
  return {
    products: hash(stableRows(products, (row) => row.sourceId)),
    pricingDocuments: hash(stableRows(pricingDocuments, (row) => `${row.sourceDoctype}:${row.sourceId}`)),
    pricingTiers: hash(stableRows(pricingTiers, (row) => `${row.productSku}:${row.minimumQuantity}`)),
    clients: hash(stableRows(clients, (row) => row.sourceIds.join(','))),
    quotations: hash(stableRows(quotations, (row) => row.sourceId)),
    revisions: hash(stableRows(revisions, (row) => row.sourceId)),
    items: hash(stableRows(items, (row) => `${row.sourceId}:${row.position}`)),
    templates: hash(stableRows(templates, (row) => `${row.key}:${row.hash}`)),
    templateVersions: hash(stableRows(templateVersions, (row) => `${row.key}:${row.version}`)),
    lineage: hash(stableRows(lineage, (row) => `${row.sourceDoctype}:${row.sourceId}`)),
  };
}

function countRows(values) {
  return {
    products: values.products.length,
    pricingDocuments: values.pricingDocuments.length,
    pricingTiers: values.pricingTiers.length,
    clients: values.clients.length,
    quotations: values.quotations.length,
    revisions: values.revisions.length,
    items: values.items.length,
    templates: values.templates.length,
    templateVersions: values.templateVersions.length,
  };
}

function statusCounts(rows) {
  return rows.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {});
}

function statusRowsMatchAllowed(actualRows, expectedRows) {
  if (!Array.isArray(actualRows) || !Array.isArray(expectedRows) || actualRows.length !== expectedRows.length)
    return false;
  const expectedBySource = new Map(expectedRows.map((row) => [row.sourceId, row]));
  const actualSources = new Set(actualRows.map((row) => row.sourceId));
  if (expectedBySource.size !== expectedRows.length || actualSources.size !== actualRows.length)
    return false;
  return actualRows.every((row) => {
    const expected = expectedBySource.get(row.sourceId);
    const allowed = expected?.allowedStatuses || [expected?.status];
    return Boolean(expected && allowed.includes(row.status));
  });
}

export function compareReconciliation({
  sourceCounts,
  applyCounts,
  sourceReadCounts,
  targetCounts,
  targetImportedCounts,
  expected,
  targetStatusCounts,
  targetStatusRows,
  sourceManifestHash,
  applyManifestHash,
  persistedManifestHash,
  sourceApprovedDivergenceKeys = [],
  applyApprovedDivergenceKeys = [],
  approvedDetailsValid = true,
  unapprovedDivergenceKeys = [],
  blocking,
  lineageInvalid,
  missingIdentities = 0,
  extraImportedRows = 0,
  missingSnapshots = 0,
  targetHashes,
  expectedHashesMatchTarget,
}) {
  const actualCounts = targetImportedCounts || targetCounts;
  const expectedValues = expected || { counts: actualCounts, hashes: null, statusCounts: targetStatusCounts };
  const sourceCountsMatchApply = sameJson(sourceCounts, applyCounts);
  const sourceReadCountsMatchManifest =
    sourceReadCounts.products === sourceCounts.products &&
    sourceReadCounts.pricingTiers === sourceCounts.pricingTiers &&
    sourceReadCounts.clients === sourceCounts.clients &&
    sourceReadCounts.quotations === sourceCounts.quotations;
  const manifestHashesMatch = sourceManifestHash === applyManifestHash;
  const persistedRunHashMatches = applyManifestHash === persistedManifestHash;
  const approved = stableKeys(applyApprovedDivergenceKeys);
  const sourceApproved = stableKeys(sourceApprovedDivergenceKeys);
  const approvedKeysMatch =
    approvedDetailsValid && sourceApproved.every((key) => approved.includes(key));
  const targetCountsMatchExpected = sameJson(actualCounts, expectedValues.counts);
  const targetStructureValid = Object.values(actualCounts).every(
    (count) => Number.isInteger(count) && count >= 0
  );
  const targetStatusRowsMatchExpected = targetStatusRows && expectedValues.statusRows
    ? statusRowsMatchAllowed(targetStatusRows.quotations, expectedValues.statusRows.quotations) &&
      statusRowsMatchAllowed(targetStatusRows.revisions, expectedValues.statusRows.revisions)
    : sameJson(targetStatusCounts, expectedValues.statusCounts || {});
  const hashesMatch = expectedHashesMatchTarget ??
    (targetHashes && expectedValues.hashes ? sameJson(targetHashes, expectedValues.hashes) : true);
  const unapproved = stableKeys(unapprovedDivergenceKeys);
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
    targetStructureValid &&
    hashesMatch &&
    targetStatusRowsMatchExpected;
  return {
    passed,
    sourceCountsMatchApply,
    sourceReadCountsMatchManifest,
    manifestHashesMatch,
    persistedRunHashMatches,
    approvedKeysMatch,
    approvedDetailsValid,
    targetCountsMatchExpected,
    targetStructureValid,
    expectedHashesMatchTarget: hashesMatch,
    targetStatusRowsMatchExpected,
    // Backward-compatible field for existing evidence consumers.
    targetStatusCountsMatchExpected: targetStatusRowsMatchExpected,
    blocking,
    lineageInvalid,
    missingIdentities,
    extraImportedRows,
    missingSnapshots,
    unapprovedDivergenceKeys: unapproved,
  };
}

function runTargetQueries(service, env) {
  const allLineage = queryJson(
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
      'lineageStatus', lineage_status,
      'migrationRunId', migration_run_id
    ) ORDER BY source_doctype, source_id, entity_type), '[]'::json)::text FROM frappe_import_lineage`,
    {},
    env
  );
  const products = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'sku', sku, 'nome', nome, 'descricao', descricao, 'unidade', unidade,
      'categoria', categoria, 'marca', marca, 'ativo', ativo, 'precoBase', preco_base::text
    ) ORDER BY sku), '[]'::json)::text FROM products`,
    {},
    env
  );
  const clients = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'id', id::text, 'nome', nome, 'documento', documento, 'email', email,
      'telefone', telefone, 'notes', notes, 'endereco', endereco, 'numero', numero,
      'bairro', bairro, 'complemento', complemento, 'municipio', municipio,
      'uf', uf, 'cep', cep, 'arquivado', arquivado
    ) ORDER BY id), '[]'::json)::text FROM clients`,
    {},
    env
  );
  const quotations = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'id', id::text, 'businessNumber', business_number, 'clientId', client_id::text, 'status', status
    ) ORDER BY id), '[]'::json)::text FROM quotations`,
    {},
    env
  );
  const pricingTiers = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'productSku', product_sku, 'minimumQuantity', minimum_quantity::text, 'unitPrice', unit_price::text
    ) ORDER BY product_sku, minimum_quantity), '[]'::json)::text FROM product_pricing_tiers`,
    {},
    env
  );
  const revisions = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'id', id::text, 'quotationId', quotation_id::text, 'version', version,
      'status', status, 'statusOriginal', status_original, 'orderLinkage', order_linkage,
      'orderPending', order_pending, 'validadeDias', validade_dias, 'pagamento', pagamento,
      'entrega', entrega, 'fretePadrao', frete_padrao::text, 'frete', frete::text,
      'observacoes', observacoes, 'prazoProducao', prazo_producao,
      'templateKey', template_padrao, 'templateHash', template_hash,
      'templateVersionKey', tv_template.key,
      'templateVersionHash', tv.source_hash,
      'templateVersion', tv.version,
      'sectionsSnapshot', sections_snapshot,
      'subtotal', subtotal::text, 'total', total::text,
      'itemCount', (SELECT count(*) FROM quote_revision_items i WHERE i.revision_id = r.id)
    ) ORDER BY quotation_id, version), '[]'::json)::text
    FROM quote_revisions r
    LEFT JOIN quotation_template_versions tv ON tv.id = r.template_version_id
    LEFT JOIN quotation_templates tv_template ON tv_template.id = tv.template_id`,
    {},
    env
  );
  const items = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'id', id::text, 'revisionId', revision_id::text, 'position', position,
      'productSku', product_sku, 'quantidade', quantidade::text,
      'precoSugerido', preco_sugerido::text, 'precoAplicado', preco_aplicado::text,
      'totalLinha', total_linha::text
    ) ORDER BY revision_id, position), '[]'::json)::text FROM quote_revision_items`,
    {},
    env
  );
  const templates = queryJson(
    service,
    `SELECT COALESCE(json_agg(json_build_object(
      'key', t.key, 'hash', v.source_hash, 'version', v.version
    ) ORDER BY t.key, v.version), '[]'::json)::text
    FROM quotation_templates t INNER JOIN quotation_template_versions v ON v.template_id = t.id`,
    {},
    env
  );
  return {
    allLineage: Array.isArray(allLineage) ? allLineage : [],
    products: Array.isArray(products) ? products : [],
    clients: Array.isArray(clients) ? clients : [],
    quotations: Array.isArray(quotations) ? quotations : [],
    pricingTiers: Array.isArray(pricingTiers) ? pricingTiers : [],
    revisions: Array.isArray(revisions) ? revisions : [],
    items: Array.isArray(items) ? items : [],
    templates: Array.isArray(templates) ? templates : [],
  };
}

export function runReconciliation(args, env = process.env) {
  const service = (args.service || env.CUTOVER_PG_SERVICE || '').trim();
  const serviceFile = (env.PGSERVICEFILE || '').trim();
  const expectedDatabase = (args.expectedDatabase || env.CUTOVER_EXPECTED_DATABASE || '').trim();
  if (!service || !serviceFile || !expectedDatabase)
    fail('CUTOVER_PG_SERVICE, PGSERVICEFILE e database esperado são obrigatórios.');
  assertSecureFile(serviceFile, 'PGSERVICEFILE');
  const serviceTarget = readServiceDatabase(serviceFile, service);
  if (serviceTarget.database !== expectedDatabase)
    fail('Serviço PostgreSQL não corresponde ao database esperado.');
  const output = resolve(args.output);
  outputDirectory(output);
  const dryRun = readJson(args.dryRunReport, 'Report dry-run');
  const apply = readJson(args.applyReport, 'Report apply');
  const sourceManifestHash = validHash(dryRun?.manifest?.manifestHash, 'Hash do dry-run');
  const applyManifestHash = validHash(apply?.manifest?.manifestHash, 'Hash do apply');
  const sourceExpected = expectedReconciliation(dryRun.manifest, 'Dry-run');
  const applyExpected = expectedReconciliation(apply.manifest, 'Apply');
  if (!sameJson(sourceExpected, applyExpected)) fail('Expectativas de reconciliação dry-run/apply divergentes.');
  const approvedApply = stableKeys(apply.approvedDivergenceKeys);
  const comparisonExpected = expectedWithoutApproved(applyExpected, approvedApply);
  const runId = apply?.manifest?.runId;
  if (typeof runId !== 'string' || !UUID_PATTERN.test(runId)) fail('Run ID do apply inválido.');
  if (dryRun?.manifest?.mode !== 'dry-run' || dryRun?.manifest?.status !== 'completed')
    fail('Dry-run não está concluído.');
  if (apply?.manifest?.mode !== 'apply' || apply?.manifest?.status !== 'completed')
    fail('Apply não está concluído.');

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
    if (!Number.isInteger(sourceCounts?.[key]) || sourceCounts[key] < 0)
      fail(`Contagem de origem inválida: ${key}.`);
    if (!Number.isInteger(applyCounts?.[key]) || applyCounts[key] < 0)
      fail(`Contagem de apply inválida: ${key}.`);
  }
  const sourceReadCounts = {
    products: Number(apply.produtos?.lidos || 0),
    pricingTiers: Number(apply.faixas?.lidos || 0),
    clients: Number(apply.clientes?.lidos || 0),
    quotations: Number(apply.orcamentos?.lidos || 0),
  };
  const target = runTargetQueries(service, env);
  const selection = selectedLineageRows(target.allLineage, comparisonExpected);
  const lineageByEntity = {
    products: selection.selected.filter((row) => row.entityType === 'produto'),
    pricingDocuments: selection.selected.filter((row) => row.entityType === 'faixa'),
    clients: selection.selected.filter((row) => row.entityType === 'cliente'),
    quotations: selection.selected.filter((row) => row.entityType === 'orcamento'),
  };
  const productBySku = new Map(target.products.map((row) => [row.sku, row]));
  const products = [];
  let missingIdentities = selection.missing;
  for (const lineage of lineageByEntity.products) {
    const product = productBySku.get(lineage.localKey);
    if (!product) {
      missingIdentities += 1;
      continue;
    }
    products.push(productProjection(lineage, product));
  }
  const pricingSkus = new Set(lineageByEntity.products.map((row) => row.localKey));
  const pricingTiers = target.pricingTiers
    .filter((row) => pricingSkus.has(row.productSku))
    .map((row) => ({
      productSku: row.productSku,
      minimumQuantity: canonicalDecimal(row.minimumQuantity),
      unitPrice: canonicalDecimal(row.unitPrice),
    }));
  const clientById = new Map(target.clients.map((row) => [row.id, row]));
  const clientGroups = new Map();
  for (const lineage of lineageByEntity.clients) {
    const group = clientGroups.get(lineage.localId) || [];
    group.push(lineage);
    clientGroups.set(lineage.localId, group);
  }
  const clients = [];
  for (const [localId, lineages] of clientGroups) {
    const client = clientById.get(localId);
    if (!client) {
      missingIdentities += 1;
      continue;
    }
    clients.push(clientProjection(lineages, client));
  }
  const quotationById = new Map(target.quotations.map((row) => [row.id, row]));
  const quotations = [];
  for (const lineage of lineageByEntity.quotations) {
    const quotation = quotationById.get(lineage.localId);
    if (!quotation) {
      missingIdentities += 1;
      continue;
    }
    // Compare the persisted status. A draft append is accepted by the
    // per-source allowedStatuses check below, never by rewriting target data.
    quotations.push(quotationProjection(lineage, quotation));
  }
  const latestRevisionByQuote = new Map();
  for (const revision of target.revisions) {
    const prior = latestRevisionByQuote.get(revision.quotationId);
    if (!prior || Number(revision.version) > Number(prior.version)) latestRevisionByQuote.set(revision.quotationId, revision);
  }
  const expectedRevisionBySource = new Map(
    comparisonExpected.revisionExpectations.map((row) => [row.sourceId, row])
  );
  const revisions = [];
  const selectedRevisionIds = new Set();
  const sourceIdByRevisionId = new Map();
  let missingSnapshots = 0;
  for (const lineage of lineageByEntity.quotations) {
    const revision = latestRevisionByQuote.get(lineage.localId);
    if (!revision) {
      missingIdentities += 1;
      continue;
    }
    const expectedRevision = expectedRevisionBySource.get(lineage.sourceId);
    if (
      !revision.templateVersionKey ||
      !revision.templateVersionHash ||
      !Number.isInteger(Number(revision.templateVersion)) ||
      !revision.sectionsSnapshot ||
      !expectedRevision ||
      revision.templateVersionKey !== expectedRevision.templateVersionKey ||
      revision.templateVersionHash !== expectedRevision.templateVersionHash ||
      Number(revision.templateVersion) !== Number(expectedRevision.templateVersion) ||
      hash(revision.sectionsSnapshot) !== expectedRevision.sectionsSnapshotHash
    )
      missingSnapshots += 1;
    revisions.push(revisionProjection(lineage.sourceId, revision));
    selectedRevisionIds.add(revision.id);
    sourceIdByRevisionId.set(revision.id, lineage.sourceId);
  }
  const items = target.items
    .filter((item) => selectedRevisionIds.has(item.revisionId))
    .map((item) => itemProjection(sourceIdByRevisionId.get(item.revisionId), item));
  const templatePairs = new Set(revisions.map((row) => `${row.templateKey}:${row.templateHash}`));
  const templates = target.templates
    .filter((row) => templatePairs.has(`${row.key}:${row.hash}`))
    .map((row) => ({ key: row.key, hash: row.hash }))
    .filter((row, index, rows) =>
      rows.findIndex((candidate) => candidate.key === row.key && candidate.hash === row.hash) === index
    );
  const templateVersions = target.templates
    .filter((row) => row.version === 1 && templatePairs.has(`${row.key}:${row.hash}`))
    .map((row) => ({ key: row.key, hash: row.hash, version: Number(row.version) }));
  const lineage = selection.selected.map((row) => ({
    sourceDoctype: row.sourceDoctype,
    sourceId: safeLineageSourceId(row),
    localKey: row.entityType === 'cliente' ? hash(row.localKey) : row.localKey,
    canonicalHash: row.canonicalHash,
    sourceHash: row.sourceHash,
  }));
  const actualHashes = targetHashes({
    products,
    pricingDocuments: lineageByEntity.pricingDocuments.map((row) => ({
      sourceDoctype: row.sourceDoctype,
      sourceId: safeLineageSourceId(row),
      localKey: row.localKey,
      canonicalHash: row.canonicalHash,
      sourceHash: row.sourceHash,
    })),
    pricingTiers,
    clients,
    quotations,
    revisions,
    items,
    templates,
    templateVersions,
    lineage,
  });
  const targetCounts = countRows({ products, pricingDocuments: lineageByEntity.pricingDocuments, pricingTiers, clients, quotations, revisions, items, templates, templateVersions });
  const targetStatusRows = {
    quotations: lineageByEntity.quotations.map((lineage) => ({
      sourceId: lineage.sourceId,
      status: quotationById.get(lineage.localId)?.status,
    })),
    revisions: lineageByEntity.quotations.map((lineage) => ({
      sourceId: lineage.sourceId,
      status: latestRevisionByQuote.get(lineage.localId)?.status,
    })),
  };
  const targetStatusCounts = {
    quotations: statusCounts(targetStatusRows.quotations),
    revisions: statusCounts(targetStatusRows.revisions),
  };
  const lineageInvalid = lineage.filter(
    (row) =>
      row.canonicalHash === null ||
      !HASH_PATTERN.test(String(row.canonicalHash)) ||
      row.sourceHash === null ||
      !HASH_PATTERN.test(String(row.sourceHash))
  ).length;
  const duplicateKeys = selection.duplicate;
  const approvedSource = stableKeys(dryRun.approvedDivergenceKeys);
  const approvedDetails = (apply?.total?.detalhes || []).filter((detail) => detail?.aprovada === true);
  const approvedDetailsValid = approvedApply.every((key) =>
    approvedDetails.some((detail) => `${detail.source_doctype || ''}:${detail.source_id || ''}` === key)
  );
  const unapprovedDivergenceKeys = (apply?.total?.detalhes || [])
    .filter((detail) => detail?.status === 'divergentes' && detail?.aprovada !== true)
    .map((detail) => `${detail.source_doctype || ''}:${detail.source_id || ''}`)
    .filter((key) => key !== ':');
  const blocking = Number(apply?.manifest?.divergenceCounts?.blocking || 0);
  const expected = comparisonExpected;
  const comparison = compareReconciliation({
    sourceCounts,
    applyCounts,
    sourceReadCounts,
    targetCounts,
    expected,
    targetStatusCounts,
    targetStatusRows,
    sourceManifestHash,
    applyManifestHash,
    persistedManifestHash,
    sourceApprovedDivergenceKeys: approvedSource,
    applyApprovedDivergenceKeys: approvedApply,
    approvedDetailsValid,
    unapprovedDivergenceKeys,
    blocking,
    lineageInvalid,
    missingIdentities,
    extraImportedRows: duplicateKeys,
    missingSnapshots,
    expectedHashesMatchTarget: sameJson(actualHashes, expected.hashes),
  });
  const artifact = {
    schemaVersion: 3,
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
      counts: targetCounts,
      hashes: actualHashes,
      statusCounts: targetStatusCounts,
      lineageRows: lineage.length,
      actualRevisionStatuses: statusCounts(target.revisions.filter((row) => selectedRevisionIds.has(row.id))),
    },
    lineage: { selected: lineage.length, invalid: lineageInvalid },
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
