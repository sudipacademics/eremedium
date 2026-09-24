'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { CHART_STYLES, KundaliChart, type ChartPlacement, type ChartStyle } from '@/components/kundali/KundaliChart';
import {
  CHART_LANGUAGES,
  ENGLISH,
  SANSKRIT,
  chartLanguage,
  grahaNameIn,
  type ChartLanguage,
} from '@/components/kundali/languages';
import { GRAHA_COLOR, SHODASHVARGA, vargaSign, type VargaCode } from '@/components/kundali/vedic';
import type { DashaPeriod, Kundali } from '@/lib/api';

const STYLE_KEY = 'vedsutra.kundali.style';
const LANGUAGE_KEY = 'vedsutra.kundali.language';

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

function useChartStyle(): [ChartStyle, (style: ChartStyle) => void] {
  const [chartStyle, setChartStyle] = useState<ChartStyle>('north');
  useEffect(() => {
    const saved = window.localStorage.getItem(STYLE_KEY);
    if (saved === 'north' || saved === 'south' || saved === 'east') setChartStyle(saved);
  }, []);
  return [
    chartStyle,
    (style) => {
      setChartStyle(style);
      window.localStorage.setItem(STYLE_KEY, style);
    },
  ];
}

function useChartLanguage(): [ChartLanguage, (id: string) => void] {
  const [language, setLanguage] = useState<ChartLanguage>(ENGLISH);
  useEffect(() => {
    const saved = chartLanguage(window.localStorage.getItem(LANGUAGE_KEY));
    if (saved) setLanguage(saved);
  }, []);
  return [
    language,
    (id) => {
      const next = chartLanguage(id) ?? ENGLISH;
      setLanguage(next);
      window.localStorage.setItem(LANGUAGE_KEY, next.id);
    },
  ];
}

export function KundaliView({ kundali, heading }: { kundali: Kundali; heading?: string }) {
  const { chart, dasha, profile, birthTimeAssumed } = kundali;
  const running = currentPeriod(dasha.periods as DashaPeriod[]);
  const runningSub = running ? currentPeriod(running.children) : null;

  const [chartStyle, setChartStyle] = useChartStyle();
  const [language, setLanguage] = useChartLanguage();
  const vernacular = language.id !== 'en';
  const [varga, setVarga] = useState<VargaCode>('D1');
  const mainChartRef = useRef<HTMLDivElement>(null);

  const vargas = useMemo(
    () =>
      SHODASHVARGA.map((info) => ({
        info,
        lagna: vargaSign(chart.ascendant.sidereal_longitude, info.code),
        placements: chart.planets.map<ChartPlacement>((planet) => ({
          body: planet.body,
          sign: vargaSign(planet.sidereal_longitude, info.code),
          retrograde: planet.is_retrograde,
        })),
      })),
    [chart],
  );
  const selected = vargas.find((entry) => entry.info.code === varga)!;

  return (
    <div className="space-y-5">
      {heading && <h2 className="font-display text-2xl font-semibold text-ved-green-900">{heading}</h2>}

      {/*
        Stated plainly rather than hidden in small print. The ascendant moves a degree every four
        minutes, so without a birth time the lagna and every house placement is arbitrary, and a user
        shown one would reasonably believe it.
      */}
      {birthTimeAssumed && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Birth time unknown</p>
          <p className="mt-1 text-xs text-amber-800">
            The chart below was cast for noon. Planetary signs and nakshatras are reliable, but the
            ascendant and all house positions are not — they change completely with the time of day.
            Add a birth time to get a usable kundali.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Lagna">
          <p className="font-display text-xl font-semibold text-ved-green-900">
            {birthTimeAssumed ? '—' : `${chart.ascendant.zodiac_sign_name} ${formatDegrees(chart.ascendant.degrees_in_sign)}`}
          </p>
          {!birthTimeAssumed && (
            <p className="text-xs text-ved-green-800/60">
              {chart.ascendant.nakshatra_name} pada {chart.ascendant.nakshatra_pada}
            </p>
          )}
        </SummaryTile>
        <SummaryTile label="Janma nakshatra">
          <p className="font-display text-xl font-semibold text-ved-green-900">{dasha.birth_nakshatra_name}</p>
          <p className="text-xs text-ved-green-800/60">lord {dasha.birth_nakshatra_lord}</p>
        </SummaryTile>
        <SummaryTile label="Running dasha">
          <p className="font-display text-xl font-semibold text-ved-green-900">
            {running ? `${running.lord}${runningSub ? ` / ${runningSub.lord}` : ''}` : '—'}
          </p>
          {running && (
            <p className="text-xs text-ved-green-800/60">
              until {formatDate(runningSub ? runningSub.end_utc : running.end_utc)}
            </p>
          )}
        </SummaryTile>
      </div>

      <section className="overflow-hidden rounded-3xl border border-ved-gold-500/30 bg-gradient-to-b from-[#FBF7EE] to-[#F1EDE4] shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ved-gold-500/20 px-4 py-4 sm:px-6">
          <div>
            <p
              lang={language.id}
              className={`font-semibold text-ved-gold-700 ${
                vernacular ? 'text-sm' : 'text-[11px] uppercase tracking-[0.2em]'
              }`}
            >
              {language.kundali}
            </p>
            <h3 lang={language.id} className="font-display text-2xl font-semibold text-ved-green-900">
              {language.vargas[selected.info.code]} <span className="text-ved-gold-700">· {selected.info.code}</span>
            </h3>
            <p className="text-xs text-ved-green-800/60">
              {vernacular && <span>{selected.info.name} · </span>}
              {language.vargas[selected.info.code] !== SANSKRIT.vargas[selected.info.code] && (
                <span lang="sa" className="text-ved-gold-700" title="Sanskrit">
                  {SANSKRIT.vargas[selected.info.code]} ·{' '}
                </span>
              )}
              {selected.info.signifies}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-full border border-ved-gold-500/40 bg-white/70 py-1 pl-3 pr-1 text-xs font-medium text-ved-green-800/70">
            <span>Language</span>
            <select
              aria-label="Chart language"
              className="rounded-full bg-ved-cream-100 px-2 py-1 text-xs font-semibold text-ved-green-900 focus:outline-none focus:ring-2 focus:ring-ved-gold-400"
              value={language.id}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {CHART_LANGUAGES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id === 'en' ? 'English' : `${option.endonym} · ${option.english}`}
                </option>
              ))}
            </select>
          </label>
          <div
            role="radiogroup"
            aria-label="Chart style"
            className="inline-flex rounded-full border border-ved-gold-500/40 bg-white/70 p-1 text-xs font-medium"
          >
            {CHART_STYLES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={chartStyle === option.id}
                className={`rounded-full px-3 py-1.5 transition ${
                  chartStyle === option.id
                    ? 'bg-ved-green-800 text-ved-cream-50 shadow'
                    : 'text-ved-green-800/70 hover:text-ved-green-900'
                }`}
                onClick={() => setChartStyle(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          </div>
        </div>

        <div className="-mb-px flex gap-1.5 overflow-x-auto px-4 pt-3 pb-1 sm:px-6" aria-label="Divisional chart">
          {SHODASHVARGA.map((info) => (
            <button
              key={info.code}
              type="button"
              title={`${info.name} — ${info.signifies}`}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold tabular transition ${
                varga === info.code
                  ? 'border-ved-gold-600 bg-ved-gold-500/20 text-ved-green-900'
                  : 'border-ved-green-900/10 bg-white/60 text-ved-green-800/70 hover:border-ved-gold-500/50'
              }`}
              onClick={() => setVarga(info.code)}
            >
              {info.code}
            </button>
          ))}
        </div>

        <div ref={mainChartRef} className="scroll-mt-24 px-4 py-5 sm:px-6">
          <div className={`relative mx-auto max-w-[520px] ${birthTimeAssumed ? 'opacity-60' : ''}`}>
            <KundaliChart
              chartStyle={chartStyle}
              lagnaSign={selected.lagna}
              showLagna={!birthTimeAssumed}
              placements={selected.placements}
              title={`${language.vargas[selected.info.code]} ${selected.info.code}`}
              subtitle={vernacular ? selected.info.name : 'Vedsutra'}
              language={language}
            />
          </div>
          {birthTimeAssumed && (
            <p className="mt-2 text-center text-xs font-medium text-amber-800">House positions need a birth time</p>
          )}

          <ChartLegend language={language} />

          <p className="mt-3 text-center text-[11px] text-ved-green-800/50">
            {profile.placeLabel} · {profile.birthDate}
            {profile.birthTime ? ` ${profile.birthTime}` : ''} {profile.utcOffset}
          </p>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ved-gold-700">Shodashvarga</p>
          <h3 className="font-display text-xl font-semibold text-ved-green-900">The sixteen divisional charts</h3>
          <p className="text-xs text-ved-green-800/60">
            Parashara&apos;s sixteen vargas, each a finer division of the signs that is read for one area of
            life. Tap a chart to open it above.
            {birthTimeAssumed && ' The finer vargas shift within minutes, so they need an accurate birth time.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {vargas.map(({ info, lagna, placements }) => (
            <button
              key={info.code}
              type="button"
              className={`group rounded-2xl border p-2 text-left transition ${
                varga === info.code
                  ? 'border-ved-gold-500 bg-ved-gold-500/10 shadow-sm'
                  : 'border-ved-green-900/10 bg-white/60 hover:border-ved-gold-500/60 hover:shadow-sm'
              }`}
              onClick={() => {
                setVarga(info.code);
                mainChartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <div className={birthTimeAssumed ? 'opacity-60' : ''}>
                <KundaliChart
                  chartStyle={chartStyle}
                  lagnaSign={lagna}
                  showLagna={!birthTimeAssumed}
                  placements={placements}
                  title={info.code}
                  compact
                  language={language}
                />
              </div>
              <p className="mt-1.5 px-1 text-sm font-semibold text-ved-green-900">
                <span lang={language.id}>{language.vargas[info.code]}</span>{' '}
                <span className="text-ved-gold-700">{info.code}</span>
              </p>
              <p className="px-1 text-[11px] text-ved-green-800/70">
                {vernacular && <span>{info.name} · </span>}
                {language.vargas[info.code] !== SANSKRIT.vargas[info.code] && (
                  <span lang="sa">{SANSKRIT.vargas[info.code]}</span>
                )}
              </p>
              <p className="px-1 text-[11px] leading-snug text-ved-green-800/60">{info.signifies}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="mb-1 font-display text-xl font-semibold text-ved-green-900">Varga positions</h3>
        <p className="mb-3 text-xs text-ved-green-800/60">The sign each graha occupies in every divisional chart.</p>
        <div className="overflow-x-auto">
          <table lang={language.id} className="w-full min-w-[720px] whitespace-nowrap text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wide text-ved-green-800/50">
                <th className="sticky left-0 bg-white pb-2 pr-3 font-medium">Graha</th>
                {SHODASHVARGA.map((info) => (
                  <th key={info.code} className="pb-2 px-1 text-center font-medium tabular">
                    {info.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ved-green-900/5">
              <tr>
                <td className="sticky left-0 bg-white py-1.5 pr-3 font-semibold text-ved-gold-700">
                  {vernacular ? language.lagna : 'Lagna'}
                </td>
                {vargas.map(({ info, lagna }) => (
                  <td key={info.code} className="px-1 py-1.5 text-center text-ved-green-900">
                    {birthTimeAssumed ? '—' : language.signs[lagna - 1]}
                  </td>
                ))}
              </tr>
              {chart.planets.map((planet, index) => (
                <tr key={planet.body}>
                  <td
                    className="sticky left-0 bg-white py-1.5 pr-3 font-semibold"
                    style={{ color: GRAHA_COLOR[planet.body] }}
                  >
                    {grahaNameIn(language, planet.body)}
                  </td>
                  {vargas.map(({ info, placements }) => (
                    <td key={info.code} className="px-1 py-1.5 text-center text-ved-green-800">
                      {language.signs[placements[index]!.sign - 1]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3 className="mb-2 font-display text-xl font-semibold text-ved-green-900">Graha positions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ved-green-800/50">
                <th className="pb-2 pr-2 font-medium">Graha</th>
                <th className="pb-2 pr-2 font-medium">Rasi</th>
                <th className="pb-2 pr-2 text-right font-medium">Degree</th>
                <th className="pb-2 pr-2 font-medium">Nakshatra</th>
                <th className="pb-2 text-right font-medium">Bhava</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ved-green-900/5">
              {chart.planets.map((planet) => (
                <tr key={planet.body}>
                  <td className="py-1.5 pr-2 font-semibold" style={{ color: GRAHA_COLOR[planet.body] }}>
                    {planet.body}
                    {planet.is_retrograde && (
                      <span className="ml-1 text-xs text-rose-700" title="Retrograde">
                        ℞
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-ved-green-900">{planet.zodiac_sign_name}</td>
                  <td className="tabular py-1.5 pr-2 text-right text-ved-green-800">
                    {formatDegrees(planet.degrees_in_sign)}
                  </td>
                  <td className="py-1.5 pr-2 text-ved-green-800/80">
                    {planet.nakshatra_name} <span className="text-ved-green-800/40">{planet.nakshatra_pada}</span>
                  </td>
                  <td className="tabular py-1.5 text-right text-ved-green-800">
                    {birthTimeAssumed ? '—' : planet.house}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3 className="mb-2 font-display text-xl font-semibold text-ved-green-900">Vimshottari dasha</h3>

        {running ? (
          <div className="mb-3 rounded-xl border border-ved-gold-500/30 bg-ved-gold-500/10 px-3 py-2">
            <p className="text-sm text-ved-green-900">
              <span className="font-semibold">{running.lord}</span>
              {runningSub && <span className="text-ved-green-800/70"> / {runningSub.lord}</span>}
              <span className="ml-2 text-xs text-ved-gold-700">running now</span>
            </p>
            <p className="text-xs text-ved-green-800/60">
              until {formatDate(runningSub ? runningSub.end_utc : running.end_utc)}
            </p>
          </div>
        ) : null}

        <ol className="space-y-1">
          {dasha.periods.map((period) => (
            <MahadashaRow key={`${period.lord}:${period.start_utc}`} period={period} running={running} />
          ))}
        </ol>
      </section>

      <p className="text-center text-[11px] text-ved-green-800/50">
        {chart.ayanamsha_system.replaceAll('_', ' ').toLowerCase()} ayanamsha{' '}
        {chart.ayanamsha.toFixed(4)}° · {chart.node_type.replaceAll('_', ' ').toLowerCase()}
      </p>
    </div>
  );
}

function SummaryTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ved-gold-700">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ChartLegend({ language }: { language: ChartLanguage }) {
  return (
    <div
      lang={language.id}
      className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-ved-green-800/70"
    >
      {Object.entries(GRAHA_COLOR).map(([body, color]) => (
        <span key={body} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {grahaNameIn(language, body)}
          {language.id !== 'en' && <span className="text-ved-green-800/40">({body})</span>}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <sup className="font-semibold">{language.retro}</sup> retrograde
        {language.id !== 'en' && ' (vakri)'}
      </span>
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
          isRunning ? 'bg-ved-green-50 text-ved-green-900' : 'text-ved-green-800 hover:bg-ved-cream-100'
        }`}
        onClick={() => setOpen((value) => !value)}
        disabled={!hasChildren}
      >
        <span className={isRunning ? 'font-semibold' : ''}>
          {hasChildren && <span className="mr-1 text-xs text-ved-green-800/40">{open ? '−' : '+'}</span>}
          {period.lord}
        </span>
        <span className="tabular text-xs text-ved-green-800/60">
          {formatDate(period.start_utc)} – {formatDate(period.end_utc)}
        </span>
      </button>

      {open && hasChildren && (
        <ul className="ml-4 border-l border-ved-gold-500/30 pl-3">
          {period.children.map((child) => (
            <li
              key={`${child.lord}:${child.start_utc}`}
              className="flex items-center justify-between gap-2 py-1 text-xs"
            >
              <span className="text-ved-green-800">{child.lord}</span>
              <span className="tabular text-ved-green-800/50">
                {formatDate(child.start_utc)} – {formatDate(child.end_utc)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
