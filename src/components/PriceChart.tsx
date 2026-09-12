"use client";

import { useId } from "react";
import type { ChartPoint } from "@/lib/pons";
import { formatCap } from "@/lib/format";

/**
 * Market cap over the curve's trades: one point per trade, straight from
 * the logs, ending on the live price. Ink line, no market colour — the
 * number next to it says which way it went.
 */
export function PriceChart({ points, launchSupply, ethUsd }: { points: ChartPoint[]; launchSupply: number; ethUsd: number | null }) {
  const id = useId();
  const W = 720;
  const H = 220;
  const PAD = 12;
  const caps = points.map((p) => p.price * launchSupply);
  if (caps.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-[14px] border border-dashed border-edge text-sm text-ink-3">
        No trades yet — the chart starts with the first buy.
      </div>
    );
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const min = Math.min(...caps);
  const max = Math.max(...caps);
  const span = max - min || max || 1;
  const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (c: number) => H - PAD - ((c - min) / span) * (H - PAD * 2);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.price * launchSupply).toFixed(1)}`).join(" ");
  const area = `${d} L${x(t1).toFixed(1)} ${H - PAD} L${x(t0).toFixed(1)} ${H - PAD} Z`;
  const last = caps[caps.length - 1];
  const first = caps[0];
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="mono text-2xl text-ink">{formatCap(ethUsd === null ? null : last * ethUsd, last)}</p>
        <p className={`mono text-sm ${change >= 0 ? "text-up" : "text-down"}`}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}% <span className="text-ink-4">since first trade</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-[220px] w-full" preserveAspectRatio="none" role="img" aria-label="Market cap over time">
        <defs>
          <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f3f4f8" stopOpacity="0.18" />
            <stop offset="1" stopColor="#f3f4f8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id}-area)`} />
        <path d={d} fill="none" stroke="#f3f4f8" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={x(t1)} cy={y(last)} r="4" fill="#ffb02e" />
      </svg>
    </div>
  );
}
