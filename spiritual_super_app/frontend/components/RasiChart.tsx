'use client';

import type { ChartAscendant, ChartPlanet } from '@/lib/api';

const SIGN_SHORT = [
  'Ar',
  'Ta',
  'Ge',
  'Cn',
  'Le',
  'Vi',
  'Li',
  'Sc',
  'Sg',
  'Cp',
  'Aq',
  'Pi',
];

const GRAHA_SHORT: Record<string, string> = {
  Sun: 'Su',
  Moon: 'Mo',
  Mars: 'Ma',
  Mercury: 'Me',
  Jupiter: 'Ju',
  Venus: 'Ve',
  Saturn: 'Sa',
  Rahu: 'Ra',
  Ketu: 'Ke',
};

/*
 * The North Indian diamond: house positions are fixed on the page and the SIGNS rotate, so the first
 * house is always the top-centre diamond. Each entry is the centre of a house box as a percentage of
 * the square, in house order 1..12 running anticlockwise.
 */
const HOUSE_CENTRES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 50, y: 22 },
  { x: 26, y: 10 },
  { x: 10, y: 26 },
  { x: 24, y: 50 },
  { x: 10, y: 74 },
  { x: 26, y: 90 },
  { x: 50, y: 78 },
  { x: 74, y: 90 },
  { x: 90, y: 74 },
  { x: 76, y: 50 },
  { x: 90, y: 26 },
  { x: 74, y: 10 },
];

/**
 * The rasi chart, drawn in the North Indian style.
 *
 * The houses are fixed and the signs rotate with the ascendant, which is why every box carries its
 * sign abbreviation: without it the chart is unreadable to anyone checking it against other software.
 */
export function RasiChart({
  ascendant,
  planets,
  unreliable,
}: {
  ascendant: ChartAscendant;
  planets: ChartPlanet[];
  /** When the birth time is unknown the houses are meaningless, so the chart is visibly marked. */
  unreliable?: boolean;
}) {
  const lagnaSign = ascendant.zodiac_sign;

  const byHouse = new Map<number, ChartPlanet[]>();
  for (const planet of planets) {
    const existing = byHouse.get(planet.house) ?? [];
    existing.push(planet);
    byHouse.set(planet.house, existing);
  }

  return (
    <div className="relative">
      <svg
        viewBox="0 0 100 100"
        className={`w-full ${unreliable ? 'opacity-50' : ''}`}
        role="img"
        aria-label="Rasi chart"
      >
        <rect x="1" y="1" width="98" height="98" fill="none" stroke="currentColor" strokeOpacity="0.25" />
        {/* The two diagonals and the inner diamond that together make the twelve houses. */}
        <path
          d="M1 1 L99 99 M99 1 L1 99 M50 1 L1 50 L50 99 L99 50 Z"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
        />

        {HOUSE_CENTRES.map((centre, index) => {
          const house = index + 1;
          // Whole-sign houses: the sign in house n is n-1 signs after the Lagna sign.
          const sign = ((lagnaSign - 1 + index) % 12) + 1;
          const occupants = byHouse.get(house) ?? [];

          return (
            <g key={house}>
              <text
                x={centre.x}
                y={centre.y - 3}
                textAnchor="middle"
                fontSize="3.6"
                fill="currentColor"
                fillOpacity="0.45"
              >
                {SIGN_SHORT[sign - 1]}
                {house === 1 ? ' ·' : ''}
              </text>
              {occupants.map((planet, row) => (
                <text
                  key={planet.body}
                  x={centre.x}
                  y={centre.y + 2 + row * 4.4}
                  textAnchor="middle"
                  fontSize="4.2"
                  fill="currentColor"
                  fontWeight={600}
                >
                  {GRAHA_SHORT[planet.body] ?? planet.body.slice(0, 2)}
                  {planet.is_retrograde ? '↺' : ''}
                </text>
              ))}
            </g>
          );
        })}
      </svg>

      {unreliable && (
        <p className="absolute inset-x-0 bottom-1 text-center text-[11px] text-amber-200">
          House positions need a birth time
        </p>
      )}
    </div>
  );
}
