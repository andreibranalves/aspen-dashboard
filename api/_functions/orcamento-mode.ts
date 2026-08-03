/**
 * Quote-draft rollout switch. Only the exact string `true` enables the
 * PostgreSQL aggregate; every other value remains on the preserved Frappe
 * implementation.
 */
export function isCoreQuotesEnabled(): boolean {
  if (process.env.CRM_OPERATIONAL_MODE === 'true') return true;
  return process.env.CRM_CORE_QUOTES_ENABLED === 'true';
}
export type QuoteResponseMode = 'core' | 'legacy';

export function responseMetadata(mode: QuoteResponseMode): {
  core_mode: boolean;
  source: 'postgres' | 'frappe';
} {
  return mode === 'core'
    ? { core_mode: true, source: 'postgres' }
    : { core_mode: false, source: 'frappe' };
}
