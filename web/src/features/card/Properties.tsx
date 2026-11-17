// The card's key-value properties, each edited in place.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, X } from 'lucide-react';
import type { Card } from '../../../../src/core/types.ts';
import { PRIORITY_NAME, PRIORITY_SHORT, isPriority } from '../../lib/cards.ts';
import type { BoardIndex } from '../../lib/queries.ts';
import { dueInfo, fmtDateTime, fmtMinutes } from '../../lib/time.ts';
import { Pill, ProjectDot } from '../../components/ui/bits.tsx';
import { Combobox } from '../../components/ui/Combobox.tsx';
import { Select, Switch } from '../../components/ui/form.tsx';
import { cn } from '../../components/ui/cn.ts';
import { useParsePreview } from '../quickadd/parse.tsx';
import { parseDuration, useCardSave } from './useCardSave.ts';

function Row({ label, children, htmlFor, align = 'center' }: { label: string; children: ReactNode; htmlFor?: string; align?: 'center' | 'start' }) {
  return (
    <div className={cn('grid min-h-9 grid-cols-[112px_1fr] gap-3 py-0.5', align === 'center' ? 'items-center' : 'items-start')}>
      <label htmlFor={htmlFor} className={cn('text-xs text-faint', align === 'start' && 'pt-2')}>
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A text input that saves on Enter/blur when changed; Escape reverts. */
function InlineText({ id, value, onCommit, placeholder, ariaLabel, mono }: { id?: string; value: string; onCommit: (v: string) => void; placeholder?: string; ariaLabel?: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setV(value);
  }, [value, focused]);
  const commit = () => {
    if (v.trim() !== value.trim()) onCommit(v.trim());
  };
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setV(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className={cn(
        'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-text placeholder:text-faint hover:border-border focus:border-accent focus:bg-surface focus:outline-none',
        mono && 'num',
      )}
    />
  );
}

function DueField({ card, today }: { card: Card; today: string }) {
  const { save } = useCardSave(card.id);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const { parsed } = useParsePreview(editing ? `x ${text}` : '');
  const info = card.due_at !== null ? dueInfo(card.due_at, card.due_has_time, today) : null;
  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (t) save({ due: t });
    setText('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        id="f-due"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setText('');
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        placeholder={info ? info.full : 'next fri 5pm…'}
        aria-describedby="f-due-hint"
        className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-text placeholder:text-text hover:border-border focus:border-accent focus:bg-surface focus:outline-none focus:placeholder:text-faint"
      />
      <span id="f-due-hint" className="flex items-center gap-1.5">
        {editing && text.trim() ? (
          <span className="text-xs text-faint">{parsed?.due_label ? `→ ${parsed.due_label}` : 'no date found'}</span>
        ) : info ? (
          <>
            <Pill tone={info.tone === 'overdue' ? 'negative' : info.tone === 'today' ? 'warning' : 'neutral'}>{info.label}</Pill>
            <button type="button" aria-label="Clear due date" title="Clear due date" onClick={() => save({ due: null })} className="rounded p-1 text-faint hover:bg-raised hover:text-text">
              <X size={12} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}

function ProjectField({ card, index }: { card: Card; index: BoardIndex }) {
  const { save } = useCardSave(card.id);
  const [editing, setEditing] = useState(false);
  const project = card.project_id !== null ? index.projectById.get(card.project_id) : undefined;
  if (!editing)
    return (
      <div className="flex items-center gap-1">
        <button type="button" id="f-project" onClick={() => setEditing(true)} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-raised">
          {project ? (
            <>
              <ProjectDot color={project.color} />
              <span className="truncate">{project.name}</span>
            </>
          ) : (
            <span className="text-faint">No project</span>
          )}
        </button>
        {project ? (
          <button type="button" aria-label="Remove project" title="Remove project" onClick={() => save({ project_id: null })} className="rounded p-1 text-faint hover:bg-raised hover:text-text">
            <X size={12} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </div>
    );
  return (
    <Combobox
      label="Project"
      autoFocus
      placeholder="Find or create a project…"
      options={index.board.projects.filter((p) => !p.archived_at).map((p) => ({ value: String(p.id), label: p.name, lead: <ProjectDot color={p.color} /> }))}
      onPick={(v) => {
        save({ project_id: Number(v) });
        setEditing(false);
      }}
      onCreate={(name) => {
        save({ project: name });
        setEditing(false);
      }}
      onEscape={() => setEditing(false)}
    />
  );
}

function TagsField({ card, index }: { card: Card; index: BoardIndex }) {
  const { save } = useCardSave(card.id);
  const [adding, setAdding] = useState(false);
  const setTags = (tags: string[]) => save({ tags }, { optimistic: (c) => ({ ...c, tags }) });
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {card.tags.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded bg-[var(--pill-neutral-bg)] pl-2 pr-1 text-xs text-[var(--pill-neutral-ink)]">
          #{t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(card.tags.filter((x) => x !== t))} className="rounded p-0.5 text-faint hover:text-text">
            <X size={11} strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      {adding ? (
        <Combobox
          className="w-48"
          label="Add a tag"
          autoFocus
          placeholder="Tag name…"
          options={index.board.tags.filter((t) => !card.tags.includes(t.name)).map((t) => ({ value: t.name, label: t.name, hint: <span className="num">{t.count}</span> }))}
          onPick={(v) => setTags([...card.tags, v])}
          onCreate={(name) => setTags([...card.tags, name.replace(/^#/, '').trim()])}
          onEscape={() => setAdding(false)}
        />
      ) : (
        <button type="button" id="f-tags" onClick={() => setAdding(true)} className="h-6 rounded px-1.5 text-xs text-faint hover:bg-raised hover:text-text">
          {card.tags.length ? '+ Tag' : 'Add tags'}
        </button>
      )}
    </div>
  );
}

function BlockedField({ card }: { card: Card }) {
  const { save } = useCardSave(card.id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  if (card.blocked_reason)
    return (
      <div className="flex items-center gap-2 rounded-md bg-[var(--pill-negative-bg)] py-1 pl-2 pr-1">
        <Ban size={13} strokeWidth={1.75} aria-hidden className="flex-none text-[var(--pill-negative-ink)]" />
        <InlineText id="f-blocked" ariaLabel="Blocked reason" value={card.blocked_reason} onCommit={(v) => save({ blocked_reason: v || null })} />
        <button type="button" onClick={() => save({ blocked_reason: null })} className="h-7 flex-none rounded px-2 text-xs font-medium text-text hover:bg-[color-mix(in_oklab,var(--negative)_18%,transparent)]">
          Unblock
        </button>
      </div>
    );
  if (!open)
    return (
      <button
        type="button"
        id="f-blocked"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
        className="h-8 rounded-md px-2 text-sm text-faint hover:bg-raised hover:text-text"
      >
        Not blocked
      </button>
    );
  return (
    <input
      ref={ref}
      placeholder="What is it waiting on…"
      aria-label="Blocked reason"
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v) save({ blocked_reason: v });
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      className="h-8 w-full rounded-md border border-accent bg-surface px-2 text-sm focus:outline-none"
    />
  );
}

function TimeField({ card }: { card: Card }) {
  const { save } = useCardSave(card.id);
  return (
    <div className="flex items-center gap-2">
      <span className="num pl-2 text-sm text-text">{fmtMinutes(card.spent_min)}</span>
      <span className="text-xs text-faint">spent of</span>
      <div className="w-28">
        <InlineText
          id="f-estimate"
          ariaLabel="Estimate"
          mono
          value={card.estimate_min !== null ? fmtMinutes(card.estimate_min).replace(' ', '') : ''}
          placeholder="~45m…"
          onCommit={(v) => {
            const m = parseDuration(v);
            if (v && m === null) return;
            save({ estimate_min: m });
          }}
        />
      </div>
    </div>
  );
}

export function Properties({ card, index }: { card: Card; index: BoardIndex }) {
  const { save } = useCardSave(card.id);
  const { board, columns } = index;
  const plannedToday = card.planned_for === board.today;
  return (
    <div className="flex flex-col">
      <Row label="Column" htmlFor="f-column">
        <Select
          id="f-column"
          value={card.column_id}
          onChange={(e) => {
            const column_id = Number(e.target.value);
            save({ column_id }, { optimistic: (c) => ({ ...c, column_id }) });
          }}
          quiet
          className="max-w-56"
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Priority" htmlFor="f-priority">
        <Select
          id="f-priority"
          value={card.priority}
          onChange={(e) => {
            const p = Number(e.target.value);
            if (isPriority(p)) save({ priority: p }, { optimistic: (c) => ({ ...c, priority: p }) });
          }}
          quiet
          className="max-w-56"
        >
          {[0, 1, 2, 3].map((p) => (
            <option key={p} value={p}>
              {PRIORITY_SHORT[p]} · {PRIORITY_NAME[p]}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Due" htmlFor="f-due">
        <DueField card={card} today={board.today} />
      </Row>
      <Row label="Today" htmlFor="f-today">
        <div className="flex items-center gap-2.5 pl-2">
          <Switch
            id="f-today"
            label="Planned for today"
            checked={plannedToday}
            onChange={(v) => {
              const planned_for = v ? board.today : null;
              save({ planned_for }, { optimistic: (c) => ({ ...c, planned_for }) });
            }}
          />
          <span className="text-xs text-faint">{plannedToday ? 'On My Day' : card.planned_for ? `Planned for ${card.planned_for}` : 'Not planned'}</span>
        </div>
      </Row>
      <Row label="Time" htmlFor="f-estimate">
        <TimeField card={card} />
      </Row>
      <Row label="Project" htmlFor="f-project">
        <ProjectField card={card} index={index} />
      </Row>
      <Row label="Tags" htmlFor="f-tags" align="start">
        <TagsField card={card} index={index} />
      </Row>
      <Row label="Repeats" htmlFor="f-recurrence">
        <InlineText
          id="f-recurrence"
          value={card.recurrence?.label ?? ''}
          placeholder="every weekday…"
          onCommit={(v) => save({ recurrence: v || null })}
        />
      </Row>
      <Row label="Blocked" htmlFor="f-blocked">
        <BlockedField card={card} />
      </Row>
      {card.needs_review ? (
        <Row label="Check">
          <div className="flex items-center gap-2 pl-2">
            <Pill tone="warning">Ann guessed</Pill>
            <span className="text-xs text-muted">Glance at the date and project.</span>
            <button type="button" onClick={() => save({ needs_review: false })} className="ml-auto h-7 rounded px-2 text-xs font-medium text-text hover:bg-raised">
              Looks right
            </button>
          </div>
        </Row>
      ) : null}
      <p className="mt-2 text-[11px] text-faint">
        Created {fmtDateTime(card.created_at)}
        {card.completed_at ? ` · Done ${fmtDateTime(card.completed_at)}` : ''}
      </p>
    </div>
  );
}
