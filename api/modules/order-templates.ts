import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import {
  createOrderTemplateRepository,
  type OrderTemplateRepository,
} from '../infrastructure/db/repositories/order-template-repository.js';

function json(statusCode: number, payload: object): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(event: FunctionEvent): Record<string, unknown> | null {
  try {
    const value = JSON.parse(event.body || '{}');
    return record(value) ? value : null;
  } catch {
    return null;
  }
}

function toInput(input: Record<string, unknown>): { name: string; skus: string[] } {
  return {
    name: String(input.name || ''),
    skus: Array.isArray(input.skus) ? input.skus.map((sku) => String(sku)) : [],
  };
}

function errorResponse(error: unknown): FunctionResult {
  const typed = error as { statusCode?: number; expose?: boolean; message?: string };
  if (Number.isInteger(typed.statusCode) && typed.expose === true) {
    return json(typed.statusCode!, { error: typed.message || 'Requisição inválida.' });
  }

  console.error(
    '[order-templates] request failed',
    error instanceof Error ? error.name : typeof error
  );
  return json(503, {
    error: 'Não foi possível processar os templates de pedido. Tente novamente.',
  });
}

export interface OrderTemplatesDependencies {
  repository: OrderTemplateRepository;
}

export function createOrderTemplatesHandler(
  dependencies: OrderTemplatesDependencies = {
    repository: createOrderTemplateRepository(),
  }
): LegacyHandler {
  return async (event) => {
    try {
      if (event.httpMethod === 'GET') {
        return json(200, { data: await dependencies.repository.list() });
      }

      if (event.httpMethod === 'POST') {
        const input = parseBody(event);
        if (!input) return json(400, { error: 'JSON inválido.' });
        return json(201, await dependencies.repository.create(toInput(input)));
      }

      if (event.httpMethod === 'PUT') {
        const id = event.queryStringParameters?.id?.trim();
        if (!id) return json(400, { error: 'ID do template de pedido não informado.' });
        const input = parseBody(event);
        if (!input) return json(400, { error: 'JSON inválido.' });
        return json(200, await dependencies.repository.update(id, toInput(input)));
      }

      if (event.httpMethod === 'DELETE') {
        const id = event.queryStringParameters?.id?.trim();
        if (!id) return json(400, { error: 'ID do template de pedido não informado.' });
        return json(200, await dependencies.repository.archive(id));
      }

      return json(405, { error: 'Método não permitido.' });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createOrderTemplatesHandler();

export const orderTemplatesHandler = handler;
