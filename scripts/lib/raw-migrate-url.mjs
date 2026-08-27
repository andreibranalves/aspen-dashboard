/**
 * Guarda de apply raw (drizzle-kit). O apply só é permitido contra um alvo
 * PostgreSQL explicitamente descartável: loopback informado via
 * TEST_DATABASE_URL (CI já define esse contrato; rodadas locais devem usar
 * docker compose descartável). Produção e staging são alcançados apenas pelo
 * apply operacional em scripts/apply-migrations.mjs, que antes comprova a
 * identidade do alvo com o preflight completo.
 */
import { isDisposablePostgresUrl } from '../test-postgres.mjs';

export function resolveRawMigrateDatabaseUrl(env = process.env) {
  const raw = String(env.TEST_DATABASE_URL || '').trim();
  if (!raw) {
    throw new Error(
      'drizzle-kit exige TEST_DATABASE_URL apontando para um PostgreSQL local descartável ' +
        '(localhost, 127.0.0.1 ou [::1]). Alvos operacionais usam npm run migrate:apply.'
    );
  }
  if (!isDisposablePostgresUrl(raw)) {
    throw new Error(
      'TEST_DATABASE_URL deve apontar para um PostgreSQL local descartável ' +
        '(localhost, 127.0.0.1 ou [::1]); apply raw se recusou a conectar em alvo remoto ou inválido.'
    );
  }
  return raw;
}
