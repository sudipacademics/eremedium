import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = await import('../src/config/env.js');
const {
  FestivalProviderError,
  FestivalRangeError,
  FestivalService,
  FestivalsNotConfiguredError,
  fetchFestivalCalendar,
  normaliseFestivals,
  toIsoDate,
} = await import('../src/services/festival.service.js');

const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { ...mutableEnv };

function reply(status: number, body: unknown) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('normaliseFestivals', () => {
  it('reads the live engine shape: drops the vrat twin of a named Ekadashi, names tithis, tidies names', () => {
    const festivals = normaliseFestivals({
      data: {
        from: '2026-10-01',
        to: '2026-11-15',
        count: 5,
        festivals: [
          { family: 'vrat', date: '2026-10-03', name: 'Masik Kalashtami', key: 'masik_kalashtami', tithi_number: 23 },
          { family: 'vrat', date: '2026-10-06', name: 'Krishna Ekadashi', key: 'ekadashi_krishna', tithi_number: 26 },
          { family: 'ekadashi', date: '2026-10-06', name: 'Indira Ekadashi', key: 'indira_ekadashi', from_vrat: 'ekadashi_krishna' },
          { family: 'vrat', date: '2026-10-22', name: 'Shukla Ekadashi', key: 'ekadashi_shukla', tithi_number: 11 },
          {
            family: 'lunar',
            date: '2026-11-08',
            name: 'Diwali (Kartika Amavasya purnimanta / Aswina Amavasya amanta)',
            key: 'diwali',
          },
        ],
        no_date: [{ family: 'lunar', name: 'Raksha Bandhan (Shravana Purnima)', key: 'raksha_bandhan' }],
        not_included: [{ family: 'regional', needs: 'region', detail: 'pass a region' }],
      },
    });

    expect(festivals.map((f) => `${f.date} ${f.name}`)).toEqual([
      '2026-10-03 Masik Kalashtami',
      '2026-10-06 Indira Ekadashi',
      '2026-10-22 Shukla Ekadashi',
      '2026-11-08 Diwali',
    ]);
    expect(festivals[0]).toMatchObject({ category: 'vrat', tithi: 'Krishna Ashtami' });
    expect(festivals[2]!.tithi).toBe('Shukla Ekadashi');
    expect(festivals[3]!.description).toBe('Kartika Amavasya purnimanta / Aswina Amavasya amanta');
  });

  it('reads a flat list with object names, tithi and anchor', () => {
    const festivals = normaliseFestivals({
      data: {
        festivals: [
          {
            key: 'diwali',
            date: '2026-11-08',
            name: { key: 'diwali', name: 'Diwali' },
            local_name: 'दीपावली',
            category: 'major',
            tithi: { name: 'Amavasya', paksha: { key: 'krishna', name: 'Krishna' } },
            anchor: { rule: 'pradosh', name: 'Pradosh vyapini' },
            details: { description: 'Festival of lights.' },
          },
          { date: { year: 2026, month: 10, day: 20 }, name: 'Dussehra', type: 'major' },
        ],
      },
    });

    expect(festivals).toEqual([
      { date: '2026-10-20', name: 'Dussehra', category: 'major' },
      {
        date: '2026-11-08',
        name: 'Diwali',
        localName: 'दीपावली',
        description: 'Festival of lights.',
        category: 'major',
        tithi: 'Krishna Amavasya',
        anchor: 'Pradosh vyapini',
        key: 'diwali',
      },
    ]);
  });

  it('flattens per-day groups and keeps a day date for nested names', () => {
    const festivals = normaliseFestivals({
      data: {
        days: [
          { date: '2026-10-11T06:15:00+05:30', festivals: [{ name: 'Navaratri begins' }, 'Ghatasthapana'] },
          { date: '2026-10-12', events: [] },
        ],
        provider: 'de440',
      },
    });
    expect(festivals.map((f) => [f.date, f.name])).toEqual([
      ['2026-10-11', 'Ghatasthapana'],
      ['2026-10-11', 'Navaratri begins'],
    ]);
  });

  it('prefers the English name and keeps the localised one, drops undated entries and duplicates', () => {
    const festivals = normaliseFestivals(
      {
        data: [
          { date: '2026-10-02', name: 'गांधी जयंती', name_en: 'Gandhi Jayanti' },
          { date: '2026-10-02', name: 'गांधी जयंती', name_en: 'Gandhi Jayanti' },
          { name: 'No date at all' },
          { date: '2026-09-30', name: 'Outside the range' },
        ],
      },
      '2026-10-01',
      '2026-10-31',
    );
    expect(festivals).toEqual([{ date: '2026-10-02', name: 'Gandhi Jayanti', localName: 'गांधी जयंती' }]);
  });

  it('does not mistake panchang angas for festivals', () => {
    expect(
      normaliseFestivals({ data: { date: '2026-10-02', panchang: { tithi: { name: 'Ekadashi' } } } }),
    ).toEqual([]);
  });

  it('parses the supported date forms', () => {
    expect(toIsoDate('2026-03-15')).toBe('2026-03-15');
    expect(toIsoDate('2026-03-15T23:59:00+05:30')).toBe('2026-03-15');
    expect(toIsoDate({ year: 2026, month: 3, day: 5 })).toBe('2026-03-05');
    expect(toIsoDate('2026-02-30')).toBeUndefined();
    expect(toIsoDate(15)).toBeUndefined();
  });
});

describe('Kalia Panjika client', () => {
  beforeEach(() => {
    Object.assign(mutableEnv, {
      KALIAPANJIKA_API_KEY: 'test-kp-key-123456',
      KALIAPANJIKA_API_BASE: 'https://api.kaliapanjika.test',
      KALIAPANJIKA_REGION: undefined,
    });
    FestivalService.clearCache();
  });

  afterEach(() => {
    Object.assign(mutableEnv, saved);
    vi.unstubAllGlobals();
    FestivalService.clearCache();
  });

  it('sends every required convention with the key only in the Authorization header', async () => {
    const fetchMock = reply(200, { data: { festivals: [{ date: '2026-10-20', name: 'Dussehra' }] } });
    vi.stubGlobal('fetch', fetchMock);

    const festivals = await fetchFestivalCalendar('2026-10-01', '2026-10-31', 'en');

    expect(festivals).toEqual([{ date: '2026-10-20', name: 'Dussehra' }]);
    const [url, init] = fetchMock.mock.calls[0]! as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://api.kaliapanjika.test/v1/festival/calendar');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'from.year': '2026',
      'from.month': '10',
      'from.day': '1',
      'to.year': '2026',
      'to.month': '10',
      'to.day': '31',
      tz_hours: '5.5',
      lat: '28.6139',
      lon: '77.209',
      provider: 'de440',
      ayanamsha: 'lahiri_true',
      sunrise_convention: 'upper_limb',
      locale: 'en',
      include: 'details',
    });
    expect(url.toString()).not.toContain('test-kp-key-123456');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-kp-key-123456');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes a configured region through', async () => {
    mutableEnv.KALIAPANJIKA_REGION = 'north_purnimanta';
    const fetchMock = reply(200, { data: { festivals: [] } });
    vi.stubGlobal('fetch', fetchMock);
    await fetchFestivalCalendar('2026-10-01', '2026-10-31', 'hi');
    const [url] = fetchMock.mock.calls[0]! as [URL];
    expect(url.searchParams.get('region')).toBe('north_purnimanta');
    expect(url.searchParams.get('locale')).toBe('hi');
  });

  it('hides vendor errors behind a generic 502', async () => {
    vi.stubGlobal('fetch', reply(402, { error: { code: 'CREDITS_EXHAUSTED', detail: 'monthly pool spent' } }));
    const error = (await fetchFestivalCalendar('2026-10-01', '2026-10-31', 'en').catch((e: unknown) => e)) as InstanceType<
      typeof FestivalProviderError
    >;
    expect(error).toBeInstanceOf(FestivalProviderError);
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe('The festival calendar is unavailable right now. Please try again shortly.');
    expect(error.detail).toContain('CREDITS_EXHAUSTED');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const network = (await fetchFestivalCalendar('2026-10-01', '2026-10-31', 'en').catch((e: unknown) => e)) as InstanceType<
      typeof FestivalProviderError
    >;
    expect(network).toBeInstanceOf(FestivalProviderError);
    expect(network.detail).toContain('ECONNRESET');

    vi.stubGlobal('fetch', reply(200, '<html>oops</html>'));
    await expect(fetchFestivalCalendar('2026-10-01', '2026-10-31', 'en')).rejects.toThrow(FestivalProviderError);
  });

  it('answers 503 without calling the vendor when no key is configured', async () => {
    mutableEnv.KALIAPANJIKA_API_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = (await FestivalService.forMonth('2026-10', 'en').catch((e: unknown) => e)) as InstanceType<
      typeof FestivalsNotConfiguredError
    >;
    expect(error).toBeInstanceOf(FestivalsNotConfiguredError);
    expect(error.statusCode).toBe(503);
    expect(error.message).toBe('Festival calendar is not configured');
    await expect(FestivalService.upcoming(5)).rejects.toThrow(FestivalsNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches each month and serves upcoming festivals from this month and the next', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
      const month = url.searchParams.get('from.month');
      const festivals =
        month === '9'
          ? [
              { date: '2026-09-20', name: 'Past festival' },
              { date: '2026-09-28', name: 'Late September' },
            ]
          : [{ date: '2026-10-20', name: 'Dussehra' }];
      return new Response(JSON.stringify({ data: { festivals } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const now = new Date('2026-09-26T06:00:00Z');

    const september = await FestivalService.forMonth('2026-09', 'en', now);
    expect(september).toMatchObject({ month: '2026-09', from: '2026-09-01', to: '2026-09-30', today: '2026-09-26' });
    expect(september.festivals).toHaveLength(2);

    const upcoming = await FestivalService.upcoming(5, 'en', now);
    expect(upcoming.festivals.map((f) => f.name)).toEqual(['Late September', 'Dussehra']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await FestivalService.forMonth('2026-09', 'en', now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses months far from today and does not cache failures', async () => {
    const now = new Date('2026-09-26T06:00:00Z');
    await expect(FestivalService.forMonth('2031-01', 'en', now)).rejects.toThrow(FestivalRangeError);

    vi.stubGlobal('fetch', reply(500, 'boom'));
    await expect(FestivalService.forMonth('2026-10', 'en', now)).rejects.toThrow(FestivalProviderError);
    const recovered = reply(200, { data: { festivals: [{ date: '2026-10-20', name: 'Dussehra' }] } });
    vi.stubGlobal('fetch', recovered);
    const result = await FestivalService.forMonth('2026-10', 'en', now);
    expect(result.festivals).toHaveLength(1);
    expect(recovered).toHaveBeenCalledTimes(1);
  });
});
