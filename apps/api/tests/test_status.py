import asyncio
import math
import re
import time
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from portfolio_api.clients.prometheus import HttpPrometheus, PrometheusError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.services import status
from portfolio_api.services.status import LAST_BACKUP, LATEST_PROBE, P95, StatusService

NOW = datetime(2026, 10, 3, 16, 0, tzinfo=UTC)  # noon in New York (EDT)
FIRST = datetime(2026, 9, 20, 4, 0, tzinfo=UTC).timestamp()  # midnight Sep 20 in New York
BACKUP = datetime(2026, 10, 3, 7, 31, 12, tzinfo=UTC).timestamp()


class FakePrometheus:
    """A probe every 30 s from ``first`` until ``now``, minus probes inside ``gaps``."""

    def __init__(
        self,
        *,
        now: datetime = NOW,
        first: float | None = FIRST,
        gaps: Sequence[tuple[datetime, datetime]] = (),
        failed: Sequence[tuple[datetime, datetime]] = (),
        extra: int = 0,
        p95: Sequence[float] = (0.08449,),
        requests: Sequence[float] = (1203.6,),
        backup: Sequence[float] = (BACKUP,),
        probe: Sequence[float] = (1.0,),
        error: PrometheusError | None = None,
    ) -> None:
        self.now = now.timestamp()
        self.first = first
        # Gaps have no samples; failed ranges have probe_success=0 samples. Both add no successes.
        self.gaps = [(a.timestamp(), b.timestamp()) for a, b in [*gaps, *failed]]
        self.extra = extra  # duplicate successes returned for every window
        self.p95 = list(p95)
        self.requests = list(requests)
        self.backup = list(backup)
        self.probe = list(probe)
        self.error = error
        self.calls: list[tuple[str, float]] = []

    def probes(self, lo: float, hi: float) -> int:
        """Probes at first + 30k (k >= 0, not after now) with lo < t <= hi."""
        if self.first is None:
            return 0
        hi = min(hi, self.now)
        k_max = math.floor((hi - self.first) / 30)
        k_min = 0 if lo < self.first else math.floor((lo - self.first) / 30) + 1
        return max(0, k_max - k_min + 1)

    def successes(self, lo: float, hi: float) -> int:
        missing = sum(
            self.probes(max(lo, g0), min(hi, g1)) for g0, g1 in self.gaps if g0 < hi and lo < g1
        )
        return self.probes(lo, hi) - missing

    async def query(self, promql: str, at: float) -> list[float]:
        self.calls.append((promql, at))
        if self.error is not None:
            raise self.error
        if "timestamp(" in promql:
            return [] if self.first is None else [self.first]
        if "sum_over_time" in promql:
            match = re.search(r"\[(\d+)s\]", promql)
            assert match is not None
            ok = self.successes(at - int(match.group(1)), at) + self.extra
            return [float(ok)] if ok else []
        if "increase(" in promql:
            return self.requests
        if promql == P95:
            return self.p95
        if promql == LAST_BACKUP:
            return self.backup
        if promql == LATEST_PROBE:
            return self.probe
        raise AssertionError(f"unexpected query: {promql}")

    def ranges(self, needle: str) -> list[int]:
        found: list[int] = []
        for promql, _ in self.calls:
            match = re.search(r"\[(\d+)s\]", promql)
            if needle in promql and match is not None:
                found.append(int(match.group(1)))
        return found


async def db_up() -> bool:
    return True


async def db_down() -> bool:
    return False


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def service(
    prometheus: FakePrometheus,
    *,
    now: datetime = NOW,
    db_ok: bool = True,
    monotonic: Clock | None = None,
) -> StatusService:
    return StatusService(
        prometheus,
        db_up if db_ok else db_down,
        now=lambda: now,
        monotonic=monotonic or Clock(),
    )


def dates(last: date) -> list[str]:
    return [(last - timedelta(days=n)).isoformat() for n in range(29, -1, -1)]


def uptime(body: dict[str, Any], day: str) -> float | None:
    [entry] = [d for d in body["daily"] if d["date"] == day]
    return entry["uptime"]


async def test_operational() -> None:
    body = (await service(FakePrometheus()).get()).model_dump()
    assert body == {
        "status": "operational",
        "uptime_30d": 1.0,
        "daily": [
            {"date": d, "uptime": None if d < "2026-09-20" else 1.0}
            for d in dates(date(2026, 10, 3))
        ],
        "p95_ms": 84,
        "requests_today": 1204,
        "last_backup_at": "2026-10-03T07:31:12Z",
    }


async def test_prometheus_error_is_degraded_with_every_number_null() -> None:
    body = (await service(FakePrometheus(error=PrometheusError("down"))).get()).model_dump()
    assert body == {
        "status": "degraded",
        "uptime_30d": None,
        "daily": [{"date": d, "uptime": None} for d in dates(date(2026, 10, 3))],
        "p95_ms": None,
        "requests_today": None,
        "last_backup_at": None,
    }


async def test_failed_or_missing_latest_probe_is_degraded() -> None:
    for probe in ((0.0,), ()):
        result = await service(FakePrometheus(probe=probe)).get()
        assert result.status == "degraded"
        assert result.uptime_30d == 1.0  # the numbers are still real


async def test_database_down_is_degraded() -> None:
    result = await service(FakePrometheus(), db_ok=False).get()
    assert result.status == "degraded" and result.p95_ms == 84


async def test_missing_samples_count_as_downtime() -> None:
    gap = (datetime(2026, 10, 1, 10, tzinfo=UTC), datetime(2026, 10, 1, 16, tzinfo=UTC))
    body = (await service(FakePrometheus(gaps=[gap])).get()).model_dump()
    assert uptime(body, "2026-10-01") == 0.75  # 6 of 24 hours without samples
    assert uptime(body, "2026-09-30") == 1.0
    # 13 full days and half of today: (38880 - 720) / 38880 expected probes.
    assert body["uptime_30d"] == 0.9815


async def test_days_before_the_first_probe_are_null() -> None:
    body = (await service(FakePrometheus(first=None)).get()).model_dump()
    assert all(d["uptime"] is None for d in body["daily"])
    assert body["uptime_30d"] is None
    assert body["requests_today"] == 1204  # Prometheus answered


async def test_first_day_counts_only_from_the_first_probe() -> None:
    first = datetime(2026, 9, 20, 16, tzinfo=UTC).timestamp()  # noon Sep 20 in New York
    prometheus = FakePrometheus(first=first)
    body = (await service(prometheus).get()).model_dump()
    assert uptime(body, "2026-09-19") is None
    assert uptime(body, "2026-09-20") == 1.0
    assert 12 * 3600 in prometheus.ranges("sum_over_time")


async def test_today_counts_only_the_elapsed_part() -> None:
    gap = (datetime(2026, 10, 3, 10, tzinfo=UTC), datetime(2026, 10, 3, 13, tzinfo=UTC))
    prometheus = FakePrometheus(gaps=[gap])
    body = (await service(prometheus).get()).model_dump()
    assert uptime(body, "2026-10-03") == 0.75  # 3 of the 12 elapsed hours
    assert prometheus.ranges("sum_over_time")[-1] == 12 * 3600


async def test_dst_days_use_their_real_length() -> None:
    now = datetime(2026, 11, 2, 17, tzinfo=UTC)  # noon Nov 2 in New York (EST)
    first = datetime(2026, 10, 10, 4, tzinfo=UTC).timestamp()
    prometheus = FakePrometheus(now=now, first=first)
    body = (await service(prometheus, now=now).get()).model_dump()
    assert 25 * 3600 in prometheus.ranges("sum_over_time")  # Nov 1, clocks fell back
    assert uptime(body, "2026-11-01") == 1.0
    assert body["daily"][-1]["date"] == "2026-11-02"


MIDNIGHT = datetime(2026, 10, 3, 4, tzinfo=UTC)  # 00:00 EDT today; probes land on it exactly


async def test_short_partial_today_is_not_penalized_for_the_unlanded_probe() -> None:
    for extra in (timedelta(seconds=59), timedelta(seconds=45), timedelta(hours=1, seconds=15)):
        now = MIDNIGHT + extra
        body = (await service(FakePrometheus(now=now), now=now).get()).model_dump()
        assert uptime(body, "2026-10-03") == 1.0, extra
        assert body["uptime_30d"] == 1.0, extra


async def test_partial_window_under_one_probe_is_null() -> None:
    now = MIDNIGHT + timedelta(seconds=29)
    body = (await service(FakePrometheus(now=now), now=now).get()).model_dump()
    assert uptime(body, "2026-10-03") is None
    assert uptime(body, "2026-10-02") == 1.0


async def test_first_probe_day_partial_window_healthy_is_full() -> None:
    first = (NOW - timedelta(seconds=59)).timestamp()
    body = (await service(FakePrometheus(first=first)).get()).model_dump()
    assert uptime(body, "2026-10-03") == 1.0
    assert uptime(body, "2026-10-02") is None


async def test_partial_today_with_one_missing_probe_reads_below_one() -> None:
    now = MIDNIGHT + timedelta(hours=1, seconds=15)
    gap = (MIDNIGHT + timedelta(seconds=31), MIDNIGHT + timedelta(seconds=61))  # the +60 probe
    body = (await service(FakePrometheus(now=now, gaps=[gap]), now=now).get()).model_dump()
    assert uptime(body, "2026-10-03") == round(119 / 120, 4)


async def test_failed_probe_samples_lower_the_day_like_a_gap() -> None:
    failed = (datetime(2026, 10, 1, 10, tzinfo=UTC), datetime(2026, 10, 1, 16, tzinfo=UTC))
    body = (await service(FakePrometheus(failed=[failed])).get()).model_dump()
    assert uptime(body, "2026-10-01") == 0.75
    assert uptime(body, "2026-09-30") == 1.0


async def test_duplicate_successes_cannot_offset_downtime_in_the_30d_figure() -> None:
    gap = (datetime(2026, 10, 1, 10, tzinfo=UTC), datetime(2026, 10, 1, 16, tzinfo=UTC))
    body = (await service(FakePrometheus(gaps=[gap], extra=5)).get()).model_dump()
    assert uptime(body, "2026-09-30") == 1.0
    # Capped per day: only the gap day absorbs its 5 extras ((38880 - 720 + 5) / 38880).
    assert body["uptime_30d"] == 0.9816


async def test_spring_forward_day_is_23_hours() -> None:
    now = datetime(2026, 3, 9, 17, tzinfo=UTC)  # 13:00 EDT Mar 9
    first = datetime(2026, 3, 1, 5, tzinfo=UTC).timestamp()  # midnight EST Mar 1
    prometheus = FakePrometheus(now=now, first=first)
    body = (await service(prometheus, now=now).get()).model_dump()
    assert 23 * 3600 in prometheus.ranges("sum_over_time")  # Mar 8, clocks sprang forward
    assert 24 * 3600 in prometheus.ranges("sum_over_time")
    assert uptime(body, "2026-03-08") == 1.0
    assert uptime(body, "2026-03-07") == 1.0


async def test_nan_or_infinite_requests_today_is_null() -> None:
    for requests in ((math.nan,), (math.inf,), (1.0, math.nan)):
        result = await service(FakePrometheus(requests=requests)).get()
        assert result.requests_today is None, requests
        assert result.status == "operational" and result.p95_ms == 84


async def test_unusable_backup_timestamps_are_null() -> None:
    for backup in ((math.nan,), (math.inf,), (-math.inf,), (1e20,), (-1e20,)):
        result = await service(FakePrometheus(backup=backup)).get()
        assert result.last_backup_at is None, backup
        assert result.requests_today == 1204


async def test_malformed_prometheus_value_is_degraded_not_an_error() -> None:
    body: dict[str, Any] = {
        "status": "success",
        "data": {"resultType": "vector", "result": [{"metric": {}, "value": [1.0, "oops"]}]},
    }
    client = HttpPrometheus(
        httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))),
        "http://prometheus:9090",
    )
    result = await StatusService(client, db_up, now=lambda: NOW, monotonic=Clock()).get()
    assert result.status == "degraded" and result.uptime_30d is None


async def test_p95_is_rounded_to_whole_ms_and_nan_is_null() -> None:
    cases: list[tuple[Sequence[float], int | None]] = [
        ((0.08449,), 84),
        ((0.0846,), 85),
        ((math.nan,), None),
        ((), None),
    ]
    for p95, expected in cases:
        assert (await service(FakePrometheus(p95=p95)).get()).p95_ms == expected


async def test_requests_today_starts_at_new_york_midnight() -> None:
    just_after = datetime(2026, 10, 3, 4, 0, 30, tzinfo=UTC)  # 00:00:30 EDT
    prometheus = FakePrometheus(now=just_after)
    result = await service(prometheus, now=just_after).get()
    assert prometheus.ranges("increase(") == [30]
    assert result.daily[-1].date == "2026-10-03"

    just_before = datetime(2026, 10, 3, 3, 59, 59, tzinfo=UTC)  # 23:59:59 EDT Oct 2
    prometheus = FakePrometheus(now=just_before)
    result = await service(prometheus, now=just_before).get()
    assert prometheus.ranges("increase(") == [86_399]
    assert result.daily[-1].date == "2026-10-02"


async def test_requests_today_is_zero_when_prometheus_has_no_samples() -> None:
    assert (await service(FakePrometheus(requests=())).get()).requests_today == 0


async def test_no_backup_metric_is_null() -> None:
    assert (await service(FakePrometheus(backup=())).get()).last_backup_at is None


async def test_result_is_memoized_for_60_seconds() -> None:
    prometheus = FakePrometheus()
    clock = Clock()
    status = service(prometheus, monotonic=clock)
    await status.get()
    queries = len(prometheus.calls)
    clock.t += 59
    await status.get()
    assert len(prometheus.calls) == queries
    clock.t += 2
    await status.get()
    assert len(prometheus.calls) == 2 * queries


def make_app(settings: Settings) -> FastAPI:
    app = create_app(settings)
    app.state.status_service = service(FakePrometheus())
    return app


async def test_endpoint_returns_the_status_with_cache_header(settings: Settings) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=make_app(settings)), base_url="http://t"
    ) as c:
        res = await c.get("/v1/status")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "public, max-age=60"
    body = res.json()
    assert set(body) == {
        "status",
        "uptime_30d",
        "daily",
        "p95_ms",
        "requests_today",
        "last_backup_at",
    }
    assert body["status"] == "operational" and len(body["daily"]) == 30


async def test_endpoint_is_limited_to_60_a_minute_per_ip(settings: Settings) -> None:
    app = make_app(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(60):
            assert (
                await c.get("/v1/status", headers={"CF-Connecting-IP": "1.2.3.4"})
            ).status_code == 200
        limited = await c.get("/v1/status", headers={"CF-Connecting-IP": "1.2.3.4"})
        other = await c.get("/v1/status", headers={"CF-Connecting-IP": "5.6.7.8"})
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1
    assert other.status_code == 200


def test_status_is_wired_to_prometheus_url(settings: Settings) -> None:
    assert Settings.model_fields["prometheus_url"].default == "http://prometheus:9090"
    app = create_app(settings)
    assert isinstance(app.state.status_service, StatusService)


class SlowPrometheus(FakePrometheus):
    async def query(self, promql: str, at: float) -> list[float]:
        await asyncio.sleep(5)
        return await super().query(promql, at)


async def test_slow_prometheus_degrades_within_the_overall_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(status, "PROMETHEUS_BUDGET", 0.05)
    started = time.monotonic()
    body = await service(SlowPrometheus()).get()
    assert time.monotonic() - started < 1
    assert body.status == "degraded"
    assert body.uptime_30d is None


async def test_slow_db_check_means_database_down(monkeypatch: pytest.MonkeyPatch) -> None:
    async def db_hangs() -> bool:
        await asyncio.sleep(5)
        return True

    monkeypatch.setattr(status, "DB_BUDGET", 0.05)
    svc = StatusService(FakePrometheus(), db_hangs, now=lambda: NOW, monotonic=Clock())
    started = time.monotonic()
    body = await svc.get()
    assert time.monotonic() - started < 1
    assert body.status == "degraded"
    assert body.uptime_30d == 1.0  # Prometheus numbers are still reported
