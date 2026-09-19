"""Ashtakoot table invariants — no ephemeris required."""

from app.schemas import AshtakootRequest
from app.services.ashtakoot import compute_ashtakoot
from app.services.ephemeris import NAKSHATRA_NAMES, SIGN_NAMES


def test_max_guna_is_thirty_six() -> None:
    # Identical Moon positions: Nadi fails (same nadi), everything else should score high.
    # Use Ashwini (nak 1, Adi) vs Bharani (nak 2, Madhya) in Mesha for a strong total.
    result = compute_ashtakoot(
        AshtakootRequest(
            boy_nakshatra=1,
            girl_nakshatra=2,
            boy_moon_sign=1,
            girl_moon_sign=1,
            include_manglik=False,
        )
    )
    assert result.max_guna == 36
    assert sum(k.max_points for k in result.kootas) == 36
    assert 0 <= result.total_guna <= 36


def test_same_nadi_scores_zero() -> None:
    # Ashwini and Krittika are both Adi nadi.
    result = compute_ashtakoot(
        AshtakootRequest(
            boy_nakshatra=1,
            girl_nakshatra=3,
            boy_moon_sign=1,
            girl_moon_sign=4,
            include_manglik=False,
        )
    )
    nadi = next(k for k in result.kootas if k.name == "Nadi")
    assert nadi.score == 0.0


def test_bhakoot_six_eight_dosha() -> None:
    # Mesha (1) and Kanya (6) → inclusive count 6.
    result = compute_ashtakoot(
        AshtakootRequest(
            boy_nakshatra=1,
            girl_nakshatra=2,
            boy_moon_sign=6,
            girl_moon_sign=1,
            include_manglik=False,
        )
    )
    bhakoot = next(k for k in result.kootas if k.name == "Bhakoot")
    assert bhakoot.score == 0.0


def test_manglik_requires_birth_time() -> None:
    result = compute_ashtakoot(
        AshtakootRequest(
            boy_nakshatra=1,
            girl_nakshatra=2,
            boy_moon_sign=1,
            girl_moon_sign=2,
            include_manglik=True,
            boy_mars_house=7,
            girl_mars_house=3,
            boy_birth_time_known=False,
            girl_birth_time_known=True,
        )
    )
    assert result.manglik is not None
    assert result.manglik.boy.is_manglik is None
    assert result.manglik.girl.is_manglik is False
    assert result.manglik.compatible is None


def test_manglik_both_or_neither() -> None:
    result = compute_ashtakoot(
        AshtakootRequest(
            boy_nakshatra=1,
            girl_nakshatra=2,
            boy_moon_sign=1,
            girl_moon_sign=2,
            include_manglik=True,
            boy_mars_house=7,
            girl_mars_house=8,
            boy_birth_time_known=True,
            girl_birth_time_known=True,
        )
    )
    assert result.manglik is not None
    assert result.manglik.boy.is_manglik is True
    assert result.manglik.girl.is_manglik is True
    assert result.manglik.compatible is True


def test_name_tables_cover_full_sky() -> None:
    assert len(SIGN_NAMES) == 12
    assert len(NAKSHATRA_NAMES) == 27
