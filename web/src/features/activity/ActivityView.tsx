// Activity: every change in batches, newest first, filterable by who made it, each with Undo.
import { useMemo } from 'react';
import { useUrlState } from '../../lib/url-state.ts';
import type { Batch } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { useActivity, useBoardIndex, useInsights } from '../../lib/queries.ts';
import { clientLabel } from '../../lib/clients.ts';
import { MOD } from '../../app/Sidebar.tsx';
import { dayKey, fmtDay, useNow } from '../../lib/time.ts';
import { Button } from '../../components/ui/Button.tsx';
import { AnnMark, ErrorNote, Kbd, Skeleton } from '../../components/ui/bits.tsx';
import { Tabs } from '../../components/ui/form.tsx';
import { BatchItem } from './BatchItem.tsx';

type Actor = 'all' | 'ann' | 'web' | 'system';

export default function ActivityView() {
  const [actor, setActor] = useUrlState<Actor>('who', 'all', ['all', 'ann', 'web', 'system']);
  const q = useActivity(actor);
  const { index } = useBoardIndex();
  const openCard = useOpenCard();
  const now = useNow(30_000);
  const look = useMemo(() => ({ column: (id: number) => index?.colById.get(id)?.name, project: (id: number) => index?.projectById.get(id)?.name }), [index]);

  const groups = useMemo(() => {
    const items = q.data?.pages.flatMap((p) => p.items) ?? [];
    const out: { day: string; items: Batch[] }[] = [];
    for (const b of items) {
      const day = dayKey(b.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(b);
      else out.push({ day, items: [b] });
    }
    return out;
  }, [q.data]);
  const today = index?.board.today;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-[1240px] gap-x-10 px-4 pt-4 pb-10 md:px-6 md:pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Activity</h1>
        <p className="mt-0.5 text-sm text-muted">Every change to the board, from you, Ann and the system. Each one can be undone.</p>
        <Tabs
          className="mt-4"
          label="Who made the change"
          value={actor}
          onChange={setActor}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'ann', label: 'Ann' },
            { value: 'web', label: 'You' },
            { value: 'system', label: 'System' },
          ]}
        />
        {q.isPending ? (
          <ul className="mt-2">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="grid grid-cols-[22px_1fr] gap-3 py-3.5">
                <Skeleton className="size-[22px] rounded-full" />
                <div>
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="mt-2 h-4 w-3/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : q.isError ? (
          <ErrorNote className="mt-4" message="Couldn’t load activity." onRetry={() => void q.refetch()} />
        ) : groups.length ? (
          <>
            {groups.map((g) => (
              <section key={g.day} aria-label={fmtDay(g.day)} className="mt-5">
                <h2 className="sticky top-0 z-[1] bg-ground py-1.5 text-xs font-medium text-faint">{g.day === today ? 'Today' : fmtDay(g.day, true)}</h2>
                <ul className="divide-y divide-rule">
                  {g.items.map((b) => (
                    <BatchItem key={b.id} batch={b} look={look} now={now} onOpenCard={openCard} />
                  ))}
                </ul>
              </section>
            ))}
            <div className="mt-6 flex justify-center">
              {q.hasNextPage ? (
                <Button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                  {q.isFetchingNextPage ? 'Loading…' : 'Load older'}
                </Button>
              ) : (
                <p className="text-xs text-faint">That’s everything.</p>
              )}
            </div>
          </>
        ) : (
          <p className="mt-6 rounded-md border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
            {actor === 'ann' ? 'Ann hasn’t changed anything yet. Try “Hey Ann, add buy milk” in Claude or ChatGPT.' : 'No changes yet.'}
          </p>
        )}
        </div>
        <AnnRail />
      </div>
    </div>
  );
}

/** Right rail: Ann's last 30 days at a glance, and how undo behaves. */
function AnnRail() {
  const q = useInsights(30);
  const a = q.data?.ann;
  return (
    <aside aria-label="Ann at a glance" className="hidden lg:block">
      <div className="sticky top-5 mt-[86px] flex flex-col gap-4">
        <section aria-labelledby="rail-h" className="rounded-lg border border-border bg-surface p-4">
          <h2 id="rail-h" className="flex items-center gap-2 text-sm font-semibold">
            <AnnMark size={16} /> Ann, last 30 days
          </h2>
          {a ? (
            <dl className="mt-3 grid grid-cols-2 gap-y-3">
              <div>
                <dt className="text-xs text-faint">Actions</dt>
                <dd className="num mt-0.5 text-lg text-text">{a.batches}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Undone</dt>
                <dd className="num mt-0.5 text-lg text-text">
                  {a.undone}
                  <span className="ml-1 text-xs text-faint">{a.batches ? `${((a.undone / a.batches) * 100).toFixed(1)}%` : ''}</span>
                </dd>
              </div>
              {Object.entries(a.by_client)
                .sort((x, y) => y[1] - x[1])
                .map(([client, n]) => (
                  <div key={client}>
                    <dt className="text-xs text-faint">via {clientLabel(client)}</dt>
                    <dd className="num mt-0.5 text-lg text-text">{n}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <Skeleton className="mt-3 h-20 w-full" />
          )}
        </section>
        <section aria-labelledby="undo-h" className="rounded-lg border border-border p-4">
          <h2 id="undo-h" className="text-sm font-semibold">
            How undo works
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">
            Undo reverts a whole batch, everything one request changed. If a card changed again since, Hey Ann keeps the newer edit and tells you what it couldn’t revert. <Kbd>{MOD}</Kbd> <Kbd>Z</Kbd> undoes the latest.
          </p>
        </section>
      </div>
    </aside>
  );
}
