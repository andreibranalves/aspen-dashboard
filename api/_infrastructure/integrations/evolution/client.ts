import { assertExternalWritesAllowed } from '../../../_shared/external-writes.js';
import { getEvolutionConfig, type EvolutionConfig } from './config.js';

export type { EvolutionConfig } from './config.js';

export interface EvolutionRequestOptions {
  externalWrite?: boolean;
  signal?: AbortSignal;
}

export interface EvolutionClient {
  config(): EvolutionConfig;
  request(
    path: string,
    body?: Record<string, unknown>,
    options?: EvolutionRequestOptions,
  ): Promise<Response>;
}

export interface EvolutionClientOptions {
  getConfig?: () => EvolutionConfig;
  fetchImpl?: typeof fetch;
  assertWriteAllowed?: () => void;
}

export function getEvolutionClient(options: EvolutionClientOptions = {}): EvolutionClient {
  const getConfig = options.getConfig || getEvolutionConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const assertWriteAllowed =
    options.assertWriteAllowed || (() => assertExternalWritesAllowed('evolution'));

  return {
    config: getConfig,
    async request(path, body, requestOptions = {}) {
      if (requestOptions.externalWrite !== false) assertWriteAllowed();
      const config = getConfig();
      const serializedBody = body ? JSON.stringify(body) : undefined;
      return fetchImpl(`${config.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
        body: serializedBody,
        signal: requestOptions.signal,
      });
    },
  };
}
