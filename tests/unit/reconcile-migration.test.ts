import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { compareReconciliation } from '../../scripts/reconcile-migration.mjs';

const reconcileSource = readFileSync(new URL('../../scripts/reconcile-migration.mjs', import.meta.url), 'utf8');
const cutoverRunbook = readFileSync(
  new URL('../../docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md', import.meta.url),
  'utf8'
);

test('reconciliação envia SQL por stdin para expandir variáveis psql com segurança', () => {
  assert.match(reconcileSource, /args\.push\('--file', '-'\)/);
  assert.match(reconcileSource, /input: `\$\{sql\}\\n`/);
  assert.doesNotMatch(reconcileSource, /args\.push\('--command', sql\)/);

  const persistedQueries = cutoverRunbook.match(
    /--variable=run_id="\$RUN_ID"[\s\S]{0,450}/g
  ) || [];
  assert.equal(persistedQueries.length, 2);
  for (const query of persistedQueries) {
    assert.doesNotMatch(query, /--command|(?:^|\s)-c\s/);
    assert.match(query, /--file -[\s\S]*<<'SQL'/);
  }
});

const counts = { products: 2, pricingTiers: 3, clients: 1, quotations: 1 };
const targetCounts = {
  ...counts,
  revisions: 2,
  items: 3,
  templates: 3,
  templateVersions: 3,
};
const expectedCounts = {
  products: 2,
  pricingDocuments: 3,
  pricingTiers: 3,
  clients: 1,
  quotations: 1,
  revisions: 2,
  items: 3,
  templates: 1,
  templateVersions: 1,
};
const expectedHashes = Object.fromEntries(
  Object.keys(expectedCounts).map((key) => [key, 'a'.repeat(64)])
);
const expected = {
  counts: expectedCounts,
  hashes: expectedHashes,
  statusCounts: { quotations: { enviado: 1 }, revisions: { enviado: 2 } },
};
const targetImportedCounts = { ...expectedCounts };
const targetHashes = { ...expectedHashes };

function baseInput(overrides = {}) {
  return {
    sourceCounts: counts,
    applyCounts: counts,
    sourceReadCounts: counts,
    importedCounts: counts,
    targetCounts,
    targetImportedCounts,
    expected,
    targetHashes,
    statusCounts: expected.statusCounts,
    targetStatusCounts: expected.statusCounts,
    sourceManifestHash: 'a'.repeat(64),
    applyManifestHash: 'a'.repeat(64),
    persistedManifestHash: 'a'.repeat(64),
    sourceApprovedDivergenceKeys: [],
    applyApprovedDivergenceKeys: [],
    approvedDetailsValid: true,
    unapprovedDivergenceKeys: [],
    blocking: 0,
    lineageInvalid: 0,
    ...overrides,
  };
}

test('reconciliação aprova hashes, contagens, lineage e divergências consistentes', () => {
  const result = compareReconciliation(baseInput());
  assert.equal(result.passed, true);
});

test('reconciliação aceita aprovação explícita adicionada somente no apply', () => {
  const result = compareReconciliation(
    baseInput({
      applyApprovedDivergenceKeys: ['Quotation:opaque-id'],
      approvedDetailsValid: true,
    })
  );
  assert.equal(result.passed, true);
  assert.equal(result.approvedKeysMatch, true);
});

test('reconciliação rejeita aprovação sem detalhe aprovado ou divergência não aprovada', () => {
  const withoutApprovedDetail = compareReconciliation(
    baseInput({
      applyApprovedDivergenceKeys: ['Quotation:opaque-id'],
      approvedDetailsValid: false,
    })
  );
  assert.equal(withoutApprovedDetail.passed, false);
  assert.equal(withoutApprovedDetail.approvedDetailsValid, false);

  const unapproved = compareReconciliation(
    baseInput({ unapprovedDivergenceKeys: ['Quotation:opaque-id'], blocking: 1 })
  );
  assert.equal(unapproved.passed, false);
  assert.deepEqual(unapproved.unapprovedDivergenceKeys, ['Quotation:opaque-id']);
});

test('reconciliação aceita draft append permitido sem mascarar status target', () => {
  const expectedWithStatuses = {
    ...expected,
    statusRows: {
      quotations: [{ sourceId: 'quotation-1', status: 'enviado', allowedStatuses: ['enviado'] }],
      revisions: [
        { sourceId: 'quotation-1', status: 'enviado', allowedStatuses: ['enviado'] },
        { sourceId: 'quotation-2', status: 'enviado', allowedStatuses: ['enviado'] },
      ],
    },
  };
  const result = compareReconciliation(
    baseInput({
      expected: expectedWithStatuses,
      targetStatusRows: {
        quotations: [{ sourceId: 'quotation-1', status: 'rascunho', version: 2 }],
        revisions: [
          { sourceId: 'quotation-1', status: 'rascunho', version: 2 },
          { sourceId: 'quotation-2', status: 'enviado', version: 1 },
        ],
      },
      targetStatusCounts: { quotations: { rascunho: 1 }, revisions: { rascunho: 1, enviado: 1 } },
    })
  );
  assert.equal(result.passed, true);
  const wrongStatus = compareReconciliation(
    baseInput({
      expected: expectedWithStatuses,
      targetStatusRows: {
        quotations: [{ sourceId: 'quotation-1', status: 'rascunho', version: 1 }],
        revisions: [
          { sourceId: 'quotation-1', status: 'rascunho', version: 1 },
          { sourceId: 'quotation-2', status: 'enviado', version: 1 },
        ],
      },
      targetStatusCounts: { quotations: { perdido: 1 }, revisions: { rascunho: 1, enviado: 1 } },
    })
  );
  assert.equal(wrongStatus.passed, false);
  assert.equal(wrongStatus.targetStatusRowsMatchExpected, false);
});

test('reconciliação permite ausência somente da chave aprovada', () => {
  const approvedProduct = compareReconciliation(
    baseInput({ approvedMissingKeys: ['Item:opaque-product'] })
  );
  assert.equal(approvedProduct.passed, true);
  assert.deepEqual(approvedProduct.approvedMissingKeys, ['Item:opaque-product']);

  const missingWithoutApproval = compareReconciliation(baseInput({ missingIdentities: 1 }));
  assert.equal(missingWithoutApproval.passed, false);
});

test('reconciliação rejeita hash, identidade ou contagem target inconsistente', () => {
  const result = compareReconciliation(
    baseInput({
      applyCounts: { ...counts, quotations: 0 },
      applyManifestHash: 'b'.repeat(64),
      persistedManifestHash: 'b'.repeat(64),
      targetImportedCounts: { ...targetImportedCounts, quotations: 0 },
      targetHashes: { ...targetHashes, quotations: 'b'.repeat(64) },
      lineageInvalid: 1,
    })
  );
  assert.equal(result.passed, false);
  assert.equal(result.manifestHashesMatch, false);
  assert.equal(result.targetCountsMatchExpected, false);
  assert.equal(result.expectedHashesMatchTarget, false);
  assert.equal(result.lineageInvalid, 1);
});
