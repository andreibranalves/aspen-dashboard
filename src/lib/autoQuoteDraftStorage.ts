import type {
  DraftItem,
  QuotationIssueProjection,
  StoredAutoQuoteDraft,
} from '../types/domain.ts';

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

function isDraftItem(value: unknown): value is DraftItem {
  if (!isRecord(value) || typeof value.item_code !== 'string' || !isFiniteNumber(value.qty)) {
    return false;
  }
  return (
    value.qty >= 0 &&
    (value.rate === null || isFiniteNumber(value.rate)) &&
    (value.item_name === undefined || typeof value.item_name === 'string') &&
    (value._rateManual === undefined || typeof value._rateManual === 'boolean')
  );
}

function isAddress(value: unknown): boolean {
  return isRecord(value) &&
    ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']
      .every((key) => typeof value[key] === 'string');
}

function isQuotationIssueProjection(value: unknown): value is QuotationIssueProjection {
  if (!isRecord(value)) return false;
  return (
    typeof value.quotationId === 'string' &&
    typeof value.businessNumber === 'string' &&
    typeof value.revisionId === 'string' &&
    typeof value.revisionNumber === 'number' &&
    Number.isInteger(value.revisionNumber) &&
    value.revisionNumber > 0 &&
    value.status === 'emitido' &&
    typeof value.issuedAt === 'string' &&
    typeof value.validUntil === 'string' &&
    typeof value.pdfUrl === 'string'
  );
}

function isStoredAutoQuoteDraft(value: unknown): value is StoredAutoQuoteDraft {
  if (!isRecord(value)) return false;
  const edited = value.edited;
  if (!isRecord(edited) || typeof edited.nome !== 'string' || !edited.nome.trim()) return false;
  if (
    typeof edited.email !== 'string' ||
    typeof edited.telefone !== 'string' ||
    typeof edited.urgente !== 'boolean' ||
    typeof edited.origem !== 'string' ||
    typeof edited.cnpj !== 'string' ||
    typeof edited.prazo_producao !== 'string' ||
    !isAddress(edited.endereco) ||
    (edited._showAddr !== undefined && typeof edited._showAddr !== 'boolean') ||
    (edited.template_key !== undefined && typeof edited.template_key !== 'string') ||
    !Array.isArray(edited.items) ||
    edited.items.length === 0 ||
    !edited.items.every(isDraftItem)
  ) {
    return false;
  }
  if (!Number.isInteger(value.index) || (value.index as number) < 0) return false;
  if (!isRecord(value.original) || typeof value.approved !== 'boolean' || typeof value.discarded !== 'boolean') {
    return false;
  }
  if (value.status !== undefined && !['processing', 'done', 'error'].includes(String(value.status))) {
    return false;
  }
  if (value.result !== undefined) {
    if (!isRecord(value.result) || typeof value.result.success !== 'boolean') return false;
    if (value.result.data !== undefined && !isRecord(value.result.data)) return false;
    if (value.result.error !== undefined && typeof value.result.error !== 'string') return false;
  }
  if (value.issue !== undefined && !isQuotationIssueProjection(value.issue)) return false;
  if (value.sourceQuotationId !== undefined && typeof value.sourceQuotationId !== 'string') return false;
  if (value.sourceRevisionId !== undefined && typeof value.sourceRevisionId !== 'string') return false;

  // A stale key must never prevent editing/restoring a draft; omit it so issuance creates a new key.
  if (
    value.issueIdempotencyKey !== undefined &&
    (typeof value.issueIdempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.issueIdempotencyKey))
  ) return false;
  return true;
}

export function loadAutoQuoteDrafts(storage: ReadStorage): StoredAutoQuoteDraft[] {
  try {
    const parsed = JSON.parse(storage.getItem(AUTO_QUOTE_DRAFTS_STORAGE_KEY) || 'null');
    // Read the previous unversioned array during the transition; all new writes are versioned.
    if (Array.isArray(parsed)) return parsed.filter(isStoredAutoQuoteDraft);
    if (!isRecord(parsed) || parsed.version !== AUTO_QUOTE_DRAFTS_STORAGE_VERSION || !Array.isArray(parsed.drafts)) {
      return [];
    }
    return parsed.drafts.filter(isStoredAutoQuoteDraft);
  } catch {
    return [];
  }
}

export function saveAutoQuoteDrafts(storage: WriteStorage, drafts: StoredAutoQuoteDraft[]): void {
  try {
    storage.setItem(
      AUTO_QUOTE_DRAFTS_STORAGE_KEY,
      JSON.stringify({ version: AUTO_QUOTE_DRAFTS_STORAGE_VERSION, drafts }),
    );
  } catch {
    // localStorage can be unavailable or full; draft editing must continue.
  }
}
