// Completed vs created per day: paired columns, completed in the accent (the main series), created in grey.
import { useState } from 'react';
import type { Insights } from '../../../../src/core/types.ts';
import { fmtDay, fmtDayShort } from '../../lib/time.ts';
import { labelEvery, niceTicks, r1, useWidth } from './chart-utils.ts';

const H = 200;

export function ThroughputChart({ data }: { data: Insights['throughput'] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.flatMap((d) => [d.completed, d.created]).toSorted((a, b) => b - a);
  const max = Math.max(1, values[0] ?? 0);
  // One day far above the rest (a brain dump, an import) would flatten every other bar: cap the scale at
  // about twice the next-highest day and label the off-scale bar instead.
  const second = values.find((v) => v < max) ?? 0;
  const capped = max > 6 && max > 3 * Math.max(second, 1);
  const ticks = niceTicks(capped ? Math.max(4, second * 2) : max, 4);
  const top = ticks[ticks.length - 1];
  const M = { top: capped ? 18 : 8, right: 4, bottom: 24, left: 28 };
  const iw = Math.max(0, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const band = data.length ? iw / data.length : 0;
  const bar = Math.max(1, Math.min(12, (band - 4) / 2));
  const y = (v: number) => M.top + ih - (v / top) * ih;
  const every = labelEvery(data.length, width < 480 ? 4 : 7);
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={H} role="img" aria-label={`Cards completed and created per day over ${data.length} days`} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={r1(y(t))} y2={r1(y(t))} stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-[var(--faint)] text-[11px]">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = M.left + i * band + band / 2;
            const cH = (Math.min(d.completed, top) / top) * ih;
            const nH = (Math.min(d.created, top) / top) * ih;
            const dim = hover !== null && hover !== i;
            return (
              <g key={d.date} opacity={dim ? 0.45 : 1}>
                {d.completed > 0 ? <path d={colPath(x0 - bar - 1, y(0), bar, cH)} fill="var(--accent)" /> : null}
                {d.created > 0 ? <path d={colPath(x0 + 1, y(0), bar, nH)} fill="var(--chart-created)" /> : null}
                {d.completed > top ? <OffScale x={x0 - bar / 2 - 1} y={M.top} value={d.completed} /> : null}
                {d.created > top ? <OffScale x={x0 + 1 + bar / 2} y={M.top} value={d.created} /> : null}
              </g>
            );
          })}
          {data.map((d, i) =>
            i % every === 0 ? (
              <text key={d.date} x={M.left + i * band + band / 2} y={H - 6} textAnchor={i === 0 ? 'start' : 'middle'} className="fill-[var(--faint)] text-[11px]">
                {fmtDayShort(d.date)}
              </text>
            ) : null,
          )}
          {/* hit targets: one per day, wider than the marks */}
          {data.map((d, i) => (
            <rect
              key={`hit-${d.date}`}
              x={M.left + i * band}
              y={M.top}
              width={band}
              height={ih}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      {h && hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-border-strong bg-overlay px-2.5 py-1.5 text-xs shadow-[var(--shadow-float)]"
          style={{ left: Math.min(Math.max(0, M.left + hover * band + band / 2 - 70), width - 150) }}
        >
          <div className="text-faint">{fmtDay(h.date)}</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-sm bg-accent" /> Completed <span className="num ml-auto pl-3 text-text">{h.completed}</span>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-sm bg-[var(--chart-created)]" /> Created <span className="num ml-auto pl-3 text-text">{h.created}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The value of a bar that runs off the capped scale, printed above it with a break mark. */
function OffScale({ x, y, value }: { x: number; y: number; value: number }) {
  return (
    <g aria-label={`${value}, off the scale`}>
      <path d={`M${r1(x - 5)},${r1(y + 5)}l10,-3M${r1(x - 5)},${r1(y + 8)}l10,-3`} stroke="var(--surface)" strokeWidth={2} />
      <text x={x} y={y - 6} textAnchor="middle" className="num fill-[var(--text)] text-[11px]">
        {value}
      </text>
    </g>
  );
}

/** A column with a 2px rounded data end and a square foot on the baseline. */
function colPath(x: number, base: number, w: number, h: number) {
  const r = Math.min(2, w / 2, h);
  const top = base - h;
  return `M${r1(x)},${r1(base)}V${r1(top + r)}Q${r1(x)},${r1(top)} ${r1(x + r)},${r1(top)}H${r1(x + w - r)}Q${r1(x + w)},${r1(top)} ${r1(x + w)},${r1(top + r)}V${r1(base)}Z`;
}
