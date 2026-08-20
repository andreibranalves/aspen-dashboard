export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

type Environment = typeof process.env;

export function getEvolutionConfig(env: Environment = process.env): EvolutionConfig {
  return {
    baseUrl: (env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (env.EVOLUTION_API_KEY || '').trim(),
    instance: (env.EVOLUTION_INSTANCE || '').trim(),
  };
}
