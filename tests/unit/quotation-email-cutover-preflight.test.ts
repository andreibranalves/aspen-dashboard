import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateQuotationEmailCutover,
  formatQuotationEmailCutoverPreflight,
} from '../../scripts/quotation-email-cutover-preflight.mjs';

test('email cutover preflight passes only without legacy pending snapshots', () => {
  const result = evaluateQuotationEmailCutover({ legacyPendingCount: 0 });

  assert.deepEqual(result, { ok: true, legacyPendingCount: 0 });
  assert.match(
    formatQuotationEmailCutoverPreflight(result, () => new Date('2026-08-20T12:00:00.000Z')),
    /PASS nenhuma tentativa pendente usa snapshot legado/,
  );
});

test('email cutover preflight blocks when legacy pending snapshots exist', () => {
  const result = evaluateQuotationEmailCutover({ legacyPendingCount: 2 });
  const output = formatQuotationEmailCutoverPreflight(
    result,
    () => new Date('2026-08-20T12:00:00.000Z'),
  );

  assert.deepEqual(result, { ok: false, legacyPendingCount: 2 });
  assert.match(output, /FAIL 2 tentativa\(s\) pendente\(s\) usam snapshot legado/);
  assert.doesNotMatch(output, /cliente@example|<html|public-token/);
});
