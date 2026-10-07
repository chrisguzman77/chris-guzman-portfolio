import pytest
from httpx import AsyncClient

from portfolio_api.config import Settings

STRICT_CSP = "default-src 'none'; frame-ancestors 'none'"
DOCS_CSP = (
    "default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'; "
    "img-src 'self' data: https://fastapi.tiangolo.com https://cdn.redoc.ly; "
    "font-src https://fonts.gstatic.com; connect-src 'self'; worker-src blob:; "
    "frame-ancestors 'none'"
)

EXPECTED = {
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "referrer-policy": "no-referrer",
    "content-security-policy": STRICT_CSP,
    "cross-origin-resource-policy": "same-site",
}


@pytest.mark.parametrize("path", ["/health", "/does-not-exist", "/openapi.json"])
async def test_every_response_carries_security_headers(client: AsyncClient, path: str):
    res = await client.get(path)
    for name, value in EXPECTED.items():
        assert res.headers[name] == value


@pytest.mark.parametrize("path", ["/docs", "/redoc"])
async def test_docs_pages_get_the_docs_csp_and_other_headers_unchanged(
    client: AsyncClient, path: str
):
    res = await client.get(path)
    assert res.headers["content-security-policy"] == DOCS_CSP
    for name, value in EXPECTED.items():
        if name != "content-security-policy":
            assert res.headers[name] == value


async def test_cors_preflight_allows_and_exposes_request_id(
    client: AsyncClient, settings: Settings
):
    origin = settings.cors_origins[0]
    res = await client.options(
        "/v1/contact",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-request-id",
        },
    )
    assert res.status_code == 200
    assert "x-request-id" in res.headers["access-control-allow-headers"].lower()
    simple = await client.get("/health", headers={"Origin": origin})
    assert "x-request-id" in simple.headers["access-control-expose-headers"].lower()
