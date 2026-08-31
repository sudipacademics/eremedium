"""Swiss Ephemeris wrapper.

Hard invariants enforced here (see .cursorrules):
  * Chitra Paksha / Lahiri ayanamsha only (`swe.SIDM_LAHIRI`).
  * Rahu is the *True* Node (`swe.TRUE_NODE`); Ketu is derived as its exact 180 degree opposite.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Final

import swisseph as swe

from ..config import get_settings
from ..schemas import (
    AscendantPosition,
    HouseCusp,
    NatalChartRequest,
    NatalChartResponse,
    PlanetPosition,
)

SIGN_NAMES: Final[tuple[str, ...]] = (
    "Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya",
    "Tula", "Vrischika", "Dhanu", "Makara", "Kumbha", "Meena",
)

NAKSHATRA_NAMES: Final[tuple[str, ...]] = (
    "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
    "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni",
    "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
    "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha",
    "Purva Bhadrapada", "Uttara Bhadrapada", "Revati",
)

# Ordered exactly as the natal chart response should read.
GRAHA_BODIES: Final[tuple[tuple[str, int], ...]] = (
    ("Sun", swe.SUN),
    ("Moon", swe.MOON),
    ("Mars", swe.MARS),
    ("Mercury", swe.MERCURY),
    ("Jupiter", swe.JUPITER),
    ("Venus", swe.VENUS),
    ("Saturn", swe.SATURN),
    ("Rahu", swe.TRUE_NODE),
)

CALC_FLAGS: Final[int] = swe.FLG_SWIEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED
NAKSHATRA_ARC: Final[float] = 360.0 / 27.0
PADA_ARC: Final[float] = NAKSHATRA_ARC / 4.0

# pyswisseph is not re-entrant: global ephemeris state is shared process-wide.
_SWE_LOCK: Final[threading.Lock] = threading.Lock()
_INITIALISED = False

# Minimum data set for sidereal charts across 1800-2399 CE.
REQUIRED_EPHEMERIS_FILES: Final[tuple[str, ...]] = ("sepl_18.se1", "semo_18.se1", "seas_18.se1")

# Every genuine .se1 file opens with this ASCII marker; an HTML error page saved by a proxy will not.
SE1_MAGIC: Final[bytes] = b"SWISSEPH"


class EphemerisDataMissingError(RuntimeError):
    """Raised at startup when the ephemeris mount is absent, empty or corrupt."""


def verify_ephemeris_files() -> list[str]:
    """Return the verified file names, raising if any are missing or not real SE1 binaries."""
    directory = get_settings().ephemeris_path
    if not directory.is_dir():
        raise EphemerisDataMissingError(f"Ephemeris directory does not exist: {directory}")

    problems: list[str] = []
    verified: list[str] = []
    for name in REQUIRED_EPHEMERIS_FILES:
        path = directory / name
        if not path.is_file():
            problems.append(f"{name}: missing")
            continue
        with path.open("rb") as handle:
            if handle.read(len(SE1_MAGIC)) != SE1_MAGIC:
                problems.append(f"{name}: not a Swiss Ephemeris file (missing SWISSEPH header)")
                continue
        verified.append(name)

    if problems:
        raise EphemerisDataMissingError(
            f"Ephemeris data unusable in {directory}: {'; '.join(problems)}. "
            "Download the .se1 files (see ephemeris/README.md); without them Swiss Ephemeris "
            "silently falls back to the lower-precision Moshier model."
        )
    return verified


def initialise_ephemeris() -> None:
    """Point Swiss Ephemeris at the local JPL/SE ephemeris files and lock in Lahiri ayanamsha."""
    global _INITIALISED
    with _SWE_LOCK:
        if _INITIALISED:
            return
        settings = get_settings()
        swe.set_ephe_path(str(settings.ephemeris_path))
        swe.set_sid_mode(swe.SIDM_LAHIRI, 0.0, 0.0)
        _INITIALISED = True

    # set_ephe_path() never reports failure: a bad mount silently degrades every chart to the
    # built-in Moshier model, so assert the data files really are present.
    verify_ephemeris_files()


def shutdown_ephemeris() -> None:
    global _INITIALISED
    with _SWE_LOCK:
        swe.close()
        _INITIALISED = False


def normalise_degrees(value: float) -> float:
    return value % 360.0


def julian_day_ut(moment: datetime) -> float:
    utc = moment.astimezone(timezone.utc)
    fractional_hour = utc.hour + utc.minute / 60.0 + (utc.second + utc.microsecond / 1_000_000) / 3600.0
    return swe.julday(utc.year, utc.month, utc.day, fractional_hour, swe.GREG_CAL)


def sign_index(longitude: float) -> int:
    """1-based sidereal zodiac sign."""
    return int(normalise_degrees(longitude) // 30.0) + 1


def nakshatra_of(longitude: float) -> tuple[int, str, int]:
    absolute = normalise_degrees(longitude)
    index = int(absolute // NAKSHATRA_ARC)
    pada = int((absolute - index * NAKSHATRA_ARC) // PADA_ARC) + 1
    return index + 1, NAKSHATRA_NAMES[index], min(pada, 4)


def whole_sign_house(body_longitude: float, ascendant_longitude: float) -> int:
    """Vedic bhava: whole-sign houses counted from the Lagna sign."""
    return ((sign_index(body_longitude) - sign_index(ascendant_longitude)) % 12) + 1


def _planet_position(
    body_name: str,
    longitude: float,
    latitude: float,
    speed: float,
    ascendant_longitude: float,
) -> PlanetPosition:
    absolute = normalise_degrees(longitude)
    nakshatra, nakshatra_name, pada = nakshatra_of(absolute)
    return PlanetPosition(
        body=body_name,
        sidereal_longitude=round(absolute, 6),
        sidereal_latitude=round(latitude, 6),
        degrees_in_sign=round(absolute % 30.0, 6),
        zodiac_sign=sign_index(absolute),
        zodiac_sign_name=SIGN_NAMES[sign_index(absolute) - 1],
        nakshatra=nakshatra,
        nakshatra_name=nakshatra_name,
        nakshatra_pada=pada,
        house=whole_sign_house(absolute, ascendant_longitude),
        speed_deg_per_day=round(speed, 6),
        is_retrograde=speed < 0.0,
    )


def compute_natal_chart(request: NatalChartRequest) -> NatalChartResponse:
    initialise_ephemeris()
    jd_ut = julian_day_ut(request.dob_utc)
    house_system = get_settings().house_system.encode("ascii")

    with _SWE_LOCK:
        # Re-assert sidereal mode on every request: any other caller could have mutated global state.
        swe.set_sid_mode(swe.SIDM_LAHIRI, 0.0, 0.0)
        ayanamsha = swe.get_ayanamsa_ut(jd_ut)

        cusps, ascmc = swe.houses_ex(
            jd_ut,
            request.latitude,
            request.longitude,
            house_system,
            swe.FLG_SIDEREAL,
        )
        ascendant_longitude = normalise_degrees(ascmc[0])

        raw_positions: list[tuple[str, float, float, float]] = []
        for body_name, body_id in GRAHA_BODIES:
            values, return_flag = swe.calc_ut(jd_ut, body_id, CALC_FLAGS)
            if return_flag < 0:
                raise RuntimeError(f"Swiss Ephemeris failed for {body_name} (flag={return_flag})")
            longitude, latitude, _distance, speed_long = values[0], values[1], values[2], values[3]
            raw_positions.append((body_name, longitude, latitude, speed_long))

    planets = [
        _planet_position(name, longitude, latitude, speed, ascendant_longitude)
        for name, longitude, latitude, speed in raw_positions
    ]

    rahu = next(planet for planet in planets if planet.body == "Rahu")
    ketu_longitude = normalise_degrees(rahu.sidereal_longitude + 180.0)
    planets.append(
        _planet_position(
            "Ketu",
            ketu_longitude,
            -rahu.sidereal_latitude,
            rahu.speed_deg_per_day,
            ascendant_longitude,
        )
    )

    ascendant_nakshatra, ascendant_nakshatra_name, ascendant_pada = nakshatra_of(ascendant_longitude)
    ascendant = AscendantPosition(
        sidereal_longitude=round(ascendant_longitude, 6),
        degrees_in_sign=round(ascendant_longitude % 30.0, 6),
        zodiac_sign=sign_index(ascendant_longitude),
        zodiac_sign_name=SIGN_NAMES[sign_index(ascendant_longitude) - 1],
        nakshatra=ascendant_nakshatra,
        nakshatra_name=ascendant_nakshatra_name,
        nakshatra_pada=ascendant_pada,
    )

    # Depending on the house system, pyswisseph returns either 12 cusps or 13 with a leading dummy.
    ordered_cusps = list(cusps[1:13]) if len(cusps) >= 13 else list(cusps[:12])
    house_cusps = [
        HouseCusp(
            house=index + 1,
            sidereal_longitude=round(normalise_degrees(cusp), 6),
            zodiac_sign=sign_index(cusp),
            zodiac_sign_name=SIGN_NAMES[sign_index(cusp) - 1],
        )
        for index, cusp in enumerate(ordered_cusps)
    ]

    return NatalChartResponse(
        dob_utc=request.dob_utc,
        julian_day_ut=jd_ut,
        ayanamsha=round(ayanamsha, 6),
        latitude=request.latitude,
        longitude=request.longitude,
        ascendant=ascendant,
        planets=planets,
        house_cusps=house_cusps,
    )
