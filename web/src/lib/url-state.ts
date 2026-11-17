import { useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';

/** A small piece of screen state kept in the query string (deep-linkable, survives reload). */
export function useUrlState<T extends string | number>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const raw = new URLSearchParams(search).get(key);
  const parsed = (typeof fallback === 'number' ? Number(raw) : raw) as T;
  const value = raw !== null && allowed.includes(parsed) ? parsed : fallback;
  const set = useCallback(
    (v: T) => {
      const p = new URLSearchParams(search);
      if (v === fallback) p.delete(key);
      else p.set(key, String(v));
      const s = p.toString();
      navigate(s ? `${location}?${s}` : location, { replace: true });
    },
    [search, location, navigate, key, fallback],
  );
  return [value, set];
}
