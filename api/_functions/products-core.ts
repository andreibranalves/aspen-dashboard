import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresProductsRepository,
  ProductRepositoryError,
  type ProductCreateInput,
  type ProductListOptions,
  type ProductsRepository,
  type ProductStatus,
} from '../_db/products-repository.js';
import {
  createPostgresPricingRepository,
  type PricingRepository,
  type ProductPricingRecord,
} from '../_db/pricing-repository.js';
import { normalizeProductPricing, type PricingTierInput } from './pricing-core.js';
import {
  createPostgresProductCatalogRepository,
  type ProductCatalogRepository,
} from '../_db/product-catalog-repository.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductsCoreDependencies {
  repository: ProductsRepository;
  pricingRepository?: PricingRepository;
  catalogRepository?: ProductCatalogRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mapStatus(value: string | undefined): ProductStatus | null {
  const status = (value || 'active').trim().toLowerCase();
  return status === 'active' || status === 'archived' || status === 'all' ? status : null;
}

function logError(operation: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[products-core] ${operation} failed (${kind})`);
}

function errorResponse(operation: string, error: unknown): FunctionResult {
  logError(operation, error);
  if (error instanceof ProductRepositoryError && error.expose) {
    return json(error.statusCode, { error: error.message });
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (statusCode === 400 || statusCode === 404 || statusCode === 409 || statusCode === 503) {
    return json(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
  }
  return json(500, { error: 'Não foi possível processar o produto. Tente novamente.' });
}

export function createCoreHandler(
  dependencies: ProductsCoreDependencies = {
    repository: createPostgresProductsRepository(),
    pricingRepository: createPostgresPricingRepository(),
    catalogRepository: createPostgresProductCatalogRepository(),
  }
): Handler {
  return async function productsCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const status = mapStatus(params.status);
      if (!status) return json(400, { error: 'Status deve ser active, archived ou all.' });

      const page = parsePositiveInt(params.page, 1);
      const limit = Math.min(200, parsePositiveInt(params.limit, 50));
      const options: ProductListOptions = {
        status,
        page,
        limit,
        categoria: params.categoria?.trim() || undefined,
        search: params.search?.trim() || undefined,
        orderBy: params.order_by || 'modified desc',
      };

      try {
        const result = await dependencies.repository.list(options);
        const pricing = dependencies.pricingRepository
          ? dependencies.pricingRepository.list
            ? await dependencies.pricingRepository.list(result.rows.map((row) => row.sku))
            : new Map((await Promise.all(result.rows.map(async (row) => [row.sku, await dependencies.pricingRepository?.get(row.sku)] as const)))
              .filter((entry): entry is [string, ProductPricingRecord] => Boolean(entry[1])))
          : new Map<string, ProductPricingRecord>();
        return json(200, {
          data: result.rows.map((row) => ({
            sku: row.sku,
            nome: row.nome,
            descricao: row.descricao,
            unidade: row.unidade,
            ativo: row.ativo,
            preco_base: pricing.get(row.sku)?.preco_base ?? null,
            preco_minimo: pricing.get(row.sku)?.preco_minimo ?? null,
            pricing_available: pricing.get(row.sku)?.pricing_available === true,
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            total_pages: Math.ceil(result.total / result.limit) || 0,
          },
        });
      } catch (error) {
        return errorResponse('list', error);
      }
    }

    if (event.httpMethod === 'POST') {
      let payload: unknown;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return json(400, { error: 'JSON inválido.' });
      }
      if (!isRecord(payload)) return json(400, { error: 'Envie um produto válido.' });

      const input: ProductCreateInput = {
        sku: typeof payload.sku === 'string' ? payload.sku.trim() : '',
        nome: typeof payload.nome === 'string' ? payload.nome.trim() : '',
        descricao:
          payload.descricao === undefined ? undefined : String(payload.descricao ?? '').trim(),
        unidade:
          payload.unidade === undefined ? undefined : String(payload.unidade ?? '').trim(),
        categoria:
          payload.categoria === undefined || payload.categoria === null
            ? null
            : String(payload.categoria).trim(),
        marca:
          payload.marca === undefined || payload.marca === null ? null : String(payload.marca).trim(),
      };

      try {
        const hasPricing = Object.prototype.hasOwnProperty.call(payload, 'preco_base') || Object.prototype.hasOwnProperty.call(payload, 'precos');
        let normalizedPricing = null;
        const catalogRepository = dependencies.catalogRepository;
        if (hasPricing) {
          const rawTiers = payload.precos;
          if (rawTiers !== undefined && !Array.isArray(rawTiers)) {
            return json(400, { error: 'Preços deve ser um array.' });
          }
          // Validate before inserting the product so an invalid complete
          // pricing payload cannot leave a partially configured catalog row.
          normalizedPricing = normalizeProductPricing({
            preco_base: payload.preco_base === undefined ? null : payload.preco_base as string | number | null,
            precos: (rawTiers || []) as PricingTierInput[],
          });
          if (!catalogRepository) {
            return json(503, { error: 'O serviço de catálogo não está disponível. Tente novamente.' });
          }
        }
        const combined = catalogRepository
          ? await catalogRepository.create(
            input,
            hasPricing
              ? {
                preco_base: normalizedPricing?.preco_base ?? null,
                precos: normalizedPricing?.precos || [],
              }
              : undefined,
          )
          : null;
        const created = combined?.product || await dependencies.repository.create(input);
        const pricing = combined?.pricing || null;
        return json(201, {
          success: true,
          created: created.sku,
          produto: {
            sku: created.sku,
            nome: created.nome,
            descricao: created.descricao,
            unidade: created.unidade,
            categoria: created.categoria,
            marca: created.marca,
            ativo: created.ativo,
            criado_em: created.criado_em,
            atualizado_em: created.atualizado_em,
            arquivado_em: created.arquivado_em,
            ...(pricing ? { preco_base: pricing.preco_base } : {}),
          },
          ...(pricing ? { preco_base: pricing.preco_base, precos: pricing.precos, pricing_available: pricing.pricing_available } : {}),
        });
      } catch (error) {
        return errorResponse('create', error);
      }
    }

    if (event.httpMethod === 'DELETE') {
      const params = event.queryStringParameters || {};
      if (params.hard?.toLowerCase() === 'true' || params.permanent?.toLowerCase() === 'true') {
        return json(409, { error: 'Exclusão permanente não é permitida; arquive o produto.' });
      }
      const sku = (params.id || params.sku || '').trim();
      if (!sku) return json(400, { error: 'ID do produto não informado.' });
      try {
        const archived = dependencies.catalogRepository
          ? (await dependencies.catalogRepository.update(sku, { ativo: false }))?.product || null
          : await dependencies.repository.archive(sku);
        if (!archived) return json(404, { error: 'Produto não encontrado.' });
        return json(200, {
          success: true,
          deleted: sku,
          archived: true,
        });
      } catch (error) {
        return errorResponse('archive', error);
      }
    }

    return json(405, { error: 'Método não permitido.' });
  };
}

export const handler = createCoreHandler();
