import { defineConfig } from 'drizzle-kit';
import { resolveRawMigrateDatabaseUrl } from './scripts/lib/raw-migrate-url.mjs';

export default defineConfig({
  dialect: 'postgresql',
  schema: './api/_infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Apply raw apenas para alvos descartáveis (CI ou loopback local). Falha
    // fechada antes de qualquer conexão quando o alvo não é comprovadamente
    // descartável; operações em staging/produção usam npm run migrate:apply.
    url: resolveRawMigrateDatabaseUrl(process.env),
  },
  verbose: true,
  strict: true,
});
