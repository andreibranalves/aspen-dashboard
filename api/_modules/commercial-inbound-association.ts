/**
 * Pure classification of how an inbound WhatsApp activity associates with open
 * commercial opportunities (#249, parent #239). No I/O, no clocks, no randomness.
 */
export type InboundAssociationResult =
  | { outcome: 'unambiguous'; opportunityId: string }
  /**
   * Exactly two or more deduplicated candidates. Order is the caller's insertion
   * order after dedup — never sorted alphabetically; ranking stays with the caller.
   */
  | { outcome: 'ambiguous'; candidateOpportunityIds: string[] }
  | { outcome: 'none' }
  | { outcome: 'outbound_generic' };

export type InboundIdentityStatus = 'verified' | 'derived' | 'unresolved' | 'conflict';

export interface InboundAssociationInput {
  direction: 'inbound' | 'outbound';
  identityStatus: InboundIdentityStatus;
  /** null when the identity could not be resolved to a phone (e.g. @lid without one). */
  canonicalPhone: string | null;
  /** Open opportunities linked to the identity, in any order, possibly with duplicates. */
  linkedOpportunityIds: string[];
}

const TRUSTED_IDENTITY_STATUSES: Record<InboundIdentityStatus, boolean> = {
  verified: true,
  derived: true,
  unresolved: false,
  conflict: false,
};

function uniqueTrimmedOpportunityIds(values: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = value.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * Generic outbound activity never counts as a reply and never picks an
 * opportunity (#239), even with a trusted identity, a phone and linked deals.
 * Untrusted identities and trusted identities without a canonical phone stay
 * `none` (a later ticket surfaces those as "Verificar conversa"; do not guess).
 */
export function classifyInboundAssociation(
  input: InboundAssociationInput
): InboundAssociationResult {
  if (input.direction === 'outbound') {
    return { outcome: 'outbound_generic' };
  }
  if (!TRUSTED_IDENTITY_STATUSES[input.identityStatus]) {
    return { outcome: 'none' };
  }
  if (input.canonicalPhone === null || input.canonicalPhone.trim().length === 0) {
    return { outcome: 'none' };
  }

  const candidates = uniqueTrimmedOpportunityIds(input.linkedOpportunityIds);
  if (candidates.length === 0) {
    return { outcome: 'none' };
  }
  if (candidates.length === 1) {
    return { outcome: 'unambiguous', opportunityId: candidates[0] };
  }
  return { outcome: 'ambiguous', candidateOpportunityIds: candidates };
}
