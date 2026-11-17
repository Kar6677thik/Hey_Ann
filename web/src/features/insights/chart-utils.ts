import { useLayoutEffect, useRef, useState } from 'react';

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Round, even ticks from 0 with the top tick above the max (counts: integers). */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const s = Math.max(1, Math.round(step));
  const top = Math.ceil((max + 0.0001) / s) * s;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += s) ticks.push(v);
  if (ticks[ticks.length - 1] <= max) ticks.push(ticks[ticks.length - 1] + s);
  return ticks;
}

/** Every k-th index so about `n` labels show, always on one step (the end is left unlabelled if off-step). */
export function labelEvery(count: number, n: number): number {
  return Math.max(1, Math.ceil(count / n));
}

export const r1 = (v: number) => Math.round(v * 10) / 10;
