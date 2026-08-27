import type { Draft, QuotationIssueProjection } from '@/types/domain';

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
      pagamento: draft.edited.pagamento || undefined,
      entrega: draft.edited.entrega || undefined,
      observacoes: draft.edited.observacoes || undefined,
      frete: draft.edited.frete || undefined,
      validade_dias: draft.edited.validade_dias,
      ...(draft.edited.template_key ? { template_key: draft.edited.template_key } : {}),
    },
  };
}

export type QuotationIssueResult = QuotationIssueProjection;
export type QuotationIssueStatus =
  | { state: 'processing'; retryAfterMs: number }
  | { state: 'retryable'; error: string }
  | ({ state: 'completed' } & QuotationIssueResult);

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
    quotationId: input.quotationId,
    businessNumber: input.businessNumber,
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    status: input.status,
    issuedAt: input.issuedAt,
    validUntil: input.validUntil,
    pdfUrl: input.pdfUrl,
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

/** Issue an existing persisted draft by reference: revision identity plus
 * concurrency token identify the whole operation; no commercial fields are
 * sent or accepted. */
export async function issuePersistedDraft(
  revisionId: string,
  concurrencyToken: string,
  idempotencyKey: string,
): Promise<QuotationIssueResult> {
  const result = await requestIssue('/api/quotation-issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ revision_id: revisionId, concurrency_token: concurrencyToken }),
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
