import { asc, desc, eq, or } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  quotationTemplateVersions,
  quotationTemplates,
  quoteRevisionItems,
  quoteRevisions,
  quotations,
} from '../schema.js';
import { safeErrorSummary } from '../../../_shared/safe-error.js';

type DatabaseProvider = () => AppDatabase;
type QuoteDatabase = AppDatabase;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuotationTemplateSnapshotRepositoryError extends Error {
  readonly expose = false;

  constructor(
    message = 'Não foi possível consultar o orçamento para visualização.',
    readonly statusCode = 503
  ) {
    super(message);
    this.name = 'QuotationTemplateSnapshotRepositoryError';
  }
}

export interface QuotationTemplateSnapshot {
  quotation: typeof quotations.$inferSelect;
  revision: typeof quoteRevisions.$inferSelect;
  templateVersion:
    | (typeof quotationTemplateVersions.$inferSelect & {
        template?: typeof quotationTemplates.$inferSelect;
      })
    | null;
  sectionsSnapshot: typeof quoteRevisions.$inferSelect.sectionsSnapshot;
  companySnapshot: typeof quoteRevisions.$inferSelect.companySnapshot;
  items: (typeof quoteRevisionItems.$inferSelect)[];
}

function quoteWhere(id: string) {
  return UUID_PATTERN.test(id)
    ? or(eq(quotations.id, id), eq(quotations.businessNumber, id))
    : eq(quotations.businessNumber, id);
}

/**
 * Load only the immutable quotation envelope, revision and item snapshots.
 * This repository intentionally never joins clients, products, pricing tiers,
 * or settings so a rendered historical quote cannot change when live records
 * are edited.
 */
export async function readQuotationTemplateSnapshot(
  db: QuoteDatabase,
  id: string,
  templateVersionId?: string
): Promise<QuotationTemplateSnapshot | null> {
  let [quotation] = await db.select().from(quotations).where(quoteWhere(id)).limit(1);
  let targetRevisionId: string | undefined;
  if (!quotation && UUID_PATTERN.test(id)) {
    const [revision] = await db
      .select()
      .from(quoteRevisions)
      .where(eq(quoteRevisions.id, id))
      .limit(1);
    if (revision) {
      targetRevisionId = revision.id;
      [quotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, revision.quotationId))
        .limit(1);
    }
  }
  if (!quotation) return null;
  const [revision] = await db
    .select()
    .from(quoteRevisions)
    .where(
      targetRevisionId
        ? eq(quoteRevisions.id, targetRevisionId)
        : eq(quoteRevisions.quotationId, quotation.id)
    )
    .orderBy(desc(quoteRevisions.version))
    .limit(1);
  if (!revision) return null;

  let templateVersion = revision.templateVersionId
    ? (
        await db
          .select({ version: quotationTemplateVersions, model: quotationTemplates })
          .from(quotationTemplateVersions)
          .innerJoin(
            quotationTemplates,
            eq(quotationTemplates.id, quotationTemplateVersions.templateId)
          )
          .where(eq(quotationTemplateVersions.id, revision.templateVersionId))
          .limit(1)
      ).map(({ version, model }) => ({ ...version, template: model }))[0] || null
    : null;
  if (templateVersionId !== undefined) {
    if (revision.status !== 'rascunho') {
      throw new QuotationTemplateSnapshotRepositoryError(
        'A versão do template só pode ser alterada em rascunhos.',
        409
      );
    }
    const [selected] = await db
      .select({ version: quotationTemplateVersions, model: quotationTemplates })
      .from(quotationTemplateVersions)
      .innerJoin(
        quotationTemplates,
        eq(quotationTemplates.id, quotationTemplateVersions.templateId)
      )
      .where(eq(quotationTemplateVersions.id, templateVersionId))
      .limit(1);
    if (!selected || selected.model.archived) {
      throw new QuotationTemplateSnapshotRepositoryError('Template do orçamento inválido.', 400);
    }
    templateVersion = { ...selected.version, template: selected.model };
  }
  if (!templateVersion && !revision.templateVersionId) {
    console.warn(
      `[quotation-template-repository] legacy revision ${revision.id} uses static template compatibility fallback`
    );
  }
  const items = await db
    .select()
    .from(quoteRevisionItems)
    .where(eq(quoteRevisionItems.revisionId, revision.id))
    .orderBy(asc(quoteRevisionItems.position));
  return {
    quotation,
    revision,
    templateVersion,
    sectionsSnapshot: revision.sectionsSnapshot,
    companySnapshot: revision.companySnapshot,
    items,
  };
}

export function createQuotationTemplateRepository(getDb: DatabaseProvider = getDatabase) {
  return {
    async get(id: string, templateVersionId?: string): Promise<QuotationTemplateSnapshot | null> {
      const normalized = String(id || '').trim();
      if (!normalized) return null;
      try {
        return await readQuotationTemplateSnapshot(getDb(), normalized, templateVersionId);
      } catch (error) {
        if (error instanceof QuotationTemplateSnapshotRepositoryError) throw error;
        console.error(
          `[quotation-template-repository] read failed (${safeErrorSummary(error)})`
        );
        throw new QuotationTemplateSnapshotRepositoryError();
      }
    },
  };
}
