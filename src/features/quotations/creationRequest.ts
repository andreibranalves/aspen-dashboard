const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureCreationRequestId<T extends { creationRequestId?: string }>(
  draft: T,
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
): T & { creationRequestId: string } {
  const current = typeof draft.creationRequestId === 'string'
    ? draft.creationRequestId.trim()
    : '';
  const creationRequestId = UUID_PATTERN.test(current) ? current : idFactory();
  return creationRequestId === draft.creationRequestId
    ? draft as T & { creationRequestId: string }
    : { ...draft, creationRequestId };
}

export async function dispatchAfterDraftPersistence<TDraft, TResult>(
  draft: TDraft,
  persist: (draft: TDraft) => boolean,
  dispatch: (draft: TDraft) => Promise<TResult>,
): Promise<TResult | null> {
  if (!persist(draft)) return null;
  return dispatch(draft);
}
