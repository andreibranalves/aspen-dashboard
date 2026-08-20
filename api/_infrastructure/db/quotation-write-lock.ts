import { sql } from 'drizzle-orm';

export const QUOTATION_WRITE_LOCK_KEY = 8417392051842n;

/**
 * Serialize every transaction that can create or mutate quotation revisions.
 * Transaction-scoped PostgreSQL advisory locks release automatically on commit
 * or rollback and therefore cannot leak across pooled connections.
 */
export type QuotationWriteTransaction =
  { execute?: (query: ReturnType<typeof sql>) => Promise<unknown> }
  | ((strings: TemplateStringsArray, ...values: never[]) => Promise<unknown>);

export async function acquireQuotationWriteLock(tx: QuotationWriteTransaction): Promise<void> {
  if (typeof tx === 'function') {
    // postgres.js transaction clients are tagged-template functions, not Drizzle
    // executors. Pass a real template strings array so the query is executed.
    const query = `select pg_advisory_xact_lock(${QUOTATION_WRITE_LOCK_KEY}::bigint)`;
    const strings = Object.assign([query], { raw: [query] }) as unknown as TemplateStringsArray;
    await tx(strings);
    return;
  }
  const query = sql`select pg_advisory_xact_lock(${QUOTATION_WRITE_LOCK_KEY}::bigint)`;
  if (!tx.execute) throw new Error('Transação PostgreSQL inválida para lock de escrita.');
  await tx.execute(query);
}

/** Run a revision mutation after the database advisory lock is acquired. */
export async function withQuotationWriteLock<T>(
  tx: QuotationWriteTransaction,
  operation: () => Promise<T>,
  acquire: (transaction: QuotationWriteTransaction) => Promise<void> = acquireQuotationWriteLock,
): Promise<T> {
  await acquire(tx);
  return operation();
}
