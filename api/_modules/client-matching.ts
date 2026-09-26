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
  | 'weak_matches_only'
  | 'identifier_in_use';

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

const NAME_CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

/** Whole words of a name or company, without connectors or initials. */
export function clientNameTokens(value: unknown): string[] {
  return foldClientText(value)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 2 && !NAME_CONNECTORS.has(token));
}

/**
 * Two names are the same person's when every word of the shorter one appears,
 * as a whole word, in the longer one ("Carla" ≈ "Carla Souza"; "Andrei B." ≈
 * "Andrei Brandão"). A substring is never enough: "Andrei" is not "Andreia".
 */
export function clientNamesMatch(left: unknown, right: unknown): boolean {
  const a = clientNameTokens(left);
  const b = clientNameTokens(right);
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter.some((token) => token.length >= 3)) return false;
  const pool = [...longer];
  return shorter.every((token) => {
    const index = pool.indexOf(token);
    if (index < 0) return false;
    pool.splice(index, 1);
    return true;
  });
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

// Brazilian national number: area code, then a 9-digit mobile or 8-digit landline.
const BRAZIL_NATIONAL_PHONE = /^[1-9]{2}(?:9\d{8}|[2-8]\d{7})$/;

/**
 * Stored forms of one phone. Clients are registered with and without the
 * Brazilian country code (21995419741 and 5521995419741), and WhatsApp always
 * sends it, so both forms of a Brazilian number are the same phone. Other
 * numbers only match themselves; the mobile ninth digit is never added.
 */
export function clientPhoneVariants(phone: string): string[] {
  const national = phone.startsWith('55') && BRAZIL_NATIONAL_PHONE.test(phone.slice(2))
    ? phone.slice(2)
    : BRAZIL_NATIONAL_PHONE.test(phone) ? phone : null;
  return national ? [national, `55${national}`] : [phone];
}

function sameIdentifier(field: ClientMatchStrongField, left: string, right: string): boolean {
  return field === 'telefone' ? clientPhoneVariants(left).includes(right) : left === right;
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
  if (input.telefone && record.telefone && sameIdentifier('telefone', input.telefone, record.telefone)) {
    fields.push('telefone');
  }

  for (const text of [input.nome, input.empresa]) {
    if (!text) continue;
    if (clientNamesMatch(text, record.nome) && !fields.includes('nome')) fields.push('nome');
    if (clientNamesMatch(text, record.empresa) && !fields.includes('empresa')) fields.push('empresa');
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
 * A candidate is the same client only on two independent signals: a valid
 * document alone, or two of {name or company, e-mail, phone}. One shared field
 * is a coincidence to confirm, never an identity (two "Carla" with different
 * contacts, one family phone).
 */
function isStrongCandidate(candidate: ClientMatchCandidate): boolean {
  const fields = candidate.matched_by;
  if (fields.includes('documento')) return true;
  const signals =
    Number(fields.includes('nome') || fields.includes('empresa')) +
    Number(fields.includes('email')) +
    Number(fields.includes('telefone'));
  return signals >= 2;
}

/**
 * Classifies the identity against the *complete* set of candidates. Pagination
 * is display only: it never changes the decision, and `total_candidates` counts
 * the whole considered set, never just the loaded page.
 *
 * - One active strong candidate links, even with archived or weaker ones around.
 * - Only archived strong candidates block with `archived_match`.
 * - Several active strong candidates, or one whose filled identifiers diverge,
 *   require a choice.
 * - Without a strong candidate, an e-mail/phone already used by another client
 *   is `identifier_in_use` (choose or confirm a new client); name/company
 *   suggestions only exist when the input carries no identifier at all.
 */
export function classifyClientMatch(
  input: NormalizedClientMatchInput,
  records: readonly ClientMatchRecord[]
): ClientMatchResponse {
  if (!isSearchableClientMatchInput(input)) return envelope('insufficient', null, [], input);

  const deduped = new Map<string, ClientMatchCandidate>();
  for (const record of records) {
    const matched_by = matchedFieldsFor(input, record);
    if (!matched_by.length) continue;
    if (deduped.has(record.id)) continue;
    deduped.set(record.id, { ...record, matched_by });
  }
  const all = [...deduped.values()];

  const strong = all.filter(isStrongCandidate);
  if (strong.length) {
    const active = orderByName(strong.filter((candidate) => !candidate.arquivado));
    if (!active.length) {
      return envelope('review', null, orderByName(strong), input, 'archived_match');
    }
    if (active.length > 1) return envelope('review', null, active, input, 'multiple_matches');
    const candidate = active[0];
    const diverges = STRONG_FIELDS.some((field) => {
      const wanted = input[field];
      const stored = candidate[field];
      return Boolean(wanted && stored && !sameIdentifier(field, wanted, stored));
    });
    if (diverges) return envelope('review', null, active, input, 'identifier_conflict');
    return envelope('matched', candidate.id, active, input);
  }

  const hasIdentifier = STRONG_FIELDS.some((field) => Boolean(input[field]));
  const active = all.filter((candidate) => !candidate.arquivado);
  if (hasIdentifier) {
    const sharing = orderByName(
      active.filter((candidate) =>
        candidate.matched_by.some((field) => field === 'email' || field === 'telefone')
      )
    );
    if (sharing.length) return envelope('review', null, sharing, input, 'identifier_in_use');
    return envelope('not_found', null, [], input);
  }

  const suggestions = orderByName(active);
  if (suggestions.length) return envelope('review', null, suggestions, input, 'weak_matches_only');
  return envelope('not_found', null, [], input);
}
