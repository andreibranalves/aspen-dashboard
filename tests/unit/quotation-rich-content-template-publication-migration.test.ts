import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import postgres from 'postgres';

import { QUOTATION_TEMPLATES } from '../../api/_modules/quotation-template-catalog.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
  '0028_quotation_rich_content_templates.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const migrationStatements = migrationSql
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
const templateKeys = ['padrao', 'minimalista', 'branded', 'comparativo', 'simples'] as const;
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required for PostgreSQL migration validation.';

class RollbackMigration extends Error {}

function hash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

test('0028 embeds the exact rich-content catalog sources without mutating historical versions', () => {
  assert.equal(migrationStatements.length, templateKeys.length);
  assert.doesNotMatch(migrationSql, /\b(?:UPDATE|DELETE)\b/i);

  for (const key of templateKeys) {
    const template = QUOTATION_TEMPLATES.find((candidate) => candidate.key === key);
    assert.ok(template);
    const delimiter = `$quotation_${key}_content_v4$`;
    const sourceStart = migrationSql.indexOf(delimiter);
    const sourceMarker = `${delimiter}, '`;
    const sourceEnd = migrationSql.indexOf(sourceMarker, sourceStart + delimiter.length);
    assert.notEqual(sourceStart, -1, `migration source for ${key}`);
    assert.notEqual(sourceEnd, -1, `migration hash for ${key}`);
    const embeddedSource = migrationSql.slice(sourceStart + delimiter.length, sourceEnd);
    const embeddedHash = migrationSql.slice(sourceEnd + sourceMarker.length, sourceEnd + sourceMarker.length + 64);
    assert.equal(embeddedSource, template.source);
    assert.equal(embeddedHash, template.hash);
    assert.equal(hash(embeddedSource), embeddedHash);
    assert.equal(migrationSql.split(embeddedHash).length - 1, 2, `insert and idempotency hash for ${key}`);
  }
});

test(
  '0028 appends one idempotent rich-content version per template on disposable PostgreSQL',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const schema = `quotation_rich_content_${process.pid}_${Date.now()}`;

    try {
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(`CREATE SCHEMA "${schema}"`);
          await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
          await tx.unsafe(`
            CREATE TABLE quotation_templates (
              id uuid PRIMARY KEY,
              key varchar(120) NOT NULL UNIQUE,
              name varchar(255) NOT NULL,
              archived boolean NOT NULL DEFAULT false
            )
          `);
          await tx.unsafe(`
            CREATE TABLE quotation_template_versions (
              id uuid PRIMARY KEY,
              template_id uuid NOT NULL,
              version integer NOT NULL,
              source text NOT NULL,
              source_hash varchar(64) NOT NULL,
              contract_version integer NOT NULL,
              UNIQUE (template_id, version),
              UNIQUE (template_id, source_hash)
            )
          `);

          for (let index = 0; index < templateKeys.length; index += 1) {
            const key = templateKeys[index];
            const template = QUOTATION_TEMPLATES.find((candidate) => candidate.key === key)!;
            const templateId = `a1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
            const versionId = `a2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
            const oldSource = `<html><body>generic-${key}</body></html>`;
            await tx`
              INSERT INTO quotation_templates (id, key, name)
              VALUES (${templateId}::uuid, ${key}, ${template.name})
            `;
            await tx`
              INSERT INTO quotation_template_versions
                (id, template_id, version, source, source_hash, contract_version)
              VALUES (${versionId}::uuid, ${templateId}::uuid, 1, ${oldSource}, ${hash(oldSource)}, 2)
            `;
          }

          for (const statement of migrationStatements) await tx.unsafe(statement);
          for (const statement of migrationStatements) await tx.unsafe(statement);

          const rows = await tx<
            {
              key: string;
              version: number;
              source: string;
              source_hash: string;
              contract_version: number;
            }[]
          >`
            SELECT t.key, v.version, v.source, v.source_hash, v.contract_version
            FROM quotation_templates t
            INNER JOIN quotation_template_versions v ON v.template_id = t.id
            ORDER BY t.key, v.version
          `;
          assert.equal(rows.length, templateKeys.length * 2);
          for (const key of templateKeys) {
            const versions = rows.filter((row) => row.key === key);
            const template = QUOTATION_TEMPLATES.find((candidate) => candidate.key === key)!;
            assert.deepEqual(versions.map((row) => row.version), [1, 2]);
            assert.match(versions[0].source, new RegExp(`generic-${key}`));
            assert.equal(versions[1].source, template.source);
            assert.equal(versions[1].source_hash, template.hash);
            assert.equal(versions[1].contract_version, 2);
          }

          throw new RollbackMigration();
        });
      } catch (error) {
        if (!(error instanceof RollbackMigration)) throw error;
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  },
);
