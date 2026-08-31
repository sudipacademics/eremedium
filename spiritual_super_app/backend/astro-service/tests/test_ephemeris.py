"""Tests for the ephemeris layer.

The compute service is the product's differentiator and had no tests at all: a syntax error in it
passed CI, and a wrong ayanamsha or a swapped node would have produced charts that look entirely
plausible and are quietly wrong for every user. These lock down the conventions the whole app assumes
(`.cursorrules` fixes them: Chitra Paksha Lahiri and the True Node) and the arithmetic around them.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.schemas import NatalChartRequest
from app.services.ephemeris import (
    NAKSHATRA_ARC,
    compute_natal_chart,
    nakshatra_of,
    normalise_degrees,
    sign_index,
    whole_sign_house,
)

# 17 August 1994, 03:45 IST in Varanasi, expressed as the UTC instant the gateway would send.
VARANASI_BIRTH = NatalChartRequest(
    dob_utc=datetime(1994, 8, 16, 22, 15, tzinfo=timezone.utc),
    latitude=25.317645,
    longitude=83.005495,
)


class TestPureHelpers:
    def test_normalise_wraps_into_one_turn(self) -> None:
        assert normalise_degrees(0.0) == 0.0
        assert normalise_degrees(360.0) == 0.0
        assert normalise_degrees(370.5) == pytest.approx(10.5)
        assert normalise_degrees(-1.0) == pytest.approx(359.0)

    def test_sign_index_is_one_based_and_covers_every_boundary(self) -> None:
        assert sign_index(0.0) == 1
        assert sign_index(29.999) == 1
        assert sign_index(30.0) == 2
        assert sign_index(359.999) == 12
        # Every sign is exactly 30 degrees, so the boundaries must not drift.
        for index in range(12):
            assert sign_index(index * 30.0) == index + 1

    def test_nakshatra_arc_divides_the_zodiac_into_27(self) -> None:
        assert NAKSHATRA_ARC == pytest.approx(360.0 / 27.0)

    def test_nakshatra_and_pada_at_the_boundaries(self) -> None:
        first_number, first_name, first_pada = nakshatra_of(0.0)
        assert (first_number, first_name, first_pada) == (1, "Ashwini", 1)

        # The last pada of the last nakshatra, just short of a full turn.
        last_number, last_name, last_pada = nakshatra_of(359.9999)
        assert (last_number, last_name, last_pada) == (27, "Revati", 4)

        # Each nakshatra is four equal padas.
        for pada in range(4):
            offset = pada * (NAKSHATRA_ARC / 4.0) + 0.001
            assert nakshatra_of(offset)[2] == pada + 1

    def test_pada_never_exceeds_four_on_a_rounding_edge(self) -> None:
        for degrees in (NAKSHATRA_ARC - 1e-9, 2 * NAKSHATRA_ARC - 1e-9, 360.0 - 1e-9):
            assert 1 <= nakshatra_of(degrees)[2] <= 4

    def test_whole_sign_house_counts_from_the_lagna(self) -> None:
        lagna = 95.0  # Karka, sign 4
        assert whole_sign_house(95.0, lagna) == 1
        assert whole_sign_house(125.0, lagna) == 2
        # A planet one sign behind the Lagna sits in the twelfth.
        assert whole_sign_house(65.0, lagna) == 12
        # Houses are whole signs, so degrees within a sign never change the bhava.
        assert whole_sign_house(120.1, lagna) == whole_sign_house(149.9, lagna)


class TestNatalChart:
    """Exercises the real Swiss Ephemeris. Skipped when the .se1 files are absent."""

    @pytest.fixture(autouse=True)
    def _require_ephemeris(self) -> None:
        from app.services.ephemeris import EphemerisDataMissingError, verify_ephemeris_files

        try:
            verify_ephemeris_files()
        except EphemerisDataMissingError as exc:
            # The .se1 binaries are deliberately not committed. Skipping keeps the pure-arithmetic
            # tests useful on a fresh checkout instead of failing the whole file.
            pytest.skip(f"ephemeris data unavailable: {exc}")

    def test_conventions_are_the_ones_the_whole_app_assumes(self) -> None:
        chart = compute_natal_chart(VARANASI_BIRTH)

        assert chart.ayanamsha_system == "CHITRA_PAKSHA_LAHIRI"
        assert chart.node_type == "TRUE_NODE"
        # Lahiri ayanamsha was roughly 23.78 degrees in 1994; a tropical chart would report 0.
        assert chart.ayanamsha == pytest.approx(23.78, abs=0.05)

    def test_known_birth_produces_the_expected_positions(self) -> None:
        chart = compute_natal_chart(VARANASI_BIRTH)
        by_body = {planet.body: planet for planet in chart.planets}

        # The Sun entered sidereal Simha within a day of this birth, so it sits at the very start.
        assert by_body["Sun"].zodiac_sign_name == "Simha"
        assert by_body["Sun"].degrees_in_sign == pytest.approx(0.02, abs=0.05)
        assert by_body["Moon"].zodiac_sign_name == "Dhanu"
        assert by_body["Moon"].nakshatra_name == "Mula"
        assert chart.ascendant.zodiac_sign_name == "Karka"

    def test_every_graha_is_present_exactly_once(self) -> None:
        chart = compute_natal_chart(VARANASI_BIRTH)
        bodies = [planet.body for planet in chart.planets]

        assert bodies.count("Rahu") == 1
        assert bodies.count("Ketu") == 1
        assert len(bodies) == len(set(bodies))
        for expected in ("Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"):
            assert expected in bodies

    def test_ketu_is_exactly_opposite_rahu(self) -> None:
        """Required by .cursorrules: Ketu is derived, never computed independently."""
        chart = compute_natal_chart(VARANASI_BIRTH)
        by_body = {planet.body: planet for planet in chart.planets}

        separation = normalise_degrees(
            by_body["Ketu"].sidereal_longitude - by_body["Rahu"].sidereal_longitude
        )
        assert separation == pytest.approx(180.0, abs=1e-5)
        # Opposite longitudes are always six signs and six houses apart.
        assert (by_body["Ketu"].zodiac_sign - by_body["Rahu"].zodiac_sign) % 12 == 6
        assert (by_body["Ketu"].house - by_body["Rahu"].house) % 12 == 6

    def test_all_longitudes_are_within_one_turn_and_consistent(self) -> None:
        chart = compute_natal_chart(VARANASI_BIRTH)

        for planet in chart.planets:
            assert 0.0 <= planet.sidereal_longitude < 360.0
            assert 0.0 <= planet.degrees_in_sign < 30.0
            # The reported sign, degrees-in-sign and nakshatra must all describe one longitude.
            assert planet.zodiac_sign == sign_index(planet.sidereal_longitude)
            assert planet.degrees_in_sign == pytest.approx(planet.sidereal_longitude % 30.0, abs=1e-6)
            assert planet.nakshatra == nakshatra_of(planet.sidereal_longitude)[0]
            assert planet.house == whole_sign_house(
                planet.sidereal_longitude, chart.ascendant.sidereal_longitude
            )

    def test_the_luminaries_are_never_retrograde(self) -> None:
        chart = compute_natal_chart(VARANASI_BIRTH)
        by_body = {planet.body: planet for planet in chart.planets}

        assert by_body["Sun"].is_retrograde is False
        assert by_body["Moon"].is_retrograde is False
        assert by_body["Moon"].speed_deg_per_day > 11.0

    def test_twelve_house_cusps_in_ascending_order_from_the_ascendant(self) -> None:
        chart = compute_natal_chart(VARANASI_BIRTH)

        assert [cusp.house for cusp in chart.house_cusps] == list(range(1, 13))
        # The first cusp is the ascendant by definition.
        assert chart.house_cusps[0].sidereal_longitude == pytest.approx(
            chart.ascendant.sidereal_longitude, abs=1e-6
        )

    def test_the_ascendant_moves_with_the_clock(self) -> None:
        """Roughly a degree every four minutes, which is why an unknown birth time is fatal."""
        later = NatalChartRequest(
            dob_utc=VARANASI_BIRTH.dob_utc + timedelta(minutes=4),
            latitude=VARANASI_BIRTH.latitude,
            longitude=VARANASI_BIRTH.longitude,
        )

        moved = normalise_degrees(
            compute_natal_chart(later).ascendant.sidereal_longitude
            - compute_natal_chart(VARANASI_BIRTH).ascendant.sidereal_longitude
        )
        assert moved == pytest.approx(1.0, abs=0.35)

    def test_the_same_input_always_gives_the_same_chart(self) -> None:
        """The gateway caches charts forever on this assumption."""
        first = compute_natal_chart(VARANASI_BIRTH)
        second = compute_natal_chart(VARANASI_BIRTH)

        assert first.model_dump() == second.model_dump()

    def test_longitude_changes_the_ascendant_but_not_the_planets(self) -> None:
        """Planetary longitudes are geocentric; only the horizon depends on where you stand."""
        elsewhere = NatalChartRequest(
            dob_utc=VARANASI_BIRTH.dob_utc,
            latitude=19.9973,
            longitude=73.7910,
        )

        here = compute_natal_chart(VARANASI_BIRTH)
        there = compute_natal_chart(elsewhere)

        assert there.ascendant.sidereal_longitude != here.ascendant.sidereal_longitude
        by_body_here = {p.body: p.sidereal_longitude for p in here.planets}
        for planet in there.planets:
            assert planet.sidereal_longitude == pytest.approx(by_body_here[planet.body], abs=1e-6)


class TestRequestValidation:
    def test_a_naive_datetime_is_refused(self) -> None:
        with pytest.raises(ValueError, match="timezone offset"):
            NatalChartRequest(dob_utc=datetime(1994, 8, 16, 22, 15), latitude=25.3, longitude=83.0)

    def test_coordinates_are_bounded(self) -> None:
        with pytest.raises(ValueError):
            NatalChartRequest(dob_utc=VARANASI_BIRTH.dob_utc, latitude=91.0, longitude=83.0)
        with pytest.raises(ValueError):
            NatalChartRequest(dob_utc=VARANASI_BIRTH.dob_utc, latitude=25.3, longitude=181.0)

    def test_unknown_fields_are_refused(self) -> None:
        """extra="forbid" stops a caller believing an option took effect when it was ignored."""
        with pytest.raises(ValueError):
            NatalChartRequest(
                dob_utc=VARANASI_BIRTH.dob_utc,
                latitude=25.3,
                longitude=83.0,
                ayanamsha="RAMAN",
            )

    def test_a_non_utc_offset_is_accepted_and_converted(self) -> None:
        ist = timezone(timedelta(hours=5, minutes=30))
        request = NatalChartRequest(
            dob_utc=datetime(1994, 8, 17, 3, 45, tzinfo=ist),
            latitude=25.317645,
            longitude=83.005495,
        )

        assert request.dob_utc.astimezone(timezone.utc) == VARANASI_BIRTH.dob_utc
