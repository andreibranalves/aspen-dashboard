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
