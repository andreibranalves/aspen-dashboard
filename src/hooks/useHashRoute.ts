import { useState, useEffect, useCallback, useRef } from 'react';

export type HashRouteGuard = (nextRoute: string) => boolean;
export type SetHashRouteGuard = (guard: HashRouteGuard | null) => void;

interface HashHistoryState {
  __aspenRoute?: unknown;
  __aspenPreviousRoute?: unknown;
  [key: string]: unknown;
}

const HISTORY_ROUTE_KEY = '__aspenRoute';
const HISTORY_PREVIOUS_ROUTE_KEY = '__aspenPreviousRoute';
const normalizeHash = (hash: string) => hash.replace(/^#/, '') || '/auto';

function currentHashRoute(): string {
  return normalizeHash(window.location.hash);
}

function currentHistoryState(): HashHistoryState {
  const state = window.history.state;
  return state && typeof state === 'object' && !Array.isArray(state)
    ? (state as HashHistoryState)
    : {};
}

function markCurrentHistoryRoute(route: string, previousRoute?: string): void {
  const state: HashHistoryState = {
    ...currentHistoryState(),
    [HISTORY_ROUTE_KEY]: route,
  };
  if (previousRoute !== undefined) state[HISTORY_PREVIOUS_ROUTE_KEY] = previousRoute;
  window.history.replaceState(state, '', `#${route}`);
}

export function getHashHistoryPreviousRoute(): string | null {
  const previousRoute = currentHistoryState()[HISTORY_PREVIOUS_ROUTE_KEY];
  return typeof previousRoute === 'string' ? previousRoute : null;
}

/**
 * Hook simples de roteamento por hash.
 * Uso: const [route, navigate, setNavigationGuard] = useHashRoute();
 */
export function useHashRoute(): [string, (hash: string) => void, SetHashRouteGuard] {
  const initialRoute = currentHashRoute();
  const [route, setRoute] = useState(initialRoute);
  const routeRef = useRef(initialRoute);
  const guardRef = useRef<HashRouteGuard | null>(null);
  const approvedRouteRef = useRef<string | null>(null);

  const setNavigationGuard = useCallback<SetHashRouteGuard>((guard) => {
    guardRef.current = guard;
  }, []);

  const canNavigate = useCallback(
    (nextRoute: string) =>
      nextRoute === routeRef.current || !guardRef.current || guardRef.current(nextRoute),
    []
  );

  useEffect(() => {
    if (currentHistoryState()[HISTORY_ROUTE_KEY] !== initialRoute) {
      markCurrentHistoryRoute(initialRoute);
    }

    const onRouteChange = () => {
      const nextRoute = currentHashRoute();
      const preApproved = approvedRouteRef.current === nextRoute;
      approvedRouteRef.current = null;
      if (!preApproved && !canNavigate(nextRoute)) {
        markCurrentHistoryRoute(routeRef.current);
        return;
      }
      routeRef.current = nextRoute;
      setRoute(nextRoute);
      if (currentHistoryState()[HISTORY_ROUTE_KEY] !== nextRoute) {
        markCurrentHistoryRoute(nextRoute);
      }
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
    };
  }, [canNavigate, initialRoute]);

  const navigate = useCallback(
    (hash: string) => {
      const currentRoute = currentHashRoute();
      routeRef.current = currentRoute;
      const nextRoute = normalizeHash(hash);
      if (nextRoute === currentRoute || !canNavigate(nextRoute)) return;
      approvedRouteRef.current = nextRoute;
      window.location.hash = nextRoute;
      markCurrentHistoryRoute(nextRoute, currentRoute);
    },
    [canNavigate]
  );

  return [route, navigate, setNavigationGuard];
}
