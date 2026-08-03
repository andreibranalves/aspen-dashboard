import { desc, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from './client.js';
import { issuedDocuments, quoteRevisions, quotations } from './schema.js';
import {
  readQuotationTemplateSnapshot,
  type QuotationTemplateSnapshot,
} from './quotation-template-repository.js';

type DatabaseProvider = () => AppDatabase;
type QuoteTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type QuoteDatabase = AppDatabase | QuoteTransaction;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuotationDocumentNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;

  constructor(message = 'Orçamento ou documento emitido não encontrado.') {
    super(message);
    this.name = 'QuotationDocumentNotFoundError';
  }
}

export class QuotationDocumentConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'QuotationDocumentConflictError';
  }
}

export class QuotationDocumentRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message = 'Não foi possível registrar o documento emitido. Tente novamente.') {
    super(message);
    this.name = 'QuotationDocumentRepositoryError';
  }
}

export interface IssuedQuotationDocument {
  id: string;
  quotationId: string;
  revisionId: string;
  kind: string;
  blobPathname: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  templateKey: string;
  templateHash: string;
  createdAt: Date;
}

export interface QuotationEmissionSource {
  snapshot: QuotationTemplateSnapshot;
  document: IssuedQuotationDocument | null;
}

export interface CompleteQuotationEmissionInput {
  quotationId: string;
  revisionId: string;
  expectedUpdatedAt: string;
  blobPathname: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  checksumSha256: string;
  templateKey: string;
  templateHash: string;
}

export interface QuotationDocumentRepository {
  prepare(id: string): Promise<QuotationEmissionSource | null>;
  complete(input: CompleteQuotationEmissionInput): Promise<IssuedQuotationDocument>;
  find(id: string): Promise<IssuedQuotationDocument | null>;
}

export interface QuotationDocumentRepositoryOptions {
  now?: () => Date;
  randomId?: () => string;
}

function quoteWhere(id: string) {
  return UUID_PATTERN.test(id)
    ? or(eq(quotations.id, id), eq(quotations.businessNumber, id))
    : eq(quotations.businessNumber, id);
}

function asDocument(row: typeof issuedDocuments.$inferSelect): IssuedQuotationDocument {
  return {
    id: row.id,
    quotationId: row.quotationId,
    revisionId: row.revisionId,
    kind: row.kind,
    blobPathname: row.blobPathname,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    templateKey: row.templateKey,
    templateHash: row.templateHash,
    createdAt: row.createdAt,
  };
}

async function findByRevision(db: QuoteDatabase, revisionId: string): Promise<IssuedQuotationDocument | null> {
  const [row] = await db
    .select()
    .from(issuedDocuments)
    .where(eq(issuedDocuments.revisionId, revisionId))
    .limit(1);
  return row ? asDocument(row) : null;
}

async function findDocument(db: QuoteDatabase, id: string): Promise<IssuedQuotationDocument | null> {
  if (UUID_PATTERN.test(id)) {
    const [direct] = await db.select().from(issuedDocuments).where(eq(issuedDocuments.id, id)).limit(1);
    if (direct) return asDocument(direct);
  }
  const [quotation] = await db.select().from(quotations).where(quoteWhere(id)).limit(1);
  if (!quotation) return null;
  const [revision] = await db
    .select()
    .from(quoteRevisions)
    .where(eq(quoteRevisions.quotationId, quotation.id))
    .orderBy(desc(quoteRevisions.version))
    .limit(1);
  return revision ? findByRevision(db, revision.id) : null;
}

function isKnownError(error: unknown): boolean {
  return error instanceof QuotationDocumentNotFoundError
    || error instanceof QuotationDocumentConflictError
    || error instanceof QuotationDocumentRepositoryError;
}

function completedAt(now: () => Date, previous: Date): Date {
  const candidate = now();
  if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime()) || candidate.getTime() <= previous.getTime()) {
    return new Date(previous.getTime() + 1);
  }
  return candidate;
}

export function createQuotationDocumentRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuotationDocumentRepositoryOptions = {},
): QuotationDocumentRepository {
  const now = options.now || (() => new Date());
  const randomId = options.randomId || randomUUID;

  return {
    async prepare(id: string): Promise<QuotationEmissionSource | null> {
      const normalized = String(id || '').trim();
      if (!normalized) return null;
      try {
        const db = getDb();
        const snapshot = await readQuotationTemplateSnapshot(db, normalized);
        if (!snapshot) return null;
        return {
          snapshot,
          document: await findByRevision(db, snapshot.revision.id),
        };
      } catch (error) {
        if (isKnownError(error)) throw error;
        console.error(`[quotation-document-repository] prepare failed (${error instanceof Error ? error.name : typeof error})`);
        throw new QuotationDocumentRepositoryError('Não foi possível consultar a emissão do orçamento. Tente novamente.');
      }
    },

    async complete(input: CompleteQuotationEmissionInput): Promise<IssuedQuotationDocument> {
      try {
        return await getDb().transaction(async (tx) => {
          const [quotation] = await tx
            .select()
            .from(quotations)
            .where(eq(quotations.id, input.quotationId))
            .for('update')
            .limit(1);
          if (!quotation) throw new QuotationDocumentNotFoundError('Orçamento não encontrado.');

          const [revision] = await tx
            .select()
            .from(quoteRevisions)
            .where(eq(quoteRevisions.quotationId, quotation.id))
            .orderBy(desc(quoteRevisions.version))
            .for('update')
            .limit(1);
          if (!revision || revision.id !== input.revisionId) {
            throw new QuotationDocumentConflictError('A revisão do orçamento mudou durante a emissão. Tente novamente.');
          }

          const existing = await findByRevision(tx, revision.id);
          if (existing) {
            if (quotation.status !== 'emitido' || revision.status !== 'emitido') {
              throw new QuotationDocumentConflictError('O documento existente está inconsistente com o estado do orçamento.');
            }
            return existing;
          }

          if (quotation.status !== 'rascunho' || revision.status !== 'rascunho') {
            throw new QuotationDocumentConflictError('Somente revisões em rascunho podem ser emitidas.');
          }
          if (quotation.updatedAt.toISOString() !== input.expectedUpdatedAt) {
            throw new QuotationDocumentConflictError('O orçamento foi alterado durante a emissão. Tente novamente.');
          }
          if (revision.templatePadrao !== input.templateKey || revision.templateHash !== input.templateHash) {
            throw new QuotationDocumentConflictError('O template da revisão mudou durante a emissão. Tente novamente.');
          }

          const createdAt = completedAt(now, quotation.updatedAt);
          const [created] = await tx.insert(issuedDocuments).values({
            id: randomId(),
            quotationId: quotation.id,
            revisionId: revision.id,
            kind: 'quotation_pdf',
            blobPathname: input.blobPathname,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            checksumSha256: input.checksumSha256,
            templateKey: input.templateKey,
            templateHash: input.templateHash,
            createdAt,
          }).returning();
          if (!created) throw new QuotationDocumentRepositoryError();

          await tx.update(quoteRevisions).set({ status: 'emitido' }).where(eq(quoteRevisions.id, revision.id));
          await tx.update(quotations).set({ status: 'emitido', updatedAt: createdAt }).where(eq(quotations.id, quotation.id));
          return asDocument(created);
        });
      } catch (error) {
        if (isKnownError(error)) throw error;
        console.error(`[quotation-document-repository] complete failed (${error instanceof Error ? error.name : typeof error})`);
        throw new QuotationDocumentRepositoryError();
      }
    },

    async find(id: string): Promise<IssuedQuotationDocument | null> {
      const normalized = String(id || '').trim();
      if (!normalized) return null;
      try {
        return await findDocument(getDb(), normalized);
      } catch (error) {
        if (isKnownError(error)) throw error;
        console.error(`[quotation-document-repository] find failed (${error instanceof Error ? error.name : typeof error})`);
        throw new QuotationDocumentRepositoryError('Não foi possível consultar o documento emitido. Tente novamente.');
      }
    },
  };
}
