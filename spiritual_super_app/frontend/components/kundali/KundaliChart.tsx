'use client';

import { useId } from 'react';

import { GRAHA_COLOR, SIGN_SHORT, grahaShort, normSign } from './vedic';

export type ChartStyle = 'north' | 'south' | 'east';

export const CHART_STYLES: ReadonlyArray<{ id: ChartStyle; label: string }> = [
  { id: 'north', label: 'North Indian' },
  { id: 'south', label: 'South Indian' },
  { id: 'east', label: 'East Indian' },
];

export interface ChartPlacement {
  body: string;
  sign: number;
  retrograde: boolean;
}

const INK = '#0b4f45';
const GOLD = '#b8923a';
const GOLD_SOFT = '#d9bf7a';

type Pt = readonly [number, number];

interface Region {
  sign: number;
  polygon: readonly Pt[];
  centre: Pt;
  cols: number;
  label: { at: Pt; text: string; anchor: 'start' | 'middle' | 'end' };
}

/*
 * North Indian: the twelve houses are fixed on the page, anticlockwise from the top-centre diamond,
 * and the signs rotate with the ascendant. Each house carries its sign number at its inner vertex.
 */
const NORTH_HOUSES: ReadonlyArray<{ polygon: readonly Pt[]; centre: Pt; cols: number; num: Pt }> = [
  { polygon: [[50, 0], [25, 25], [50, 50], [75, 25]], centre: [50, 24], cols: 3, num: [50, 44] },
  { polygon: [[0, 0], [50, 0], [25, 25]], centre: [25, 8.5], cols: 3, num: [25, 20.5] },
  { polygon: [[0, 0], [25, 25], [0, 50]], centre: [8.5, 25], cols: 1, num: [20, 26.5] },
  { polygon: [[0, 50], [25, 25], [50, 50], [25, 75]], centre: [24, 50], cols: 3, num: [44, 51.5] },
  { polygon: [[0, 50], [25, 75], [0, 100]], centre: [8.5, 75], cols: 1, num: [20, 76.5] },
  { polygon: [[0, 100], [25, 75], [50, 100]], centre: [25, 92], cols: 3, num: [25, 81.5] },
  { polygon: [[50, 100], [25, 75], [50, 50], [75, 75]], centre: [50, 76], cols: 3, num: [50, 59] },
  { polygon: [[50, 100], [75, 75], [100, 100]], centre: [75, 92], cols: 3, num: [75, 81.5] },
  { polygon: [[100, 100], [75, 75], [100, 50]], centre: [91.5, 75], cols: 1, num: [80, 76.5] },
  { polygon: [[100, 50], [75, 75], [50, 50], [75, 25]], centre: [76, 50], cols: 3, num: [56, 51.5] },
  { polygon: [[100, 50], [75, 25], [100, 0]], centre: [91.5, 25], cols: 1, num: [80, 26.5] },
  { polygon: [[100, 0], [75, 25], [50, 0]], centre: [75, 8.5], cols: 3, num: [75, 20.5] },
];

function northRegions(lagnaSign: number): Region[] {
  return NORTH_HOUSES.map((house, index) => {
    const sign = normSign(lagnaSign + index);
    return {
      sign,
      polygon: house.polygon,
      centre: house.centre,
      cols: house.cols,
      label: { at: house.num, text: String(sign), anchor: 'middle' },
    };
  });
}

/* South Indian: signs are fixed in the outer ring of a 4×4 grid, Pisces top-left, running clockwise. */
const SOUTH_CELLS: Record<number, Pt> = {
  12: [0, 0],
  1: [1, 0],
  2: [2, 0],
  3: [3, 0],
  4: [3, 1],
  5: [3, 2],
  6: [3, 3],
  7: [2, 3],
  8: [1, 3],
  9: [0, 3],
  10: [0, 2],
  11: [0, 1],
};

function southRegions(): Region[] {
  return Array.from({ length: 12 }, (_, i) => {
    const sign = i + 1;
    const [c, r] = SOUTH_CELLS[sign]!;
    const x = c * 25;
    const y = r * 25;
    return {
      sign,
      polygon: [[x, y], [x + 25, y], [x + 25, y + 25], [x, y + 25]],
      centre: [x + 12.5, y + 14],
      cols: 2,
      label: { at: [x + 23, y + 4.6], text: SIGN_SHORT[i]!, anchor: 'end' },
    };
  });
}

/*
 * East Indian (Bengal): a 3×3 grid with the corner cells split diagonally. Signs are fixed, Aries in
 * the top-centre cell, running anticlockwise.
 */
const T = 100 / 3;
const EAST: Record<number, Omit<Region, 'sign' | 'label'> & { lab: Pt; anchor: 'start' | 'end' }> = {
  1: { polygon: [[T, 0], [2 * T, 0], [2 * T, T], [T, T]], centre: [50, 18], cols: 3, lab: [T + 2.5, 5], anchor: 'start' },
  2: { polygon: [[0, 0], [T, 0], [T, T]], centre: [23, 11], cols: 2, lab: [T - 2, 5], anchor: 'end' },
  3: { polygon: [[0, 0], [0, T], [T, T]], centre: [10.5, 23], cols: 2, lab: [2, T - 2.5], anchor: 'start' },
  4: { polygon: [[0, T], [T, T], [T, 2 * T], [0, 2 * T]], centre: [T / 2, 51], cols: 3, lab: [2, T + 5], anchor: 'start' },
  5: { polygon: [[0, 2 * T], [T, 2 * T], [0, 100]], centre: [10.5, 77.5], cols: 2, lab: [2, 2 * T + 5], anchor: 'start' },
  6: { polygon: [[0, 100], [T, 2 * T], [T, 100]], centre: [23, 90], cols: 2, lab: [T - 2, 97.5], anchor: 'end' },
  7: { polygon: [[T, 2 * T], [2 * T, 2 * T], [2 * T, 100], [T, 100]], centre: [50, 84], cols: 3, lab: [T + 2.5, 2 * T + 5], anchor: 'start' },
  8: { polygon: [[2 * T, 2 * T], [2 * T, 100], [100, 100]], centre: [77, 90], cols: 2, lab: [2 * T + 2, 97.5], anchor: 'start' },
  9: { polygon: [[2 * T, 2 * T], [100, 2 * T], [100, 100]], centre: [89.5, 77.5], cols: 2, lab: [98, 2 * T + 5], anchor: 'end' },
  10: { polygon: [[2 * T, T], [100, T], [100, 2 * T], [2 * T, 2 * T]], centre: [100 - T / 2, 51], cols: 3, lab: [2 * T + 2.5, T + 5], anchor: 'start' },
  11: { polygon: [[100, 0], [100, T], [2 * T, T]], centre: [89.5, 23], cols: 2, lab: [98, T - 2.5], anchor: 'end' },
  12: { polygon: [[2 * T, 0], [100, 0], [2 * T, T]], centre: [77, 11], cols: 2, lab: [2 * T + 2, 5], anchor: 'start' },
};

function eastRegions(): Region[] {
  return Array.from({ length: 12 }, (_, i) => {
    const sign = i + 1;
    const cell = EAST[sign]!;
    return {
      sign,
      polygon: cell.polygon,
      centre: cell.centre,
      cols: cell.cols,
      label: { at: cell.lab, text: SIGN_SHORT[i]!, anchor: cell.anchor },
    };
  });
}

const GRID_LINES: Record<ChartStyle, string> = {
  north: 'M0 0 L100 100 M100 0 L0 100 M50 0 L0 50 L50 100 L100 50 Z',
  south: 'M25 0 V100 M75 0 V100 M0 25 H100 M0 75 H100 M50 0 V25 M50 75 V100 M0 50 H25 M75 50 H100',
  east: `M${T} 0 V100 M${2 * T} 0 V100 M0 ${T} H100 M0 ${2 * T} H100 M0 0 L${T} ${T} M100 0 L${2 * T} ${T} M0 100 L${T} ${2 * T} M100 100 L${2 * T} ${2 * T}`,
};

const points = (polygon: readonly Pt[]) => polygon.map(([x, y]) => `${x},${y}`).join(' ');

function PlanetCluster({ region, items, fontSize }: { region: Region; items: ChartPlacement[]; fontSize: number }) {
  const [cx, cy] = region.centre;
  const cols = Math.min(region.cols, Math.max(1, items.length));
  const rows = Math.ceil(items.length / cols);
  const lineH = fontSize * 1.18;
  const colW = fontSize * 2.35;
  const top = cy - ((rows - 1) * lineH) / 2 + fontSize * 0.35;

  return (
    <>
      {items.map((item, index) => {
        const row = Math.floor(index / cols);
        const inRow = Math.min(cols, items.length - row * cols);
        const col = index % cols;
        return (
          <text
            key={item.body}
            x={cx + (col - (inRow - 1) / 2) * colW}
            y={top + row * lineH}
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={700}
            fill={GRAHA_COLOR[item.body] ?? INK}
          >
            {grahaShort(item.body)}
            {item.retrograde && (
              <tspan fontSize={fontSize * 0.55} dy={-fontSize * 0.35}>
                R
              </tspan>
            )}
          </text>
        );
      })}
    </>
  );
}

/**
 * A kundali chart in any of the three regional styles. Planets are placed by sign (whole-sign), which
 * is how every divisional chart is read; the ascendant's sign is highlighted and labelled.
 */
export function KundaliChart({
  chartStyle,
  lagnaSign,
  showLagna,
  placements,
  title,
  subtitle,
  compact,
}: {
  chartStyle: ChartStyle;
  lagnaSign: number;
  showLagna: boolean;
  placements: ChartPlacement[];
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const regions =
    chartStyle === 'north' ? northRegions(lagnaSign) : chartStyle === 'south' ? southRegions() : eastRegions();
  const fontSize = compact ? (chartStyle === 'east' ? 4.6 : 5) : chartStyle === 'east' ? 3.9 : 4.3;

  const bySign = new Map<number, ChartPlacement[]>();
  for (const placement of placements) {
    const list = bySign.get(placement.sign) ?? [];
    list.push(placement);
    bySign.set(placement.sign, list);
  }
  const lagnaRegion = regions.find((region) => region.sign === lagnaSign)!;
  const centreLabel = chartStyle !== 'north';

  return (
    <svg viewBox="-7 -7 114 114" className="h-auto w-full" role="img" aria-label={`${title} chart`}>
      <defs>
        <radialGradient id={`bg${uid}`} cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#fffdf7" />
          <stop offset="100%" stopColor="#f4ecda" />
        </radialGradient>
        <linearGradient id={`gold${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d9bf7a" />
          <stop offset="50%" stopColor="#a67c2e" />
          <stop offset="100%" stopColor="#d9bf7a" />
        </linearGradient>
      </defs>

      {/* Ornamental frame */}
      <rect x="-6" y="-6" width="112" height="112" rx="5" fill={`url(#gold${uid})`} />
      <rect x="-4.6" y="-4.6" width="109.2" height="109.2" rx="4" fill="#fffaf0" />
      <rect x="-3.2" y="-3.2" width="106.4" height="106.4" rx="3" fill="none" stroke={GOLD_SOFT} strokeWidth="0.4" strokeDasharray="0.8 1.2" />
      {([[-4.6, -4.6], [104.6, -4.6], [-4.6, 104.6], [104.6, 104.6]] as const).map(([x, y]) => (
        <g key={`${x}${y}`} transform={`translate(${x} ${y})`}>
          <rect x="-1.8" y="-1.8" width="3.6" height="3.6" transform="rotate(45)" fill={`url(#gold${uid})`} />
          <circle r="0.8" fill="#fffaf0" />
        </g>
      ))}

      <rect x="0" y="0" width="100" height="100" fill={`url(#bg${uid})`} stroke={GOLD} strokeWidth="0.9" />

      {showLagna && <polygon points={points(lagnaRegion.polygon)} fill="#c9a64a" fillOpacity="0.16" />}

      {chartStyle === 'south' && (
        <rect x="25" y="25" width="50" height="50" fill="#fffdf8" stroke={GOLD_SOFT} strokeWidth="0.4" />
      )}
      {chartStyle === 'east' && (
        <rect x={T} y={T} width={T} height={T} fill="#fffdf8" stroke={GOLD_SOFT} strokeWidth="0.4" />
      )}

      <path d={GRID_LINES[chartStyle]} fill="none" stroke={INK} strokeOpacity="0.5" strokeWidth="0.45" />

      {centreLabel && (
        <g textAnchor="middle">
          <text x="50" y={compact ? 49 : 45} fontSize={compact ? 9 : 8} fill={GOLD} fillOpacity="0.9" fontFamily="serif">
            ॐ
          </text>
          <text x="50" y={compact ? 58 : 54} fontSize={compact ? 5.4 : 4.6} fontWeight={700} fill={INK} className="font-display">
            {title}
          </text>
          {subtitle && !compact && (
            <text x="50" y="60" fontSize="3.2" fill={INK} fillOpacity="0.6">
              {subtitle}
            </text>
          )}
        </g>
      )}

      {regions.map((region) => (
        <text
          key={`l${region.sign}`}
          x={region.label.at[0]}
          y={region.label.at[1]}
          textAnchor={region.label.anchor}
          fontSize={chartStyle === 'north' ? (compact ? 4.4 : 3.6) : compact ? 3.8 : 3.1}
          fontWeight={600}
          fill={GOLD}
        >
          {region.label.text}
        </text>
      ))}

      {showLagna && <LagnaMark chartStyle={chartStyle} region={lagnaRegion} compact={compact} />}

      {regions.map((region) => (
        <PlanetCluster key={`p${region.sign}`} region={region} items={bySign.get(region.sign) ?? []} fontSize={fontSize} />
      ))}
    </svg>
  );
}

function LagnaMark({ chartStyle, region, compact }: { chartStyle: ChartStyle; region: Region; compact?: boolean }) {
  const size = compact ? 3.8 : 3;
  if (chartStyle === 'north') {
    return (
      <text x="50" y="11.5" textAnchor="middle" fontSize={size} fontWeight={700} fill={GOLD} letterSpacing="0.3">
        Asc
      </text>
    );
  }
  if (chartStyle === 'south') {
    const [x, y] = region.polygon[0]!;
    return (
      <g>
        <path d={`M${x} ${y + 6} L${x + 6} ${y}`} stroke={GOLD} strokeWidth="0.6" />
        <text x={x + 1.8} y={y + 23} fontSize={size} fontWeight={700} fill={GOLD}>
          Asc
        </text>
      </g>
    );
  }
  const [cx, cy] = region.centre;
  const polygon = region.polygon;
  const isTriangle = polygon.length === 3;
  return (
    <text
      x={cx}
      y={isTriangle ? cy + (cy < 50 ? -5.5 : 7.5) : cy - 8}
      textAnchor="middle"
      fontSize={size}
      fontWeight={700}
      fill={GOLD}
    >
      Asc
    </text>
  );
}
