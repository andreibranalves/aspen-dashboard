// Single seam through which every DB-gated unit test resolves its PostgreSQL
// target. A configured URL must point at a disposable loopback PostgreSQL;
// anything remote or malformed fails closed instead of connecting.
import { isDisposablePostgresUrl } from '../../scripts/test-postgres.mjs';

export const DEFAULT_TEST_DATABASE_CANDIDATE_KEYS = ['TEST_DATABASE_URL'];

export function resolveDisposableTestDatabaseUrl(
  env = process.env,
  candidateKeys = DEFAULT_TEST_DATABASE_CANDIDATE_KEYS
) {
  const key = candidateKeys.find((name) => String(env[name] || '').trim());
  if (!key) return undefined;

  const raw = String(env[key]).trim();
  if (!isDisposablePostgresUrl(raw)) {
    throw new Error(
      `${key} deve apontar para um PostgreSQL local descartável ` +
        '(localhost, 127.0.0.1 ou [::1]); o teste se recusou a conectar em alvo remoto ou inválido.'
    );
  }
  return raw;
}
