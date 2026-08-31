from fastapi import APIRouter, Depends, status

from ..prakriti_catalog import PRAKRITI_PARAMETERS
from ..schemas import PrakritiRequest, PrakritiResponse
from ..security import require_internal_token
from ..services.prakriti import compute_prakriti

router = APIRouter(
    prefix="/api/v1/ayurveda",
    tags=["ayurveda"],
    dependencies=[Depends(require_internal_token)],
)


@router.get("/prakriti-parameters", status_code=status.HTTP_200_OK)
async def prakriti_parameters() -> dict[str, object]:
    """The canonical 28-parameter questionnaire definition consumed by the client apps."""
    return {
        "count": len(PRAKRITI_PARAMETERS),
        "allowed_answers": ["VATA", "PITTA", "KAPHA"],
        "parameters": [
            {"key": key, "weight": weight} for key, weight in PRAKRITI_PARAMETERS.items()
        ],
    }


@router.post("/prakriti-score", response_model=PrakritiResponse, status_code=status.HTTP_200_OK)
async def prakriti_score(payload: PrakritiRequest) -> PrakritiResponse:
    return compute_prakriti(payload)
