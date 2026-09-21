// Durable state of an automatic draft, shared by the page that persists the
// draft and by the automatic client identity resolution.
//
// A draft that already reached the server has an effective identifier and
// snapshot: neither may be rewritten by a query preview, and a removed draft
// never receives new resolution work. Keeping the field list in one place stops
// the two callers from drifting apart when a durable flag is added.

import type { Draft, StoredAutoQuoteDraft } from '../../types/domain.ts';

/** True when the draft already carries state produced by the server: saved
 * reference, issue attempt, issued revision or an in-flight creation. */
export function draftHasDurableQuotationState(draft: Draft): boolean {
  const stored = draft as StoredAutoQuoteDraft;
  return Boolean(
    stored.saved ||
      stored.issueIdempotencyKey ||
      stored.issueDispatchStarted ||
      stored.issue ||
      stored.issueRecoveryRequired ||
      stored.sourceQuotationId ||
      stored.sourceRevisionId ||
      stored.status ||
      stored.result
  );
}
