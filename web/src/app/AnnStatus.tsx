import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { api } from '../lib/api.ts';
import { clientLabel } from '../lib/clients.ts';
import { liveStore, type LiveStatus } from '../lib/events.ts';
import { useStore } from '../lib/store.ts';
import { fmtAgo, useNow } from '../lib/time.ts';
import { AnnMark, Skeleton } from '../components/ui/bits.tsx';
import { cn } from '../components/ui/cn.ts';

const LIVE_LABEL: Record<LiveStatus, string> = { connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline' };

export function LiveDot({ withLabel = false, className }: { withLabel?: boolean; className?: string }) {
  const status = useStore(liveStore, (s) => s.status);
  const color = status === 'live' ? 'var(--positive)' : status === 'offline' ? 'var(--negative)' : 'var(--warning)';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-faint', className)} role="status" aria-label={`Live updates: ${LIVE_LABEL[status]}`} title={`Live updates: ${LIVE_LABEL[status]}`}>
      <span aria-hidden className={cn('size-1.5 rounded-full', status !== 'live' && 'live-pulse')} style={{ background: color }} />
      {withLabel ? LIVE_LABEL[status] : null}
    </span>
  );
}

/** The last thing Ann did, who asked, and from which client. */
export function AnnStatus() {
  const now = useNow(30_000);
  const live = useStore(liveStore, (s) => s.lastAnn);
  const q = useQuery({ queryKey: ['activity', 'ann-last'], queryFn: () => api.activity({ limit: 1, actor: 'ann' }) });
  const last = live && (!q.data?.items[0] || live.at >= q.data.items[0].at) ? live : q.data?.items[0];

  return (
    <Link href="/activity" className="group block rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text">
          <AnnMark size={14} client={last?.client} />
          Ann
        </span>
        <LiveDot withLabel />
      </div>
      {q.isPending && !live ? (
        <div className="mt-2 space-y-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : last ? (
        <>
          <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-text">{last.summary}</p>
          {last.utterance ? <p className="mt-1 line-clamp-2 text-xs leading-4 text-faint">“{last.utterance}”</p> : null}
          <p className="mt-1.5 text-[11px] leading-4 text-faint">
            via {clientLabel(last.client)} · <span className="num">{fmtAgo(last.at, now)}</span>
            {last.undone_at ? ' · undone' : ''}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-xs leading-4 text-faint">Nothing from Ann yet. Say “Hey Ann, …” in Claude or ChatGPT.</p>
      )}
    </Link>
  );
}
