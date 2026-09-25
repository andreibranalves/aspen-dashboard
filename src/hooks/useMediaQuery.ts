import { useEffect, useState } from 'react';

/** Abaixo de `md`: celular, onde listas e tabelas usam o layout empilhado. */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/** Acompanha uma media query; a primeira renderização já usa o valor atual. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches)
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}
