export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  siteUrl: string;
}

type Environment = typeof process.env;

export function getOpenRouterConfig(env: Environment = process.env): OpenRouterConfig {
  return {
    apiKey: (env.OPENROUTER_API_KEY || '').trim(),
    model: (env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL,
    siteUrl:
      (env.OPENROUTER_SITE_URL || '').trim() ||
      (env.URL || '').trim() ||
      (env.DEPLOY_PRIME_URL || '').trim(),
  };
}
