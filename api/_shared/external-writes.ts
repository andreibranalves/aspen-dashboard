import { createHttpError } from './http-error.js';

export type ExternalWriteProvider = 'evolution' | 'email' | 'google-data-manager' | 'blob';

type Environment = typeof process.env;

export function isExternalWritesAllowed(env: Environment = process.env): boolean {
  return (
    (!env.VERCEL_ENV || env.VERCEL_ENV.trim().toLowerCase() === 'production') &&
    String(env.APP_ENV || '').trim().toLowerCase() === 'production' &&
    String(env.EXTERNAL_WRITES_ENABLED || '').trim() === '1'
  );
}

export function assertExternalWritesAllowed(
  provider: ExternalWriteProvider,
  env: Environment = process.env,
): void {
  if (isExternalWritesAllowed(env)) return;
  throw createHttpError(
    503,
    'Integrações externas desativadas neste ambiente.',
    `[external-writes] blocked provider: ${provider}`,
  );
}
