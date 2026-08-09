import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canonicalApprovalKey,
  type ClientUnit,
  type FrappeLineageEntry,
  type NormalizedQuotation,
  type ProductUnit,
} from '../../api/_functions/lib/frappe-migration-core.ts';
import {
  buildDiscardPlan,
  hashDiscardEntries,
  parseDiscardManifest,
  validateDiscardManifest,
  type DiscardEntry,
  type DiscardManifest,
} from '../../api/_functions/lib/migration-discard.ts';

function lineage(
  sourceDoctype: string,
  sourceId: string,
  entityType: FrappeLineageEntry['entityType'],
  localKey: string
): FrappeLineageEntry {
  return {
    provider: 'frappe',
    sourceDoctype,
    sourceId,
    entityType,
    localId: localKey,
    localKey,
    canonicalHash: `canonical-${sourceDoctype}-${sourceId}`,
    sourceHash: `source-${sourceDoctype}-${sourceId}`,
    businessNumber: null,
    migrationRunId: null,
    sourceUpdatedAt: null,
    importedAt: null,
  };
}

function clientUnit(sourceDoctype: 'Customer' | 'Lead', sourceId: string, conflicts: string[] = []): ClientUnit {
  const localKey = `frappe:${sourceDoctype}:${sourceId}`;
  const member = {
    sourceDoctype,
    sourceId,
    sourceUpdatedAt: null,
    localKey,
    nome: `Cliente ${sourceId}`,
    documento: null,
    email: null,
    telefone: null,
    notes: null,
    address: null,
    links: [`${sourceDoctype}:${sourceId}`],
    source: {},
  };
  return {
    client: member,
    members: [member],
    lineage: [lineage(sourceDoctype, sourceId, 'cliente', localKey)],
    conflicts,
  };
}

function productUnit(sourceId: string, sku: string, divergences: string[] = []): ProductUnit {
  return {
    product: {
      sourceDoctype: 'Item',
      sourceId,
      sourceUpdatedAt: null,
      sku,
      legacyId: sourceId,
      nome: `Produto ${sku}`,
      descricao: '',
      unidade: 'Und',
      categoria: null,
      marca: null,
      ativo: true,
      precoBase: '10.00',
      precos: [],
      source: {},
    },
    pricing: { preco_base: '10.00', precos: [] },
    lineage: [
      lineage('Item', sourceId, 'produto', sku),
      lineage('Pricing Rule', 'R1', 'faixa', sku),
    ],
    divergences,
  };
}

function quotation(sourceId: string, clientRef: string, sku: string): NormalizedQuotation {
  return {
    sourceDoctype: 'Quotation',
    sourceId,
    sourceUpdatedAt: null,
    businessNumber: `ORC-2025${sourceId.slice(-1).padStart(4, '0')}`,
    year: 2025,
    clientRef,
    clientId: clientRef === 'Customer:C1' ? null : 'client-ok',
    status: 'rascunho',
    statusSource: 'Draft',
    statusKnown: true,
    orderLinkage: null,
    orderPending: false,
    createdAt: '2025-01-01 10:00:00',
    modifiedAt: '2025-01-01 10:00:00',
    items: [
      {
        position: 1,
        sku,
        nome: `Produto ${sku}`,
        quantidade: '1',
        unidade: 'Und',
        precoSugerido: '10.00',
        precoAplicado: '10.00',
        totalLinha: '10.00',
        notas: null,
        source: {},
      },
    ],
    terms: { validadeDias: 30, pagamento: null, entrega: null, frete: null, observacoes: null },
    subtotal: '10.00',
    total: '10.00',
    source: {},
  };
}

function graph() {
  const ambiguousClient = clientUnit('Customer', 'C1', ['Identidade ambígua.']);
  const cleanClient = clientUnit('Customer', 'C2');
  const ambiguousProduct = productUnit('P1', 'SKU-P1', ['preços ambíguos para mínimo 10.']);
  const cleanProduct = productUnit('P2', 'SKU-P2');
  const quotations = [
    quotation('Q1', 'Customer:C1', 'SKU-P1'),
    quotation('Q2', 'Customer:C2', 'SKU-P1'),
    quotation('Q3', 'Customer:C2', 'SKU-P2'),
    quotation('Q4', 'Customer:C2', 'SKU-P2'),
  ];
  const clientKeys = new Map<string, ClientUnit>([
    ['Customer:C1', ambiguousClient],
    ['Customer:C2', cleanClient],
  ]);
  return {
    clientUnits: [ambiguousClient, cleanClient],
    productUnits: [ambiguousProduct, cleanProduct],
    quotations,
    clientKeys,
    quotationIssueKeys: new Map([['Quotation:Q3', 'invalid-quotation-price' as const]]),
  };
}

function manifestFor(plan: ReturnType<typeof buildDiscardPlan>): DiscardManifest {
  const entries = [...plan.entries.values()];
  return {
    schemaVersion: 1,
    policy: 'discard-all-blockers',
    sourceManifestHash: 'a'.repeat(64),
    dryRunReportHash: 'b'.repeat(64),
    entries,
    closureHash: hashDiscardEntries(entries),
  };
}

describe('migration discard manifest', () => {
  it('builds deterministic blocker and dependency closure', () => {
    const input = graph();
    const plan = buildDiscardPlan(input);
    const customerKey = canonicalApprovalKey('Customer', 'C1');
    assert.ok(customerKey);
    const keys = new Set(plan.entries.keys());
    assert.deepEqual(
      [...keys].sort(),
      ['Item:P1', 'Pricing Rule:R1', 'Quotation:Q1', 'Quotation:Q2', 'Quotation:Q3', customerKey].sort()
    );
    assert.equal(plan.entries.get(customerKey)?.reason, 'ambiguous-client');
    assert.equal(plan.entries.get('Item:P1')?.reason, 'ambiguous-pricing');
    assert.equal(plan.entries.get('Pricing Rule:R1')?.reason, 'ambiguous-pricing');
    assert.equal(plan.entries.get('Quotation:Q3')?.reason, 'invalid-quotation-price');
    assert.deepEqual(
      plan.entries.get('Quotation:Q1')?.depends_on.slice().sort(),
      [customerKey, 'Item:P1', 'Pricing Rule:R1'].sort()
    );
    assert.equal(plan.entries.has('Quotation:Q4'), false);

    const reversed = buildDiscardPlan({ ...input, quotations: input.quotations.slice().reverse() });
    assert.equal(plan.closureHash, reversed.closureHash);
  });

  it('parses and validates a snapshot-bound manifest', () => {
    const input = graph();
    const plan = buildDiscardPlan(input);
    const manifest = parseDiscardManifest(manifestFor(plan));
    validateDiscardManifest(manifest, {
      sourceManifestHash: 'a'.repeat(64),
      dryRunReportHash: 'b'.repeat(64),
      requiredKeys: new Set(plan.entries.keys()),
    });
    assert.equal(manifest.entries.length, 6);
  });

  it('rejects duplicate, unknown, stale, and incomplete manifests', () => {
    const input = graph();
    const plan = buildDiscardPlan(input);
    const valid = manifestFor(plan);
    assert.throws(
      () => parseDiscardManifest({ ...valid, entries: [...valid.entries, valid.entries[0]] }),
      /duplic/i
    );
    assert.throws(
      () => parseDiscardManifest({ ...valid, entries: [{ ...valid.entries[0], reason: 'unknown' }] }),
      /reason|discard/i
    );
    const parsed = parseDiscardManifest(valid);
    assert.throws(
      () => validateDiscardManifest(parsed, {
        sourceManifestHash: 'c'.repeat(64),
        dryRunReportHash: 'b'.repeat(64),
        requiredKeys: new Set(plan.entries.keys()),
      }),
      /snapshot|hash/i
    );
    assert.throws(
      () => validateDiscardManifest(parsed, {
        sourceManifestHash: 'a'.repeat(64),
        dryRunReportHash: 'b'.repeat(64),
        requiredKeys: new Set([...plan.entries.keys(), 'Quotation:UNKNOWN']),
      }),
      /incomplet|chave|closure/i
    );
  });

  it('keeps source identifiers opaque in client keys', () => {
    const input = graph();
    const plan = buildDiscardPlan(input);
    const entry = [...plan.entries.values()].find((item: DiscardEntry) => item.entity === 'cliente');
    assert.ok(entry);
    assert.match(entry.key, /^Customer:cliente-[0-9a-f]{12}$/);
    assert.doesNotMatch(entry.key, /C1/);
  });

  it('rejects raw Customer/Lead identifiers without echoing them', () => {
    const valid = manifestFor(buildDiscardPlan(graph()));
    const client = valid.entries.find((entry) => entry.entity === 'cliente');
    assert.ok(client);
    const rawKey = {
      ...client,
      key: 'Customer:C1',
      source_doctype: 'Customer',
      source_id: 'C1',
    };
    assert.throws(
      () => parseDiscardManifest({ ...valid, entries: valid.entries.map((entry) => entry === client ? rawKey : entry) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /chave|origem|opac/i);
        assert.doesNotMatch(error.message, /C1/);
        return true;
      }
    );
  });

  it('rejects an entity/doctyp mismatch in a tampered manifest', () => {
    const valid = manifestFor(buildDiscardPlan(graph()));
    const client = valid.entries.find((entry) => entry.entity === 'cliente');
    assert.ok(client);
    assert.throws(
      () => parseDiscardManifest({
        ...valid,
        entries: valid.entries.map((entry) => entry === client ? { ...entry, entity: 'produto' } : entry),
      }),
      /entidade|origem|doctype/i
    );
  });

  it('hashes entries with fixed fields and locale-independent ordering', () => {
    const valid = manifestFor(buildDiscardPlan(graph()));
    const entry = valid.entries[0];
    const reordered = {
      depends_on: [...entry.depends_on].reverse(),
      reason: entry.reason,
      entity: entry.entity,
      source_id: entry.source_id,
      source_doctype: entry.source_doctype,
      key: entry.key,
    };
    assert.equal(hashDiscardEntries([entry]), hashDiscardEntries([reordered]));
    assert.equal(hashDiscardEntries(valid.entries), hashDiscardEntries(valid.entries.slice().reverse()));
  });
});
