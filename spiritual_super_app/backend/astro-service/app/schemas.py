from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .prakriti_catalog import PRAKRITI_PARAMETERS


class Dosha(str, Enum):
    VATA = "VATA"
    PITTA = "PITTA"
    KAPHA = "KAPHA"
    TRIDOSHIC = "TRIDOSHIC"


class NatalChartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dob_utc: datetime = Field(description="Birth moment in UTC, ISO-8601 (e.g. 1990-04-17T08:25:00Z)")
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    altitude_metres: float = Field(default=0.0, ge=-500.0, le=9000.0)

    @field_validator("dob_utc")
    @classmethod
    def _require_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("dob_utc must include a timezone offset; supply UTC (…Z)")
        return value


class PlanetPosition(BaseModel):
    body: str
    sidereal_longitude: float = Field(description="Lahiri sidereal longitude in decimal degrees [0,360)")
    sidereal_latitude: float
    degrees_in_sign: float
    zodiac_sign: int = Field(ge=1, le=12, description="1=Aries … 12=Pisces (sidereal)")
    zodiac_sign_name: str
    nakshatra: int = Field(ge=1, le=27)
    nakshatra_name: str
    nakshatra_pada: int = Field(ge=1, le=4)
    house: int = Field(ge=1, le=12, description="Whole-sign bhava counted from the Lagna sign")
    speed_deg_per_day: float
    is_retrograde: bool


class AscendantPosition(BaseModel):
    sidereal_longitude: float
    degrees_in_sign: float
    zodiac_sign: int = Field(ge=1, le=12)
    zodiac_sign_name: str
    nakshatra: int = Field(ge=1, le=27)
    nakshatra_name: str
    nakshatra_pada: int = Field(ge=1, le=4)


class HouseCusp(BaseModel):
    house: int = Field(ge=1, le=12)
    sidereal_longitude: float
    zodiac_sign: int = Field(ge=1, le=12)
    zodiac_sign_name: str


class NatalChartResponse(BaseModel):
    dob_utc: datetime
    julian_day_ut: float
    ayanamsha: float
    ayanamsha_system: Literal["CHITRA_PAKSHA_LAHIRI"] = "CHITRA_PAKSHA_LAHIRI"
    node_type: Literal["TRUE_NODE"] = "TRUE_NODE"
    latitude: float
    longitude: float
    ascendant: AscendantPosition
    planets: list[PlanetPosition]
    house_cusps: list[HouseCusp]


class DashaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    moon_sidereal_longitude: float = Field(ge=0.0, lt=360.0)
    birth_utc: datetime
    depth: int = Field(default=3, ge=1, le=5, description="1=Maha, 2=+Antar, 3=+Pratyantar, 4=+Sookshma, 5=+Prana")
    horizon_years: float = Field(default=120.0, gt=0.0, le=120.0)

    @field_validator("birth_utc")
    @classmethod
    def _require_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("birth_utc must include a timezone offset; supply UTC (…Z)")
        return value


class DashaPeriod(BaseModel):
    level: int = Field(ge=1, le=5)
    level_name: Literal["MAHADASHA", "ANTARDASHA", "PRATYANTARDASHA", "SOOKSHMA_DASHA", "PRANA_DASHA"]
    lord: str
    start_utc: datetime
    end_utc: datetime
    duration_days: float
    children: list["DashaPeriod"] = Field(default_factory=list)


class DashaResponse(BaseModel):
    birth_utc: datetime
    moon_sidereal_longitude: float
    birth_nakshatra: int = Field(ge=1, le=27)
    birth_nakshatra_name: str
    birth_nakshatra_lord: str
    balance_of_dasha_days: float
    depth: int
    periods: list[DashaPeriod]


class PrakritiRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    responses: dict[str, Dosha] = Field(
        description="Exactly 28 parameter keys mapped to the observed VATA/PITTA/KAPHA expression"
    )

    @field_validator("responses")
    @classmethod
    def _validate_parameter_set(cls, value: dict[str, Dosha]) -> dict[str, Dosha]:
        expected = set(PRAKRITI_PARAMETERS)
        received = set(value)
        missing = sorted(expected - received)
        unknown = sorted(received - expected)
        if missing or unknown:
            raise ValueError(
                f"payload must contain exactly the 28 parameters; missing={missing}; unknown={unknown}"
            )
        for key, answer in value.items():
            if answer is Dosha.TRIDOSHIC:
                raise ValueError(f"parameter '{key}' cannot be answered TRIDOSHIC; pick VATA, PITTA or KAPHA")
        return value


class DoshaDistribution(BaseModel):
    vata_percent: float
    pitta_percent: float
    kapha_percent: float


class PrakritiResponse(BaseModel):
    distribution: DoshaDistribution
    weighted_totals: DoshaDistribution
    total_weight: float
    prakriti_primary: Dosha
    prakriti_secondary: Dosha | None
    dominant_guna: str
    digestive_fire: str
    parameters_evaluated: int


DashaPeriod.model_rebuild()
