import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalHash, runFrappeMigration } from '../../api/_functions/frappe-migration.js';
import {
  assertDatabaseContract,
  parseArgs,
  readPgServiceTarget,
  resolveRepositoryMode,
} from '../../scripts/migrate-frappe-crm.mjs';
import { anonymizeSnapshot } from '../../scripts/anonymize-frappe-snapshot.mjs';

describe('CLI de migração Frappe', () => {
  it('exige exatamente um modo', () => {
    assert.deepEqual(parseArgs(['--dry-run']), {
      mode: 'dry-run',
      fixture: null,
      expectedManifestHash: null,
      approvedDivergences: [],
    });
    const expectedManifestHash = 'a'.repeat(64);
    assert.deepEqual(
      parseArgs([
        '--apply',
        '--expected-manifest-hash',
        expectedManifestHash,
        '--approve-divergence',
        'Quotation:QTN-1',
      ]),
      {
        mode: 'apply',
        fixture: null,
        expectedManifestHash,
        approvedDivergences: ['Quotation:QTN-1'],
      }
    );
    assert.throws(() => parseArgs(['--apply']), /expected-manifest-hash|manifest.*obrigatório/i);
    assert.throws(() => parseArgs([]), /exatamente/);
    assert.throws(() => parseArgs(['--dry-run', '--apply']), /exatamente/);
    assert.throws(
      () => parseArgs(['--apply', '--expected-manifest-hash', 'a'.repeat(64), '--fixture', 'fixture.json']),
      /fixture/i
    );
    for (const value of [':id', 'Doctype:', 'Doctype:id:extra'])
      assert.throws(
        () => parseArgs(['--dry-run', '--approve-divergence', value]),
        /source_doctype/
      );
  });

  it('anonimiza snapshot mantendo relações, estados e determinismo', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'frappe-anonymizer-'));
    const inputPath = path.join(directory, 'input.json');
    const outputPath = path.join(directory, 'output.json');
    const repeatPath = path.join(directory, 'repeat.json');
    const raw = {
      items: [
        { doctype: 'Item', name: 'ITEM-REAL-1', item_code: 'SKU-REAL-1', sku: 'SKU-REAL-1', item: 'SKU-REAL-1', codigo: 'SKU-REAL-1', item_name: 'Produto Real 1' },
        { doctype: 'Item', name: 'ITEM-REAL-2', item_code: 'SKU-REAL-2', sku: 'SKU-REAL-2', item: 'SKU-REAL-2', codigo: 'SKU-REAL-2', item_name: 'Produto Real 2' },
      ],
      pricingRules: [{ doctype: 'Pricing Rule', name: 'PR-REAL-1', item_code: 'SKU-REAL-1', sku: 'SKU-REAL-1', item: 'SKU-REAL-1', codigo: 'SKU-REAL-1', minimum_quantity: 10, quantidade_minima: 10, unit_price: '5.00', price: '5.00', preco: '5.00', valor: '5.00', price_list_rate: '5.00', workflow_state: 'Enabled' }],
      itemPrices: [{ doctype: 'Item Price', name: 'IP-REAL-1', item_code: 'SKU-REAL-2', sku: 'SKU-REAL-2', item: 'SKU-REAL-2', codigo: 'SKU-REAL-2', price_list_rate: '7.00' }],
      customers: [{
        doctype: 'Customer',
        name: 'CUST-REAL-1',
        customer_name: 'Empresa Real Ltda',
        tax_id: '12.345.678/0001-90',
        email_id: 'financeiro@empresa-real.example',
        phone: '+55 11 99999-0001',
        address_line1: 'Rua Real, 123',
        contacts: ['financeiro@empresa-real.example', 'CUST-REAL-1'],
        numeric_ids: [123456789],
        numeric_secret: 987654321,
        apiKey: 123456,
        api_token: 'secret-token-must-disappear',
      }],
      leads: [{
        doctype: 'Lead',
        name: 'LEAD-REAL-1',
        lead_name: 'Pessoa Real',
        tax_id: '987.654.321-00',
        email_id: 'lead.real@example.com',
        mobile_no: '+55 11 98888-0002',
      }],
      quotations: [
        {
          doctype: 'Quotation', name: 'QTN-REAL-1', creation: '2024-01-02 10:00:00', quotation_to: 'Customer', party_type: 'Customer', customer: 'CUST-REAL-1', linked_customer: 'CUST-REAL-1',
          party: 'CUST-REAL-1', party_name: 'CUST-REAL-1', quotation_id: 'QTN-REAL-1', status: 'Submitted', workflow_state: 'Submitted', subtotal: '10.00', grand_total: '10.00', frete: '0.00',
          pdf_checksum_sha256: 'ab'.repeat(32), pdf_size_bytes: 1024,
          references: ['QTN-REAL-1', 456789],
          items: [{ doctype: 'Quotation Item', idx: 1, item_code: 'SKU-REAL-1', sku: 'SKU-REAL-1', item: 'SKU-REAL-1', codigo: 'SKU-REAL-1', item_name: 'Produto Real 1', qty: '2', quantidade: '2', unit_price: '5.00', price: '5.00', preco: '5.00', valor: '5.00', preco_sugerido: '5.00', preco_aplicado: '5.00', total_linha: '10.00', rate: '5.00', price_list_rate: '5.00', amount: '10.00' }],
          legacy_payload: { authorization: 'Bearer raw-secret' },
        },
        {
          doctype: 'Quotation', name: 'QTN-REAL-2', creation: '2025-02-03 11:00:00', party_type: 'Lead', linked_lead: 'LEAD-REAL-1', lead: 'LEAD-REAL-1', party_name: 'LEAD-REAL-1', status: 'Draft', workflow_state: 'Draft',
          items: [{ doctype: 'Quotation Item', idx: 1, item_code: 'SKU-REAL-2', sku: 'SKU-REAL-2', item: 'SKU-REAL-2', codigo: 'SKU-REAL-2', item_name: 'Produto Real 2', qty: '3', quantidade: '3', unit_price: '7.00', price: '7.00', preco: '7.00', valor: '7.00', preco_sugerido: '7.00', preco_aplicado: '7.00', total_linha: '21.00', rate: '7.00', price_list_rate: '7.00', amount: '21.00' }],
        },
      ],
    };
    writeFileSync(inputPath, JSON.stringify(raw));
    try {
      const first = anonymizeSnapshot(raw, 'test-salt');
      const second = anonymizeSnapshot(raw, 'test-salt');
      assert.deepEqual(first, second);
      assert.equal(first.customers?.length, 1);
      assert.equal(first.leads?.length, 1);
      assert.equal(first.items.length, 2);
      assert.equal(first.quotations?.length, 2);
      assert.equal(first.customers?.[0]?.name, first.quotations?.[0]?.customer);
      assert.equal(first.customers?.[0]?.name, first.quotations?.[0]?.linked_customer);
      assert.equal(first.customers?.[0]?.name, first.quotations?.[0]?.party);
      assert.equal(first.customers?.[0]?.name, first.quotations?.[0]?.party_name);
      assert.equal(first.leads?.[0]?.name, first.quotations?.[1]?.linked_lead);
      assert.equal(first.leads?.[0]?.name, first.quotations?.[1]?.lead);
      assert.equal(first.leads?.[0]?.name, first.quotations?.[1]?.party_name);
      assert.equal(first.items[0]?.item_code, first.items[0]?.sku);
      assert.equal(first.items[0]?.item_code, first.items[0]?.item);
      assert.equal(first.items[0]?.item_code, first.items[0]?.codigo);
      assert.equal(first.items[0]?.item_code, first.quotations?.[0]?.items?.[0]?.item_code);
      assert.equal(first.items[0]?.item_code, first.quotations?.[0]?.items?.[0]?.sku);
      assert.equal(first.items[0]?.item_code, first.quotations?.[0]?.items?.[0]?.item);
      assert.equal(first.items[0]?.item_code, first.quotations?.[0]?.items?.[0]?.codigo);
      assert.equal(first.items[1]?.item_code, first.quotations?.[1]?.items?.[0]?.item_code);
      assert.equal(first.items[1]?.item_code, first.quotations?.[1]?.items?.[0]?.sku);
      assert.equal(first.pricingRules?.[0]?.item_code, first.items[0]?.item_code);
      assert.equal(first.pricingRules?.[0]?.sku, first.items[0]?.item_code);
      assert.equal(first.pricingRules?.[0]?.item, first.items[0]?.item_code);
      assert.equal(first.pricingRules?.[0]?.codigo, first.items[0]?.item_code);
      assert.equal(first.itemPrices?.[0]?.item_code, first.items[1]?.item_code);
      assert.equal(first.quotations?.[0]?.doctype, 'Quotation');
      assert.equal(first.quotations?.[0]?.quotation_id, first.quotations?.[0]?.name);
      assert.equal(first.quotations?.[0]?.status, 'Submitted');
      assert.equal(first.quotations?.[0]?.workflow_state, 'Submitted');
      assert.equal(first.quotations?.[0]?.party_type, 'Customer');
      assert.equal(first.quotations?.[1]?.party_type, 'Lead');
      assert.equal(first.quotations?.[0]?.creation, '2024-01-02 10:00:00');
      assert.equal(first.quotations?.[0]?.pdf_checksum_sha256, 'ab'.repeat(32));
      assert.equal(first.quotations?.[0]?.subtotal, '10.00');
      assert.equal(first.quotations?.[0]?.frete, '0.00');
      assert.equal(first.quotations?.[0]?.items?.[0]?.unit_price, '5.00');
      assert.equal(first.quotations?.[0]?.items?.[0]?.preco_sugerido, '5.00');
      assert.equal(first.quotations?.[0]?.items?.[0]?.total_linha, '10.00');
      assert.notEqual(first.customers?.[0]?.contacts?.[0], 'financeiro@empresa-real.example');
      assert.notEqual(first.customers?.[0]?.contacts?.[1], 'CUST-REAL-1');
      assert.notEqual(first.customers?.[0]?.numeric_ids?.[0], 123456789);
      assert.equal(Object.prototype.hasOwnProperty.call(first.customers?.[0] || {}, 'apiKey'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(first.customers?.[0] || {}, 'numeric_secret'), false);
      const serialized = JSON.stringify(first);
      for (const rawValue of [
        'CUST-REAL-1', 'LEAD-REAL-1', 'ITEM-REAL-1', 'SKU-REAL-1', 'QTN-REAL-1',
        '12.345.678/0001-90', '987.654.321-00', 'Empresa Real Ltda', 'Pessoa Real',
        'financeiro@empresa-real.example', 'lead.real@example.com', '+55 11 99999-0001',
        '+55 11 98888-0002', 'Rua Real, 123', 'secret-token-must-disappear', 'Bearer raw-secret',
      ]) assert.equal(serialized.includes(rawValue), false, `raw value leaked: ${rawValue}`);
      assert.equal(Object.prototype.hasOwnProperty.call(first.customers?.[0] || {}, 'api_token'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(first.quotations?.[0] || {}, 'legacy_payload'), false);

      const result = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', inputPath, '--output', outputPath],
        { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), env: { ...process.env, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      const artifact = JSON.parse(readFileSync(outputPath, 'utf8'));
      assert.deepEqual(artifact, first);
      assert.equal(statSync(outputPath).mode & 0o777, 0o600);

      const repeat = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', inputPath, '--output', repeatPath],
        { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), env: { ...process.env, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.equal(repeat.status, 0, repeat.stderr);
      assert.deepEqual(JSON.parse(readFileSync(repeatPath, 'utf8')), artifact);

      const migrationEnv = { ...process.env };
      delete migrationEnv.DATABASE_URL;
      delete migrationEnv.TEST_DATABASE_URL;
      const dryRun = spawnSync(
        process.execPath,
        ['scripts/migrate-frappe-crm.mjs', '--dry-run', '--fixture', outputPath],
        { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), env: migrationEnv, encoding: 'utf8' }
      );
      assert.equal(dryRun.status, 0, dryRun.stderr);
      const report = JSON.parse(dryRun.stdout);
      assert.equal(report.manifest.status, 'completed');
      assert.deepEqual(report.manifest.entityCounts, { products: 2, pricingTiers: 2, clients: 2, quotations: 2 });
      assert.doesNotMatch(dryRun.stdout, /CUST-REAL|LEAD-REAL|ITEM-REAL|SKU-REAL|QTN-REAL|financeiro@|secret-token/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserva aliases camelCase, title fallback e números de quotation sem colisão', () => {
    const raw = {
      items: [{ sourceId: 'ITEM-ALIAS-1', itemCode: 'SKU-ALIAS-1', itemName: 'Produto Alias' }],
      pricingRules: [
        { sourceId: 'PR-TITLE-1', title: 'SKU-ALIAS-1-10', rate: '5.00' },
        { sourceId: 'PR-RULE-TITLE-1', rule_title: 'SKU-ALIAS-1-20', rate: '4.00' },
      ],
      customers: [{ name: 'CUST-ALIAS-1', customer_name: 'Cliente Alias' }],
      leads: [{ name: 'LEAD-ALIAS-1', lead_name: 'Lead Alias' }],
      quotations: [{
        sourceId: 'QTN-2024-ALIAS-1',
        creation: '2024-04-05 10:00:00',
        status: 'Draft',
        quotation_to: 'Customer',
        party_type: 'Lead',
        customer: 'CUST-ALIAS-1',
        party_name: 'CUST-ALIAS-1',
        items: [{ itemCode: 'SKU-ALIAS-1', item_code: 'SKU-ALIAS-1', qty: '2', price_list_rate: '5.00', rate: '5.00', amount: '10.00' }],
      }],
    };
    const anonymized = anonymizeSnapshot(raw, 'alias-salt');
    const item = anonymized.items[0];
    const quotation = anonymized.quotations[0];
    assert.notEqual(item.sourceId, item.itemCode);
    assert.equal(item.itemCode, anonymized.pricingRules[0].title.replace(/-10$/, ''));
    assert.equal(item.itemCode, anonymized.pricingRules[1].rule_title.replace(/-20$/, ''));
    assert.equal(quotation.sourceId.match(/^QTN-2024-\d{4}$/)?.[0], quotation.sourceId);
    assert.equal(quotation.quotation_to, 'Customer');
    assert.equal(quotation.party_type, 'Lead');
    assert.equal(quotation.party_name, anonymized.customers[0].name);
    assert.equal(quotation.items[0].itemCode, item.itemCode);

    const aliasDirectory = mkdtempSync(path.join(tmpdir(), 'frappe-alias-dry-run-'));
    const aliasInput = path.join(aliasDirectory, 'input.json');
    const aliasOutput = path.join(aliasDirectory, 'output.json');
    const aliasRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    writeFileSync(aliasInput, JSON.stringify(raw));
    try {
      const anonymizer = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', aliasInput, '--output', aliasOutput],
        { cwd: aliasRoot, env: { ...process.env, FRAPPE_SNAPSHOT_SALT: 'alias-salt' }, encoding: 'utf8' }
      );
      assert.equal(anonymizer.status, 0, anonymizer.stderr);
      const dryRun = spawnSync(
        process.execPath,
        ['scripts/migrate-frappe-crm.mjs', '--dry-run', '--fixture', aliasOutput],
        { cwd: aliasRoot, env: { ...process.env, DATABASE_URL: '', TEST_DATABASE_URL: '' }, encoding: 'utf8' }
      );
      assert.equal(dryRun.status, 0, dryRun.stderr);
      assert.equal(JSON.parse(dryRun.stdout).manifest.status, 'completed');
    } finally {
      rmSync(aliasDirectory, { recursive: true, force: true });
    }

    const legacyBucket = (sourceId: string): number => Number(
      BigInt(`0x${createHash('sha256').update(`alias-salt\\0quotation-sequence\\0${sourceId}`).digest('hex').slice(0, 12)}`) % 9000n
    );
    const buckets = new Map<number, string>();
    let collision: [string, string] | null = null;
    for (let index = 0; index < 20000 && !collision; index += 1) {
      const sourceId = `QTN-2024-COLLIDE-${index}`;
      const bucket = legacyBucket(sourceId);
      const prior = buckets.get(bucket);
      if (prior) collision = [prior, sourceId];
      else buckets.set(bucket, sourceId);
    }
    assert.ok(collision, 'fixture must contain an otherwise-colliding pair');
    const collisionDataset = {
      items: [],
      quotations: collision!.map((sourceId) => ({ sourceId, creation: '2024-06-01 10:00:00' })),
    };
    const collisionA = anonymizeSnapshot(collisionDataset, 'alias-salt');
    const collisionB = anonymizeSnapshot(collisionDataset, 'alias-salt');
    assert.deepEqual(collisionA, collisionB);
    assert.notEqual(collisionA.quotations[0].sourceId, collisionA.quotations[1].sourceId);
    assert.match(collisionA.quotations[0].sourceId, /^QTN-2024-\d{4}$/);
    assert.match(collisionA.quotations[1].sourceId, /^QTN-2024-\d{4}$/);
  });

  it('rejeita erro dinâmico de fixture sem ecoar conteúdo não confiável', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'frappe-dynamic-fixture-'));
    const fixturePath = path.join(directory, 'throws.mjs');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    writeFileSync(fixturePath, "throw new Error('Fixture Frappe inválida: /secret/path?token=real-secret')\n");
    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/migrate-frappe-crm.mjs', '--dry-run', '--fixture', fixturePath],
        { cwd: root, env: { ...process.env, DATABASE_URL: '', TEST_DATABASE_URL: '' }, encoding: 'utf8' }
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Arquivo de fixture|Falha ao processar migração|Fixture Frappe inválida/);
      assert.doesNotMatch(result.stderr, /secret\/path|real-secret/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejeita shape inválido antes de gerar snapshot', () => {
    const invalidSnapshots = [
      null,
      [],
      {},
      { items: 'invalid' },
      { items: [], customers: {} },
      { items: [null] },
      { items: ['scalar'] },
      { items: [], leads: [42] },
    ];
    for (const snapshot of invalidSnapshots) {
      assert.throws(() => anonymizeSnapshot(snapshot as any, 'test-salt'), /Snapshot Frappe inválido/);
    }
  });

  it('sanitiza erros de caminho, salt, shape e argumento sem tocar output', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'frappe-anonymizer-errors-'));
    const inputPath = path.join(directory, 'input.json');
    const malformedPath = path.join(directory, 'malformed.json');
    const outputPath = path.join(directory, 'output.json');
    const missingPath = path.join(directory, 'missing-secret-input.json');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const baseEnv = { ...process.env };
    delete baseEnv.DATABASE_URL;
    delete baseEnv.TEST_DATABASE_URL;
    writeFileSync(inputPath, JSON.stringify({ items: [] }));
    writeFileSync(malformedPath, '{ malformed');
    try {
      const missingSalt = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', inputPath, '--output', outputPath],
        { cwd: root, env: baseEnv, encoding: 'utf8' }
      );
      assert.notEqual(missingSalt.status, 0);
      assert.match(missingSalt.stderr, /FRAPPE_SNAPSHOT_SALT/);
      assert.equal(missingSalt.stderr.includes(inputPath), false);

      const unknownOption = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', inputPath, '--token=real-secret', '--output', outputPath],
        { cwd: root, env: { ...baseEnv, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.notEqual(unknownOption.status, 0);
      assert.match(unknownOption.stderr, /Opção ou caminho inválido|Uso:/);
      assert.doesNotMatch(unknownOption.stderr, /real-secret|input\.json|output\.json/);

      const missingInput = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', missingPath, '--output', outputPath],
        { cwd: root, env: { ...baseEnv, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.notEqual(missingInput.status, 0);
      assert.match(missingInput.stderr, /Arquivo de entrada/);
      assert.doesNotMatch(missingInput.stderr, /missing-secret-input|output\.json/);

      const malformed = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', malformedPath, '--output', outputPath],
        { cwd: root, env: { ...baseEnv, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.notEqual(malformed.status, 0);
      assert.match(malformed.stderr, /JSON do snapshot inválido/);
      assert.doesNotMatch(malformed.stderr, /malformed\.json|output\.json/);

      const samePath = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', inputPath, '--output', inputPath],
        { cwd: root, env: { ...baseEnv, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.notEqual(samePath.status, 0);
      assert.match(samePath.stderr, /Input e output/);
      assert.doesNotMatch(samePath.stderr, /input\.json/);

      writeFileSync(outputPath, 'do-not-touch');
      const existing = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', inputPath, '--output', outputPath],
        { cwd: root, env: { ...baseEnv, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.notEqual(existing.status, 0);
      assert.match(existing.stderr, /já existe/);
      assert.equal(readFileSync(outputPath, 'utf8'), 'do-not-touch');

      const invalidShapePath = path.join(directory, 'invalid-shape.json');
      writeFileSync(invalidShapePath, JSON.stringify({ items: 'not-a-list' }));
      const invalidShape = spawnSync(
        process.execPath,
        ['scripts/anonymize-frappe-snapshot.mjs', '--input', invalidShapePath, '--output', outputPath],
        { cwd: root, env: { ...baseEnv, FRAPPE_SNAPSHOT_SALT: 'test-salt' }, encoding: 'utf8' }
      );
      assert.notEqual(invalidShape.status, 0);
      assert.match(invalidShape.stderr, /Snapshot Frappe inválido/);
      assert.equal(readFileSync(outputPath, 'utf8'), 'do-not-touch');

      const migrationUnknown = spawnSync(
        process.execPath,
        ['scripts/migrate-frappe-crm.mjs', '--token=real-secret'],
        { cwd: root, env: baseEnv, encoding: 'utf8' }
      );
      assert.notEqual(migrationUnknown.status, 0);
      assert.match(migrationUnknown.stderr, /Falha ao processar migração|Opção desconhecida/);
      assert.doesNotMatch(migrationUnknown.stderr, /real-secret/);

      const migrationMissingFixture = spawnSync(
        process.execPath,
        ['scripts/migrate-frappe-crm.mjs', '--dry-run', '--fixture', missingPath],
        { cwd: root, env: baseEnv, encoding: 'utf8' }
      );
      assert.notEqual(migrationMissingFixture.status, 0);
      assert.match(migrationMissingFixture.stderr, /Arquivo de fixture|Falha ao processar migração/);
      assert.doesNotMatch(migrationMissingFixture.stderr, /missing-secret-input/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('valida host, porta e database do serviço libpq real sem aceitar outro destino', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pg-service-'));
    const serviceFile = path.join(directory, 'pg_service.conf');
    writeFileSync(
      serviceFile,
      '[cutover-quotes]\nhost=db.example\nport=5433\ndbname=quotes\n'
    );
    const base = {
      DATABASE_URL: 'postgresql://api-user@db.example:5433/quotes',
      CUTOVER_PG_SERVICE: 'cutover-quotes',
      PGSERVICEFILE: serviceFile,
      PGPASSFILE: path.join(directory, 'pgpass'),
      TEST_DATABASE_URL: 'postgresql://api-user@db.example:5433/staging',
      RESTORE_DATABASE_URL: 'postgresql://api-user@db.example:5433/restore',
    };
    try {
      assert.deepEqual(readPgServiceTarget(base), {
        host: 'db.example',
        port: '5433',
        database: 'quotes',
      });
      assert.doesNotThrow(() => assertDatabaseContract(base));
      assert.throws(
        () => assertDatabaseContract({ ...base, DATABASE_URL: 'postgresql://api-user@other.example:5433/quotes' }),
        /mesmo destino/
      );
      assert.throws(
        () => assertDatabaseContract({ ...base, DATABASE_URL: 'postgresql://api-user@db.example:5432/quotes' }),
        /mesmo destino/
      );
      assert.throws(
        () => assertDatabaseContract({ ...base, DATABASE_URL: 'postgresql://api-user@db.example:5433/other' }),
        /mesmo destino/
      );
      assert.throws(
        () => assertDatabaseContract({ ...base, PGSERVICEFILE: path.join(directory, 'missing.conf') }),
        /PGSERVICEFILE/
      );
      assert.throws(
        () => assertDatabaseContract({ ...base, TEST_DATABASE_URL: base.DATABASE_URL }),
        /TEST_DATABASE_URL.*mesmo destino/
      );
      assert.throws(
        () => assertDatabaseContract({ ...base, RESTORE_DATABASE_URL: base.DATABASE_URL }),
        /RESTORE_DATABASE_URL.*mesmo destino/
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exige manifest hash de apply antes de abrir o repository', async () => {
    let repositoryPropertyReads = 0;
    const repository = new Proxy(
      {},
      {
        get() {
          repositoryPropertyReads += 1;
          return async () => undefined;
        },
      }
    );

    await assert.rejects(
      () =>
        runFrappeMigration({
          mode: 'apply',
          dataset: {},
          repository,
        }),
      /expected-manifest-hash|manifest.*obrigatório/i
    );
    assert.equal(repositoryPropertyReads, 0);
  });

  it('rejeita manifest hash não-string sem chamar trim ou repository', async () => {
    let repositoryPropertyReads = 0;
    const repository = new Proxy(
      {},
      {
        get() {
          repositoryPropertyReads += 1;
          return async () => undefined;
        },
      }
    );
    const invalidValues: unknown[] = [42, { trim: () => 'a'.repeat(64) }];

    for (const expectedManifestHash of invalidValues) {
      await assert.rejects(
        () =>
          runFrappeMigration({
            mode: 'apply',
            dataset: {},
            expectedManifestHash: expectedManifestHash as any,
            repository,
          }),
        /expected-manifest-hash|manifest.*obrigatório/i
      );
    }
    assert.equal(repositoryPropertyReads, 0);
  });

  it('rejeita manifest hash divergente antes de abrir o repository', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dataset = JSON.parse(
      readFileSync(path.resolve(root, 'tests/fixtures/frappe-migration-valid.json'), 'utf8')
    );
    let repositoryPropertyReads = 0;
    const repository = new Proxy(
      {},
      {
        get() {
          repositoryPropertyReads += 1;
          return async () => undefined;
        },
      }
    );

    await assert.rejects(
      () =>
        runFrappeMigration({
          mode: 'apply',
          dataset,
          expectedManifestHash: '0'.repeat(64),
          repository,
        }),
      /Manifesto revisado não corresponde ao snapshot atual|manifest/i
    );
    assert.equal(repositoryPropertyReads, 0);
  });

  it('nunca simula apply com fixture sem DATABASE_URL', () => {
    assert.equal(
      resolveRepositoryMode({ mode: 'dry-run', hasFixture: true, hasDatabaseUrl: false }),
      'memory'
    );
    assert.throws(
      () => resolveRepositoryMode({ mode: 'apply', hasFixture: true, hasDatabaseUrl: false }),
      /fixture/i
    );
    assert.throws(
      () => resolveRepositoryMode({ mode: 'apply', hasFixture: false, hasDatabaseUrl: false }),
      /DATABASE_URL/
    );
  });

  it('processa JSON válido em dry-run e rejeita fixture malformada sem relatório', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    const valid = spawnSync(
      process.execPath,
      [
        'scripts/migrate-frappe-crm.mjs',
        '--dry-run',
        '--fixture',
        'tests/fixtures/frappe-migration-valid.json',
      ],
      { cwd: root, env, encoding: 'utf8' }
    );
    assert.equal(valid.status, 0, valid.stderr);
    const cliReport = JSON.parse(valid.stdout);
    assert.equal(cliReport.modo, 'dry-run');
    assert.equal(cliReport.manifest.mode, 'dry-run');
    assert.match(cliReport.manifest.manifestHash, /^[0-9a-f]{64}$/);
    assert.equal(cliReport.manifest.status, 'completed');
    assert.deepEqual(cliReport.approvedDivergenceKeys, []);
    assert.equal(Object.prototype.hasOwnProperty.call(cliReport, 'dataset'), false);
    assert.doesNotMatch(valid.stdout, /12345678000190|12\.345\.678\/0001-90/);
    assert.doesNotMatch(valid.stdout, /lead@example\.com/);
    const cliClientIds = cliReport.clientes.detalhes.map((detail) => detail.source_id);
    assert.deepEqual(
      cliClientIds.sort(),
      [
        `cliente-${canonicalHash('Customer:12.345.678/0001-90').slice(0, 12)}`,
        `cliente-${canonicalHash('Lead:lead@example.com').slice(0, 12)}`,
      ].sort()
    );
    const reportApprovalKeys = cliReport.clientes.detalhes
      .map((detail: { source_doctype?: string; source_id?: string }) => `${detail.source_doctype}:${detail.source_id}`)
      .sort();
    assert.deepEqual(reportApprovalKeys, [
      `Customer:cliente-${canonicalHash('Customer:12.345.678/0001-90').slice(0, 12)}`,
      `Lead:cliente-${canonicalHash('Lead:lead@example.com').slice(0, 12)}`,
    ].sort());
    const roundTrip = spawnSync(
      process.execPath,
      [
        'scripts/migrate-frappe-crm.mjs',
        '--dry-run',
        '--fixture',
        'tests/fixtures/frappe-migration-valid.json',
        '--approve-divergence',
        reportApprovalKeys[0],
        '--approve-divergence',
        reportApprovalKeys[1],
      ],
      { cwd: root, env, encoding: 'utf8' }
    );
    assert.equal(roundTrip.status, 0, roundTrip.stderr);
    const roundTripReport = JSON.parse(roundTrip.stdout);
    assert.deepEqual(roundTripReport.approvedDivergenceKeys.sort(), reportApprovalKeys);
    assert.doesNotMatch(roundTrip.stdout, /12\.345\.678|0001-90|lead@example\.com/);

    const invalid = spawnSync(
      process.execPath,
      [
        'scripts/migrate-frappe-crm.mjs',
        '--dry-run',
        '--fixture',
        'tests/fixtures/frappe-migration-invalid.json',
      ],
      { cwd: root, env, encoding: 'utf8' }
    );
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout.trim(), '');
    assert.match(invalid.stderr, /Dataset Frappe inválido/);

    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'frappe-cli-'));
    const scalarFixture = path.join(temporaryDirectory, 'scalar.json');
    writeFileSync(scalarFixture, '[]');
    const scalar = spawnSync(
      process.execPath,
      ['scripts/migrate-frappe-crm.mjs', '--dry-run', '--fixture', scalarFixture],
      { cwd: root, env, encoding: 'utf8' }
    );
    assert.notEqual(scalar.status, 0);
    assert.match(scalar.stderr, /Fixture Frappe inválida/);
    const blockingFixture = path.join(temporaryDirectory, 'blocking.json');
    writeFileSync(
      blockingFixture,
      JSON.stringify({
        items: [],
        customers: [],
        quotations: [
          {
            name: 'QTN-2025-00099',
            creation: '2025-01-01 10:00:00',
            quotation_to: 'Customer',
            customer: 'MISSING',
            status: 'Draft',
            items: [
              {
                idx: 1,
                item_code: 'SKU-MISSING',
                qty: '1',
                rate: '5',
                price_list_rate: '5',
                amount: '5',
              },
            ],
          },
        ],
      })
    );
    try {
      const blocking = spawnSync(
        process.execPath,
        ['scripts/migrate-frappe-crm.mjs', '--dry-run', '--fixture', blockingFixture],
        { cwd: root, env, encoding: 'utf8' }
      );
      assert.equal(blocking.status, 1, blocking.stderr);
      assert.match(blocking.stdout, /divergentes/);

      const approved = spawnSync(
        process.execPath,
        [
          'scripts/migrate-frappe-crm.mjs',
          '--dry-run',
          '--fixture',
          blockingFixture,
          '--approve-divergence',
          'Quotation:QTN-2025-00099',
          '--approve-divergence',
          'Quotation:QTN-2025-00099',
        ],
        { cwd: root, env, encoding: 'utf8' }
      );
      assert.equal(approved.status, 0, approved.stderr);
      const approvedReport = JSON.parse(approved.stdout);
      assert.deepEqual(approvedReport.approvedDivergenceKeys, ['Quotation:QTN-2025-00099']);
      assert.equal(approvedReport.manifest.divergenceCounts.blocking, 0);
      assert.equal(approvedReport.total.aprovadas, 1);
      assert.equal(approvedReport.total.detalhes[0].aprovada, true);

      const unknownApproval = spawnSync(
        process.execPath,
        [
          'scripts/migrate-frappe-crm.mjs',
          '--dry-run',
          '--fixture',
          blockingFixture,
          '--approve-divergence',
          'Unknown:secret-value',
        ],
        { cwd: root, env, encoding: 'utf8' }
      );
      assert.notEqual(unknownApproval.status, 0);
      assert.match(unknownApproval.stderr, /chave de aprovação inválida/i);
      assert.doesNotMatch(unknownApproval.stderr, /Unknown|secret-value/);
      assert.doesNotMatch(unknownApproval.stdout, /Unknown|secret-value/);

      const applyWithFixture = spawnSync(
        process.execPath,
        [
          'scripts/migrate-frappe-crm.mjs',
          '--apply',
          '--expected-manifest-hash',
          'a'.repeat(64),
        ],
        {
          cwd: root,
          env: { ...env, FRAPPE_MIGRATION_FIXTURE: 'tests/fixtures/frappe-migration-valid.json' },
          encoding: 'utf8',
        }
      );
      assert.notEqual(applyWithFixture.status, 0);
      assert.match(applyWithFixture.stderr, /FRAPPE_MIGRATION_FIXTURE|fixture/i);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
