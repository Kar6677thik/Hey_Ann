import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn.ts';

/** Hover/focus tooltip in a portal (never clipped by a scrolling column). Plain box, no arrow. */
export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchor.current?.getBoundingClientRect();
    const t = tip.current;
    if (!a || !t) return;
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const above = a.top - h - 6 > 4;
    setPos({ top: above ? a.top - h - 6 : a.bottom + 6, left: Math.max(8, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - 8)) });
  }, [open]);
  return (
    <span
      ref={anchor}
      className={cn('inline-flex', className)}
      aria-describedby={open ? id : undefined}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open
        ? createPortal(
            <div
              ref={tip}
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-[70] max-w-72 rounded-md border border-border-strong bg-overlay px-2 py-1.5 text-xs text-text shadow-[var(--shadow-float)]"
              style={pos}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
