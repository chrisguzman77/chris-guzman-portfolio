import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.config import Settings
from portfolio_api.db import make_engine, make_sessionmaker
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


@pytest.fixture
async def db() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Session factory on a migrated Postgres; every app table is emptied before and after."""
    url = os.environ.get("API_DATABASE_URL")
    if not url:
        pytest.fail(
            "DB tests need API_DATABASE_URL pointing at a migrated Postgres (apps/api/README.md)"
        )
    engine = make_engine(url)
    truncate = text(
        "TRUNCATE contact_submissions, github_activity_cache, rag_documents, rag_chunks,"
        " chat_sessions, chat_messages, chat_usage_daily,"
        " newsletter_deliveries, newsletter_sends, newsletter_subscribers"
    )
    async with engine.begin() as conn:
        await conn.execute(truncate)
    yield make_sessionmaker(engine)
    # Empty again: the dev stack shares this database, and a leftover cache row shows up there.
    async with engine.begin() as conn:
        await conn.execute(truncate)
    await engine.dispose()
