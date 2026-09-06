import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseQuotationOriginCandidateArgs } from '../../scripts/quotation-origin-candidates.mjs';

test('candidate report requires explicit read-only mode and a bounded period', () => {
  assert.throws(
    () => parseQuotationOriginCandidateArgs(['--from', '2026-01-01', '--to', '2026-02-01']),
    /--dry-run/,
  );
  const parsed = parseQuotationOriginCandidateArgs([
    '--from', '2026-01-01T00:00:00Z',
    '--to', '2026-02-01T00:00:00Z',
    '--window-days', '3',
    '--dry-run',
  ]);
  assert.equal(parsed.windowDays, 3);
  assert.equal(parsed.from.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(parsed.to.toISOString(), '2026-02-01T00:00:00.000Z');
});
