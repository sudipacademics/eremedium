"""Gochar (transit) sky — Lahiri longitudes at a moment, optionally housed from natal Lagna."""

from __future__ import annotations

import swisseph as swe

from ..config import get_settings
from ..schemas import AscendantPosition, GocharPlanet, GocharRequest, GocharResponse
from .ephemeris import (
    CALC_FLAGS,
    GRAHA_BODIES,
    NAKSHATRA_NAMES,
    SIGN_NAMES,
    _SWE_LOCK,
    initialise_ephemeris,
    julian_day_ut,
    nakshatra_of,
    normalise_degrees,
    sign_index,
    whole_sign_house,
)


def compute_gochar(request: GocharRequest) -> GocharResponse:
    initialise_ephemeris()
    jd_ut = julian_day_ut(request.transit_utc)
    house_system = get_settings().house_system.encode("ascii")

    with _SWE_LOCK:
        swe.set_sid_mode(swe.SIDM_LAHIRI, 0.0, 0.0)
        ayanamsha = swe.get_ayanamsa_ut(jd_ut)

        _cusps, ascmc = swe.houses_ex(
            jd_ut,
            request.latitude,
            request.longitude,
            house_system,
            swe.FLG_SIDEREAL,
        )
        transit_asc_lon = normalise_degrees(ascmc[0])

        raw: list[tuple[str, float, float]] = []
        for body_name, body_id in GRAHA_BODIES:
            values, return_flag = swe.calc_ut(jd_ut, body_id, CALC_FLAGS)
            if return_flag < 0:
                raise RuntimeError(f"Swiss Ephemeris failed for {body_name} (flag={return_flag})")
            longitude, _lat, _dist, speed = values[0], values[1], values[2], values[3]
            raw.append((body_name, longitude, speed))

    planets: list[GocharPlanet] = []
    for body_name, longitude, speed in raw:
        absolute = normalise_degrees(longitude)
        nak, nak_name, pada = nakshatra_of(absolute)
        planets.append(
            GocharPlanet(
                body=body_name,
                sidereal_longitude=round(absolute, 6),
                degrees_in_sign=round(absolute % 30.0, 6),
                zodiac_sign=sign_index(absolute),
                zodiac_sign_name=SIGN_NAMES[sign_index(absolute) - 1],
                nakshatra=nak,
                nakshatra_name=nak_name,
                nakshatra_pada=pada,
                speed_deg_per_day=round(speed, 6),
                is_retrograde=speed < 0.0,
                house_from_natal_lagna=(
                    whole_sign_house(absolute, request.natal_ascendant_longitude)
                    if request.natal_ascendant_longitude is not None
                    else None
                ),
                house_from_transit_lagna=whole_sign_house(absolute, transit_asc_lon),
            )
        )

    rahu = next(p for p in planets if p.body == "Rahu")
    ketu_lon = normalise_degrees(rahu.sidereal_longitude + 180.0)
    ketu_nak, ketu_nak_name, ketu_pada = nakshatra_of(ketu_lon)
    planets.append(
        GocharPlanet(
            body="Ketu",
            sidereal_longitude=round(ketu_lon, 6),
            degrees_in_sign=round(ketu_lon % 30.0, 6),
            zodiac_sign=sign_index(ketu_lon),
            zodiac_sign_name=SIGN_NAMES[sign_index(ketu_lon) - 1],
            nakshatra=ketu_nak,
            nakshatra_name=ketu_nak_name,
            nakshatra_pada=ketu_pada,
            speed_deg_per_day=rahu.speed_deg_per_day,
            is_retrograde=rahu.is_retrograde,
            house_from_natal_lagna=(
                whole_sign_house(ketu_lon, request.natal_ascendant_longitude)
                if request.natal_ascendant_longitude is not None
                else None
            ),
            house_from_transit_lagna=whole_sign_house(ketu_lon, transit_asc_lon),
        )
    )

    asc_nak, asc_nak_name, asc_pada = nakshatra_of(transit_asc_lon)
    transit_ascendant = AscendantPosition(
        sidereal_longitude=round(transit_asc_lon, 6),
        degrees_in_sign=round(transit_asc_lon % 30.0, 6),
        zodiac_sign=sign_index(transit_asc_lon),
        zodiac_sign_name=SIGN_NAMES[sign_index(transit_asc_lon) - 1],
        nakshatra=asc_nak,
        nakshatra_name=asc_nak_name,
        nakshatra_pada=asc_pada,
    )

    natal_moon_sign: str | None = None
    natal_moon_nakshatra: str | None = None
    if request.natal_moon_longitude is not None:
        moon_lon = normalise_degrees(request.natal_moon_longitude)
        natal_moon_sign = SIGN_NAMES[sign_index(moon_lon) - 1]
        natal_moon_nakshatra = NAKSHATRA_NAMES[nakshatra_of(moon_lon)[0] - 1]

    return GocharResponse(
        transit_utc=request.transit_utc,
        julian_day_ut=jd_ut,
        ayanamsha=round(ayanamsha, 6),
        latitude=request.latitude,
        longitude=request.longitude,
        transit_ascendant=transit_ascendant,
        planets=planets,
        natal_moon_sign=natal_moon_sign,
        natal_moon_nakshatra=natal_moon_nakshatra,
    )
