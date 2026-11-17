// Form controls on the tokens.
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn.ts';

const control =
  'w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text transition-colors duration-150 hover:border-control focus:border-accent focus:outline-none focus-visible:outline-none disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input autoComplete="off" spellCheck={rest.type === 'text' || !rest.type ? undefined : false} className={cn(control, 'h-8', className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 resize-y py-2 leading-5', className)} {...rest} />;
}
export function Select({ className, children, quiet, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { quiet?: boolean }) {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <select className={cn(control, 'h-8 appearance-none bg-surface pr-7 text-text', quiet && 'border-transparent bg-transparent px-2 hover:border-border focus:bg-surface')} {...rest}>
        {children}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint" />
    </span>
  );
}

/** Label above the control, optional hint tied with aria-describedby. */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: (ids: { id: string; describedBy?: string }) => ReactNode; className?: string }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children({ id, describedBy: hintId })}
      {hint ? (
        <p id={hintId} className="text-xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] flex-none items-center rounded-full border transition-colors duration-150',
        checked ? 'border-transparent bg-primary' : 'border-border-strong bg-raised',
      )}
    >
      <span
        aria-hidden
        className={cn('block size-3 rounded-full transition-transform duration-150', checked ? 'translate-x-[14px] bg-primary-ink' : 'translate-x-[2px] bg-faint')}
      />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, className, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string; indeterminate?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'inline-flex size-4 flex-none items-center justify-center rounded-[4px] border transition-colors duration-150',
        checked || indeterminate ? 'border-accent bg-accent text-white' : 'border-control bg-transparent hover:border-muted',
        className,
      )}
    >
      {indeterminate ? (
        <span aria-hidden className="h-[1.5px] w-2 rounded bg-white" />
      ) : checked ? (
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

/** Underline tabs: the selection is the style's 1px accent line, as wide as the label. */
export function Tabs<T extends string | number>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex items-center gap-4 border-b border-border', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('sel-line -mb-px h-8 whitespace-nowrap text-sm transition-colors', o.value === value ? 'text-text' : 'text-muted hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact inline choice (e.g. 14 / 30 / 90 days), same underline move without the rule. */
export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center gap-0.5 rounded-md border border-border px-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-active={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('sel-line num h-6 rounded px-2 text-xs [--sel-inset:8px]', o.value === value ? 'text-text' : 'text-muted hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
