import { sql } from 'drizzle-orm';

/**
 * Serialize every transaction that can create or mutate quotation revisions.
 * Transaction-scoped PostgreSQL advisory locks release automatically on commit
 * or rollback and therefore cannot leak across pooled connections.
 */
export async function acquireQuotationWriteLock(
  tx: { execute?: (query: ReturnType<typeof sql>) => Promise<unknown> } | ((strings: TemplateStringsArray, ...values: never[]) => Promise<unknown>)
): Promise<void> {
  if (typeof tx === 'function') {
    // postgres.js transaction clients are tagged-template functions, not Drizzle
    // executors. Pass a real template strings array so the query is executed.
    const strings = Object.assign(['select pg_advisory_xact_lock(8417392051842::bigint)'], {
      raw: ['select pg_advisory_xact_lock(8417392051842::bigint)'],
    }) as unknown as TemplateStringsArray;
    await tx(strings);
    return;
  }
  const query = sql`select pg_advisory_xact_lock(8417392051842::bigint)`;
  if (!tx.execute) throw new Error('Transação PostgreSQL inválida para lock de escrita.');
  await tx.execute(query);
}
