from fastapi import APIRouter, Depends, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from portfolio_api.errors import ApiError
from portfolio_api.metrics import REGISTRY

router = APIRouter(include_in_schema=False)


async def refuse_tunnel(request: Request) -> None:
    """404 for anything that came through the Cloudflare Tunnel, the same rule as /internal."""
    if "cf-connecting-ip" in request.headers:
        raise ApiError(404, "not_found", "Not Found")


@router.get("/metrics", dependencies=[Depends(refuse_tunnel)])
async def metrics() -> Response:
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)
