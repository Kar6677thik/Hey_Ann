// Cmd/Ctrl+K: quick add with the live parse preview, jump to a card, navigate, and run actions.
import { Command } from 'cmdk';
import { useMemo, useState } from 'react';
import { ArrowRight, CalendarCheck, Filter, Keyboard, Moon, Play, Plus, RotateCcw, Square, Star } from 'lucide-react';
import { useLocation } from 'wouter';
import { NAV, SETTINGS_NAV, useOpenCard } from '../../app/nav.ts';
import { api } from '../../lib/api.ts';
import { fuzzyScore } from '../../lib/cards.ts';
import { undoLast, useFocus, useWrite } from '../../lib/mutations.ts';
import { useBoardIndex } from '../../lib/queries.ts';
import { useStore } from '../../lib/store.ts';
import { filtersStore, markTouched, overlayStore, prefsStore, EMPTY_FILTERS } from '../../lib/ui-state.ts';
import { Kbd, ProjectDot } from '../../components/ui/bits.tsx';
import { Modal } from '../../components/ui/overlay.tsx';
import { ParseChips, splitLines, useParsePreview } from '../quickadd/parse.tsx';

const close = () => overlayStore.set((s) => ({ ...s, palette: false }));

export function CommandPalette() {
  const open = useStore(overlayStore, (s) => s.palette);
  const mode = useStore(overlayStore, (s) => s.paletteMode);
  return (
    <Modal open={open} onClose={close} label="Command palette" className="max-w-[640px] overflow-hidden" top>
      <Palette key={mode} initialMode={mode} />
    </Modal>
  );
}

// Empty groups (nothing matched) hide their heading too.
const groupClass = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint [&:not(:has([cmdk-item]))]:hidden';
const itemClass =
  'flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-muted data-[selected=true]:bg-active data-[selected=true]:text-text aria-disabled:opacity-50';

function Palette({ initialMode }: { initialMode: 'root' | 'add' | 'focus' }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState(initialMode);
  const [, navigate] = useLocation();
  const openCard = useOpenCard();
  const { index } = useBoardIndex();
  const focus = useFocus();
  const add = useWrite((t: string) => api.quickAdd(t));
  const { parsed, count } = useParsePreview(mode === 'add' || text.length > 0 ? text : '');
  const lines = splitLines(text);

  const run = (fn: () => void) => {
    close();
    fn();
  };

  const cards = useMemo(() => {
    if (!index) return [];
    const q = text.trim();
    const open = index.board.cards.filter((c) => mode !== 'focus' || !index.doneIds.has(c.column_id));
    if (!q) return open.toSorted((a, b) => b.updated_at - a.updated_at).slice(0, mode === 'focus' ? 12 : 6);
    const idq = q.replace(/^#/, '');
    return open
      .map((c) => ({ c, s: /^\d+$/.test(idq) && String(c.id) === idq ? 1000 : fuzzyScore(c.title, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.c);
  }, [index, text, mode]);

  const submitAdd = () => {
    const t = text.trim();
    if (!t) return;
    add.mutate(t, {
      onSuccess: (r) => {
        markTouched(r.cards.map((c) => c.id));
        close();
        if (r.cards.length === 1) openCard(r.cards[0].id);
      },
    });
  };

  const running = index?.board.cards.find((c) => c.focus_started_at !== null);
  const placeholder = mode === 'add' ? 'New card: “Renew passport by the 29th !p1 @Life”' : mode === 'focus' ? 'Start focus on which card?' : 'Search cards, add a card, or run a command…';

  return (
    <Command
      label="Command palette"
      shouldFilter={false}
      loop
      onKeyDown={(e) => {
        if (mode === 'add' && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitAdd();
        }
        if (e.key === 'Backspace' && !text && mode !== 'root') setMode('root');
      }}
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        {mode !== 'root' ? (
          <span className="mt-0.5 inline-flex h-5 flex-none items-center rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent-ink">{mode === 'add' ? 'New card' : 'Focus'}</span>
        ) : null}
        {mode === 'add' ? (
          <textarea
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder={placeholder}
            aria-label="New card text. One line per card. Enter adds, Shift+Enter for another line."
            className="min-h-6 flex-1 resize-none bg-transparent text-[15px] leading-6 text-text outline-none placeholder:text-faint"
          />
        ) : (
          <Command.Input
            data-autofocus
            value={text}
            onValueChange={setText}
            placeholder={placeholder}
            className="h-6 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-faint"
          />
        )}
      </div>
      {mode === 'add' ? (
        <div className="px-4 py-3">
          <ParseChips parsed={parsed} />
          <div className="mt-3 flex items-center justify-between text-xs text-faint">
            <span>{count > 1 ? <span className="num text-muted">Adds {count} cards</span> : 'Enter to add · Shift+Enter for another card · Backspace to go back'}</span>
            <button type="button" onClick={submitAdd} disabled={!text.trim() || add.isPending} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-3 font-medium text-primary-ink disabled:opacity-40">
              {count > 1 ? `Add ${count}` : 'Add card'} <Kbd className="h-4 border-0 bg-transparent px-0 text-primary-ink">↵</Kbd>
            </button>
          </div>
        </div>
      ) : (
        <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-faint">No matches. Press Enter on “Add as a card” to create it.</Command.Empty>
          {mode === 'root' && text.trim() ? (
            <Command.Group heading="Add" className={groupClass}>
              <Command.Item value="__add" onSelect={submitAdd} className={`${itemClass} h-auto min-h-10 items-start py-2.5`}>
                <Plus size={15} strokeWidth={1.75} aria-hidden className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{lines.length > 1 ? `Add ${lines.length} cards` : <>Add “<span className="text-text">{parsed?.title || text.trim()}</span>” as a card</>}</span>
                  <ParseChips parsed={parsed} className="mt-1.5" />
                </span>
              </Command.Item>
            </Command.Group>
          ) : null}
          {cards.length ? (
          <Command.Group heading={mode === 'focus' ? 'Start focus on' : 'Cards'} className={groupClass}>
            {cards.map((c) => {
              const p = c.project_id !== null ? index?.projectById.get(c.project_id) : undefined;
              return (
                <Command.Item
                  key={c.id}
                  value={`card-${c.id}`}
                  onSelect={() => run(() => (mode === 'focus' ? focus.mutate({ id: c.id, action: 'start' }) : openCard(c.id)))}
                  className={itemClass}
                >
                  <span className="num w-9 flex-none text-xs text-faint">#{c.id}</span>
                  <span className="min-w-0 flex-1 truncate text-text">{c.title}</span>
                  {p ? (
                    <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
                      <ProjectDot color={p.color} className="size-1.5" />
                      {p.name}
                    </span>
                  ) : null}
                  <span className="hidden w-20 truncate text-right text-xs text-faint sm:block">{index?.colById.get(c.column_id)?.name}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
          ) : null}
          {mode === 'root' ? (
            <>
              <Command.Group heading="Actions" className={groupClass}>
                {[
                  { k: 'new', label: 'New card', icon: Plus, keys: 'C', on: () => (setMode('add'), setText('')), stay: true },
                  running
                    ? { k: 'stop', label: `Stop focus on #${running.id}`, icon: Square, on: () => focus.mutate({ id: running.id, action: 'stop' }) }
                    : { k: 'focus', label: 'Start focus on…', icon: Play, on: () => (setMode('focus'), setText('')), stay: true },
                  { k: 'plan', label: 'Plan my day', icon: CalendarCheck, on: () => navigate('/today') },
                  { k: 'undo', label: 'Undo the last change', icon: RotateCcw, keys: 'Ctrl Z', on: () => void undoLast() },
                  {
                    k: 'filters',
                    label: 'Toggle filters',
                    icon: Filter,
                    keys: 'F',
                    on: () => {
                      navigate('/');
                      overlayStore.set((s) => ({ ...s, filtersOpen: !s.filtersOpen }));
                    },
                  },
                  { k: 'clear', label: 'Clear all filters', icon: Filter, on: () => filtersStore.set(EMPTY_FILTERS) },
                  { k: 'today', label: 'Show cards planned for today', icon: Star, on: () => navigate('/today') },
                  { k: 'theme', label: 'Switch light / dark theme', icon: Moon, on: () => prefsStore.set((p) => ({ ...p, theme: p.theme === 'light' ? 'dark' : 'light' })) },
                  { k: 'keys', label: 'Keyboard shortcuts', icon: Keyboard, keys: '?', on: () => overlayStore.set((s) => ({ ...s, shortcuts: true })) },
                ]
                  .filter((a) => !text.trim() || fuzzyScore(a.label, text) > 0)
                  .map((a) => (
                    <Command.Item key={a.k} value={`action-${a.k}`} onSelect={() => ('stay' in a && a.stay ? a.on() : run(a.on))} className={itemClass}>
                      <a.icon size={15} strokeWidth={1.75} aria-hidden />
                      <span className="flex-1">{a.label}</span>
                      {'keys' in a && a.keys ? <Kbd>{a.keys}</Kbd> : null}
                    </Command.Item>
                  ))}
              </Command.Group>
              <Command.Group heading="Go to" className={groupClass}>
                {[...NAV, SETTINGS_NAV, { href: '/settings/connect', label: 'Connect AI', icon: ArrowRight, keys: '' }]
                  .filter((n) => !text.trim() || fuzzyScore(n.label, text) > 0)
                  .map((n) => (
                    <Command.Item key={n.href} value={`nav-${n.href}`} onSelect={() => run(() => navigate(n.href))} className={itemClass}>
                      <n.icon size={15} strokeWidth={1.75} aria-hidden />
                      <span className="flex-1">{n.label}</span>
                      {n.keys ? <Kbd>{n.keys}</Kbd> : null}
                    </Command.Item>
                  ))}
              </Command.Group>
            </>
          ) : null}
        </Command.List>
      )}
      <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-faint">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> select
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> close
        </span>
        <span className="num ml-auto hidden truncate sm:inline">!p1 #tag @project ~30m *today</span>
      </div>
    </Command>
  );
}
