import { and, desc, eq, max, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { getDatabase, type AppDatabase } from './client.js';
import {
  appSettings,
  quotationTemplateVersions,
  quotationTemplates,
  quoteRevisions,
} from './schema.js';
import {
  renderQuotationTemplate,
  validateQuotationHtmlSource,
  validateQuotationTemplateSource,
  QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL,
} from '../_functions/lib/quotation-templates.js';
import { type QuoteDatabase } from './quote-draft-management-repository.js';

export interface QuotationTemplateListItem {
  id: string;
  key: string;
  name: string;
  archived: boolean;
  is_default: boolean;
  current_version_id: string | null;
  current_version: number | null;
  current_hash: string | null;
  updated_at: string;
  usage_count: number;
}
export interface QuotationTemplateDetail extends QuotationTemplateListItem {
  current_source: string;
  versions: Array<{ id: string; version: number; source_hash: string; created_at: string }>;
}
export interface TemplateValidation {
  valid: boolean;
  warnings: string[];
  preview: string;
}
export interface QuotationTemplateLibraryRepository {
  list(active?: boolean): Promise<{ templates: QuotationTemplateListItem[]; default_key: string }>;
  get(id: string): Promise<QuotationTemplateDetail | null>;
  create(input: { key: string; name: string; source: string }): Promise<{ id: string }>;
  saveVersion(id: string, input: { name?: string; source: string }): Promise<{ id: string }>;
  archive(id: string): Promise<{ archived: true }>;
  setDefault(id: string): Promise<{ default_key: string }>;
  validate(input: { key: string; source: string }): Promise<TemplateValidation>;
}

export class QuotationTemplateLibraryInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;
}
export class QuotationTemplateLibraryNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;
}
export class QuotationTemplateLibraryConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;
}
export class QuotationTemplateLibraryRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;
}

type DatabaseProvider = () => AppDatabase;
const KEY = /^[a-z0-9][a-z0-9_-]{0,119}$/;
function hash(source: string): string {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}
function normalize(input: { key?: unknown; name?: unknown; source?: unknown }, requireName = true) {
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const source = typeof input.source === 'string' ? input.source : '';
  if (!KEY.test(key)) throw new QuotationTemplateLibraryInputError('Chave de template inválida.');
  if (requireName && (!name || name.length > 255))
    throw new QuotationTemplateLibraryInputError('Nome de template inválido.');
  if (!source || [...source].length > 200000)
    throw new QuotationTemplateLibraryInputError(
      'Fonte do template inválida ou excede o limite permitido.'
    );
  try {
    validateQuotationHtmlSource(source, key);
    validateQuotationTemplateSource(source, key);
  } catch (error) {
    throw new QuotationTemplateLibraryInputError(
      error instanceof Error ? error.message : 'HTML ou Handlebars inválido.'
    );
  }
  return { key, name, source };
}
function warnings(source: string): string[] {
  return ['prazo_producao', 'pagamento', 'condicoes_gerais']
    .filter((section) => !new RegExp(`secoes\\.${section}(?:\\.|[}\\s])`).test(source))
    .map((section) => `A seção ${section} não é usada pelo template.`);
}
function preview(key: string, source: string): TemplateValidation {
  const html = renderQuotationTemplate(
    { key, name: key, is_default: false, hash: hash(source), source },
    QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL
  );
  return { valid: true, warnings: warnings(source), preview: html };
}
function iso(value: Date): string {
  return value.toISOString();
}
function item(
  row: typeof quotationTemplates.$inferSelect,
  version: typeof quotationTemplateVersions.$inferSelect | undefined,
  isDefault: boolean,
  usage: number
): QuotationTemplateListItem {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    archived: row.archived,
    is_default: isDefault,
    current_version_id: version?.id || null,
    current_version: version?.version || null,
    current_hash: version?.sourceHash || null,
    updated_at: iso(row.updatedAt),
    usage_count: usage,
  };
}
async function usage(db: QuoteDatabase, id: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quoteRevisions)
    .innerJoin(
      quotationTemplateVersions,
      eq(quoteRevisions.templateVersionId, quotationTemplateVersions.id)
    )
    .where(eq(quotationTemplateVersions.templateId, id));
  return Number(row?.count || 0);
}
async function current(db: QuoteDatabase, id: string) {
  return (
    await db
      .select()
      .from(quotationTemplateVersions)
      .where(eq(quotationTemplateVersions.templateId, id))
      .orderBy(desc(quotationTemplateVersions.version))
      .limit(1)
  )[0];
}

export async function readCurrentQuotationTemplateVersion(
  db: QuoteDatabase,
  selection: string | { id?: string; key?: string }
) {
  const where =
    typeof selection === 'string'
      ? eq(quotationTemplates.key, selection)
      : selection.id
        ? eq(quotationTemplates.id, selection.id)
        : eq(quotationTemplates.key, selection.key || '');
  const [model] = await db.select().from(quotationTemplates).where(where).limit(1);
  if (!model) return null;
  const version = await current(db, model.id);
  return version
    ? {
        model: { id: model.id, key: model.key, name: model.name, archived: model.archived },
        version: {
          id: version.id,
          version: version.version,
          source: version.source,
          sourceHash: version.sourceHash,
        },
      }
    : null;
}

export function createQuotationTemplateLibraryRepository(
  getDb: DatabaseProvider = getDatabase
): QuotationTemplateLibraryRepository {
  return {
    async list(active) {
      const db = getDb();
      const [settings] = await db
        .select({ key: appSettings.templatePadrao })
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1))
        .limit(1);
      const rows = await db
        .select()
        .from(quotationTemplates)
        .where(active ? eq(quotationTemplates.archived, false) : undefined)
        .orderBy(quotationTemplates.key);
      return {
        default_key: settings?.key || 'padrao',
        templates: await Promise.all(
          rows.map(async (row) =>
            item(
              row,
              await current(db, row.id),
              row.key === (settings?.key || 'padrao'),
              await usage(db, row.id)
            )
          )
        ),
      };
    },
    async get(id) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(quotationTemplates)
        .where(eq(quotationTemplates.id, id))
        .limit(1);
      if (!row) return null;
      const version = await current(db, id);
      if (!version) return null;
      const [settings] = await db
        .select({ key: appSettings.templatePadrao })
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1))
        .limit(1);
      const versions = await db
        .select()
        .from(quotationTemplateVersions)
        .where(eq(quotationTemplateVersions.templateId, id))
        .orderBy(desc(quotationTemplateVersions.version));
      return {
        ...item(row, version, row.key === (settings?.key || 'padrao'), await usage(db, id)),
        current_source: version.source,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          source_hash: v.sourceHash,
          created_at: iso(v.createdAt),
        })),
      };
    },
    async validate(input) {
      const n = normalize(input, false);
      return preview(n.key, n.source);
    },
    async create(input) {
      const n = normalize(input);
      const db = getDb();
      try {
        return await db.transaction(async (tx) => {
          const id = randomUUID();
          const now = new Date();
          preview(n.key, n.source);
          await tx
            .insert(quotationTemplates)
            .values({ id, key: n.key, name: n.name, createdAt: now, updatedAt: now });
          await tx
            .insert(quotationTemplateVersions)
            .values({
              id: randomUUID(),
              templateId: id,
              version: 1,
              source: n.source,
              sourceHash: hash(n.source),
            });
          return { id };
        });
      } catch (e) {
        if (e instanceof QuotationTemplateLibraryInputError) throw e;
        if (String(e).includes('unique'))
          throw new QuotationTemplateLibraryInputError('A chave do template já está em uso.');
        throw e;
      }
    },
    async saveVersion(id, input) {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(quotationTemplates)
          .where(eq(quotationTemplates.id, id))
          .for('update')
          .limit(1);
        if (!row) throw new QuotationTemplateLibraryNotFoundError('Template não encontrado.');
        const n = normalize({
          key: row.key,
          name: input.name == null ? row.name : input.name,
          source: input.source,
        });
        preview(n.key, n.source);
        const sourceHash = hash(n.source);
        const existing = await tx
          .select()
          .from(quotationTemplateVersions)
          .where(
            and(
              eq(quotationTemplateVersions.templateId, id),
              eq(quotationTemplateVersions.sourceHash, sourceHash)
            )
          )
          .limit(1);
        if (existing[0]) return { id: existing[0].id };
        const [latest] = await tx
          .select({ version: max(quotationTemplateVersions.version) })
          .from(quotationTemplateVersions)
          .where(eq(quotationTemplateVersions.templateId, id));
        const version = Number(latest?.version || 0) + 1;
        await tx
          .insert(quotationTemplateVersions)
          .values({ id: randomUUID(), templateId: id, version, source: n.source, sourceHash });
        await tx
          .update(quotationTemplates)
          .set({ name: input.name?.trim() || row.name, updatedAt: new Date() })
          .where(eq(quotationTemplates.id, id));
        const [saved] = await tx
          .select({ id: quotationTemplateVersions.id })
          .from(quotationTemplateVersions)
          .where(
            and(
              eq(quotationTemplateVersions.templateId, id),
              eq(quotationTemplateVersions.version, version)
            )
          )
          .limit(1);
        return { id: saved.id };
      });
    },
    async archive(id) {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(quotationTemplates)
          .where(eq(quotationTemplates.id, id))
          .for('update')
          .limit(1);
        if (!row) throw new QuotationTemplateLibraryNotFoundError('Template não encontrado.');
        const [settings] = await tx
          .select({ key: appSettings.templatePadrao })
          .from(appSettings)
          .where(eq(appSettings.singletonId, 1))
          .limit(1);
        if (settings?.key === row.key)
          throw new QuotationTemplateLibraryConflictError(
            'Não é possível arquivar o template padrão.'
          );
        await tx
          .update(quotationTemplates)
          .set({ archived: true, updatedAt: new Date() })
          .where(eq(quotationTemplates.id, id));
        return { archived: true as const };
      });
    },
    async setDefault(id) {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(quotationTemplates)
          .where(eq(quotationTemplates.id, id))
          .for('update')
          .limit(1);
        if (!row) throw new QuotationTemplateLibraryNotFoundError('Template não encontrado.');
        if (row.archived)
          throw new QuotationTemplateLibraryConflictError(
            'Não é possível definir um template arquivado como padrão.'
          );
        await tx
          .insert(appSettings)
          .values({ singletonId: 1, templatePadrao: row.key })
          .onConflictDoUpdate({
            target: appSettings.singletonId,
            set: { templatePadrao: row.key },
          });
        return { default_key: row.key };
      });
    },
  };
}
