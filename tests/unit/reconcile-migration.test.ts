import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  compareReconciliation,
  expectedReconciliation,
  findExcludedTargetDependencyKeys,
} from '../../scripts/reconcile-migration.mjs';
import {
  hashDiscardEntries,
  type DiscardEntry,
} from '../../api/_functions/lib/migration-discard.ts';

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
const exclusionCounts = { produtos: 1, faixas: 1, clientes: 0, orcamentos: 1, documentos: 0 };
const exclusionClosureHash = 'b'.repeat(64);
const emptyReconciliationCounts = Object.fromEntries(
  ['products', 'pricingDocuments', 'pricingTiers', 'clients', 'quotations', 'revisions', 'items', 'templates', 'templateVersions']
    .map((key) => [key, 0])
);
const emptyReconciliationHashes = Object.fromEntries(
  Object.keys(emptyReconciliationCounts).concat('lineage').map((key) => [key, 'a'.repeat(64)])
);
const emptyReconciliationRows = {
  products: [],
  pricingDocuments: [],
  pricingTiers: [],
  clients: [],
  quotations: [],
  revisions: [],
  items: [],
  templates: [],
  templateVersions: [],
  lineage: [],
};

function closureManifest(entries, counts) {
  const manifestHash = 'd'.repeat(64);
  return {
    manifestHash,
    discardManifestHash: null,
    discardPlan: {
      sourceManifestHash: manifestHash,
      closureHash: hashDiscardEntries(entries),
      entries: entries.map(({ key, entity, reason, depends_on }) => ({ key, entity, reason, depends_on })),
    },
    exclusionCounts: counts,
    reconciliation: {
      keys: { products: [], pricingDocuments: [], pricingTiers: [], clients: [], quotations: [] },
      counts: emptyReconciliationCounts,
      hashes: emptyReconciliationHashes,
      statusCounts: { quotations: {}, revisions: {} },
      statusRows: { quotations: [], revisions: [] },
      revisionExpectations: [],
      rows: emptyReconciliationRows,
    },
  };
}

function dependencyKey(sku) {
  return `dependency:${createHash('sha256').update(JSON.stringify(sku)).digest('hex')}`;
}

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
    targetStatusRows: undefined,
    expectedHashesMatchTarget: undefined,
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

function exclusionInput(overrides = {}) {
  return baseInput({
    expected: { ...expected, exclusionCounts, exclusionClosureHash },
    expectedExclusionCounts: exclusionCounts,
    actualExclusionCounts: exclusionCounts,
    expectedExclusionClosureHash: exclusionClosureHash,
    actualExclusionClosureHash: exclusionClosureHash,
    targetExcludedLineageKeys: [],
    targetExcludedDependencyKeys: [],
    ...overrides,
  });
}

test('reconciliação aprova projeções graváveis e closure de descarte exatos', () => {
  const result = compareReconciliation(exclusionInput());
  assert.equal(result.passed, true);
  assert.equal(result.excludedRowsMatch, true);
  assert.equal(result.excludedClosureHashMatch, true);
  assert.deepEqual(result.unapprovedExclusionKeys, []);
});

test('reconciliação rejeita lineage target para orçamento excluído', () => {
  const result = compareReconciliation(
    exclusionInput({ targetExcludedLineageKeys: ['Quotation:discarded'] })
  );
  assert.equal(result.passed, false);
  assert.equal(result.excludedRowsMatch, false);
  assert.deepEqual(result.unapprovedExclusionKeys, ['Quotation:discarded']);
});

test('reconciliação rejeita dependência de SKU excluído em orçamento target', () => {
  const result = compareReconciliation(
    exclusionInput({ targetExcludedDependencyKeys: ['Item:discarded'] })
  );
  assert.equal(result.passed, false);
  assert.equal(result.excludedRowsMatch, false);
  assert.deepEqual(result.unapprovedExclusionKeys, ['Item:discarded']);
});

test('reconciliação rejeita contagem ou hash da closure de descarte divergente', () => {
  const wrongCount = compareReconciliation(
    exclusionInput({ actualExclusionCounts: { ...exclusionCounts, orcamentos: 0 } })
  );
  assert.equal(wrongCount.passed, false);
  assert.equal(wrongCount.excludedRowsMatch, false);

  const wrongHash = compareReconciliation(
    exclusionInput({ actualExclusionClosureHash: 'c'.repeat(64) })
  );
  assert.equal(wrongHash.passed, false);
  assert.equal(wrongHash.excludedClosureHashMatch, false);
});

test('reconciliação mantém bloqueio para divergência não resolvida', () => {
  const result = compareReconciliation(
    exclusionInput({ unapprovedDivergenceKeys: ['Quotation:unresolved'], blocking: 1 })
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.unapprovedDivergenceKeys, ['Quotation:unresolved']);
});

test('expectedReconciliation rejeita contagens de exclusão adulteradas', () => {
  const entries: DiscardEntry[] = [
    {
      key: 'Item:excluded',
      source_doctype: 'Item',
      source_id: 'excluded',
      entity: 'produto',
      reason: 'ambiguous-pricing',
      depends_on: [],
    },
    {
      key: 'Quotation:excluded',
      source_doctype: 'Quotation',
      source_id: 'excluded',
      entity: 'orcamento',
      reason: 'discarded-dependency',
      depends_on: ['Item:excluded'],
    },
  ];
  const manifest = closureManifest(entries, {
    produtos: 0,
    faixas: 0,
    clientes: 0,
    orcamentos: 0,
    documentos: 0,
  });
  assert.throws(
    () => expectedReconciliation(manifest, 'fixture'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /contag|closure/i);
      assert.doesNotMatch(error.message, /excluded/);
      return true;
    }
  );
});

test('expectedReconciliation rejeita contagens não-zero sem plano de descarte', () => {
  const manifest = closureManifest(
    [
      {
        key: 'Item:excluded',
        source_doctype: 'Item',
        source_id: 'excluded',
        entity: 'produto',
        reason: 'ambiguous-pricing',
        depends_on: [],
      },
    ],
    { produtos: 1, faixas: 0, clientes: 0, orcamentos: 0, documentos: 0 }
  );
  const manifestWithoutPlan = { ...manifest, discardPlan: undefined };
  assert.throws(
    () => expectedReconciliation(manifestWithoutPlan, 'fixture'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /plano|exclusão/i);
      return true;
    }
  );
});

test('expectedReconciliation rejeita IDs Customer/Lead crus em chaves e dependências', () => {
  const rawKeyEntries: DiscardEntry[] = [
    {
      key: 'Customer:raw-customer',
      source_doctype: 'Customer',
      source_id: 'raw-customer',
      entity: 'cliente',
      reason: 'ambiguous-client',
      depends_on: [],
    },
  ];
  const rawKeyManifest = closureManifest(rawKeyEntries, {
    produtos: 0,
    faixas: 0,
    clientes: 1,
    orcamentos: 0,
    documentos: 0,
  });
  assert.throws(
    () => expectedReconciliation(rawKeyManifest, 'fixture'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /chave|closure|origem/i);
      assert.doesNotMatch(error.message, /raw-customer/);
      return true;
    }
  );

  const rawDependencyEntries: DiscardEntry[] = [
    {
      key: 'Customer:cliente-0123456789ab',
      source_doctype: 'Customer',
      source_id: 'cliente-0123456789ab',
      entity: 'cliente',
      reason: 'ambiguous-client',
      depends_on: ['Lead:raw-lead'],
    },
    {
      key: 'Lead:raw-lead',
      source_doctype: 'Lead',
      source_id: 'raw-lead',
      entity: 'cliente',
      reason: 'ambiguous-client',
      depends_on: [],
    },
  ];
  const rawDependencyManifest = closureManifest(rawDependencyEntries, {
    produtos: 0,
    faixas: 0,
    clientes: 2,
    orcamentos: 0,
    documentos: 0,
  });
  assert.throws(
    () => expectedReconciliation(rawDependencyManifest, 'fixture'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /chave|closure|origem/i);
      assert.doesNotMatch(error.message, /raw-lead/);
      return true;
    }
  );

  const validEntries: DiscardEntry[] = [
    {
      key: 'Customer:cliente-0123456789ab',
      source_doctype: 'Customer',
      source_id: 'cliente-0123456789ab',
      entity: 'cliente',
      reason: 'ambiguous-client',
      depends_on: ['Item:opaque-item'],
    },
    {
      key: 'Item:opaque-item',
      source_doctype: 'Item',
      source_id: 'opaque-item',
      entity: 'produto',
      reason: 'ambiguous-pricing',
      depends_on: [],
    },
  ];
  assert.doesNotThrow(() => expectedReconciliation(closureManifest(validEntries, {
    produtos: 1,
    faixas: 0,
    clientes: 1,
    orcamentos: 0,
    documentos: 0,
  }), 'fixture'));
});

test('reconciliação procura SKU excluído em todas as quotations target', () => {
  assert.deepEqual(
    findExcludedTargetDependencyKeys(
      {
        quotations: [{ id: 'quotation-outside-lineage' }],
        revisions: [{ id: 'revision-outside-lineage', quotationId: 'quotation-outside-lineage' }],
        items: [{ revisionId: 'revision-outside-lineage', productSku: 'SKU-EXCLUDED' }],
      },
      new Set(['SKU-EXCLUDED'])
    ),
    [dependencyKey('SKU-EXCLUDED')]
  );
});

test('expectedReconciliation valida contagens e closure exata sem expor a closure', () => {
  const entries: DiscardEntry[] = [
    {
      key: 'Item:excluded',
      source_doctype: 'Item',
      source_id: 'excluded',
      entity: 'produto',
      reason: 'ambiguous-pricing',
      depends_on: [],
    },
    {
      key: 'Quotation:excluded',
      source_doctype: 'Quotation',
      source_id: 'excluded',
      entity: 'orcamento',
      reason: 'discarded-dependency',
      depends_on: ['Item:excluded'],
    },
  ];
  const closureHash = hashDiscardEntries(entries);
  const rows = {
    products: [{ sourceDoctype: 'Item', sourceId: 'excluded', sku: 'SKU-EXCLUDED' }],
    pricingDocuments: [],
    pricingTiers: [],
    clients: [],
    quotations: [{ sourceDoctype: 'Quotation', sourceId: 'excluded' }],
    revisions: [],
    items: [],
    templates: [],
    templateVersions: [],
    lineage: [],
  };
  const manifest = {
    manifestHash: 'd'.repeat(64),
    discardManifestHash: null,
    discardPlan: {
      sourceManifestHash: 'd'.repeat(64),
      closureHash,
      entries: entries.map(({ key, entity, reason, depends_on }) => ({ key, entity, reason, depends_on })),
    },
    exclusionCounts: { produtos: 1, faixas: 0, clientes: 0, orcamentos: 1, documentos: 0 },
    reconciliation: {
      keys: { products: ['Item:excluded'], pricingDocuments: [], pricingTiers: [], clients: [], quotations: ['Quotation:excluded'] },
      counts: expectedCounts,
      hashes: { ...expectedHashes, lineage: 'a'.repeat(64) },
      statusCounts: { quotations: {}, revisions: {} },
      statusRows: { quotations: [], revisions: [] },
      revisionExpectations: [],
      rows,
    },
  };
  const result = expectedReconciliation(manifest, 'fixture');
  assert.deepEqual(result.exclusionClosure.counts, { produtos: 1, faixas: 0, clientes: 0, orcamentos: 1, documentos: 0 });
  assert.equal(result.exclusionClosure.closureHash, closureHash);
  assert.equal(result.exclusionClosure.entries.length, 2);
});
