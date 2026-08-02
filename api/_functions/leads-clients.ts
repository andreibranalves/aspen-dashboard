import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { handler as legacyHandler } from './leads-clients-legacy.js';
import {
  buildCreateInput,
  coreMeta,
  jsonResponse,
  legacyMeta,
  mapClientRow,
  normalizeCoreError,
  parseJsonBody,
  parseListOptions,
  withMeta,
} from './client-core.js';
import { getClientRepository, type ClientRepository } from './client-repository.js';

export interface LeadsClientsHandlerDependencies {
  repository?: ClientRepository;
  core?: (event: FunctionEvent) => Promise<FunctionResult>;
  legacy?: (event: FunctionEvent) => Promise<FunctionResult>;
}

function logCoreError(operation: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[leads-clients] core ${operation} failed (${kind})`);
}

/** Core unified client list/create/archive handler. */
export function createCoreHandler(dependencies: Pick<LeadsClientsHandlerDependencies, 'repository'> = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || getClientRepository();
  return async function leadsClientsCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod === 'GET') {
        const options = parseListOptions(event);
        const result = await repository.list(options);
        return jsonResponse(200, {
          data: result.data.map(mapClientRow),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            total_pages: Math.ceil(result.total / result.limit) || 0,
          },
          ...coreMeta(),
        });
      }

      if (event.httpMethod === 'POST') {
        const payload = parseJsonBody(event);
        if (Object.prototype.hasOwnProperty.call(payload, 'tipo')) {
          const tipo = typeof payload.tipo === 'string' ? payload.tipo.trim().toLowerCase() : '';
          if (!tipo || (tipo !== 'lead' && tipo !== 'cliente')) {
            return jsonResponse(400, { error: 'Tipo inválido. Use "lead" ou "cliente".', ...coreMeta() });
          }
        }
        const record = await repository.create(buildCreateInput(payload));
        return jsonResponse(201, {
          success: true,
          created: record.id,
          id: record.id,
          name: record.id,
          tipo: 'cliente',
          data: mapClientRow(record),
          ...coreMeta(),
        });
      }

      if (event.httpMethod === 'DELETE') {
        const id = event.queryStringParameters?.id || event.queryStringParameters?.name;
        if (!id || !String(id).trim()) return jsonResponse(400, { error: 'ID não informado.', ...coreMeta() });
        const record = await repository.archive(String(id));
        return jsonResponse(200, {
          success: true,
          deleted: record.id,
          archived: true,
          arquivado: true,
          tipo: 'cliente',
          data: mapClientRow(record),
          ...coreMeta(),
        });
      }

      return jsonResponse(405, { error: 'Método não permitido.', ...coreMeta() }, { Allow: 'GET, POST, DELETE' });
    } catch (error) {
      logCoreError(event.httpMethod, error);
      const normalized = normalizeCoreError(error);
      return jsonResponse(normalized.statusCode, { ...normalized.body, ...coreMeta() });
    }
  };
}

export function createHandler(dependencies: LeadsClientsHandlerDependencies = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const core = dependencies.core || createCoreHandler(dependencies);
  return async function leadsClientsHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (process.env.CRM_CORE_CLIENTS_ENABLED !== 'true') {
      const legacy = dependencies.legacy || legacyHandler;
      return withMeta(await legacy(event), legacyMeta());
    }
    // Deliberately do not catch/redirect core failures to legacy. A failed
    // PostgreSQL request must remain observable as a core error.
    return core(event);
  };
}

export const handler = createHandler();
