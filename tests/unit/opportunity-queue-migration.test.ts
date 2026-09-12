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
  '0037_opportunity_queue.sql'
);
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL migration validation must run and may not be silently skipped.';

class RollbackMigration extends Error {}

test('0037 is additive and leaves the legacy follow-up queue untouched', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const firstLine = sql.split(/\r?\n/).find((line) => line.trim() !== '') || '';
  assert.equal(firstLine, '-- migration-risk: additive');
  assert.equal(sql.includes('CREATE TABLE "opportunity_next_actions"'), true);
  assert.equal(sql.includes('"demand_summary"'), true);
  assert.equal(sql.includes('quotation_follow_ups'), false);
  assert.equal(sql.includes('DROP '), false);
});

test(
  '0037 enforces one active primary action per opportunity and preserves history',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const schemaName = `opportunity_queue_migration_${process.pid}_${Date.now()}`;

    try {
      await client.begin(async (tx) => {
        await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
        await tx.unsafe(`SET LOCAL search_path TO "${schemaName}"`);
        await tx.unsafe(`CREATE TABLE "clients" ("id" uuid PRIMARY KEY NOT NULL)`);
        await tx.unsafe(
          `CREATE TABLE "quote_leads" ("id" uuid PRIMARY KEY NOT NULL, "source" varchar(80) DEFAULT 'typebot' NOT NULL)`
        );
        await tx.unsafe(
          `CREATE TABLE "crm_deals" (
            "id" uuid PRIMARY KEY NOT NULL,
            "quote_lead_id" uuid REFERENCES "quote_leads"("id"),
            "client_id" uuid REFERENCES "clients"("id")
          )`
        );

        const rewritten = readFileSync(migrationPath, 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.replace(/^--[^\n]*\n/, '').trim())
          .filter(Boolean)
          .map((statement) => statement.replaceAll('"public".', `"${schemaName}".`));
        for (const statement of rewritten) await tx.unsafe(statement);

        const tables = await tx.unsafe<{ relname: string }[]>(`
          SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = '${schemaName}' AND c.relkind = 'r'
          ORDER BY 1
        `);
        assert.deepEqual(
          tables.map((row) => row.relname),
          ['clients', 'crm_deals', 'opportunity_next_actions', 'quote_leads']
        );

        const columns = await tx.unsafe<{ column_name: string; is_nullable: string }[]>(`
          SELECT column_name, is_nullable
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND table_name = 'opportunity_next_actions'
          ORDER BY 1
        `);
        assert.deepEqual(
          columns.map((row) => row.column_name),
          [
            'created_at',
            'due_at',
            'id',
            'kind',
            'opportunity_id',
            'origin',
            'reason_code',
            'state',
            'updated_at',
          ]
        );
        assert.ok(
          columns.every((row) => row.is_nullable === 'NO'),
          'every action column is mandatory'
        );

        const dealColumns = await tx.unsafe<{ column_name: string }[]>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND table_name = 'crm_deals'
          ORDER BY 1
        `);
        assert.ok(dealColumns.some((row) => row.column_name === 'demand_summary'));

        const leadColumns = await tx.unsafe<{ column_name: string; is_nullable: string }[]>(`
          SELECT column_name, is_nullable
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND table_name = 'quote_leads'
          ORDER BY 1
        `);
        assert.deepEqual(
          leadColumns.find((row) => row.column_name === 'demand_id'),
          { column_name: 'demand_id', is_nullable: 'YES' },
          'the explicit demand identity is additive and optional'
        );

        const fks = await tx.unsafe<{ conname: string; confdeltype: string }[]>(`
          SELECT con.conname, con.confdeltype
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = rel.relnamespace
          WHERE n.nspname = '${schemaName}'
            AND rel.relname = 'opportunity_next_actions'
            AND con.contype = 'f'
        `);
        assert.equal(fks.length, 1, 'the action must reference the opportunity it belongs to');
        assert.equal(
          fks[0].confdeltype,
          'r',
          'ON DELETE RESTRICT preserves action history instead of cascading it away'
        );

        const indexes = await tx.unsafe<{ indexname: string; indexdef: string }[]>(`
          SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = '${schemaName}' ORDER BY 1
        `);
        const byName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
        assert.match(byName.opportunity_next_actions_active_unique, /UNIQUE INDEX/i);
        assert.match(
          byName.opportunity_next_actions_active_unique,
          /WHERE .*state.*=.*'active'/i,
          'only the active action is unique per opportunity'
        );
        assert.match(byName.opportunity_next_actions_state_due_idx, /state.*due_at/i);
        assert.match(byName.opportunity_next_actions_opportunity_idx, /opportunity_id/i,
          'history lookup by opportunity must stay indexed without a cascade');
        assert.ok(
          indexes.some(
            (row) =>
              row.indexname === 'quote_leads_demand_id_idx' &&
              /demand_id/i.test(row.indexdef) &&
              /source/i.test(row.indexdef)
          ),
          'the explicit demand lookup must be indexed by source and demand_id'
        );

        const checks = await tx.unsafe<{ conname: string; definition: string }[]>(`
          SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = rel.relnamespace
          WHERE n.nspname = '${schemaName}' AND rel.relname = 'opportunity_next_actions'
            AND con.contype = 'c'
          ORDER BY 1
        `);
        const checkDefinitions = Object.fromEntries(
          checks.map((row) => [row.conname, row.definition])
        );
        for (const name of [
          'opportunity_next_actions_kind_check',
          'opportunity_next_actions_origin_check',
          'opportunity_next_actions_state_check',
          'opportunity_next_actions_reason_not_blank_check',
        ]) {
          assert.ok(checkDefinitions[name], `${name} must exist`);
        }
        assert.match(checkDefinitions.opportunity_next_actions_kind_check, /first_contact/);
        assert.match(checkDefinitions.opportunity_next_actions_state_check, /superseded/);
        assert.match(checkDefinitions.opportunity_next_actions_origin_check, /automatic/);

        const opportunityId = '11111111-1111-4111-8111-111111111111';
        await tx.unsafe(`INSERT INTO "crm_deals" ("id") VALUES ('${opportunityId}')`);
        const insertAction = (id: string, state: string) =>
          `INSERT INTO "opportunity_next_actions"
             ("id", "opportunity_id", "kind", "reason_code", "origin", "state", "due_at", "created_at", "updated_at")
           VALUES ('${id}', '${opportunityId}', 'first_contact', 'new_lead', 'automatic', '${state}', now(), now(), now())`;

        await tx.unsafe(insertAction('22222222-2222-4222-8222-222222222222', 'active'));
        await assert.rejects(
          () =>
            tx.savepoint(async (sp) => {
              await sp.unsafe(insertAction('33333333-3333-4333-8333-333333333333', 'active'));
            }),
          /opportunity_next_actions_active_unique/,
          'a second active primary action must be rejected'
        );

        await tx.unsafe(
          `UPDATE "opportunity_next_actions" SET "state" = 'superseded' WHERE "id" = '22222222-2222-4222-8222-222222222222'`
        );
        await tx.unsafe(insertAction('44444444-4444-4444-8444-444444444444', 'active'));

        const history = await tx.unsafe<{ state: string }[]>(
          `SELECT "state" FROM "opportunity_next_actions" ORDER BY "created_at", "id"`
        );
        assert.deepEqual(
          history.map((row) => row.state).sort(),
          ['active', 'superseded'],
          'the replaced action stays as history'
        );

        await assert.rejects(
          () =>
            tx.savepoint(async (sp) => {
              await sp.unsafe(insertAction('55555555-5555-4555-8555-555555555555', 'waiting'));
            }),
          /opportunity_next_actions_state_check/,
          'unknown action states must be rejected'
        );

        await assert.rejects(
          () =>
            tx.savepoint(async (sp) => {
              await sp.unsafe(`DELETE FROM "crm_deals" WHERE "id" = '${opportunityId}'`);
            }),
          /opportunity_next_actions_opportunity_id_crm_deals_id_fk|violates foreign key/i,
          'removing the opportunity is blocked while action history exists'
        );
        const preserved = await tx.unsafe<{ total: string; states: string }[]>(
          `SELECT count(*)::text AS total,
                  coalesce(string_agg("state", ',' ORDER BY "state"), '') AS states
           FROM "opportunity_next_actions"`
        );
        assert.equal(
          preserved[0].total,
          '2',
          'the RESTRICT constraint keeps the immutable action history'
        );
        assert.equal(
          preserved[0].states,
          'active,superseded',
          'every historical state survives the blocked removal'
        );

        throw new RollbackMigration();
      });
    } catch (error) {
      if (!(error instanceof RollbackMigration)) throw error;
    } finally {
      await client.end({ timeout: 5 });
    }

    const verifier = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const [row] = await verifier.unsafe<{ schema: string | null }[]>(
        `SELECT to_regnamespace('${schemaName}')::text AS schema`
      );
      assert.equal(row.schema, null, 'the migration replay must roll back');
    } finally {
      await verifier.end({ timeout: 5 });
    }
  }
);
