import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deliveryPollDelay,
  enqueueDelivery,
  fetchDelivery,
  fetchDeliveryForRevision,
  resolveDelivery,
  QuotationDeliveryApiError,
  type DeliveryIdentity,
  type DeliveryResolution,
  type DeliveryView,
} from '@/lib/api/quotationDeliveryApi';

export type DeliveriesByKey = Record<string, DeliveryView>;
export type DeliveryErrorsByKey = Record<string, string>;

export function deliveryIdentityKey(identity: DeliveryIdentity): string {
  return `${identity.revisionId}\u0000${identity.flowId}`;
}

// Bounded read-only discovery after an uncertain enqueue response. A lost or
// 5xx answer does not prove the POST failed, and the only safe way to learn the
// truth is to read the durable delivery — never to repeat the request.
const UNCERTAIN_ENQUEUE_READ_DELAYS_MS = [400, 1_200, 2_500];
// While an enqueue answer is uncertain, the key stays blocked and is re-read at
// this cadence (read-only) until an authoritative state resolves it.
const UNCERTAIN_ENQUEUE_POLL_MS = 5_000;

function isDefiniteClientRejection(error: unknown): boolean {
  return (
    error instanceof QuotationDeliveryApiError &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  );
}

function withoutKey(record: DeliveryErrorsByKey, key: string): DeliveryErrorsByKey {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

const SAFE_DELIVERY_ERRORS = new Set(['Resposta inválida da entrega WhatsApp.']);

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return SAFE_DELIVERY_ERRORS.has(message) ? message : fallback;
}

function addKey(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys : [...keys, key];
}

function removeKey(keys: string[], key: string): string[] {
  return keys.filter((current) => current !== key);
}

export function useQuotationRevisionDeliveries(revisionIds: string[]) {
  const revisionSignature = revisionIds.join('\u0001');
  const uniqueRevisionIds = useMemo(() => [...new Set(revisionIds)], [revisionSignature]);
  const [deliveriesByRevision, setDeliveriesByRevision] = useState<Record<string, DeliveryView>>({});
  const [resolvedRevisionIds, setResolvedRevisionIds] = useState<string[]>([]);
  const [errorsByRevision, setErrorsByRevision] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const validIds = new Set(uniqueRevisionIds);
    setDeliveriesByRevision((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => validIds.has(key)))
    );
    setResolvedRevisionIds((previous) => previous.filter((key) => validIds.has(key)));
    setErrorsByRevision((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => validIds.has(key)))
    );

    for (const revisionId of uniqueRevisionIds) {
      void fetchDeliveryForRevision(revisionId)
        .then((delivery) => {
          if (!active) return;
          setDeliveriesByRevision((previous) => {
            if (delivery) return { ...previous, [revisionId]: delivery };
            if (!(revisionId in previous)) return previous;
            const next = { ...previous };
            delete next[revisionId];
            return next;
          });
          setErrorsByRevision((previous) => {
            if (!(revisionId in previous)) return previous;
            const next = { ...previous };
            delete next[revisionId];
            return next;
          });
        })
        .catch((error) => {
          if (!active) return;
          setErrorsByRevision((previous) => ({
            ...previous,
            [revisionId]: errorMessage(error, 'Não foi possível atualizar a entrega.'),
          }));
        })
        .finally(() => {
          if (active) setResolvedRevisionIds((previous) => addKey(previous, revisionId));
        });
    }

    return () => {
      active = false;
    };
  }, [revisionSignature, uniqueRevisionIds]);

  const pendingRevisionIds = useMemo(() => {
    const resolved = new Set(resolvedRevisionIds);
    return uniqueRevisionIds.filter((revisionId) => !resolved.has(revisionId));
  }, [resolvedRevisionIds, uniqueRevisionIds]);

  return { deliveriesByRevision, pendingRevisionIds, errorsByRevision };
}

export function useQuotationDeliveries(identities: DeliveryIdentity[]) {
  const identitySignature = identities.map(deliveryIdentityKey).join('\u0001');
  const uniqueIdentities = useMemo(() => {
    const seen = new Set<string>();
    return identities.filter((identity) => {
      const key = deliveryIdentityKey(identity);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [identitySignature]);
  const identitiesRef = useRef(uniqueIdentities);
  identitiesRef.current = uniqueIdentities;
  const mountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRefreshesRef = useRef(new Set<string>());
  // Authoritative-mutation generations are tracked PER IDENTITY, not per hook:
  // a mutation for one draft must not discard a late authoritative result for a
  // different draft tracked by the same hook instance. Each key stores the
  // sequence number of its last authoritative mutation; a read started at
  // sequence S is stale for a key only when that key mutated above S.
  const mutationSeqRef = useRef(0);
  const mutatedAtRef = useRef<Record<string, number>>({});
  // Every identity key that has ever resolved to the same delivery id. A
  // revision has at most one delivery, so the selected flow can be an alias of
  // the actual flow; resolution must update and mark every alias together or the
  // selected Detail can keep showing a terminal `needs_review` and allow a
  // duplicate PATCH.
  const aliasesRef = useRef<Record<string, string[]>>({});
  // Used by every authoritative mutation (enqueue success, resolution success,
  // uncertain-enqueue discovery) so all three advance the same per-key clock.
  const markMutated = useCallback((...keys: string[]): void => {
    const seq = (mutationSeqRef.current += 1);
    const next = { ...mutatedAtRef.current };
    for (const key of keys) next[key] = seq;
    mutatedAtRef.current = next;
  }, []);
  const inFlightEnqueuesRef = useRef(new Map<string, Promise<DeliveryView>>());
  const [deliveriesByKey, setDeliveriesByKey] = useState<DeliveriesByKey>({});
  const [pendingKeys, setPendingKeys] = useState<string[]>(() =>
    uniqueIdentities.map(deliveryIdentityKey)
  );
  const [resolvedKeys, setResolvedKeys] = useState<string[]>([]);
  const [errorByKey, setErrorByKey] = useState<DeliveryErrorsByKey>({});
  const [enqueueErrorByKey, setEnqueueErrorByKey] = useState<DeliveryErrorsByKey>({});
  const [pollVersion, setPollVersion] = useState(0);

  const storeDelivery = useCallback((identity: DeliveryIdentity, delivery: DeliveryView): void => {
    const key = deliveryIdentityKey(identity);
    const actualKey = deliveryIdentityKey(delivery);
    // Fold in every key already aliased to this delivery id, so a resolution
    // updates the selected-flow alias and the actual-flow alias in one commit.
    const aliases = [...new Set([...(aliasesRef.current[delivery.id] || []), key, actualKey])];
    aliasesRef.current = { ...aliasesRef.current, [delivery.id]: aliases };
    setDeliveriesByKey((previous) => {
      const next = { ...previous };
      for (const alias of aliases) next[alias] = delivery;
      return next;
    });
    setErrorByKey((previous) => {
      let next = previous;
      for (const alias of aliases) next = withoutKey(next, alias);
      return next;
    });
    setEnqueueErrorByKey((previous) => {
      let next = previous;
      for (const alias of aliases) next = withoutKey(next, alias);
      return next;
    });
  }, []);

  const readAuthoritativeDelivery = useCallback(
    async (identity: DeliveryIdentity): Promise<DeliveryView | null> => {
      const direct = await fetchDelivery(identity);
      if (direct) return direct;
      // Absence under the selected flow does not prove the revision has no
      // delivery: it may belong to another flow. A failing revision-wide read
      // must therefore stay an error — never a false "no delivery" that would
      // let the operator send the same revision again.
      return await fetchDeliveryForRevision(identity.revisionId);
    },
    []
  );

  const refreshOne = useCallback(async (identity: DeliveryIdentity): Promise<void> => {
    const key = deliveryIdentityKey(identity);
    if (inFlightRefreshesRef.current.has(key)) return;
    inFlightRefreshesRef.current.add(key);
    setPendingKeys((previous) => addKey(previous, key));
    setResolvedKeys((previous) => removeKey(previous, key));
    const startedSeq = mutationSeqRef.current;
    // A read is stale when THIS key (or the identity it actually resolved to)
    // was authoritatively mutated while it was in flight. Mutations of any other
    // key tracked by this hook must never discard it.
    const isStale = (delivery: DeliveryView | null): boolean => {
      const markers = mutatedAtRef.current;
      if ((markers[key] || 0) > startedSeq) return true;
      if (!delivery) return false;
      const actualKey = deliveryIdentityKey(delivery);
      return actualKey !== key && (markers[actualKey] || 0) > startedSeq;
    };
    try {
      const delivery = await readAuthoritativeDelivery(identity);
      if (
        !mountedRef.current ||
        !identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)
      )
        return;
      // An authoritative mutation (enqueue/resolve) for this key that landed
      // while this read was in flight already stored newer state; a stale GET
      // must not undo it.
      if (delivery && !isStale(delivery)) storeDelivery(identity, delivery);
      setResolvedKeys((previous) => addKey(previous, key));
      setErrorByKey((previous) => withoutKey(previous, key));
      setPendingKeys((previous) => removeKey(previous, key));
    } catch (error) {
      if (
        !mountedRef.current ||
        !identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)
      )
        return;
      // A failed lookup still completes the poll cycle. Keeping the key
      // pending forever would leave Enviar WhatsApp disabled until reload.
      setResolvedKeys((previous) => addKey(previous, key));
      setPendingKeys((previous) => removeKey(previous, key));
      // A newer authoritative mutation for this key already stored newer state
      // and cleared errors; a stale rejection must not reintroduce a warning
      // beside it. An unrelated key's mutation is irrelevant here.
      if (!isStale(null)) {
        setErrorByKey((previous) => ({
          ...previous,
          [key]: errorMessage(error, 'Não foi possível atualizar a entrega.'),
        }));
      }
    } finally {
      inFlightRefreshesRef.current.delete(key);
      if (mountedRef.current) setPollVersion((version) => version + 1);
    }
  }, [readAuthoritativeDelivery, storeDelivery]);

  const refresh = useCallback(
    async (identity?: DeliveryIdentity): Promise<void> => {
      const targets = identity ? [identity] : identitiesRef.current;
      await Promise.all(targets.map((current) => refreshOne(current)));
    },
    [refreshOne]
  );

  const discoverUncertainEnqueue = useCallback(
    async (identity: DeliveryIdentity, key: string): Promise<DeliveryView | null> => {
      for (const delayMs of UNCERTAIN_ENQUEUE_READ_DELAYS_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        if (!mountedRef.current) return null;
        if (!identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)) return null;
        try {
          const delivery = await readAuthoritativeDelivery(identity);
          if (delivery) {
            markMutated(key, deliveryIdentityKey(delivery));
            storeDelivery(identity, delivery);
            setResolvedKeys((previous) => addKey(previous, key));
            return delivery;
          }
        } catch {
          // Read failures stay inside the bound; the POST is never repeated.
        }
      }
      return null;
    },
    [markMutated, readAuthoritativeDelivery, storeDelivery]
  );

  const enqueue = useCallback(
    async (input: DeliveryIdentity & { quotationId: string }): Promise<DeliveryView> => {
      const key = deliveryIdentityKey(input);
      const existing = inFlightEnqueuesRef.current.get(key);
      if (existing) return existing;

      const isStillSelected = () =>
        mountedRef.current &&
        identitiesRef.current.some((current) => deliveryIdentityKey(current) === key);

      const request = (async () => {
        setPendingKeys((previous) => addKey(previous, key));
        setErrorByKey((previous) => withoutKey(previous, key));
        setEnqueueErrorByKey((previous) => withoutKey(previous, key));
        try {
          const delivery = await enqueueDelivery(input);
          if (isStillSelected()) {
            markMutated(key, deliveryIdentityKey(delivery));
            storeDelivery(input, delivery);
          }
          return delivery;
        } catch (error) {
          // An uncertain answer is resolved by reading the durable delivery,
          // never by repeating the POST. Definite 4xx rejections never persisted.
          if (isStillSelected() && !isDefiniteClientRejection(error)) {
            const discovered = await discoverUncertainEnqueue(input, key);
            if (discovered) return discovered;
          }
          if (isStillSelected()) {
            setEnqueueErrorByKey((previous) => ({
              ...previous,
              [key]: errorMessage(error, 'Não foi possível iniciar o envio.'),
            }));
          }
          throw error;
        } finally {
          setPendingKeys((previous) => removeKey(previous, key));
          inFlightEnqueuesRef.current.delete(key);
        }
      })();
      inFlightEnqueuesRef.current.set(key, request);
      return request;
    },
    [discoverUncertainEnqueue, markMutated, storeDelivery]
  );

  const resolve = useCallback(
    async (id: string, decision: DeliveryResolution, note: string): Promise<DeliveryView> => {
      // The selected Detail may be an alias of another flow; every key pointing
      // at this delivery id must be marked pending and updated together.
      const aliases = Object.keys(deliveriesByKey).filter(
        (candidate) => deliveriesByKey[candidate]?.id === id,
      );
      const current = aliases.length > 0 ? deliveriesByKey[aliases[0]!] : undefined;
      const fallbackKey = current ? deliveryIdentityKey(current) : id;
      const pendingFor = [...new Set(aliases.length > 0 ? aliases : [fallbackKey])];
      setPendingKeys((previous) => {
        let next = previous;
        for (const key of pendingFor) next = addKey(next, key);
        return next;
      });
      try {
        const delivery = await resolveDelivery(id, decision, note);
        if (mountedRef.current) {
          const stored = current || delivery;
          const storedKey = deliveryIdentityKey(stored);
          const resultKey = deliveryIdentityKey(delivery);
          const known = aliasesRef.current[delivery.id] || [];
          const mutated = [...new Set([...pendingFor, ...known, storedKey, resultKey])];
          markMutated(...mutated);
          storeDelivery(stored, delivery);
          // Keep every alias resolved so a late read or a poll does not leave
          // the selected flow pending.
          setResolvedKeys((previous) => {
            let next = previous;
            for (const key of mutated) next = addKey(next, key);
            return next;
          });
        }
        return delivery;
      } catch (error) {
        if (mountedRef.current) {
          const message = errorMessage(error, 'Não foi possível resolver a entrega.');
          setErrorByKey((previous) => {
            let next = previous;
            for (const key of pendingFor) next = { ...next, [key]: message };
            return next;
          });
        }
        throw error;
      } finally {
        setPendingKeys((previous) => {
          let next = previous;
          for (const key of pendingFor) next = removeKey(next, key);
          return next;
        });
      }
    },
    [deliveriesByKey, markMutated, storeDelivery]
  );

  useEffect(() => {
    mountedRef.current = true;
    const validKeys = new Set(uniqueIdentities.map(deliveryIdentityKey));
    setDeliveriesByKey((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => validKeys.has(key)))
    );
    setResolvedKeys((previous) => previous.filter((key) => validKeys.has(key)));
    setPendingKeys((previous) => {
      let next = previous.filter((key) => validKeys.has(key));
      for (const key of validKeys) next = addKey(next, key);
      return next;
    });
    setErrorByKey((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => validKeys.has(key)))
    );
    setEnqueueErrorByKey((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => validKeys.has(key)))
    );
    void refresh();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [identitySignature, refresh, uniqueIdentities]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const keys = new Set(uniqueIdentities.map(deliveryIdentityKey));
    // A revision's delivery may live under another flow: keep polling it by its
    // real identity so an active state still progresses to terminal.
    const selectedKeys = uniqueIdentities.map(deliveryIdentityKey);
    const trackedKeys = new Set(selectedKeys);
    for (const key of selectedKeys) {
      const delivery = deliveriesByKey[key];
      if (delivery) trackedKeys.add(deliveryIdentityKey(delivery));
    }
    const delays = [...trackedKeys]
      .map((key) => deliveriesByKey[key])
      .filter((delivery): delivery is DeliveryView => Boolean(delivery))
      .map((delivery) => deliveryPollDelay(delivery.state))
      .filter((delay): delay is number => delay !== null);
    // An uncertain enqueue keeps its key blocked until an authoritative read
    // resolves it; keep reading (never POSTing) so a delayed row is discovered.
    for (const key of keys) {
      if (enqueueErrorByKey[key]) delays.push(UNCERTAIN_ENQUEUE_POLL_MS);
    }
    const earliest = delays.length > 0 ? Math.min(...delays) : null;
    if (earliest !== null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void refresh();
      }, earliest);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [deliveriesByKey, enqueueErrorByKey, errorByKey, pollVersion, refresh, uniqueIdentities]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const synchronouslyPendingKeys = useMemo(() => {
    const resolved = new Set(resolvedKeys);
    return uniqueIdentities
      .map(deliveryIdentityKey)
      .filter((key) => !resolved.has(key));
  }, [resolvedKeys, uniqueIdentities]);
  const pendingKeysForReturn = useMemo(() => {
    const keys = new Set(pendingKeys);
    synchronouslyPendingKeys.forEach((key) => keys.add(key));
    return [...keys];
  }, [pendingKeys, synchronouslyPendingKeys]);

  return {
    deliveriesByKey,
    pendingKeys: pendingKeysForReturn,
    errorByKey,
    enqueueErrorByKey,
    enqueue,
    resolve,
    refresh,
  };
}
