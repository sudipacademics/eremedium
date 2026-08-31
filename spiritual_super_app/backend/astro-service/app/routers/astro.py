from fastapi import APIRouter, Depends, HTTPException, status

from ..schemas import DashaRequest, DashaResponse, NatalChartRequest, NatalChartResponse
from ..security import require_internal_token
from ..services.dasha import compute_vimshottari_dasha
from ..services.ephemeris import compute_natal_chart

router = APIRouter(
    prefix="/api/v1/astro",
    tags=["astro"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/natal-chart", response_model=NatalChartResponse, status_code=status.HTTP_200_OK)
async def natal_chart(payload: NatalChartRequest) -> NatalChartResponse:
    try:
        return compute_natal_chart(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/vimshottari-dasha", response_model=DashaResponse, status_code=status.HTTP_200_OK)
async def vimshottari_dasha(payload: DashaRequest) -> DashaResponse:
    return compute_vimshottari_dasha(payload)
