// Wallet: screen minutes earned by focused, finished work; spent on walled apps; lost through lapses.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useOpenCard } from '../../app/nav.ts';
import { useBoardIndex } from '../../lib/queries.ts';
import { addDays, fmtAgo, fmtClock, fmtDay, fmtDateTime, useNow } from '../../lib/time.ts';
import {
  SOURCE_LABEL,
  friendlyReason,
  kindLabel,
  signed,
  useLedger,
  useUsage,
  useWallet,
  useWalletWrite,
  walletApi,
  type LedgerRow,
  type WalletSummary,
} from '../../lib/wallet.ts';
import { AnnMark, ErrorNote, Pill, Skeleton } from '../../components/ui/bits.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Checkbox, Input, Select } from '../../components/ui/form.tsx';
import { Modal } from '../../components/ui/overlay.tsx';
import { cn } from '../../components/ui/cn.ts';
import { Minutes } from './parts.tsx';
import { UsageChart } from './UsageChart.tsx';

export default function WalletView() {
  const q = useWallet();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-4 pt-4 pb-10 md:px-6 md:pt-5">
        {q.isPending ? (
          <>
            <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Wallet</h1>
            <Skeleton className="mt-5 h-48 w-full rounded-lg" />
          </>
        ) : q.isError ? (
          <>
            <h1 className="text-[20px] font-semibold leading-7">Wallet</h1>
            <ErrorNote className="mt-5" message="Couldn’t load the wallet." onRetry={() => void q.refetch()} />
          </>
        ) : q.data.phase === 'off' ? (
          <WalletOff />
        ) : (
          <WalletRunning w={q.data} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- off

const HOW = [
  'Screen minutes are a currency. Walled apps (Instagram, YouTube…) cost one minute per minute.',
  'You earn them only by focused work on cards you finish: about 15 minutes for every hour of focus, up to 60 a day.',
  'Each morning you get a small allowance. Missing your plan or letting urgent cards slide costs minutes.',
  'Run out and the phone app walls off those apps. Calls, messages, maps and the camera are never walled.',
  'A lapse is not the end: debt is capped at −60, and focus pays it back 1.5× faster. That’s the way back.',
  'Rules can be tightened any time; loosening waits until the next Monday.',
];

function WalletOff() {
  const [baseline, setBaseline] = useState(true);
  const start = useWalletWrite((b: boolean) => walletApi.start(b), (_r, b) => (b ? 'Baseline week started. The phone just measures for now.' : 'Wallet started.'));
  return (
    <>
      <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Wallet</h1>
      <p className="mt-0.5 text-sm text-muted">Earn your screen time with finished work.</p>
      <section aria-labelledby="how-h" className="mt-5 grid gap-8 rounded-lg border border-border bg-surface p-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:p-6">
        <div>
          <h2 id="how-h" className="text-sm font-semibold">
            How it works
          </h2>
          <ul className="mt-3 flex flex-col gap-2.5">
            {HOW.map((line) => (
              <li key={line} className="flex gap-2.5 text-[13px] leading-5 text-text">
                <span aria-hidden className="mt-2 size-1 flex-none rounded-full bg-faint" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-6 md:border-l md:border-rule md:pl-8">
          <div>
            <h2 className="text-sm font-semibold">Start the wallet</h2>
            <label className="mt-3 flex cursor-pointer select-none items-start gap-2.5 text-sm text-text">
              <Checkbox checked={baseline} onChange={setBaseline} label="Measure my phone use for a week first" className="mt-0.5" />
              <span>
                Measure my phone use for a week first <span className="text-faint">(recommended)</span>
                <span className="mt-0.5 block text-xs text-faint">Nothing is walled or charged for 7 days. You get a real “before” number to compare against.</span>
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => start.mutate(baseline)} disabled={start.isPending}>
              {start.isPending ? 'Starting…' : baseline ? 'Start the baseline week' : 'Start now'}
            </Button>
            <Link href="/settings/wallet" className="text-xs text-muted underline-offset-2 hover:text-text hover:underline">
              Review the rules first
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- running

function WalletRunning({ w }: { w: WalletSummary }) {
  const [dialog, setDialog] = useState<'pause' | 'fine' | null>(null);
  const { index } = useBoardIndex();
  const today = index?.board.today ?? w.today.day;
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Wallet</h1>
          <p className="mt-0.5 text-sm text-muted">
            {fmtDay(w.today.day)}
            <span className="px-1.5 text-faint">·</span>
            {w.phase === 'baseline' ? 'baseline week, measuring only' : w.phone.enforce ? 'the wall is up' : 'running'}
            {w.pending_credit.length + w.vetoable.length ? (
              <>
                <span className="px-1.5 text-faint">·</span>
                <span className="text-text">
                  <span className="num">{w.pending_credit.length + w.vetoable.length}</span> waiting on you
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setDialog('pause')} disabled={w.today.paused}>
            Pause a day
          </Button>
          <Button size="sm" onClick={() => setDialog('fine')}>
            Fine myself
          </Button>
          <Link href="/settings/wallet" className="inline-flex h-7 items-center rounded-md px-2.5 text-xs text-muted hover:bg-raised hover:text-text">
            Rules & phones
          </Link>
        </div>
      </header>

      {/* Phones: one column ordered balance, needs-you, ledger, phone (actions before the long list). */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          <div className="order-1 min-w-0">
            <BalancePanel w={w} />
          </div>
          <div className="order-3 min-w-0">
            <LedgerPanel />
          </div>
        </div>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          <div className="order-2 min-w-0">
            <NeedsYou w={w} />
          </div>
          <section aria-labelledby="phone-h" className="order-4 min-w-0 rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 id="phone-h" className="text-sm font-semibold">
                Phone use
              </h2>
              <span className="text-xs text-faint">last 14 days</span>
            </div>
            <PhoneUsage today={today} baselineUntil={w.baseline_until} />
            {w.phone.session ? (
              <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
                Session running until <span className="num text-text">{fmtClock(w.phone.session.ends_at)}</span>
                {w.phone.session.kind === 'emergency' ? ' (emergency unlock)' : ''}
              </p>
            ) : null}
          </section>
        </div>
      </div>
      <PauseDialog open={dialog === 'pause'} onClose={() => setDialog(null)} allowance={w.rules.pause_allowance} />
      <FineDialog open={dialog === 'fine'} onClose={() => setDialog(null)} />
    </>
  );
}

function PhoneUsage({ today, baselineUntil }: { today: string; baselineUntil: string | null }) {
  const q = useUsage();
  if (q.isPending) return <Skeleton className="mt-3 h-40 w-full" />;
  if (q.isError) return <ErrorNote className="mt-3" message="Couldn’t load phone use." onRetry={() => void q.refetch()} />;
  if (!q.data.items.length)
    return (
      <p className="mt-3 text-sm text-faint">
        No phone data yet.{' '}
        <Link href="/settings/wallet" className="text-accent-ink underline-offset-2 hover:underline">
          Pair your phone
        </Link>{' '}
        and it reports daily use here.
      </p>
    );
  return (
    <div className="mt-3">
      <UsageChart items={q.data.items} today={today} baselineUntil={baselineUntil} />
    </div>
  );
}

function Cell({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 py-3 sm:px-4 sm:first:pl-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{children}</dd>
      {sub ? <dd className="text-[11px] text-faint">{sub}</dd> : null}
    </div>
  );
}

/** The baseline banner, with a way to bring the wall forward to tomorrow (two clicks: it can't be pushed back). */
function BaselineBanner({ until, today }: { until: string; today: string }) {
  const tomorrow = addDays(today, 1);
  const [armed, setArmed] = useState(false);
  const end = useWalletWrite(() => walletApi.endBaseline(tomorrow), () => `The wall goes up ${fmtDay(tomorrow)}`);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-text">
      <p className="min-w-0 flex-1">
        Baseline week until <span className="font-medium">{fmtDay(until)}</span>. Your phone only measures; nothing is walled or charged yet.
      </p>
      {until > tomorrow ? (
        armed ? (
          <span className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => end.mutate(undefined)} disabled={end.isPending}>
              Yes, wall up {fmtDay(tomorrow)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
              Not yet
            </Button>
          </span>
        ) : (
          <Button size="sm" onClick={() => setArmed(true)}>
            Start the wall tomorrow
          </Button>
        )
      ) : null}
    </div>
  );
}

function BalancePanel({ w }: { w: WalletSummary }) {
  const debt = w.balance < 0;
  const lo = w.debt_floor;
  const hi = w.balance_cap;
  const pos = (v: number) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
  const zero = pos(0);
  const t = w.today;
  const pause = w.pause_days.find((p) => p.day === t.day);
  return (
    <section aria-labelledby="bal-h" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="bal-h" className="text-sm font-semibold">
          Balance
        </h2>
        {w.phase === 'baseline' ? <Pill tone="accent">Baseline week</Pill> : t.paused ? <Pill tone="warning">Pause day</Pill> : null}
      </div>
      <p className={cn('num mt-2 text-[44px] font-medium leading-none tracking-[-0.03em]', debt ? 'text-[var(--pill-negative-ink)]' : 'text-text')} aria-label={`Balance ${w.balance} minutes`}>
        {debt ? `−${Math.abs(w.balance)}` : w.balance}
        <span className="ml-1.5 text-base font-normal tracking-normal text-faint">min</span>
      </p>
      <p className="mt-2 text-sm text-muted">
        {debt ? (
          <>
            In debt by <span className="num text-text">{Math.abs(w.balance)}</span> min. The way back: earned minutes repay it {w.rules.repay_mult}× faster. The floor is{' '}
            <span className="num">{signed(w.debt_floor)}</span>, so it can’t spiral.
          </>
        ) : w.balance === 0 ? (
          'Nothing to spend yet. Finish a focused card to earn some.'
        ) : (
          <>
            Earned minutes expire after {w.rules.expiry_days} days. The balance tops out at <span className="num">{w.balance_cap}</span>.
          </>
        )}
      </p>

      <div className="relative mt-4 h-2 rounded-full bg-raised" role="meter" aria-label="Balance between the debt floor and the cap" aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={w.balance}>
        <div
          className={cn('absolute inset-y-0 rounded-full', debt ? 'bg-negative' : 'bg-accent')}
          style={debt ? { left: `${pos(w.balance)}%`, right: `${100 - zero}%` } : { left: `${zero}%`, width: `${pos(w.balance) - zero}%` }}
        />
        <span aria-hidden className="absolute top-[-3px] h-[14px] w-px bg-text" style={{ left: `${zero}%` }} />
      </div>
      <div className="num relative mt-1.5 h-4 text-[11px] text-faint" aria-hidden>
        <span className="absolute left-0">{signed(lo)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${zero}%` }}>
          0
        </span>
        <span className="absolute right-0">{hi}</span>
      </div>

      {w.phase === 'baseline' && w.baseline_until ? <BaselineBanner until={w.baseline_until} today={t.day} /> : null}
      {pause ? (
        <p className="mt-4 rounded-md bg-[var(--pill-warning-bg)] px-3 py-2 text-[13px] text-[var(--pill-warning-ink)]">
          Pause day: {pause.reason}. No earning and no penalties today; a flat <span className="num">+{w.rules.pause_allowance}</span> instead.
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 border-t border-rule pt-1 sm:grid-cols-4 sm:divide-x sm:divide-rule">
        <Cell label="Earned today" sub="toward the daily cap">
          <Minutes value={t.earned} suffix={false} />
          <span className="num text-xs text-faint"> / {t.earn_cap}</span>
        </Cell>
        <Cell label="Allowance">
          <Minutes value={t.allowance} suffix={false} />
        </Cell>
        <Cell label="Lapses" sub={t.ann ? <>by Ann <span className="num">{signed(t.ann)}</span></> : undefined}>
          <Minutes value={t.penalties} suffix={false} />
        </Cell>
        <Cell label="Spent" sub={t.refunded ? <>refunded <span className="num">+{t.refunded}</span></> : undefined}>
          <span className={cn('num', t.spent ? 'text-text' : 'text-faint')}>{t.spent}</span>
        </Cell>
      </dl>
    </section>
  );
}

function NeedsYou({ w }: { w: WalletSummary }) {
  const openCard = useOpenCard();
  const now = useNow(60_000);
  const confirm = useWalletWrite(
    (v: { id: number; accept: boolean }) => walletApi.confirm(v.id, v.accept),
    (_r, v) => (v.accept ? `Confirmed #${v.id}. Credit is in.` : `Declined credit for #${v.id}.`),
  );
  const veto = useWalletWrite((id: number) => walletApi.veto(id), () => 'Vetoed. Ann’s adjustment is reversed.');
  const empty = !w.pending_credit.length && !w.vetoable.length;
  return (
    <section aria-labelledby="needs-h" className="rounded-lg border border-border bg-surface">
      <header className="flex min-h-11 items-center justify-between border-b border-rule px-5">
        <h2 id="needs-h" className="text-sm font-semibold">
          Needs you
        </h2>
        {!empty ? <span className="num text-xs text-faint">{w.pending_credit.length + w.vetoable.length}</span> : null}
      </header>
      {empty ? (
        <p className="px-5 py-4 text-sm text-faint">Nothing waiting. Cards Ann finishes, and her larger grants or fines, land here for you to check.</p>
      ) : (
        <ul className="px-5 py-1">
          {w.pending_credit.map(({ card, expected }) => {
            const total = expected.base + expected.bonus;
            return (
              <li key={`c-${card.id}`} className="border-b border-rule py-3 last:border-0">
                <button type="button" onClick={() => openCard(card.id)} className="block w-full text-left">
                  <span className="line-clamp-2 text-sm text-text hover:underline hover:decoration-faint">{card.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
                    <AnnMark size={12} client={card.created_client} />
                    Ann marked <span className="num">#{card.id}</span> done{card.completed_at ? ` ${fmtAgo(card.completed_at, now)}` : ''}
                  </span>
                </button>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted">
                    {total > 0 ? (
                      <>
                        Worth <Minutes value={total} /> <span className="text-faint">({expected.focus} focus min)</span>
                      </>
                    ) : (
                      <span className="text-faint">No focus logged, so no credit</span>
                    )}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => confirm.mutate({ id: card.id, accept: false })} disabled={confirm.isPending}>
                      Decline
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => confirm.mutate({ id: card.id, accept: true })} disabled={confirm.isPending}>
                      Confirm
                    </Button>
                  </span>
                </div>
              </li>
            );
          })}
          {w.vetoable.map((row) => {
            const until = row.at + w.rules.veto_hours * 3600_000;
            return (
              <li key={`v-${row.id}`} className="border-b border-rule py-3 last:border-0">
                <div className="flex items-start gap-3">
                  <AnnMark size={16} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text">
                      Ann {row.amount > 0 ? 'granted' : 'fined'} <Minutes value={row.amount} />
                    </p>
                    <p className="mt-0.5 text-[13px] leading-5 text-muted">“{row.reason}”</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {fmtAgo(row.at, now)} · veto until {fmtDateTime(until)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => veto.mutate(row.id)} disabled={veto.isPending}>
                    Veto
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LedgerPanel() {
  const q = useLedger();
  const now = useNow(60_000);
  const openCard = useOpenCard();
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return (
    <section aria-labelledby="ledger-h" className="rounded-lg border border-border bg-surface">
      <header className="flex min-h-11 items-center justify-between border-b border-rule px-5">
        <h2 id="ledger-h" className="text-sm font-semibold">
          Ledger
        </h2>
        <span className="text-xs text-faint">every minute in and out</span>
      </header>
      {q.isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="p-5">
          <ErrorNote message="Couldn’t load the ledger." onRetry={() => void q.refetch()} />
        </div>
      ) : rows.length ? (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="h-9 text-left text-xs text-faint">
                <th scope="col" className="hidden w-24 pl-5 font-normal sm:table-cell">
                  When
                </th>
                <th scope="col" className="hidden w-28 font-normal sm:table-cell">
                  What
                </th>
                <th scope="col" className="pl-5 font-normal sm:pl-0">
                  Why
                </th>
                <th scope="col" className="hidden w-16 font-normal sm:table-cell">
                  By
                </th>
                <th scope="col" className="w-20 pr-5 text-right font-normal">
                  Minutes
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LedgerLine key={r.id} r={r} now={now} onOpenCard={openCard} />
              ))}
            </tbody>
          </table>
          <div className="flex justify-center border-t border-rule py-3">
            {q.hasNextPage ? (
              <Button size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? 'Loading…' : 'Load older'}
              </Button>
            ) : (
              <span className="text-xs text-faint">That’s every entry.</span>
            )}
          </div>
        </>
      ) : (
        <p className="px-5 py-4 text-sm text-faint">No entries yet. The first lands with tomorrow’s allowance or your first finished card.</p>
      )}
    </section>
  );
}

function LedgerLine({ r, now, onOpenCard }: { r: LedgerRow; now: number; onOpenCard: (id: number) => void }) {
  return (
    <tr className="h-11 border-t border-rule align-middle">
      <td className="num hidden pl-5 text-xs text-faint sm:table-cell" title={fmtDateTime(r.at)}>
        {fmtAgo(r.at, now)}
      </td>
      <td className="hidden text-xs text-muted sm:table-cell">{kindLabel(r.kind)}</td>
      <td className="max-w-0 py-2 pr-3 pl-5 sm:pl-0">
        <span className="block truncate text-[13px] text-text" title={r.reason}>
          {r.card_id ? (
            <button type="button" onClick={() => onOpenCard(r.card_id!)} className="num mr-1.5 text-xs text-faint hover:text-text hover:underline">
              #{r.card_id}
            </button>
          ) : null}
          {friendlyReason(r.reason)}
        </span>
        <span className="mt-0.5 block text-xs text-faint sm:hidden">
          {kindLabel(r.kind)} · <span className="num">{fmtAgo(r.at, now)}</span> · {SOURCE_LABEL[r.source]}
        </span>
      </td>
      <td className="hidden text-xs text-faint sm:table-cell">
        {r.source === 'ann' ? (
          <span className="inline-flex items-center gap-1">
            <AnnMark size={12} /> Ann
          </span>
        ) : (
          SOURCE_LABEL[r.source]
        )}
      </td>
      <td className="pr-5 text-right text-[13px]">
        <Minutes value={r.amount} suffix={false} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- dialogs

function PauseDialog({ open, onClose, allowance }: { open: boolean; onClose: () => void; allowance: number }) {
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'yesterday'>('today');
  const { index } = useBoardIndex();
  const pause = useWalletWrite((v: { reason: string; day?: string }) => walletApi.pause(v.reason, v.day), () => 'Pause day set. Rest up.');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const today = index?.board.today;
    const day = !today || when === 'today' ? undefined : when === 'tomorrow' ? addDays(today, 1) : addDays(today, -1);
    pause.mutate({ reason: reason.trim(), day }, { onSuccess: () => (setReason(''), onClose()) });
  };
  return (
    <Modal open={open} onClose={onClose} label="Pause a day" className="max-w-md">
      <form className="p-5" onSubmit={submit}>
        <h2 className="text-[15px] font-semibold">Pause a day</h2>
        <p className="mt-1 text-sm text-muted">For sick days, travel or emergencies. No earning and no penalties; a flat +{allowance} min instead.</p>
        <label htmlFor="pause-when" className="mt-4 block text-xs font-medium text-muted">
          Which day
        </label>
        <Select id="pause-when" value={when} onChange={(e) => setWhen(e.target.value as typeof when)} className="mt-1.5">
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="yesterday">Yesterday</option>
        </Select>
        <label htmlFor="pause-why" className="mt-3 block text-xs font-medium text-muted">
          Reason
        </label>
        <Input id="pause-why" data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Down with a fever…" className="mt-1.5 h-9" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!reason.trim() || pause.isPending}>
            {pause.isPending ? 'Pausing…' : 'Pause the day'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [minutes, setMinutes] = useState('10');
  const [reason, setReason] = useState('');
  const n = Math.round(Number(minutes));
  const valid = Number.isFinite(n) && n > 0 && reason.trim().length >= 8;
  const fine = useWalletWrite((v: { minutes: number; reason: string }) => walletApi.fine(v.minutes, v.reason), (r, v) => (r.entry ? `Fined ${v.minutes} min. Thanks for being straight.` : 'Already at the debt floor; nothing more to take.'));
  return (
    <Modal open={open} onClose={onClose} label="Fine myself" className="max-w-md">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) fine.mutate({ minutes: n, reason: reason.trim() }, { onSuccess: () => (setReason(''), onClose()) });
        }}
      >
        <h2 className="text-[15px] font-semibold">Fine myself</h2>
        <p className="mt-1 text-sm text-muted">Used a loophole, or slipped past the wall? Owning it keeps the ledger honest. It never goes below the debt floor.</p>
        <div className="mt-4 grid grid-cols-[96px_1fr] gap-3">
          <div>
            <label htmlFor="fine-min" className="block text-xs font-medium text-muted">
              Minutes
            </label>
            <Input id="fine-min" type="number" inputMode="numeric" min={1} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="num mt-1.5 h-9" />
          </div>
          <div>
            <label htmlFor="fine-why" className="block text-xs font-medium text-muted">
              Reason
            </label>
            <Input id="fine-why" data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Watched YouTube on the laptop…" aria-describedby="fine-hint" className="mt-1.5 h-9" />
          </div>
        </div>
        <p id="fine-hint" className="mt-1.5 text-xs text-faint">
          A real reason, at least 8 characters. It’s written to the ledger.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" disabled={!valid || fine.isPending}>
            Fine {Number.isFinite(n) && n > 0 ? n : ''} min
          </Button>
        </div>
      </form>
    </Modal>
  );
}
