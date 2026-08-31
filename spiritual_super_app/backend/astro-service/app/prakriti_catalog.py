"""The 28 classical Prakriti assessment parameters and their diagnostic weights.

Weighting follows Ayurvedic practice: structural/biological markers that are stable across a
lifetime (frame, skin, hair, joints) carry more evidentiary value for *Prakriti* than transient
behavioural markers, which lean toward *Vikriti*.
"""

from typing import Final

PRAKRITI_PARAMETERS: Final[dict[str, float]] = {
    # Structural / biological markers (stable) — weight 3.0
    "body_frame": 3.0,
    "body_weight_tendency": 3.0,
    "skin_texture": 3.0,
    "skin_temperature": 3.0,
    "hair_quality": 3.0,
    "nail_quality": 3.0,
    "teeth_and_gums": 3.0,
    "joint_structure": 3.0,
    "eye_characteristics": 3.0,
    "voice_and_speech": 3.0,
    # Physiological function markers — weight 2.0
    "appetite_pattern": 2.0,
    "digestive_fire_agni": 2.0,
    "bowel_pattern": 2.0,
    "urination_pattern": 2.0,
    "perspiration": 2.0,
    "thirst_level": 2.0,
    "sleep_pattern": 2.0,
    "thermal_tolerance": 2.0,
    "pulse_character": 2.0,
    "menstrual_or_hormonal_pattern": 2.0,
    # Behavioural / psychological markers (more transient) — weight 1.0
    "energy_and_stamina": 1.0,
    "physical_activity_style": 1.0,
    "memory_pattern": 1.0,
    "learning_style": 1.0,
    "emotional_response_to_stress": 1.0,
    "decision_making_style": 1.0,
    "speech_pace_in_conversation": 1.0,
    "dream_pattern": 1.0,
}

GUNA_BY_DOSHA: Final[dict[str, str]] = {
    "VATA": "RAJASIC_MOBILE",
    "PITTA": "RAJASIC_SATTVIC",
    "KAPHA": "SATTVIC_TAMASIC",
    "TRIDOSHIC": "SATTVIC_BALANCED",
}

# Agni (digestive fire) classification driven by the dominant dosha and the two agni-linked markers.
AGNI_BY_DOSHA: Final[dict[str, str]] = {
    "VATA": "VISHAMA_IRREGULAR",
    "PITTA": "TIKSHNA_SHARP",
    "KAPHA": "MANDA_SLOW",
    "TRIDOSHIC": "SAMA_BALANCED",
}

AGNI_MARKER_KEYS: Final[tuple[str, str, str]] = (
    "digestive_fire_agni",
    "appetite_pattern",
    "bowel_pattern",
)

# A dosha is considered co-dominant when it sits within this many percentage points of the leader.
CODOMINANCE_TOLERANCE_PERCENT: Final[float] = 5.0
TRIDOSHIC_SPREAD_PERCENT: Final[float] = 5.0
