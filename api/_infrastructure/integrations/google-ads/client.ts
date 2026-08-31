import {
  getGoogleAdsConfig,
  isGoogleAdsConfigured,
  type GoogleAdsConfig,
} from './config.js';

export type { GoogleAdsConfig } from './config.js';

export interface GoogleAdsSpendResult {
  amount: number;
  available: boolean;
}

export interface GoogleAdsSpendQuery {
  start: string;
  end: string;
}

export interface GoogleAdsSpendClient {
  fetchSpend(query: GoogleAdsSpendQuery): Promise<GoogleAdsSpendResult>;
}

export interface GoogleAdsSpendClientOptions {
  getConfig?: () => GoogleAdsConfig;
  fetchImpl?: typeof fetch;
}

const UNAVAILABLE: GoogleAdsSpendResult = { amount: 0, available: false };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function costMicrosFromRow(row: unknown): bigint {
  const metrics = asRecord(asRecord(row)?.metrics);
  if (!metrics) return 0n;
  const raw = metrics.costMicros ?? metrics.cost_micros;
  if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  return 0n;
}

function roundMoney(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

async function refreshAccessToken(
  config: GoogleAdsConfig,
  fetchImpl: typeof fetch
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) return null;
  const payload = asRecord(await response.json().catch(() => null));
  const token = payload?.access_token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function microsToAmount(totalMicros: bigint): number {
  const whole = totalMicros / 1_000_000n;
  const remainder = totalMicros % 1_000_000n;
  return roundMoney(Number(whole) + Number(remainder) / 1_000_000);
}

export function getGoogleAdsSpendClient(
  options: GoogleAdsSpendClientOptions = {}
): GoogleAdsSpendClient {
  const getConfig = options.getConfig || getGoogleAdsConfig;
  const fetchImpl = options.fetchImpl || fetch;

  return {
    async fetchSpend(query) {
      const config = getConfig();
      if (!isGoogleAdsConfigured(config)) return UNAVAILABLE;
      try {
        const accessToken = await refreshAccessToken(config, fetchImpl);
        if (!accessToken) return UNAVAILABLE;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': config.developerToken,
          'Content-Type': 'application/json',
        };
        if (config.loginCustomerId) {
          headers['login-customer-id'] = config.loginCustomerId;
        }
        const gaql =
          `SELECT metrics.cost_micros FROM customer ` +
          `WHERE segments.date BETWEEN '${query.start}' AND '${query.end}'`;
        const response = await fetchImpl(
          `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/googleAds:search`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ query: gaql }),
          }
        );
        if (!response.ok) return UNAVAILABLE;
        const payload = asRecord(await response.json().catch(() => null));
        const rows = Array.isArray(payload?.results) ? payload.results : [];
        let totalMicros = 0n;
        for (const row of rows) totalMicros += costMicrosFromRow(row);
        return { amount: microsToAmount(totalMicros), available: true };
      } catch {
        return UNAVAILABLE;
      }
    },
  };
}
