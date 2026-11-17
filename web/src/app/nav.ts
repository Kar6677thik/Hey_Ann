import { BarChart3, CalendarDays, History, KanbanSquare, ListChecks, Settings, Sun, type LucideIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  keys: string;
}
export const NAV: NavItem[] = [
  { href: '/', label: 'Board', icon: KanbanSquare, keys: 'G B' },
  { href: '/today', label: 'Today', icon: Sun, keys: 'G T' },
  { href: '/list', label: 'List', icon: ListChecks, keys: 'G L' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, keys: 'G C' },
  { href: '/insights', label: 'Insights', icon: BarChart3, keys: 'G I' },
  { href: '/activity', label: 'Activity', icon: History, keys: 'G A' },
];
export const SETTINGS_NAV: NavItem = { href: '/settings', label: 'Settings', icon: Settings, keys: 'G S' };

export function isActive(href: string, location: string) {
  if (href === '/') return location === '/' || location.startsWith('/card/');
  return location === href || location.startsWith(`${href}/`);
}

/** Open a card: on the board it's /card/:id (deep link); elsewhere ?card=id keeps the current screen. */
export function useOpenCard() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  return useCallback(
    (id: number) => {
      if (location === '/' || location.startsWith('/card/')) return navigate(`/card/${id}`);
      const p = new URLSearchParams(search);
      p.set('card', String(id));
      navigate(`${location}?${p.toString()}`);
    },
    [location, search, navigate],
  );
}

/** The card the drawer should show, from /card/:id or ?card=id. */
export function useOpenCardId(): { id: number | null; close: () => void } {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const m = /^\/card\/(\d+)/.exec(location);
  const fromSearch = new URLSearchParams(search).get('card');
  const id = m ? Number(m[1]) : fromSearch && /^\d+$/.test(fromSearch) ? Number(fromSearch) : null;
  const close = useCallback(() => {
    if (/^\/card\//.test(location)) navigate('/');
    else {
      const p = new URLSearchParams(search);
      p.delete('card');
      const s = p.toString();
      navigate(s ? `${location}?${s}` : location);
    }
  }, [location, search, navigate]);
  return { id, close };
}
