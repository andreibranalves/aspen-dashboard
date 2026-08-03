/**
 * Master cutoff flag.
 *
 * When `CRM_OPERATIONAL_MODE=true`, ALL core feature flags are implicitly
 * enabled and all Frappe-dependent handlers/pages are gated. Setting this
 * env var to `'true'` is the go-live action.
 */
export function isOperationalMode(): boolean {
  return process.env.CRM_OPERATIONAL_MODE === 'true';
}
