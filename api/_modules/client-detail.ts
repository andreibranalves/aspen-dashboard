import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  buildPatchInput,
  findRequiredClient,
  jsonResponse,
  mapClientDetail,
  mergeAddressPatch,
  normalizeCoreError,
  parseJsonBody,
} from './client-core.js';
import { getClientRepository, type ClientRepository } from './client-repository.js';
import { ClientInputError } from './client-schema.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ClientDetailHandlerDependencies {
  repository?: ClientRepository;
  core?: Handler;
}

function logCoreError(operation: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[client-detail] core ${operation} failed (${kind})`);
}

/** Unified UUID-backed client detail/update handler. */
export function createCoreHandler(dependencies: Pick<ClientDetailHandlerDependencies, 'repository'> = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || getClientRepository();
  return async function clientDetailCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      const name = String(event.queryStringParameters?.name || '').trim();
      if (!name) throw new ClientInputError('Parâmetro name é obrigatório.');

      if (event.httpMethod === 'GET') {
        const record = await findRequiredClient(repository, name);
        return jsonResponse(200, mapClientDetail(record));
      }

      if (event.httpMethod === 'PATCH' || event.httpMethod === 'PUT') {
        const payload = parseJsonBody(event);
        const parsed = buildPatchInput(payload);
        if (parsed.addressPresent) {
          const current = await findRequiredClient(repository, name);
          parsed.patch.address = mergeAddressPatch(current.address, parsed.addressValue);
        }
        const updated = await repository.update(name, parsed.patch);
        return jsonResponse(200, { ...mapClientDetail(updated), updated: true });
      }

      return jsonResponse(405, { error: 'Método não permitido.' }, { Allow: 'GET, PATCH, PUT' });
    } catch (error) {
      logCoreError(event.httpMethod, error);
      const normalized = normalizeCoreError(error);
      return jsonResponse(normalized.statusCode, normalized.body);
    }
  };
}

export function createHandler(dependencies: ClientDetailHandlerDependencies = {}): Handler {
  return dependencies.core || createCoreHandler(dependencies);
}

export const handler = createHandler();
