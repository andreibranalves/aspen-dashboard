import { defineConfig } from 'drizzle-kit';
import { assertOperationalMigrateApproved } from './lib/operational-migrate-guard.mjs';

/**
 * Config do apply operacional de migrations (npm run migrate:apply). Este
 * arquivo é invocado apenas por scripts/apply-migrations.mjs depois que o
 * preflight completo comprovou a identidade do alvo; a URL nunca vem de
 * padrões vagos de ambiente. O apply raw de CI/alvos descartáveis segue em
 * drizzle.config.ts com guarda própria.
 */
const targetUrl = assertOperationalMigrateApproved(process.env);

export default defineConfig({
  dialect: 'postgresql',
  schema: './api/_infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: targetUrl,
  },
  verbose: true,
  strict: true,
});
