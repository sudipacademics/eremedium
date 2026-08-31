"""Vimshottari Dasha engine (up to 5 levels, proportionally nested).

The 120-year Vimshottari cycle is subdivided proportionally at every level: a sub-period's share of
its parent equals that lord's share of the 120-year total. Timestamps are computed on the
365.2425-day tropical year, which is the convention used by mainstream Jyotisha software.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final

from ..schemas import DashaPeriod, DashaRequest, DashaResponse
from .ephemeris import NAKSHATRA_ARC, nakshatra_of, normalise_degrees

# Dasha lords in Vimshottari order with their allotted years. The 27 nakshatras cycle through this
# 9-lord sequence three times, starting from Ashwini -> Ketu.
DASHA_SEQUENCE: Final[tuple[tuple[str, float], ...]] = (
    ("Ketu", 7.0),
    ("Venus", 20.0),
    ("Sun", 6.0),
    ("Moon", 10.0),
    ("Mars", 7.0),
    ("Rahu", 18.0),
    ("Jupiter", 16.0),
    ("Saturn", 19.0),
    ("Mercury", 17.0),
)

TOTAL_CYCLE_YEARS: Final[float] = 120.0
DAYS_PER_YEAR: Final[float] = 365.2425

LEVEL_NAMES: Final[tuple[str, ...]] = (
    "MAHADASHA",
    "ANTARDASHA",
    "PRATYANTARDASHA",
    "SOOKSHMA_DASHA",
    "PRANA_DASHA",
)

_LORD_YEARS: Final[dict[str, float]] = {lord: years for lord, years in DASHA_SEQUENCE}
_LORD_ORDER: Final[tuple[str, ...]] = tuple(lord for lord, _ in DASHA_SEQUENCE)


def _rotated_sequence(start_lord: str) -> tuple[str, ...]:
    offset = _LORD_ORDER.index(start_lord)
    return _LORD_ORDER[offset:] + _LORD_ORDER[:offset]


def nakshatra_lord(moon_longitude: float) -> tuple[int, str, str, float]:
    """Return (nakshatra number, nakshatra name, dasha lord, elapsed fraction of the nakshatra)."""
    absolute = normalise_degrees(moon_longitude)
    number, name, _pada = nakshatra_of(absolute)
    lord = _LORD_ORDER[(number - 1) % 9]
    elapsed_fraction = (absolute % NAKSHATRA_ARC) / NAKSHATRA_ARC
    return number, name, lord, elapsed_fraction


def _build_children(
    parent_lord: str,
    parent_start: datetime,
    parent_days: float,
    level: int,
    max_level: int,
    horizon_end: datetime,
) -> list[DashaPeriod]:
    if level > max_level:
        return []

    periods: list[DashaPeriod] = []
    cursor = parent_start
    for lord in _rotated_sequence(parent_lord):
        share_days = parent_days * (_LORD_YEARS[lord] / TOTAL_CYCLE_YEARS)
        end = cursor + timedelta(days=share_days)
        if cursor >= horizon_end:
            break
        periods.append(
            DashaPeriod(
                level=level,
                level_name=LEVEL_NAMES[level - 1],  # type: ignore[arg-type]
                lord=lord,
                start_utc=cursor,
                end_utc=end,
                duration_days=round(share_days, 6),
                children=_build_children(lord, cursor, share_days, level + 1, max_level, horizon_end),
            )
        )
        cursor = end
    return periods


def compute_vimshottari_dasha(request: DashaRequest) -> DashaResponse:
    number, name, lord, elapsed_fraction = nakshatra_lord(request.moon_sidereal_longitude)

    first_lord_days = _LORD_YEARS[lord] * DAYS_PER_YEAR
    balance_days = first_lord_days * (1.0 - elapsed_fraction)
    # The first Mahadasha is truncated: it notionally began before birth.
    notional_start = request.birth_utc - timedelta(days=first_lord_days - balance_days)
    horizon_end = request.birth_utc + timedelta(days=request.horizon_years * DAYS_PER_YEAR)

    periods: list[DashaPeriod] = []
    cursor = notional_start
    for maha_lord in _rotated_sequence(lord):
        maha_days = _LORD_YEARS[maha_lord] * DAYS_PER_YEAR
        end = cursor + timedelta(days=maha_days)
        if cursor >= horizon_end:
            break
        periods.append(
            DashaPeriod(
                level=1,
                level_name="MAHADASHA",
                lord=maha_lord,
                start_utc=cursor,
                end_utc=end,
                duration_days=round(maha_days, 6),
                children=_build_children(maha_lord, cursor, maha_days, 2, request.depth, horizon_end),
            )
        )
        cursor = end

    return DashaResponse(
        birth_utc=request.birth_utc,
        moon_sidereal_longitude=round(normalise_degrees(request.moon_sidereal_longitude), 6),
        birth_nakshatra=number,
        birth_nakshatra_name=name,
        birth_nakshatra_lord=lord,
        balance_of_dasha_days=round(balance_days, 6),
        depth=request.depth,
        periods=periods,
    )
