// Insights: is work flowing, and is Ann earning her keep?
import { type ReactNode } from 'react';
import { useUrlState } from '../../lib/url-state.ts';
import { Check } from 'lucide-react';
import type { Insights } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { clientLabel } from '../../lib/clients.ts';
import { useBoardIndex, useInsights, useTriage } from '../../lib/queries.ts';
import { fmtDay, fmtHours } from '../../lib/time.ts';
import { ErrorNote, Pill, Skeleton } from '../../components/ui/bits.tsx';
import { Segmented } from '../../components/ui/form.tsx';
import { cn } from '../../components/ui/cn.ts';
import { CardRow } from '../card/CardRow.tsx';
import { CfdChart } from './CfdChart.tsx';
import { ThroughputChart } from './ThroughputChart.tsx';

const RANGES = [14, 30, 90] as const;

function Card({ title, aside, children, className, id }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; id: string }) {
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col rounded-lg border border-border bg-surface', className)}>
      <header className="flex min-h-11 items-center justify-between gap-3 px-5 pt-3">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </header>
      <div className="flex flex-1 flex-col px-5 pt-3 pb-5">{children}</div>
    </section>
  );
}

export default function InsightsView() {
  const [days, setDays] = useUrlState<(typeof RANGES)[number]>('days', 30, RANGES);
  const q = useInsights(days);
  const { index } = useBoardIndex();
  const d = q.data;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-4 pt-4 pb-10 md:px-6 md:pt-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Insights</h1>
            {d ? <Finding d={d} /> : <Skeleton className="mt-1.5 h-4 w-80" />}
          </div>
          <Segmented label="Window" value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r, label: `${r}d` }))} />
        </header>

        {q.isError ? (
          <ErrorNote className="mt-5" message="Couldn’t load insights." onRetry={() => void q.refetch()} />
        ) : (
          <>
            <Kpis d={d} />
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card
                id="tp-h"
                title="Throughput"
                aside={
                  <ul className="flex gap-4 text-xs text-muted" aria-label="Legend">
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden className="size-2 rounded-sm bg-accent" />
                      Completed
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden className="size-2 rounded-sm bg-[var(--chart-created)]" />
                      Created
                    </li>
                  </ul>
                }
              >
                {d ? <ThroughputChart data={d.throughput} /> : <Skeleton className="h-[200px] w-full" />}
              </Card>
              <ReviewCard d={d} />
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card id="cfd-h" title="Cumulative flow" aside={<span className="text-xs text-faint">cards per column, end of day</span>}>
                {d && index ? <CfdChart data={d.cfd} columns={index.columns} /> : <Skeleton className="h-[240px] w-full" />}
              </Card>
              <AttentionCard />
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <WipAge d={d} />
              <AnnUsage d={d} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Finding({ d }: { d: Insights }) {
  const done = d.throughput.reduce((n, x) => n + x.completed, 0);
  const created = d.throughput.reduce((n, x) => n + x.created, 0);
  const net = done - created;
  return (
    <p className="mt-0.5 text-sm text-muted">
      Last <span className="num">{d.days}</span> days: <span className="num text-text">{done}</span> done, <span className="num text-text">{created}</span> created
      <span className="px-1.5 text-faint">·</span>
      {net >= 0 ? (
        <>
          backlog shrank by <span className="num text-text">{net}</span>
        </>
      ) : (
        <>
          backlog grew by <span className="num text-text">{-net}</span>
        </>
      )}
    </p>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="num mt-1 text-[22px] font-medium leading-7 tracking-[-0.02em] text-text">{value}</dd>
      {sub ? <dd className="mt-0.5 truncate text-xs text-faint">{sub}</dd> : null}
    </div>
  );
}

function Kpis({ d }: { d: Insights | undefined }) {
  if (!d)
    return (
      <div className="mt-5 grid grid-cols-2 divide-border rounded-lg border border-border bg-surface md:grid-cols-5 md:divide-x">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="px-5 py-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        ))}
      </div>
    );
  const done = d.throughput.reduce((n, x) => n + x.completed, 0);
  const acc = d.estimate_accuracy.ratio;
  return (
    <dl className="mt-5 grid grid-cols-2 rounded-lg border border-border bg-surface md:grid-cols-5 [&>div]:border-border md:[&>div+div]:border-l max-md:[&>div:nth-child(n+3)]:border-t max-md:[&>div:nth-child(even)]:border-l max-md:[&>div:last-child]:col-span-2">
      <Kpi label="Done" value={done} sub={`in ${d.days} days`} />
      <Kpi label="Cycle time, median" value={fmtHours(d.cycle_time.p50)} sub={d.cycle_time.samples ? `85% within ${fmtHours(d.cycle_time.p85)} · ${d.cycle_time.samples} cards` : 'no finished cards yet'} />
      <Kpi label="Lead time, median" value={fmtHours(d.lead_time.p50)} sub={d.lead_time.samples ? `85% within ${fmtHours(d.lead_time.p85)}` : 'no finished cards yet'} />
      <Kpi label="Streak" value={<>{d.streak_days}<span className="ml-1 text-sm text-faint">days</span></>} sub="days in a row with a card done" />
      <Kpi
        label="Estimates"
        value={acc === null ? '—' : `×${acc.toFixed(2)}`}
        sub={acc === null ? 'log time on estimated cards' : acc > 1.05 ? `${Math.round((acc - 1) * 100)}% over estimate, ${d.estimate_accuracy.samples} cards` : acc < 0.95 ? `${Math.round((1 - acc) * 100)}% under estimate, ${d.estimate_accuracy.samples} cards` : `on estimate, ${d.estimate_accuracy.samples} cards`}
      />
    </dl>
  );
}

/** The day-14 review from the plan: continue only if all four hold. */
function ReviewCard({ d }: { d: Insights | undefined }) {
  const r = d?.review;
  const rows = r
    ? [
        { label: 'Days used', value: r.days_used, target: 10, ok: r.days_used >= 10, fmt: `${r.days_used}`, goal: '≥ 10 of 14' },
        { label: 'Cards on the board', value: r.cards, target: 30, ok: r.cards >= 30, fmt: `${r.cards}`, goal: '≥ 30' },
        { label: 'Cards done', value: r.done, target: 15, ok: r.done >= 15, fmt: `${r.done}`, goal: '≥ 15' },
        {
          label: 'Ann batches undone',
          value: r.undo_rate === null ? 0 : r.undo_rate * 100,
          target: 10,
          ok: r.undo_rate !== null && r.undo_rate < 0.1,
          fmt: r.undo_rate === null ? '—' : `${(r.undo_rate * 100).toFixed(1)}%`,
          goal: '< 10%',
          inverse: true,
        },
      ]
    : [];
  const passed = rows.filter((x) => x.ok).length;
  const status = r?.pass === true ? 'Passed' : r?.pass === false ? 'Not passed' : 'In progress';
  return (
    <Card
      id="rev-h"
      title="14-day review"
      aside={r ? <Pill tone={r.pass === true ? 'positive' : r.pass === false ? 'negative' : 'neutral'}>{status}</Pill> : null}
    >
      {!r ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-faint">
            {r.started ? <>Started {fmtDay(r.started)}. </> : null}
            <span className="num">{passed}</span> of 4 criteria met. Keep Hey Ann if all four hold on day 14.
          </p>
          <ul className="mt-3 flex flex-col gap-3.5">
            {rows.map((row) => {
              const pct = row.inverse ? Math.min(1, row.value / 20) : Math.min(1, row.value / row.target);
              return (
                <li key={row.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-center gap-1.5 text-text">
                      {row.ok ? <Check size={13} strokeWidth={2.25} aria-label="met" className="text-[var(--pill-positive-ink)]" /> : <span aria-label="not yet" className="inline-block size-[13px] rounded-full border border-control" />}
                      {row.label}
                    </span>
                    <span className="text-xs text-faint">
                      <span className="num text-sm text-text">{row.fmt}</span> / {row.goal}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-1 rounded-full bg-raised" aria-hidden>
                    <div className={cn('h-full rounded-full', row.ok ? 'bg-positive' : row.inverse ? 'bg-negative' : 'bg-muted')} style={{ width: `${pct * 100}%` }} />
                    {row.inverse ? <span className="absolute top-[-3px] h-[10px] w-px bg-text" style={{ left: '50%' }} title="10% limit" /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

function AttentionCard() {
  const t = useTriage();
  const { index } = useBoardIndex();
  const items = t.data?.suggestions ?? [];
  return (
    <Card id="att-h" title="Needs attention" aside={t.data ? <span className="num text-xs text-faint">{items.length}</span> : null}>
      {t.isPending || !index ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : t.isError ? (
        <ErrorNote message="Couldn’t run triage." onRetry={() => void t.refetch()} />
      ) : items.length ? (
        <>
        <ul className="-mt-1">
          {items.slice(0, 6).map((s) => {
            const card = index.cardById.get(s.card_id);
            if (!card) return null;
            return <CardRow key={`${s.card_id}-${s.action}`} card={card} showDue={false} sub={<span className="truncate"><span className="text-muted">{s.action}</span> · {s.reason}</span>} />;
          })}
        </ul>
        <TriageCounts t={t.data} />
        </>
      ) : (
        <p className="text-sm text-faint">Nothing stale, blocked or slipping. Nice.</p>
      )}
    </Card>
  );
}

/** The triage buckets as one divided strip, pinned to the card's foot. */
function TriageCounts({ t }: { t: NonNullable<ReturnType<typeof useTriage>['data']> }) {
  const cells: [string, number][] = [
    ['Overdue', t.overdue.length],
    ['Blocked', t.blocked.length],
    ['Stale', t.stale.length],
    ['Urgent, unplanned', t.unplanned_urgent.length],
  ];
  return (
    <dl className="mt-auto grid grid-cols-4 border-t border-rule pt-3">
      {cells.map(([label, n]) => (
        <div key={label} className="min-w-0">
          <dt className="truncate text-[11px] text-faint">{label}</dt>
          <dd className={cn('num text-sm', n ? 'text-text' : 'text-faint')}>{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function WipAge({ d }: { d: Insights | undefined }) {
  const { index } = useBoardIndex();
  const openCard = useOpenCard();
  const stale = index?.board.settings.stale_after_days ?? 5;
  const rows = (d?.wip_age ?? []).toSorted((a, b) => b.days - a.days).slice(0, 6);
  const max = Math.max(stale, ...rows.map((r) => r.days));
  return (
    <Card id="wip-h" title="Work in progress, by age" aside={<span className="text-xs text-faint">stale after {stale} days</span>}>
      {!d ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length ? (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.card_id}>
              <button type="button" onClick={() => openCard(r.card_id)} className="group block w-full py-2 text-left">
                <span className="flex items-baseline gap-3 text-sm">
                  <span className="num w-8 flex-none text-[11px] text-faint">#{r.card_id}</span>
                  <span className="min-w-0 flex-1 truncate text-text group-hover:underline group-hover:decoration-faint">{r.title}</span>
                  <span className="hidden text-xs text-faint sm:inline">{index?.colById.get(r.column_id)?.name}</span>
                  <span className={cn('num w-12 text-right text-xs', r.days >= stale ? 'text-[var(--pill-warning-ink)]' : 'text-muted')}>{r.days}d</span>
                </span>
                <span className="ml-11 mt-1.5 block h-0.5 rounded-full bg-raised">
                  <span className={cn('block h-full rounded-full', r.days >= stale ? 'bg-warning' : 'bg-muted')} style={{ width: `${Math.max(2, (r.days / max) * 100)}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">Nothing in progress right now.</p>
      )}
      {d && rows.length ? (
        <p className="mt-auto border-t border-rule pt-3 text-xs text-faint">
          <span className="num text-text">{d.wip_age.length}</span> in progress or review · oldest <span className="num text-text">{rows[0].days}d</span> ·{' '}
          <span className="num text-text">{d.wip_age.filter((r) => r.days >= stale).length}</span> stale
        </p>
      ) : null}
    </Card>
  );
}

function AnnUsage({ d }: { d: Insights | undefined }) {
  const a = d?.ann;
  const clients = a ? Object.entries(a.by_client).sort((x, y) => y[1] - x[1]) : [];
  const max = Math.max(1, ...clients.map(([, n]) => n));
  return (
    <Card id="ann-h" title="Ann" aside={a ? <span className="text-xs text-faint">active <span className="num">{a.active_days}</span> of {d!.days} days</span> : null}>
      {!a ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-xs text-faint">Actions</dt>
              <dd className="num mt-1 text-[20px] font-medium leading-7 text-text">{a.batches}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Cards created</dt>
              <dd className="num mt-1 text-[20px] font-medium leading-7 text-text">{a.cards_created}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Undone</dt>
              <dd className="num mt-1 text-[20px] font-medium leading-7 text-text">
                {a.undone}
                <span className="ml-1.5 text-xs text-faint">{a.batches ? `${((a.undone / a.batches) * 100).toFixed(1)}%` : '—'}</span>
              </dd>
            </div>
          </dl>
          <h3 className="mt-5 text-xs text-faint">By client</h3>
          {clients.length ? (
            <ul className="mt-1">
              {clients.map(([client, n], i) => (
                <li key={client} className="py-1.5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-text">{clientLabel(client)}</span>
                    <span className="num text-xs text-muted">{n}</span>
                  </div>
                  <div className="mt-1 h-0.5 rounded-full bg-raised" aria-hidden>
                    <div className={cn('h-full rounded-full', i === 0 ? 'bg-accent' : 'bg-muted')} style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-faint">No Ann actions in this window.</p>
          )}
        </>
      )}
    </Card>
  );
}
