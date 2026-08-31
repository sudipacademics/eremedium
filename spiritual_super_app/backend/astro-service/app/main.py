import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import swisseph as swe
from fastapi import FastAPI
from fastapi.responses import ORJSONResponse

from . import __version__
from .config import get_settings
from .routers import astro, ayurveda
from .services.ephemeris import (
    EphemerisDataMissingError,
    initialise_ephemeris,
    shutdown_ephemeris,
    verify_ephemeris_files,
)

logger = logging.getLogger("astro-service")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    initialise_ephemeris()
    logger.info(
        "Swiss Ephemeris ready (path=%s, files=%s, ayanamsha=SIDM_LAHIRI, node=TRUE_NODE, swe=%s)",
        settings.ephemeris_path,
        ",".join(verify_ephemeris_files()),
        swe.version,
    )
    try:
        yield
    finally:
        shutdown_ephemeris()
        logger.info("Swiss Ephemeris closed")


app = FastAPI(
    title="Vedic Astro & Ayurveda Compute Service",
    version=__version__,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.include_router(astro.router)
app.include_router(ayurveda.router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, object]:
    settings = get_settings()
    try:
        files = verify_ephemeris_files()
        ephemeris_status = "ok"
        detail: str | None = None
    except EphemerisDataMissingError as exc:
        files = []
        ephemeris_status = "degraded"
        detail = str(exc)

    return {
        "status": "ok" if ephemeris_status == "ok" else "degraded",
        "version": __version__,
        "swisseph": str(swe.version),
        "ephemeris_path": str(settings.ephemeris_path),
        "ephemeris_files": files,
        "ephemeris_status": ephemeris_status,
        "ephemeris_detail": detail,
        "ayanamsha": "CHITRA_PAKSHA_LAHIRI",
        "node_type": "TRUE_NODE",
    }
