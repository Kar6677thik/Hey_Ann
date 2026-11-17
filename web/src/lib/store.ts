// A tiny external store (no dependency): module-level state, subscribed with useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<T>(initial: T, persistKey?: string): Store<T> {
  let state = initial;
  if (persistKey) {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) state = { ...initial, ...JSON.parse(raw) };
    } catch {
      /* private mode or bad JSON: keep defaults */
    }
  }
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      if (persistKey) {
        try {
          localStorage.setItem(persistKey, JSON.stringify(state));
        } catch {
          /* ignore */
        }
      }
      listeners.forEach((l) => l());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

/** Subscribe to a slice; re-renders only when the selected value changes (Object.is). */
export function useStore<T, S = T>(store: Store<T>, select: (s: T) => S = (s) => s as unknown as S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
