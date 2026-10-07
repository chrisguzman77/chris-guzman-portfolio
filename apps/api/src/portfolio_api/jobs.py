import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import structlog

log = structlog.get_logger()


@dataclass(frozen=True)
class Job:
    """A coroutine the API runs at startup and then every ``interval`` seconds while it is up."""

    name: str
    interval: float
    run: Callable[[], Awaitable[None]]


MAX_BACKOFF = 3600.0


async def run_forever(job: Job, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
    """Run the job every ``interval`` seconds; after n failures in a row wait interval * 2**n,
    at most an hour (or the interval itself when that is longer), until a run succeeds."""
    # One API instance, so plain asyncio tasks are enough (see docs/adr/0007).
    failures = 0
    while True:
        try:
            await job.run()
        except Exception:
            failures += 1
            log.exception("background job failed", job=job.name, failures=failures)
        else:
            failures = 0
        wait = job.interval * 2**failures
        await sleep(max(job.interval, min(wait, MAX_BACKOFF)))
