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
  '0030_crazy_black_panther.sql'
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const migrationStatements = migrationSql
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^--[^\n]*\n/, '').trim())
  .filter(Boolean);
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL migration validation must run and may not be silently skipped.';

class RollbackMigration extends Error {}

test('0030 SQL is additive and does not rewrite historical objects', () => {
  const firstLine = migrationSql.split(/\r?\n/).find((line) => line.trim() !== '') || '';
  assert.equal(firstLine, '-- migration-risk: additive');
  assert.equal(migrationSql.includes('CREATE TABLE "quotation_follow_ups"'), true);
  assert.equal(migrationSql.includes('CREATE TABLE "whatsapp_contact_activity"'), true);
  assert.equal(migrationSql.includes('CREATE TABLE "whatsapp_follow_up_ingestion_health"'), true);
  assert.equal(migrationSql.includes('CREATE TABLE "ad_spend_months"'), false);
  assert.equal(migrationSql.includes('custo_unitario'), false);
  assert.equal(migrationSql.includes('aliquota'), false);
  assert.equal(migrationSql.includes('ON DELETE cascade'), false);
  assert.equal(migrationSql.includes('ON DELETE CASCADE'), false);
});

test('0031 expands follow-up queue states as a destructive migration', () => {
  const migrationPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'drizzle',
    '0031_quotation_follow_up_queue_expand.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.equal(sql.split(/\r?\n/).find((line) => line.trim() !== ''), '-- migration-risk: destructive');
  assert.match(sql, /ALTER COLUMN "eligibility_version" DROP NOT NULL/);
  assert.match(sql, /"state" IN \('awaiting_receipt', 'waiting', 'ready', 'held'/);
  assert.match(sql, /"message_snapshot" IS NULL OR/);
  assert.doesNotMatch(sql, /closed_reason.*awaiting_receipt/s);
  assert.match(sql, /DROP CONSTRAINT "quotation_follow_ups_phone_not_blank_check"/);
  assert.match(sql, /lower\(right\(btrim\("provider_conversation_id"\), 4\)\) = '@lid'/);
});

test('0045 adds approval context, its uniqueness guard, and the instance retirement reason', () => {
  const migrationSql = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'drizzle',
      '0045_follow_up_approval_context.sql',
    ),
    'utf8',
  );
  assert.equal(migrationSql.split(/\r?\n/).find((line) => line.trim() !== ''), '-- migration-risk: additive');
  assert.match(migrationSql, /ALTER TABLE "quotation_follow_ups" ADD COLUMN "approved_opportunity_id" uuid/);
  assert.match(migrationSql, /REFERENCES "public"\."crm_deals"\("id"\) ON DELETE restrict/i);
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX "quotation_follow_ups_approved_opportunity_unique"[\s\S]*WHERE "quotation_follow_ups"\."approved_opportunity_id" IS NOT NULL AND "quotation_follow_ups"\."state" IN \('approved', 'processing'\)/,
  );
  assert.match(migrationSql, /DROP CONSTRAINT "quotation_follow_ups_closed_reason_check"/);
  assert.match(migrationSql, /'instance_changed'/);
});

test(
  '0030 creates follow-up tables with restrict FKs and partial unique provider id',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const schemaName = `quotation_follow_up_migration_${process.pid}_${Date.now()}`;

    try {
      await client.begin(async (tx) => {
        await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
        await tx.unsafe(`SET LOCAL search_path TO "${schemaName}"`);
        await tx.unsafe(`CREATE TABLE "quotations" ("id" uuid PRIMARY KEY NOT NULL)`);
        await tx.unsafe(`CREATE TABLE "quote_revisions" ("id" uuid PRIMARY KEY NOT NULL)`);
        await tx.unsafe(`CREATE TABLE "quotation_deliveries" ("id" uuid PRIMARY KEY NOT NULL)`);

        const rewritten = migrationStatements.map((statement) =>
          statement.replaceAll('"public".', `"${schemaName}".`)
        );
        for (const statement of rewritten) await tx.unsafe(statement);


        const tables = await tx.unsafe<{ relname: string }[]>(`
          SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = '${schemaName}'
            AND c.relkind = 'r'
          ORDER BY 1
        `);
        assert.deepEqual(
          tables.map((row) => row.relname),
          [
            'quotation_deliveries',
            'quotation_follow_ups',
            'quotations',
            'quote_revisions',
            'whatsapp_contact_activity',
            'whatsapp_follow_up_ingestion_health',
          ]
        );

        const fks = await tx.unsafe<{ conname: string; confdeltype: string }[]>(`
          SELECT con.conname, con.confdeltype
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = rel.relnamespace
          WHERE n.nspname = '${schemaName}'
            AND rel.relname = 'quotation_follow_ups'
            AND con.contype = 'f'
          ORDER BY 1
        `);
        assert.equal(fks.length, 3);
        assert.ok(
          fks.every((fk) => fk.confdeltype === 'a'),
          'follow-up FKs must be NO ACTION so the audit trail is not cascade-deleted'
        );

        const indexes = await tx.unsafe<{ indexname: string; indexdef: string }[]>(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = '${schemaName}'
          ORDER BY 1
        `);
        const byName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
        assert.match(byName.quotation_follow_ups_quotation_id_unique, /UNIQUE INDEX/i);
        assert.match(
          byName.quotation_follow_ups_provider_message_id_unique,
          /WHERE \(?provider_message_id IS NOT NULL\)?/
        );
        assert.match(
          byName.whatsapp_contact_activity_instance_conversation_unique,
          /UNIQUE INDEX/i
        );

        throw new RollbackMigration();
      });
    } catch (error) {
      if (!(error instanceof RollbackMigration)) throw error;
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);
