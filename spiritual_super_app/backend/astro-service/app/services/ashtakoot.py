"""Ashtakoot (Guna Milan) matching from two Moon nakshatras and signs.

The eight kootas are pure tables over Lahiri Moon positions. Mars houses are optional and only used
for the Manglik note; without a known birth time those houses are meaningless and the note says so.
"""

from __future__ import annotations

from typing import Final

from ..schemas import (
    AshtakootRequest,
    AshtakootResponse,
    KootaScore,
    ManglikAssessment,
    ManglikPerson,
)

# Moon-sign Varna (1-based Mesha=1 … Meena=12).
_VARNA: Final[tuple[int, ...]] = (
    # Mesha Kshatriya=2, Vrishabha Vaishya=3, Mithuna Shudra=4, Karka Brahmin=1, …
    2,
    3,
    4,
    1,
    2,
    3,
    4,
    1,
    2,
    3,
    4,
    1,
)

# Vashya groups for Moon signs: Chatushpada, Manava, Jalachara, Vanachara, Keeta.
_VASHYA_GROUP: Final[tuple[str, ...]] = (
    "Chatushpada",  # Mesha
    "Chatushpada",  # Vrishabha
    "Manava",  # Mithuna
    "Jalachara",  # Karka
    "Vanachara",  # Simha
    "Manava",  # Kanya
    "Manava",  # Tula
    "Keeta",  # Vrischika
    "Manava",  # Dhanu (human half traditionally; treated as Manava here)
    "Chatushpada",  # Makara
    "Manava",  # Kumbha
    "Jalachara",  # Meena
)

# Yoni animal per nakshatra (1-based Ashwini=1). Same animal = 4; friendly = 3; neutral = 2; enemy = 1; deadly = 0.
_YONI_ANIMAL: Final[tuple[str, ...]] = (
    "Ashwa",
    "Gaja",
    "Mesha",
    "Sarpa",
    "Sarpa",
    "Shwana",
    "Marjara",
    "Mesha",
    "Marjara",
    "Mushaka",
    "Mushaka",
    "Gau",
    "Mahisha",
    "Vyaghra",
    "Mahisha",
    "Vyaghra",
    "Mriga",
    "Mriga",
    "Shwana",
    "Vanara",
    "Nakula",
    "Vanara",
    "Simha",
    "Ashwa",
    "Gau",
    "Simha",
    "Gaja",
)

# Enemy yoni pairs (unordered). Everything else that is different is at least neutral.
_YONI_ENEMY: Final[frozenset[frozenset[str]]] = frozenset(
    {
        frozenset({"Ashwa", "Mahisha"}),
        frozenset({"Gaja", "Simha"}),
        frozenset({"Mesha", "Vanara"}),
        frozenset({"Sarpa", "Nakula"}),
        frozenset({"Shwana", "Mriga"}),
        frozenset({"Marjara", "Mushaka"}),
        frozenset({"Gau", "Vyaghra"}),
    }
)

# Friendly yoni pairs (partial classic list). Enemy pairs above win when both apply.
_YONI_FRIEND: Final[frozenset[frozenset[str]]] = frozenset(
    {
        frozenset({"Ashwa", "Gaja"}),
        frozenset({"Gau", "Gaja"}),
        frozenset({"Ashwa", "Gau"}),
    }
)

# Moon-sign lord for Graha Maitri (1-based signs).
_SIGN_LORD: Final[tuple[str, ...]] = (
    "Mars",
    "Venus",
    "Mercury",
    "Moon",
    "Sun",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Saturn",
    "Jupiter",
)

# Permanent friendship: 5 = friends, 4 = neutral, 0 = enemies (points out of 5 for Graha Maitri).
_LORD_FRIENDSHIP: Final[dict[tuple[str, str], int]] = {
    ("Sun", "Moon"): 5,
    ("Sun", "Mars"): 5,
    ("Sun", "Mercury"): 4,
    ("Sun", "Jupiter"): 5,
    ("Sun", "Venus"): 0,
    ("Sun", "Saturn"): 0,
    ("Moon", "Sun"): 5,
    ("Moon", "Mars"): 4,
    ("Moon", "Mercury"): 5,
    ("Moon", "Jupiter"): 4,
    ("Moon", "Venus"): 4,
    ("Moon", "Saturn"): 4,
    ("Mars", "Sun"): 5,
    ("Mars", "Moon"): 5,
    ("Mars", "Mercury"): 4,
    ("Mars", "Jupiter"): 5,
    ("Mars", "Venus"): 4,
    ("Mars", "Saturn"): 4,
    ("Mercury", "Sun"): 5,
    ("Mercury", "Moon"): 0,
    ("Mercury", "Mars"): 4,
    ("Mercury", "Jupiter"): 4,
    ("Mercury", "Venus"): 5,
    ("Mercury", "Saturn"): 4,
    ("Jupiter", "Sun"): 5,
    ("Jupiter", "Moon"): 5,
    ("Jupiter", "Mars"): 5,
    ("Jupiter", "Mercury"): 0,
    ("Jupiter", "Venus"): 0,
    ("Jupiter", "Saturn"): 4,
    ("Venus", "Sun"): 0,
    ("Venus", "Moon"): 0,
    ("Venus", "Mars"): 4,
    ("Venus", "Mercury"): 5,
    ("Venus", "Jupiter"): 4,
    ("Venus", "Saturn"): 5,
    ("Saturn", "Sun"): 0,
    ("Saturn", "Moon"): 0,
    ("Saturn", "Mars"): 0,
    ("Saturn", "Mercury"): 5,
    ("Saturn", "Jupiter"): 4,
    ("Saturn", "Venus"): 5,
}

# Gana per nakshatra: Deva / Manushya / Rakshasa.
_GANA: Final[tuple[str, ...]] = (
    "Deva",
    "Manushya",
    "Rakshasa",
    "Manushya",
    "Deva",
    "Manushya",
    "Deva",
    "Deva",
    "Rakshasa",
    "Rakshasa",
    "Manushya",
    "Manushya",
    "Deva",
    "Rakshasa",
    "Deva",
    "Rakshasa",
    "Deva",
    "Rakshasa",
    "Rakshasa",
    "Manushya",
    "Manushya",
    "Deva",
    "Rakshasa",
    "Rakshasa",
    "Manushya",
    "Manushya",
    "Deva",
)

# Nadi per nakshatra: Adi / Madhya / Antya (repeating).
_NADI: Final[tuple[str, ...]] = (
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
    "Adi",
    "Madhya",
    "Antya",
)

# Mars houses from Lagna that traditionally make a chart Manglik.
_MANGLIK_HOUSES: Final[frozenset[int]] = frozenset({1, 2, 4, 7, 8, 12})

_KOOTA_MAX: Final[dict[str, int]] = {
    "Varna": 1,
    "Vashya": 2,
    "Tara": 3,
    "Yoni": 4,
    "GrahaMaitri": 5,
    "Gana": 6,
    "Bhakoot": 7,
    "Nadi": 8,
}


def _varna_score(boy_sign: int, girl_sign: int) -> KootaScore:
    boy_v, girl_v = _VARNA[boy_sign - 1], _VARNA[girl_sign - 1]
    # Full point when the boy's varna is equal or higher in the traditional hierarchy.
    score = 1.0 if boy_v <= girl_v else 0.0
    return KootaScore(
        name="Varna",
        max_points=_KOOTA_MAX["Varna"],
        score=score,
        detail=f"boy={boy_v} girl={girl_v}",
    )


def _vashya_score(boy_sign: int, girl_sign: int) -> KootaScore:
    boy_g, girl_g = _VASHYA_GROUP[boy_sign - 1], _VASHYA_GROUP[girl_sign - 1]
    if boy_g == girl_g:
        score = 2.0
    elif {boy_g, girl_g} == {"Chatushpada", "Vanachara"}:
        score = 1.0
    elif {boy_g, girl_g} <= {"Manava", "Jalachara", "Chatushpada"}:
        score = 1.0
    else:
        score = 0.0
    return KootaScore(
        name="Vashya",
        max_points=_KOOTA_MAX["Vashya"],
        score=score,
        detail=f"{boy_g}/{girl_g}",
    )


def _tara_score(boy_nak: int, girl_nak: int) -> KootaScore:
    # Count from the girl's nakshatra to the boy's, inclusive, mod 9.
    count = ((boy_nak - girl_nak) % 27) + 1
    rem = count % 9
    # Favourable remainders: 1,2,4,6,8,9 (and 0 as 9).
    favourable = rem in (0, 1, 2, 4, 6, 8)
    score = 3.0 if favourable else 0.0
    # Classic tables also award 1.5 for some middling cases; keep binary for a clear first ship.
    return KootaScore(
        name="Tara",
        max_points=_KOOTA_MAX["Tara"],
        score=score,
        detail=f"count={count} remainder={rem or 9}",
    )


def _yoni_score(boy_nak: int, girl_nak: int) -> KootaScore:
    a, b = _YONI_ANIMAL[boy_nak - 1], _YONI_ANIMAL[girl_nak - 1]
    pair = frozenset({a, b})
    if a == b:
        score = 4.0
    elif pair in _YONI_ENEMY:
        score = 0.0
    elif pair in _YONI_FRIEND:
        score = 3.0
    else:
        score = 2.0
    return KootaScore(
        name="Yoni",
        max_points=_KOOTA_MAX["Yoni"],
        score=score,
        detail=f"{a}/{b}",
    )


def _graha_maitri_score(boy_sign: int, girl_sign: int) -> KootaScore:
    boy_lord, girl_lord = _SIGN_LORD[boy_sign - 1], _SIGN_LORD[girl_sign - 1]
    if boy_lord == girl_lord:
        score = 5.0
    else:
        ab = _LORD_FRIENDSHIP.get((boy_lord, girl_lord), 4)
        ba = _LORD_FRIENDSHIP.get((girl_lord, boy_lord), 4)
        # Average of the two directions, mapped onto the classic 0/0.5/3/4/5 scale coarsely.
        avg = (ab + ba) / 2.0
        if avg >= 5:
            score = 5.0
        elif avg >= 4.5:
            score = 4.0
        elif avg >= 4:
            score = 3.0
        elif avg >= 2:
            score = 1.0
        else:
            score = 0.0
    return KootaScore(
        name="GrahaMaitri",
        max_points=_KOOTA_MAX["GrahaMaitri"],
        score=score,
        detail=f"{boy_lord}/{girl_lord}",
    )


def _gana_score(boy_nak: int, girl_nak: int) -> KootaScore:
    boy_g, girl_g = _GANA[boy_nak - 1], _GANA[girl_nak - 1]
    if boy_g == girl_g:
        score = 6.0
    elif {boy_g, girl_g} == {"Deva", "Manushya"}:
        score = 6.0
    elif {boy_g, girl_g} == {"Manushya", "Rakshasa"}:
        score = 0.0
    elif {boy_g, girl_g} == {"Deva", "Rakshasa"}:
        # Full only when the boy is Deva and the girl Rakshasa is traditionally reduced.
        score = 1.0 if boy_g == "Deva" else 0.0
    else:
        score = 0.0
    return KootaScore(
        name="Gana",
        max_points=_KOOTA_MAX["Gana"],
        score=score,
        detail=f"{boy_g}/{girl_g}",
    )


def _bhakoot_score(boy_sign: int, girl_sign: int) -> KootaScore:
    # Same Moon sign is full. Inclusive count 6 or 8 from the girl is the classic dosha.
    if boy_sign == girl_sign:
        return KootaScore(
            name="Bhakoot",
            max_points=_KOOTA_MAX["Bhakoot"],
            score=7.0,
            detail="same rashi",
        )
    inclusive = ((boy_sign - girl_sign) % 12) + 1
    if inclusive in (6, 8):
        return KootaScore(
            name="Bhakoot",
            max_points=_KOOTA_MAX["Bhakoot"],
            score=0.0,
            detail=f"6/8 dosha (count={inclusive})",
        )
    return KootaScore(
        name="Bhakoot",
        max_points=_KOOTA_MAX["Bhakoot"],
        score=7.0,
        detail=f"count={inclusive}",
    )


def _nadi_score(boy_nak: int, girl_nak: int) -> KootaScore:
    boy_n, girl_n = _NADI[boy_nak - 1], _NADI[girl_nak - 1]
    score = 0.0 if boy_n == girl_n else 8.0
    return KootaScore(
        name="Nadi",
        max_points=_KOOTA_MAX["Nadi"],
        score=score,
        detail=f"{boy_n}/{girl_n}",
    )


def _manglik_person(mars_house: int | None, birth_time_known: bool) -> ManglikPerson:
    if not birth_time_known or mars_house is None:
        return ManglikPerson(
            is_manglik=None,
            mars_house=mars_house,
            notes="Birth time unknown — house-based Manglik cannot be assessed",
        )
    is_manglik = mars_house in _MANGLIK_HOUSES
    return ManglikPerson(
        is_manglik=is_manglik,
        mars_house=mars_house,
        notes=f"Mars in house {mars_house} from Lagna"
        + (" (Manglik houses: 1,2,4,7,8,12)" if is_manglik else " (not in Manglik houses)"),
    )


def compute_ashtakoot(request: AshtakootRequest) -> AshtakootResponse:
    kootas = [
        _varna_score(request.boy_moon_sign, request.girl_moon_sign),
        _vashya_score(request.boy_moon_sign, request.girl_moon_sign),
        _tara_score(request.boy_nakshatra, request.girl_nakshatra),
        _yoni_score(request.boy_nakshatra, request.girl_nakshatra),
        _graha_maitri_score(request.boy_moon_sign, request.girl_moon_sign),
        _gana_score(request.boy_nakshatra, request.girl_nakshatra),
        _bhakoot_score(request.boy_moon_sign, request.girl_moon_sign),
        _nadi_score(request.boy_nakshatra, request.girl_nakshatra),
    ]
    total = sum(k.score for k in kootas)

    manglik: ManglikAssessment | None = None
    if request.include_manglik:
        boy = _manglik_person(request.boy_mars_house, request.boy_birth_time_known)
        girl = _manglik_person(request.girl_mars_house, request.girl_birth_time_known)
        if boy.is_manglik is None or girl.is_manglik is None:
            compatible = None
        else:
            # Both Manglik or neither is the classic compatibility rule for a first ship.
            compatible = boy.is_manglik == girl.is_manglik
        manglik = ManglikAssessment(boy=boy, girl=girl, compatible=compatible)

    return AshtakootResponse(
        total_guna=round(total, 2),
        max_guna=36,
        kootas=kootas,
        manglik=manglik,
        boy_nakshatra=request.boy_nakshatra,
        girl_nakshatra=request.girl_nakshatra,
        boy_moon_sign=request.boy_moon_sign,
        girl_moon_sign=request.girl_moon_sign,
    )
