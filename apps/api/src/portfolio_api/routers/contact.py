from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, Request

from portfolio_api.clients.turnstile import TurnstileUnavailableError, TurnstileVerifier
from portfolio_api.errors import ApiError
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip, client_key
from portfolio_api.schemas.contact import ContactAccepted, ContactRequest
from portfolio_api.services.contact import ContactForm, ContactService

log = structlog.get_logger()
router = APIRouter(prefix="/v1", tags=["contact"])


def get_limiter(request: Request) -> SlidingWindowLimiter:
    return request.app.state.contact_limiter


def get_turnstile(request: Request) -> TurnstileVerifier | None:
    return request.app.state.turnstile


def get_contact_service(request: Request) -> ContactService:
    return request.app.state.contact_service


async def enforce_rate_limit(
    request: Request, limiter: Annotated[SlidingWindowLimiter, Depends(get_limiter)]
) -> None:
    wait = limiter.hit(client_key(client_ip(request) or "unknown"))
    if wait is not None:
        raise ApiError(
            429,
            "rate_limited",
            "Too many messages. Try again later.",
            headers={"Retry-After": str(wait)},
        )


async def require_turnstile(
    turnstile: Annotated[TurnstileVerifier | None, Depends(get_turnstile)],
) -> TurnstileVerifier:
    if turnstile is None:
        raise ApiError(503, "contact_unavailable", "The contact form is not configured.")
    return turnstile


# Dependencies resolve in order before the body is validated: rate limit, then configuration.
@router.post(
    "/contact",
    status_code=202,
    response_model=ContactAccepted,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_contact(
    request: Request,
    background: BackgroundTasks,
    turnstile: Annotated[TurnstileVerifier, Depends(require_turnstile)],
    service: Annotated[ContactService, Depends(get_contact_service)],
    body: ContactRequest,
) -> ContactAccepted:
    if body.website:
        log.info("contact honeypot tripped")
        return ContactAccepted()
    try:
        ok = await turnstile.verify(body.turnstile_token, client_ip(request))
    except TurnstileUnavailableError as exc:
        log.warning("turnstile unavailable", error=str(exc))
        raise ApiError(
            503, "turnstile_unavailable", "Spam check is unavailable. Try again later."
        ) from exc
    if not ok:
        raise ApiError(400, "turnstile_failed", "Spam check failed. Try again.")
    submission_id = await service.submit(
        ContactForm(name=body.name, email=str(body.email), message=body.message)
    )
    background.add_task(service.deliver, submission_id)
    return ContactAccepted()
