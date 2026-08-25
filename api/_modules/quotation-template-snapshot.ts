import { createHash } from 'node:crypto';

import {
  combineLegacyConditions,
  DEFAULT_QUOTATION_SECTIONS,
  normalizeQuotationSections,
  createQuotationSectionsSnapshot,
  withQuotationProductionDeadline,
  type QuotationSectionsSettings,
  type QuotationSectionsSnapshot,
} from './quotation-content.js';
import { QUOTATION_TEMPLATES } from './quotation-template-catalog.js';

export interface LegacyRevision {
  pagamento?: unknown;
  entrega?: unknown;
  observacoes?: unknown;
  prazoProducao?: unknown;
  prazo_producao?: unknown;
}

export interface TemplateSeed {
  key: string;
  name: string;
  version: 2;
  contract_version: 2;
  source: string;
  source_hash: string;
}

const text = (value: unknown): string => (value == null ? '' : String(value));

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)])
  );
}

export function isEmptyQuotationSections(value: unknown): boolean {
  try {
    return JSON.stringify(canonical(normalizeQuotationSections(value))) ===
      JSON.stringify(canonical(DEFAULT_QUOTATION_SECTIONS));
  } catch {
    return true;
  }
}

export function legacySettingsSections(settings: {
  pagamento?: unknown;
  entrega?: unknown;
  observacoes?: unknown;
}): QuotationSectionsSettings {
  return normalizeQuotationSections(undefined, {
    pagamento: text(settings.pagamento),
    entrega: text(settings.entrega),
    observacoes: text(settings.observacoes),
  });
}

export function snapshotFromLegacyRevision(revision: LegacyRevision): QuotationSectionsSnapshot {
  const deadline = revision.prazoProducao ?? revision.prazo_producao;
  const sections = withQuotationProductionDeadline(legacySettingsSections(revision), deadline);
  sections.prazo_producao.title = 'Prazo de produção';
  if (deadline !== undefined) {
    sections.prazo_producao.enabled = Boolean(text(deadline));
  }
  return createQuotationSectionsSnapshot(sections);
}

export function legacySnapshotForRevision(revision: LegacyRevision): QuotationSectionsSnapshot {
  return snapshotFromLegacyRevision(revision);
}

export function templateSeedPlan(): TemplateSeed[] {
  return QUOTATION_TEMPLATES.map((template) => ({
    key: template.key,
    name: template.name,
    version: 2 as const,
    contract_version: 2 as const,
    source: template.source,
    source_hash: createHash('sha256').update(template.source, 'utf8').digest('hex'),
  }));
}

export {
  combineLegacyConditions,
  DEFAULT_QUOTATION_SECTIONS,
  normalizeQuotationSections,
};
