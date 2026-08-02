import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  createPostgresProductsRepository,
  ProductRepositoryError,
  type ProductsRepository,
} from '../_db/products-repository.js';
import { responseMetadata } from './products-mode.js';

export interface ProductDetailCoreDependencies {
  repository: ProductsRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...responseMetadata('core') }),
  };
}

function logError(error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[product-detail-core] failed (${kind})`);
}

export function createCoreHandler(
  dependencies: ProductDetailCoreDependencies = {
    repository: createPostgresProductsRepository(),
  }
): LegacyHandler {
  return async function productDetailCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    const sku = (event.queryStringParameters?.sku || '').trim();
    if (!sku) return json(400, { error: 'SKU é obrigatório.' });

    try {
      const row = await dependencies.repository.get(sku);
      if (!row) return json(404, { error: 'Produto não encontrado.' });
      return json(200, {
        produto: {
          sku: row.sku,
          nome: row.nome,
          descricao: row.descricao,
          categoria: row.categoria,
          unidade: row.unidade,
          marca: row.marca,
          ativo: row.ativo,
          imagem: null,
          criado_em: row.criado_em,
          atualizado_em: row.atualizado_em,
          arquivado_em: row.arquivado_em,
          // Existing UI uses this compatibility name for the last update.
          modificado_em: row.atualizado_em,
        },
        precos: [],
        pricing_available: false,
      });
    } catch (error) {
      logError(error);
      if (error instanceof ProductRepositoryError && error.expose) {
        return json(error.statusCode, { error: error.message });
      }
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
      if (statusCode === 400 || statusCode === 404 || statusCode === 409) {
        return json(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
      }
      return json(500, { error: 'Não foi possível buscar o produto. Tente novamente.' });
    }
  };
}

export const handler = createCoreHandler();
