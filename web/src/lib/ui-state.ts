// Client-only UI state shared across screens.
import { createStore } from './store.ts';
import type { Priority } from '../../../src/core/types.ts';

export type DueFilter = 'overdue' | 'today' | 'week' | null;
export interface BoardFilters {
  q: string;
  project: number | null;
  tag: string | null;
  priority: Priority | null;
  due: DueFilter;
  blocked: boolean;
  ann: boolean;
}
export const EMPTY_FILTERS: BoardFilters = { q: '', project: null, tag: null, priority: null, due: null, blocked: false, ann: false };
export const filtersStore = createStore<BoardFilters>(EMPTY_FILTERS);
export const activeFilterCount = (f: BoardFilters) =>
  (f.q.trim() ? 1 : 0) + (f.project !== null ? 1 : 0) + (f.tag ? 1 : 0) + (f.priority !== null ? 1 : 0) + (f.due ? 1 : 0) + (f.blocked ? 1 : 0) + (f.ann ? 1 : 0);

export interface Prefs {
  sidebarCollapsed: boolean;
  groupBy: 'none' | 'project' | 'priority';
  showAllDone: boolean;
  theme: 'dark' | 'light' | 'system';
}
export const prefsStore = createStore<Prefs>({ sidebarCollapsed: false, groupBy: 'none', showAllDone: false, theme: 'dark' }, 'heyann:prefs');

export function applyTheme(theme: Prefs['theme']) {
  const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f6f6f7' : '#151517');
  try {
    localStorage.setItem('heyann:theme', theme);
  } catch {
    /* ignore */
  }
}

/** Cards Ann just touched: id -> time, for the brief glow. */
export const touchedStore = createStore<Record<number, number>>({});
export function markTouched(ids: number[]) {
  if (!ids.length) return;
  const at = Date.now();
  touchedStore.set((s) => {
    const next: Record<number, number> = {};
    for (const [k, v] of Object.entries(s)) if (at - v < 3000) next[Number(k)] = v;
    for (const id of ids) next[id] = at;
    return next;
  });
}

/** Overlay flags (palette, cheat sheet, filters panel). */
export const overlayStore = createStore<{ palette: boolean; paletteMode: 'root' | 'add' | 'focus'; shortcuts: boolean; filtersOpen: boolean; mobileMenu: boolean }>({
  palette: false,
  paletteMode: 'root',
  shortcuts: false,
  filtersOpen: false,
  mobileMenu: false,
});
export const openPalette = (mode: 'root' | 'add' | 'focus' = 'root') => overlayStore.set((s) => ({ ...s, palette: true, paletteMode: mode }));
