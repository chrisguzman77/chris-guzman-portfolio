import asyncio
import math
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import structlog

from portfolio_api.clients.prometheus import PrometheusClient, PrometheusError
from portfolio_api.schemas.status import DailyUptime, StatusResponse

log = structlog.get_logger()

NY = ZoneInfo("America/New_York")
DAYS = 30
PROBE_INTERVAL = 30  # seconds between site probes (the Prometheus scrape interval)
MEMO_SECONDS = 60.0

# The PromQL is fixed here. Only numbers this module computes are formatted in; nothing from
# a request ever reaches Prometheus.
#
# Earliest probe sample in the window. timestamp() of a plain selector returns each sample's
# own timestamp, so over a 1-minute-step subquery the minimum is within one probe interval of
# the first real probe. One series over 30 days at 1m is ~43k steps: a few ms, once a minute.
FIRST_PROBE = 'min(min_over_time(timestamp(probe_success{{job="site"}})[{seconds}s:1m]))'
# Successful probes in the `seconds` before the evaluation time. A missing sample adds
# nothing, so time with no probes (VM or Prometheus down) counts as downtime.
SUCCESSES = 'sum(sum_over_time(probe_success{{job="site"}}[{seconds}s]))'
P95 = (
    "histogram_quantile(0.95, sum by (le) (rate("
    'http_request_duration_seconds_bucket{job="api",route!~"/v1/chat/.*"}[24h])))'
)
REQUESTS_SINCE = 'sum(increase(http_requests_total{{job="api"}}[{seconds}s]))'
LAST_BACKUP = "max(backup_last_success_timestamp_seconds)"
LATEST_PROBE = 'max(probe_success{job="site"})'

DbPing = Callable[[], Awaitable[bool]]
Window = tuple[float, int]  # (evaluation time, whole seconds before it)


@dataclass(frozen=True)
class _Day:
    date: date
    start: float  # unix seconds of New York midnight
    end: float  # unix seconds of the next New York midnight (23 h or 25 h later on DST days)


@dataclass(frozen=True)
class _Stats:
    daily: list[float | None]
    uptime_30d: float | None
    p95_ms: int | None
    requests_today: int | None
    last_backup_at: str | None
    probe_ok: bool


def _utcnow() -> datetime:
    return datetime.now(UTC)


def new_york_days(now: datetime) -> list[_Day]:
    """The 30 New York calendar days ending today, oldest first."""
    today = now.astimezone(NY).date()
    days: list[_Day] = []
    for back in range(DAYS - 1, -1, -1):
        day = today - timedelta(days=back)
        start = datetime.combine(day, datetime.min.time(), NY)
        end = datetime.combine(day + timedelta(days=1), datetime.min.time(), NY)
        days.append(_Day(day, start.timestamp(), end.timestamp()))
    return days


def covered(day: _Day, first_probe: float | None, now: float) -> Window | None:
    """The part of ``day`` after the first probe and before now, or None if under one probe."""
    if first_probe is None:
        return None
    start = max(day.start, first_probe)
    seconds = int(min(day.end, now) - start)
    if expected_probes(seconds) < 1:
        return None
    return start + seconds, seconds


def expected_probes(seconds: int) -> int:
    """Whole probes a window of ``seconds`` is sure to hold (it holds this many or one more)."""
    return seconds // PROBE_INTERVAL


def _backup_time(value: float) -> str | None:
    try:
        return datetime.fromtimestamp(value, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, OverflowError, OSError):  # NaN, inf or a year outside datetime's range
        return None


class StatusService:
    """The homepage status card's numbers, from Prometheus, memoized for 60 s."""

    def __init__(
        self,
        prometheus: PrometheusClient,
        db_ping: DbPing,
        *,
        now: Callable[[], datetime] = _utcnow,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._prometheus = prometheus
        self._db_ping = db_ping
        self._now = now
        self._monotonic = monotonic
        self._lock = asyncio.Lock()
        self._cached: StatusResponse | None = None
        self._cached_at = 0.0

    async def get(self) -> StatusResponse:
        async with self._lock:  # one refresh at a time; waiters get its result
            if self._cached is None or self._monotonic() - self._cached_at >= MEMO_SECONDS:
                self._cached = await self._compute()
                self._cached_at = self._monotonic()
            return self._cached

    async def _compute(self) -> StatusResponse:
        now = self._now()
        days = new_york_days(now)
        db_ok, stats = await asyncio.gather(self._db_ping(), self._stats(now.timestamp(), days))
        if stats is None:
            return StatusResponse(
                status="degraded",
                uptime_30d=None,
                daily=[DailyUptime(date=d.date.isoformat(), uptime=None) for d in days],
                p95_ms=None,
                requests_today=None,
                last_backup_at=None,
            )
        return StatusResponse(
            status="operational" if db_ok and stats.probe_ok else "degraded",
            uptime_30d=stats.uptime_30d,
            daily=[
                DailyUptime(date=d.date.isoformat(), uptime=u)
                for d, u in zip(days, stats.daily, strict=True)
            ],
            p95_ms=stats.p95_ms,
            requests_today=stats.requests_today,
            last_backup_at=stats.last_backup_at,
        )

    async def _stats(self, now: float, days: list[_Day]) -> _Stats | None:
        query = self._prometheus.query
        try:
            first, p95, requests, backup, probe = await asyncio.gather(
                query(FIRST_PROBE.format(seconds=math.ceil(now - days[0].start) + 60), now),
                query(P95, now),
                query(REQUESTS_SINCE.format(seconds=max(1, int(now - days[-1].start))), now),
                query(LAST_BACKUP, now),
                query(LATEST_PROBE, now),
            )
            first_probe = first[0] if first else None
            windows = [covered(day, first_probe, now) for day in days]
            successes = await asyncio.gather(*(self._successes(w) for w in windows))
        except PrometheusError as exc:
            log.warning("prometheus unavailable; status degraded", error=str(exc))
            return None
        daily: list[float | None] = []
        total_successes = 0.0
        total_expected = 0
        for window, ok in zip(windows, successes, strict=True):
            if window is None or ok is None or not math.isfinite(ok):
                daily.append(None)
                continue
            expected = expected_probes(window[1])
            capped = min(ok, expected)  # duplicate samples cannot push a day above 100%
            daily.append(round(capped / expected, 4))
            total_successes += capped
            total_expected += expected
        requests_total = sum(requests)
        p95_seconds = p95[0] if p95 else math.nan
        return _Stats(
            daily=daily,
            uptime_30d=round(total_successes / total_expected, 4) if total_expected else None,
            p95_ms=round(p95_seconds * 1000) if math.isfinite(p95_seconds) else None,
            requests_today=round(requests_total) if math.isfinite(requests_total) else None,
            last_backup_at=_backup_time(backup[0]) if backup else None,
            probe_ok=bool(probe) and probe[0] == 1.0,
        )

    async def _successes(self, window: Window | None) -> float | None:
        if window is None:
            return None
        at, seconds = window
        return sum(await self._prometheus.query(SUCCESSES.format(seconds=seconds), at))
