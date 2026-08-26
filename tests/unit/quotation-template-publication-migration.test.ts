import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import postgres from 'postgres';

import { QUOTATION_TEMPLATES } from '../../api/_modules/quotation-template-catalog.js';
import {
  assertQuotationCompanyBackfill,
  DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
  verifyQuotationCompanyBackfill,
} from '../../api/_modules/quotation-company.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
  '0025_quotation_company_publication.sql'
);
const migrationStatements = readFileSync(migrationPath, 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
const seedStatements = migrationStatements.slice(3);
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL migration validation must run and may not be silently skipped.';

class RollbackMigration extends Error {}

function sourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

// 0025 is immutable: its v2 rows are intentionally tested against the
// hashes published by that migration, not the newer visual versions in the
// runtime catalog.
const OFFICIAL_V2_MIGRATION_HASHES = new Map([
  ['padrao', 'ac72b75b66ac7e190d80ce9fda24bd77188d39394ffac18a3d756f2ef0b4c38a'],
  ['minimalista', 'bc2dbc33ff7792ff90c96bea293e6855560bdd330c0b46a41f0d61b7cc7aab47'],
  ['branded', '9cdd38836f5fb0ef8d56bee43abbb4da4506d84b2ac364ff4f7d7fb7f09cd66c'],
  ['comparativo', 'abac432292ccc6a6818c12a0995a8367e0d7a1f72f49523ea6e0793f210e5b24'],
  ['simples', 'df30255bfb82aa561b1cf690ca2462c4fbd981f69661846fb2477560ff91bc42'],
]);

function schemaName(suffix: string): string {
  return `quotation_template_publication_${process.pid}_${Date.now()}_${suffix}`;
}

async function createFixture(
  tx: postgres.TransactionSql,
  name: string,
  legacy: boolean
): Promise<void> {
  await tx.unsafe(`CREATE SCHEMA "${name}"`);
  await tx.unsafe(`SET LOCAL search_path TO "${name}"`);
  await tx.unsafe(`
    CREATE TABLE "app_settings" (
      "singleton_id" integer PRIMARY KEY,
      "company_configuration" jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await tx.unsafe(`
    CREATE TABLE "quote_revisions" (
      "id" uuid PRIMARY KEY,
      "company_snapshot" jsonb
    )
  `);
  await tx.unsafe(`
    CREATE TABLE "quotation_templates" (
      "id" uuid PRIMARY KEY,
      "key" varchar(120) NOT NULL UNIQUE,
      "name" varchar(255) NOT NULL,
      "archived" boolean NOT NULL DEFAULT false
    )
  `);
  await tx.unsafe(`
    CREATE TABLE "quotation_template_versions" (
      "id" uuid PRIMARY KEY,
      "template_id" uuid NOT NULL,
      "version" integer NOT NULL,
      "source" text NOT NULL,
      "source_hash" varchar(64) NOT NULL,
      "contract_version" integer NOT NULL DEFAULT 1,
      UNIQUE ("template_id", "version"),
      UNIQUE ("template_id", "source_hash")
    )
  `);
  await tx`
    INSERT INTO app_settings (singleton_id, company_configuration)
    VALUES (1, ${JSON.stringify({ schema_version: 1 })}::jsonb)
  `;
  await tx`
    INSERT INTO quote_revisions (id, company_snapshot)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      ${JSON.stringify(DEFAULT_QUOTATION_COMPANY_CONFIGURATION)}::jsonb
    )
  `;

  if (!legacy) return;
  for (let index = 0; index < QUOTATION_TEMPLATES.length; index += 1) {
    const template = QUOTATION_TEMPLATES[index];
    const templateId = `a1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const versionId = `a2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const source = `<html><body>legacy-${template.key}</body></html>`;
    await tx`
      INSERT INTO quotation_templates (id, key, name, archived)
      VALUES (${templateId}::uuid, ${template.key}, ${template.name}, false)
    `;
    await tx`
      INSERT INTO quotation_template_versions
        (id, template_id, version, source, source_hash, contract_version)
      VALUES
        (${versionId}::uuid, ${templateId}::uuid, 1, ${source}, ${sourceHash(source)}, 1)
    `;
  }
}

function parseJsonb(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

async function officialRows(tx: postgres.TransactionSql) {
  return tx<
    {
      key: string;
      version: number;
      source_hash: string;
      contract_version: number;
    }[]
  >`
    SELECT t.key, v.version, v.source_hash, v.contract_version
    FROM quotation_templates t
    INNER JOIN quotation_template_versions v ON v.template_id = t.id
    ORDER BY t.key, v.version
  `;
}

test(
  '0025 publishes all official v2 versions on fresh and upgraded databases idempotently',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const freshName = schemaName('fresh');
    const upgradedName = schemaName('upgraded');

    try {
      try {
        await client.begin(async (tx) => {
          await createFixture(tx, freshName, false);
          for (const statement of migrationStatements) await tx.unsafe(statement);
          for (const statement of seedStatements) await tx.unsafe(statement);

          const freshRows = await officialRows(tx);
          assert.equal(freshRows.length, QUOTATION_TEMPLATES.length);
          const freshSnapshots = await tx<{ company_snapshot: unknown }[]>`
            SELECT company_snapshot FROM quote_revisions
          `;
          const freshVerification = verifyQuotationCompanyBackfill(
            freshSnapshots.map((row) => parseJsonb(row.company_snapshot))
          );
          assert.equal(freshVerification.total, 1);
          assert.equal(freshVerification.valid_snapshots, 1);
          assertQuotationCompanyBackfill(freshVerification);
          assert.deepEqual(
            freshRows.map((row) => [row.key, row.version, row.contract_version]),
            QUOTATION_TEMPLATES.map((template) => [template.key, 1, 2]).sort(([left], [right]) =>
              left.localeCompare(right)
            )
          );
          for (const row of freshRows) {
            const template = QUOTATION_TEMPLATES.find((candidate) => candidate.key === row.key);
            assert.equal(row.source_hash, OFFICIAL_V2_MIGRATION_HASHES.get(template?.key));
          }

          await tx.unsafe(`SET LOCAL search_path TO "${upgradedName}"`);
          await createFixture(tx, upgradedName, true);
          for (const statement of migrationStatements) await tx.unsafe(statement);
          for (const statement of seedStatements) await tx.unsafe(statement);

          const upgradedRows = await officialRows(tx);
          assert.equal(upgradedRows.length, QUOTATION_TEMPLATES.length * 2);
          for (const template of QUOTATION_TEMPLATES) {
            const rows = upgradedRows.filter((row) => row.key === template.key);
            assert.deepEqual(
              rows.map((row) => row.version),
              [1, 2]
            );
            assert.deepEqual(
              rows.map((row) => row.contract_version),
              [1, 2]
            );
            assert.equal(rows[1]?.source_hash, OFFICIAL_V2_MIGRATION_HASHES.get(template.key));
          }
          const [snapshotColumn] = await tx<
            {
              is_nullable: string;
            }[]
          >`
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_schema = ${upgradedName}
              AND table_name = 'quote_revisions'
              AND column_name = 'company_snapshot'
          `;
          assert.equal(snapshotColumn?.is_nullable, 'NO');
          const [settingsColumn] = await tx<
            {
              column_default: string | null;
              is_nullable: string;
            }[]
          >`
            SELECT column_default, is_nullable
            FROM information_schema.columns
            WHERE table_schema = ${upgradedName}
              AND table_name = 'app_settings'
              AND column_name = 'settings_version'
          `;
          assert.deepEqual(settingsColumn, { column_default: '1', is_nullable: 'NO' });
          await assert.rejects(
            () =>
              tx.savepoint(async (savepoint) => {
                await savepoint`
                  INSERT INTO quote_revisions (id, company_snapshot)
                  VALUES ('00000000-0000-4000-8000-000000000002', NULL)
                `;
              }),
            /company_snapshot_not_null|not-null/i
          );

          throw new RollbackMigration();
        });
      } catch (error) {
        if (!(error instanceof RollbackMigration)) throw error;
      }

      const remaining = await client<{ schema_name: string | null }[]>`
        SELECT nspname AS schema_name
        FROM pg_namespace
        WHERE nspname = ${freshName} OR nspname = ${upgradedName}
      `;
      assert.equal(remaining.length, 0);
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);
