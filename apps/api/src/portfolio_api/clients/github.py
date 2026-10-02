from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from portfolio_api.schemas.github import Activity, ActivityDay, ActivityWeek

GRAPHQL_URL = "https://api.github.com/graphql"
QUERY = """
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}
"""

Level = Literal["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"]
LEVELS: dict[Level, int] = {
    "NONE": 0,
    "FIRST_QUARTILE": 1,
    "SECOND_QUARTILE": 2,
    "THIRD_QUARTILE": 3,
    "FOURTH_QUARTILE": 4,
}


class GitHubError(Exception):
    """GitHub did not return a usable calendar. Never contains the token."""


class ContributionsSource(Protocol):
    async def fetch(self, login: str) -> Activity: ...


# GraphQL field names are camelCase; these models mirror the response exactly.
class _Day(BaseModel):
    date: str
    contributionCount: int
    contributionLevel: Level


class _Week(BaseModel):
    contributionDays: list[_Day]


class _Calendar(BaseModel):
    totalContributions: int
    weeks: list[_Week]


class _Collection(BaseModel):
    contributionCalendar: _Calendar


class _User(BaseModel):
    contributionsCollection: _Collection


class _Data(BaseModel):
    user: _User | None


class _Response(BaseModel):
    data: _Data | None = None
    errors: list[dict[str, object]] | None = None


class GitHubGraphQL:
    def __init__(self, http: httpx.AsyncClient, token: str) -> None:
        self._http = http
        self._token = token

    async def fetch(self, login: str) -> Activity:
        try:
            res = await self._http.post(
                GRAPHQL_URL,
                json={"query": QUERY, "variables": {"login": login}},
                headers={"Authorization": f"bearer {self._token}"},
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            raise GitHubError(f"request failed: {type(exc).__name__}") from exc
        if res.status_code != 200:
            raise GitHubError(f"github {res.status_code}")
        try:
            parsed = _Response.model_validate_json(res.content)
        except ValidationError as exc:
            raise GitHubError("unexpected response shape") from exc
        if parsed.errors:
            raise GitHubError(f"graphql errors: {len(parsed.errors)}")
        if parsed.data is None or parsed.data.user is None:
            raise GitHubError(f"user {login!r} not found")
        calendar = parsed.data.user.contributionsCollection.contributionCalendar
        return Activity(
            total=calendar.totalContributions,
            weeks=[
                ActivityWeek(
                    days=[
                        ActivityDay(
                            date=d.date,
                            count=d.contributionCount,
                            level=LEVELS[d.contributionLevel],
                        )
                        for d in week.contributionDays
                    ]
                )
                for week in calendar.weeks
            ],
        )
