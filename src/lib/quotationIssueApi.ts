import type { Draft, QuotationIssueProjection } from '@/types/domain';
import type { QuotationSectionsSnapshot } from '../../api/_db/quotation-content';

type BuiltQuotationDraft = ReturnType<typeof buildQuotePayload>;
type BuiltQuotationExtracted = BuiltQuotationDraft['extracted'];
type OptionalDraftMetadata = 'urgente' | 'origem' | 'cnpj' | 'endereco';

export type QuotationDraftInput = {
  extracted: Omit<BuiltQuotationExtracted, OptionalDraftMetadata> &
    Partial<Pick<BuiltQuotationExtracted, OptionalDraftMetadata>> & {
      frete?: string;
      pagamento?: string;
      entrega?: string;
      observacoes?: string;
      validade_dias?: number;
      template_version_id?: string;
      secoes?: QuotationSectionsSnapshot;
    };
};

export function buildQuotePayload(draft: Draft) {
  return {
    extracted: {
      nome: draft.edited.nome,
      email: draft.edited.email || null,
      telefone: draft.edited.telefone || null,
      urgente: draft.edited.urgente,
      origem: draft.edited.origem || undefined,
      cnpj: draft.edited.cnpj || undefined,
      endereco: draft.edited.endereco || undefined,
      items: draft.edited.items
        .filter((item) => item.item_code && item.qty > 0)
        .map((item) => ({
          item_code: item.item_code,
          item_name: item.item_name || '',
          qty: item.qty,
          rate: item.rate,
          manual_rate: item._rateManual === true,
        })),
      prazo_producao: draft.edited.prazo_producao || undefined,
      ...(draft.edited.template_key ? { template_key: draft.edited.template_key } : {}),
    },
  };
}

export type QuotationIssueResult = QuotationIssueProjection;
export type QuotationIssueStatus =
  | { state: 'processing'; retryAfterMs: number }
  | { state: 'retryable'; error: string }
  | ({ state: 'completed' } & QuotationIssueResult);

export function isPriceAuthoritativeConflict(error: unknown): error is QuotationIssueApiError {
  if (!(error instanceof QuotationIssueApiError) || error.status !== 409) return false;
  const data = error.data && typeof error.data === 'object' ? error.data as Record<string, unknown> : {};
  const marker = [data.code, data.category, data.conflict_type, data.conflictType]
    .filter((value): value is string => typeof value === 'string')
    .join(' ').toLowerCase();
  if (/price|pre[cç]o|pricing/.test(marker)) return true;
  const message = error.message.toLowerCase();
  return /pre[cç]o\s+(?:do\s+produto\s+)?(?:foi\s+)?atualizad|pre[cç]o\s+indispon[ií]vel|pricing/.test(message);
}

export class QuotationIssueApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'QuotationIssueApiError';
    this.status = status;
    this.data = data;
  }
}

function projection(value: unknown): QuotationIssueResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Resposta inválida da emissão do orçamento.');
  }
  const input = value as Record<string, unknown>;
  const result = {
    quotationId: input.quotationId ?? input.quotation_id,
    businessNumber: input.businessNumber ?? input.business_number ?? input.quotation_id,
    revisionId: input.revisionId ?? input.revision_id,
    revisionNumber: input.revisionNumber ?? input.revision_number,
    status: input.status,
    issuedAt: input.issuedAt ?? input.issued_at,
    validUntil: input.validUntil ?? input.valid_until,
    pdfUrl: input.pdfUrl ?? input.pdf_url,
  };
  if (
    typeof result.quotationId !== 'string' ||
    typeof result.businessNumber !== 'string' ||
    typeof result.revisionId !== 'string' ||
    typeof result.revisionNumber !== 'number' ||
    !Number.isInteger(result.revisionNumber) ||
    result.revisionNumber < 1 ||
    result.status !== 'emitido' ||
    typeof result.issuedAt !== 'string' ||
    typeof result.validUntil !== 'string' ||
    typeof result.pdfUrl !== 'string'
  ) {
    throw new Error('Resposta inválida da emissão do orçamento.');
  }
  return result as QuotationIssueResult;
}

async function requestIssue(path: string, options: RequestInit = {}): Promise<QuotationIssueResult | QuotationIssueStatus> {
  const response = await fetch(path, options);
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message = data && typeof data === 'object' && typeof (data as Record<string, unknown>).error === 'string'
      ? (data as Record<string, string>).error
      : 'Não foi possível emitir o orçamento. Tente novamente.';
    throw new QuotationIssueApiError(message, response.status, data);
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida da emissão do orçamento.');
  const state = (data as Record<string, unknown>).state;
  if (state === 'processing') {
    const retryAfterMs = (data as Record<string, unknown>).retryAfterMs;
    if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error('Resposta inválida da emissão do orçamento.');
    return { state, retryAfterMs };
  }
  if (state === 'retryable') {
    const error = (data as Record<string, unknown>).error;
    if (typeof error !== 'string' || !error) throw new Error('Resposta inválida da emissão do orçamento.');
    return { state, error };
  }
  const result = projection(data);
  return 'state' in data && state === 'completed' ? { state: 'completed', ...result } : result;
}

export async function issueQuotation(
  draft: QuotationDraftInput,
  idempotencyKey: string,
  source?: { sourceLeadId?: string; sourceQuotationId?: string; sourceRevisionId?: string },
): Promise<QuotationIssueResult> {
  const result = await requestIssue('/api/quotation-issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ draft, ...source }),
  });
  if ('state' in result) {
    if (result.state === 'completed') return result;
    throw new Error(result.state === 'retryable' ? result.error : 'Emissão em processamento. Tente novamente em instantes.');
  }
  return result;
}

export async function getQuotationIssue(idempotencyKey: string): Promise<QuotationIssueStatus> {
  const result = await requestIssue(`/api/quotation-issues?idempotency_key=${encodeURIComponent(idempotencyKey)}`);
  if ('state' in result) return result;
  return { state: 'completed', ...result };
}

export { projection as parseQuotationIssueProjection };
