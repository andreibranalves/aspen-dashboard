type Environment = typeof process.env;

export function isKvConfigured(env: Environment = process.env): boolean {
  return Boolean(env.KV_REST_API_URL?.trim() && env.KV_REST_API_TOKEN?.trim());
}
