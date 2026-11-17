// My Day: Ann's proposal (GET /plan) against what's planned now; accept or adjust, then save (POST /plan).
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Card, DayPlan } from '../../../../src/core/types.ts';
import { api } from '../../lib/api.ts';
import { useWrite } from '../../lib/mutations.ts';
import { fmtMinutes } from '../../lib/time.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Checkbox } from '../../components/ui/form.tsx';
import { Pill, Skeleton } from '../../components/ui/bits.tsx';
import { cn } from '../../components/ui/cn.ts';
import { CardRow } from '../card/CardRow.tsx';

const DEFAULT_ESTIMATE = 30;
const PLAN_ROWS = 8;
/** Same rule as the server: what's left of the estimate (30 min default), at least 10. */
export const minutesNeeded = (c: Card) => Math.max((c.estimate_min ?? DEFAULT_ESTIMATE) - c.spent_min, 10);

export function CapacityBar({ planned, capacity }: { planned: number; capacity: number }) {
  const over = planned > capacity;
  const pct = capacity ? Math.min(planned / capacity, 1) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">
          <span className={cn('num text-[15px] font-medium', over ? 'text-[var(--pill-warning-ink)]' : 'text-text')}>{fmtMinutes(planned)}</span> planned
        </span>
        <span className="num text-faint">of {fmtMinutes(capacity)} capacity</span>
      </div>
      <div
        className="relative mt-2 h-2 rounded-full bg-raised"
        role="meter"
        aria-label="Planned time against day capacity"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={planned}
        aria-valuetext={`${fmtMinutes(planned)} of ${fmtMinutes(capacity)}`}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', over ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
      {over ? <p className="mt-1.5 text-xs text-[var(--pill-warning-ink)]">{fmtMinutes(planned - capacity)} over. Something will slip.</p> : null}
    </div>
  );
}

export function PlanPanel({ plan, planned, cardsById, pending }: { plan: DayPlan | undefined; planned: Card[]; cardsById: Map<number, Card>; pending: boolean }) {
  const current = useMemo(() => new Set(planned.map((c) => c.id)), [planned]);
  const proposal = useMemo(() => new Set(plan?.cards.map((r) => r.card.id) ?? []), [plan]);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [showAll, setShowAll] = useState(false);
  const chosen = selected ?? current;
  const save = useWrite((ids: number[]) => api.setPlan(ids));

  const reasons = useMemo(() => new Map([...(plan?.cards ?? []), ...(plan?.overflow ?? [])].map((r) => [r.card.id, r.reasons])), [plan]);
  const rows = useMemo(() => {
    const ids = [...current, ...(plan?.cards.map((r) => r.card.id) ?? []), ...(plan?.overflow.map((r) => r.card.id) ?? [])];
    return [...new Set(ids)].map((id) => cardsById.get(id)).filter((c): c is Card => !!c);
  }, [current, plan, cardsById]);

  const minutes = rows.filter((c) => chosen.has(c.id)).reduce((n, c) => n + minutesNeeded(c), 0);
  const dirty = chosen.size !== current.size || [...chosen].some((id) => !current.has(id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s ?? current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-labelledby="plan-h" className="rounded-lg border border-border bg-surface">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-2">
        <div>
          <h2 id="plan-h" className="text-sm font-semibold">
            My Day
          </h2>
          <p className="text-xs text-faint">
            {current.size ? (
              <>
                <span className="num">{current.size}</span> planned · Ann suggests <span className="num">{proposal.size}</span>
              </>
            ) : (
              'Nothing planned yet. Ann has a proposal.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => setSelected(new Set(proposal))} disabled={!plan}>
            Use Ann’s proposal
          </Button>
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Reset
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate([...chosen], { onSuccess: () => setSelected(null) })}>
            Save plan
          </Button>
        </div>
      </header>
      <div className="px-5 pt-4">
        {plan ? <CapacityBar planned={minutes} capacity={plan.capacity_min} /> : <Skeleton className="h-8 w-full" />}
      </div>
      {pending ? (
        <ul className="px-5 py-3">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex h-11 items-center gap-3">
              <Skeleton className="size-4" />
              <Skeleton className="h-3.5 w-2/3" />
            </li>
          ))}
        </ul>
      ) : rows.length ? (
        <ul className="px-5 py-2">
          {(showAll ? rows : rows.slice(0, PLAN_ROWS)).map((c) => {
            const inPlan = current.has(c.id);
            const suggested = proposal.has(c.id);
            return (
              <CardRow
                key={c.id}
                card={c}
                lead={<Checkbox checked={chosen.has(c.id)} onChange={() => toggle(c.id)} label={`Plan #${c.id} for today`} />}
                sub={
                  reasons.get(c.id)?.length ? (
                    <span className="truncate">{reasons.get(c.id)!.join(' · ')}</span>
                  ) : null
                }
                meta={
                  <span className="flex flex-none items-center gap-2">
                    {!inPlan && suggested ? <Pill tone="accent">Suggested</Pill> : null}
                    {!suggested && !inPlan ? <Pill>Doesn’t fit</Pill> : null}
                    <span className="num w-14 text-right text-xs text-faint">{fmtMinutes(minutesNeeded(c))}</span>
                  </span>
                }
                showDue={false}
              />
            );
          })}
          {rows.length > PLAN_ROWS ? (
            <li className="pt-2">
              <button type="button" onClick={() => setShowAll((s) => !s)} className="h-8 text-xs text-muted hover:text-text">
                {showAll ? 'Show fewer' : `Show ${rows.length - PLAN_ROWS} more candidates`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="px-5 py-5 text-sm text-faint">No open cards to plan. Add some, or ask “Hey Ann, plan my day”.</p>
      )}
    </section>
  );
}
