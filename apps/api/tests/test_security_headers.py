import pytest
from httpx import AsyncClient

from portfolio_api.config import Settings

EXPECTED = {
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-site",
}


@pytest.mark.parametrize("path", ["/health", "/does-not-exist"])
async def test_every_response_carries_security_headers(client: AsyncClient, path: str):
    res = await client.get(path)
    for name, value in EXPECTED.items():
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
