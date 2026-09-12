import type { SQL } from 'drizzle-orm';
import type { Sql } from 'postgres';

import type { AppDatabase } from './client.js';

type Database = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export class DbDeadlineExceededError extends Error {
  constructor() {
    super('Prazo do banco de dados excedido.');
    this.name = 'DbDeadlineExceededError';
  }
}

/**
 * A single wall-clock budget shared by every statement of one reconciliation or
 * post-acceptance projection. It is the real cancellation primitive the
 * serverless pool needs:
 *
 * - `remainingMs` is recomputed before every statement, so a multi-statement
 *   transaction never receives a fresh full statement allowance per statement;
 * - `track` registers the postgres.js pending query of the statement currently
 *   running (or queued waiting for the sole pooled connection), so expiry calls
 *   `query.cancel()`: a queued statement is removed from the pool queue and an
 *   active one is cancelled by PostgreSQL. Nothing can commit after the
 *   deadline.
 */
export interface DbDeadline {
  readonly expired: boolean;
  remainingMs(): number;
  assertActive(): void;
  track(cancel: () => void): () => void;
  readonly whenExpired: Promise<never>;
  dispose(): void;
}

export function createDbDeadline(budgetMs: number): DbDeadline {
  const duration = Math.max(1, Math.floor(budgetMs));
  const endsAt = Date.now() + duration;
  const cancels = new Set<() => void>();
  let expired = false;
  let rejectExpired!: (error: unknown) => void;
  const whenExpired = new Promise<never>((_, reject) => {
    rejectExpired = reject;
  });
  // A deadline that expires while nobody races it must never surface as an
  // unhandled rejection.
  whenExpired.catch(() => {});

  // This timer must remain referenced: it is the only handle that settles
  // `whenExpired` when the bounded operation has nothing else pending. On Node
  // 22 an unreferenced timer lets the event loop resolve while the promise is
  // still pending, so the operation would never reject.
  const timer = setTimeout(() => expire(), duration);

  function expire(): void {
    if (expired) return;
    expired = true;
    clearTimeout(timer);
    const pending = [...cancels];
    cancels.clear();
    for (const cancel of pending) {
      try {
        cancel();
      } catch {
        // Cancellation is best effort; the server-side statement timeout and
        // `assertActive` remain the backstops.
      }
    }
    rejectExpired(new DbDeadlineExceededError());
  }

  const deadline: DbDeadline = {
    get expired() {
      return expired || Date.now() >= endsAt;
    },
    remainingMs() {
      return Math.max(0, endsAt - Date.now());
    },
    assertActive() {
      if (expired || Date.now() >= endsAt) {
        expire();
        throw new DbDeadlineExceededError();
      }
    },
    track(cancel) {
      if (expired || Date.now() >= endsAt) {
        try {
          cancel();
        } catch {
          // Ignore: the operation is already past its deadline.
        }
        return () => {};
      }
      cancels.add(cancel);
      return () => {
        cancels.delete(cancel);
      };
    },
    whenExpired,
    dispose() {
      clearTimeout(timer);
      cancels.clear();
    },
  };
  return deadline;
}

function rawClient(db: Database): Sql {
  const candidate = db as unknown as {
    $client?: Sql;
    session?: { client?: Sql };
  };
  const client = candidate.$client || candidate.session?.client;
  if (!client || typeof client.unsafe !== 'function') {
    throw new Error('Conexão PostgreSQL indisponível para operação limitada.');
  }
  return client;
}

function queryText(db: Database, fragment: SQL): { sql: string; params: unknown[] } {
  const dialect = (db as unknown as { dialect?: { sqlToQuery(query: SQL): { sql: string; params: unknown[] } } })
    .dialect;
  if (!dialect || typeof dialect.sqlToQuery !== 'function') {
    throw new Error('Dialeto PostgreSQL indisponível para operação limitada.');
  }
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql, params: query.params };
}

/**
 * Runs one already-built statement on the pooled client under the shared
 * deadline. The raw postgres.js query handle is registered with the deadline so
 * a queued statement is removed from the pool queue and a running one is
 * cancelled on expiry.
 */
export async function runBoundedBuiltQuery<T>(
  db: Database,
  deadline: DbDeadline,
  query: { sql: string; params: unknown[] },
): Promise<T[]> {
  deadline.assertActive();
  const client = rawClient(db);
  const pending = client.unsafe(query.sql, query.params as never[]);
  const untrack = deadline.track(() => pending.cancel());
  try {
    const rows = (await pending) as unknown as T[];
    return rows;
  } finally {
    untrack();
  }
}

/**
 * Runs one drizzle `SQL` fragment on the pooled client under the shared
 * deadline. The raw postgres.js query handle is registered with the deadline so
 * a queued statement is removed from the pool queue and a running one is
 * cancelled on expiry.
 */
export async function runBoundedStatement<T>(
  db: Database,
  deadline: DbDeadline,
  fragment: SQL,
): Promise<T[]> {
  deadline.assertActive();
  return runBoundedBuiltQuery<T>(db, deadline, queryText(db, fragment));
}
