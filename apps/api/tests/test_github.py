import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.github import GitHubError, GitHubGraphQL
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.schemas.github import Activity, ActivityDay, ActivityWeek
from portfolio_api.services.github import GitHubActivityService

Sessions = async_sessionmaker[AsyncSession]

ACTIVITY = Activity(
    total=3,
    weeks=[
        ActivityWeek(
            days=[
                ActivityDay(date="2026-09-13", count=0, level=0),
                ActivityDay(date="2026-09-14", count=3, level=4),
            ]
        )
    ],
)


class FakeSource:
    def __init__(self, result: Activity | Exception = ACTIVITY) -> None:
        self.result = result
        self.calls = 0

    async def fetch(self, login: str) -> Activity:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


GRAPHQL_OK: dict[str, Any] = {
    "data": {
        "user": {
            "contributionsCollection": {
                "contributionCalendar": {
                    "totalContributions": 3,
                    "weeks": [
                        {
                            "contributionDays": [
                                {
                                    "date": "2026-09-13",
                                    "contributionCount": 0,
                                    "contributionLevel": "NONE",
                                },
                                {
                                    "date": "2026-09-14",
                                    "contributionCount": 3,
                                    "contributionLevel": "FOURTH_QUARTILE",
                                },
                            ]
                        }
                    ],
                }
            }
        }
    }
}


async def test_graphql_client_maps_the_calendar() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=GRAPHQL_OK)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    activity = await GitHubGraphQL(http, "gh_tok").fetch("chrisguzman77")
    assert activity == ACTIVITY
    assert seen[0].headers["authorization"] == "bearer gh_tok"
    assert json.loads(seen[0].content)["variables"] == {"login": "chrisguzman77"}


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, json={"message": "Bad credentials"}),
        httpx.Response(200, json={"errors": [{"message": "rate limited"}]}),
        httpx.Response(200, json={"data": {"user": None}}),
        httpx.Response(200, text="<html>"),
    ],
)
async def test_graphql_failures_raise_github_error(response: httpx.Response) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response))
    with pytest.raises(GitHubError):
        await GitHubGraphQL(http, "gh_tok").fetch("chrisguzman77")


async def test_refresh_stores_and_get_returns_it(db: Sessions) -> None:
    clock = Clock()
    service = GitHubActivityService(db, FakeSource(), login="chrisguzman77", clock=clock)
    assert await service.get() is None
    await service.refresh()
    got = await service.get()
    assert got is not None
    assert got.total == 3 and got.weeks == ACTIVITY.weeks
    assert got.fetched_at == clock.now


async def test_failed_refresh_keeps_the_old_copy(db: Sessions) -> None:
    clock = Clock()
    await GitHubActivityService(db, FakeSource(), login="x", clock=clock).refresh()
    failing = GitHubActivityService(db, FakeSource(GitHubError("down")), login="x", clock=clock)
    await failing.refresh()
    got = await failing.get()
    assert got is not None and got.total == 3


async def test_refresh_if_stale_only_refreshes_after_an_hour(db: Sessions) -> None:
    clock = Clock()
    source = FakeSource()
    service = GitHubActivityService(db, source, login="x", clock=clock)
    await service.refresh_if_stale()  # nothing cached
    assert source.calls == 1
    clock.now += timedelta(minutes=59)
    await service.refresh_if_stale()
    assert source.calls == 1
    clock.now += timedelta(minutes=1)
    await service.refresh_if_stale()
    assert source.calls == 2


async def test_without_a_token_refresh_is_a_no_op(db: Sessions) -> None:
    service = GitHubActivityService(db, None, login="x")
    await service.refresh()
    assert await service.get() is None


async def test_endpoint_serves_the_cache_with_max_age(settings: Settings, db: Sessions) -> None:
    app = create_app(settings)
    service = GitHubActivityService(db, FakeSource(), login="x")
    app.state.github_activity = service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        empty = await c.get("/v1/github/activity")
        await service.refresh()
        full = await c.get("/v1/github/activity")

    assert empty.status_code == 503
    assert empty.json()["error"]["code"] == "activity_unavailable"
    assert empty.headers["cache-control"] == "no-store"
    assert full.status_code == 200
    assert full.headers["cache-control"] == "public, max-age=300"
    body = full.json()
    assert body["total"] == 3
    assert body["weeks"][0]["days"][1] == {"date": "2026-09-14", "count": 3, "level": 4}
    assert "fetched_at" in body
