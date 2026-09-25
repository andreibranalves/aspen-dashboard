// GET /api/sales-dashboard - aggregated local sales metrics.
// PUT /api/sales-dashboard - save Meta spend for a calendar month.
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresAdSpendRepository,
  AdSpendInputError,
  type AdSpendRepository,
} from '../_infrastructure/db/repositories/ad-spend-repository.js';
import {
  createPostgresSalesOrdersRepository,
  type DashboardPeriod,
  type SalesDashboardResult,
  type SalesOrdersRepository,
} from '../_infrastructure/db/repositories/sales-orders-repository.js';
import {
  createPostgresSettingsRepository,
  DEFAULT_SETTINGS,
  type SettingsRepository,
} from '../_infrastructure/db/repositories/settings-repository.js';
import {
  getGoogleAdsSpendClient,
  type GoogleAdsSpendClient,
} from '../_infrastructure/integrations/google-ads/client.js';
import {
  canonicalizeNonNegativeDecimal,
} from '../_shared/decimal-money.js';
import {
  isCalendarMonthPeriod,
  yearMonthOf,
} from '../_shared/calendar-sao-paulo.js';
import { composeProfit, parseAliquotaPercent } from './profit.js';
import { safeLogMessage } from '../_shared/safe-error.js';

export interface SalesDashboardHandlerDependencies {
  repository?: Pick<SalesOrdersRepository, 'dashboard'>;
  settings?: Pick<SettingsRepository, 'get'>;
  adsSpend?: AdSpendRepository;
  googleAds?: GoogleAdsSpendClient;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function queryValue(
  query: Record<string, string | undefined>,
  key: string,
  lowerCase = false
): string | undefined {
  const value = query[key];
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return lowerCase ? normalized.toLowerCase() : normalized;
}

function dashboardOptions(query: Record<string, string | undefined>): DashboardPeriod {
  return {
    period: queryValue(query, 'period', true),
    from: queryValue(query, 'from'),
    to: queryValue(query, 'to'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logError(error: unknown): void {
  console.error('[sales-dashboard]', safeLogMessage(error));
}

async function withProfit(
  dashboard: SalesDashboardResult,
  options: DashboardPeriod,
  dependencies: Required<
    Pick<SalesDashboardHandlerDependencies, 'settings' | 'adsSpend' | 'googleAds'>
  >
): Promise<SalesDashboardResult> {
  const includeMeta = isCalendarMonthPeriod(options.period);
  const yearMonth = yearMonthOf(dashboard.period.from);
  const [settings, meta, google] = await Promise.all([
    dependencies.settings.get(),
    includeMeta ? dependencies.adsSpend.get(yearMonth) : Promise.resolve({ meta_spend: '0.00' }),
    dependencies.googleAds.fetchSpend({ start: dashboard.period.from, end: dashboard.period.to }),
  ]);
  const profit = composeProfit({
    faturamento: dashboard.summary.total_revenue,
    custo: dashboard.summary.custo ?? 0,
    google,
    metaAmount: Number(meta.meta_spend),
    includeMeta,
    aliquotaPercent: parseAliquotaPercent(settings?.aliquota ?? DEFAULT_SETTINGS.aliquota),
  });
  return {
    ...dashboard,
    summary: {
      ...dashboard.summary,
      ...profit,
      meta_editable: includeMeta,
    },
  };
}

export function createSalesDashboardHandler(
  dependencies: SalesDashboardHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresSalesOrdersRepository();
  const settings = dependencies.settings || createPostgresSettingsRepository();
  const adsSpend = dependencies.adsSpend || createPostgresAdSpendRepository();
  const googleAds = dependencies.googleAds || getGoogleAdsSpendClient();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    try {
      if (event.httpMethod === 'PUT') {
        let payload: unknown;
        try {
          payload = JSON.parse(event.body || '{}');
        } catch {
          return json(400, { error: 'JSON inválido.' });
        }
        if (!isRecord(payload)) return json(400, { error: 'Envie um gasto da Meta válido.' });
        const options = dashboardOptions(event.queryStringParameters || {});
        const period = queryValue(
          { period: typeof payload.period === 'string' ? payload.period : options.period },
          'period',
          true
        );
        if (!isCalendarMonthPeriod(period)) {
          return json(400, {
            error: 'A Meta só pode ser lançada em Este mês ou Mês passado.',
          });
        }
        const metaSpend = canonicalizeNonNegativeDecimal(payload.meta_spend, {
          maxIntegerDigits: 12,
        });
        if (!metaSpend) {
          return json(400, {
            error: 'Informe o gasto da Meta como valor decimal não negativo.',
          });
        }
        const dashboard = await repository.dashboard({ ...options, period });
        const saved = await adsSpend.upsert(yearMonthOf(dashboard.period.from), metaSpend);
        const composed = await withProfit(dashboard, { ...options, period }, {
          settings,
          adsSpend,
          googleAds,
        });
        return json(200, { ...composed, meta_spend: saved.meta_spend, year_month: saved.year_month });
      }

      if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
      const options = dashboardOptions(event.queryStringParameters || {});
      const dashboard = await repository.dashboard(options);
      return json(200, await withProfit(dashboard, options, { settings, adsSpend, googleAds }));
    } catch (error) {
      logError(error);
      if (error instanceof AdSpendInputError) {
        return json(error.statusCode, { error: error.message });
      }
      const statusCode = Number.isInteger((error as { statusCode?: unknown })?.statusCode)
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
      return json(statusCode, {
        error: statusCode === 500 ? 'Erro interno.' : (error as Error).message,
      });
    }
  };
}

export const createHandler = createSalesDashboardHandler;
export const handler = createSalesDashboardHandler();
