// Overlays: Modal (centred), Sheet (side drawer / bottom sheet) and Popover (anchored).
// Each traps focus while open, closes on Escape, and returns focus to where it came from.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn.ts';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void, focusContainer = false) {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? (focusContainer ? null : el?.querySelector<HTMLElement>(FOCUSABLE));
    (first ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escRef.current) {
        e.stopPropagation();
        escRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [active, ref, focusContainer]);
}

function Scrim({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      aria-hidden
      className="fixed inset-0 z-40 bg-[var(--scrim)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClick}
    />
  );
}

export function Modal({ open, onClose, label, children, className, top = false }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string; top?: boolean }) {
  return createPortal(
    <AnimatePresence>{open ? <ModalBody onClose={onClose} label={label} className={className} top={top}>{children}</ModalBody> : null}</AnimatePresence>,
    document.body,
  );
}
function ModalBody({ onClose, label, children, className, top }: { onClose: () => void; label: string; children: ReactNode; className?: string; top: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useFocusTrap(ref, true, onClose);
  return (
    <>
      <Scrim onClick={onClose} />
      <div className={cn('pointer-events-none fixed inset-0 z-50 flex justify-center px-4', top ? 'items-start pt-[12vh]' : 'items-center')}>
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={cn('pointer-events-auto w-full max-w-lg rounded-xl border border-border-strong bg-overlay shadow-[var(--shadow-float)] outline-none', className)}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </div>
    </>
  );
}

/** Right-hand drawer on desktop, full-height sheet on phones. */
export function Sheet({ open, onClose, label, children, width = 560 }: { open: boolean; onClose: () => void; label: string; children: ReactNode; width?: number }) {
  return createPortal(<AnimatePresence>{open ? <SheetBody onClose={onClose} label={label} width={width}>{children}</SheetBody> : null}</AnimatePresence>, document.body);
}
function SheetBody({ onClose, label, children, width }: { onClose: () => void; label: string; children: ReactNode; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useFocusTrap(ref, true, onClose, true);
  return (
    <>
      <Scrim onClick={onClose} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border-strong bg-ground shadow-[var(--shadow-float)] outline-none sm:inset-y-2 sm:right-2 sm:rounded-xl sm:border"
        style={{ maxWidth: width }}
        initial={reduce ? { opacity: 0 } : { x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { x: 24, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </>
  );
}

/** A popover anchored under (or above) its trigger. Render-prop free: pass the anchor ref. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  className,
  align = 'start',
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  label?: string;
}) {
  return createPortal(
    <AnimatePresence>{open ? <PopoverBody onClose={onClose} anchor={anchor} className={className} align={align} label={label}>{children}</PopoverBody> : null}</AnimatePresence>,
    document.body,
  );
}
function PopoverBody({ onClose, anchor, children, className, align, label }: { onClose: () => void; anchor: RefObject<HTMLElement | null>; children: ReactNode; className?: string; align: 'start' | 'end'; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  useFocusTrap(ref, true, onClose);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const up = a.bottom + 6 + h > window.innerHeight - 8 && a.top - 6 - h > 8;
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setPos({ top: up ? a.top - 6 - h : a.bottom + 6, left, up });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor, onClose]);
  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cn('fixed z-[60] min-w-48 rounded-lg border border-border-strong bg-overlay p-1 shadow-[var(--shadow-float)] outline-none', className)}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      initial={{ opacity: 0, y: pos?.up ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      {children}
    </motion.div>
  );
}

/** A row inside a Popover acting as a menu item. */
export function MenuItem({ children, onSelect, selected, danger, className }: { children: ReactNode; onSelect: () => void; selected?: boolean; danger?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected ?? false}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-active focus-visible:bg-active focus-visible:outline-none',
        danger ? 'text-[var(--pill-negative-ink)]' : 'text-text',
        className,
      )}
    >
      {children}
    </button>
  );
}
