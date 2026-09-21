import { eq, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { getDatabase, type AppDatabase } from '../client.js';
import { clients } from '../client-schema.js';
import {
  foldClientText,
  type ClientMatchRecord,
  type NormalizedClientMatchInput,
} from '../../../_modules/client-matching.js';
import { escapeLikeSearchPattern } from './client-repository.js';

type DatabaseProvider = () => AppDatabase;

/**
 * Minimum executor surface shared by the pooled database and an open
 * transaction, so the quotation save path resolves candidates inside its own
 * transaction instead of opening a second connection.
 */
export type ClientMatchExecutor = Pick<AppDatabase, 'select'>;

export interface ClientMatchRepository {
  search(input: NormalizedClientMatchInput): Promise<ClientMatchRecord[]>;
}

/** Accents folded by the database-side pattern; the classifier folds names and
 * companies on its own, so this expression only widens recall. */
const ACCENT_FOLD_SOURCE = 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ';
const ACCENT_FOLD_TARGET = 'aaaaaaeeeeiiiiooooouuuucnyy';

function foldedColumnExpression(column: AnyPgColumn): SQL {
  return sql`translate(regexp_replace(lower(${column}), '\\s+', ' ', 'g'), ${ACCENT_FOLD_SOURCE}, ${ACCENT_FOLD_TARGET})`;
}

/**
 * Reads every candidate the input can point at: strong equality on document,
 * e-mail and phone (no `LIKE`), plus an accent- and case-insensitive text
 * search on name and company. Archived clients are deliberately included so a
 * consumer cannot manufacture a false "not found".
 */
export async function searchClientMatchCandidates(
  executor: ClientMatchExecutor,
  input: NormalizedClientMatchInput
): Promise<ClientMatchRecord[]> {
  const filters: SQL[] = [];
  if (input.documento) filters.push(eq(clients.documento, input.documento));
  if (input.email) filters.push(eq(clients.email, input.email));
  if (input.telefone) filters.push(eq(clients.telefone, input.telefone));
  for (const term of input.textTerms) {
    const pattern = `%${escapeLikeSearchPattern(foldClientText(term))}%`;
    filters.push(
      or(
        sql`${foldedColumnExpression(clients.nome)} LIKE ${pattern}`,
        sql`${foldedColumnExpression(clients.empresa)} LIKE ${pattern}`
      )!
    );
  }
  if (!filters.length) return [];

  const rows = await executor.select().from(clients).where(or(...filters));
  return rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    empresa: row.empresa ?? null,
    documento: row.documento ?? null,
    email: row.email ?? null,
    telefone: row.telefone ?? null,
    arquivado: Boolean(row.arquivado),
  }));
}

/** PostgreSQL-backed candidate lookup used by the read-only matching route. */
export function createPostgresClientMatchRepository(
  getDb: DatabaseProvider = getDatabase
): ClientMatchRepository {
  return {
    search: (input) => searchClientMatchCandidates(getDb(), input),
  };
}
