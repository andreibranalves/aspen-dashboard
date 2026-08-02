import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  createPostgresProductsRepository,
  ProductRepositoryError,
  type ProductUpdateInput,
  type ProductsRepository,
} from '../_db/products-repository.js';
import { responseMetadata } from './products-mode.js';

export interface ProductUpdateCoreDependencies {
  repository: ProductsRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...responseMetadata('core') }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logError(error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[product-update-core] failed (${kind})`);
}

export function createCoreHandler(
  dependencies: ProductUpdateCoreDependencies = {
    repository: createPostgresProductsRepository(),
  }
): LegacyHandler {
  return async function productUpdateCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'PATCH' && event.httpMethod !== 'PUT') {
      return json(405, { error: 'Método não permitido.' });
    }

    const sku = (event.queryStringParameters?.sku || '').trim();
    if (!sku) return json(400, { error: 'SKU é obrigatório.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!isRecord(payload)) return json(400, { error: 'Envie campos válidos para atualização.' });

    // Pricing remains an ERPNext concern until the explicit pricing cutover.
    // Reject the key itself, including an empty/null array, so core products
    // can never silently acquire a zero or fabricated price.
    if (Object.prototype.hasOwnProperty.call(payload, 'precos')) {
      return json(409, { error: 'Preços ainda não estão disponíveis para produtos do catálogo principal.' });
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'sku')) {
      return json(400, { error: 'SKU não pode ser alterado.' });
    }

    const allowed = ['nome', 'descricao', 'categoria', 'unidade', 'marca', 'ativo'] as const;
    const patch: ProductUpdateInput = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        (patch as Record<string, unknown>)[key] = payload[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      return json(400, { error: 'Nenhum campo para atualizar.' });
    }

    try {
      const updated = await dependencies.repository.update(sku, patch);
      if (!updated) return json(404, { error: 'Produto não encontrado.' });
      return json(200, {
        success: true,
        sku: updated.sku,
        produto: {
          sku: updated.sku,
          nome: updated.nome,
          descricao: updated.descricao,
          categoria: updated.categoria,
          unidade: updated.unidade,
          marca: updated.marca,
          ativo: updated.ativo,
          criado_em: updated.criado_em,
          atualizado_em: updated.atualizado_em,
          arquivado_em: updated.arquivado_em,
        },
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
      return json(500, { error: 'Não foi possível atualizar o produto. Tente novamente.' });
    }
  };
}

export const handler = createCoreHandler();
