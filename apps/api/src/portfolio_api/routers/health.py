from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from portfolio_api.schemas.health import HealthResponse

DbPing = Callable[[], Awaitable[bool]]


def get_db_ping(request: Request) -> DbPing:
    return request.app.state.db_ping


def get_version(request: Request) -> str:
    return request.app.state.settings.app_version


router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(
    ping: Annotated[DbPing, Depends(get_db_ping)],
    version: Annotated[str, Depends(get_version)],
) -> HealthResponse:
    db_ok = await ping()
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        version=version,
        db="ok" if db_ok else "unavailable",
    )
