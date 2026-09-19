"""Tests for the daily panchanga.

The angas are locked to Lahiri sidereal Sun/Moon geometry. Sunrise anchors the Vedic day, so a
wrong zone or a tropical longitude would shift every field while still looking like a plausible
almanac page.
"""

from datetime import date, datetime, timezone

import pytest

from app.schemas import PanchangRequest
from app.services.panchang import (
    KARANA_ARC,
    TITHI_ARC,
    YOGA_NAMES,
    PanchangError,
    _elongation,
    _karana_of,
    _tithi_of,
    _yoga_of,
    compute_panchang,
)

VARANASI = PanchangRequest(
    date=date(1994, 8, 17),
    latitude=25.317645,
    longitude=83.005495,
    timezone="Asia/Kolkata",
)


class TestAngaArithmetic:
    def test_tithi_boundaries_and_paksha(self) -> None:
        number, name, paksha = _tithi_of(0.0)
        assert (number, name, paksha) == (1, "Pratipada", "Shukla")

        number, name, paksha = _tithi_of(14 * TITHI_ARC + 0.1)
        assert name == "Purnima"
        assert paksha == "Shukla"

        number, name, paksha = _tithi_of(15 * TITHI_ARC)
        assert paksha == "Krishna"
        assert name == "Pratipada"

        number, name, paksha = _tithi_of(359.9)
        assert (number, name, paksha) == (30, "Amavasya", "Krishna")

    def test_yoga_covers_all_twenty_seven_names(self) -> None:
        assert len(YOGA_NAMES) == 27
        number, name = _yoga_of(0.0, 0.0)
        assert (number, name) == (1, "Vishkambha")
        # Sum of 359.9 wraps just short of a full turn into the last yoga.
        number, name = _yoga_of(180.0, 179.9)
        assert name == "Vaidhriti"

    def test_karana_fixed_and_movable(self) -> None:
        assert _karana_of(0.0)[1] == "Kimstughna"
        assert _karana_of(KARANA_ARC)[1] == "Bava"
        assert _karana_of(57 * KARANA_ARC)[1] == "Shakuni"
        assert _karana_of(59 * KARANA_ARC)[1] == "Naga"

    def test_elongation_wraps(self) -> None:
        assert _elongation(10.0, 350.0) == pytest.approx(20.0)


class TestPanchangComputation:
    @pytest.fixture(autouse=True)
    def _require_ephemeris(self) -> None:
        from app.services.ephemeris import EphemerisDataMissingError, verify_ephemeris_files

        try:
            verify_ephemeris_files()
        except EphemerisDataMissingError as exc:
            pytest.skip(f"ephemeris data unavailable: {exc}")

    def test_known_day_at_varanasi_has_consistent_structure(self) -> None:
        result = compute_panchang(VARANASI)

        assert result.date == "1994-08-17"
        assert result.ayanamsha_system == "CHITRA_PAKSHA_LAHIRI"
        assert result.vaara == "Budhavara"  # 17 Aug 1994 was a Wednesday
        assert result.sunrise.local < result.sunset.local
        assert result.tithi.paksha in ("Shukla", "Krishna")
        assert 1 <= result.tithi.number <= 30
        assert 1 <= result.nakshatra.number <= 27
        assert 1 <= result.nakshatra.pada <= 4
        assert 1 <= result.yoga.number <= 27
        assert result.tithi.end_utc > result.tithi.start_utc
        assert result.nakshatra.end_utc > result.nakshatra.start_utc
        assert result.next_sunrise_utc > result.sunrise.utc

    def test_sunrise_is_on_the_requested_civil_date(self) -> None:
        result = compute_panchang(VARANASI)
        # Local sunrise string is HH:MM:SS; the UTC instant converted back must land on Aug 17.
        local_sunrise = datetime.fromisoformat(result.sunrise.utc.isoformat()).astimezone(
            __import__("zoneinfo").ZoneInfo("Asia/Kolkata")
        )
        assert local_sunrise.date() == date(1994, 8, 17)
        assert 4 <= local_sunrise.hour <= 7  # monsoon sunrise in Varanasi

    def test_same_inputs_are_deterministic(self) -> None:
        first = compute_panchang(VARANASI)
        second = compute_panchang(VARANASI)
        assert first.model_dump() == second.model_dump()

    def test_unknown_timezone_is_refused(self) -> None:
        with pytest.raises(PanchangError, match="Unknown timezone"):
            compute_panchang(
                PanchangRequest(
                    date=date(1994, 8, 17),
                    latitude=25.3,
                    longitude=83.0,
                    timezone="Asia/Ujjain",
                )
            )

    def test_a_modern_delhi_day_returns_all_five_angas(self) -> None:
        result = compute_panchang(
            PanchangRequest(
                date=date(2026, 9, 19),
                latitude=28.6139,
                longitude=77.2090,
                timezone="Asia/Kolkata",
            )
        )
        assert result.vaara == "Shanivara"
        assert result.tithi.name
        assert result.nakshatra.name
        assert result.yoga.name
        assert result.karana.name
        assert result.sun_sign in {
            "Mesha",
            "Vrishabha",
            "Mithuna",
            "Karka",
            "Simha",
            "Kanya",
            "Tula",
            "Vrischika",
            "Dhanu",
            "Makara",
            "Kumbha",
            "Meena",
        }
