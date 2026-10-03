import hmac

from fastapi import APIRouter, Depends, Request

from portfolio_api.errors import ApiError

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
