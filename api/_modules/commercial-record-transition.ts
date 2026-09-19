/**
 * Pure classification of current commercial records for the auditable
 * transition prep into opportunity next actions (#253, parent #239).
 * No I/O, no clocks, no randomness, no transport side effects.
 */

export const TRANSITION_CLASSIFICATIONS = [
  'open_opportunity',
  'closed',
  'dismissed',
  'restricted',
  'uncertain_association',
] as const;

export type TransitionClassification = (typeof TRANSITION_CLASSIFICATIONS)[number];

export const CLOSED_OPPORTUNITY_STATUSES = ['Pedido Fechado', 'Perdido'] as const;

export const INSUFFICIENT_EVIDENCE_REVIEW_REASON =
  'Evidência insuficiente para afirmar silêncio do cliente';

export const FALSE_SILENCE_LABEL = 'Sem resposta';

export type OpportunityTransitionFacts = {
  opportunityId: string;
  status: string;
  clientId: string | null;
  /** Other open opportunities for the same client/phone — never merge. */
  siblingOpenOpportunityIds: readonly string[];
  hasActiveNextAction: boolean;
  hasSuspendedRestrictedAction: boolean;
  /** Prior completed/cancelled/superseded actions or accepted follow-up history. */
  hasAcceptedHistory: boolean;
  /** Dismissed follow-up attempts that must remain preserved. */
  hasDismissedAttempts: boolean;
  /** WhatsApp contact carries an active Não contatar restriction. */
  contactRestricted: boolean;
  /**
   * True when telemetry/history is too thin to invent a return that claims
   * customer silence. Forces review instead of a false "Sem resposta".
   */
  insufficientEvidenceForSilence: boolean;
};

export type TransitionApplyPlan =
  | { type: 'noop'; preserve: true }
  | { type: 'keep_active_action'; preserve: true }
  | { type: 'ensure_suspended_action' }
  | { type: 'ensure_verify_conversation'; reason: string };

export type OpportunityTransitionDecision = {
  classification: TransitionClassification;
  opportunityId: string;
  clientId: string | null;
  siblingOpenOpportunityIds: string[];
  reviewReason: string | null;
  applyPlan: TransitionApplyPlan;
};

function uniqueIds(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isClosedStatus(status: string): boolean {
  return (CLOSED_OPPORTUNITY_STATUSES as readonly string[]).includes(status);
}

/**
 * Classify one opportunity for transition preview/apply. Sibling ids are kept
 * for audit only — equal client/phone never fuses demands.
 */
export function classifyOpportunityTransition(
  facts: OpportunityTransitionFacts,
): OpportunityTransitionDecision {
  const siblingOpenOpportunityIds = uniqueIds(
    facts.siblingOpenOpportunityIds.filter((id) => id !== facts.opportunityId),
  );
  const base = {
    opportunityId: facts.opportunityId,
    clientId: facts.clientId,
    siblingOpenOpportunityIds,
  };

  if (isClosedStatus(facts.status)) {
    return {
      ...base,
      classification: 'closed',
      reviewReason: null,
      applyPlan: { type: 'noop', preserve: true },
    };
  }

  if (facts.contactRestricted) {
    return {
      ...base,
      classification: 'restricted',
      reviewReason: null,
      applyPlan: facts.hasSuspendedRestrictedAction
        ? { type: 'noop', preserve: true }
        : { type: 'ensure_suspended_action' },
    };
  }

  if (facts.hasDismissedAttempts && !facts.hasActiveNextAction && !facts.hasAcceptedHistory) {
    return {
      ...base,
      classification: 'dismissed',
      reviewReason: null,
      applyPlan: { type: 'noop', preserve: true },
    };
  }

  if (facts.insufficientEvidenceForSilence && !facts.hasActiveNextAction) {
    return {
      ...base,
      classification: 'uncertain_association',
      reviewReason: INSUFFICIENT_EVIDENCE_REVIEW_REASON,
      applyPlan: {
        type: 'ensure_verify_conversation',
        reason: INSUFFICIENT_EVIDENCE_REVIEW_REASON,
      },
    };
  }

  if (facts.hasActiveNextAction) {
    return {
      ...base,
      classification: 'open_opportunity',
      reviewReason: null,
      applyPlan: { type: 'keep_active_action', preserve: true },
    };
  }

  if (facts.hasAcceptedHistory) {
    return {
      ...base,
      classification: 'open_opportunity',
      reviewReason: null,
      applyPlan: {
        type: 'ensure_verify_conversation',
        reason: INSUFFICIENT_EVIDENCE_REVIEW_REASON,
      },
    };
  }

  // Unreachable when facts follow the repository invariant
  // (insufficientEvidenceForSilence = !hasActiveNextAction && !hasAcceptedHistory);
  // the conservative fallback never invents a first contact nor claims silence.
  return {
    ...base,
    classification: 'uncertain_association',
    reviewReason: INSUFFICIENT_EVIDENCE_REVIEW_REASON,
    applyPlan: {
      type: 'ensure_verify_conversation',
      reason: INSUFFICIENT_EVIDENCE_REVIEW_REASON,
    },
  };
}

export type TransitionPreviewSummary = {
  counts: Record<TransitionClassification, number>;
  decisions: OpportunityTransitionDecision[];
  /** Client groups that still list multiple open demands (never auto-merged). */
  unmergedClientGroups: Array<{ clientId: string; opportunityIds: string[] }>;
};

export function summarizeTransitionDecisions(
  decisions: readonly OpportunityTransitionDecision[],
): TransitionPreviewSummary {
  const counts: Record<TransitionClassification, number> = {
    open_opportunity: 0,
    closed: 0,
    dismissed: 0,
    restricted: 0,
    uncertain_association: 0,
  };
  for (const decision of decisions) {
    counts[decision.classification] += 1;
  }

  const byClient = new Map<string, string[]>();
  for (const decision of decisions) {
    if (
      decision.classification !== 'open_opportunity' &&
      decision.classification !== 'uncertain_association'
    ) {
      continue;
    }
    if (!decision.clientId) continue;
    const list = byClient.get(decision.clientId) || [];
    list.push(decision.opportunityId);
    byClient.set(decision.clientId, list);
  }

  const unmergedClientGroups: TransitionPreviewSummary['unmergedClientGroups'] = [];
  for (const [clientId, opportunityIds] of byClient) {
    const unique = uniqueIds(opportunityIds);
    if (unique.length > 1) {
      unmergedClientGroups.push({ clientId, opportunityIds: unique });
    }
  }

  return {
    counts,
    decisions: [...decisions],
    unmergedClientGroups,
  };
}

/** Guard: review reasons must never claim false customer silence. */
export function assertNoFalseSilenceLabel(reason: string | null | undefined): void {
  if (!reason) return;
  if (reason.trim().toLowerCase() === FALSE_SILENCE_LABEL.toLowerCase()) {
    throw new Error('Transição comercial não pode rotular silêncio sem evidência.');
  }
}
