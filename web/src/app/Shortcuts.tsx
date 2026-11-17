import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { undoLast } from '../lib/mutations.ts';
import { useStore } from '../lib/store.ts';
import { overlayStore, openPalette, prefsStore } from '../lib/ui-state.ts';
import { Kbd } from '../components/ui/bits.tsx';
import { Modal } from '../components/ui/overlay.tsx';
import { MOD } from './Sidebar.tsx';
import { NAV, SETTINGS_NAV } from './nav.ts';

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Anywhere',
    items: [
      [[MOD, 'K'], 'Search, add or run a command'],
      [['C'], 'New card (quick add)'],
      [[MOD, 'Z'], 'Undo the last change'],
      [['['], 'Collapse or expand the sidebar'],
      [['?'], 'This cheat sheet'],
    ],
  },
  { title: 'Go to', items: [...NAV, SETTINGS_NAV].map((n) => [n.keys.split(' '), n.label] as [string[], string]) },
  {
    title: 'Board',
    items: [
      [['/'], 'Search the board'],
      [['F'], 'Show or hide filters'],
      [['Enter'], 'Open the focused card'],
      [['Space'], 'Pick up a card, arrows to move it, Space to drop'],
      [['Esc'], 'Close a drawer or dialog'],
    ],
  },
];

export function Shortcuts() {
  const [, navigate] = useLocation();
  const open = useStore(overlayStore, (s) => s.shortcuts);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        overlayStore.set((s) => ({ ...s, palette: !s.palette, paletteMode: 'root' }));
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        void undoLast();
        return;
      }
      if (mod || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const k = e.key.toLowerCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = [...NAV, SETTINGS_NAV].find((n) => n.keys.split(' ')[1].toLowerCase() === k);
        if (target) {
          e.preventDefault();
          navigate(target.href);
        }
        return;
      }
      if (k === 'g') {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        overlayStore.set((s) => ({ ...s, shortcuts: true }));
      } else if (k === 'c' || k === 'n') {
        e.preventDefault();
        openPalette('add');
      } else if (e.key === '[') {
        prefsStore.set((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }));
      } else if (k === 'f') {
        overlayStore.set((s) => ({ ...s, filtersOpen: !s.filtersOpen }));
      } else if (e.key === '/') {
        const search = document.getElementById('board-search');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <Modal open={open} onClose={() => overlayStore.set((s) => ({ ...s, shortcuts: false }))} label="Keyboard shortcuts" className="max-w-2xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <Kbd>Esc</Kbd>
      </div>
      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className={g.title === 'Board' ? 'sm:col-span-2' : undefined}>
            <h3 className="text-xs font-medium text-faint">{g.title}</h3>
            <dl className={g.title === 'Board' ? 'mt-2 grid gap-x-8 sm:grid-cols-2' : 'mt-2'}>
              {g.items.map(([keys, label]) => (
                <div key={label} className="flex h-8 items-center justify-between gap-4 border-b border-rule last:border-0">
                  <dt className="text-sm text-text">{label}</dt>
                  <dd className="flex flex-none gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
