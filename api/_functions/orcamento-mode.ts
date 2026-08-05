/**
 * Quote-draft rollout switch. Only the exact string `true` enables the
 * PostgreSQL aggregate; every other value remains on the preserved Frappe
 * implementation. CRM_OPERATIONAL_MODE does NOT control this flag - quotes
 * have independent rollout control.
 */
export function isCoreQuotesEnabled(): boolean {
  return process.env.CRM_CORE_QUOTES_ENABLED === 'true';
}

export type QuoteRolloutState = 'legacy' | 'postgres-write' | 'postgres-read-only' | 'rollback-compatible';

/**
 * Explicit rollout state for the quotation subsystem.
 * Each state has distinct read/write semantics:
 * - legacy: Frappe only
 * - postgres-write: read+write postgres
 * - postgres-read-only: read postgres, write Frappe
 * - rollback-compatible: read postgres if present, fall back Frappe; write Frappe
 */
export function getQuoteRolloutState(): QuoteRolloutState {
  const raw = process.env.CRM_QUOTES_ROLLOUT_STATE;
  if (raw === 'postgres-write' || raw === 'postgres-read-only' || raw === 'rollback-compatible') {
    return raw;
  }
  return 'legacy';
}

/** True when the quote subsystem has moved beyond legacy Frappe. */
export function isQuoteEndpointEnabled(): boolean {
  return getQuoteRolloutState() !== 'legacy';
}

// ── Precedence-aware dispatch helpers ────────────────────────────────────────
//
// Precedence matrix (CRM_CORE_QUOTES_ENABLED x CRM_QUOTES_ROLLOUT_STATE):
//
// | Flag    | Rollout state     | Effective state |
// |---------|-------------------|------------------|
// | false   | any               | legacy           |
// | true    | unset / legacy    | postgres-write   |
// | true    | postgres-write    | postgres-write   |
// | true    | postgres-read-only| postgres-read-only|
// | true    | rollback-compat.  | rollback-compat. |
//
// CRM_CORE_QUOTES_ENABLED is the master switch. CRM_QUOTES_ROLLOUT_STATE
// selects the migration phase when the flag is on.

/**
 * Resolves the effective rollout state combining both env vars.
 * CRM_CORE_QUOTES_ENABLED=false always returns 'legacy' regardless
 * of CRM_QUOTES_ROLLOUT_STATE.
 */
export function resolveEffectiveRolloutState(): QuoteRolloutState {
  if (!isCoreQuotesEnabled()) return 'legacy';
  const raw = getQuoteRolloutState();
  // Flag on + unset/legacy state -> postgres-write (default migration phase)
  if (raw === 'legacy') return 'postgres-write';
  return raw;
}

/** Core PostgreSQL reads are allowed when effective state is not legacy. */
export function isCoreReadEnabled(): boolean {
  return resolveEffectiveRolloutState() !== 'legacy';
}

/** Core PostgreSQL writes are allowed only in postgres-write state. */
export function isCoreWriteEnabled(): boolean {
  return resolveEffectiveRolloutState() === 'postgres-write';
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
