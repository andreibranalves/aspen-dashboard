import assert from 'node:assert/strict';
import test from 'node:test';
import { findPostgresBoundaryViolations } from '../../scripts/check-postgres-boundary.mjs';

const source = (path: string, content: string) => ({ path, content });

test('rejects direct Drizzle imports in a new module with path and line', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/new-feature.ts',
      "import { eq } from 'drizzle-orm';\nexport const ok = true;\n"
    ),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/new-feature.ts', line: 1, target: 'drizzle-orm' },
  ]);
});

test('rejects Drizzle subpaths even inside allowlisted modules', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/new-feature.ts', "import { eq } from 'drizzle-orm/pg-core';\n"),
    source('api/modules/whatsapp-crm-match.ts', "import { sql } from 'drizzle-orm/pg-core';\n"),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/new-feature.ts', line: 1, target: 'drizzle-orm/pg-core' },
    { path: 'api/modules/whatsapp-crm-match.ts', line: 1, target: 'drizzle-orm/pg-core' },
  ]);
});

test('reports the import token line after leading blank lines', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/new-feature.ts', "\n\nimport { eq } from 'drizzle-orm';\n"),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/new-feature.ts', line: 3, target: 'drizzle-orm' },
  ]);
});

test('rejects comment-spaced static and dynamic imports', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/static-between.ts', "import postgres from /* comment */ 'postgres';\n"),
    source('api/modules/static-before.ts', "/* comment */ import postgres from 'postgres';\n"),
    source('api/modules/dynamic.ts', "import(/* comment */ 'postgres');\n"),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/dynamic.ts', line: 1, target: 'postgres' },
    { path: 'api/modules/static-before.ts', line: 1, target: 'postgres' },
    { path: 'api/modules/static-between.ts', line: 1, target: 'postgres' },
  ]);
});

test('rejects form-feed whitespace in static and dynamic imports', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/static-form-feed.ts', "import\f'postgres';\n"),
    source('api/modules/dynamic-form-feed.ts', "import(\f'postgres');\n"),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/dynamic-form-feed.ts', line: 1, target: 'postgres' },
    { path: 'api/modules/static-form-feed.ts', line: 1, target: 'postgres' },
  ]);
});

test('rejects direct postgres imports and dynamic database imports', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/new-feature.ts', "import postgres from 'postgres';\n"),
    source(
      'api/modules/other-feature.ts',
      "const load = () => import('../infrastructure/db/schema.js');\n"
    ),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/new-feature.ts', line: 1, target: 'postgres' },
    { path: 'api/modules/other-feature.ts', line: 1, target: 'api/infrastructure/db/schema.ts' },
  ]);
});

test('accepts only the current bindings in every allowlisted module', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/operational-status.ts',
      [
        "import { getDatabase } from '../infrastructure/db/client.js';",
        "import { appSettings } from '../infrastructure/db/schema.js';",
        "import { sql } from 'drizzle-orm';",
      ].join('\n')
    ),
    source(
      'api/modules/quotation-preview.ts',
      "import { getDatabase } from '../infrastructure/db/client.js';\n"
    ),
    source(
      'api/modules/whatsapp-crm-match.ts',
      [
        "import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';",
        "import { getDatabase, type AppDatabase } from '../infrastructure/db/client.js';",
        "import { clients, crmDeals, quoteLeads, quoteRevisions, quotations } from '../infrastructure/db/schema.js';",
      ].join('\n')
    ),
  ]);

  assert.deepEqual(violations, []);
});

test('rejects a new binding even inside an allowlisted module', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/quotation-preview.ts',
      "import { getDatabase, createDatabaseConnection } from '../infrastructure/db/client.js';\n"
    ),
  ]);

  assert.deepEqual(violations, [
    {
      path: 'api/modules/quotation-preview.ts',
      line: 1,
      target: 'api/infrastructure/db/client.ts',
    },
  ]);
});

test('accepts repository imports from modules', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/products-core.ts',
      "import { createProductsRepository } from '../infrastructure/db/repositories/products-repository.js';\n"
    ),
  ]);

  assert.deepEqual(violations, []);
});
