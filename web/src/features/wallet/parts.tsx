// Small wallet pieces shared by the page, the sidebar, the board and the drawer.
import { cn } from '../../components/ui/cn.ts';
import { signed } from '../../lib/wallet.ts';

/** Signed minutes in mono: green when positive, red when negative, grey at zero. */
export function Minutes({ value, className, suffix = true }: { value: number; className?: string; suffix?: boolean }) {
  return (
    <span className={cn('num whitespace-nowrap', value > 0 ? 'text-[var(--pill-positive-ink)]' : value < 0 ? 'text-[var(--pill-negative-ink)]' : 'text-faint', className)}>
      {signed(value)}
      {suffix ? <span className="ml-0.5 text-[0.85em] opacity-70">m</span> : null}
    </span>
  );
}

/** The wallet mark: an hourglass, drawn to sit beside 12-16px text. */
export function WalletGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className={className}>
      <path d="M4 2h8M4 14h8M5 2c0 3 6 3.5 6 6s-6 3-6 6M11 2c0 3-6 3.5-6 6s6 3 6 6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
