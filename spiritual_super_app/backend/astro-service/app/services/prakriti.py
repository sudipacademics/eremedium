"""Weighted Prakriti (constitution) scoring over the 28-parameter assessment."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from ..prakriti_catalog import (
    AGNI_BY_DOSHA,
    AGNI_MARKER_KEYS,
    CODOMINANCE_TOLERANCE_PERCENT,
    GUNA_BY_DOSHA,
    PRAKRITI_PARAMETERS,
    TRIDOSHIC_SPREAD_PERCENT,
)
from ..schemas import Dosha, DoshaDistribution, PrakritiRequest, PrakritiResponse

_TWO_PLACES = Decimal("0.01")


def _round2(value: Decimal) -> float:
    return float(value.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP))


def compute_prakriti(request: PrakritiRequest) -> PrakritiResponse:
    totals: dict[str, Decimal] = {
        Dosha.VATA.value: Decimal("0"),
        Dosha.PITTA.value: Decimal("0"),
        Dosha.KAPHA.value: Decimal("0"),
    }

    total_weight = Decimal("0")
    for parameter, answer in request.responses.items():
        weight = Decimal(str(PRAKRITI_PARAMETERS[parameter]))
        totals[answer.value] += weight
        total_weight += weight

    percentages = {
        dosha: (total / total_weight * Decimal("100")) if total_weight > 0 else Decimal("0")
        for dosha, total in totals.items()
    }

    ranked = sorted(percentages.items(), key=lambda item: item[1], reverse=True)
    leader, leader_percent = ranked[0]
    runner_up, runner_up_percent = ranked[1]
    _, trailing_percent = ranked[2]

    spread = leader_percent - trailing_percent
    if spread <= Decimal(str(TRIDOSHIC_SPREAD_PERCENT)):
        primary = Dosha.TRIDOSHIC
        secondary: Dosha | None = None
    else:
        primary = Dosha(leader)
        within_tolerance = (leader_percent - runner_up_percent) <= Decimal(str(CODOMINANCE_TOLERANCE_PERCENT))
        secondary = Dosha(runner_up) if within_tolerance else None

    # Agni is read from the three agni-linked markers, falling back to the overall constitution.
    agni_votes: dict[str, int] = {Dosha.VATA.value: 0, Dosha.PITTA.value: 0, Dosha.KAPHA.value: 0}
    for key in AGNI_MARKER_KEYS:
        agni_votes[request.responses[key].value] += 1
    agni_leader, agni_count = max(agni_votes.items(), key=lambda item: item[1])
    agni_dosha = agni_leader if agni_count >= 2 else primary.value

    return PrakritiResponse(
        distribution=DoshaDistribution(
            vata_percent=_round2(percentages[Dosha.VATA.value]),
            pitta_percent=_round2(percentages[Dosha.PITTA.value]),
            kapha_percent=_round2(percentages[Dosha.KAPHA.value]),
        ),
        weighted_totals=DoshaDistribution(
            vata_percent=_round2(totals[Dosha.VATA.value]),
            pitta_percent=_round2(totals[Dosha.PITTA.value]),
            kapha_percent=_round2(totals[Dosha.KAPHA.value]),
        ),
        total_weight=_round2(total_weight),
        prakriti_primary=primary,
        prakriti_secondary=secondary,
        dominant_guna=GUNA_BY_DOSHA[primary.value],
        digestive_fire=AGNI_BY_DOSHA[agni_dosha],
        parameters_evaluated=len(request.responses),
    )
