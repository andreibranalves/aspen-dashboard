import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import postgres from 'postgres';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
  '0039_quotation_opportunity_link.sql'
);
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL migration validation must run and may not be silently skipped.';

class RollbackMigration extends Error {}

test('0039 is additive and links proposals without touching the legacy pointer', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  const firstLine = migration.split(/\r?\n/).find((line) => line.trim() !== '') || '';
  assert.equal(firstLine, '-- migration-risk: additive');
  assert.equal(migration.includes('ADD COLUMN "opportunity_id"'), true);
  assert.equal(migration.includes('SET "opportunity_id" = d."id"'), true);
  assert.equal(migration.includes('DROP '), false);
  assert.equal(migration.includes('crm_deals" DROP'), false);
});

test(
  '0039 backfills only direct, unambiguous proposal links',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const schemaName = `quotation_opportunity_migration_${process.pid}_${Date.now()}`;

    const unique = '11111111-1111-4111-8111-111111111111';
    const ambiguous = '22222222-2222-4222-8222-222222222222';
    const unlinked = '33333333-3333-4333-8333-333333333333';
    const dealUnique = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const dealAmbiguousA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const dealAmbiguousB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    try {
      await client.begin(async (tx) => {
        await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
        await tx.unsafe(`SET LOCAL search_path TO "${schemaName}"`);
        await tx.unsafe(`CREATE TABLE "crm_deals" (
          "id" uuid PRIMARY KEY NOT NULL,
          "quotation_id" uuid
        )`);
        await tx.unsafe(`CREATE TABLE "quotations" (
          "id" uuid PRIMARY KEY NOT NULL,
          "business_number" varchar(16) NOT NULL
        )`);
        await tx.unsafe(
          `INSERT INTO "quotations" ("id", "business_number") VALUES
             ('${unique}', 'ORC-00000001'),
             ('${ambiguous}', 'ORC-00000002'),
             ('${unlinked}', 'ORC-00000003')`
        );
        await tx.unsafe(
          `INSERT INTO "crm_deals" ("id", "quotation_id") VALUES
             ('${dealUnique}', '${unique}'),
             ('${dealAmbiguousA}', '${ambiguous}'),
             ('${dealAmbiguousB}', '${ambiguous}')`
        );

        const rewritten = readFileSync(migrationPath, 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.replace(/^--[^\n]*\n/, '').trim())
          .filter(Boolean)
          .map((statement) => statement.replaceAll('"public".', `"${schemaName}".`));
        for (const statement of rewritten) await tx.unsafe(statement);

        const columns = await tx.unsafe<{ column_name: string; is_nullable: string }[]>(`
          SELECT column_name, is_nullable
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND table_name = 'quotations'
            AND column_name = 'opportunity_id'
        `);
        assert.equal(columns.length, 1);
        assert.equal(columns[0].column_name, 'opportunity_id');
        assert.equal(columns[0].is_nullable, 'YES');

        const fks = await tx.unsafe<{ conname: string; confdeltype: string }[]>(`
          SELECT con.conname, con.confdeltype
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = rel.relnamespace
          WHERE n.nspname = '${schemaName}' AND rel.relname = 'quotations' AND con.contype = 'f'
        `);
        assert.equal(fks.length, 1, 'the proposal must reference the demand it belongs to');
        assert.equal(
          fks[0].confdeltype,
          'n',
          'removing a demand detaches proposals instead of cascading them away'
        );

        const indexes = await tx.unsafe<{ indexname: string; indexdef: string }[]>(`
          SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = '${schemaName}'
        `);
        const opportunityIndex = indexes.find(
          (row) => row.indexname === 'quotations_opportunity_id_idx'
        );
        assert.ok(opportunityIndex, 'the proposal link must be indexed');
        assert.match(opportunityIndex!.indexdef, /opportunity_id/i);

        const rows = await tx.unsafe<
          { id: string; opportunity_id: string | null }[]
        >(`SELECT id, opportunity_id FROM "quotations" ORDER BY id`);
        const byId = Object.fromEntries(rows.map((row) => [row.id, row.opportunity_id]));
        assert.equal(
          byId[unique],
          dealUnique,
          'a single direct pointer is proven evidence and is backfilled'
        );
        assert.equal(
          byId[ambiguous],
          null,
          'two pointers to the same proposal are ambiguous and must stay unlinked'
        );
        assert.equal(byId[unlinked], null, 'a proposal without a pointer stays unlinked');

        throw new RollbackMigration();
      });
    } catch (error) {
      if (!(error instanceof RollbackMigration)) throw error;
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);
