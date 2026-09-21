// Automatic client identity resolution for the unsaved Split Cards.
//
// This module is pure and React-free: the identity signature, the request
// identity, the stale-response plan, the view mapping, the canonical fill and
// the blocking message live here so they can be exercised with controlled
// timers and no rendering. `useAutomaticClientResolution` is the thin React
// adapter around `AutomaticClientResolutionController`.

import type { ClientMatchRequest, ClientMatchResponse, LinkedClient } from '../../lib/api/clientMatchApi.ts';
import type { Draft, DraftEdited } from '../../types/domain.ts';
import { draftHasDurableQuotationState } from './durableQuotationState.ts';

export type ClientResolutionMatchedBy = 'documento' | 'email' | 'telefone' | 'nome' | 'empresa';

export interface ClientResolutionIdentity {
  nome?: string;
  empresa?: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
}

export interface ClientResolutionCandidate {
  id: string;
  nome: string;
  empresa: string | null;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  arquivado: boolean;
  matchedBy: ClientResolutionMatchedBy[];
}

export type ClientResolutionView =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'linked'; clientId: string; nome: string }
  | {
      state: 'choice';
      reason: 'multiple_matches' | 'identifier_conflict' | 'archived_match' | 'weak_matches_only';
      candidates: ClientResolutionCandidate[];
    }
  | { state: 'archived'; clientId: string | null; nome: string | null }
  | { state: 'new_client'; needsConfirmation: boolean; confirmed: boolean }
  | { state: 'error' };

export interface ClientResolutionRequest {
  key: string;
  token: symbol;
}

export interface ClientResolutionEdits {
  /** Written through the page's field update: persisted identity decisions. */
  edited: Partial<DraftEdited>;
  /** Written through the page's system update: derived demand state. */
  system: Partial<DraftEdited>;
}

export interface ClientResolutionSelectionPlan extends ClientResolutionEdits {
  /** Identity the canonical fill leaves in the draft. It is recorded as the
   * signature the resolution was computed from, so the fill can never loop. */
  identity: ClientResolutionIdentity;
}

/** Same debounce as the item search: typing an identity must produce one query. */
export const CLIENT_RESOLUTION_DEBOUNCE_MS = 300;

const MIN_TEXT_TERM_LENGTH = 3;
const DOCUMENT_LENGTHS = [11, 14];
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Comparison form of names and companies, mirroring the backend fold: case,
 * accents, surrounding and repeated spaces are disregarded. */
function foldText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function collapsed(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Identity signature of the queried data. Formatting-only edits (phone and
 * document masks, e-mail case, name accents or repeated spaces) keep it
 * stable, so a valid selection survives them. */
export function clientResolutionSignature(edited: ClientResolutionIdentity): string {
  return [
    foldText(edited.nome),
    foldText(edited.empresa),
    (edited.email ?? '').trim().toLowerCase(),
    digits(edited.telefone),
    digits(edited.cnpj),
  ].join('\u001f');
}

/** Identity of one draft's query: the draft index plus the data version. */
export function clientResolutionRequestKey(index: number, signature: string): string {
  return `${index}\u0000${signature}`;
}

/** Decides whether a resolved query may still touch the draft. A response from
 * another data version, another draft or a frozen card never applies; an
 * operator decision made while the query was in flight is never undone. */
export function planClientResolutionApplication(input: {
  request: ClientResolutionRequest | undefined;
  token: symbol;
  draftActive: boolean;
  draftSignature: string;
  responseSignature: string;
}): { apply: boolean } {
  return {
    apply:
      input.draftActive &&
      input.draftSignature === input.responseSignature &&
      input.request !== undefined &&
      input.request.token === input.token,
  };
}

/** Name/company terms long enough to be searched. Below this the card must not
 * ask the backend to list the whole base. */
export function clientResolutionTextTerms(edited: ClientResolutionIdentity): string[] {
  const terms: string[] = [];
  for (const value of [collapsed(edited.nome), collapsed(edited.empresa)]) {
    if (value.length >= MIN_TEXT_TERM_LENGTH && !terms.includes(value)) terms.push(value);
  }
  return terms;
}

/** True when there is anything the backend can be asked about. */
export function isSearchableClientIdentity(edited: ClientResolutionIdentity): boolean {
  return Boolean(digits(edited.cnpj))
    || Boolean(collapsed(edited.email))
    || Boolean(digits(edited.telefone))
    || clientResolutionTextTerms(edited).length > 0;
}

/** A strong identifier only removes the explicit "new client" confirmation
 * when it is usable; the backend validates the same fields and answers a
 * filled-but-invalid value with `400`, never with a silent absence. */
export function hasUsableStrongIdentifier(edited: ClientResolutionIdentity): boolean {
  const document = digits(edited.cnpj);
  if (DOCUMENT_LENGTHS.includes(document.length)) return true;
  if (EMAIL_PATTERN.test((edited.email ?? '').trim().toLowerCase())) return true;
  const phone = digits(edited.telefone);
  return phone.length >= PHONE_MIN_DIGITS && phone.length <= PHONE_MAX_DIGITS;
}

export function clientResolutionRequest(edited: ClientResolutionIdentity): ClientMatchRequest {
  const nome = collapsed(edited.nome);
  const empresa = collapsed(edited.empresa);
  const email = (edited.email ?? '').trim();
  const telefone = (edited.telefone ?? '').trim();
  const cnpj = (edited.cnpj ?? '').trim();
  return {
    ...(nome ? { nome } : {}),
    ...(empresa ? { empresa } : {}),
    ...(email ? { email } : {}),
    ...(telefone ? { telefone } : {}),
    ...(cnpj ? { cnpj } : {}),
  };
}

function toCandidate(value: ClientMatchResponse['candidates'][number]): ClientResolutionCandidate {
  return {
    id: value.id,
    nome: value.nome,
    empresa: value.empresa,
    documento: value.documento,
    email: value.email,
    telefone: value.telefone,
    arquivado: value.arquivado,
    matchedBy: [...value.matched_by],
  };
}

/** Maps the endpoint contract onto the card's view union. `hasStrongIdentifier`
 * and `linkedName` carry what the response cannot state on its own: whether the
 * query had a usable strong identifier and the name of a matched client the
 * envelope did not repeat. */
export function viewFromResponse(
  response: ClientMatchResponse,
  current: {
    clientId?: string;
    confirmedNewClient?: boolean;
    hasStrongIdentifier?: boolean;
    linkedName?: string;
  }
): ClientResolutionView {
  const candidates = response.candidates.map(toCandidate);

  if (response.status === 'matched') {
    const linkedId = response.matched_client_id || current.clientId || '';
    const matched = candidates.find((value) => value.id === linkedId)
      ?? candidates.find((value) => value.id === response.matched_client_id)
      ?? (candidates.length === 1 ? candidates[0] : undefined);
    const nome = matched?.nome || collapsed(current.linkedName);
    // A link without a name to show would be a blind decision: it stays a
    // failure the operator can retry.
    if (!linkedId || !nome) return { state: 'error' };
    return { state: 'linked', clientId: linkedId, nome };
  }

  if (response.status === 'review') {
    if (!candidates.length) return { state: 'error' };
    const archived = candidates.filter((value) => value.arquivado);
    if (response.reason === 'archived_match' && archived.length === candidates.length) {
      return archived.length === 1
        ? { state: 'archived', clientId: archived[0].id, nome: archived[0].nome }
        : { state: 'archived', clientId: null, nome: null };
    }
    return {
      state: 'choice',
      reason: response.reason ?? 'multiple_matches',
      candidates,
    };
  }

  if (response.status === 'not_found' || response.status === 'insufficient') {
    return {
      state: 'new_client',
      needsConfirmation: response.status === 'insufficient' || current.hasStrongIdentifier !== true,
      confirmed: current.confirmedNewClient === true,
    };
  }

  return { state: 'error' };
}

/** Portuguese reason the card cannot persist the draft in its current state,
 * and the single source for that wording. `null` means the identity no longer
 * blocks saving or issuing. */
export function clientResolutionBlockMessage(view: ClientResolutionView): string | null {
  switch (view.state) {
    case 'checking':
      return 'Aguardando a verificação do cliente.';
    case 'choice':
      return 'Escolha o cliente para continuar.';
    case 'archived':
      return 'Cliente arquivado. Regularize o cadastro na tela Clientes para continuar.';
    case 'error':
      return 'Não foi possível verificar o cliente. Tente novamente.';
    case 'new_client':
      return view.needsConfirmation && !view.confirmed
        ? 'Confirme que é um novo cliente para continuar.'
        : null;
    default:
      return null;
  }
}

/** Complete and unmasked document of a candidate. The query returns the
 * document masked, so a masked value never fills the draft: it only travels in
 * the quotation snapshot of the client actually linked. */
export function canonicalClientDocument(documento: string | null): string | null {
  const value = digits(documento ?? '');
  return DOCUMENT_LENGTHS.includes(value.length) ? value : null;
}

/** Canonical fill for a manually selected client: one atomic update that
 * assigns the reference, writes the register's identity and invalidates the
 * demand chosen for the previous client. Items, prices, commercial notes and
 * `draft.original` are never touched, and a field the register does not provide
 * keeps what the extraction or the operator already filled. */
export function planClientSelection(
  draft: Draft,
  candidate: ClientResolutionCandidate
): ClientResolutionSelectionPlan {
  const current = draft.edited;
  const documento = canonicalClientDocument(candidate.documento);
  const identity: ClientResolutionIdentity = {
    nome: candidate.nome.trim() || current.nome,
    empresa: candidate.empresa?.trim() || current.empresa,
    email: candidate.email?.trim() || current.email,
    telefone: candidate.telefone?.trim() || current.telefone,
    cnpj: documento ?? current.cnpj,
  };
  const empresa = identity.empresa?.trim();
  return {
    identity,
    edited: {
      client_id: candidate.id,
      // Selecting an existing client is not the explicit "new client" decision.
      confirm_new_client: undefined,
      nome: identity.nome ?? '',
      email: identity.email ?? '',
      telefone: identity.telefone ?? '',
      cnpj: identity.cnpj ?? '',
      ...(empresa ? { empresa } : {}),
    },
    system: {
      opportunity_id: undefined,
      new_demand: false,
      demand_summary: undefined,
    },
  };
}

/** Drafts that were discarded, already saved or already issued stop receiving
 * automatic identity resolution: after saving, the snapshot returned by the
 * server is the effective reference, not the query preview. Mirrors the
 * durable-state predicate used by the automatic page. */
export function isClientResolutionActive(draft: Draft): boolean {
  if (draft.discarded) return false;
  return !draftHasDurableQuotationState(draft);
}

function linkedClientId(draft: Draft): string | null {
  return draft.edited.client_id?.trim() || null;
}

export interface ClientResolutionSources {
  fetchMatches: (input: ClientMatchRequest) => Promise<ClientMatchResponse>;
  fetchLinked: (clientId: string) => Promise<LinkedClient>;
  /** Schedules debounced work; the returned function cancels it. */
  schedule: (callback: () => void, delayMs: number) => () => void;
  applyEdits: (draftIdx: number, edits: ClientResolutionEdits) => void;
  notify: () => void;
}

interface ResolutionRecord {
  signature: string;
  view: ClientResolutionView;
  status: 'pending' | 'settled' | 'stale';
  request?: ClientResolutionRequest;
}

/**
 * Per-draft identity resolution. Holds no React state: the hook feeds it the
 * current drafts, applies the edit plans and re-renders on `notify`.
 *
 * One independent request identity per draft keeps a late answer from another
 * data version, another draft or a frozen card from ever applying.
 */
export class AutomaticClientResolutionController {
  private readonly sources: ClientResolutionSources;
  private readonly records = new Map<number, ResolutionRecord>();
  private readonly drafts = new Map<number, Draft>();
  private readonly cancels = new Map<number, () => void>();
  private frozen = false;

  constructor(sources: ClientResolutionSources) {
    this.sources = sources;
  }

  views(): Record<number, ClientResolutionView> {
    const views: Record<number, ClientResolutionView> = {};
    for (const [index, record] of this.records) views[index] = record.view;
    return views;
  }

  /** Reconciles every draft with its stored resolution. Called after each
   * render; it only starts work for a new data version, a stale request or a
   * link that still needs revalidation. */
  sync(drafts: readonly Draft[], enabled: boolean): void {
    this.frozen = !enabled;
    if (!enabled) return;
    const present = new Set<number>();
    for (const draft of drafts) {
      present.add(draft.index);
      if (!isClientResolutionActive(draft)) {
        this.forget(draft.index);
        continue;
      }
      this.drafts.set(draft.index, draft);
      const signature = clientResolutionSignature(draft.edited);
      const record = this.records.get(draft.index);
      if (!record) {
        // First resolution of this draft: a restored link is revalidated, never
        // discarded for existing.
        this.start(draft, signature, CLIENT_RESOLUTION_DEBOUNCE_MS);
        continue;
      }
      if (record.signature !== signature) {
        // Relevant identity edit: the link and the confirmation belong to the
        // previous data version and must be dropped before persisting again.
        this.start(draft, signature, CLIENT_RESOLUTION_DEBOUNCE_MS, { clearSelection: true });
        continue;
      }
      if (record.status === 'stale') {
        this.start(draft, signature, CLIENT_RESOLUTION_DEBOUNCE_MS);
        continue;
      }
      this.refreshConfirmation(draft.index, draft, record);
    }
    for (const index of [...this.records.keys()]) {
      if (!present.has(index)) this.forget(index);
    }
  }

  /** Manual selection: one atomic update with the canonical fill, the demand
   * invalidation and the new data version recorded before the draft changes. */
  selectClient(draftIdx: number, candidate: ClientResolutionCandidate): void {
    const draft = this.drafts.get(draftIdx);
    if (!draft || !this.isActive(draftIdx)) return;
    const plan = planClientSelection(draft, candidate);
    this.cancel(draftIdx);
    this.records.set(draftIdx, {
      signature: clientResolutionSignature(plan.identity),
      view: { state: 'linked', clientId: candidate.id, nome: candidate.nome },
      status: 'settled',
    });
    this.drafts.set(draftIdx, {
      ...draft,
      edited: { ...draft.edited, ...plan.edited, ...plan.system },
    });
    this.sources.applyEdits(draftIdx, plan);
    this.sources.notify();
  }

  /** Explicit "it is another person" decision, valid only for the identity the
   * current resolution was computed from. */
  confirmNewClient(draftIdx: number): void {
    const draft = this.drafts.get(draftIdx);
    const record = this.records.get(draftIdx);
    if (!draft || !record || !this.isActive(draftIdx)) return;
    if (record.view.state !== 'new_client') return;
    if (record.signature !== clientResolutionSignature(draft.edited)) return;
    if (draft.edited.confirm_new_client === true) return;
    this.drafts.set(draftIdx, { ...draft, edited: { ...draft.edited, confirm_new_client: true } });
    this.sources.applyEdits(draftIdx, { edited: { confirm_new_client: true }, system: {} });
    record.view = { ...record.view, confirmed: true };
    this.sources.notify();
  }

  retry(draftIdx: number): void {
    const draft = this.drafts.get(draftIdx);
    if (!draft || !this.isActive(draftIdx)) return;
    const record = this.records.get(draftIdx);
    if (record?.status === 'pending') return;
    this.start(draft, record?.signature ?? clientResolutionSignature(draft.edited), 0);
  }

  /** "Trocar": drops the link and the confirmation and queries the identity
   * again, so the operator can pick or correct the register. */
  clearSelection(draftIdx: number): void {
    const draft = this.drafts.get(draftIdx);
    if (!draft || !this.isActive(draftIdx)) return;
    const cleared: Draft = {
      ...draft,
      edited: { ...draft.edited, client_id: undefined, confirm_new_client: undefined },
    };
    this.drafts.set(draftIdx, cleared);
    this.sources.applyEdits(draftIdx, {
      edited: { client_id: undefined, confirm_new_client: undefined },
      system: {},
    });
    this.start(cleared, clientResolutionSignature(cleared.edited), 0);
  }

  dispose(): void {
    for (const cancel of this.cancels.values()) cancel();
    this.cancels.clear();
    this.records.clear();
    this.drafts.clear();
  }

  private start(
    draft: Draft,
    signature: string,
    delayMs: number,
    options: { clearSelection?: boolean } = {}
  ): void {
    const index = draft.index;
    this.cancel(index);
    const record: ResolutionRecord = {
      signature,
      view: { state: 'checking' },
      status: 'pending',
      request: { key: clientResolutionRequestKey(index, signature), token: Symbol('client-resolution') },
    };
    this.records.set(index, record);
    this.drafts.set(index, draft);
    this.sources.notify();
    if (options.clearSelection && (linkedClientId(draft) || draft.edited.confirm_new_client)) {
      this.drafts.set(index, {
        ...draft,
        edited: { ...draft.edited, client_id: undefined, confirm_new_client: undefined },
      });
      this.sources.applyEdits(index, {
        edited: { client_id: undefined, confirm_new_client: undefined },
        system: {},
      });
    }
    this.cancels.set(
      index,
      this.sources.schedule(() => {
        this.cancels.delete(index);
        // A save or issue in flight freezes the identity: no new query starts
        // and the pending record is restarted once the operation settles.
        if (this.frozen) {
          record.status = 'stale';
          return;
        }
        void this.resolve(index, record);
      }, delayMs)
    );
  }

  private async resolve(index: number, record: ResolutionRecord): Promise<void> {
    const draft = this.drafts.get(index);
    const token = record.request?.token;
    if (!draft || !token) return;
    try {
      const clientId = linkedClientId(draft);
      if (clientId) {
        // A restored link is never trusted as proof that the register is valid.
        const linked = await this.sources.fetchLinked(clientId);
        this.settle(index, record, token, linked.arquivado
          ? { state: 'archived', clientId: linked.id, nome: linked.nome }
          : { state: 'linked', clientId: linked.id, nome: linked.nome });
        return;
      }
      if (!isSearchableClientIdentity(draft.edited)) {
        this.settle(index, record, token, {
          state: 'new_client',
          needsConfirmation: true,
          confirmed: false,
        });
        return;
      }
      const response = await this.sources.fetchMatches(clientResolutionRequest(draft.edited));
      this.settle(index, record, token, viewFromResponse(response, {
        hasStrongIdentifier: hasUsableStrongIdentifier(draft.edited),
        confirmedNewClient: draft.edited.confirm_new_client === true,
        linkedName: draft.edited.nome,
      }));
    } catch {
      this.settle(index, record, token, { state: 'error' });
    }
  }

  private settle(
    index: number,
    record: ResolutionRecord,
    token: symbol,
    view: ClientResolutionView
  ): void {
    const current = this.records.get(index);
    // A newer data version already replaced this request: nothing it says can
    // still be applied.
    if (current !== record) return;
    const draft = this.drafts.get(index);
    const plan = planClientResolutionApplication({
      request: record.request,
      token,
      draftActive: this.isActive(index),
      draftSignature: draft ? clientResolutionSignature(draft.edited) : '',
      responseSignature: record.signature,
    });
    if (!plan.apply) {
      // Keep the draft and the operator's data: the next sync restarts the
      // query for the same identity instead of inventing a new client.
      record.status = 'stale';
      return;
    }
    record.view = view;
    record.status = 'settled';
    record.request = undefined;
    if (view.state === 'linked' && draft && linkedClientId(draft) !== view.clientId) {
      // Automatic linking only assigns the reference; typed and extracted data
      // stay untouched.
      this.drafts.set(index, { ...draft, edited: { ...draft.edited, client_id: view.clientId } });
      this.sources.applyEdits(index, { edited: { client_id: view.clientId }, system: {} });
    }
    this.sources.notify();
  }

  private refreshConfirmation(index: number, draft: Draft, record: ResolutionRecord): void {
    if (record.view.state !== 'new_client') return;
    const confirmed = draft.edited.confirm_new_client === true;
    if (record.view.confirmed === confirmed) return;
    record.view = { ...record.view, confirmed };
    this.sources.notify();
  }

  private isActive(index: number): boolean {
    const draft = this.drafts.get(index);
    return !this.frozen && draft !== undefined && isClientResolutionActive(draft);
  }

  private cancel(index: number): void {
    const cancel = this.cancels.get(index);
    if (cancel) {
      cancel();
      this.cancels.delete(index);
    }
  }

  private forget(index: number): void {
    this.cancel(index);
    this.records.delete(index);
    this.drafts.delete(index);
  }
}
