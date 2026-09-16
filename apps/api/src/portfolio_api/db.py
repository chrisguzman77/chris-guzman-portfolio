from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


async def ping(engine: AsyncEngine) -> bool:
    """True if the database answers ``SELECT 1``; False on any connection or query error."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # any driver error means "unavailable"
        return False
    return True
