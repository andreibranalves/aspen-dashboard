import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresClientCommercialRepository,
  type ClientCommercialRepository,
} from '../_infrastructure/db/repositories/client-commercial-repository.js';
import {
  buildPatchInput,
  findRequiredClient,
  jsonResponse,
  mapClientDetail,
  mergeAddressPatch,
  normalizeCoreError,
  parseJsonBody,
  type ClientCommercialContext,
} from './client-core.js';
import { getClientRepository, type ClientRepository } from './client-repository.js';
import { ClientInputError } from './client-schema.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

export type {
  ClientCommercialContext,
  ClientDealSummary,
  ClientOrderSummary,
  ClientQuotationSummary,
} from './client-core.js';
type Handler = (event: FunctionEvent) => Promise<FunctionResult>;
export type { ClientCommercialRepository } from '../_infrastructure/db/repositories/client-commercial-repository.js';

export interface ClientDetailHandlerDependencies {
  repository?: ClientRepository;
  commercial?: ClientCommercialRepository;
  core?: Handler;
}

function logCoreError(operation: string, error: unknown): void {
  const kind = safeErrorSummary(error);
  console.error(`[client-detail] core ${operation} failed (${kind})`);
}

async function readCommercial(
  commercial: ClientCommercialRepository,
  clientId: string
): Promise<ClientCommercialContext> {
  const [latestQuotation, deal, orders] = await Promise.all([
    commercial.latestQuotation(clientId),
    commercial.activeDeal(clientId),
    commercial.orders(clientId),
  ]);
  return { latestQuotation, deal, orders };
}

/** Unified UUID-backed client detail/update handler. */
export function createCoreHandler(
  dependencies: Pick<ClientDetailHandlerDependencies, 'repository' | 'commercial'> = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || getClientRepository();
  const commercial = dependencies.commercial || createPostgresClientCommercialRepository();
  return async function clientDetailCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      const name = String(event.queryStringParameters?.name || '').trim();
      if (!name) throw new ClientInputError('Parâmetro name é obrigatório.');

      if (event.httpMethod === 'GET') {
        const record = await findRequiredClient(repository, name);
        const context = await readCommercial(commercial, record.id);
        return jsonResponse(200, mapClientDetail(record, context));
      }

      if (event.httpMethod === 'PATCH' || event.httpMethod === 'PUT') {
        const payload = parseJsonBody(event);
        const parsed = buildPatchInput(payload);
        if (parsed.addressPresent) {
          const current = await findRequiredClient(repository, name);
          parsed.patch.address = mergeAddressPatch(current.address, parsed.addressValue);
        }
        const updated = await repository.update(name, parsed.patch);
        const context = await readCommercial(commercial, updated.id);
        return jsonResponse(200, { ...mapClientDetail(updated, context), updated: true });
      }

      if (event.httpMethod === 'DELETE') {
        await repository.delete(name);
        return jsonResponse(200, { deleted: true, id: name });
      }

      return jsonResponse(405, { error: 'Método não permitido.' }, { Allow: 'GET, PATCH, PUT, DELETE' });
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

