import type { OpportunityChoice } from '@/lib/api/proposalOpportunitiesApi';

export type OpportunitySelectionMode = 'existing' | 'new';

export interface OpportunitySelection {
  mode: OpportunitySelectionMode;
  opportunityId: string | null;
  demandSummary: string;
}

export const NEW_DEMAND_SELECTION: OpportunitySelection = {
  mode: 'new',
  opportunityId: null,
  demandSummary: '',
};

/**
 * Starting point for the operator's choice. One plausible demand is offered
 * selected; several demands force an explicit pick and never default to the
 * most recent one; none defaults to opening a new demand.
 */
export function initialOpportunitySelection(choices: OpportunityChoice[]): OpportunitySelection {
  if (choices.length === 0) return { ...NEW_DEMAND_SELECTION };
  if (choices.length === 1) {
    return { mode: 'existing', opportunityId: choices[0].opportunityId, demandSummary: '' };
  }
  // More than one plausible demand: leave nothing selected so the operator
  // must confirm. Never default to the most recent one.
  return { mode: 'existing', opportunityId: null, demandSummary: '' };
}

/**
 * Decides what to do when the demand choices for the selected client arrive.
 * A restored/hydrated selection belongs to the same client and must be kept,
 * even when it is no longer eligible (it stays blocked and requires a new
 * decision). Only a real client change resets the choice, and even then it
 * never auto-selects a different opportunity when several candidates exist.
 */
export function reconcileOpportunitySelection(
  current: OpportunitySelection,
  choices: OpportunityChoice[],
  options: { sameClient: boolean }
): OpportunitySelection {
  if (options.sameClient) return current;
  return initialOpportunitySelection(choices);
}

export function isOpportunitySelectionValid(
  selection: OpportunitySelection,
  choices: OpportunityChoice[]
): boolean {
  if (selection.mode === 'new') return true;
  if (!selection.opportunityId) return false;
  return choices.some((choice) => choice.opportunityId === selection.opportunityId);
}

export interface OpportunitySelectionPayload {
  opportunity_id?: string;
  new_demand?: true;
  demand_summary?: string;
}

export function opportunitySelectionPayload(
  selection: OpportunitySelection
): OpportunitySelectionPayload {
  if (selection.mode === 'existing') {
    // An unresolved choice never silently becomes a new demand; it stays
    // unlinked until the operator confirms.
    return selection.opportunityId ? { opportunity_id: selection.opportunityId } : {};
  }
  const summary = selection.demandSummary.trim();
  return summary ? { new_demand: true, demand_summary: summary } : { new_demand: true };
}
