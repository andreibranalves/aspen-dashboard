import type { DraftItem, QuotationIssueProjection, StoredAutoQuoteDraft } from '../../types/domain.ts';
import { EMPTY_ADDRESS, normalizeAddress } from '../clientMetadata.ts';

export const AUTO_QUOTE_DRAFTS_STORAGE_KEY = 'aspen_drafts';
export const AUTO_QUOTE_DRAFTS_STORAGE_VERSION = 1;

type RecordValue = Record<string, unknown>;
type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeRecord(value: unknown): RecordValue {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).reduce<Array<[string, unknown]>>((result, [key, item]) => {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') result.push([key, item]);
    else if (Array.isArray(item)) result.push([key, item.map((entry) => sanitizeRecord(entry))]);
    else if (isRecord(item)) result.push([key, sanitizeRecord(item)]);
    return result;
  }, []);
  return Object.fromEntries(entries);
}

function isDraftItem(value: unknown): value is DraftItem {
  if (!isRecord(value) || typeof value.item_code !== 'string' || !isFiniteNumber(value.qty)) return false;
  return value.qty >= 0 && (value.rate === null || isFiniteNumber(value.rate)) &&
    (value.item_name === undefined || typeof value.item_name === 'string') &&
    (value._rateManual === undefined || typeof value._rateManual === 'boolean');
}

function sanitizeAddress(value: unknown) {
  if (!isRecord(value)) return { ...EMPTY_ADDRESS };
  return normalizeAddress(Object.fromEntries(
    ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']
      .map((key) => [key, typeof value[key] === 'string' ? value[key] : '']),
  ));
}

function isQuotationIssueProjection(value: unknown): value is QuotationIssueProjection {
  if (!isRecord(value)) return false;
  return typeof value.quotationId === 'string' && Boolean(value.quotationId) &&
    typeof value.businessNumber === 'string' && Boolean(value.businessNumber) &&
    typeof value.revisionId === 'string' && Boolean(value.revisionId) &&
    typeof value.revisionNumber === 'number' && Number.isInteger(value.revisionNumber) && value.revisionNumber > 0 &&
    value.status === 'emitido' && typeof value.issuedAt === 'string' && typeof value.validUntil === 'string' && typeof value.pdfUrl === 'string';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function savedReference(value: unknown): StoredAutoQuoteDraft['saved'] | undefined {
  if (!isRecord(value)) return undefined;
  const quotationId = optionalString(value.quotationId);
  const businessNumber = optionalString(value.businessNumber);
  const revisionId = optionalString(value.revisionId);
  const concurrencyToken = optionalString(value.concurrencyToken);
  return quotationId && businessNumber && revisionId && concurrencyToken
    ? { quotationId, businessNumber, revisionId, concurrencyToken }
    : undefined;
}

function isStoredAutoQuoteDraft(value: unknown): value is StoredAutoQuoteDraft {
  if (!isRecord(value) || !Number.isInteger(value.index) || (value.index as number) < 0 || !isRecord(value.original)) return false;
  const edited = value.edited;
  if (!isRecord(edited) || typeof edited.nome !== 'string' || !edited.nome.trim() ||
    typeof edited.email !== 'string' || typeof edited.telefone !== 'string' || typeof edited.urgente !== 'boolean' ||
    typeof edited.origem !== 'string' || typeof edited.cnpj !== 'string' || typeof edited.prazo_producao !== 'string' ||
    !isRecord(edited.endereco) || !Array.isArray(edited.items) || edited.items.length === 0 || !edited.items.every(isDraftItem) ||
    (edited._showAddr !== undefined && typeof edited._showAddr !== 'boolean') ||
    (edited.template_key !== undefined && typeof edited.template_key !== 'string')) return false;
  if (typeof value.approved !== 'boolean' || typeof value.discarded !== 'boolean') return false;
  if (value.status !== undefined && !['processing', 'done', 'error'].includes(String(value.status))) return false;
  if (value.result !== undefined && (!isRecord(value.result) || typeof value.result.success !== 'boolean' ||
    (value.result.data !== undefined && !isRecord(value.result.data)) ||
    (value.result.error !== undefined && typeof value.result.error !== 'string'))) return false;
  if (value.issue !== undefined && !isQuotationIssueProjection(value.issue)) return false;
  if (value.sourceQuotationId !== undefined && typeof value.sourceQuotationId !== 'string') return false;
  if (value.sourceRevisionId !== undefined && typeof value.sourceRevisionId !== 'string') return false;
  // A stale key is omitted below so it never prevents restoring/editing a draft.
  return value.issueIdempotencyKey === undefined || typeof value.issueIdempotencyKey === 'string';
}

function sanitizeStoredAutoQuoteDraft(value: unknown): StoredAutoQuoteDraft | null {
  if (!isStoredAutoQuoteDraft(value)) return null;
  const edited = value.edited as unknown as RecordValue;
  const nextEdited = {
    nome: edited.nome as string,
    email: edited.email as string,
    telefone: edited.telefone as string,
    urgente: edited.urgente as boolean,
    origem: edited.origem as string,
    cnpj: edited.cnpj as string,
    endereco: sanitizeAddress(edited.endereco),
    items: (edited.items as DraftItem[]).map((item) => ({
      item_code: item.item_code,
      qty: item.qty,
      rate: item.rate,
      ...(typeof item.item_name === 'string' ? { item_name: item.item_name } : {}),
      ...(typeof item._rateManual === 'boolean' ? { _rateManual: item._rateManual } : {}),
    })),
    prazo_producao: edited.prazo_producao as string,
    ...(optionalString(edited.pagamento) ? { pagamento: edited.pagamento as string } : {}),
    ...(optionalString(edited.entrega) ? { entrega: edited.entrega as string } : {}),
    ...(optionalString(edited.observacoes) ? { observacoes: edited.observacoes as string } : {}),
    ...(optionalString(edited.frete) ? { frete: edited.frete as string } : {}),
    ...(isFiniteNumber(edited.validade_dias) ? { validade_dias: edited.validade_dias } : {}),
    ...(optionalString(edited.template_key) ? { template_key: edited.template_key as string } : {}),
    ...(edited._showAddr === true ? { _showAddr: true } : {}),
    ...(optionalString(edited.client_id) ? { client_id: edited.client_id as string } : {}),
    ...(optionalString(edited.quote_lead_id) ? { quote_lead_id: edited.quote_lead_id as string } : {}),
    ...(optionalString(edited.crm_deal_id) ? { crm_deal_id: edited.crm_deal_id as string } : {}),
  };
  const issueIdempotencyKey = typeof value.issueIdempotencyKey === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.issueIdempotencyKey)
    ? value.issueIdempotencyKey
    : undefined;
  const result = isRecord(value.result)
    ? {
        success: value.result.success as boolean,
        ...(isRecord(value.result.data) ? { data: sanitizeRecord(value.result.data) } : {}),
        ...(typeof value.result.error === 'string' ? { error: value.result.error } : {}),
      }
    : undefined;
  const saved = savedReference(value.saved);
  return {
    index: value.index,
    original: sanitizeRecord(value.original),
    edited: nextEdited,
    approved: value.approved,
    discarded: value.discarded,
    ...(value.status && ['processing', 'done', 'error'].includes(value.status as string) ? { status: value.status } : {}),
    ...(result ? { result } : {}),
    ...(saved ? { saved } : {}),
    ...(issueIdempotencyKey ? { issueIdempotencyKey } : {}),
    ...(isQuotationIssueProjection(value.issue) ? { issue: value.issue } : {}),
    ...(optionalString(value.sourceQuotationId) ? { sourceQuotationId: value.sourceQuotationId as string } : {}),
    ...(optionalString(value.sourceRevisionId) ? { sourceRevisionId: value.sourceRevisionId as string } : {}),
  } as StoredAutoQuoteDraft;
}

export function loadAutoQuoteDrafts(storage: ReadStorage): StoredAutoQuoteDraft[] {
  try {
    const parsed = JSON.parse(storage.getItem(AUTO_QUOTE_DRAFTS_STORAGE_KEY) || 'null');
    const drafts = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && parsed.version === AUTO_QUOTE_DRAFTS_STORAGE_VERSION && Array.isArray(parsed.drafts)
        ? parsed.drafts
        : [];
    return drafts.map(sanitizeStoredAutoQuoteDraft).filter((draft): draft is StoredAutoQuoteDraft => draft !== null);
  } catch {
    return [];
  }
}

export function saveAutoQuoteDrafts(storage: WriteStorage, drafts: StoredAutoQuoteDraft[]): void {
  try {
    storage.setItem(AUTO_QUOTE_DRAFTS_STORAGE_KEY, JSON.stringify({ version: AUTO_QUOTE_DRAFTS_STORAGE_VERSION, drafts }));
  } catch {
    // Browser storage can be unavailable or full; draft editing must continue.
  }
}
