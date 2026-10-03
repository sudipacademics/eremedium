'use client';

import { useId, useState, type ReactNode } from 'react';

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10ⁿ so gridlines land on readable values. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return step * exponent;
}

/** A smooth path through the points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function LineChart({
  labels,
  series,
  format,
  height = 250,
}: {
  labels: string[];
  series: LineSeries[];
  format: (value: number) => string;
  height?: number;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 440;
  const pad = { top: 12, right: 10, bottom: 26, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const x = (i: number) => pad.left + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const first = series[0];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Trend of ${series.map((s) => s.label).join(', ')} by month`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - rect.left) / rect.width) * width;
          const index = Math.round(((px - pad.left) / innerW) * (labels.length - 1));
          setHover(Math.max(0, Math.min(labels.length - 1, index)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={first?.color ?? '#10b981'} stopOpacity="0.28" />
            <stop offset="100%" stopColor={first?.color ?? '#10b981'} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#0b4f45" strokeOpacity="0.08" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#0b4f45" fillOpacity="0.55">
              {format(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={label + i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="#0b4f45" fillOpacity="0.55">
            {label}
          </text>
        ))}
        {first && (
          <path
            d={`${smoothPath(first.values.map((v, i) => ({ x: x(i), y: y(v) })))} L${x(first.values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
            fill={`url(#${gradientId})`}
          />
        )}
        {series.map((s) => (
          <path key={s.key} d={smoothPath(s.values.map((v, i) => ({ x: x(i), y: y(v) })))} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" />
        ))}
        {series.map((s) =>
          s.values.map((v, i) => <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(v)} r={hover === i ? 4 : 2.6} fill="#fff" stroke={s.color} strokeWidth="1.8" />),
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="#0b4f45" strokeOpacity="0.2" strokeDasharray="3 3" />}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[9rem] -translate-x-1/2 rounded-xl border border-ved-green-900/10 bg-white/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(x(hover) / width) * 100}%` }}
        >
          <p className="mb-1 font-semibold text-ved-green-900">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3 text-ved-green-800/80">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular font-medium text-ved-green-900">{format(s.values[hover] ?? 0)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({ slices, size = 170, thickness = 26, children }: { slices: DonutSlice[]; size?: number; thickness?: number; children?: ReactNode }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#0b4f45" strokeOpacity="0.07" strokeWidth={thickness} />
        {total > 0 &&
          slices
            .filter((slice) => slice.value > 0)
            .map((slice) => {
              const length = (slice.value / total) * circumference;
              const dash = `${Math.max(0, length - 2)} ${circumference}`;
              const element = (
                <circle
                  key={slice.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                />
              );
              offset += length;
              return element;
            })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function BarChart({ labels, values, format, height = 190 }: { labels: string[]; values: number[]; format: (value: number) => string; height?: number }) {
  const gradientId = useId();
  const width = 320;
  const pad = { top: 10, right: 6, bottom: 24, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...values));
  const slot = innerW / Math.max(1, values.length);
  const barW = Math.min(26, slot * 0.55);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={labels.map((l, i) => `${l}: ${values[i]}`).join(', ')}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={width - pad.right} y1={y(t * max)} y2={y(t * max)} stroke="#0b4f45" strokeOpacity="0.08" />
          <text x={pad.left - 6} y={y(t * max) + 4} textAnchor="end" fontSize="10" fill="#0b4f45" fillOpacity="0.55">
            {format(t * max)}
          </text>
        </g>
      ))}
      {values.map((value, i) => {
        const cx = pad.left + slot * i + slot / 2;
        return (
          <g key={labels[i]! + i}>
            <title>{`${labels[i]}: ${format(value)}`}</title>
            <rect x={cx - barW / 2} y={y(value)} width={barW} height={Math.max(0, y(0) - y(value))} rx="4" fill={`url(#${gradientId})`} />
            <text x={cx} y={height - 6} textAnchor="middle" fontSize="10" fill="#0b4f45" fillOpacity="0.55">
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
