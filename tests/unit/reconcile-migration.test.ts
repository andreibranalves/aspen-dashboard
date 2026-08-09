import assert from 'node:assert/strict';
import test from 'node:test';

import { compareReconciliation } from '../../scripts/reconcile-migration.mjs';

const counts = { products: 2, pricingTiers: 3, clients: 1, quotations: 1 };
const targetCounts = {
  ...counts,
  revisions: 2,
  items: 3,
  templates: 3,
  templateVersions: 3,
};

test('reconciliação aprova hashes, contagens, lineage e divergências consistentes', () => {
  const result = compareReconciliation({
    sourceCounts: counts,
    applyCounts: counts,
    sourceReadCounts: counts,
    importedCounts: counts,
    targetCounts,
    statusCounts: { quotations: { enviado: 1 }, revisions: { enviado: 2 } },
    sourceManifestHash: 'a'.repeat(64),
    applyManifestHash: 'a'.repeat(64),
    persistedManifestHash: 'a'.repeat(64),
    sourceApprovedDivergenceKeys: [],
    applyApprovedDivergenceKeys: [],
    unapprovedDivergenceKeys: [],
    blocking: 0,
    lineageInvalid: 0,
  });
  assert.equal(result.passed, true);
});

test('reconciliação rejeita hash ou divergência inconsistente', () => {
  const result = compareReconciliation({
    sourceCounts: counts,
    applyCounts: { ...counts, quotations: 0 },
    sourceReadCounts: counts,
    importedCounts: counts,
    targetCounts,
    statusCounts: { quotations: { enviado: 1 }, revisions: { enviado: 2 } },
    sourceManifestHash: 'a'.repeat(64),
    applyManifestHash: 'b'.repeat(64),
    persistedManifestHash: 'b'.repeat(64),
    sourceApprovedDivergenceKeys: [],
    applyApprovedDivergenceKeys: [],
    unapprovedDivergenceKeys: ['Quotation:opaque-id'],
    blocking: 1,
    lineageInvalid: 1,
  });
  assert.equal(result.passed, false);
  assert.equal(result.manifestHashesMatch, false);
  assert.deepEqual(result.unapprovedDivergenceKeys, ['Quotation:opaque-id']);
});
