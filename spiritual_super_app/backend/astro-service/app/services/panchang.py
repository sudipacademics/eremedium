"""Daily panchanga: the five angas plus sunrise and sunset.

Tithi, nakshatra, yoga and karana are pure functions of the Lahiri sidereal longitudes of the Sun
and Moon. Sunrise and sunset are the apparent disc-centre events Swiss Ephemeris computes for the
requested place. The civil day is interpreted in the place's own IANA zone, and the angas are
evaluated at local sunrise -- the traditional start of a Vedic day -- with end times searched
forward from there.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Final
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import swisseph as swe

from ..schemas import PanchangaAnga, PanchangRequest, PanchangResponse, SunEvent
from .ephemeris import (
    CALC_FLAGS,
    NAKSHATRA_ARC,
    SIGN_NAMES,
    _SWE_LOCK,
    initialise_ephemeris,
    julian_day_ut,
    nakshatra_of,
    normalise_degrees,
    sign_index,
)

TITHI_NAMES: Final[tuple[str, ...]] = (
    "Pratipada",
    "Dwitiya",
    "Tritiya",
    "Chaturthi",
    "Panchami",
    "Shashthi",
    "Saptami",
    "Ashtami",
    "Navami",
    "Dashami",
    "Ekadashi",
    "Dwadashi",
    "Trayodashi",
    "Chaturdashi",
    "Purnima",
    "Pratipada",
    "Dwitiya",
    "Tritiya",
    "Chaturthi",
    "Panchami",
    "Shashthi",
    "Saptami",
    "Ashtami",
    "Navami",
    "Dashami",
    "Ekadashi",
    "Dwadashi",
    "Trayodashi",
    "Chaturdashi",
    "Amavasya",
)

YOGA_NAMES: Final[tuple[str, ...]] = (
    "Vishkambha",
    "Priti",
    "Ayushman",
    "Saubhagya",
    "Shobhana",
    "Atiganda",
    "Sukarma",
    "Dhriti",
    "Shula",
    "Ganda",
    "Vriddhi",
    "Dhruva",
    "Vyaghata",
    "Harshana",
    "Vajra",
    "Siddhi",
    "Vyatipata",
    "Variyan",
    "Parigha",
    "Shiva",
    "Siddha",
    "Sadhya",
    "Shubha",
    "Shukla",
    "Brahma",
    "Indra",
    "Vaidhriti",
)

KARANA_NAMES: Final[tuple[str, ...]] = (
    "Bava",
    "Balava",
    "Kaulava",
    "Taitila",
    "Gara",
    "Vanija",
    "Vishti",
    "Shakuni",
    "Chatushpada",
    "Naga",
    "Kimstughna",
)

# Indexed by datetime.weekday(): Monday=0 … Sunday=6.
WEEKDAY_NAMES: Final[tuple[str, ...]] = (
    "Somavara",
    "Mangalavara",
    "Budhavara",
    "Guruvara",
    "Shukravara",
    "Shanivara",
    "Ravivara",
)

TITHI_ARC: Final[float] = 12.0
YOGA_ARC: Final[float] = NAKSHATRA_ARC
KARANA_ARC: Final[float] = 6.0
_SEARCH_DAYS: Final[float] = 2.5


class PanchangError(ValueError):
    """Raised for an unusable place, date or timezone."""


def _require_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise PanchangError(f'Unknown timezone "{name}"') from exc


def _sidereal_sun_moon(jd_ut: float) -> tuple[float, float]:
    """Return (sun_long, moon_long) under Lahiri sidereal."""
    with _SWE_LOCK:
        swe.set_sid_mode(swe.SIDM_LAHIRI, 0.0, 0.0)
        sun, sun_flag = swe.calc_ut(jd_ut, swe.SUN, CALC_FLAGS)
        moon, moon_flag = swe.calc_ut(jd_ut, swe.MOON, CALC_FLAGS)
        if sun_flag < 0 or moon_flag < 0:
            raise RuntimeError(
                f"Swiss Ephemeris failed for luminaries (sun={sun_flag}, moon={moon_flag})"
            )
        return normalise_degrees(sun[0]), normalise_degrees(moon[0])


def _elongation(moon: float, sun: float) -> float:
    return normalise_degrees(moon - sun)


def _tithi_of(elongation: float) -> tuple[int, str, str]:
    index = int(elongation // TITHI_ARC)
    paksha = "Shukla" if index < 15 else "Krishna"
    return index + 1, TITHI_NAMES[index], paksha


def _yoga_of(sun: float, moon: float) -> tuple[int, str]:
    index = int(normalise_degrees(sun + moon) // YOGA_ARC)
    return index + 1, YOGA_NAMES[index]


def _karana_of(elongation: float) -> tuple[int, str]:
    """Half-tithi karana.

    Kimstughna opens Shukla Pratipada; the seven movable karanas then cycle; Shakuni, Chatushpada
    and Naga close the dark fortnight.
    """
    half = int(elongation // KARANA_ARC)
    if half == 0:
        name = "Kimstughna"
    elif half >= 57:
        name = KARANA_NAMES[7 + (half - 57)]
    else:
        name = KARANA_NAMES[(half - 1) % 7]
    return half + 1, name


def _jd_to_utc(jd_ut: float) -> datetime:
    year, month, day, hour_frac = swe.revjul(jd_ut, swe.GREG_CAL)
    hours = int(hour_frac)
    minutes_frac = (hour_frac - hours) * 60.0
    minutes = int(minutes_frac)
    seconds = (minutes_frac - minutes) * 60.0
    whole_seconds = int(seconds)
    micros = int(round((seconds - whole_seconds) * 1_000_000))
    if micros >= 1_000_000:
        whole_seconds += 1
        micros = 0
    return datetime(year, month, day, hours, minutes, whole_seconds, micros, tzinfo=timezone.utc)


def _rise_set(jd_day: float, latitude: float, longitude: float, *, rising: bool) -> float:
    """Julian day of the next sunrise or sunset at the place, searching from jd_day."""
    geopos = (longitude, latitude, 0.0)
    rsmi = (swe.CALC_RISE if rising else swe.CALC_SET) | swe.BIT_DISC_CENTER

    with _SWE_LOCK:
        result = swe.rise_trans(
            jd_day,
            swe.SUN,
            rsmi,
            geopos,
            0.0,
            0.0,
            swe.FLG_SWIEPH,
        )

    if isinstance(result, tuple) and len(result) == 2:
        retflag, times = result
        jd_event = times[0] if isinstance(times, (list, tuple)) else times
    else:
        retflag, jd_event = -1, result

    if int(retflag) < 0:
        kind = "sunrise" if rising else "sunset"
        raise PanchangError(f"Could not compute {kind} at this latitude (polar day/night)")
    return float(jd_event)


def _find_crossing(
    start_jd: float,
    angle_at: Callable[[float], float],
    boundary: float,
    *,
    period: float,
) -> float:
    """Binary-search the next time `angle_at(jd) % period` reaches `boundary`."""

    def phase(jd: float) -> float:
        return angle_at(jd) % period

    start_phase = phase(start_jd)
    remaining = (boundary - start_phase) % period
    if remaining < 1e-9:
        remaining = period

    lo = start_jd
    hi = start_jd + _SEARCH_DAYS
    if (phase(hi) - start_phase) % period < remaining - 1e-6:
        hi = start_jd + 4.0

    for _ in range(48):
        mid = (lo + hi) / 2.0
        travelled = (phase(mid) - start_phase) % period
        if travelled < remaining:
            lo = mid
        else:
            hi = mid
    return hi


def compute_panchang(request: PanchangRequest) -> PanchangResponse:
    initialise_ephemeris()
    zone = _require_zone(request.timezone)

    # Noon on the civil date, in the place's zone, seeds the sunrise search. Searching from local
    # midnight can land on the previous day's sunrise near the dateline.
    local_noon = datetime(
        request.date.year,
        request.date.month,
        request.date.day,
        12,
        0,
        0,
        tzinfo=zone,
    )
    seed_jd = julian_day_ut(local_noon) - 0.5

    sunrise_jd = _rise_set(seed_jd, request.latitude, request.longitude, rising=True)
    sunset_jd = _rise_set(sunrise_jd + 1e-4, request.latitude, request.longitude, rising=False)
    next_sunrise_jd = _rise_set(sunrise_jd + 0.5, request.latitude, request.longitude, rising=True)

    sunrise_utc = _jd_to_utc(sunrise_jd)
    sunset_utc = _jd_to_utc(sunset_jd)
    sunrise_local = sunrise_utc.astimezone(zone)
    sunset_local = sunset_utc.astimezone(zone)

    if sunrise_local.date() != request.date:
        sunrise_jd = _rise_set(seed_jd - 1.0, request.latitude, request.longitude, rising=True)
        if _jd_to_utc(sunrise_jd).astimezone(zone).date() < request.date:
            sunrise_jd = _rise_set(sunrise_jd + 0.1, request.latitude, request.longitude, rising=True)
        sunset_jd = _rise_set(sunrise_jd + 1e-4, request.latitude, request.longitude, rising=False)
        next_sunrise_jd = _rise_set(sunrise_jd + 0.5, request.latitude, request.longitude, rising=True)
        sunrise_utc = _jd_to_utc(sunrise_jd)
        sunset_utc = _jd_to_utc(sunset_jd)
        sunrise_local = sunrise_utc.astimezone(zone)
        sunset_local = sunset_utc.astimezone(zone)

    sun, moon = _sidereal_sun_moon(sunrise_jd)
    with _SWE_LOCK:
        swe.set_sid_mode(swe.SIDM_LAHIRI, 0.0, 0.0)
        ayanamsha = swe.get_ayanamsa_ut(sunrise_jd)

    elongation = _elongation(moon, sun)
    tithi_number, tithi_name, paksha = _tithi_of(elongation)
    nak_number, nak_name, nak_pada = nakshatra_of(moon)
    yoga_number, yoga_name = _yoga_of(sun, moon)
    karana_number, karana_name = _karana_of(elongation)

    tithi_end = _find_crossing(
        sunrise_jd,
        lambda jd: _elongation(*_sidereal_sun_moon(jd)),
        (tithi_number * TITHI_ARC) % 360.0,
        period=360.0,
    )
    nak_end = _find_crossing(
        sunrise_jd,
        lambda jd: _sidereal_sun_moon(jd)[1],
        (nak_number * NAKSHATRA_ARC) % 360.0,
        period=360.0,
    )
    yoga_end = _find_crossing(
        sunrise_jd,
        lambda jd: normalise_degrees(sum(_sidereal_sun_moon(jd))),
        (yoga_number * YOGA_ARC) % 360.0,
        period=360.0,
    )
    karana_end = _find_crossing(
        sunrise_jd,
        lambda jd: _elongation(*_sidereal_sun_moon(jd)),
        (karana_number * KARANA_ARC) % 360.0,
        period=360.0,
    )

    weekday = WEEKDAY_NAMES[sunrise_local.weekday()]

    def anga(
        number: int,
        name: str,
        end_jd: float,
        *,
        paksha_value: str | None = None,
        pada: int | None = None,
    ) -> PanchangaAnga:
        return PanchangaAnga(
            number=number,
            name=name,
            paksha=paksha_value,
            pada=pada,
            start_utc=sunrise_utc,
            end_utc=_jd_to_utc(end_jd),
        )

    return PanchangResponse(
        date=request.date.isoformat(),
        timezone=request.timezone,
        latitude=request.latitude,
        longitude=request.longitude,
        ayanamsha=round(float(ayanamsha), 6),
        ayanamsha_system="CHITRA_PAKSHA_LAHIRI",
        vaara=weekday,
        sunrise=SunEvent(utc=sunrise_utc, local=sunrise_local.strftime("%H:%M:%S")),
        sunset=SunEvent(utc=sunset_utc, local=sunset_local.strftime("%H:%M:%S")),
        next_sunrise_utc=_jd_to_utc(next_sunrise_jd),
        sun_sign=SIGN_NAMES[sign_index(sun) - 1],
        moon_sign=SIGN_NAMES[sign_index(moon) - 1],
        tithi=anga(tithi_number, tithi_name, tithi_end, paksha_value=paksha),
        nakshatra=anga(nak_number, nak_name, nak_end, pada=nak_pada),
        yoga=anga(yoga_number, yoga_name, yoga_end),
        karana=anga(karana_number, karana_name, karana_end),
    )
