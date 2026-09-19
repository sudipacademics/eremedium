"""Gochar transit sky — needs Swiss Ephemeris data files."""

from datetime import datetime, timezone

import pytest

from app.schemas import GocharRequest
from app.services.gochar import compute_gochar


@pytest.fixture(autouse=True)
def _require_ephemeris() -> None:
    from app.services.ephemeris import EphemerisDataMissingError, verify_ephemeris_files

    try:
        verify_ephemeris_files()
    except EphemerisDataMissingError as exc:
        pytest.skip(f"ephemeris data unavailable: {exc}")


def test_gochar_returns_nine_grahas_plus_ketu() -> None:
    result = compute_gochar(
        GocharRequest(
            transit_utc=datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc),
            latitude=25.317645,
            longitude=83.005495,
            natal_ascendant_longitude=15.0,  # Mesha lagna
            natal_moon_longitude=45.0,  # Vrishabha
        )
    )
    bodies = [p.body for p in result.planets]
    assert bodies == ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]
    assert all(p.house_from_natal_lagna is not None for p in result.planets)
    assert all(1 <= p.house_from_natal_lagna <= 12 for p in result.planets)  # type: ignore[operator]
    assert result.natal_moon_sign == "Vrishabha"
    assert result.ayanamsha_system == "CHITRA_PAKSHA_LAHIRI"
    assert result.node_type == "TRUE_NODE"


def test_gochar_without_natal_omits_natal_houses() -> None:
    result = compute_gochar(
        GocharRequest(
            transit_utc=datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc),
            latitude=25.317645,
            longitude=83.005495,
        )
    )
    assert all(p.house_from_natal_lagna is None for p in result.planets)
    assert all(p.house_from_transit_lagna is not None for p in result.planets)
