import { createHash } from 'node:crypto';

import {
  canonicalApprovalKey,
  safeApprovalKey,
  type ClientUnit,
  type NormalizedQuotation,
  type ProductUnit,
} from './frappe-migration-core.js';

export const DISCARD_MANIFEST_VERSION = 1 as const;
export const DISCARD_POLICY = 'discard-all-blockers' as const;

export type DiscardReason =
  | 'ambiguous-client'
  | 'ambiguous-pricing'
  | 'invalid-quotation-price'
  | 'discarded-dependency';

export type DiscardEntity = 'produto' | 'faixa' | 'cliente' | 'orcamento';

export interface DiscardEntry {
  key: string;
  source_doctype: string;
  source_id: string;
  entity: DiscardEntity;
  reason: DiscardReason;
  depends_on: string[];
}

export interface DiscardManifest {
  schemaVersion: typeof DISCARD_MANIFEST_VERSION;
  policy: typeof DISCARD_POLICY;
  sourceManifestHash: string;
  dryRunReportHash: string;
  entries: DiscardEntry[];
  closureHash: string;
}

export interface DiscardPlan {
  entries: Map<string, DiscardEntry>;
  clientKeys: Set<string>;
  productKeys: Set<string>;
  pricingKeys: Set<string>;
  quotationKeys: Set<string>;
  closureHash: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const REASONS = new Set<DiscardReason>([
  'ambiguous-client',
  'ambiguous-pricing',
  'invalid-quotation-price',
  'discarded-dependency',
]);
const ENTITIES = new Set<DiscardEntity>(['produto', 'faixa', 'cliente', 'orcamento']);

function fail(message: string): never {
  throw new Error(`Manifesto de descarte inválido: ${message}`);
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sourceParts(value: string): [string, string] {
  const parts = value.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) fail(`chave de origem inválida (${value}).`);
  return [parts[0], parts[1]];
}

function canonicalSourceKey(value: string): string {
  try {
    return safeApprovalKey(value);
  } catch {
    fail(`chave de origem inválida (${value}).`);
  }
}

function entryFromKey(
  key: string,
  entity: DiscardEntity,
  reason: DiscardReason,
  dependsOn: Iterable<string> = []
): DiscardEntry {
  const canonical = canonicalSourceKey(key);
  const [sourceDoctype, source_id] = sourceParts(canonical);
  return {
    key: canonical,
    source_doctype: sourceDoctype,
    source_id,
    entity,
    reason,
    depends_on: [...new Set([...dependsOn].map(canonicalSourceKey))].sort(),
  };
}

function normalizeEntry(value: unknown): DiscardEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('entrada deve ser um objeto.');
  const input = value as Record<string, unknown>;
  const key = text(input.key);
  const sourceDoctype = text(input.source_doctype);
  const sourceId = text(input.source_id);
  const entity = text(input.entity) as DiscardEntity;
  const reason = text(input.reason) as DiscardReason;
  if (!key || !sourceDoctype || !sourceId) fail('entrada exige key, source_doctype e source_id.');
  if (!ENTITIES.has(entity)) fail(`entidade desconhecida (${entity}).`);
  if (!REASONS.has(reason)) fail(`reason desconhecida (${reason}).`);
  const canonical = canonicalSourceKey(key);
  const expected = canonicalApprovalKey(sourceDoctype, sourceId);
  if (!expected || expected !== canonical) fail(`key não corresponde à origem (${key}).`);
  if (!Array.isArray(input.depends_on) || input.depends_on.some((item) => typeof item !== 'string'))
    fail('depends_on deve ser uma lista de chaves.');
  const dependsOn = [...new Set(input.depends_on.map(canonicalSourceKey))].sort();
  if (dependsOn.includes(canonical)) fail(`entrada depende de si mesma (${canonical}).`);
  return {
    key: canonical,
    source_doctype: sourceDoctype,
    source_id: sourceId,
    entity,
    reason,
    depends_on: dependsOn,
  };
}

function canonicalEntries(entries: Iterable<DiscardEntry>): DiscardEntry[] {
  return [...entries]
    .map((entry) => ({
      ...entry,
      depends_on: [...new Set(entry.depends_on.map(canonicalSourceKey))].sort(),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function hashDiscardEntries(entries: Iterable<DiscardEntry>): string {
  const payload = canonicalEntries(entries).map((entry) => JSON.stringify(entry)).join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

export function parseDiscardManifest(value: unknown): DiscardManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('manifest deve ser um objeto.');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== DISCARD_MANIFEST_VERSION) fail('schemaVersion desconhecido.');
  if (input.policy !== DISCARD_POLICY) fail('policy desconhecida.');
  const sourceManifestHash = text(input.sourceManifestHash);
  const dryRunReportHash = text(input.dryRunReportHash);
  const closureHash = text(input.closureHash);
  if (!HASH_PATTERN.test(sourceManifestHash)) fail('sourceManifestHash deve ser SHA-256.');
  if (!HASH_PATTERN.test(dryRunReportHash)) fail('dryRunReportHash deve ser SHA-256.');
  if (!HASH_PATTERN.test(closureHash)) fail('closureHash deve ser SHA-256.');
  if (!Array.isArray(input.entries)) fail('entries deve ser uma lista.');
  const entries = input.entries.map(normalizeEntry);
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) fail(`entrada duplicada (${entry.key}).`);
    keys.add(entry.key);
  }
  if (entries.some((entry) => entry.depends_on.some((key) => !keys.has(key))))
    fail('closure possui dependência ausente.');
  if (hashDiscardEntries(entries) !== closureHash) fail('closureHash não corresponde às entries.');
  return {
    schemaVersion: DISCARD_MANIFEST_VERSION,
    policy: DISCARD_POLICY,
    sourceManifestHash: sourceManifestHash.toLowerCase(),
    dryRunReportHash: dryRunReportHash.toLowerCase(),
    entries: canonicalEntries(entries),
    closureHash: closureHash.toLowerCase(),
  };
}

export function validateDiscardManifest(
  manifest: DiscardManifest,
  expected: { sourceManifestHash: string; dryRunReportHash: string; requiredKeys: Set<string> }
): void {
  const parsed = parseDiscardManifest(manifest);
  if (parsed.sourceManifestHash !== text(expected.sourceManifestHash).toLowerCase())
    fail('sourceManifestHash divergente.');
  if (parsed.dryRunReportHash !== text(expected.dryRunReportHash).toLowerCase())
    fail('dryRunReportHash divergente.');
  const actualKeys = new Set(parsed.entries.map((entry) => entry.key));
  const requiredKeys = new Set([...expected.requiredKeys].map(canonicalSourceKey));
  if (actualKeys.size !== requiredKeys.size || [...requiredKeys].some((key) => !actualKeys.has(key)))
    fail('entries incompletas ou extras para o snapshot.');
}

function mergeEntry(
  entries: Map<string, DiscardEntry>,
  key: string,
  entity: DiscardEntity,
  reason: DiscardReason,
  dependsOn: Iterable<string> = []
): void {
  const candidate = entryFromKey(key, entity, reason, dependsOn);
  const previous = entries.get(candidate.key);
  if (!previous) {
    entries.set(candidate.key, candidate);
    return;
  }
  const reasonRank: Record<DiscardReason, number> = {
    'ambiguous-client': 4,
    'ambiguous-pricing': 4,
    'invalid-quotation-price': 3,
    'discarded-dependency': 1,
  };
  entries.set(candidate.key, {
    ...previous,
    reason: reasonRank[candidate.reason] > reasonRank[previous.reason] ? candidate.reason : previous.reason,
    depends_on: [...new Set([...previous.depends_on, ...candidate.depends_on])].sort(),
  });
}

export function buildDiscardPlan(input: {
  clientUnits: ClientUnit[];
  productUnits: ProductUnit[];
  quotations: NormalizedQuotation[];
  clientKeys: Map<string, ClientUnit>;
  quotationIssueKeys: Map<string, DiscardReason>;
}): DiscardPlan {
  const entries = new Map<string, DiscardEntry>();
  const clientByRef = new Map<string, ClientUnit>();
  for (const [key, unit] of input.clientKeys) {
    clientByRef.set(canonicalSourceKey(key), unit);
    for (const lineage of unit.lineage) {
      const sourceKey = canonicalApprovalKey(lineage.sourceDoctype, lineage.sourceId);
      if (sourceKey) clientByRef.set(sourceKey, unit);
    }
  }
  for (const unit of input.clientUnits) {
    if (!unit.conflicts.length) continue;
    for (const lineage of unit.lineage) {
      const key = canonicalApprovalKey(lineage.sourceDoctype, lineage.sourceId);
      if (key) mergeEntry(entries, key, 'cliente', 'ambiguous-client');
    }
  }

  const blockedSkus = new Map<string, ProductUnit>();
  for (const unit of input.productUnits) {
    if (!unit.divergences.length) continue;
    blockedSkus.set(unit.product.sku, unit);
    for (const lineage of unit.lineage) {
      const key = canonicalApprovalKey(lineage.sourceDoctype, lineage.sourceId);
      if (!key) continue;
      mergeEntry(entries, key, lineage.entityType === 'faixa' ? 'faixa' : 'produto', 'ambiguous-pricing');
    }
  }

  for (const [key, reason] of input.quotationIssueKeys) {
    const canonical = canonicalSourceKey(key);
    const [sourceDoctype] = sourceParts(canonical);
    if (sourceDoctype !== 'Quotation') fail(`issue não é Quotation (${canonical}).`);
    mergeEntry(entries, canonical, 'orcamento', reason);
  }

  for (const quotation of input.quotations) {
    const dependsOn: string[] = [];
    const clientUnit = quotation.clientRef ? clientByRef.get(canonicalSourceKey(quotation.clientRef)) : undefined;
    if (clientUnit?.conflicts.length) {
      for (const lineage of clientUnit.lineage) {
        const key = canonicalApprovalKey(lineage.sourceDoctype, lineage.sourceId);
        if (key) dependsOn.push(key);
      }
    }
    for (const item of quotation.items) {
      const productUnit = blockedSkus.get(item.sku);
      if (!productUnit) continue;
      for (const lineage of productUnit.lineage) {
        const key = canonicalApprovalKey(lineage.sourceDoctype, lineage.sourceId);
        if (key) dependsOn.push(key);
      }
    }
    if (dependsOn.length) {
      const key = canonicalApprovalKey('Quotation', quotation.sourceId);
      if (key) mergeEntry(entries, key, 'orcamento', 'discarded-dependency', dependsOn);
    }
  }

  const ordered = canonicalEntries(entries.values());
  const planEntries = new Map(ordered.map((entry) => [entry.key, entry]));
  const grouped = (entity: DiscardEntity): Set<string> =>
    new Set(ordered.filter((entry) => entry.entity === entity).map((entry) => entry.key));
  return {
    entries: planEntries,
    clientKeys: grouped('cliente'),
    productKeys: grouped('produto'),
    pricingKeys: grouped('faixa'),
    quotationKeys: grouped('orcamento'),
    closureHash: hashDiscardEntries(ordered),
  };
}
