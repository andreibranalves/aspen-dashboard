import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { handler as legacyHandler } from './client-detail-legacy.js';
import {
  buildPatchInput,
  coreMeta,
  findRequiredClient,
  jsonResponse,
  legacyMeta,
  mapClientDetail,
  mergeAddressPatch,
  normalizeCoreError,
  parseJsonBody,
  withMeta,
} from './client-core.js';
import { getClientRepository, type ClientRepository } from './client-repository.js';
import { ClientInputError } from './client-schema.js';

export interface ClientDetailHandlerDependencies {
  repository?: ClientRepository;
  core?: (event: FunctionEvent) => Promise<FunctionResult>;
  legacy?: (event: FunctionEvent) => Promise<FunctionResult>;
}

function logCoreError(operation: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[client-detail] core ${operation} failed (${kind})`);
}

function validateOptionalDoctype(event: FunctionEvent): void {
  const doctype = event.queryStringParameters?.doctype;
  if (doctype !== undefined && doctype !== 'Customer' && doctype !== 'Lead') {
    throw new ClientInputError('Doctype inválido. Valores aceitos: Customer, Lead.');
  }
}

/** Unified UUID-backed client detail/update handler. */
export function createCoreHandler(dependencies: Pick<ClientDetailHandlerDependencies, 'repository'> = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || getClientRepository();
  return async function clientDetailCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      validateOptionalDoctype(event);
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
        return jsonResponse(200, { ...mapClientDetail(updated), updated: true, ...coreMeta() });
      }

      return jsonResponse(405, { error: 'Método não permitido.', ...coreMeta() }, { Allow: 'GET, PATCH, PUT' });
    } catch (error) {
      logCoreError(event.httpMethod, error);
      const normalized = normalizeCoreError(error);
      return jsonResponse(normalized.statusCode, { ...normalized.body, ...coreMeta() });
    }
  };
}

export function createHandler(dependencies: ClientDetailHandlerDependencies = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const core = dependencies.core || createCoreHandler(dependencies);
  return async function clientDetailHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (process.env.CRM_CORE_CLIENTS_ENABLED !== 'true') {
      const legacy = dependencies.legacy || legacyHandler;
      return withMeta(await legacy(event), legacyMeta());
    }
    return core(event);
  };
}

export const handler = createHandler();
