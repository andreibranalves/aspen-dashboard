import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresProductActivityRepository,
  ProductActivityRepositoryError,
  type ProductActivityRepository,
} from '../_infrastructure/db/repositories/product-activity-repository.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductActivityHandlerDependencies {
  repository?: ProductActivityRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 10;
  if (typeof value !== 'string') {
    throw new ProductActivityRepositoryError(400, 'Limite deve ser um número inteiro válido.');
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new ProductActivityRepositoryError(400, 'Limite deve ser um número inteiro válido.');
  }
  if (!/^\d+$/.test(normalized)) {
    throw new ProductActivityRepositoryError(400, 'Limite deve ser um número inteiro válido.');
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ProductActivityRepositoryError(400, 'Limite deve ser maior que zero.');
  }
  return Math.min(20, parsed);
}

export function createHandler(
  dependencies: ProductActivityHandlerDependencies = {},
): Handler {
  const repository = dependencies.repository || createPostgresProductActivityRepository();
  return async function productActivityHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });

    const sku = (event.queryStringParameters?.sku || '').trim();
    if (!sku) return json(400, { error: 'SKU é obrigatório.' });

    try {
      const atividades = await repository.list(sku, parseLimit(event.queryStringParameters?.limit));
      return json(200, {
        sku,
        atividades: atividades.map(({ tipo, texto, data, id }) => ({ tipo, texto, data, id })),
      });
    } catch (error) {
      console.error('[product-activity]', error instanceof Error ? error.name : typeof error);
      if (error instanceof ProductActivityRepositoryError && error.expose) {
        return json(error.statusCode, { error: error.message });
      }
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
      if (statusCode === 400 || statusCode === 404 || statusCode === 409 || statusCode === 503) {
        return json(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
      }
      return json(503, { error: 'Não foi possível consultar a atividade do produto. Tente novamente.' });
    }
  };
}

export const handler = createHandler();
