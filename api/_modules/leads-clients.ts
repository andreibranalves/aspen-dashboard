import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  buildCreateInput,
  jsonResponse,
  mapClientRow,
  normalizeCoreError,
  parseJsonBody,
  parseListOptions,
} from './client-core.js';
import { getClientRepository, type ClientRepository } from './client-repository.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface LeadsClientsHandlerDependencies {
  repository?: ClientRepository;
  core?: Handler;
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
        });
      }

      if (event.httpMethod === 'POST') {
        const payload = parseJsonBody(event);
        if (Object.prototype.hasOwnProperty.call(payload, 'tipo')) {
          const tipo = typeof payload.tipo === 'string' ? payload.tipo.trim().toLowerCase() : '';
          if (!tipo || (tipo !== 'lead' && tipo !== 'cliente')) {
            return jsonResponse(400, { error: 'Tipo inválido. Use "cliente".' });
          }
          // This route only owns the clients table. Leads are captured by the
          // ingestion flows (site-quote-leads / whatsapp-conversations) and by
          // CRM opportunities; manual lead-to-opportunity creation belongs to
          // #241, so accepting `tipo=lead` here would silently create a client
          // under a lead label.
          if (tipo === 'lead') {
            return jsonResponse(400, {
              error:
                'Este endpoint cadastra clientes. Leads são registrados pela captação do site, do WhatsApp e pelas oportunidades do CRM.',
            });
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
        });
      }

      if (event.httpMethod === 'DELETE') {
        const id = event.queryStringParameters?.id || event.queryStringParameters?.name;
        if (!id || !String(id).trim()) return jsonResponse(400, { error: 'ID não informado.' });
        const record = await repository.archive(String(id));
        return jsonResponse(200, {
          success: true,
          deleted: record.id,
          archived: true,
          arquivado: true,
          tipo: 'cliente',
          data: mapClientRow(record),
        });
      }

      return jsonResponse(405, { error: 'Método não permitido.' }, { Allow: 'GET, POST, DELETE' });
    } catch (error) {
      logCoreError(event.httpMethod, error);
      const normalized = normalizeCoreError(error);
      return jsonResponse(normalized.statusCode, normalized.body);
    }
  };
}

export function createHandler(dependencies: LeadsClientsHandlerDependencies = {}): Handler {
  return dependencies.core || createCoreHandler(dependencies);
}

export const handler = createHandler();
