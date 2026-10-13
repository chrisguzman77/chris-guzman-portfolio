from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from portfolio_api.errors import ApiError
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip, client_key
from portfolio_api.schemas.status import StatusBadge, StatusResponse
from portfolio_api.services.status import StatusService, uptime_badge

router = APIRouter(prefix="/v1", tags=["status"])

CACHE_CONTROL = "public, max-age=60"


def get_status_service(request: Request) -> StatusService:
    return request.app.state.status_service


async def limit_status(request: Request) -> None:
    limiter: SlidingWindowLimiter = request.app.state.status_limiter
    wait = limiter.hit(client_key(client_ip(request) or "unknown"))
    if wait is not None:
        raise ApiError(
            429,
            "rate_limited",
            "Too many requests. Try again later.",
            headers={"Retry-After": str(wait)},
        )


@router.get("/status", response_model=StatusResponse, dependencies=[Depends(limit_status)])
async def public_status(
    response: Response,
    service: Annotated[StatusService, Depends(get_status_service)],
) -> StatusResponse:
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await service.get()


# shields.io reads this for the README's uptime badge. Same memo and limit as /v1/status.
@router.get("/status/badge", response_model=StatusBadge, dependencies=[Depends(limit_status)])
async def status_badge(
    response: Response,
    service: Annotated[StatusService, Depends(get_status_service)],
) -> StatusBadge:
    response.headers["Cache-Control"] = CACHE_CONTROL
    return uptime_badge((await service.get()).uptime_30d)
