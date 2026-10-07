from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

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


async def contact_body(request: Request) -> ContactRequest:
    """Parse the body ourselves: FastAPI decodes a body parameter's JSON before any dependency,
    so malformed JSON would skip the rate limit and the configuration check."""
    # JSON only: a text/plain or form POST is a CORS "simple request" that skips the preflight.
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise ApiError(
            400,
            "invalid_request",
            "Some fields are invalid.",
            fields={"body": "Content-Type must be application/json."},
        )
    try:
        return ContactRequest.model_validate_json(await request.body())
    except ValidationError as exc:
        raise RequestValidationError(
            [{**err, "loc": ("body", *err["loc"])} for err in exc.errors(include_url=False)]
        ) from exc


# Dependencies resolve in order: rate limit, then configuration, then the body.
@router.post(
    "/contact",
    status_code=202,
    response_model=ContactAccepted,
    dependencies=[Depends(enforce_rate_limit)],
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": ContactRequest.model_json_schema()}},
        }
    },
)
async def submit_contact(
    request: Request,
    background: BackgroundTasks,
    turnstile: Annotated[TurnstileVerifier, Depends(require_turnstile)],
    service: Annotated[ContactService, Depends(get_contact_service)],
    body: Annotated[ContactRequest, Depends(contact_body)],
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
