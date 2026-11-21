import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, inr, lakh } from '../format';

export type RevenueDay = { date: string; consultation: number; physiotherapy: number; lab: number; diagnostic: number; pharmacy: number };

export const SERIES = [
  { key: 'consultation', label: 'Consultation', color: '#16a34a' },
  { key: 'physiotherapy', label: 'Physiotherapy', color: '#8b5cf6' },
  { key: 'lab', label: 'Lab Test', color: '#3b82f6' },
  { key: 'diagnostic', label: 'Diagnostics', color: '#0d9488' },
  { key: 'pharmacy', label: 'Pharmacy', color: '#f59e0b' },
] as const;

type Key = (typeof SERIES)[number]['key'];

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(entry.contentRect.width, 240)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/* Monotone cubic path through the points so curves never overshoot. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function niceMax(v: number) {
  if (v <= 0) return 1000;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

export function RevenueChart({ days, height = 210 }: { days: RevenueDay[]; height?: number }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 34, r: 8, t: 10, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const stacks = useMemo(() => {
    const order: Key[] = ['pharmacy', 'diagnostic', 'lab', 'physiotherapy', 'consultation'];
    const cumulative = days.map(() => 0);
    const layers: Record<string, { lo: number[]; hi: number[] }> = {};
    for (const key of order) {
      const lo = [...cumulative];
      days.forEach((d, i) => {
        cumulative[i] += d[key] || 0;
      });
      layers[key] = { lo, hi: [...cumulative] };
    }
    return { layers, order, max: niceMax(Math.max(...cumulative, 0)) };
  }, [days]);

  const x = (i: number) => pad.l + (days.length <= 1 ? w / 2 : (i / (days.length - 1)) * w);
  const y = (v: number) => pad.t + h - (v / stacks.max) * h;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => f * stacks.max);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(w / 70))));

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Revenue by service, stacked per day" onMouseLeave={() => setHover(null)}>
        <defs>
          {SERIES.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.06} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {lakh(t)}
            </text>
          </g>
        ))}
        {stacks.order.map((key) => {
          const color = SERIES.find((s) => s.key === key)!.color;
          const top = stacks.layers[key].hi.map((v, i) => [x(i), y(v)] as [number, number]);
          const bottom = stacks.layers[key].lo.map((v, i) => [x(i), y(v)] as [number, number]).reverse();
          const upper = smoothPath(top);
          const lower = smoothPath(bottom).replace(/^M/, 'L');
          return (
            <g key={key}>
              <path d={`${upper} ${lower} Z`} fill={`url(#g-${key})`} />
              <path d={upper} fill="none" stroke={color} strokeWidth={2.2} />
            </g>
          );
        })}
        {days.map((d, i) =>
          i % labelEvery === 0 || i === days.length - 1 ? (
            <text key={d.date} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} className="axis">
              {fmtDate(d.date, false)}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} className="hover-line" />}
        <rect
          x={pad.l}
          y={pad.t}
          width={w}
          height={h}
          fill="transparent"
          onMouseMove={(e) => {
            const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const ratio = (e.clientX - box.left) / box.width;
            setHover(Math.min(days.length - 1, Math.max(0, Math.round(ratio * (days.length - 1)))));
          }}
        />
      </svg>
      {hover !== null && days[hover] && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover) - 80, 0), width - 170) }}>
          <strong>{fmtDate(days[hover].date)}</strong>
          {SERIES.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} /> {s.label} <b>{inr(days[hover][s.key])}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
