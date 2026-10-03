from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from portfolio_api.config import Settings
from portfolio_api.main import create_app


class FakeIndexer:
    def __init__(self) -> None:
        self.requests = 0

    def request_reindex(self) -> None:
        self.requests += 1


def make_app(settings: Settings, secret: str | None = "s3cret") -> tuple[FastAPI, FakeIndexer]:
    app = create_app(settings.model_copy(update={"internal_secret": secret}))
    indexer = FakeIndexer()
    app.state.indexer = indexer
    return app, indexer


async def post(app: FastAPI, headers: dict[str, str]) -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/internal/reindex", headers=headers)


async def test_reindex_with_secret_schedules_a_sync(settings: Settings) -> None:
    app, indexer = make_app(settings)
    res = await post(app, {"X-Internal-Secret": "s3cret"})
    assert res.status_code == 202 and res.json() == {"status": "scheduled"}
    assert indexer.requests == 1


async def test_reindex_is_hidden_without_the_right_secret(settings: Settings) -> None:
    app, indexer = make_app(settings)
    for headers in ({}, {"X-Internal-Secret": "wrong"}, {"X-Internal-Secret": "s3cret-but-longer"}):
        res = await post(app, headers)
        assert res.status_code == 404 and res.json()["error"]["code"] == "not_found"
    assert indexer.requests == 0


async def test_reindex_refuses_requests_through_cloudflare(settings: Settings) -> None:
    app, indexer = make_app(settings)
    res = await post(app, {"X-Internal-Secret": "s3cret", "CF-Connecting-IP": "203.0.113.7"})
    assert res.status_code == 404 and indexer.requests == 0


async def test_reindex_is_hidden_when_no_secret_is_configured(settings: Settings) -> None:
    app, _ = make_app(settings, secret=None)
    assert (await post(app, {"X-Internal-Secret": ""})).status_code == 404


async def test_reindex_without_indexer_is_503(settings: Settings) -> None:
    app, _ = make_app(settings)
    app.state.indexer = None
    res = await post(app, {"X-Internal-Secret": "s3cret"})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "chat_disabled")
