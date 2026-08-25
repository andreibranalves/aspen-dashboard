import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  assertQuotationTemplateContractBackfill,
  historicalQuotationTemplateContractVersion,
  verifyQuotationTemplateContractBackfill,
} from '../../api/_modules/quotation-template-contract.js';

function hash(source: string): string {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

test('existing template versions are classified as historical v1', () => {
  assert.equal(historicalQuotationTemplateContractVersion(), 1);
});

test('backfill verification reports only aggregate metadata and source identity', () => {
  const legacySource = '<html>legacy</html>';
  const v2Source = '<html>v2</html>';
  const verification = verifyQuotationTemplateContractBackfill([
    { source: legacySource, sourceHash: hash(legacySource), contractVersion: 1 },
    { source: v2Source, sourceHash: hash(v2Source), contractVersion: 2 },
    { source: 'changed', sourceHash: '0'.repeat(64), contractVersion: 7 },
  ]);

  assert.deepEqual(verification, {
    total: 3,
    historical_v1: 1,
    v2: 1,
    invalid_contract_versions: 1,
    source_hash_mismatches: 1,
  });
  assert.deepEqual(Object.keys(verification).sort(), [
    'historical_v1',
    'invalid_contract_versions',
    'source_hash_mismatches',
    'total',
    'v2',
  ]);
  assert.throws(() => assertQuotationTemplateContractBackfill(verification), /versões inválidas/);
});

test('backfill verification accepts valid v1 and v2 rows', () => {
  const source = '<html>source</html>';
  const verification = verifyQuotationTemplateContractBackfill([
    { source, sourceHash: hash(source), contractVersion: 1 },
    { source, sourceHash: hash(source), contractVersion: 2 },
  ]);

  assert.doesNotThrow(() => assertQuotationTemplateContractBackfill(verification));
});
