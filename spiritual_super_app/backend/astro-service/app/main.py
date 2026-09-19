import logging
import os
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

_is_dev = os.environ.get("NODE_ENV", os.environ.get("ENVIRONMENT", "production")).lower() in {
    "development",
    "dev",
    "test",
}


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
    # Docs expose every internal compute shape; leave them off outside local/dev.
    docs_url="/docs" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)

app.include_router(astro.router)
app.include_router(ayurveda.router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, object]:
    try:
        verify_ephemeris_files()
        ephemeris_ok = True
    except EphemerisDataMissingError:
        ephemeris_ok = False

    return {
        "status": "ok" if ephemeris_ok else "degraded",
        "version": __version__,
    }
