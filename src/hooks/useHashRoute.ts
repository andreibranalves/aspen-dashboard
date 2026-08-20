import { useState, useEffect, useCallback, useRef } from 'react';

export type HashRouteGuard = (nextRoute: string) => boolean;
export type SetHashRouteGuard = (guard: HashRouteGuard | null) => void;

const normalizeHash = (hash: string) => hash.replace(/^#/, '') || '/auto';

/**
 * Hook simples de roteamento por hash.
 * Uso: const [route, navigate, setNavigationGuard] = useHashRoute();
 */
export function useHashRoute(): [string, (hash: string) => void, SetHashRouteGuard] {
  const initialRoute = normalizeHash(window.location.hash);
  const [route, setRoute] = useState(initialRoute);
  const routeRef = useRef(initialRoute);
  const guardRef = useRef<HashRouteGuard | null>(null);
  const approvedRouteRef = useRef<string | null>(null);

  const setNavigationGuard = useCallback<SetHashRouteGuard>((guard) => {
    guardRef.current = guard;
  }, []);

  const canNavigate = useCallback((nextRoute: string) => (
    nextRoute === routeRef.current || !guardRef.current || guardRef.current(nextRoute)
  ), []);

  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = normalizeHash(window.location.hash);
      const preApproved = approvedRouteRef.current === nextRoute;
      approvedRouteRef.current = null;
      if (!preApproved && !canNavigate(nextRoute)) {
        window.history.replaceState(null, '', `#${routeRef.current}`);
        return;
      }
      routeRef.current = nextRoute;
      setRoute(nextRoute);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [canNavigate]);

  const navigate = useCallback((hash: string) => {
    const nextRoute = normalizeHash(hash);
    if (nextRoute === routeRef.current || !canNavigate(nextRoute)) return;
    approvedRouteRef.current = nextRoute;
    window.location.hash = nextRoute;
  }, [canNavigate]);

  return [route, navigate, setNavigationGuard];
}
