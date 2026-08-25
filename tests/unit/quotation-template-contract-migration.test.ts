import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import postgres from 'postgres';
import {
  assertQuotationTemplateContractBackfill,
  verifyQuotationTemplateContractBackfill,
} from '../../api/_modules/quotation-template-contract.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
  '0023_quotation_template_contracts.sql'
);
const migrationStatements = readFileSync(migrationPath, 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL migration validation must run and may not be silently skipped.';

class RollbackMigration extends Error {}

function sourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

test(
  '0023 upgrades pre-contract template versions to deterministic v1 metadata and enforces the contract constraint',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const schemaName = `quotation_template_contract_${process.pid}_${Date.now()}`;
    const legacyRows = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        templateId: '10000000-0000-4000-8000-000000000001',
        source: '<html><body>legacy-one</body></html>',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        templateId: '10000000-0000-4000-8000-000000000002',
        source: '<html><body>legacy-two</body></html>',
      },
    ];

    try {
      try {
        // Match the repository migration harness: isolate the schema and roll
        // back the whole upgrade so no shared database state is retained.
        await client.begin(async (tx) => {
          await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
          await tx.unsafe(`SET LOCAL search_path TO "${schemaName}"`);
          await tx.unsafe(`
            CREATE TABLE "quotation_templates" (
              "id" uuid PRIMARY KEY NOT NULL,
              "key" varchar(120) NOT NULL
            )
          `);
          await tx.unsafe(`
            CREATE TABLE "quotation_template_versions" (
              "id" uuid PRIMARY KEY NOT NULL,
              "template_id" uuid NOT NULL,
              "version" integer NOT NULL,
              "source" text NOT NULL,
              "source_hash" varchar(64) NOT NULL,
              "created_at" timestamptz NOT NULL DEFAULT now()
            )
          `);

          for (const row of legacyRows) {
            await tx`
              INSERT INTO quotation_templates ${tx({ id: row.templateId, key: `legacy-${row.id.slice(-1)}` })}
            `;
            await tx`
              INSERT INTO quotation_template_versions ${tx({
                id: row.id,
                template_id: row.templateId,
                version: 1,
                source: row.source,
                source_hash: sourceHash(row.source),
              })}
            `;
          }

          const before = await tx<{ column_name: string }[]>`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ${schemaName}
              AND table_name = 'quotation_template_versions'
              AND column_name = 'contract_version'
          `;
          assert.equal(before.length, 0);

          for (const statement of migrationStatements) await tx.unsafe(statement);

          const rows = await tx<
            { source: string; source_hash: string; contract_version: number }[]
          >`
            SELECT source, source_hash, contract_version
            FROM quotation_template_versions
            ORDER BY id
          `;
          assert.deepEqual(
            rows.map(({ contract_version }) => contract_version),
            [1, 1]
          );
          const verification = verifyQuotationTemplateContractBackfill(
            rows.map((row) => ({
              source: row.source,
              sourceHash: row.source_hash,
              contractVersion: row.contract_version,
            }))
          );
          assert.deepEqual(verification, {
            total: 2,
            historical_v1: 2,
            v2: 0,
            invalid_contract_versions: 0,
            source_hash_mismatches: 0,
          });
          assertQuotationTemplateContractBackfill(verification);

          const metadata = await tx<
            { is_nullable: string; column_default: string | null; data_type: string }[]
          >`
            SELECT is_nullable, column_default, data_type
            FROM information_schema.columns
            WHERE table_schema = ${schemaName}
              AND table_name = 'quotation_template_versions'
              AND column_name = 'contract_version'
          `;
          assert.equal(metadata.length, 1);
          assert.deepEqual(
            { ...metadata[0] },
            { is_nullable: 'NO', column_default: '1', data_type: 'integer' }
          );

          const defaultId = '00000000-0000-4000-8000-000000000003';
          await tx`
            INSERT INTO quotation_template_versions ${tx({
              id: defaultId,
              template_id: legacyRows[0].templateId,
              version: 2,
              source: '<html><body>defaulted</body></html>',
              source_hash: sourceHash('<html><body>defaulted</body></html>'),
            })}
          `;
          const [defaultRow] = await tx<{ contract_version: number }[]>`
            SELECT contract_version
            FROM quotation_template_versions
            WHERE id = ${defaultId}
          `;
          assert.equal(defaultRow?.contract_version, 1);

          await assert.rejects(
            () =>
              tx.savepoint(async (savepoint) => {
                await savepoint`
                  INSERT INTO quotation_template_versions ${savepoint({
                    id: '00000000-0000-4000-8000-000000000004',
                    template_id: legacyRows[0].templateId,
                    version: 3,
                    source: '<html><body>invalid</body></html>',
                    source_hash: sourceHash('<html><body>invalid</body></html>'),
                    contract_version: 3,
                  })}
                `;
              }),
            /quotation_template_versions_contract_version_check/
          );

          throw new RollbackMigration();
        });
      } catch (error) {
        if (!(error instanceof RollbackMigration)) throw error;
      }

      const rollbackRows = await client<{ schema_name: string | null }[]>`
        SELECT to_regnamespace(${schemaName})::text AS schema_name
      `;
      assert.equal(rollbackRows[0]?.schema_name, null);
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);
