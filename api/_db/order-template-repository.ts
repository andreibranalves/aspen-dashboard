import { asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from './client.js';
import { orderTemplateItems, orderTemplates, products } from './schema.js';

export interface OrderTemplateItem {
  sku: string;
  name: string;
  position: number;
}

export interface OrderTemplateRecord {
  id: string;
  name: string;
  archived: boolean;
  items: OrderTemplateItem[];
  created_at: string;
  updated_at: string;
}

export interface OrderTemplateRepository {
  list(): Promise<OrderTemplateRecord[]>;
  get(id: string): Promise<OrderTemplateRecord | null>;
  getForExtraction(id: string): Promise<OrderTemplateRecord>;
  create(input: { name: string; skus: string[] }): Promise<{ id: string }>;
  update(id: string, input: { name: string; skus: string[] }): Promise<{ id: string }>;
  archive(id: string): Promise<{ archived: true }>;
}

export class OrderTemplateInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'OrderTemplateInputError';
  }
}

export class OrderTemplateNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'OrderTemplateNotFoundError';
  }
}

export class OrderTemplateConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'OrderTemplateConflictError';
  }
}

export class OrderTemplateRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message = 'Não foi possível acessar os templates de pedido.') {
    super(message);
    this.name = 'OrderTemplateRepositoryError';
  }
}

type DatabaseProvider = () => AppDatabase;
type DatabaseTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type DatabaseExecutor = AppDatabase | DatabaseTransaction;

type LoadedOrderTemplate = OrderTemplateRecord & {
  itemActivity: boolean[];
};

export function normalizeOrderTemplateInput(input: { name: unknown; skus: unknown }): {
  name: string;
  skus: string[];
} {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) throw new OrderTemplateInputError('Informe o nome do template de pedido.');
  if (name.length > 255) {
    throw new OrderTemplateInputError(
      'O nome do template de pedido deve ter no máximo 255 caracteres.'
    );
  }

  if (!Array.isArray(input?.skus) || input.skus.length === 0) {
    throw new OrderTemplateInputError('Adicione pelo menos um produto ao template de pedido.');
  }

  const skus = input.skus.map((sku) => (typeof sku === 'string' ? sku.trim() : ''));
  const invalid = skus.find((sku) => !sku);
  if (invalid !== undefined) {
    throw new OrderTemplateInputError('SKU de produto inválido.');
  }
  const tooLong = skus.find((sku) => sku.length > 120);
  if (tooLong) throw new OrderTemplateInputError('SKU deve ter no máximo 120 caracteres.');

  if (new Set(skus).size !== skus.length) {
    throw new OrderTemplateInputError('O template de pedido não pode conter SKUs duplicados.');
  }

  return { name, skus };
}

function asIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function isUniqueConstraint(error: unknown, constraint: string): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    const value = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (
      value.code === '23505' &&
      (value.constraint === constraint || value.constraint_name === constraint)
    ) {
      return true;
    }
    if (value.cause) pending.push(value.cause);
  }
  return false;
}

function rethrowRepositoryError(error: unknown): never {
  if (
    error instanceof OrderTemplateInputError ||
    error instanceof OrderTemplateNotFoundError ||
    error instanceof OrderTemplateConflictError ||
    error instanceof OrderTemplateRepositoryError
  ) {
    throw error;
  }
  if (isUniqueConstraint(error, 'order_templates_active_name_unique')) {
    throw new OrderTemplateConflictError('Já existe um template de pedido com este nome.');
  }
  throw new OrderTemplateRepositoryError();
}

async function validateProducts(db: DatabaseExecutor, skus: string[]): Promise<void> {
  const rows = await db.select().from(products).where(inArray(products.sku, skus));
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  for (const sku of skus) {
    const row = bySku.get(sku);
    if (!row || !row.ativo) {
      throw new OrderTemplateInputError(`SKU inexistente ou arquivado: ${sku}.`);
    }
  }
}

async function loadRecord(db: DatabaseExecutor, id: string): Promise<LoadedOrderTemplate | null> {
  const [template] = await db
    .select()
    .from(orderTemplates)
    .where(eq(orderTemplates.id, id))
    .limit(1);
  if (!template) return null;

  const rows = await db
    .select({
      sku: orderTemplateItems.sku,
      name: products.nome,
      position: orderTemplateItems.position,
      active: products.ativo,
    })
    .from(orderTemplateItems)
    .innerJoin(products, eq(orderTemplateItems.sku, products.sku))
    .where(eq(orderTemplateItems.templateId, id))
    .orderBy(asc(orderTemplateItems.position));

  return {
    id: template.id,
    name: template.name,
    archived: template.archived,
    items: rows.map(({ sku, name, position }) => ({ sku, name, position })),
    itemActivity: rows.map(({ active }) => active),
    created_at: asIso(template.createdAt),
    updated_at: asIso(template.updatedAt),
  };
}

function publicRecord(record: LoadedOrderTemplate): OrderTemplateRecord {
  return {
    id: record.id,
    name: record.name,
    archived: record.archived,
    items: record.items,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function createOrderTemplateRepository(
  getDb: DatabaseProvider = getDatabase
): OrderTemplateRepository {
  return {
    async list() {
      try {
        const db = getDb();
        const rows = await db
          .select({ id: orderTemplates.id })
          .from(orderTemplates)
          .where(eq(orderTemplates.archived, false))
          .orderBy(asc(orderTemplates.name));
        const records = await Promise.all(rows.map((row) => loadRecord(db, row.id)));
        return records
          .filter((record): record is LoadedOrderTemplate => record !== null)
          .map(publicRecord);
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async get(id) {
      try {
        const db = getDb();
        const record = await loadRecord(db, id.trim());
        return record ? publicRecord(record) : null;
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async getForExtraction(id) {
      try {
        const db = getDb();
        const record = await loadRecord(db, id.trim());
        if (!record) throw new OrderTemplateNotFoundError('Template de pedido não encontrado.');
        if (record.archived) {
          throw new OrderTemplateConflictError('O template de pedido selecionado foi arquivado.');
        }
        if (record.itemActivity.some((active) => !active)) {
          throw new OrderTemplateConflictError('O template de pedido contém um produto arquivado.');
        }
        return publicRecord(record);
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async create(input) {
      const normalized = normalizeOrderTemplateInput(input);
      try {
        const db = getDb();
        return await db.transaction(async (tx) => {
          await validateProducts(tx, normalized.skus);
          const id = randomUUID();
          const now = new Date();
          await tx
            .insert(orderTemplates)
            .values({ id, name: normalized.name, createdAt: now, updatedAt: now });
          await tx.insert(orderTemplateItems).values(
            normalized.skus.map((sku, position) => ({
              templateId: id,
              sku,
              position,
            }))
          );
          return { id };
        });
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async update(id, input) {
      const normalized = normalizeOrderTemplateInput(input);
      try {
        const db = getDb();
        return await db.transaction(async (tx) => {
          const [template] = await tx
            .select()
            .from(orderTemplates)
            .where(eq(orderTemplates.id, id.trim()))
            .for('update')
            .limit(1);
          if (!template) throw new OrderTemplateNotFoundError('Template de pedido não encontrado.');
          if (template.archived) {
            throw new OrderTemplateConflictError(
              'Não é possível editar um template de pedido arquivado.'
            );
          }

          await validateProducts(tx, normalized.skus);
          await tx
            .update(orderTemplates)
            .set({ name: normalized.name, updatedAt: new Date() })
            .where(eq(orderTemplates.id, template.id));
          await tx.delete(orderTemplateItems).where(eq(orderTemplateItems.templateId, template.id));
          await tx.insert(orderTemplateItems).values(
            normalized.skus.map((sku, position) => ({
              templateId: template.id,
              sku,
              position,
            }))
          );
          return { id: template.id };
        });
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },

    async archive(id) {
      try {
        const db = getDb();
        return await db.transaction(async (tx) => {
          const [template] = await tx
            .select()
            .from(orderTemplates)
            .where(eq(orderTemplates.id, id.trim()))
            .for('update')
            .limit(1);
          if (!template) throw new OrderTemplateNotFoundError('Template de pedido não encontrado.');
          await tx
            .update(orderTemplates)
            .set({ archived: true, updatedAt: new Date() })
            .where(eq(orderTemplates.id, template.id));
          return { archived: true as const };
        });
      } catch (error) {
        rethrowRepositoryError(error);
      }
    },
  };
}
