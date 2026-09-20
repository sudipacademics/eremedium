import type { DashaPeriod, GocharOutput } from './astro.client.js';
import type { KundaliView } from './kundali.service.js';

/**
 * Compacts a natal + dasha payload into a token-efficient brief for the LLM.
 * Pure function — no env / network imports, safe for unit tests.
 */
export function compactChartBrief(kundali: KundaliView, gocharLines?: readonly string[]): string {
  const { chart, dasha, profile, birthTimeAssumed } = kundali;
  const lines: string[] = [];

  lines.push('ENGINE: Lahiri (Chitra Paksha) ayanamsha, True Node, same Swiss Ephemeris as kundali.');
  if (profile.placeLabel) {
    lines.push(
      `BIRTH: ${profile.birthDate ?? '?'} ${profile.birthTime ?? '(time unknown)'} ${profile.timezone ?? ''} @ ${profile.placeLabel}`,
    );
  }
  if (birthTimeAssumed) {
    lines.push('WARNING: Birth time unknown — chart used assumed noon. Lagna and houses are unreliable.');
  }

  lines.push(
    `LAGNA: ${chart.ascendant.zodiac_sign_name} ` +
      `${chart.ascendant.degrees_in_sign.toFixed(1)}° ` +
      `(${chart.ascendant.nakshatra_name} pada ${chart.ascendant.nakshatra_pada})`,
  );

  lines.push('PLANETS:');
  for (const p of chart.planets) {
    const retro = p.is_retrograde ? ' R' : '';
    lines.push(
      `  ${p.body}: ${p.zodiac_sign_name} ${p.degrees_in_sign.toFixed(1)}°` +
        ` | ${p.nakshatra_name} p${p.nakshatra_pada}` +
        ` | house ${p.house}${retro}`,
    );
  }

  const running = currentPeriod(dasha.periods);
  const runningSub = running ? currentPeriod(running.children) : null;
  if (running) {
    lines.push(
      `CURRENT DASHA: ${running.lord} mahadasha` +
        (runningSub ? ` / ${runningSub.lord} antardasha` : '') +
        ` (${running.start_utc.slice(0, 10)} → ${running.end_utc.slice(0, 10)})`,
    );
  }
  lines.push(
    `MOON NAKSHATRA AT BIRTH: ${dasha.birth_nakshatra_name} (lord ${dasha.birth_nakshatra_lord})`,
  );

  if (gocharLines && gocharLines.length > 0) {
    lines.push('TODAY GOCHAR (transits):');
    for (const line of gocharLines) {
      lines.push(`  ${line}`);
    }
  }

  return lines.join('\n');
}

export function gocharSummary(sky: GocharOutput): string[] {
  return sky.planets.slice(0, 9).map((p) => {
    const retro = p.is_retrograde ? ' R' : '';
    const house =
      p.house_from_natal_lagna !== null
        ? ` natal-h${p.house_from_natal_lagna}`
        : p.house_from_transit_lagna !== null
          ? ` transit-h${p.house_from_transit_lagna}`
          : '';
    return `${p.body}: ${p.zodiac_sign_name}${house}${retro}`;
  });
}

export function currentPeriod(periods: readonly DashaPeriod[]): DashaPeriod | null {
  const now = Date.now();
  return (
    periods.find((period) => {
      const start = Date.parse(period.start_utc);
      const end = Date.parse(period.end_utc);
      return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
    }) ?? null
  );
}
