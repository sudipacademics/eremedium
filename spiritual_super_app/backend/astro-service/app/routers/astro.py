from fastapi import APIRouter, Depends, HTTPException, status

from ..schemas import (
    DashaRequest,
    DashaResponse,
    NatalChartRequest,
    NatalChartResponse,
    PanchangRequest,
    PanchangResponse,
)
from ..security import require_internal_token
from ..services.dasha import compute_vimshottari_dasha
from ..services.ephemeris import compute_natal_chart
from ..services.panchang import PanchangError, compute_panchang

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


@router.post("/panchang", response_model=PanchangResponse, status_code=status.HTTP_200_OK)
async def panchang(payload: PanchangRequest) -> PanchangResponse:
    try:
        return compute_panchang(payload)
    except PanchangError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
