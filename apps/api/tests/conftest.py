from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from portfolio_api.config import Settings
from portfolio_api.main import create_app


@pytest.fixture
def settings() -> Settings:
    # Port 1 refuses connections immediately, so "db unavailable" paths are fast.
    return Settings(
        database_url="postgresql+asyncpg://nobody:nobody@127.0.0.1:1/portfolio",
        app_version="test",
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
