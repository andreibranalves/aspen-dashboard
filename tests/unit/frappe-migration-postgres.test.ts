import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { createPostgresFrappeMigrationRepository } from '../../api/_db/frappe-migration-repository.js';
import * as schema from '../../api/_db/schema.js';
import { runFrappeMigration } from '../../api/_functions/frappe-migration.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

test('PostgreSQL importação aplica atomicamente, é idempotente e preserva linhagem', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sku = `MIGRATION-${suffix}`;
  const itemId = `ITEM-${suffix}`;
  const priceId = `PR-${suffix}`;
  const triggerName = `migration_fail_${suffix.replace(/[^a-z0-9_]/gi, '_')}`;
  const functionName = `${triggerName}_fn`;
  const dataset = {
    items: [{ name: itemId, item_code: sku, item_name: 'Produto PG' }],
    pricingRules: [{ name: priceId, item_code: sku, min_qty: 30, price_list_rate: '9.00' }],
    itemPrices: [],
    customers: [],
    leads: [],
  };
  try {
    await migrate(db, { migrationsFolder });
    const repository = createPostgresFrappeMigrationRepository(() => db);
    const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(first.report.produtos.criados, 1);
    assert.equal(first.report.faixas.criados, 1);
    const rerun = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(rerun.report.produtos.ignorados, 1);
    assert.equal(rerun.report.faixas.ignorados, 1);
    const lineageBefore = await db.select().from(schema.frappeImportLineage);
    assert.ok(lineageBefore.some((row) => row.sourceId === itemId));

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'migration trigger failure'; END; $$;
      CREATE TRIGGER ${triggerName} BEFORE INSERT ON product_pricing_tiers
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);
    try {
      const failed = await runFrappeMigration({ mode: 'apply', dataset: {
        ...dataset,
        items: [{ name: itemId, item_code: sku, item_name: 'Produto PG atualizado' }],
      }, repository });
      assert.equal(failed.report.produtos.criados, 0);
      assert.equal(failed.report.produtos.atualizados, 0);
      assert.equal(failed.report.produtos.erros, 1);
      assert.equal(failed.report.faixas.erros, 1);
      const state = await repository.loadState();
      assert.equal(state.products.find((row) => row.sku === sku)?.nome, 'Produto PG');
    } finally {
      await client.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON product_pricing_tiers; DROP FUNCTION IF EXISTS ${functionName}();`);
    }
  } finally {
    await client.unsafe('DELETE FROM frappe_import_lineage WHERE source_id LIKE $1', [`%${suffix}`]);
    await client.unsafe('DELETE FROM product_pricing_tiers WHERE product_sku LIKE $1', [`%${suffix}`]);
    await client.unsafe('DELETE FROM products WHERE sku LIKE $1', [`%${suffix}`]);
    await client.end({ timeout: 5 });
  }
});
