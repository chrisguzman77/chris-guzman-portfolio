from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from portfolio_api.errors import ApiError
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip, client_key
from portfolio_api.schemas.status import StatusResponse
from portfolio_api.services.status import StatusService

router = APIRouter(prefix="/v1", tags=["status"])


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
    response.headers["Cache-Control"] = "public, max-age=60"
    return await service.get()
