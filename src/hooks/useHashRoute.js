import { useState, useEffect, useCallback } from 'react';

/**
 * Hook simples de roteamento por hash.
 * Uso: const [route] = useHashRoute();
 *
 * Navegação: window.location.hash = '#/auto'
 */
export function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/auto');

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1) || '/auto');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((hash) => {
    window.location.hash = hash;
  }, []);

  return [route, navigate];
}
