from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import GitHubActivityCache

CACHE_KEY = "contributions"


async def load(session: AsyncSession) -> GitHubActivityCache | None:
    return await session.get(GitHubActivityCache, CACHE_KEY)


async def save(session: AsyncSession, payload: dict[str, Any], fetched_at: datetime) -> None:
    stmt = insert(GitHubActivityCache).values(key=CACHE_KEY, payload=payload, fetched_at=fetched_at)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[GitHubActivityCache.key],
            set_={"payload": stmt.excluded.payload, "fetched_at": stmt.excluded.fetched_at},
        )
    )
