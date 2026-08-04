import { sql } from 'drizzle-orm';

/**
 * Serialize every transaction that can create or mutate quotation revisions.
 * Transaction-scoped PostgreSQL advisory locks release automatically on commit
 * or rollback and therefore cannot leak across pooled connections.
 */
export async function acquireQuotationWriteLock(
  tx: { execute?: (query: ReturnType<typeof sql>) => Promise<unknown> } | ((query: unknown) => Promise<unknown>)
): Promise<void> {
  const query = sql`select pg_advisory_xact_lock(8417392051842::bigint)`;
  if (typeof tx === 'function') {
    await tx(query);
    return;
  }
  if (!tx.execute) throw new Error('Transação PostgreSQL inválida para lock de escrita.');
  await tx.execute(query);
}
