import { shouldPublishFollowUpImmediately } from '../../../_modules/quotation-follow-up-state.js';
import { assertExternalWritesAllowed } from '../../../_shared/external-writes.js';

export interface QuotationFollowUpQstashEnvironment {
  QSTASH_TOKEN?: string;
  QSTASH_API_URL?: string;
  CRON_SECRET?: string;
  QUOTATION_FOLLOW_UP_WORKER_URL?: string;
}

export interface PublishFollowUpInput {
  followUpId: string;
  approvalsCreatedTodayUtc: number;
}

export interface QuotationFollowUpQstashDependencies {
  environment?: QuotationFollowUpQstashEnvironment;
  fetch?: typeof fetch;
  fetchImpl?: typeof fetch;
}

export class QuotationFollowUpQstashError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'QuotationFollowUpQstashError';
  }
}

function configurationError(): QuotationFollowUpQstashError {
  return new QuotationFollowUpQstashError('Publicação do follow-up não configurada.');
}

function workerUrl(environment: QuotationFollowUpQstashEnvironment): string {
  const raw = environment.QUOTATION_FOLLOW_UP_WORKER_URL?.trim();
  if (!raw) throw configurationError();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw configurationError();
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase().includes('vercel.app')) {
    throw configurationError();
  }
  return parsed.toString();
}

function apiUrl(environment: QuotationFollowUpQstashEnvironment): string {
  const raw = (environment.QSTASH_API_URL || 'https://qstash.upstash.io').trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw configurationError();
  }
  if (parsed.protocol !== 'https:') throw configurationError();
  return raw;
}

function validInput(input: PublishFollowUpInput): void {
  if (!input || typeof input.followUpId !== 'string' || !input.followUpId.trim()) {
    throw new QuotationFollowUpQstashError('Identificador do follow-up inválido.');
  }
  if (!Number.isSafeInteger(input.approvalsCreatedTodayUtc) || input.approvalsCreatedTodayUtc < 0) {
    throw new QuotationFollowUpQstashError('Contagem diária de aprovações inválida.');
  }
}

/** Publishes one approved follow-up; the periodic recovery schedule handles cap overflow. */
export async function publishQuotationFollowUp(
  input: PublishFollowUpInput,
  dependencies: QuotationFollowUpQstashDependencies = {},
): Promise<boolean> {
  validInput(input);
  if (!shouldPublishFollowUpImmediately(input.approvalsCreatedTodayUtc)) return false;

  const environment = dependencies.environment || process.env;
  assertExternalWritesAllowed('qstash', environment as typeof process.env);
  const token = environment.QSTASH_TOKEN?.trim();
  const cronSecret = environment.CRON_SECRET?.trim();
  if (!token || !cronSecret) throw configurationError();
  const target = workerUrl(environment);
  const endpoint = `${apiUrl(environment)}/v2/publish/${encodeURIComponent(target)}`;
  const fetchImpl = dependencies.fetchImpl || dependencies.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw configurationError();

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
        'Upstash-Retries': '0',
        'Upstash-Deduplication-Id': input.followUpId,
        'Upstash-Redact-Fields': 'header[Authorization]',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ follow_up_id: input.followUpId }),
    });
  } catch {
    throw new QuotationFollowUpQstashError('Não foi possível publicar o follow-up.');
  }
  const status = Number(response?.status);
  if (status < 200 || status >= 300) {
    throw new QuotationFollowUpQstashError('Não foi possível publicar o follow-up.');
  }
  return true;
}

export const publishFollowUp = publishQuotationFollowUp;
export const publishQuotationFollowUpToQstash = publishQuotationFollowUp;
