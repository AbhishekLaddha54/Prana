"use client";
import { useMemo } from "react";

export interface Series {
  name: string;
  color: string;
  data: (number | null)[];
  dashed?: boolean;
  width?: number;
  band?: { lo: (number | null)[]; hi: (number | null)[] };
  opacity?: number;
}
export interface VLine { x: number; label: string; color?: string }

export function LineChart({ xs, series, vlines = [], height = 220, yMin, yMax, xLabel, hlines = [] }: {
  xs: number[]; series: Series[]; vlines?: VLine[]; height?: number; yMin?: number; yMax?: number; xLabel?: string; hlines?: { y: number; label: string; color?: string }[];
}) {
  const W = 800;
  const H = height;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const geo = useMemo(() => {
    const vals: number[] = [];
    series.forEach((s) => {
      s.data.forEach((v) => v != null && Number.isFinite(v) && vals.push(v));
      s.band?.hi.forEach((v) => v != null && Number.isFinite(v) && vals.push(v));
    });
    const lo = yMin ?? Math.min(0, ...vals);
    let hi = yMax ?? Math.max(1, ...vals) * 1.08;
    if (hi <= lo) hi = lo + 1;
    const x0 = xs[0] ?? 0;
    const x1 = xs[xs.length - 1] ?? 1;
    const sx = (x: number) => pad.l + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - pad.l - pad.r);
    const sy = (y: number) => H - pad.b - ((y - lo) / (hi - lo)) * (H - pad.t - pad.b);
    return { lo, hi, sx, sy };
  }, [xs, series, yMin, yMax, H]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sx, sy, lo, hi } = geo;
  const path = (d: (number | null)[]) => {
    let s = "";
    let pen = false;
    d.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      s += `${pen ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return s;
  };
  const bandPath = (b: NonNullable<Series["band"]>) => {
    const up: string[] = [];
    const dn: string[] = [];
    b.hi.forEach((v, i) => {
      const l = b.lo[i];
      if (v == null || l == null) return;
      up.push(`${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`);
      dn.unshift(`${sx(xs[i]).toFixed(1)},${sy(l).toFixed(1)}`);
    });
    return up.length ? `M${up.join("L")}L${dn.join("L")}Z` : "";
  };
  const yt = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const step = Math.max(1, Math.ceil(xs.length / 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {yt.map((y, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(y)} y2={sy(y)} stroke="#ece3cf" strokeWidth={1} />
          <text x={pad.l - 6} y={sy(y) + 3} fill="#8b9489" fontSize={10.5} textAnchor="end">{y >= 100 ? Math.round(y) : y.toFixed(y < 10 ? 1 : 0)}</text>
        </g>
      ))}
      {xs.map((x, i) => i % step === 0 && <text key={i} x={sx(x)} y={H - 8} fill="#8b9489" fontSize={10.5} textAnchor="middle">{x}</text>)}
      {xLabel && <text x={W - pad.r} y={H - 8} fill="#a9b0a4" fontSize={10} textAnchor="end">{xLabel}</text>}
      {hlines.map((h, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(h.y)} y2={sy(h.y)} stroke={h.color ?? "#f0803c"} strokeDasharray="3 4" strokeOpacity={0.8} />
          <text x={W - pad.r - 2} y={sy(h.y) - 4} fill={h.color ?? "#f0803c"} fontSize={10.5} textAnchor="end">{h.label}</text>
        </g>
      ))}
      {vlines.map((v, i) => (
        <g key={i}>
          <line x1={sx(v.x)} x2={sx(v.x)} y1={pad.t} y2={H - pad.b} stroke={v.color ?? "#0f6b4f"} strokeDasharray="4 4" strokeOpacity={0.8} />
          <text x={sx(v.x) + 5} y={pad.t + 10} fill={v.color ?? "#0f6b4f"} fontSize={10.5} fontWeight={600}>{v.label}</text>
        </g>
      ))}
      {series.map((s, i) => (
        <g key={i} opacity={s.opacity ?? 1}>
          {s.band && <path d={bandPath(s.band)} fill={s.color} fillOpacity={0.18} stroke="none" />}
          <path d={path(s.data)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2.4} strokeDasharray={s.dashed ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5">
          <svg width="20" height="6"><line x1="0" x2="20" y1="3" y2="3" stroke={it.color} strokeWidth="3" strokeDasharray={it.dashed ? "4 3" : undefined} strokeLinecap="round" /></svg>
          {it.name}
        </span>
      ))}
    </div>
  );
}

export function Sparkline({ data, color = "#0f6b4f", w = 84, h = 26 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const mx = Math.max(1.2, ...data);
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - (v / mx) * (h - 4)).toFixed(1)}`);
  const one = h - 2 - (1 / mx) * (h - 4);
  return (
    <svg width={w} height={h}>
      <line x1="0" x2={w} y1={one} y2={one} stroke="#e5484d" strokeOpacity={0.4} strokeDasharray="2 3" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A "likely range" bar: shows the best guess plus the range we are 95% sure about. */
export function RangeBar({ before, after, max = 30 }: { before?: { lo: number; hi: number; mu: number }; after: { lo: number; hi: number; mu: number }; max?: number }) {
  const pct = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));
  const row = (b: { lo: number; hi: number; mu: number }, color: string, label: string) => (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px] text-muted"><span>{label}</span><span className="font-mono">about {b.mu.toFixed(1)} days (likely {b.lo.toFixed(0)}–{b.hi.toFixed(0)})</span></div>
      <div className="relative h-4 rounded-full bg-[#f1e9d8]">
        <div className="absolute inset-y-0 rounded-full transition-all duration-700" style={{ left: `${pct(b.lo)}%`, width: `${Math.max(1.5, pct(b.hi) - pct(b.lo))}%`, background: color, opacity: 0.3 }} />
        <div className="absolute -inset-y-0.5 w-1 rounded-full transition-all duration-700" style={{ left: `${pct(b.mu)}%`, background: color }} />
      </div>
    </div>
  );
  return (
    <div className="space-y-2">
      {before && row(before, "#8b9489", "Before this reading")}
      {row(after, "#0f6b4f", "After this reading")}
    </div>
  );
}
