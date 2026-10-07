from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import structlog
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.github import ContributionsSource, GitHubError
from portfolio_api.repositories import github as repo
from portfolio_api.schemas.github import ActivityResponse

log = structlog.get_logger()

STALE_AFTER = timedelta(hours=1)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class GitHubActivityService:
    """Serves the cached calendar; only the background job ever talks to GitHub."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        source: ContributionsSource | None,
        *,
        login: str,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessions = sessions
        self._source = source
        self._login = login
        self._clock = clock

    async def get(self) -> ActivityResponse | None:
        async with self._sessions() as session:
            row = await repo.load(session)
        if row is None:
            return None
        try:
            return ActivityResponse.model_validate({**row.payload, "fetched_at": row.fetched_at})
        except (TypeError, ValidationError) as exc:
            # A corrupt copy reads like no copy; the next refresh overwrites it.
            log.warning("cached github activity unreadable", error=type(exc).__name__)
            return None

    async def refresh(self) -> None:
        if self._source is None:
            return
        try:
            activity = await self._source.fetch(self._login)
        except GitHubError as exc:
            log.warning("github refresh failed; keeping cached copy", error=str(exc))
            return
        async with self._sessions.begin() as session:
            await repo.save(session, activity.model_dump(), self._clock())
        log.info("github activity refreshed", total=activity.total)

    async def refresh_if_stale(self) -> None:
        """The job entry point: logs any failure instead of raising."""
        try:
            async with self._sessions() as session:
                row = await repo.load(session)
            if row is None or self._clock() - row.fetched_at >= STALE_AFTER:
                await self.refresh()
        except Exception:
            log.exception("github refresh failed; keeping cached copy")
