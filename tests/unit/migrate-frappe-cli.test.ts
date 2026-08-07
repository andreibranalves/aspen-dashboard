import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalHash } from '../../api/_functions/frappe-migration.js';
import { parseArgs, resolveRepositoryMode } from '../../scripts/migrate-frappe-crm.mjs';

describe('CLI de migração Frappe', () => {
  it('exige exatamente um modo', () => {
    assert.deepEqual(parseArgs(['--dry-run']), {
      mode: 'dry-run',
      fixture: null,
      approvedDivergences: [],
    });
    assert.deepEqual(parseArgs(['--apply', '--approve-divergence', 'Quotation:QTN-1']), {
      mode: 'apply',
      fixture: null,
      approvedDivergences: ['Quotation:QTN-1'],
    });
    assert.throws(() => parseArgs([]), /exatamente/);
    assert.throws(() => parseArgs(['--dry-run', '--apply']), /exatamente/);
    for (const value of [':id', 'Doctype:', 'Doctype:id:extra'])
      assert.throws(() => parseArgs(['--dry-run', '--approve-divergence', value]), /source_doctype/);
  });

  it('nunca simula apply com fixture sem DATABASE_URL', () => {
    assert.equal(resolveRepositoryMode({ mode: 'dry-run', hasFixture: true, hasDatabaseUrl: false }), 'memory');
    assert.throws(() => resolveRepositoryMode({ mode: 'apply', hasFixture: true, hasDatabaseUrl: false }), /DATABASE_URL/);
    assert.throws(() => resolveRepositoryMode({ mode: 'apply', hasFixture: false, hasDatabaseUrl: false }), /DATABASE_URL/);
  });

  it('processa JSON válido em dry-run e rejeita fixture malformada sem relatório', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    const valid = spawnSync(process.execPath, [
      'scripts/migrate-frappe-crm.mjs',
      '--dry-run',
      '--fixture',
      'tests/fixtures/frappe-migration-valid.json',
    ], { cwd: root, env, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    const cliReport = JSON.parse(valid.stdout);
    assert.equal(cliReport.modo, 'dry-run');
    assert.equal(Object.prototype.hasOwnProperty.call(cliReport, 'dataset'), false);
    assert.doesNotMatch(valid.stdout, /12345678000190|12\.345\.678\/0001-90/);
    assert.doesNotMatch(valid.stdout, /lead@example\.com/);
    const cliClientIds = cliReport.clientes.detalhes.map((detail) => detail.source_id);
    assert.deepEqual(cliClientIds.sort(), [
      `cliente:${canonicalHash('Customer:12.345.678/0001-90').slice(0, 12)}`,
      `cliente:${canonicalHash('Lead:lead@example.com').slice(0, 12)}`,
    ].sort());

    const invalid = spawnSync(process.execPath, [
      'scripts/migrate-frappe-crm.mjs',
      '--dry-run',
      '--fixture',
      'tests/fixtures/frappe-migration-invalid.json',
    ], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout.trim(), '');
    assert.match(invalid.stderr, /Dataset Frappe inválido/);

    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'frappe-cli-'));
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
            items: [{ idx: 1, item_code: 'SKU-MISSING', qty: '1', rate: '5', price_list_rate: '5', amount: '5' }],
          },
        ],
      })
    );
    try {
      const blocking = spawnSync(process.execPath, [
        'scripts/migrate-frappe-crm.mjs',
        '--dry-run',
        '--fixture',
        blockingFixture,
      ], { cwd: root, env, encoding: 'utf8' });
      assert.equal(blocking.status, 1, blocking.stderr);
      assert.match(blocking.stdout, /divergentes/);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
