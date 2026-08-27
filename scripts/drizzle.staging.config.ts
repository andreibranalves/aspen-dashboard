import { defineConfig } from 'drizzle-kit';

/**
 * Config do apply operacional de migrations (npm run migrate:apply). Este
 * arquivo é invocado apenas por scripts/apply-migrations.mjs depois que o
 * preflight completo comprovou a identidade do alvo; a URL nunca vem de
 * padrões vagos de ambiente (ela é injetada como MIGRATION_TARGET_DATABASE_URL
 * pelo comando operacional). O apply raw de CI/alvos descartáveis segue em
 * drizzle.config.ts com guarda própria.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './api/_infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.MIGRATION_TARGET_DATABASE_URL || '',
  },
  verbose: true,
  strict: true,
});
