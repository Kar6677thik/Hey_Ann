// Phone use per day (walled + everything the phone reports), one series: total minutes per day.
import { useMemo, useState } from 'react';
import { addDays, fmtDay, fmtDayShort, fmtMinutes } from '../../lib/time.ts';
import { appLabel } from '../../lib/wallet.ts';
import { labelEvery, niceTicks, r1, useWidth } from '../insights/chart-utils.ts';

const H = 160;
const M = { top: 8, right: 4, bottom: 22, left: 32 };

export function UsageChart({ items, today, days = 14, baselineUntil }: { items: { day: string; app: string; minutes: number }[]; today: string; days?: number; baselineUntil: string | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of items) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.minutes);
    return Array.from({ length: days }, (_, i) => {
      const day = addDays(today, i - days + 1);
      return { day, minutes: byDay.get(day) ?? null };
    });
  }, [items, today, days]);
  const topApps = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of items) m.set(r.app, (m.get(r.app) ?? 0) + r.minutes);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [items]);
  const reported = series.filter((s) => s.minutes !== null);
  const avg = reported.length ? Math.round(reported.reduce((n, s) => n + (s.minutes ?? 0), 0) / reported.length) : null;

  const peak = Math.max(30, ...series.map((s) => s.minutes ?? 0));
  // Over two hours, step the axis in whole hours so every tick reads the same way.
  const hours = peak > 120;
  const ticks = hours ? niceTicks(peak / 60, 3).map((h) => h * 60) : niceTicks(peak, 3);
  const top = ticks[ticks.length - 1];
  const iw = Math.max(0, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const band = iw / days;
  const bar = Math.min(16, band * 0.6);
  const y = (v: number) => M.top + ih - (v / top) * ih;
  const every = labelEvery(days, width < 360 ? 3 : 5);
  const h = hover !== null ? series[hover] : null;

  return (
    <div>
      <p className="text-xs text-faint">
        {avg === null ? (
          'No phone data yet.'
        ) : (
          <>
            <span className="num text-[20px] font-medium leading-7 text-text">{fmtMinutes(avg)}</span> a day on average, <span className="num">{reported.length}</span> days reported
          </>
        )}
      </p>
      <div ref={ref} className="relative mt-3">
        {width > 0 ? (
          <svg width={width} height={H} role="img" aria-label={`Phone minutes per day, last ${days} days`} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={r1(y(t))} y2={r1(y(t))} stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-[var(--faint)] text-[11px]">
                  {hours ? `${t / 60}h` : t}
                </text>
              </g>
            ))}
            {series.map((s, i) => {
              const x = M.left + i * band + (band - bar) / 2;
              const base = baselineUntil !== null && s.day < baselineUntil;
              if (s.minutes === null || s.minutes === 0) return null;
              const hh = (Math.min(s.minutes, top) / top) * ih;
              return (
                <path
                  key={s.day}
                  d={`M${r1(x)},${r1(y(0))}V${r1(y(0) - hh + 2)}Q${r1(x)},${r1(y(0) - hh)} ${r1(x + 2)},${r1(y(0) - hh)}H${r1(x + bar - 2)}Q${r1(x + bar)},${r1(y(0) - hh)} ${r1(x + bar)},${r1(y(0) - hh + 2)}V${r1(y(0))}Z`}
                  fill={base ? 'var(--chart-created)' : 'var(--accent)'}
                  opacity={hover !== null && hover !== i ? 0.45 : 1}
                />
              );
            })}
            {series.map((s, i) =>
              i % every === 0 || i === days - 1 ? (
                <text key={`l-${s.day}`} x={M.left + i * band + band / 2} y={H - 5} textAnchor="middle" className="fill-[var(--faint)] text-[11px]">
                  {s.day === today ? 'Today' : fmtDayShort(s.day)}
                </text>
              ) : null,
            )}
            {series.map((s, i) => (
              <rect key={`h-${s.day}`} x={M.left + i * band} y={M.top} width={band} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            ))}
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        {h && hover !== null ? (
          <div className="pointer-events-none absolute top-0 z-10 rounded-md border border-border-strong bg-overlay px-2.5 py-1.5 text-xs shadow-[var(--shadow-float)]" style={{ left: Math.min(Math.max(0, M.left + hover * band - 40), width - 140) }}>
            <div className="text-faint">{fmtDay(h.day)}</div>
            <div className="num text-text">{h.minutes === null ? 'not reported' : fmtMinutes(h.minutes)}</div>
          </div>
        ) : null}
      </div>
      {baselineUntil ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
          <span aria-hidden className="size-2 rounded-sm bg-[var(--chart-created)]" /> Baseline week
          <span aria-hidden className="ml-2 size-2 rounded-sm bg-accent" /> With the wall
        </p>
      ) : null}
      {topApps.length ? (
        <ul className="mt-3 border-t border-rule pt-2">
          {topApps.map(([app, min]) => (
            <li key={app} className="flex h-7 items-center justify-between gap-3 text-xs">
              <span className="truncate text-muted" title={app}>
                {appLabel(app)}
              </span>
              <span className="num text-text">{fmtMinutes(min)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
