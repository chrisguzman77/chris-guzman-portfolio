from portfolio_api.ratelimit import SlidingWindowLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_reports_the_wait() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(5, 60)], clock=clock)
    assert [limiter.hit("a") for _ in range(5)] == [None] * 5
    clock.now += 10
    assert limiter.hit("a") == 50  # the first hit leaves the window 50 s from now


def test_window_slides_and_rejections_are_not_recorded() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(2, 60)], clock=clock)
    limiter.hit("a")
    limiter.hit("a")
    for _ in range(10):
        assert limiter.hit("a") is not None
    clock.now += 60
    assert limiter.hit("a") is None


def test_daily_limit_applies_after_the_minute_limit_resets() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(5, 60), (20, 86_400)], clock=clock)
    for _ in range(4):
        assert all(limiter.hit("a") is None for _ in range(5))
        clock.now += 61
    wait = limiter.hit("a")
    assert wait is not None and wait > 60


def test_keys_are_independent() -> None:
    limiter = SlidingWindowLimiter([(1, 60)], clock=Clock())
    assert limiter.hit("a") is None
    assert limiter.hit("a") is not None
    assert limiter.hit("b") is None


def test_wait_is_at_least_one_second() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(1, 60)], clock=clock)
    limiter.hit("a")
    clock.now += 59.9
    assert limiter.hit("a") == 1


def test_idle_keys_are_pruned() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(5, 60)], clock=clock, prune_every=3)
    limiter.hit("old")
    clock.now += 61
    limiter.hit("x")
    limiter.hit("y")  # third call prunes "old"
    assert len(limiter) == 2
