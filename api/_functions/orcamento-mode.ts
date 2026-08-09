/**
 * Quote-draft rollout switch. Operational mode is the post-Frappe cutoff and
 * therefore forces the PostgreSQL quote aggregate on.
 */
export function isCoreQuotesEnabled(): boolean {
  return process.env.CRM_OPERATIONAL_MODE === 'true' || process.env.CRM_CORE_QUOTES_ENABLED === 'true';
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

/** True when the effective quote subsystem has moved beyond legacy Frappe. */
export function isQuoteEndpointEnabled(): boolean {
  return resolveEffectiveRolloutState() !== 'legacy';
}

// ── Precedence-aware dispatch helpers ────────────────────────────────────────
//
// Precedence matrix (CRM_OPERATIONAL_MODE, CRM_CORE_QUOTES_ENABLED x CRM_QUOTES_ROLLOUT_STATE):
//
// | Operational | Flag    | Rollout state     | Effective state   |
// |-------------|---------|-------------------|-------------------|
// | true        | any     | any               | postgres-write    |
// | false       | false   | any               | legacy            |
// | false       | true    | unset             | postgres-write    |
// | false       | true    | legacy            | legacy            |
// | false       | true    | postgres-write    | postgres-write    |
// | false       | true    | postgres-read-only| postgres-read-only|
// | false       | true    | rollback-compat.  | rollback-compatible|
//
// CRM_OPERATIONAL_MODE is the master post-Frappe cutoff. The individual
// quote flag and rollout state remain available for gradual rollout testing.

/**
 * Resolves the effective rollout state combining the operational cutoff and
 * gradual quote rollout variables.
 */
export function resolveEffectiveRolloutState(): QuoteRolloutState {
  if (process.env.CRM_OPERATIONAL_MODE === 'true') return 'postgres-write';
  if (!isCoreQuotesEnabled()) return 'legacy';
  const raw = process.env.CRM_QUOTES_ROLLOUT_STATE;
  // Flag on + unset state -> postgres-write (default migration phase)
  // Flag on + explicit 'legacy' -> legacy (operator choice preserved)
  // Flag on + other explicit state -> that state
  // Flag on + unrecognized value -> postgres-write (safe default)
  if (raw === 'legacy') return 'legacy';
  if (raw === 'postgres-write' || raw === 'postgres-read-only' || raw === 'rollback-compatible') {
    return raw;
  }
  return 'postgres-write';
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
