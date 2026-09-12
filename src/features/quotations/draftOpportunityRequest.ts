export interface DraftOpportunityRequest {
  key: string;
  token: symbol;
}

export interface DraftOpportunityApplication {
  choices: boolean;
  selection: boolean;
  settleLoading: boolean;
}

export function shouldStartDraftOpportunityRequest(input: {
  request: DraftOpportunityRequest | undefined;
  key: string;
  hasOrigin: boolean;
  clientId: string | undefined;
}): boolean {
  return !input.hasOrigin
    && Boolean(input.clientId?.trim())
    && !draftOpportunityRequestMatches(input.request, input.key);
}

/** Identity of a demand load: the draft index plus the client it belongs to.
 * Editing the same draft keeps this key stable; changing the client produces a
 * new one, so the previous in-flight request stops being current. */
export function draftOpportunityRequestKey(index: number, clientId: string): string {
  return `${index}\u0000${clientId.trim()}`;
}

export function draftOpportunityRequestMatches(
  request: DraftOpportunityRequest | undefined,
  key: string
): boolean {
  return request !== undefined && request.key === key;
}

export function draftOpportunityRequestIsCurrent(
  request: DraftOpportunityRequest | undefined,
  token: symbol
): boolean {
  return request !== undefined && request.token === token;
}

/** Decides what a resolved demand load may still touch. A stale response (the
 * client changed, the queue was cleared or the draft was removed) never applies.
 * An operator decision made while the request was in flight keeps its choice. */
export function planDraftOpportunityApplication(input: {
  request: DraftOpportunityRequest | undefined;
  token: symbol;
  draftActive: boolean;
  alreadyDecided: boolean;
}): DraftOpportunityApplication {
  const current =
    input.draftActive && draftOpportunityRequestIsCurrent(input.request, input.token);
  return {
    choices: current,
    selection: current && !input.alreadyDecided,
    settleLoading: current,
  };
}
