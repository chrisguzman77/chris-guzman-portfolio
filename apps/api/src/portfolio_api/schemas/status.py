from typing import Literal

from pydantic import BaseModel


class DailyUptime(BaseModel):
    date: str  # YYYY-MM-DD, an America/New_York calendar day
    uptime: float | None


class StatusResponse(BaseModel):
    status: Literal["operational", "degraded"]
    uptime_30d: float | None
    daily: list[DailyUptime]
    p95_ms: int | None
    requests_today: int | None
    last_backup_at: str | None  # ISO 8601 UTC, e.g. 2026-10-03T07:31:12Z
