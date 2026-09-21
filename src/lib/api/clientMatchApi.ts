// Client identity transport for the automatic Split Card.
//
// `POST /api/client-matches` is the read-only matching query; the existing
// `GET /api/client-detail` revalidates a client already linked to a restored
// draft. Neither call creates clients, opportunities or quotations.

export type ClientMatchStatus = 'matched' | 'review' | 'not_found' | 'insufficient';
export type ClientMatchReason =
  | 'multiple_matches'
  | 'identifier_conflict'
  | 'archived_match'
  | 'weak_matches_only';
export type ClientMatchField = 'documento' | 'email' | 'telefone' | 'nome' | 'empresa';

export interface ClientMatchCandidate {
  id: string;
  nome: string;
  empresa: string | null;
  /** Masked by the backend: the complete value only travels in the snapshot. */
  documento: string | null;
  email: string | null;
  telefone: string | null;
  arquivado: boolean;
  matched_by: ClientMatchField[];
}

export interface ClientMatchResponse {
  status: ClientMatchStatus;
  reason?: ClientMatchReason;
  matched_client_id: string | null;
  candidates: ClientMatchCandidate[];
  total_candidates: number;
  page: number;
  has_more: boolean;
}

export interface ClientMatchRequest {
  nome?: string;
  empresa?: string;
  email?: string | null;
  telefone?: string | null;
  cnpj?: string | null;
  page?: number;
}

export interface LinkedClient {
  id: string;
  nome: string;
  arquivado: boolean;
}

export class ClientMatchApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ClientMatchApiError';
    this.status = status;
  }
}

const STATUSES: readonly ClientMatchStatus[] = ['matched', 'review', 'not_found', 'insufficient'];
const REASONS: readonly ClientMatchReason[] = [
  'multiple_matches',
  'identifier_conflict',
  'archived_match',
  'weak_matches_only',
];
const FIELDS: readonly ClientMatchField[] = ['documento', 'email', 'telefone', 'nome', 'empresa'];

const QUERY_FAILURE = 'Não foi possível verificar o cliente.';
const INVALID_QUERY_RESPONSE = 'Resposta inválida da consulta de cliente.';
const INVALID_CLIENT_RESPONSE = 'Resposta inválida do cadastro do cliente.';
const MAX_MESSAGE_LENGTH = 300;

function invalidQueryResponse(): never {
  throw new ClientMatchApiError(INVALID_QUERY_RESPONSE);
}

function invalidClientResponse(status = 0): never {
  throw new ClientMatchApiError(INVALID_CLIENT_RESPONSE, status);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') invalidQueryResponse();
  const text = value.trim();
  if (!text || text.length > maximum) invalidQueryResponse();
  return text;
}

function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maximum) invalidQueryResponse();
  return value || null;
}

function matchedFields(value: unknown): ClientMatchField[] {
  if (!Array.isArray(value)) invalidQueryResponse();
  const fields: ClientMatchField[] = [];
  for (const field of value) {
    const parsed = oneOf(field, FIELDS);
    if (!parsed) invalidQueryResponse();
    if (!fields.includes(parsed)) fields.push(parsed);
  }
  return fields;
}

function candidate(value: unknown): ClientMatchCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidQueryResponse();
  const raw = value as {
    id?: unknown;
    nome?: unknown;
    empresa?: unknown;
    documento?: unknown;
    email?: unknown;
    telefone?: unknown;
    arquivado?: unknown;
    matched_by?: unknown;
  };
  return {
    id: requiredText(raw.id, 255),
    nome: requiredText(raw.nome, 200),
    empresa: nullableText(raw.empresa, 200),
    documento: nullableText(raw.documento, 32),
    email: nullableText(raw.email, 254),
    telefone: nullableText(raw.telefone, 32),
    arquivado: raw.arquivado === true,
    matched_by: matchedFields(raw.matched_by),
  };
}

/** Parses the query envelope; a malformed payload is a failure the card shows
 * as a retry, never a silent "new client". */
export function parseClientMatchResponse(value: unknown): ClientMatchResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidQueryResponse();
  const raw = value as {
    status?: unknown;
    reason?: unknown;
    matched_client_id?: unknown;
    candidates?: unknown;
    total_candidates?: unknown;
    page?: unknown;
    has_more?: unknown;
  };
  const status = oneOf(raw.status, STATUSES);
  if (!status) invalidQueryResponse();
  const reason = raw.reason === undefined || raw.reason === null ? undefined : oneOf(raw.reason, REASONS);
  if (raw.reason !== undefined && raw.reason !== null && !reason) invalidQueryResponse();
  if (!Array.isArray(raw.candidates)) invalidQueryResponse();
  if (typeof raw.total_candidates !== 'number' || !Number.isInteger(raw.total_candidates)
    || raw.total_candidates < 0) invalidQueryResponse();
  if (typeof raw.page !== 'number' || !Number.isInteger(raw.page) || raw.page < 1) {
    invalidQueryResponse();
  }
  if (typeof raw.has_more !== 'boolean') invalidQueryResponse();
  if (raw.matched_client_id !== null && raw.matched_client_id !== undefined
    && typeof raw.matched_client_id !== 'string') invalidQueryResponse();
  const matchedClientId = typeof raw.matched_client_id === 'string' ? raw.matched_client_id.trim() : '';
  return {
    status,
    ...(reason ? { reason } : {}),
    matched_client_id: matchedClientId || null,
    candidates: raw.candidates.map(candidate),
    total_candidates: raw.total_candidates,
    page: raw.page,
    has_more: raw.has_more,
  };
}

/** Only a `400` carries a validation message written in pt-BR for the
 * operator; every other status keeps a fixed message so no response body,
 * driver text or stack trace reaches the interface. An expired session keeps
 * the same destination the shared transport uses, instead of looking like a
 * failed identity check. */
function responseError(status: number, body: unknown): ClientMatchApiError {
  if (status === 401) {
    window.location.hash = '#/login';
    return new ClientMatchApiError('Sessão expirada. Faça login novamente.', status);
  }
  if (status !== 400) return new ClientMatchApiError(QUERY_FAILURE, status);
  const reported = (body as { error?: unknown } | null)?.error;
  const message = typeof reported === 'string' ? reported.trim() : '';
  return new ClientMatchApiError(
    message ? message.slice(0, MAX_MESSAGE_LENGTH) : 'Dados inválidos para consultar o cliente.',
    status
  );
}

export async function fetchClientMatches(input: ClientMatchRequest): Promise<ClientMatchResponse> {
  let response: Response;
  try {
    response = await fetch('/api/client-matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ClientMatchApiError(QUERY_FAILURE);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw responseError(response.status, body);
  return parseClientMatchResponse(body);
}

export async function fetchLinkedClient(clientId: string): Promise<LinkedClient> {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!id) throw new ClientMatchApiError('Cliente vinculado inválido.');
  let response: Response;
  try {
    response = await fetch(`/api/client-detail?name=${encodeURIComponent(id)}`);
  } catch {
    throw new ClientMatchApiError(QUERY_FAILURE);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw responseError(response.status, body);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalidClientResponse(response.status);
  }
  const detail = body as {
    id?: unknown;
    nome?: unknown;
    display_name?: unknown;
    arquivado?: unknown;
    status?: unknown;
  };
  const nome = typeof detail.nome === 'string' ? detail.nome.trim() : '';
  const displayName = typeof detail.display_name === 'string' ? detail.display_name.trim() : '';
  const name = nome || displayName;
  if (!name || name.length > 200) invalidClientResponse(response.status);
  return {
    id: typeof detail.id === 'string' && detail.id.trim() ? detail.id.trim() : id,
    nome: name,
    arquivado: detail.arquivado === true || detail.status === 'archived',
  };
}
