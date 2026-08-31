import { eq } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { adSpendMonths } from '../schema.js';

const YEAR_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export class AdSpendInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'AdSpendInputError';
  }
}

export interface AdSpendMonth {
  year_month: string;
  meta_spend: string;
}

export interface AdSpendRepository {
  get(yearMonth: string): Promise<AdSpendMonth>;
  upsert(yearMonth: string, metaSpend: string): Promise<AdSpendMonth>;
}

type DatabaseProvider = () => AppDatabase;

export function normalizeYearMonth(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!YEAR_MONTH.test(normalized)) {
    throw new AdSpendInputError('Informe o mês no formato AAAA-MM.');
  }
  return normalized;
}

export function createPostgresAdSpendRepository(
  getDb: DatabaseProvider = getDatabase
): AdSpendRepository {
  return {
    async get(yearMonth: string): Promise<AdSpendMonth> {
      const normalized = normalizeYearMonth(yearMonth);
      const db = getDb();
      const [row] = await db
        .select()
        .from(adSpendMonths)
        .where(eq(adSpendMonths.yearMonth, normalized))
        .limit(1);
      return { year_month: normalized, meta_spend: row?.metaSpend ?? '0.00' };
    },

    async upsert(yearMonth: string, metaSpend: string): Promise<AdSpendMonth> {
      const normalized = normalizeYearMonth(yearMonth);
      const db = getDb();
      const [row] = await db
        .insert(adSpendMonths)
        .values({
          yearMonth: normalized,
          metaSpend,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: adSpendMonths.yearMonth,
          set: { metaSpend, updatedAt: new Date() },
        })
        .returning();
      if (!row) throw new Error('Não foi possível salvar o gasto da Meta.');
      return { year_month: row.yearMonth, meta_spend: row.metaSpend };
    },
  };
}
