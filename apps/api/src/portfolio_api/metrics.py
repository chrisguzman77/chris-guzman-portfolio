"""Prometheus metrics, served at GET /metrics to the Prometheus on the compose network.

Every metric lives on one module-level registry, so building several apps in one process
(the tests do) never registers a metric twice.
"""

import time
from collections.abc import Iterator

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
from prometheus_client.metrics_core import Metric
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from portfolio_api.models import ChatOutcome


class _Registry(CollectorRegistry):
    """Our metrics without their *_created series: half the series, for nothing we query.

    Filtered here rather than with disable_created_metrics(), which flips a process-wide
    switch for every registry; importing this module changes no global state.
    """

    def collect(self) -> Iterator[Metric]:
        for metric in super().collect():
            created = metric.name + "_created"
            metric.samples = [s for s in metric.samples if s.name != created]
            yield metric


REGISTRY = _Registry()

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "HTTP requests by method, route template and status.",
    ["method", "route", "status"],
    registry=REGISTRY,
)
HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration by method and route template.",
    ["method", "route"],
    registry=REGISTRY,
)
CHAT_QUESTIONS = Counter(
    "chat_questions_total", "Chat questions by outcome.", ["outcome"], registry=REGISTRY
)
CHAT_TOKENS = Counter(
    "chat_tokens_total", "Model tokens used by chat answers.", ["kind"], registry=REGISTRY
)
CHAT_BUDGET_USED_RATIO = Gauge(
    "chat_budget_used_ratio", "Today's chat tokens divided by the daily budget.", registry=REGISTRY
)
CONTACT_SUBMISSIONS = Counter(
    "contact_submissions_total",
    "Contact email delivery attempts by result.",
    ["result"],
    registry=REGISTRY,
)
RAG_SYNC_RUNS = Counter(
    "rag_sync_runs_total", "RAG index sync runs by result.", ["result"], registry=REGISTRY
)

# A question turned away before an answer is composed: rate-limited, session limit or budget.
CHAT_REJECTED = "rejected"

# Children for every known label value exist from startup, so increase() sees the first event.
for _outcome in (*(o.value for o in ChatOutcome), CHAT_REJECTED):
    CHAT_QUESTIONS.labels(outcome=_outcome)
for _kind in ("input", "output"):
    CHAT_TOKENS.labels(kind=_kind)
for _result in ("sent", "failed"):
    CONTACT_SUBMISSIONS.labels(result=_result)
for _result in ("ok", "error"):
    RAG_SYNC_RUNS.labels(result=_result)

UNMATCHED = "unmatched"
EXCLUDED_PATHS = frozenset({"/metrics", "/health"})
# Anything else becomes "other", so a client inventing methods cannot add label values.
_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})


class RequestMetrics:
    """Count and time every HTTP request, labelled with the matched route template.

    The router writes the matched route into the scope, so it is read after the app ran.
    Requests no route matched (404s, and 413s rejected before routing) use "unmatched".
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in EXCLUDED_PATHS:
            await self.app(scope, receive, send)
            return
        status = 500  # if the app raises before responding, the request-ID middleware sends 500

        async def send_and_capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        start = time.perf_counter()
        try:
            await self.app(scope, receive, send_and_capture)
        finally:
            route = scope.get("route")
            template = route.path if isinstance(route, Route) else UNMATCHED
            method = scope["method"] if scope["method"] in _METHODS else "other"
            HTTP_REQUESTS.labels(method=method, route=template, status=str(status)).inc()
            HTTP_REQUEST_DURATION.labels(method=method, route=template).observe(
                time.perf_counter() - start
            )
