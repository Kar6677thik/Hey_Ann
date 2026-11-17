// An accessible combobox: type to filter, arrows to move, Enter to pick, with an optional "Create …" row.
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cn } from './cn.ts';

export interface ComboOption {
  value: string;
  label: string;
  hint?: ReactNode;
  lead?: ReactNode;
}

export function Combobox({
  options,
  onPick,
  onCreate,
  placeholder,
  label,
  className,
  autoFocus,
  onEscape,
}: {
  options: ComboOption[];
  onPick: (value: string) => void;
  onCreate?: (text: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
  onEscape?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(!!autoFocus);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = text.trim().toLowerCase();
  const filtered = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options).slice(0, 50), [options, q]);
  const exact = options.some((o) => o.label.toLowerCase() === q);
  const rows: ({ kind: 'option'; o: ComboOption } | { kind: 'create'; text: string })[] = [
    ...filtered.map((o) => ({ kind: 'option' as const, o })),
    ...(onCreate && q && !exact ? [{ kind: 'create' as const, text: text.trim() }] : []),
  ];
  const choose = (i: number) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'option') onPick(r.o.value);
    else onCreate?.(r.text);
    setText('');
    setActive(0);
  };

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open && rows.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && rows[active] ? `${id}-o${active}` : undefined}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(rows.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            onEscape?.();
          }
        }}
        className="h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text hover:border-control focus:border-accent focus:outline-none"
      />
      {open && rows.length ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="absolute left-0 right-0 top-9 z-20 max-h-60 overflow-y-auto rounded-lg border border-border-strong bg-overlay p-1 shadow-[var(--shadow-float)]">
          {rows.map((r, i) => (
            <li
              key={r.kind === 'option' ? r.o.value : '__create'}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm', i === active ? 'bg-active text-text' : 'text-muted')}
            >
              {r.kind === 'option' ? (
                <>
                  {r.o.lead}
                  <span className="min-w-0 flex-1 truncate text-text">{r.o.label}</span>
                  {r.o.hint ? <span className="text-xs text-faint">{r.o.hint}</span> : null}
                </>
              ) : (
                <>
                  <Plus size={13} strokeWidth={1.75} aria-hidden />
                  Create “<span className="truncate text-text">{r.text}</span>”
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
