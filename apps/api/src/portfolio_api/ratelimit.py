import math
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request


class SlidingWindowLimiter:
    """In-process limiter: a key may make ``limit`` hits per ``window`` seconds, for every pair.

    One API instance (no Redis), so memory is the source of truth. Rejected calls are not
    recorded. Keys idle for the longest window are pruned every ``prune_every`` calls.
    """

    def __init__(
        self,
        limits: list[tuple[int, float]],
        clock: Callable[[], float] = time.monotonic,
        prune_every: int = 1000,
    ) -> None:
        self._limits = limits
        self._horizon = max(window for _, window in limits)
        self._clock = clock
        self._prune_every = prune_every
        self._calls = 0
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> int | None:
        """Record a hit and return None, or return whole seconds to wait without recording."""
        now = self._clock()
        self._calls += 1
        if self._calls % self._prune_every == 0:
            self._prune(now)
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - self._horizon:
            hits.popleft()
        wait = 0.0
        for limit, window in self._limits:
            recent = [t for t in hits if t > now - window]
            if len(recent) >= limit:
                wait = max(wait, recent[-limit] + window - now)
        if wait > 0:
            return max(1, math.ceil(wait))
        hits.append(now)
        return None

    def _prune(self, now: float) -> None:
        cutoff = now - self._horizon
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
            del self._hits[key]

    def __len__(self) -> int:
        return len(self._hits)


def client_ip(request: Request) -> str | None:
    # The API is reachable only through the Cloudflare Tunnel (which sets CF-Connecting-IP)
    # or the internal Docker network, so the header cannot be forged from the internet.
    forwarded = request.headers.get("cf-connecting-ip", "").strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else None
