import { getOpenRouterConfig, type OpenRouterConfig } from './config.js';

export type { OpenRouterConfig } from './config.js';

export interface OpenRouterRequestOptions {
  title: string;
  signal?: AbortSignal;
}

export interface OpenRouterClient {
  config(): OpenRouterConfig;
  request(payload: Record<string, unknown>, options: OpenRouterRequestOptions): Promise<Response>;
}

export interface OpenRouterClientOptions {
  getConfig?: () => OpenRouterConfig;
  fetchImpl?: typeof fetch;
}

export function getOpenRouterClient(options: OpenRouterClientOptions = {}): OpenRouterClient {
  const getConfig = options.getConfig || getOpenRouterConfig;
  const fetchImpl = options.fetchImpl || fetch;

  return {
    config: getConfig,
    async request(payload, requestOptions) {
      const config = getConfig();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': requestOptions.title,
      };
      if (config.siteUrl) headers['HTTP-Referer'] = config.siteUrl;

      return fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: requestOptions.signal,
      });
    },
  };
}
