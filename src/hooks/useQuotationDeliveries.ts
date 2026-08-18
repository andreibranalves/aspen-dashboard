import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deliveryPollDelay,
  enqueueDelivery,
  fetchDelivery,
  resolveDelivery,
  type DeliveryIdentity,
  type DeliveryResolution,
  type DeliveryView,
} from '@/lib/quotationDeliveryApi';

export type DeliveriesByKey = Record<string, DeliveryView>;
export type DeliveryErrorsByKey = Record<string, string>;

export function deliveryIdentityKey(identity: DeliveryIdentity): string {
  return `${identity.revisionId}\u0000${identity.flowId}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function addKey(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys : [...keys, key];
}

function removeKey(keys: string[], key: string): string[] {
  return keys.filter((current) => current !== key);
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
  const inFlightEnqueuesRef = useRef(new Map<string, Promise<DeliveryView>>());
  const [deliveriesByKey, setDeliveriesByKey] = useState<DeliveriesByKey>({});
  const [pendingKeys, setPendingKeys] = useState<string[]>(() =>
    uniqueIdentities.map(deliveryIdentityKey)
  );
  const [errorByKey, setErrorByKey] = useState<DeliveryErrorsByKey>({});
  const [pollVersion, setPollVersion] = useState(0);

  const refreshOne = useCallback(async (identity: DeliveryIdentity): Promise<void> => {
    const key = deliveryIdentityKey(identity);
    if (inFlightRefreshesRef.current.has(key)) return;
    inFlightRefreshesRef.current.add(key);
    setPendingKeys((previous) => addKey(previous, key));
    try {
      const delivery = await fetchDelivery(identity);
      if (
        !mountedRef.current ||
        !identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)
      )
        return;
      if (delivery) {
        setDeliveriesByKey((previous) => ({ ...previous, [key]: delivery }));
      }
      setErrorByKey((previous) => {
        if (!(key in previous)) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      });
      setPendingKeys((previous) => removeKey(previous, key));
    } catch (error) {
      if (
        !mountedRef.current ||
        !identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)
      )
        return;
      setErrorByKey((previous) => ({
        ...previous,
        [key]: errorMessage(error, 'Não foi possível atualizar a entrega.'),
      }));
    } finally {
      inFlightRefreshesRef.current.delete(key);
      if (mountedRef.current) setPollVersion((version) => version + 1);
    }
  }, []);

  const refresh = useCallback(
    async (identity?: DeliveryIdentity): Promise<void> => {
      const targets = identity ? [identity] : identitiesRef.current;
      await Promise.all(targets.map((current) => refreshOne(current)));
    },
    [refreshOne]
  );

  const enqueue = useCallback(
    async (input: DeliveryIdentity & { quotationId: string }): Promise<DeliveryView> => {
      const key = deliveryIdentityKey(input);
      const existing = inFlightEnqueuesRef.current.get(key);
      if (existing) return existing;

      const request = (async () => {
        setPendingKeys((previous) => addKey(previous, key));
        setErrorByKey((previous) => {
          if (!(key in previous)) return previous;
          const next = { ...previous };
          delete next[key];
          return next;
        });
        try {
          const delivery = await enqueueDelivery(input);
          if (
            mountedRef.current &&
            identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)
          ) {
            setDeliveriesByKey((previous) => ({ ...previous, [key]: delivery }));
          }
          return delivery;
        } catch (error) {
          if (
            mountedRef.current &&
            identitiesRef.current.some((current) => deliveryIdentityKey(current) === key)
          ) {
            setErrorByKey((previous) => ({
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
    []
  );

  const resolve = useCallback(
    async (id: string, decision: DeliveryResolution, note: string): Promise<DeliveryView> => {
      const current = Object.values(deliveriesByKey).find((delivery) => delivery.id === id);
      const key = current ? deliveryIdentityKey(current) : id;
      setPendingKeys((previous) => addKey(previous, key));
      try {
        const delivery = await resolveDelivery(id, decision, note);
        if (mountedRef.current) {
          setDeliveriesByKey((previous) => ({
            ...previous,
            [deliveryIdentityKey(delivery)]: delivery,
          }));
          setErrorByKey((previous) => {
            if (!(key in previous)) return previous;
            const next = { ...previous };
            delete next[key];
            return next;
          });
        }
        return delivery;
      } catch (error) {
        if (mountedRef.current) {
          setErrorByKey((previous) => ({
            ...previous,
            [key]: errorMessage(error, 'Não foi possível resolver a entrega.'),
          }));
        }
        throw error;
      } finally {
        setPendingKeys((previous) => removeKey(previous, key));
      }
    },
    [deliveriesByKey]
  );

  useEffect(() => {
    mountedRef.current = true;
    const validKeys = new Set(uniqueIdentities.map(deliveryIdentityKey));
    setDeliveriesByKey((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => validKeys.has(key)))
    );
    setPendingKeys((previous) => {
      let next = previous.filter((key) => validKeys.has(key));
      for (const key of validKeys) next = addKey(next, key);
      return next;
    });
    setErrorByKey((previous) =>
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
    const delays = uniqueIdentities
      .map((identity) => deliveriesByKey[deliveryIdentityKey(identity)])
      .filter(
        (delivery): delivery is DeliveryView =>
          Boolean(delivery) && keys.has(deliveryIdentityKey(delivery))
      )
      .map((delivery) => deliveryPollDelay(delivery.state))
      .filter((delay): delay is number => delay !== null);
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
  }, [deliveriesByKey, errorByKey, pollVersion, refresh, uniqueIdentities]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return {
    deliveriesByKey,
    pendingKeys,
    errorByKey,
    enqueue,
    resolve,
    refresh,
  };
}
