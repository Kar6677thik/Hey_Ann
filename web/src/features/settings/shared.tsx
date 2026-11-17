import { useState, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../components/ui/cn.ts';

/** One settings section: a label column beside its panel (stacks on phones). */
export function Section({ title, description, children, aside, id }: { title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-b border-rule py-7 first:pt-2 last:border-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 id={id} className="text-sm font-semibold text-text">
          {title}
        </h2>
        {description ? <div className="mt-1 text-[13px] leading-5 text-muted">{description}</div> : null}
        {aside ? <div className="mt-3">{aside}</div> : null}
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-surface p-4 md:p-5">{children}</div>
    </section>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return { copied, copy };
}

/** A read-only value joined to its Copy button; optionally masked. */
export function CopyField({ label, value, mask, multiline, id }: { label: string; value: string; mask?: boolean; multiline?: boolean; id: string }) {
  const { copied, copy } = useCopy();
  const [shown, setShown] = useState(!mask);
  const display = shown ? value : '•'.repeat(Math.min(32, value.length));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
      </div>
      <div className="flex items-stretch">
        {multiline ? (
          <pre id={id} tabIndex={0} aria-label={label} className="num min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded-l-md border border-border-strong bg-ground px-3 py-2 text-[12px] leading-5 text-text [overflow-wrap:anywhere]">
            {display}
          </pre>
        ) : (
          <input id={id} readOnly value={display} onFocus={(e) => shown && e.target.select()} className="num h-9 min-w-0 flex-1 rounded-l-md border border-border-strong bg-ground px-3 text-[12px] text-text focus:border-accent focus:outline-none" />
        )}
        {mask ? (
          <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? `Hide ${label}` : `Show ${label}`} className="flex w-9 flex-none items-center justify-center border-y border-border-strong text-muted hover:bg-raised hover:text-text">
            {shown ? <EyeOff size={14} strokeWidth={1.75} aria-hidden /> : <Eye size={14} strokeWidth={1.75} aria-hidden />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void copy(id, value)}
          aria-label={`Copy ${label}`}
          className={cn('flex flex-none items-center gap-1.5 rounded-r-md border border-l-0 border-border-strong px-3 text-xs text-muted hover:bg-raised hover:text-text', mask && 'border-l')}
        >
          {copied === id ? <Check size={13} strokeWidth={2} aria-hidden className="text-[var(--pill-positive-ink)]" /> : <Copy size={13} strokeWidth={1.75} aria-hidden />}
          <span aria-live="polite">{copied === id ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

export const SWATCHES = ['#7c8cff', '#4fd1c5', '#68d391', '#f6ad55', '#f687b3', '#63b3ed', '#e5566f', '#a0aec0'];

export function ColorPicker({ value, onChange, label, allowNone }: { value: string | null; onChange: (v: string | null) => void; label: string; allowNone?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {allowNone ? (
        <button type="button" role="radio" aria-checked={value === null} aria-label="No colour" onClick={() => onChange(null)} className={cn('size-5 rounded-full border border-dashed border-control', value === null && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]')} />
      ) : null}
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value?.toLowerCase() === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('size-5 rounded-full', value?.toLowerCase() === c && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]')}
          style={{ background: c }}
        />
      ))}
      <label className="relative size-5 cursor-pointer overflow-hidden rounded-full border border-control" title="Custom colour">
        <span className="sr-only">Custom colour</span>
        <input type="color" value={value ?? '#888888'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-8 -translate-x-1 -translate-y-1 cursor-pointer opacity-0" />
        <span aria-hidden className="block size-full" style={{ background: value && !SWATCHES.includes(value.toLowerCase()) ? value : 'conic-gradient(#e5566f,#f6ad55,#68d391,#63b3ed,#7c8cff,#e5566f)' }} />
      </label>
    </div>
  );
}
