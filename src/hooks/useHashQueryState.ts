import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type HashQueryParser<T> = (raw: string | null, fallback: T) => T;
export type HashQuerySerializer<T> = (value: T, fallback: T) => string | null;

const normalizeHash = (hash: string) => hash.replace(/^#/, '') || '/auto';

function readHashQueryValue(key: string): string | null {
  const route = normalizeHash(window.location.hash);
  const separator = route.indexOf('?');
  if (separator === -1) return null;
  return new URLSearchParams(route.slice(separator + 1)).get(key);
}

function replaceHashQueryValue<T>(
  key: string,
  value: T,
  fallback: T,
  serialize: HashQuerySerializer<T>
): void {
  const route = normalizeHash(window.location.hash);
  const separator = route.indexOf('?');
  const path = separator === -1 ? route : route.slice(0, separator);
  const params = new URLSearchParams(separator === -1 ? '' : route.slice(separator + 1));
  const serialized = serialize(value, fallback);

  if (serialized === null || serialized === '') params.delete(key);
  else params.set(key, serialized);

  const query = params.toString();
  const nextRoute = query ? `${path}?${query}` : path;
  if (nextRoute === route) return;

  window.history.replaceState(window.history.state, '', `#${nextRoute}`);
}

function defaultHashQuerySerializer<T>(value: T, fallback: T): string | null {
  return Object.is(value, fallback) ? null : String(value);
}

export function parseHashString(raw: string | null, fallback: string): string {
  return raw ?? fallback;
}

export function parseHashPositiveInteger(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function parseHashAllowedInteger(options: readonly number[]): HashQueryParser<number> {
  return (raw, fallback) => {
    const value = parseHashPositiveInteger(raw, fallback);
    return options.includes(value) ? value : fallback;
  };
}

export function parseHashOption<T extends string>(options: readonly T[]): HashQueryParser<T> {
  return (raw, fallback) => (raw && options.includes(raw as T) ? (raw as T) : fallback);
}

/**
 * Persiste estado navegável na query da rota hash sem criar histórico a cada alteração.
 * Use para filtros, busca, ordenação, paginação e abas; não para formulários ou seleção.
 */
export function useHashQueryState<T>(
  key: string,
  fallback: T,
  parse: HashQueryParser<T>,
  serialize: HashQuerySerializer<T> = defaultHashQuerySerializer
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => parse(readHashQueryValue(key), fallback));

  useEffect(() => {
    replaceHashQueryValue(key, value, fallback, serialize);
  }, [fallback, key, serialize, value]);

  useEffect(() => {
    const syncFromHash = () => {
      setValue(parse(readHashQueryValue(key), fallback));
    };
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);
    return () => {
      window.removeEventListener('hashchange', syncFromHash);
      window.removeEventListener('popstate', syncFromHash);
    };
  }, [fallback, key, parse]);

  return [value, setValue];
}
