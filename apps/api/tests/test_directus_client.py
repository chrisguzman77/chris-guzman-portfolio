import io
import json
from typing import Any

import httpx
import pytest
import structlog
from pypdf import PdfWriter
from pypdf.errors import ParseError
from structlog.testing import capture_logs

from portfolio_api.clients import directus as directus_module
from portfolio_api.clients.directus import ChatSettings, DirectusContent, DirectusError, pdf_text


def blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


class Recorder:
    def __init__(self, routes: dict[str, Any]) -> None:
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        for prefix, reply in self.routes.items():
            if request.url.path.startswith(prefix):
                if isinstance(reply, httpx.Response):
                    return reply
                if isinstance(reply, bytes):
                    return httpx.Response(200, content=reply)
                return httpx.Response(200, json={"data": reply})
        return httpx.Response(404, json={"errors": []})


def client(routes: dict[str, Any]) -> tuple[DirectusContent, Recorder]:
    recorder = Recorder(routes)
    http = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    return DirectusContent(http, "http://directus:8055/", "tok"), recorder


SITE: dict[str, Any] = {
    "/items/profile": {"name": "Chris", "intro": "Hi", "location": "GA"},
    "/items/resume": {"file": None},
    "/items/experience": [{"id": 1, "company": "X", "role": "Y"}],
    "/items/education": [],
    "/items/involvement": [],
    "/items/certifications": [],
    "/items/projects": [],
    "/items/posts": [],
}


async def test_fetch_site_content_filters_published_and_sends_token() -> None:
    directus, recorder = client(SITE)
    content = await directus.fetch_site_content()
    assert content.profile == {"name": "Chris", "intro": "Hi", "location": "GA"}
    assert content.experience == [{"id": 1, "company": "X", "role": "Y"}]
    assert content.resume_text is None
    exp = next(r for r in recorder.requests if r.url.path == "/items/experience")
    assert exp.url.params["filter[status][_eq]"] == "published"
    assert exp.url.params["limit"] == "-1"
    assert exp.headers["authorization"] == "Bearer tok"
    profile = next(r for r in recorder.requests if r.url.path == "/items/profile")
    assert "filter[status][_eq]" not in profile.url.params


async def test_resume_pdf_is_downloaded_and_extracted() -> None:
    routes = {**SITE, "/items/resume": {"file": "abc"}, "/assets/abc": blank_pdf()}
    directus, recorder = client(routes)
    content = await directus.fetch_site_content()
    assert content.resume_text == ""
    assert any(r.url.path == "/assets/abc" for r in recorder.requests)


async def test_empty_singleton_is_none() -> None:
    directus, _ = client({**SITE, "/items/profile": None})
    assert (await directus.fetch_site_content()).profile is None


@pytest.mark.parametrize(
    "reply",
    [httpx.Response(500), httpx.Response(200, content=b"not json"), httpx.Response(200, json=[])],
)
async def test_bad_replies_raise_directus_error(reply: httpx.Response) -> None:
    directus, _ = client({**SITE, "/items/projects": reply})
    with pytest.raises(DirectusError):
        await directus.fetch_site_content()


async def test_network_error_raises_directus_error() -> None:
    def boom(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    http = httpx.AsyncClient(transport=httpx.MockTransport(boom))
    with pytest.raises(DirectusError):
        await DirectusContent(http, "http://directus:8055", "tok").fetch_chat_settings()


async def test_unreadable_pdf_raises_directus_error() -> None:
    directus, _ = client({**SITE, "/items/resume": {"file": "abc"}, "/assets/abc": b"%PDF-garbage"})
    with pytest.raises(DirectusError):
        await directus.fetch_site_content()


async def test_chat_settings() -> None:
    directus, _ = client(
        {"/items/chat_settings": {"enabled": False, "suggested_questions": ["Q1", "Q2"]}}
    )
    assert await directus.fetch_chat_settings() == ChatSettings(
        enabled=False, suggested_questions=["Q1", "Q2"]
    )


async def test_chat_settings_defaults_when_empty() -> None:
    directus, _ = client({"/items/chat_settings": {"enabled": None, "suggested_questions": None}})
    assert await directus.fetch_chat_settings() == ChatSettings(
        enabled=False, suggested_questions=[]
    )


async def test_chat_settings_missing_enabled_is_off() -> None:
    directus, _ = client({"/items/chat_settings": {"suggested_questions": []}})
    assert (await directus.fetch_chat_settings()).enabled is False


def test_pdf_text_joins_pages() -> None:
    assert pdf_text(blank_pdf()) == ""
    with pytest.raises(DirectusError):
        pdf_text(json.dumps({"no": "pdf"}).encode())


async def test_oversized_resume_pdf_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    big = b"%PDF-" + b"0" * (11 * 1024 * 1024)
    directus, _ = client({**SITE, "/items/resume": {"file": "abc"}, "/assets/abc": big})
    with capture_logs() as logs:
        # The module logger is cached on first use; a fresh one binds to capture_logs.
        monkeypatch.setattr(directus_module, "log", structlog.get_logger())
        content = await directus.fetch_site_content()
    assert content.resume_text is None
    assert any(e["event"] == "resume PDF too large; skipped" for e in logs)


def test_pdf_text_wraps_any_pypdf_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(_: object) -> None:
        raise ParseError("bad xref")

    monkeypatch.setattr(directus_module, "PdfReader", broken)
    with pytest.raises(DirectusError, match="ParseError"):
        pdf_text(b"%PDF-1.7")


async def test_fetch_post_reads_one_post_by_id() -> None:
    content, recorder = client(
        {
            "/items/posts/7": {
                "id": 7,
                "slug": "hello",
                "title": "Hello",
                "excerpt": "Hi.",
                "status": "draft",
            }
        }
    )
    post = await content.fetch_post(7)
    assert post is not None and (post.id, post.slug, post.published) == (7, "hello", False)
    assert recorder.requests[0].url.params["fields"] == "id,slug,title,excerpt,status"


@pytest.mark.parametrize("status", [403, 404])
async def test_fetch_post_missing_is_none(status: int) -> None:
    content, _ = client({"/items/posts/7": httpx.Response(status, json={"errors": []})})
    assert await content.fetch_post(7) is None


@pytest.mark.parametrize(
    "reply",
    [httpx.Response(500), {"id": 7, "slug": "x"}, ["not", "a", "dict"]],
)
async def test_fetch_post_errors_raise(reply: Any) -> None:
    content, _ = client({"/items/posts/7": reply})
    with pytest.raises(DirectusError):
        await content.fetch_post(7)
