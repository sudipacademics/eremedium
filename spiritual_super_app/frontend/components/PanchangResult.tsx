'use client';

import type { Panchang } from '@/lib/api';

function formatEnd(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function PanchangResult({ panchang, placeLabel }: { panchang: Panchang; placeLabel: string }) {
  const angas = [
    {
      label: 'Tithi',
      value: panchang.tithi.name,
      detail: panchang.tithi.paksha ? `${panchang.tithi.paksha} paksha` : null,
      end: panchang.tithi.end_utc,
    },
    {
      label: 'Nakshatra',
      value: panchang.nakshatra.name,
      detail: panchang.nakshatra.pada ? `pada ${panchang.nakshatra.pada}` : null,
      end: panchang.nakshatra.end_utc,
    },
    {
      label: 'Yoga',
      value: panchang.yoga.name,
      detail: null,
      end: panchang.yoga.end_utc,
    },
    {
      label: 'Karana',
      value: panchang.karana.name,
      detail: null,
      end: panchang.karana.end_utc,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Vaara</p>
            <p className="text-2xl font-semibold">{panchang.vaara}</p>
            <p className="mt-1 text-sm text-slate-400">
              {placeLabel} · {panchang.date}
            </p>
          </div>
          <div className="text-right text-sm">
            <p>
              <span className="text-slate-500">Sunrise </span>
              <span className="tabular font-medium">{panchang.sunrise.local.slice(0, 5)}</span>
            </p>
            <p>
              <span className="text-slate-500">Sunset </span>
              <span className="tabular font-medium">{panchang.sunset.local.slice(0, 5)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {angas.map((anga) => (
          <div key={anga.label} className="card">
            <p className="text-xs uppercase tracking-wide text-slate-500">{anga.label}</p>
            <p className="mt-1 text-lg font-semibold">{anga.value}</p>
            {anga.detail && <p className="text-xs text-slate-400">{anga.detail}</p>}
            <p className="mt-2 text-xs text-slate-500">
              until {formatEnd(anga.end, panchang.timezone)}
            </p>
          </div>
        ))}
      </div>

      <div className="card flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Surya</p>
          <p className="font-medium">{panchang.sun_sign}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Chandra</p>
          <p className="font-medium">{panchang.moon_sign}</p>
        </div>
      </div>

      <p className="text-center text-[11px] text-slate-600">
        {panchang.ayanamsha_system.replaceAll('_', ' ').toLowerCase()} ayanamsha{' '}
        {panchang.ayanamsha.toFixed(4)}° · evaluated at local sunrise
      </p>
    </div>
  );
}
