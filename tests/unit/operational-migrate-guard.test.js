import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOperationalMigrateApproved } from '../../scripts/lib/operational-migrate-guard.mjs';

const target = 'postgresql://op:x@127.0.0.1:5432/aspen_stage';

test('operational migrate guard requires approval proof and target URL', () => {
  assert.equal(
    assertOperationalMigrateApproved({
      MIGRATE_APPLY_APPROVED: '1',
      MIGRATION_TARGET_DATABASE_URL: target,
    }),
    target,
  );
  for (const env of [
    {},
    { MIGRATION_TARGET_DATABASE_URL: target },
    { MIGRATE_APPLY_APPROVED: '1' },
    { MIGRATE_APPLY_APPROVED: 'true', MIGRATION_TARGET_DATABASE_URL: target },
    { MIGRATE_APPLY_APPROVED: '1', MIGRATION_TARGET_DATABASE_URL: '  ' },
  ]) {
    assert.throws(() => assertOperationalMigrateApproved(env), /migrate:apply/);
  }
});
