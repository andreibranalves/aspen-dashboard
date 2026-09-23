// Commercial context panel of the Atendimento (M2, spec §7 and §14). It adapts
// the local conversation to the context service the extension already uses, so
// both read and write the same client links; no CORS and no parallel identity.

import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresWhatsappAttendanceRepository,
  type WhatsappAttendanceRepository,
  type WhatsappConversationScope,
} from '../_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { readConnectedAccountId } from '../_infrastructure/integrations/evolution/account.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import { conversationId as technicalConversationId } from '../_shared/contact-phone.js';
import {
  resolveWhatsappContext,
  type WhatsappContextHandlerDependencies,
  type WhatsappContextRequest,
  type WhatsappContextResult,
} from './whatsapp-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEARCH_CHARS = 100;

export interface AtendimentoContextDependencies {
  repository?: Pick<WhatsappAttendanceRepository, 'getConversationScope'>;
  /** Phone JID of the connected account; '' when unknown. */
  accountId?: () => Promise<string>;
  instance?: () => string;
  context?: WhatsappContextHandlerDependencies;
}

class InputError extends Error {}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw new InputError('Conversa inválida.');
  return value.trim().toLowerCase();
}

function parseBody(event: FunctionEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.body || '');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // handled below
  }
  throw new InputError('Corpo da requisição inválido.');
}

/**
 * Only transport evidence reaches the context service. The display name is
 * presentation and never selects or confirms a client.
 */
function contextRequest(
  scope: WhatsappConversationScope,
  accountId: string,
  method: WhatsappContextRequest['method'],
  search = '',
  body?: string,
): WhatsappContextRequest | null {
  if (scope.identityStatus === 'conflict') return null;
  const technicalId = technicalConversationId(scope.providerConversationId);
  const phone = scope.identityStatus === 'unresolved' ? '' : scope.canonicalPhone || '';
  return {
    method,
    scope: accountId && technicalId ? { accountId, conversationId: technicalId } : null,
    technicalId,
    phone,
    phoneTrusted: scope.identityStatus === 'verified',
    search,
    body,
  };
}

const IDENTITY_CONFLICT_CONTEXT = {
  match: 'conflict',
  reason: 'A identidade desta conversa está em conflito. Revise antes de vincular.',
  linking: { available: false, version: null },
  candidates: [],
};

export function createAtendimentoContextHandlers(dependencies: AtendimentoContextDependencies = {}) {
  const repository = () => dependencies.repository || createPostgresWhatsappAttendanceRepository();
  const accountId = dependencies.accountId || (() => readConnectedAccountId());
  const instance = dependencies.instance || (() => getEvolutionConfig().instance);

  // A conversation of another instance is not scoped by the connected
  // account: its links stay out of reach instead of being presumed equal.
  async function load(id: string): Promise<{ scope: WhatsappConversationScope; accountId: string } | null> {
    const scope = await repository().getConversationScope(id);
    if (!scope) return null;
    return { scope, accountId: scope.instance === instance().trim() ? await accountId() : '' };
  }

  async function read(loaded: { scope: WhatsappConversationScope; accountId: string }, search = '') {
    const request = contextRequest(loaded.scope, loaded.accountId, 'GET', search);
    if (!request) return { statusCode: 200, body: IDENTITY_CONFLICT_CONTEXT } as WhatsappContextResult;
    return resolveWhatsappContext(request, dependencies.context);
  }

  function project(result: WhatsappContextResult): FunctionResult {
    return result.statusCode === 200 ? json(200, { context: result.body }) : json(result.statusCode, result.body);
  }

  async function guard(run: () => Promise<FunctionResult>, failure: string): Promise<FunctionResult> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof InputError) return json(400, { error: error.message });
      console.error('[atendimento-context]', error instanceof Error ? error.name : typeof error);
      return json(503, { error: failure });
    }
  }

  /** GET /api/atendimento-context?conversationId=…[&search=…] */
  async function context(event: FunctionEvent): Promise<FunctionResult> {
    if (String(event.httpMethod || '').toUpperCase() !== 'GET') return json(405, { error: 'Método não permitido.' });
    return guard(async () => {
      const id = parseId(event.queryStringParameters?.conversationId);
      const search = String(event.queryStringParameters?.search || '').trim();
      if (search && (search.length < 2 || search.length > MAX_SEARCH_CHARS)) {
        throw new InputError('Informe de 2 a 100 caracteres para pesquisar.');
      }
      const loaded = await load(id);
      if (!loaded) return json(404, { error: 'Conversa não encontrada.' });
      return project(await read(loaded, search));
    }, 'Não foi possível consultar o contexto comercial.');
  }

  /** POST /api/atendimento-client-link */
  async function link(event: FunctionEvent): Promise<FunctionResult> {
    if (String(event.httpMethod || '').toUpperCase() !== 'POST') return json(405, { error: 'Método não permitido.' });
    return guard(async () => {
      const body = parseBody(event);
      const id = parseId(body.conversationId);
      if (body.action !== 'confirm' && body.action !== 'remove') throw new InputError('Ação inválida.');
      const loaded = await load(id);
      if (!loaded) return json(404, { error: 'Conversa não encontrada.' });
      const request = contextRequest(
        loaded.scope,
        loaded.accountId,
        body.action === 'confirm' ? 'PUT' : 'DELETE',
        '',
        JSON.stringify({
          clientId: body.clientId,
          expectedVersion: body.expectedVersion ?? null,
          expectedClientName: body.expectedClientName,
          expectedClientPhone: body.expectedClientPhone ?? null,
        }),
      );
      const result: WhatsappContextResult = request
        ? await resolveWhatsappContext(request, dependencies.context)
        : { statusCode: 409, body: { error: 'Confirme a conta e a conversa antes de vincular.' } };
      if (result.statusCode === 200) return project(await read(loaded));
      if (result.statusCode !== 409) return json(result.statusCode, result.body);
      // A refused link answers with the current context, so the panel shows
      // what changed instead of retrying the old confirmation.
      const fresh = await read(loaded);
      return json(409, {
        code: 'CLIENT_LINK_CONFLICT',
        error: result.linkConflict
          ? 'O vínculo ou o cadastro mudou desde que o painel foi aberto. Confira o contexto atual.'
          : String(result.body.error || 'Não foi possível vincular esta conversa.'),
        ...(fresh.statusCode === 200 ? { context: fresh.body } : {}),
      });
    }, 'Não foi possível atualizar o vínculo.');
  }

  return { context, link };
}

const handlers = createAtendimentoContextHandlers();
export const atendimentoContext = handlers.context;
export const atendimentoClientLink = handlers.link;
