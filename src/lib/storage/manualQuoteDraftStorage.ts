import type { QuotationOriginPrefill } from '../../features/crm/quotationOriginPrefill.ts';
import type { OpportunitySelection } from '../../features/quotations/opportunitySelection.ts';
import { EMPTY_ADDRESS, normalizeAddress, type Address } from '../clientMetadata.ts';

export const MANUAL_QUOTE_DRAFT_STORAGE_KEY = 'aspen_manual_draft';
export const MANUAL_QUOTE_DRAFT_STORAGE_VERSION = 1;

export interface ManualQuoteClient {
  id: string;
  nome: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
}

export interface ManualQuoteCartItem {
  _key: string;
  sku: string;
  nome: string;
  qty: number;
  rate: number;
  _rateManual: boolean;
}

export interface ManualQuoteDraft {
  version: number;
  clientType: 'new' | 'existing';
  clientSearch: string;
  selectedClient: ManualQuoteClient | null;
  newClient: { nome: string; email: string; telefone: string };
  leadSource: string;
  cnpj: string;
  address: Address;
  showAddress: boolean;
  items: ManualQuoteCartItem[];
  prazo: string;
  observacoes: string;
  urgente: boolean;
  templateKey: string;
  originPrefill?: QuotationOriginPrefill;
  opportunity: OpportunitySelection;
  /** Stable creation key for the first dispatch of this manual draft. */
  creationRequestId?: string;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function address(value: unknown): Address {
  if (!isRecord(value)) return { ...EMPTY_ADDRESS };
  return normalizeAddress(Object.fromEntries(
    Object.keys(EMPTY_ADDRESS).map((key) => [key, stringValue(value[key])]),
  ));
}

function client(value: unknown): ManualQuoteClient | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.nome !== 'string') return null;
  return {
    id: value.id,
    nome: value.nome,
    ...(typeof value.email === 'string' ? { email: value.email } : {}),
    ...(typeof value.telefone === 'string' ? { telefone: value.telefone } : {}),
    ...(typeof value.cnpj === 'string' ? { cnpj: value.cnpj } : {}),
  };
}

function cartItem(value: unknown): ManualQuoteCartItem | null {
  if (!isRecord(value) || typeof value._key !== 'string' || typeof value.sku !== 'string' || typeof value.nome !== 'string') return null;
  if (typeof value.qty !== 'number' || !Number.isFinite(value.qty) || value.qty <= 0) return null;
  if (typeof value.rate !== 'number' || !Number.isFinite(value.rate) || value.rate < 0) return null;
  if (typeof value._rateManual !== 'boolean') return null;
  return {
    _key: value._key,
    sku: value.sku,
    nome: value.nome,
    qty: value.qty,
    rate: value.rate,
    _rateManual: value._rateManual,
  };
}

function opportunity(value: unknown): OpportunitySelection {
  if (!isRecord(value)) return { mode: 'new', opportunityId: null, demandSummary: '' };
  const mode = value.mode === 'existing' ? 'existing' : 'new';
  const opportunityId = typeof value.opportunityId === 'string' && value.opportunityId ? value.opportunityId : null;
  // An `existing` selection without an id is the unresolved state: it stays
  // unresolved so a restored draft still requires an explicit decision.
  return {
    mode,
    opportunityId,
    demandSummary: stringValue(value.demandSummary),
  };
}

function originPrefill(value: unknown): QuotationOriginPrefill | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !['quoteLeadId', 'crmDealId', 'leadName', 'email', 'telefone', 'source'].every((key) => typeof value[key] === 'string')) return undefined;
  return {
    quoteLeadId: value.quoteLeadId as string,
    crmDealId: value.crmDealId as string,
    leadName: value.leadName as string,
    email: value.email as string,
    telefone: value.telefone as string,
    source: value.source as string,
  };
}

export function sanitizeManualQuoteDraft(value: unknown): ManualQuoteDraft | null {
  if (!isRecord(value) || value.version !== MANUAL_QUOTE_DRAFT_STORAGE_VERSION) return null;
  const newClient = value.newClient;
  const items = value.items;
  if (!isRecord(newClient) || !['nome', 'email', 'telefone'].every((key) => typeof newClient[key] === 'string') || !Array.isArray(items)) return null;
  const sanitizedItems = items.map(cartItem);
  if (sanitizedItems.some((item) => item === null)) return null;
  const selectedClient = value.selectedClient === null || value.selectedClient === undefined ? null : client(value.selectedClient);
  if (value.selectedClient !== null && value.selectedClient !== undefined && !selectedClient) return null;
  const validOrigin = originPrefill(value.originPrefill);
  if (value.originPrefill !== undefined && !validOrigin) return null;
  return {
    version: MANUAL_QUOTE_DRAFT_STORAGE_VERSION,
    clientType: value.clientType === 'existing' ? 'existing' : 'new',
    clientSearch: stringValue(value.clientSearch),
    selectedClient,
    newClient: {
      nome: newClient.nome as string,
      email: newClient.email as string,
      telefone: newClient.telefone as string,
    },
    leadSource: stringValue(value.leadSource),
    cnpj: stringValue(value.cnpj),
    address: address(value.address),
    showAddress: value.showAddress === true,
    items: sanitizedItems as ManualQuoteCartItem[],
    prazo: stringValue(value.prazo),
    observacoes: stringValue(value.observacoes),
    urgente: value.urgente === true,
    templateKey: stringValue(value.templateKey),
    ...(validOrigin ? { originPrefill: validOrigin } : {}),
    opportunity: opportunity(value.opportunity),
    ...(typeof value.creationRequestId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.creationRequestId
    )
      ? { creationRequestId: value.creationRequestId }
      : {}),
  };
}

export function loadManualQuoteDraft(storage: Pick<Storage, 'getItem'> = window.localStorage): ManualQuoteDraft | null {
  try {
    return sanitizeManualQuoteDraft(JSON.parse(storage.getItem(MANUAL_QUOTE_DRAFT_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

export function saveManualQuoteDraft(storage: Pick<Storage, 'setItem'>, draft: Omit<ManualQuoteDraft, 'version'>): void {
  try {
    storage.setItem(MANUAL_QUOTE_DRAFT_STORAGE_KEY, JSON.stringify({ version: MANUAL_QUOTE_DRAFT_STORAGE_VERSION, ...draft }));
  } catch {
    // A storage failure never blocks the in-memory editor.
  }
}

export function clearManualQuoteDraft(storage: Pick<Storage, 'removeItem'> = window.localStorage): void {
  try {
    storage.removeItem(MANUAL_QUOTE_DRAFT_STORAGE_KEY);
  } catch {
    // Browser storage can be unavailable.
  }
}
