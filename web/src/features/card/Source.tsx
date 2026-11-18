import { ArrowUpRight } from 'lucide-react';
import type { Card } from '../../../../src/core/types.ts';
import { APP_NAMES } from '../activity/diff.ts';

const safe = (url: string) => /^https?:\/\//i.test(url);

/** Where the card came from in another app ("From Socrates: Weak area: Integrals"), linking back when it can. */
export function Source({ card }: { card: Card }) {
  const s = card.source;
  if (!s) return null;
  const app = APP_NAMES[s.app] ?? s.app;
  const label = s.title || s.id;
  return (
    <p className="mt-3 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
      <span className="flex-none text-faint">From {app}</span>
      <span aria-hidden className="text-faint">·</span>
      {s.url && safe(s.url) ? (
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-accent-ink hover:underline">
          <span className="truncate">{label}</span>
          <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden className="flex-none" />
        </a>
      ) : (
        <span className="truncate text-text">{label}</span>
      )}
    </p>
  );
}
