import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import { productActivityEvents } from '../schema.js';

export const PRODUCT_ACTIVITY_TYPES = ['produto', 'preco', 'orcamento', 'pedido'] as const;
export type ProductActivityType = (typeof PRODUCT_ACTIVITY_TYPES)[number];

export interface ProductActivityEventInput {
  sku: string;
  tipo: ProductActivityType;
  texto: string;
  reference_id?: string | null;
  referenceId?: string | null;
  id?: string;
  created_at?: Date | string;
  createdAt?: Date | string;
}

export interface ProductActivityRecord {
  id: string;
  sku: string;
  tipo: ProductActivityType;
  texto: string;
  data: string;
  reference_id: string | null;
}

export class ProductActivityRepositoryError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(statusCode: number, message: string, expose = true) {
    super(message);
    this.name = 'ProductActivityRepositoryError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export interface ProductActivityRepository {
  appendMany(events: readonly ProductActivityEventInput[]): Promise<void>;
  list(sku: string, limit: number): Promise<ProductActivityRecord[]>;
}

type DatabaseProvider = () => AppDatabase;
type ActivityTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type ActivityDatabase = AppDatabase | ActivityTransaction;

function activityReferenceKey(row: { productSku: string; tipo: ProductActivityType; referenceId: string }): string {
  return `product-activity:${JSON.stringify([row.productSku, row.tipo, row.referenceId])}`;
}

async function lockReferences(database: ActivityDatabase, rows: readonly {
  productSku: string;
  tipo: ProductActivityType;
  referenceId: string;
}[]): Promise<void> {
  const keys = [...new Set(rows.map(activityReferenceKey))].sort();
  for (const key of keys) {
    // The lock is transaction-scoped. appendMany wraps its work in a
    // transaction, while aggregate writers pass their existing transaction.
    await database.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

function referenceUuid(sku: string, tipo: ProductActivityType, referenceId: string | null): string {
  if (!referenceId) return randomUUID();
  const hash = createHash('sha256').update(`${sku}\u0000${tipo}\u0000${referenceId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function normalizedDate(value: Date | string | undefined, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(fallback.getTime());
}

function normalizeEvents(events: readonly ProductActivityEventInput[]): Array<{
  id: string;
  productSku: string;
  tipo: ProductActivityType;
  texto: string;
  referenceId: string | null;
  createdAt: Date;
}> {
  const now = new Date();
  const seenReferences = new Set<string>();
  return events.flatMap((event, index) => {
    const sku = String(event.sku || '').trim();
    if (!sku) throw new ProductActivityRepositoryError(400, 'SKU é obrigatório.');
    if (sku.length > 120) {
      throw new ProductActivityRepositoryError(400, 'SKU deve ter no máximo 120 caracteres.');
    }
    if (!PRODUCT_ACTIVITY_TYPES.includes(event.tipo)) {
      throw new ProductActivityRepositoryError(400, 'Tipo de atividade inválido.');
    }
    const texto = String(event.texto || '').trim();
    if (!texto) throw new ProductActivityRepositoryError(400, 'Texto da atividade é obrigatório.');
    if (texto.length > 1000) {
      throw new ProductActivityRepositoryError(400, 'Texto da atividade deve ter no máximo 1000 caracteres.');
    }
    const referenceId = String(event.reference_id ?? event.referenceId ?? '').trim() || null;
    if (referenceId && referenceId.length > 255) {
      throw new ProductActivityRepositoryError(400, 'Referência da atividade deve ter no máximo 255 caracteres.');
    }
    if (referenceId) {
      const key = `${sku}\u0000${event.tipo}\u0000${referenceId}`;
      if (seenReferences.has(key)) return [];
      seenReferences.add(key);
    }
    const createdAt = normalizedDate(event.created_at ?? event.createdAt, new Date(now.getTime() + index));
    return [{
      id: event.id || referenceUuid(sku, event.tipo, referenceId),
      productSku: sku,
      tipo: event.tipo,
      texto,
      referenceId,
      createdAt,
    }];
  });
}

/** Append events using the caller's database or transaction object. */
export async function appendProductActivityEvents(
  database: ActivityDatabase,
  events: readonly ProductActivityEventInput[],
): Promise<void> {
  // Keep the exported helper safe for direct database callers too. Aggregate
  // writers pass a transaction (nestedIndex is 0); a root database must own
  // the select/insert pair in one transaction or the advisory lock is too
  // short-lived to close the race.
  if ((database as { nestedIndex?: number }).nestedIndex === undefined) {
    await database.transaction(async (tx) => {
      await appendProductActivityEvents(tx, events);
    });
    return;
  }
  const rows = normalizeEvents(events);
  if (rows.length === 0) return;

  const references = [...new Set(rows.map((row) => row.referenceId).filter((value): value is string => Boolean(value)))];
  const referenceRows = rows.flatMap((row) => row.referenceId
    ? [{ productSku: row.productSku, tipo: row.tipo, referenceId: row.referenceId }]
    : []);
  const existingReferences = new Set<string>();
  if (references.length > 0) {
    await lockReferences(database, referenceRows);
    const existing = await database
      .select({ sku: productActivityEvents.productSku, tipo: productActivityEvents.tipo, referenceId: productActivityEvents.referenceId })
      .from(productActivityEvents)
      .where(
        and(
          inArray(productActivityEvents.productSku, [...new Set(rows.map((row) => row.productSku))]),
          inArray(productActivityEvents.referenceId, references),
        ),
      );
    for (const row of existing) {
      if (row.referenceId) existingReferences.add(activityReferenceKey({
        productSku: row.sku,
        tipo: row.tipo as ProductActivityType,
        referenceId: row.referenceId,
      }));
    }
  }

  const pending = rows.filter((row) =>
    !row.referenceId || !existingReferences.has(activityReferenceKey({
      productSku: row.productSku,
      tipo: row.tipo,
      referenceId: row.referenceId,
    })),
  );
  if (pending.length === 0) return;

  await database
    .insert(productActivityEvents)
    .values(pending)
    .onConflictDoNothing();
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function toRecord(row: typeof productActivityEvents.$inferSelect): ProductActivityRecord {
  return {
    id: row.id,
    sku: row.productSku,
    tipo: row.tipo as ProductActivityType,
    texto: row.texto,
    data: iso(row.createdAt),
    reference_id: row.referenceId ?? null,
  };
}

export function createPostgresProductActivityRepository(
  getDb: DatabaseProvider = getDatabase,
): ProductActivityRepository {
  return {
    async appendMany(events): Promise<void> {
      try {
        await getDb().transaction(async (tx) => {
          await appendProductActivityEvents(tx, events);
        });
      } catch (error) {
        if (error instanceof ProductActivityRepositoryError) throw error;
        console.error('[product-activity-repository] append failed', error instanceof Error ? error.name : typeof error);
        throw new ProductActivityRepositoryError(503, 'Não foi possível registrar a atividade do produto.', false);
      }
    },

    async list(sku, limit): Promise<ProductActivityRecord[]> {
      const normalizedSku = String(sku || '').trim();
      if (!normalizedSku) return [];
      const normalizedLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 10));
      try {
        const rows = await getDb()
          .select()
          .from(productActivityEvents)
          .where(eq(productActivityEvents.productSku, normalizedSku))
          .orderBy(desc(productActivityEvents.createdAt), desc(productActivityEvents.id))
          .limit(normalizedLimit);
        return rows.map(toRecord);
      } catch (error) {
        console.error('[product-activity-repository] list failed', error instanceof Error ? error.name : typeof error);
        throw new ProductActivityRepositoryError(503, 'Não foi possível consultar a atividade do produto.', false);
      }
    },
  };
}

export const createProductActivityRepository = createPostgresProductActivityRepository;
