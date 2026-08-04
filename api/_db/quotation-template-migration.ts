import { createHash } from 'node:crypto';

import {
  combineLegacyConditions,
  DEFAULT_QUOTATION_SECTIONS,
  normalizeQuotationSections,
  createQuotationSectionsSnapshot,
  type QuotationSectionsSettings,
  type QuotationSectionsSnapshot,
} from './quotation-content.js';
import { QUOTATION_TEMPLATES } from '../_functions/lib/quotation-templates.js';

export interface LegacyRevision {
  pagamento?: unknown;
  entrega?: unknown;
  observacoes?: unknown;
  prazoProducao?: unknown;
}

export interface TemplateSeed {
  key: string;
  name: string;
  version: 1;
  source: string;
  source_hash: string;
}

const text = (value: unknown): string => (value == null ? '' : String(value));

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
  const sections = legacySettingsSections(revision);
  sections.prazo_producao.title = 'Prazo de produção';
  if (revision.prazoProducao !== undefined) {
    sections.prazo_producao.enabled = Boolean(text(revision.prazoProducao));
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
    version: 1 as const,
    source: template.source,
    source_hash: createHash('sha256').update(template.source, 'utf8').digest('hex'),
  }));
}

export {
  combineLegacyConditions,
  DEFAULT_QUOTATION_SECTIONS,
  normalizeQuotationSections,
};
