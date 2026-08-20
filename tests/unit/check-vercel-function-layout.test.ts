import assert from 'node:assert/strict';
import test from 'node:test';
import { findVercelFunctionViolations } from '../../scripts/check-vercel-function-layout.mjs';

test('accepts the catch-all and every private API directory', () => {
  assert.deepEqual(
    findVercelFunctionViolations([
      'api/[...path].ts',
      'api/_modules/products.ts',
      'api/_infrastructure/db/schema.ts',
      'api/_infrastructure/db/repositories/products-repository.mts',
      'api/_app/routes.ts',
      'api/_http/types.cts',
      'api/_shared/auth.mjs',
      'api/_private.ts',
      'api/types.d.ts',
      'api/README.md',
    ]),
    []
  );
});

test('rejects public function files and lists only invalid paths', () => {
  const violations = findVercelFunctionViolations([
    'api/modules/example.ts',
    'api/health.ts',
    'api/infrastructure/db/client.mts',
    'api/legacy.cjs',
    'api/types.d.ts',
    'api/_modules/products.ts',
  ]);

  assert.deepEqual(violations, [
    'api/health.ts',
    'api/infrastructure/db/client.mts',
    'api/legacy.cjs',
    'api/modules/example.ts',
  ]);
  assert.equal(
    violations.join('\n'),
    [
      'api/health.ts',
      'api/infrastructure/db/client.mts',
      'api/legacy.cjs',
      'api/modules/example.ts',
    ].join('\n')
  );
});
