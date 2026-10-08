import uuid

from httpx import ASGITransport, AsyncClient
from prometheus_client import CollectorRegistry, Counter, generate_latest

from portfolio_api.config import Settings
from portfolio_api.main import create_app
from tests.fakes import metric

CHAT_MESSAGES = "/v1/chat/sessions/{session_id}/messages"
METRIC_NAMES = (
    "http_requests_total",
    "http_request_duration_seconds",
    "chat_questions_total",
    "chat_tokens_total",
    "chat_budget_used_ratio",
    "contact_submissions_total",
    "rag_sync_runs_total",
    "newsletter_subscribers",
    "newsletter_subscribe_requests_total",
    "newsletter_confirmations_total",
    "newsletter_unsubscribes_total",
    "newsletter_emails_total",
)


async def test_metrics_is_hidden_through_cloudflare(client: AsyncClient) -> None:
    res = await client.get("/metrics", headers={"CF-Connecting-IP": "203.0.113.7"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


async def test_metrics_serves_prometheus_text(client: AsyncClient) -> None:
    res = await client.get("/metrics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/plain")
    for name in METRIC_NAMES:
        assert f"# TYPE {name} " in res.text


async def test_metrics_is_not_in_the_openapi_schema(client: AsyncClient) -> None:
    paths = (await client.get("/openapi.json")).json()["paths"]
    assert "/metrics" not in paths


async def test_requests_are_labelled_with_the_route_template(client: AsyncClient) -> None:
    labels = {"method": "POST", "route": CHAT_MESSAGES, "status": "503"}
    before = metric("http_requests_total", **labels)
    timed = metric("http_request_duration_seconds_count", method="POST", route=CHAT_MESSAGES)
    session_id = str(uuid.uuid4())
    res = await client.post(f"/v1/chat/sessions/{session_id}/messages", json={"question": "hi"})
    assert res.status_code == 503  # chat is not configured in tests
    assert metric("http_requests_total", **labels) == before + 1
    after = metric("http_request_duration_seconds_count", method="POST", route=CHAT_MESSAGES)
    assert after == timed + 1
    assert session_id not in (await client.get("/metrics")).text


async def test_unmatched_paths_share_one_label(client: AsyncClient) -> None:
    labels = {"method": "GET", "route": "unmatched", "status": "404"}
    before = metric("http_requests_total", **labels)
    assert (await client.get("/no/such/page")).status_code == 404
    assert metric("http_requests_total", **labels) == before + 1
    assert "/no/such/page" not in (await client.get("/metrics")).text


async def test_health_and_metrics_are_not_measured(client: AsyncClient) -> None:
    await client.get("/health")
    await client.get("/metrics")
    text = (await client.get("/metrics")).text
    assert 'route="/health"' not in text
    assert 'route="/metrics"' not in text


async def test_unhandled_errors_are_measured_as_500(settings: Settings) -> None:
    app = create_app(settings)

    async def boom() -> None:
        raise RuntimeError("boom")

    app.add_api_route("/boom", boom)
    labels = {"method": "GET", "route": "/boom", "status": "500"}
    before = metric("http_requests_total", **labels)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/boom")).status_code == 500
    assert metric("http_requests_total", **labels) == before + 1


async def test_metrics_have_no_created_series_and_leave_other_registries_alone(
    client: AsyncClient,
) -> None:
    assert "_created" not in (await client.get("/metrics")).text
    other = CollectorRegistry()
    Counter("other_total", "A counter outside the API's registry.", registry=other).inc()
    assert b"other_created" in generate_latest(other)  # no process-wide switch was flipped


async def test_oversized_bodies_are_measured_as_unmatched(client: AsyncClient) -> None:
    # BodySizeLimit sits inside RequestMetrics but in front of the router, so a 413 for a
    # declared Content-Length never reaches routing and gets the "unmatched" label even
    # though /v1/contact is a real route.
    labels = {"method": "POST", "route": "unmatched", "status": "413"}
    before = metric("http_requests_total", **labels)
    res = await client.post(
        "/v1/contact",
        content=b"x" * (64 * 1024),
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 413
    assert metric("http_requests_total", **labels) == before + 1
    assert metric("http_requests_total", method="POST", route="/v1/contact", status="413") == 0


def test_budget_gauge_job_runs_only_with_chat(settings: Settings) -> None:
    on = create_app(
        settings.model_copy(
            update={
                "groq_api_key": "gsk",
                "directus_token": "tok",
                "turnstile_secret": "sec",
                "chat_hash_salt": "salt",
            }
        )
    )
    assert "chat-budget-gauge" in on.state.job_names
    assert "chat-budget-gauge" not in create_app(settings).state.job_names


async def test_rejected_chat_questions_start_at_zero(client: AsyncClient) -> None:
    text = (await client.get("/metrics")).text
    assert 'chat_questions_total{outcome="rejected"}' in text
