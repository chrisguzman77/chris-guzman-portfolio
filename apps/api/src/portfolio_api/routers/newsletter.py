from typing import Annotated
from urllib.parse import quote

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import RedirectResponse

from portfolio_api.clients.turnstile import TurnstileUnavailableError, TurnstileVerifier
from portfolio_api.errors import ApiError
from portfolio_api.json_body import parse_json_body
from portfolio_api.metrics import NEWSLETTER_SUBSCRIBE_REQUESTS
from portfolio_api.ratelimit import client_ip, client_key
from portfolio_api.schemas.newsletter import (
    Confirmed,
    SubscribeAccepted,
    SubscribeRequest,
    TokenRequest,
    Unsubscribed,
)
from portfolio_api.services.newsletter import NewsletterService

log = structlog.get_logger()
router = APIRouter(prefix="/v1/newsletter", tags=["newsletter"])


def _json_schema(model: type[SubscribeRequest] | type[TokenRequest]) -> dict[str, object]:
    return {
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": model.model_json_schema()}},
        }
    }


async def enforce_rate_limit(request: Request) -> None:
    wait = request.app.state.newsletter_limiter.hit(client_key(client_ip(request) or "unknown"))
    if wait is not None:
        NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="rejected").inc()
        raise ApiError(
            429,
            "rate_limited",
            "Too many tries. Try again later.",
            headers={"Retry-After": str(wait)},
        )


async def require_service(request: Request) -> NewsletterService:
    service: NewsletterService | None = request.app.state.newsletter_service
    if service is None:
        raise ApiError(503, "newsletter_unavailable", "Subscriptions are not configured.")
    return service


async def subscribe_body(request: Request) -> SubscribeRequest:
    return await parse_json_body(request, SubscribeRequest)


async def token_body(request: Request) -> TokenRequest:
    return await parse_json_body(request, TokenRequest)


def _invalid_token() -> ApiError:
    return ApiError(400, "invalid_token", "This link has expired or is not valid.")


# Dependencies resolve in order: rate limit, then configuration, then the body.
@router.post(
    "/subscribe",
    status_code=202,
    response_model=SubscribeAccepted,
    dependencies=[Depends(enforce_rate_limit)],
    openapi_extra=_json_schema(SubscribeRequest),
)
async def subscribe(
    request: Request,
    background: BackgroundTasks,
    service: Annotated[NewsletterService, Depends(require_service)],
    body: Annotated[SubscribeRequest, Depends(subscribe_body)],
) -> SubscribeAccepted:
    if body.website:
        NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="rejected").inc()
        log.info("newsletter honeypot tripped")
        return SubscribeAccepted()
    # The service exists only when the Turnstile secret is set (main.py).
    turnstile: TurnstileVerifier = request.app.state.turnstile
    try:
        ok = await turnstile.verify(body.turnstile_token, client_ip(request))
    except TurnstileUnavailableError as exc:
        log.warning("turnstile unavailable", error=str(exc))
        raise ApiError(
            503, "turnstile_unavailable", "Spam check is unavailable. Try again later."
        ) from exc
    if not ok:
        NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="rejected").inc()
        raise ApiError(400, "turnstile_failed", "Spam check failed. Try again.")
    email = str(body.email)
    token = await service.subscribe(email)
    NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="accepted").inc()
    if token is not None:
        background.add_task(service.send_confirmation, email, token)
    return SubscribeAccepted()


@router.post("/confirm", response_model=Confirmed, openapi_extra=_json_schema(TokenRequest))
async def confirm(
    service: Annotated[NewsletterService, Depends(require_service)],
    body: Annotated[TokenRequest, Depends(token_body)],
) -> Confirmed:
    if not await service.confirm(body.token):
        raise _invalid_token()
    return Confirmed()


@router.get("/unsubscribe", include_in_schema=False)
async def unsubscribe_link(request: Request, token: str | None = None) -> RedirectResponse:
    """The List-Unsubscribe URL opened in a browser. Never unsubscribes: mail scanners
    open links, so it redirects to the site's page, which acts only on a button click."""
    page = f"{request.app.state.settings.site_url.rstrip('/')}/newsletter/unsubscribe"
    if token:
        page += f"?token={quote(token[:200], safe='')}"
    return RedirectResponse(page, status_code=303)


@router.post("/unsubscribe", response_model=Unsubscribed)
async def unsubscribe(
    request: Request, service: Annotated[NewsletterService, Depends(require_service)]
) -> Unsubscribed:
    """Token from the JSON body (the site's page), or from the query string for the
    RFC 8058 one-click POST, whose form body (List-Unsubscribe=One-Click) is ignored."""
    token = request.query_params.get("token")
    if token is None:
        token = (await parse_json_body(request, TokenRequest)).token
    if not await service.unsubscribe(token[:200]):
        raise _invalid_token()
    return Unsubscribed()
