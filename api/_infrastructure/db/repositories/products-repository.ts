import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { productPricingTiers, products, salesOrderItems } from '../schema.js';
import { canonicalizeNonNegativeDecimal } from '../../../_shared/decimal-money.js';

export type ProductStatus = 'active' | 'archived' | 'all';

export interface ProductRecord {
  sku: string;
  nome: string;
  descricao: string;
  unidade: string;
  categoria: string | null;
  marca: string | null;
  /** Optional persisted base price; tiers are exposed by PricingRepository. */
  preco_base?: string | null;
  custo_unitario?: string | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
  arquivado_em: string | null;
}

export interface ProductCreateInput {
  sku: string;
  nome: string;
  descricao?: string;
  unidade?: string;
  categoria?: string | null;
  marca?: string | null;
  preco_base?: string | number | null;
  custo_unitario?: string | number | null;
}

export interface ProductUpdateInput {
  nome?: string;
  descricao?: string;
  unidade?: string;
  categoria?: string | null;
  marca?: string | null;
  ativo?: boolean;
  preco_base?: string | number | null;
  custo_unitario?: string | number | null;
}

export interface ProductListOptions {
  status?: ProductStatus;
  page?: number;
  limit?: number;
  categoria?: string;
  search?: string;
  orderBy?: string;
}

export interface ProductListResult {
  rows: ProductRecord[];
  total: number;
  page: number;
  limit: number;
}

export class ProductRepositoryError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(statusCode: number, message: string, expose = true) {
    super(message);
    this.name = 'ProductRepositoryError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export interface ProductsRepository {
  list(options?: ProductListOptions): Promise<ProductListResult>;
  get(sku: string): Promise<ProductRecord | null>;
  create(input: ProductCreateInput): Promise<ProductRecord>;
  update(sku: string, patch: ProductUpdateInput): Promise<ProductRecord | null>;
  archive(sku: string): Promise<ProductRecord | null>;
}

export type ProductRepository = ProductsRepository;

type DatabaseProvider = () => AppDatabase;

export async function listActiveProductCategories(
  getDb: DatabaseProvider = getDatabase
): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ categoria: products.categoria })
    .from(products)
    .where(and(eq(products.ativo, true), isNotNull(products.categoria)))
    .orderBy(asc(products.categoria));
  return rows
    .map((row) => row.categoria?.trim())
    .filter((categoria): categoria is string => Boolean(categoria));
}

function asIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

export function toProductRecord(row: typeof products.$inferSelect): ProductRecord {
  return {
    sku: row.sku,
    nome: row.nome,
    descricao: row.descricao,
    unidade: row.unidade,
    categoria: row.categoria ?? null,
    marca: row.marca ?? null,
    preco_base: row.precoBase ?? null,
    custo_unitario: row.custoUnitario ?? null,
    ativo: row.ativo,
    criado_em: asIso(row.criadoEm),
    atualizado_em: asIso(row.atualizadoEm),
    arquivado_em: row.arquivadoEm ? asIso(row.arquivadoEm) : null,
  };
}


function normalizeCustoUnitario(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new ProductRepositoryError(
        400,
        'Informe um custo unitário não negativo com até duas casas decimais.'
      );
    }
    value = value.toFixed(2);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const canonical = canonicalizeNonNegativeDecimal(trimmed, { maxIntegerDigits: 12 });
  if (!canonical) {
    throw new ProductRepositoryError(
      400,
      'Informe um custo unitário não negativo com até duas casas decimais.'
    );
  }
  return canonical;
}

async function backfillUnsnapshottedOrderItemCosts(
  db: AppDatabase,
  sku: string,
  custoUnitario: string
): Promise<void> {
  await db
    .update(salesOrderItems)
    .set({ custoUnitario })
    .where(and(eq(salesOrderItems.productSku, sku), isNull(salesOrderItems.custoUnitario)));
}

function normalizeSku(sku: string): string {
  return String(sku || '').trim();
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function normalizeProductCreateInput(input: ProductCreateInput): ProductCreateInput {
  const sku = normalizeSku(input.sku);
  const nome = String(input.nome || '').trim();
  if (!sku) throw new ProductRepositoryError(400, 'SKU é obrigatório.');
  if (sku.length > 120) throw new ProductRepositoryError(400, 'SKU deve ter no máximo 120 caracteres.');
  if (!nome) throw new ProductRepositoryError(400, 'Nome do produto é obrigatório.');
  if (nome.length > 255) {
    throw new ProductRepositoryError(400, 'Nome do produto deve ter no máximo 255 caracteres.');
  }

  const descricao = String(input.descricao ?? '').trim();
  if (descricao.length > 4000) {
    throw new ProductRepositoryError(400, 'Descrição deve ter no máximo 4000 caracteres.');
  }
  const unidade = String(input.unidade ?? 'Und').trim() || 'Und';
  if (unidade.length > 32) {
    throw new ProductRepositoryError(400, 'Unidade deve ter no máximo 32 caracteres.');
  }
  const categoria = normalizeText(input.categoria);
  const marca = normalizeText(input.marca);
  if (categoria && categoria.length > 255) {
    throw new ProductRepositoryError(400, 'Categoria deve ter no máximo 255 caracteres.');
  }
  if (marca && marca.length > 255) {
    throw new ProductRepositoryError(400, 'Marca deve ter no máximo 255 caracteres.');
  }

  return { sku, nome, descricao, unidade, categoria, marca, preco_base: input.preco_base, custo_unitario: normalizeCustoUnitario(input.custo_unitario) };
}

export function normalizeProductUpdateInput(patch: ProductUpdateInput): ProductUpdateInput {
  const normalized: ProductUpdateInput = {};
  if (patch.nome !== undefined) {
    const nome = String(patch.nome).trim();
    if (!nome) throw new ProductRepositoryError(400, 'Nome do produto não pode ficar vazio.');
    if (nome.length > 255) {
      throw new ProductRepositoryError(400, 'Nome do produto deve ter no máximo 255 caracteres.');
    }
    normalized.nome = nome;
  }
  if (patch.descricao !== undefined) {
    const descricao = String(patch.descricao).trim();
    if (descricao.length > 4000) {
      throw new ProductRepositoryError(400, 'Descrição deve ter no máximo 4000 caracteres.');
    }
    normalized.descricao = descricao;
  }
  if (patch.unidade !== undefined) {
    const unidade = String(patch.unidade).trim();
    if (!unidade) throw new ProductRepositoryError(400, 'Unidade não pode ficar vazia.');
    if (unidade.length > 32) {
      throw new ProductRepositoryError(400, 'Unidade deve ter no máximo 32 caracteres.');
    }
    normalized.unidade = unidade;
  }
  if (patch.categoria !== undefined) {
    const categoria = normalizeText(patch.categoria);
    if (categoria && categoria.length > 255) {
      throw new ProductRepositoryError(400, 'Categoria deve ter no máximo 255 caracteres.');
    }
    normalized.categoria = categoria;
  }
  if (patch.marca !== undefined) {
    const marca = normalizeText(patch.marca);
    if (marca && marca.length > 255) {
      throw new ProductRepositoryError(400, 'Marca deve ter no máximo 255 caracteres.');
    }
    normalized.marca = marca;
  }
  if (patch.ativo !== undefined) {
    if (typeof patch.ativo !== 'boolean') {
      throw new ProductRepositoryError(400, 'Ativo deve ser booleano.');
    }
    normalized.ativo = patch.ativo;
  }
  // Pricing writes are normally handled by PricingRepository so tier/base
  // replacement can be atomic. Keep this field optional for repository users
  // that only need to update the product row itself.
  if (patch.preco_base !== undefined) normalized.preco_base = patch.preco_base;
  if (patch.custo_unitario !== undefined) {
    normalized.custo_unitario = normalizeCustoUnitario(patch.custo_unitario);
  }
  return normalized;
}

function mapOrderBy(value: string | undefined): SQL {
  const safe = (value || 'modified desc').trim().toLowerCase();
  const map: Record<string, SQL> = {
    'item_name asc': asc(products.nome),
    'item_name desc': desc(products.nome),
    'item_code asc': asc(products.sku),
    'item_code desc': desc(products.sku),
    'modified asc': asc(products.atualizadoEm),
    'modified desc': desc(products.atualizadoEm),
    'nome asc': asc(products.nome),
    'nome desc': desc(products.nome),
    'sku asc': asc(products.sku),
    'sku desc': desc(products.sku),
    'atualizado_em asc': asc(products.atualizadoEm),
    'atualizado_em desc': desc(products.atualizadoEm),
  };
  return map[safe] || desc(products.atualizadoEm);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildWhere(options: ProductListOptions): SQL | undefined {
  const status = options.status || 'active';
  const conditions: SQL[] = [];
  if (status === 'active') conditions.push(eq(products.ativo, true));
  if (status === 'archived') conditions.push(eq(products.ativo, false));
  if (options.categoria?.trim()) conditions.push(eq(products.categoria, options.categoria.trim()));
  if (options.search?.trim()) {
    const pattern = `%${escapeLike(options.search.trim())}%`;
    conditions.push(or(ilike(products.sku, pattern), ilike(products.nome, pattern))!);
  }
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

export async function listProductsForExport(
  options: ProductListOptions,
  limit: number,
  getDb: DatabaseProvider = getDatabase
) {
  return getDb()
    .select({
      sku: products.sku,
      nome: products.nome,
      descricao: products.descricao,
      unidade: products.unidade,
      categoria: products.categoria,
      marca: products.marca,
      precoBase: products.precoBase,
      custoUnitario: products.custoUnitario,
      ativo: products.ativo,
      criadoEm: products.criadoEm,
      atualizadoEm: products.atualizadoEm,
      arquivadoEm: products.arquivadoEm,
    })
    .from(products)
    .where(buildWhere(options))
    .orderBy(mapOrderBy(options.orderBy))
    .limit(limit);
}

export async function listProductPricingForExport(
  options: ProductListOptions,
  limit: number,
  getDb: DatabaseProvider = getDatabase
) {
  return getDb()
    .select({
      productSku: productPricingTiers.productSku,
      productName: products.nome,
      minimumQuantity: productPricingTiers.minimumQuantity,
      unitPrice: productPricingTiers.unitPrice,
      criadoEm: productPricingTiers.criadoEm,
      atualizadoEm: productPricingTiers.atualizadoEm,
    })
    .from(productPricingTiers)
    .innerJoin(products, eq(productPricingTiers.productSku, products.sku))
    .where(buildWhere(options))
    .orderBy(mapOrderBy(options.orderBy), asc(productPricingTiers.minimumQuantity))
    .limit(limit);
}

/**
 * Drizzle wraps postgres.js errors as `Error.cause`, so inspect the bounded
 * cause chain before deciding whether a SKU conflict is safe to expose.
 * Matching SQLSTATE/constraint metadata (instead of error text) keeps the
 * Portuguese response stable and never leaks database details.
 */
export function isDuplicateProductError(error: unknown): boolean {
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
      value.code === '23505' ||
      value.constraint === 'products_pkey' ||
      value.constraint_name === 'products_pkey'
    ) {
      return true;
    }
    if (value.cause && typeof value.cause === 'object') pending.push(value.cause);
  }

  return false;
}

/** PostgreSQL implementation. The provider seam keeps handlers import-safe and testable. */
export function createPostgresProductsRepository(
  getDb: DatabaseProvider = getDatabase
): ProductsRepository {
  return {
    async list(options = {}): Promise<ProductListResult> {
      const page = Math.max(1, Math.floor(options.page || 1));
      const limit = Math.min(200, Math.max(1, Math.floor(options.limit || 50)));
      const where = buildWhere(options);
      const db = getDb();
      const rows = await db
        .select()
        .from(products)
        .where(where)
        .orderBy(mapOrderBy(options.orderBy))
        .limit(limit)
        .offset((page - 1) * limit);
      const [totalRow] = await db.select({ total: count() }).from(products).where(where);
      return {
        rows: rows.map(toProductRecord),
        total: Number(totalRow?.total || 0),
        page,
        limit,
      };
    },

    async get(sku: string): Promise<ProductRecord | null> {
      const normalizedSku = normalizeSku(sku);
      if (!normalizedSku) return null;
      const db = getDb();
      const [row] = await db.select().from(products).where(eq(products.sku, normalizedSku)).limit(1);
      return row ? toProductRecord(row) : null;
    },

    async create(input: ProductCreateInput): Promise<ProductRecord> {
      const normalized = normalizeProductCreateInput(input);
      const db = getDb();
      try {
        const [row] = await db
          .insert(products)
          .values({
            sku: normalized.sku,
            nome: normalized.nome,
            descricao: normalized.descricao,
            unidade: normalized.unidade,
            categoria: normalized.categoria,
            marca: normalized.marca,
            precoBase: normalized.preco_base == null ? null : String(normalized.preco_base),
            custoUnitario: normalized.custo_unitario == null ? null : String(normalized.custo_unitario),
            ativo: true,
            arquivadoEm: null,
          })
          .returning();
        if (!row) throw new Error('empty insert result');
        return toProductRecord(row);
      } catch (error) {
        if (isDuplicateProductError(error)) throw new ProductRepositoryError(409, 'SKU já cadastrado.');
        throw new ProductRepositoryError(500, 'Não foi possível criar o produto.', false);
      }
    },

    async update(sku: string, patch: ProductUpdateInput): Promise<ProductRecord | null> {
      const normalizedSku = normalizeSku(sku);
      const normalized = normalizeProductUpdateInput(patch);
      const keys = Object.keys(normalized) as (keyof ProductUpdateInput)[];
      if (!normalizedSku) return null;
      if (keys.length === 0) return this.get(normalizedSku);

      const values: Record<string, unknown> = {
        atualizadoEm: new Date(),
      };
      for (const key of keys) {
        const value = normalized[key];
        if (key === 'nome') values.nome = value;
        if (key === 'descricao') values.descricao = value;
        if (key === 'unidade') values.unidade = value;
        if (key === 'categoria') values.categoria = value;
        if (key === 'marca') values.marca = value;
        if (key === 'preco_base') values.precoBase = value == null ? null : String(value);
        if (key === 'custo_unitario') values.custoUnitario = value == null ? null : String(value);
        if (key === 'ativo') {
          values.ativo = value;
          values.arquivadoEm = value === false ? new Date() : null;
        }
      }

      const db = getDb();
      try {
        const [row] = await db
          .update(products)
          .set(values as Partial<typeof products.$inferInsert>)
          .where(eq(products.sku, normalizedSku))
          .returning();
        if (row && normalized.custo_unitario) {
          await backfillUnsnapshottedOrderItemCosts(
            db,
            normalizedSku,
            String(normalized.custo_unitario)
          );
        }
        return row ? toProductRecord(row) : null;
      } catch {
        throw new ProductRepositoryError(500, 'Não foi possível atualizar o produto.', false);
      }
    },

    async archive(sku: string): Promise<ProductRecord | null> {
      const existing = await this.get(sku);
      if (!existing) return null;
      if (!existing.ativo) return existing;
      return this.update(existing.sku, { ativo: false });
    },
  };
}
