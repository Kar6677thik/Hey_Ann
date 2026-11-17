// Cumulative flow: cards per column at the end of each day, stacked. Done at the bottom, backlog on top;
// one ordinal blue ramp (validated: monotone lightness, visible steps, light end clears the surface).
import { useMemo, useState } from 'react';
import type { Column, Insights } from '../../../../src/core/types.ts';
import { fmtDay, fmtDayShort } from '../../lib/time.ts';
import { labelEvery, niceTicks, r1, useWidth } from './chart-utils.ts';

const H = 220;
const M = { top: 8, right: 4, bottom: 24, left: 28 };
const RAMP = ['var(--cfd-5)', 'var(--cfd-4)', 'var(--cfd-3)', 'var(--cfd-2)', 'var(--cfd-1)'];

export function CfdChart({ data, columns }: { data: Insights['cfd']; columns: Column[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // Stack order: done first (bottom), then backwards through the flow.
  const order = useMemo(() => columns.toSorted((a, b) => b.position - a.position), [columns]);
  const colour = (i: number) => RAMP[Math.round((i / Math.max(1, order.length - 1)) * (RAMP.length - 1))];
  const totals = data.map((d) => order.reduce((n, c) => n + (d.counts[String(c.id)] ?? 0), 0));
  const ticks = niceTicks(Math.max(1, ...totals), 4);
  const top = ticks[ticks.length - 1];
  const iw = Math.max(0, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v: number) => M.top + ih - (v / top) * ih;
  const every = labelEvery(data.length, width < 480 ? 4 : 7);

  const areas = useMemo(() => {
    const base = data.map(() => 0);
    return order.map((col) => {
      const lower = [...base];
      data.forEach((d, i) => (base[i] += d.counts[String(col.id)] ?? 0));
      const upper = [...base];
      return { col, lower, upper };
    });
  }, [data, order]);

  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {order.toReversed().map((c) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm" style={{ background: colour(order.indexOf(c)) }} />
            {c.name}
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative">
        {width > 0 && data.length ? (
          <svg width={width} height={H} role="img" aria-label="Cumulative flow: cards per column at the end of each day" className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={r1(y(t))} y2={r1(y(t))} stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-[var(--faint)] text-[11px]">
                  {t}
                </text>
              </g>
            ))}
            {areas.map(({ col, lower, upper }, k) => {
              const pts = upper.map((v, i) => `${r1(x(i))},${r1(y(v))}`).join('L');
              const back = lower
                .map((v, i) => `${r1(x(i))},${r1(y(v))}`)
                .toReversed()
                .join('L');
              return <path key={col.id} d={`M${pts}L${back}Z`} fill={colour(k)} stroke="var(--surface)" strokeWidth={1} />;
            })}
            {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--text)" strokeOpacity={0.5} /> : null}
            {data.map((d, i) =>
              i % every === 0 ? (
                <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'middle'} className="fill-[var(--faint)] text-[11px]">
                  {fmtDayShort(d.date)}
                </text>
              ) : null,
            )}
            <rect
              x={M.left}
              y={M.top}
              width={iw}
              height={ih}
              fill="transparent"
              onPointerMove={(e) => {
                const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                const i = Math.round(((e.clientX - box.left) / box.width) * (data.length - 1));
                setHover(Math.max(0, Math.min(data.length - 1, i)));
              }}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        {h && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-md border border-border-strong bg-overlay px-2.5 py-1.5 text-xs shadow-[var(--shadow-float)]"
            style={{ left: Math.min(Math.max(0, x(hover) + 12), width - 170) }}
          >
            <div className="text-faint">{fmtDay(h.date)}</div>
            {order.toReversed().map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: colour(order.indexOf(c)) }} />
                {c.name}
                <span className="num ml-auto pl-3 text-text">{h.counts[String(c.id)] ?? 0}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
