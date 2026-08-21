import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { whatsappContextCorsHeaders } from '../_http/whatsapp-context-cors.js';
import { createPostgresWhatsappCrmRepository } from './whatsapp-crm-match.js';
import type { LocalCrmCandidate } from './whatsapp-crm-match.js';
import { normalizeWhatsappPhone } from './whatsapp-conversations-store.js';
import { createHttpError } from '../_shared/http-error.js';

const MAX_DISPLAY_NAME_LENGTH = 200;
const CANDIDATE_LIMIT = 2;
const ALLOWED_METHOD = 'GET';

type ContextMatch = 'matched' | 'not_found' | 'ambiguous' | 'unresolved' | 'unsupported';

export interface WhatsappContextContact {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
}

export interface WhatsappContextData {
  identity: {
    displayName: string | null;
    phone: string | null;
    source: 'visible_contact' | null;
  };
  match: ContextMatch;
  contact: WhatsappContextContact | null;
  actions: {
    openContact: string | null;
    openNewContact: string | null;
  };
}

export interface WhatsappContextDependencies {
  findCandidatesByPhone?: (
    phone: string,
    limit: number
  ) => Promise<LocalCrmCandidate[]>;
  extensionOrigin?: string;
}

function cleanDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  let safe = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) safe += character;
  }
  return safe.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function normalizeContextPhone(value: unknown): string {
  return normalizeWhatsappPhone(value);
}

function responseHeaders(event: FunctionEvent, deps: WhatsappContextDependencies): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...whatsappContextCorsHeaders(
      Array.isArray(origin) ? origin[0] : origin,
      deps.extensionOrigin ?? process.env.WHATSAPP_CONTEXT_EXTENSION_ORIGIN
    ),
  };
}

function jsonResponse(
  event: FunctionEvent,
  deps: WhatsappContextDependencies,
  statusCode: number,
  body: unknown
): FunctionResult {
  return {
    statusCode,
    headers: responseHeaders(event, deps),
    body: JSON.stringify(body),
  };
}

const defaultFindCandidatesByPhone = async (
  phone: string,
  limit: number
): Promise<LocalCrmCandidate[]> => {
  const repository = createPostgresWhatsappCrmRepository();
  return (await repository.findCandidatesByPhone?.(phone, limit)) || [];
};

function newContactPath(displayName: string, phone: string): string {
  const params = new URLSearchParams();
  if (displayName) params.set('nome', displayName);
  if (phone) params.set('telefone', phone);
  const query = params.toString();
  return `/#/leads/cliente/new${query ? `?${query}` : ''}`;
}

function contactPath(candidate: LocalCrmCandidate, lookupPhone: string): string {
  if (candidate.tipo === 'lead') {
    const params = new URLSearchParams({ search: lookupPhone, status: 'all' });
    return `/#/leads?${params.toString()}`;
  }
  return `/#/leads/${candidate.tipo}/${encodeURIComponent(candidate.id)}`;
}

function uniqueCandidates(candidates: LocalCrmCandidate[]): LocalCrmCandidate[] {
  const unique = new Map<string, LocalCrmCandidate>();
  for (const candidate of candidates) {
    if (!candidate || !candidate.id || (candidate.tipo !== 'lead' && candidate.tipo !== 'cliente')) continue;
    unique.set(`${candidate.tipo}:${candidate.id}`, candidate);
  }
  return [...unique.values()].slice(0, CANDIDATE_LIMIT);
}

function contactFromCandidate(candidate: LocalCrmCandidate, lookupPhone: string): WhatsappContextContact {
  return {
    id: String(candidate.id),
    tipo: candidate.tipo,
    nome: cleanDisplayName(candidate.nome),
    telefone: normalizeContextPhone(candidate.telefone) || lookupPhone || null,
    email: typeof candidate.email === 'string' && candidate.email.trim() ? candidate.email.trim() : null,
  };
}

function baseData(displayName: string, phone: string): WhatsappContextData {
  return {
    identity: {
      displayName: displayName || null,
      phone: phone || null,
      source: phone ? 'visible_contact' : null,
    },
    match: phone ? 'not_found' : 'unresolved',
    contact: null,
    actions: {
      openContact: null,
      openNewContact: phone ? newContactPath(displayName, phone) : null,
    },
  };
}

export async function resolveWhatsappContext(input: {
  phone: unknown;
  displayName?: unknown;
  findCandidatesByPhone: (
    phone: string,
    limit: number
  ) => Promise<LocalCrmCandidate[]>;
}): Promise<WhatsappContextData> {
  const displayName = cleanDisplayName(input.displayName);
  const phone = normalizeContextPhone(input.phone);
  const data = baseData(displayName, phone);
  if (!phone) return data;

  let candidates: LocalCrmCandidate[];
  try {
    candidates = uniqueCandidates(await input.findCandidatesByPhone(phone, CANDIDATE_LIMIT));
  } catch {
    throw createHttpError(503, 'Não foi possível consultar o contexto comercial.');
  }

  if (candidates.length === 0) return data;
  if (candidates.length > 1) {
    data.match = 'ambiguous';
    data.actions.openNewContact = null;
    return data;
  }

  const candidate = candidates[0];
  data.match = 'matched';
  data.contact = contactFromCandidate(candidate, phone);
  data.identity.displayName = data.contact.nome || data.identity.displayName;
  data.actions.openContact = contactPath(candidate, phone);
  data.actions.openNewContact = null;
  return data;
}

function errorStatus(error: unknown): number {
  const value = error as { statusCode?: unknown } | null;
  return Number.isInteger(value?.statusCode) ? Number(value?.statusCode) : 500;
}

function errorMessage(error: unknown): string {
  const status = errorStatus(error);
  if (status >= 400 && status < 500 && error instanceof Error) return error.message;
  if (status === 503 && error instanceof Error) return error.message;
  return 'Não foi possível consultar o contexto comercial.';
}

export function createHandler(deps: WhatsappContextDependencies = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const findCandidatesByPhone = deps.findCandidatesByPhone || defaultFindCandidatesByPhone;

  return async (event: FunctionEvent): Promise<FunctionResult> => {
    try {
      if (String(event.httpMethod || '').toUpperCase() !== ALLOWED_METHOD) {
        return jsonResponse(event, deps, 405, { error: 'Método não permitido.' });
      }
      const data = await resolveWhatsappContext({
        phone: event.queryStringParameters?.phone,
        displayName: event.queryStringParameters?.name,
        findCandidatesByPhone,
      });
      return jsonResponse(event, deps, 200, { success: true, data });
    } catch (error) {
      const statusCode = errorStatus(error);
      console.error('[whatsapp-context]', error instanceof Error ? error.name : typeof error, statusCode);
      return jsonResponse(event, deps, statusCode, { error: errorMessage(error) });
    }
  };
}

export const handler = createHandler();
