import { and, eq } from 'drizzle-orm';

import type { QuoteDatabase } from './repositories/quote-draft-management-repository.js';
import { quotationTemplateVersions, quotationTemplates } from './schema.js';
import { snapshotFromLegacyRevision } from '../../modules/quotation-template-snapshot.js';
import type { QuotationSectionsSnapshot } from '../../modules/quotation-content.js';

export async function resolveQuotationRevisionMetadata(
  tx: QuoteDatabase,
  revision: {
    templatePadrao?: unknown;
    templateHash?: unknown;
    template_padrao?: unknown;
    template_hash?: unknown;
    pagamento?: unknown;
    entrega?: unknown;
    observacoes?: unknown;
    prazoProducao?: unknown;
    prazo_producao?: unknown;
  }
) {
  const key = String(revision.templatePadrao ?? revision.template_padrao ?? '').trim();
  const hash = String(revision.templateHash ?? revision.template_hash ?? '').trim();
  const [version] = await tx
    .select({ id: quotationTemplateVersions.id })
    .from(quotationTemplateVersions)
    .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
    .where(and(eq(quotationTemplates.key, key), eq(quotationTemplateVersions.sourceHash, hash)))
    .limit(1);
  if (!version) throw new Error(`Versão de template ausente: chave ${key}, hash ${hash}.`);
  return {
    templateVersionId: version.id,
    sectionsSnapshot: snapshotFromLegacyRevision(revision),
  };
}

export function revisionSectionsSnapshot(revision: {
  sectionsSnapshot?: unknown;
  pagamento?: unknown;
  entrega?: unknown;
  observacoes?: unknown;
  prazoProducao?: unknown;
  prazo_producao?: unknown;
}): QuotationSectionsSnapshot {
  return revision.sectionsSnapshot
    ? (revision.sectionsSnapshot as QuotationSectionsSnapshot)
    : snapshotFromLegacyRevision(revision);
}
