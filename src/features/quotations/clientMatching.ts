/** Identity matching for unsaved Auto drafts. Name matches are suggestions only. */
export interface DraftClientIdentity {
  nome?: string | null;
  empresa?: string | null;
  email?: string | null;
  telefone?: string | null;
  cnpj?: string | null;
}

export interface ClientCandidate extends DraftClientIdentity {
  id: string;
  documento?: string | null;
  arquivado?: boolean;
  archived?: boolean;
}

export interface ClientMatch {
  client: ClientCandidate;
  strong: boolean;
  conflicting: boolean;
  archived: boolean;
}

export interface ClientMatchResult {
  matches: ClientMatch[];
  automatic: ClientCandidate | null;
  canCreateNew: boolean;
}

export interface ClientSearchPage {
  data: ClientCandidate[];
  pagination: { page: number; total_pages: number };
}

export type ClientSearch = (term: string, page: number) => Promise<ClientSearchPage>;

export function normalizeIdentityName(value?: string | null): string {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

function email(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function phone(value?: string | null): string {
  const text = (value || '').trim();
  if (!/^[+\d\s().-]+$/.test(text)) return '';
  const digits = text.replace(/\D/g, '');
  // Only remove Brazil's country code from a complete international number.
  // Never drop the DDD (including DDD 55), or compare only a phone's suffix.
  const local = /^55\d{10,11}$/.test(digits) ? digits.slice(2) : digits;
  return /^\d{10,15}$/.test(local) ? local : '';
}

function document(value?: string | null): string {
  const text = (value || '').trim();
  if (!/^[\d\s./-]+$/.test(text)) return '';
  const digits = text.replace(/\D/g, '');
  return /^(?:\d{11}|\d{14})$/.test(digits) ? digits : '';
}

function normalized(identity: DraftClientIdentity, documento?: string | null) {
  return {
    nome: normalizeIdentityName(identity.nome),
    empresa: normalizeIdentityName(identity.empresa),
    email: email(identity.email),
    telefone: phone(identity.telefone),
    documento: document(documento || identity.cnpj),
  };
}

export function clientIdentityKey(identity: DraftClientIdentity): string {
  // Raw trimmed values also invalidate pending requests when a previously
  // invalid field is edited into another invalid value.
  return JSON.stringify([
    identity.nome || '', identity.empresa || '', identity.email || '',
    identity.telefone || '', identity.cnpj || '',
  ]);
}

export function matchDraftClients(
  identity: DraftClientIdentity,
  candidates: readonly ClientCandidate[],
): ClientMatchResult {
  const wanted = normalized(identity);
  const unique = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const matches: ClientMatch[] = [];
  for (const client of unique.values()) {
    const candidate = normalized(client, client.documento);
    const strong = (['documento', 'email', 'telefone'] as const).some((field) =>
      Boolean(wanted[field] && candidate[field] && wanted[field] === candidate[field]),
    );
    const nameMatch = Boolean(wanted.nome && candidate.nome && (
      candidate.nome.includes(wanted.nome) || wanted.nome.includes(candidate.nome)
    ));
    if (!strong && !nameMatch) continue;
    const conflicting = (Object.keys(wanted) as Array<keyof typeof wanted>).some((field) =>
      Boolean(wanted[field] && candidate[field] && wanted[field] !== candidate[field]),
    );
    matches.push({ client, strong, conflicting, archived: Boolean(client.arquivado || client.archived) });
  }
  const strongMatches = matches.filter((match) => match.strong);
  const automatic = strongMatches.length === 1 && !strongMatches[0].conflicting && !strongMatches[0].archived
    ? strongMatches[0].client
    : null;
  return { matches, automatic, canCreateNew: strongMatches.length === 0 };
}

/** Search every identity independently so an email/phone conflict is not hidden
 * by first-match-wins. Inspect all result pages; incomplete reads fail closed. */
export async function lookupDraftClients(
  identity: DraftClientIdentity,
  search: ClientSearch,
  isCurrent: () => boolean = () => true,
): Promise<ClientMatchResult> {
  const wanted = normalized(identity);
  const name = (identity.nome || '').trim();
  const terms = [...new Set([
    wanted.documento, wanted.email, wanted.telefone, name, wanted.nome,
  ].filter(Boolean))];
  const results = await Promise.all(terms.map(async (term) => {
    const candidates: ClientCandidate[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      if (!isCurrent()) throw new Error('Consulta de cliente cancelada.');
      const response = await search(term, page);
      if (!isCurrent()) throw new Error('Consulta de cliente cancelada.');
      if (!Array.isArray(response.data) || !response.pagination
        || response.pagination.page !== page
        || !Number.isInteger(response.pagination.total_pages)
        || response.pagination.total_pages < 0
        || response.pagination.total_pages > 50
        || response.data.some((client) => !client || typeof client.id !== 'string' || !client.id)) {
        throw new Error('Não foi possível conferir todos os clientes. Refine os dados e tente novamente.');
      }
      candidates.push(...response.data);
      totalPages = response.pagination.total_pages;
      page += 1;
    } while (page <= totalPages);
    return candidates;
  }));
  return matchDraftClients(identity, results.flat());
}
