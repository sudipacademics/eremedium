'use client';

import { useState } from 'react';

import { RasiChart } from '@/components/RasiChart';
import type { DashaPeriod, Kundali } from '@/lib/api';

function formatDegrees(value: number): string {
  const degrees = Math.floor(value);
  const minutes = Math.floor((value - degrees) * 60);
  return `${degrees}°${String(minutes).padStart(2, '0')}'`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Finds the period containing now, at any level, so the reading opens on what is current. */
function currentPeriod(periods: DashaPeriod[]): DashaPeriod | null {
  const now = Date.now();
  return (
    periods.find(
      (period) => new Date(period.start_utc).getTime() <= now && now < new Date(period.end_utc).getTime(),
    ) ?? null
  );
}

export function KundaliView({ kundali, heading }: { kundali: Kundali; heading?: string }) {
  const { chart, dasha, profile, birthTimeAssumed } = kundali;
  const running = currentPeriod(dasha.periods as DashaPeriod[]);
  const runningSub = running ? currentPeriod(running.children) : null;

  return (
    <div className="space-y-4">
      {heading && <h2 className="font-semibold">{heading}</h2>}

      {/*
        Stated plainly rather than hidden in small print. The ascendant moves a degree every four
        minutes, so without a birth time the lagna and every house placement is arbitrary, and a user
        shown one would reasonably believe it.
      */}
      {birthTimeAssumed && (
        <div className="card border-amber-400/30 bg-amber-500/10">
          <p className="text-sm font-medium text-amber-100">Birth time unknown</p>
          <p className="mt-1 text-xs text-amber-200/80">
            The chart below was cast for noon. Planetary signs and nakshatras are reliable, but the
            ascendant and all house positions are not — they change completely with the time of day.
            Add a birth time to get a usable kundali.
          </p>
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Lagna</p>
            <p className="font-semibold">
              {birthTimeAssumed ? '—' : `${chart.ascendant.zodiac_sign_name} ${formatDegrees(chart.ascendant.degrees_in_sign)}`}
            </p>
            {!birthTimeAssumed && (
              <p className="text-xs text-slate-400">
                {chart.ascendant.nakshatra_name} pada {chart.ascendant.nakshatra_pada}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Janma nakshatra</p>
            <p className="font-semibold">{dasha.birth_nakshatra_name}</p>
            <p className="text-xs text-slate-400">lord {dasha.birth_nakshatra_lord}</p>
          </div>
        </div>

        <RasiChart
          ascendant={chart.ascendant}
          planets={chart.planets}
          unreliable={birthTimeAssumed}
        />

        <p className="text-center text-[11px] text-slate-500">
          {profile.placeLabel} · {profile.birthDate}
          {profile.birthTime ? ` ${profile.birthTime}` : ''} {profile.utcOffset}
        </p>
      </div>

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold">Graha positions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-2 font-medium">Graha</th>
                <th className="pb-2 pr-2 font-medium">Rasi</th>
                <th className="pb-2 pr-2 text-right font-medium">Degree</th>
                <th className="pb-2 pr-2 font-medium">Nakshatra</th>
                <th className="pb-2 text-right font-medium">Bhava</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {chart.planets.map((planet) => (
                <tr key={planet.body}>
                  <td className="py-1.5 pr-2 font-medium">
                    {planet.body}
                    {planet.is_retrograde && (
                      <span className="ml-1 text-xs text-rose-300" title="Retrograde">
                        ↺
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-300">{planet.zodiac_sign_name}</td>
                  <td className="tabular py-1.5 pr-2 text-right text-slate-300">
                    {formatDegrees(planet.degrees_in_sign)}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-400">
                    {planet.nakshatra_name} <span className="text-slate-600">{planet.nakshatra_pada}</span>
                  </td>
                  <td className="tabular py-1.5 text-right text-slate-300">
                    {birthTimeAssumed ? '—' : planet.house}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold">Vimshottari dasha</h3>

        {running ? (
          <div className="mb-3 rounded-lg bg-saffron-500/10 px-3 py-2">
            <p className="text-sm">
              <span className="font-semibold">{running.lord}</span>
              {runningSub && <span className="text-slate-300"> / {runningSub.lord}</span>}
              <span className="ml-2 text-xs text-saffron-200">running now</span>
            </p>
            <p className="text-xs text-slate-400">
              until {formatDate(runningSub ? runningSub.end_utc : running.end_utc)}
            </p>
          </div>
        ) : null}

        <ol className="space-y-1">
          {dasha.periods.map((period) => (
            <MahadashaRow key={`${period.lord}:${period.start_utc}`} period={period} running={running} />
          ))}
        </ol>
      </div>

      <p className="text-center text-[11px] text-slate-600">
        {chart.ayanamsha_system.replaceAll('_', ' ').toLowerCase()} ayanamsha{' '}
        {chart.ayanamsha.toFixed(4)}° · {chart.node_type.replaceAll('_', ' ').toLowerCase()}
      </p>
    </div>
  );
}

function MahadashaRow({ period, running }: { period: DashaPeriod; running: DashaPeriod | null }) {
  const [open, setOpen] = useState(false);
  const isRunning = running !== null && running.start_utc === period.start_utc;
  const hasChildren = period.children.length > 0;

  return (
    <li>
      <button
        type="button"
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
          isRunning ? 'bg-white/10' : 'hover:bg-white/5'
        }`}
        onClick={() => setOpen((value) => !value)}
        disabled={!hasChildren}
      >
        <span className={isRunning ? 'font-semibold' : ''}>
          {hasChildren && <span className="mr-1 text-xs text-slate-500">{open ? '−' : '+'}</span>}
          {period.lord}
        </span>
        <span className="tabular text-xs text-slate-400">
          {formatDate(period.start_utc)} – {formatDate(period.end_utc)}
        </span>
      </button>

      {open && hasChildren && (
        <ul className="ml-4 border-l border-white/10 pl-3">
          {period.children.map((child) => (
            <li
              key={`${child.lord}:${child.start_utc}`}
              className="flex items-center justify-between gap-2 py-1 text-xs"
            >
              <span className="text-slate-300">{child.lord}</span>
              <span className="tabular text-slate-500">
                {formatDate(child.start_utc)} – {formatDate(child.end_utc)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
