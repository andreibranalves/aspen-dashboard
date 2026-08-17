import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import postgres from 'postgres';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
  '0020_quotation_delivery_outbox.sql'
);
const migrationStatements = readFileSync(migrationPath, 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean)
  // Drizzle qualifies foreign-key targets with public; the transaction uses a
  // temporary schema so the same committed statements run without touching it.
  .map((statement) => statement.replace(/"public"\./g, ''));
const migrationSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; PostgreSQL migration validation must run and may not be silently skipped.';

const legacyStates = [
  'pending',
  'transporting',
  'accepted_partial',
  'completed',
  'retryable',
  'reconciling',
] as const;

class RollbackMigration extends Error {}

test(
  '0020 conservatively maps every legacy delivery state without scheduling transport',
  { skip: migrationSkip, concurrency: false },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const schemaName = `quotation_delivery_migration_${process.pid}_${Date.now()}`;

    try {
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
          await tx.unsafe(`SET LOCAL search_path TO "${schemaName}"`);
          await tx.unsafe(`
            CREATE TABLE "quote_revisions" (
              "id" uuid PRIMARY KEY NOT NULL
            )
          `);
          await tx.unsafe(`
            CREATE TABLE "quotation_deliveries" (
              "id" uuid PRIMARY KEY NOT NULL,
              "revision_id" uuid NOT NULL REFERENCES "quote_revisions"("id"),
              "phone" text NOT NULL,
              "flow_id" text NOT NULL,
              "state" text NOT NULL,
              "provider_acceptance_id" text,
              "public_error" text,
              "diagnostics_expires_at" timestamptz,
              "resumable_until" timestamptz,
              "created_at" timestamptz NOT NULL,
              "updated_at" timestamptz NOT NULL,
              CONSTRAINT "quotation_deliveries_revision_id_unique" UNIQUE ("revision_id"),
              CONSTRAINT "quotation_deliveries_state_check" CHECK ("state" IN ('pending', 'transporting', 'accepted_partial', 'completed', 'retryable', 'reconciling'))
            )
          `);

          for (const [index, state] of legacyStates.entries()) {
            const revisionId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
            const deliveryId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
            await tx.unsafe(`INSERT INTO "quote_revisions" ("id") VALUES ('${revisionId}')`);
            await tx.unsafe(
              `INSERT INTO "quotation_deliveries" ("id", "revision_id", "phone", "flow_id", "state", "created_at", "updated_at") VALUES ('${deliveryId}', '${revisionId}', '5511999999999', 'flow-${index + 1}', '${state}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            );
          }

          for (const statement of migrationStatements) await tx.unsafe(statement);

          const rows = await tx.unsafe<
            {
              state: string;
              completion_source: string | null;
              flow_name: string;
              next_attempt_at: Date | null;
              lease_token: string | null;
              lease_until: Date | null;
            }[]
          >(`
            SELECT "state", "completion_source", "flow_name", "next_attempt_at", "lease_token", "lease_until"
            FROM "quotation_deliveries"
            ORDER BY "id"
          `);
          assert.equal(rows.length, legacyStates.length);
          assert.deepEqual(
            rows.map(
              ({
                state,
                completion_source,
                flow_name,
                next_attempt_at,
                lease_token,
                lease_until,
              }) => ({
                state,
                completion_source,
                flow_name,
                next_attempt_at,
                lease_token,
                lease_until,
              })
            ),
            legacyStates.map((legacyState, index) => ({
              state: legacyState === 'completed' ? 'provider_accepted' : 'needs_review',
              completion_source: legacyState === 'completed' ? 'legacy_provider_ack' : null,
              flow_name: `flow-${index + 1}`,
              next_attempt_at: null,
              lease_token: null,
              lease_until: null,
            }))
          );
          assert.ok(
            rows.every(({ state }) => !['queued', 'processing', 'retry_scheduled'].includes(state))
          );

          const stepRows = await tx.unsafe<{ count: string }[]>(
            'SELECT count(*)::text AS count FROM "quotation_delivery_steps"'
          );
          assert.equal(stepRows[0]?.count, '0');
          throw new RollbackMigration();
        });
      } catch (error) {
        if (!(error instanceof RollbackMigration)) throw error;
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);
