// React adapter for the automatic client identity resolution of the Split Card.
//
// All query, debounce, data-version and stale-response decisions live in the
// pure controller; this hook only wires it to local state, the page's draft
// mutators and the real transport.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Draft, DraftEdited } from '@/types/domain';
import { fetchClientMatches, fetchLinkedClient } from '@/lib/api/clientMatchApi';
import {
  AutomaticClientResolutionController,
  type ClientResolutionCandidate,
  type ClientResolutionView,
} from '@/features/quotations/automaticClientResolution';

export interface AutomaticClientResolutionInput {
  drafts: Draft[];
  updateDraftSystemField: (draftIdx: number, field: keyof DraftEdited, value: unknown) => void;
  updateDraftField: (draftIdx: number, field: keyof DraftEdited, value: unknown) => void;
  /** false while a save or issue is in flight: the identity is frozen. */
  enabled: boolean;
}

export interface AutomaticClientResolution {
  /** Resolution state of each draft, keyed by `draft.index`. */
  views: Record<number, ClientResolutionView>;
  selectClient: (draftIdx: number, candidate: ClientResolutionCandidate) => void;
  confirmNewClient: (draftIdx: number) => void;
  retry: (draftIdx: number) => void;
  /** "Trocar": drops the link and queries the identity again. */
  clearSelection: (draftIdx: number) => void;
}

export function useAutomaticClientResolution({
  drafts,
  updateDraftSystemField,
  updateDraftField,
  enabled,
}: AutomaticClientResolutionInput): AutomaticClientResolution {
  const [views, setViews] = useState<Record<number, ClientResolutionView>>({});
  const writersRef = useRef({ updateDraftField, updateDraftSystemField });
  useEffect(() => {
    writersRef.current = { updateDraftField, updateDraftSystemField };
  }, [updateDraftField, updateDraftSystemField]);

  const controllerRef = useRef<AutomaticClientResolutionController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new AutomaticClientResolutionController({
      fetchMatches: fetchClientMatches,
      fetchLinked: fetchLinkedClient,
      schedule: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
      },
      applyEdits: (draftIdx, edits) => {
        const writers = writersRef.current;
        for (const [field, value] of Object.entries(edits.edited)) {
          writers.updateDraftField(draftIdx, field as keyof DraftEdited, value);
        }
        for (const [field, value] of Object.entries(edits.system)) {
          writers.updateDraftSystemField(draftIdx, field as keyof DraftEdited, value);
        }
      },
      notify: () => setViews(controllerRef.current?.views() ?? {}),
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.sync(drafts, enabled);
  }, [controller, drafts, enabled]);

  useEffect(() => () => controller.dispose(), [controller]);

  const selectClient = useCallback((draftIdx: number, candidate: ClientResolutionCandidate) => {
    controllerRef.current?.selectClient(draftIdx, candidate);
  }, []);
  const confirmNewClient = useCallback((draftIdx: number) => {
    controllerRef.current?.confirmNewClient(draftIdx);
  }, []);
  const retry = useCallback((draftIdx: number) => {
    controllerRef.current?.retry(draftIdx);
  }, []);
  const clearSelection = useCallback((draftIdx: number) => {
    controllerRef.current?.clearSelection(draftIdx);
  }, []);

  return useMemo(
    () => ({ views, selectClient, confirmNewClient, retry, clearSelection }),
    [views, selectClient, confirmNewClient, retry, clearSelection]
  );
}
