/** Prova de que migrate:apply concluiu preflight antes do drizzle operacional. */
export function assertOperationalMigrateApproved(env = process.env) {
  const targetUrl = String(env.MIGRATION_TARGET_DATABASE_URL || '').trim();
  if (env.MIGRATE_APPLY_APPROVED !== '1' || !targetUrl) {
    throw new Error(
      'Apply operacional exige npm run migrate:apply (preflight + aprovação). ' +
        'Não use db:migrate:operational nem MIGRATION_TARGET_DATABASE_URL diretamente.',
    );
  }
  return targetUrl;
}
