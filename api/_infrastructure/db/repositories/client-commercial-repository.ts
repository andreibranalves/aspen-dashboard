import { and, desc, eq, ne } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { crmDeals, quoteRevisions, quotations, salesOrders } from '../schema.js';
import type {
  ClientDealSummary,
  ClientOrderSummary,
  ClientQuotationSummary,
} from '../../../_modules/client-core.js';

export interface ClientCommercialRepository {
  latestQuotation(clientId: string): Promise<ClientQuotationSummary | null>;
  activeDeal(clientId: string): Promise<ClientDealSummary | null>;
  orders(clientId: string): Promise<ClientOrderSummary[]>;
}

type DatabaseProvider = () => AppDatabase;

function asDate(value: unknown): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value: unknown): string | undefined {
  return asDate(value)?.toISOString().slice(0, 10);
}

function money(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return value;
  return undefined;
}

export function createPostgresClientCommercialRepository(
  getDb: DatabaseProvider = getDatabase
): ClientCommercialRepository {
  return {
    async latestQuotation(clientId) {
      const database = getDb();
      const [quotation] = await database
        .select()
        .from(quotations)
        .where(eq(quotations.clientId, clientId))
        .orderBy(desc(quotations.createdAt), desc(quotations.id))
        .limit(1);
      if (!quotation) return null;
      const [revision] = await database
        .select({ total: quoteRevisions.total })
        .from(quoteRevisions)
        .where(eq(quoteRevisions.quotationId, quotation.id))
        .orderBy(desc(quoteRevisions.version))
        .limit(1);
      const total = money(revision?.total);
      const date = dateOnly(quotation.createdAt);
      return {
        name: quotation.businessNumber,
        status: quotation.status,
        ...(date ? { date } : {}),
        ...(total !== undefined ? { grand_total: total } : {}),
      };
    },
    async activeDeal(clientId) {
      const [deal] = await getDb()
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.clientId, clientId), ne(crmDeals.status, 'Perdido')))
        .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.id))
        .limit(1);
      if (!deal) return null;
      return {
        name: deal.nome,
        status: deal.status,
        ...(deal.nextStep ? { next_step: deal.nextStep } : {}),
      };
    },
    async orders(clientId) {
      const rows = await getDb()
        .select({
          name: salesOrders.orderNumber,
          status: salesOrders.status,
          date: salesOrders.transactionDate,
          grandTotal: salesOrders.grandTotal,
        })
        .from(salesOrders)
        .where(eq(salesOrders.clientId, clientId))
        .orderBy(desc(salesOrders.createdAt), desc(salesOrders.id))
        .limit(10);
      return rows.map((row) => {
        const date = dateOnly(row.date);
        const total = money(row.grandTotal);
        return {
          name: row.name,
          status: row.status,
          ...(date ? { date } : {}),
          ...(total !== undefined ? { grand_total: total } : {}),
        };
      });
    },
  };
}
