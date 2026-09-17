from httpx import ASGITransport, AsyncClient

from portfolio_api.config import Settings
from portfolio_api.main import create_app


async def test_health_is_degraded_when_db_unreachable(client: AsyncClient) -> None:
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "degraded", "version": "test", "db": "unavailable"}


async def test_health_is_ok_when_db_reachable(settings: Settings) -> None:
    app = create_app(settings)

    async def fake_ping() -> bool:
        return True

    app.state.db_ping = fake_ping
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.get("/health")
    assert res.json() == {"status": "ok", "version": "test", "db": "ok"}
