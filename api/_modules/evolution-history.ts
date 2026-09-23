// Read-only access to the WhatsApp history kept by the Evolution instance
// (chat list and paginated messages). Used by the attendance backfill.

import { getEvolutionClient } from '../_infrastructure/integrations/evolution/client.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import { createHttpError } from '../_shared/http-error.js';

const EVOLUTION_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

async function readEvolutionJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES)) {
    throw new Error('provider response too large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    return response.json().catch(() => null);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('provider response too large');
      chunks.push(next.value);
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export interface EvolutionRequestOptions {
  baseUrl?: string;
  apiKey?: string;
  instance?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function evolutionRequest(
  path: string,
  body?: Record<string, unknown>,
  options: EvolutionRequestOptions = {},
): Promise<unknown> {
  const configured = getEvolutionConfig();
  const mergedConfig = {
    baseUrl: options.baseUrl ?? configured.baseUrl,
    apiKey: options.apiKey ?? configured.apiKey,
    instance: options.instance ?? configured.instance,
  };
  if (!mergedConfig.baseUrl || !mergedConfig.apiKey || !mergedConfig.instance) {
    throw createHttpError(503, 'Integração WhatsApp não configurada.');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(options.timeoutMs ?? EVOLUTION_TIMEOUT_MS));
  const client = getEvolutionClient({
    getConfig: () => mergedConfig,
    fetchImpl: options.fetchImpl,
  });
  let timedOut = false;
  let rejectTimeout: ((reason?: unknown) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout?.(new Error('Evolution request timeout'));
  }, timeoutMs);
  try {
    const response = await Promise.race([
      client.request(path, body, {
        externalWrite: false,
        signal: controller.signal,
      }),
      timeout,
    ]);
    const data = await Promise.race([readEvolutionJson(response), timeout]);
    if (!response.ok) {
      throw createHttpError(
        response.status,
        'Erro ao sincronizar conversas do WhatsApp.',
        `[evolution-history] ${path} HTTP ${response.status}`
      );
    }
    return data;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    if (timedOut || controller.signal.aborted) {
      throw createHttpError(
        504,
        'Tempo limite ao sincronizar conversas do WhatsApp.',
        `[evolution-history] ${path} timeout`
      );
    }
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp. Verifique a instância da Evolution API.',
      `[evolution-history] ${path} fetch failed`
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function unwrapEvolutionCollection(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;

  const value = payload as Record<string, unknown> | null;
  const candidates = [
    value?.data,
    value?.messages,
    value?.chats,
    value?.result,
    value?.response,
    (value?.data as Record<string, unknown> | undefined)?.messages,
    (value?.data as Record<string, unknown> | undefined)?.chats,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as Array<Record<string, unknown>>;
    if (
      candidate &&
      typeof candidate === 'object' &&
      Array.isArray((candidate as Record<string, unknown>).records)
    ) {
      return (candidate as { records: Array<Record<string, unknown>> }).records;
    }
  }
  return [];
}


function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null;
}

export async function fetchEvolutionChats(
  request: typeof evolutionRequest = evolutionRequest,
): Promise<Array<Record<string, unknown>>> {
  const data = await request(`/chat/findChats/${getEvolutionConfig().instance}`, {});
  return unwrapEvolutionCollection(data);
}

export interface EvolutionMessagePage {
  records: Array<Record<string, unknown>>;
  /** Total page count reported by the provider; null when it does not paginate. */
  pages: number | null;
}

export async function fetchEvolutionMessagePage(
  remoteJid: string,
  page: number,
  pageSize: number,
  request: typeof evolutionRequest = evolutionRequest,
): Promise<EvolutionMessagePage> {
  const data = await request(`/chat/findMessages/${getEvolutionConfig().instance}`, {
    where: { key: { remoteJid } },
    page,
    offset: pageSize,
  });
  const envelope = record(record(data)?.messages) || record(data);
  return {
    records: unwrapEvolutionCollection(data),
    pages: positiveInteger(envelope?.pages),
  };
}
