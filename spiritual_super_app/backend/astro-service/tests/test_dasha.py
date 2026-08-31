"""Tests for the Vimshottari dasha engine.

A dasha timeline is the part of a reading a client acts on: they are told a period begins on a date.
The arithmetic is pure -- no ephemeris needed -- so these run everywhere and pin down the invariants
that make the timeline trustworthy: periods must tile their parent exactly with no gaps or overlaps,
and the lord sequence must start from the birth nakshatra.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.schemas import DashaRequest
from app.services.dasha import (
    DASHA_SEQUENCE,
    DAYS_PER_YEAR,
    TOTAL_CYCLE_YEARS,
    compute_vimshottari_dasha,
    nakshatra_lord,
)

BIRTH = datetime(1994, 8, 16, 22, 15, tzinfo=timezone.utc)

# The Moon at Mula 2 for that birth. Mula is nakshatra 19, whose lord is Ketu.
MOON_AT_MULA = 245.026887


def request_for(longitude: float = MOON_AT_MULA, **overrides: object) -> DashaRequest:
    payload: dict[str, object] = {
        "moon_sidereal_longitude": longitude,
        "birth_utc": BIRTH,
        "depth": 2,
        "horizon_years": 120.0,
    }
    payload.update(overrides)
    return DashaRequest(**payload)  # type: ignore[arg-type]


class TestTheCycleItself:
    def test_the_nine_lords_sum_to_one_hundred_and_twenty_years(self) -> None:
        assert sum(years for _, years in DASHA_SEQUENCE) == TOTAL_CYCLE_YEARS

    def test_the_sequence_is_the_canonical_vimshottari_order(self) -> None:
        assert [lord for lord, _ in DASHA_SEQUENCE] == [
            "Ketu",
            "Venus",
            "Sun",
            "Moon",
            "Mars",
            "Rahu",
            "Jupiter",
            "Saturn",
            "Mercury",
        ]

    def test_the_lord_cycle_repeats_every_nine_nakshatras(self) -> None:
        """27 nakshatras walk the 9 lords three times, so 1, 10 and 19 share a lord."""
        first = nakshatra_lord(0.0)[2]
        tenth = nakshatra_lord(9 * (360.0 / 27.0) + 0.1)[2]
        nineteenth = nakshatra_lord(18 * (360.0 / 27.0) + 0.1)[2]

        assert first == tenth == nineteenth == "Ketu"

    def test_the_birth_nakshatra_lord_is_identified(self) -> None:
        number, name, lord, elapsed = nakshatra_lord(MOON_AT_MULA)

        assert (number, name, lord) == (19, "Mula", "Ketu")
        assert 0.0 <= elapsed < 1.0


class TestBalanceAtBirth:
    def test_the_first_period_is_truncated_by_how_far_the_moon_has_travelled(self) -> None:
        """A Moon at the very start of a nakshatra leaves the whole period still to run."""
        at_start = compute_vimshottari_dasha(request_for(0.0))
        ketu_years = dict(DASHA_SEQUENCE)["Ketu"]

        assert at_start.birth_nakshatra_lord == "Ketu"
        assert at_start.balance_of_dasha_days == pytest.approx(ketu_years * DAYS_PER_YEAR, rel=1e-6)

    def test_a_moon_at_the_end_of_a_nakshatra_leaves_almost_nothing(self) -> None:
        arc = 360.0 / 27.0
        at_end = compute_vimshottari_dasha(request_for(arc - 1e-6))

        assert at_end.balance_of_dasha_days < 1.0

    def test_the_balance_is_proportional_to_the_arc_traversed(self) -> None:
        arc = 360.0 / 27.0
        halfway = compute_vimshottari_dasha(request_for(arc / 2.0))
        ketu_days = dict(DASHA_SEQUENCE)["Ketu"] * DAYS_PER_YEAR

        assert halfway.balance_of_dasha_days == pytest.approx(ketu_days / 2.0, rel=1e-6)

    def test_the_first_mahadasha_ends_one_balance_after_birth(self) -> None:
        """The balance is what the client is actually told: when their current period ends."""
        result = compute_vimshottari_dasha(request_for())
        first = result.periods[0]

        expected_end = BIRTH + timedelta(days=result.balance_of_dasha_days)
        assert first.lord == result.birth_nakshatra_lord
        assert first.start_utc <= BIRTH < first.end_utc
        assert abs((first.end_utc - expected_end).total_seconds()) < 1.0


class TestStructure:
    def test_mahadashas_start_from_the_birth_lord_and_follow_the_cycle(self) -> None:
        result = compute_vimshottari_dasha(request_for())
        lords = [period.lord for period in result.periods]

        assert lords[0] == "Ketu"
        assert lords[1] == "Venus"
        assert lords[2] == "Sun"

    def test_consecutive_periods_touch_exactly_with_no_gap_or_overlap(self) -> None:
        result = compute_vimshottari_dasha(request_for())

        for earlier, later in zip(result.periods, result.periods[1:]):
            assert earlier.end_utc == later.start_utc

    def test_children_tile_their_parent_exactly(self) -> None:
        """A sub-period's share of its parent is that lord's share of the 120-year cycle."""
        result = compute_vimshottari_dasha(request_for(0.0, depth=3))

        def check(period: object) -> None:
            children = period.children  # type: ignore[attr-defined]
            if not children:
                return
            assert children[0].start_utc == period.start_utc  # type: ignore[attr-defined]
            assert children[-1].end_utc == period.end_utc  # type: ignore[attr-defined]
            for earlier, later in zip(children, children[1:]):
                assert earlier.end_utc == later.start_utc
            total = sum(child.duration_days for child in children)
            assert total == pytest.approx(period.duration_days, rel=1e-6)  # type: ignore[attr-defined]
            for child in children:
                check(child)

        # The first Mahadasha is truncated by the birth balance, so start from the second, which is
        # a whole period and must be tiled completely by its children.
        check(result.periods[1])

    def test_a_sub_period_gets_its_proportional_share(self) -> None:
        result = compute_vimshottari_dasha(request_for(0.0, depth=2))
        venus_maha = next(period for period in result.periods if period.lord == "Venus")
        venus_years, sun_years = dict(DASHA_SEQUENCE)["Venus"], dict(DASHA_SEQUENCE)["Sun"]

        sun_under_venus = next(child for child in venus_maha.children if child.lord == "Sun")
        expected_days = venus_years * DAYS_PER_YEAR * (sun_years / TOTAL_CYCLE_YEARS)

        assert sun_under_venus.duration_days == pytest.approx(expected_days, rel=1e-6)

    def test_each_level_is_labelled_and_nests_no_deeper_than_asked(self) -> None:
        for depth in (1, 2, 3):
            result = compute_vimshottari_dasha(request_for(0.0, depth=depth))

            def deepest(period: object, level: int = 1) -> int:
                children = period.children  # type: ignore[attr-defined]
                return max((deepest(c, level + 1) for c in children), default=level)

            assert result.depth == depth
            assert deepest(result.periods[0]) <= depth
            assert result.periods[0].level_name == "MAHADASHA"
            if depth >= 2:
                assert result.periods[0].children[0].level_name == "ANTARDASHA"

    def test_a_shorter_horizon_returns_fewer_periods(self) -> None:
        short = compute_vimshottari_dasha(request_for(0.0, depth=1, horizon_years=10.0))
        full = compute_vimshottari_dasha(request_for(0.0, depth=1, horizon_years=120.0))

        assert len(short.periods) < len(full.periods)
        assert len(full.periods) == 9

    def test_the_timeline_spans_the_requested_horizon(self) -> None:
        result = compute_vimshottari_dasha(request_for(0.0, depth=1, horizon_years=120.0))

        assert result.periods[-1].end_utc >= BIRTH + timedelta(days=119 * DAYS_PER_YEAR)


class TestValidation:
    def test_longitude_must_be_inside_one_turn(self) -> None:
        with pytest.raises(ValueError):
            request_for(360.0)
        with pytest.raises(ValueError):
            request_for(-0.1)

    def test_depth_is_capped_at_five_levels(self) -> None:
        with pytest.raises(ValueError):
            request_for(depth=6)
        with pytest.raises(ValueError):
            request_for(depth=0)

    def test_a_naive_birth_time_is_refused(self) -> None:
        with pytest.raises(ValueError, match="timezone offset"):
            DashaRequest(
                moon_sidereal_longitude=MOON_AT_MULA,
                birth_utc=datetime(1994, 8, 16, 22, 15),
            )

    def test_the_horizon_cannot_exceed_the_cycle(self) -> None:
        with pytest.raises(ValueError):
            request_for(horizon_years=121.0)
