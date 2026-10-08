import hmac
import uuid
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from portfolio_api.clients.directus import DirectusError
from portfolio_api.errors import ApiError
from portfolio_api.json_body import parse_json_body
from portfolio_api.models import SubscriberStatus
from portfolio_api.schemas.newsletter import (
    SendRequest,
    SendResponse,
    SubscriberList,
    SubscriberOut,
    SubscriberTotals,
)
from portfolio_api.services.newsletter import NewsletterService, SendRefusedError

router = APIRouter(prefix="/internal", include_in_schema=False)


async def require_internal(request: Request) -> None:
    """404 unless the secret matches and the call did not come through the Cloudflare Tunnel."""
    expected: str | None = request.app.state.settings.internal_secret
    given = request.headers.get("x-internal-secret", "")
    if (
        not expected
        or "cf-connecting-ip" in request.headers
        or not hmac.compare_digest(given.encode(), expected.encode())
    ):
        raise ApiError(404, "not_found", "Not Found")


@router.post("/reindex", status_code=202, dependencies=[Depends(require_internal)])
async def reindex(request: Request) -> dict[str, str]:
    indexer = request.app.state.indexer
    if indexer is None:
        raise ApiError(503, "chat_disabled", "Indexing is not configured.")
    indexer.request_reindex()
    return {"status": "scheduled"}


def newsletter_service(request: Request) -> NewsletterService:
    service: NewsletterService | None = request.app.state.newsletter_service
    if service is None:
        raise ApiError(503, "newsletter_unavailable", "Subscriptions are not configured.")
    return service


async def send_body(request: Request) -> SendRequest:
    return await parse_json_body(request, SendRequest)


Newsletter = Annotated[NewsletterService, Depends(newsletter_service)]


# require_internal runs first (decorator dependencies), so callers without the secret
# learn nothing about the configuration.
@router.post("/newsletter/send", dependencies=[Depends(require_internal)])
async def newsletter_send(
    service: Newsletter, body: Annotated[SendRequest, Depends(send_body)]
) -> JSONResponse:
    try:
        result = await service.send(body.post_id, test=body.test)
    except SendRefusedError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from exc
    except DirectusError as exc:
        raise ApiError(
            502, "directus_unavailable", "Couldn't read the post from Directus."
        ) from exc
    payload = SendResponse(**asdict(result)).model_dump(mode="json")
    return JSONResponse(payload, status_code=207 if result.status == "partial" else 200)


@router.get(
    "/newsletter/subscribers",
    response_model=SubscriberList,
    dependencies=[Depends(require_internal)],
)
async def newsletter_subscribers(service: Newsletter) -> SubscriberList:
    rows, totals = await service.subscribers()
    return SubscriberList(
        subscribers=[SubscriberOut.model_validate(row, from_attributes=True) for row in rows],
        totals=SubscriberTotals(
            confirmed=totals[SubscriberStatus.confirmed], pending=totals[SubscriberStatus.pending]
        ),
    )


@router.delete(
    "/newsletter/subscribers/{subscriber_id}",
    status_code=204,
    dependencies=[Depends(require_internal)],
)
async def newsletter_remove(subscriber_id: uuid.UUID, service: Newsletter) -> None:
    await service.remove(subscriber_id)
