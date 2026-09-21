/**
 * Client identity resolution: the single authoritative implementation of the
 * normalization and classification rules used by the automatic Split Card
 * query (`POST /api/client-matches`) and by the quotation save path.
 *
 * The module is intentionally free of persistence concerns so the classifier
 * can be exercised without a database, and the repository seam only has to
 * supply candidate rows.
 */
import {
  CLIENT_COMPANY_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  ClientInputError,
  documentCheckDigitsAreValid,
  normalizeClientCompany,
  normalizeClientDocument,
  normalizeClientEmail,
  normalizeClientPhone,
} from './client-schema.js';

export const CLIENT_MATCH_PAGE_SIZE = 10;
/** Display ceiling: a page above the end is empty instead of an error. */
export const CLIENT_MATCH_MAX_PAGE = 100;
/** Below this many useful characters a name/company term starts no text search. */
export const CLIENT_MATCH_MIN_TEXT_LENGTH = 3;

export type ClientMatchField = 'documento' | 'email' | 'telefone' | 'nome' | 'empresa';
export type ClientMatchStrongField = Extract<ClientMatchField, 'documento' | 'email' | 'telefone'>;
export type ClientMatchStatus = 'matched' | 'review' | 'not_found' | 'insufficient';
export type ClientMatchReason =
  | 'multiple_matches'
  | 'identifier_conflict'
  | 'archived_match'
  | 'weak_matches_only';

export interface ClientMatchRequest {
  nome?: string;
  empresa?: string;
  email?: string | null;
  telefone?: string | null;
  cnpj?: string | null;
  page?: number;
}

/** Candidate row as supplied by the repository seam. */
export interface ClientMatchRecord {
  id: string;
  nome: string;
  empresa: string | null;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  arquivado: boolean;
}

export interface ClientMatchCandidate extends ClientMatchRecord {
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

export class ClientMatchInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ClientMatchInputError';
  }
}

export interface NormalizedClientMatchInput {
  nome: string | null;
  empresa: string | null;
  email: string | null;
  telefone: string | null;
  documento: string | null;
  page: number;
  /** Name/company terms long enough to start a text search. */
  textTerms: string[];
}

const STRONG_FIELDS: readonly ClientMatchStrongField[] = ['documento', 'email', 'telefone'];

/**
 * Comparison form for names and companies: case, accents, surrounding spaces
 * and repeated spaces are disregarded. The stored value is never rewritten.
 */
export function foldClientText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function readOptionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ClientMatchInputError(`Informe ${label} como texto.`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new ClientMatchInputError(`${label} deve ter no máximo ${maximum} caracteres.`);
  }
  return normalized;
}

function readPage(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return 1;
  return Math.min(numeric, CLIENT_MATCH_MAX_PAGE);
}

/**
 * Normalizes and validates the query input. A filled but invalid document is
 * an input error, never a silent blank value and never "not found".
 */
export function normalizeClientMatchInput(payload: unknown): NormalizedClientMatchInput {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ClientMatchInputError('Envie os dados do cliente em um objeto válido.');
  }
  const input = payload as Record<string, unknown>;

  try {
    const nome = readOptionalText(input.nome, 'o nome', CLIENT_NAME_MAX_LENGTH);
    const empresa = normalizeClientCompany(input.empresa);
    const email = normalizeClientEmail(input.email);
    const telefone = normalizeClientPhone(input.telefone);
    const documento = normalizeClientDocument(input.cnpj);
    if (documento && !documentCheckDigitsAreValid(documento)) {
      throw new ClientMatchInputError('O CNPJ/CPF informado é inválido.');
    }

    const textTerms: string[] = [];
    for (const value of [nome, empresa]) {
      const collapsed = (value || '').replace(/\s+/g, ' ').trim();
      if (collapsed.length >= CLIENT_MATCH_MIN_TEXT_LENGTH && !textTerms.includes(collapsed)) {
        textTerms.push(collapsed);
      }
    }

    return {
      nome,
      empresa,
      email,
      telefone,
      documento,
      page: readPage(input.page),
      textTerms,
    };
  } catch (error) {
    if (error instanceof ClientMatchInputError) throw error;
    if (error instanceof ClientInputError) throw new ClientMatchInputError(error.message);
    throw new ClientMatchInputError('Não foi possível ler os dados do cliente.');
  }
}

/**
 * True when the input carries something the database can be asked about. The
 * absence of any searchable data returns `insufficient` without scanning the
 * client table.
 */
export function isSearchableClientMatchInput(input: NormalizedClientMatchInput): boolean {
  return Boolean(input.documento || input.email || input.telefone) || input.textTerms.length > 0;
}

/** Full document is only disclosed for the client actually linked; the query
 * returns a masked form so a candidate can still be told apart. */
export function maskClientDocument(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 2) return '*'.repeat(value.length);
  if (value.length === 14) return `**.***.***/****-${value.slice(12)}`;
  if (value.length === 11) return `***.***.***-${value.slice(9)}`;
  return `${'*'.repeat(value.length - 2)}${value.slice(-2)}`;
}

function matchedFieldsFor(
  input: NormalizedClientMatchInput,
  record: ClientMatchRecord
): ClientMatchField[] {
  const fields: ClientMatchField[] = [];
  if (input.documento && record.documento === input.documento) fields.push('documento');
  if (input.email && record.email === input.email) fields.push('email');
  if (input.telefone && record.telefone === input.telefone) fields.push('telefone');

  const foldedName = foldClientText(record.nome);
  const foldedCompany = foldClientText(record.empresa);
  for (const term of input.textTerms) {
    const folded = foldClientText(term);
    if (!folded) continue;
    if (foldedName.includes(folded) && !fields.includes('nome')) fields.push('nome');
    if (foldedCompany.includes(folded) && !fields.includes('empresa')) fields.push('empresa');
  }
  return fields;
}

/** Strong matches are presented first; within a group the order is stable and
 * purely alphabetic, because result order never decides identity. */
function orderByName(candidates: ClientMatchCandidate[]): ClientMatchCandidate[] {
  return [...candidates].sort((left, right) => {
    const byName = foldClientText(left.nome).localeCompare(foldClientText(right.nome));
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id);
  });
}

function envelope(
  status: ClientMatchStatus,
  matchedClientId: string | null,
  all: ClientMatchCandidate[],
  input: NormalizedClientMatchInput,
  reason?: ClientMatchReason
): ClientMatchResponse {
  const start = (input.page - 1) * CLIENT_MATCH_PAGE_SIZE;
  const response: ClientMatchResponse = {
    status,
    matched_client_id: matchedClientId,
    candidates: all
      .slice(start, start + CLIENT_MATCH_PAGE_SIZE)
      .map((candidate) => ({ ...candidate, documento: maskClientDocument(candidate.documento) })),
    total_candidates: all.length,
    page: input.page,
    has_more: start + CLIENT_MATCH_PAGE_SIZE < all.length,
  };
  if (reason) response.reason = reason;
  return response;
}

/**
 * Classifies the identity against the *complete* set of candidates. Pagination
 * is display only: it never changes the decision, and `total_candidates` counts
 * the whole considered set, never just the loaded page.
 */
export function classifyClientMatch(
  input: NormalizedClientMatchInput,
  records: readonly ClientMatchRecord[]
): ClientMatchResponse {
  const deduped = new Map<string, ClientMatchCandidate>();
  for (const record of records) {
    const matched_by = matchedFieldsFor(input, record);
    if (!matched_by.length) continue;
    if (deduped.has(record.id)) continue;
    deduped.set(record.id, { ...record, matched_by });
  }

  const strong = orderByName(
    [...deduped.values()].filter((candidate) =>
      candidate.matched_by.some((field) => field === 'documento' || field === 'email' || field === 'telefone')
    )
  );

  if (!strong.length) {
    if (!isSearchableClientMatchInput(input)) return envelope('insufficient', null, [], input);
    const weak = orderByName(
      [...deduped.values()].filter(
        (candidate) => !strong.some((match) => match.id === candidate.id)
      )
    );
    if (weak.length) return envelope('review', null, weak, input, 'weak_matches_only');
    return envelope('not_found', null, [], input);
  }

  if (strong.some((candidate) => candidate.arquivado)) {
    return envelope('review', null, strong, input, 'archived_match');
  }

  const active = strong.filter((candidate) => !candidate.arquivado);

  // Identifiers filled on both sides must agree: an e-mail pointing to one
  // client while the phone points to another is a conflict, not a guess.
  const hitsByField = new Map<ClientMatchStrongField, Set<string>>();
  for (const field of STRONG_FIELDS) {
    if (!input[field]) continue;
    const hits = new Set(
      strong.filter((candidate) => candidate[field] === input[field]).map((candidate) => candidate.id)
    );
    if (hits.size) hitsByField.set(field, hits);
  }
  const hitSets = [...hitsByField.values()];
  for (let left = 0; left < hitSets.length; left += 1) {
    for (let right = left + 1; right < hitSets.length; right += 1) {
      const overlaps = [...hitSets[left]].some((id) => hitSets[right].has(id));
      if (!overlaps) return envelope('review', null, strong, input, 'identifier_conflict');
    }
  }

  if (active.length > 1) return envelope('review', null, strong, input, 'multiple_matches');

  const candidate = active[0];
  const diverges = STRONG_FIELDS.some(
    (field) => input[field] && candidate[field] && candidate[field] !== input[field]
  );
  if (diverges) return envelope('review', null, strong, input, 'identifier_conflict');

  return envelope('matched', candidate.id, [candidate], input);
}
