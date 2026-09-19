import hmac
import os

from fastapi import Header, HTTPException, status

from .config import get_settings


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """Guard for service-to-service calls originating from the Node core gateway."""
    expected = get_settings().internal_service_token
    if not expected:
        # Empty token is only tolerable in local/test; production compose always injects one.
        env = os.environ.get("NODE_ENV", os.environ.get("ENVIRONMENT", "production")).lower()
        if env in {"development", "dev", "test"}:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_SERVICE_TOKEN is not configured",
        )
    if x_internal_token is None or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal service token",
        )
