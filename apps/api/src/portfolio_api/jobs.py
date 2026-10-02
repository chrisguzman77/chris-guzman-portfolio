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


async def run_forever(job: Job) -> None:
    # One API instance, so plain asyncio tasks are enough (see docs/adr/0007).
    while True:
        try:
            await job.run()
        except Exception:
            log.exception("background job failed", job=job.name)
        await asyncio.sleep(job.interval)
