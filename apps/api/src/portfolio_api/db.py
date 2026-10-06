from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(url: str) -> AsyncEngine:
    # hide_parameters keeps visitor data (names, emails, questions) out of error messages.
    return create_async_engine(url, pool_pre_ping=True, hide_parameters=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def ping(engine: AsyncEngine) -> bool:
    """True if the database answers ``SELECT 1``; False on any connection or query error."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # any driver error means "unavailable"
        return False
    return True
