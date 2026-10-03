import asyncio
import io
from dataclasses import dataclass
from typing import Any, cast

import httpx
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from portfolio_api.rag.documents import SiteContent

PUBLISHED = {"fields": "*", "filter[status][_eq]": "published", "limit": "-1"}
LISTS = ["experience", "education", "involvement", "certifications", "projects", "posts"]


class DirectusError(Exception):
    """Directus could not give a complete answer; callers must not act on partial content."""


@dataclass(frozen=True)
class ChatSettings:
    enabled: bool
    suggested_questions: list[str]


def pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
    except (PdfReadError, ValueError, OSError) as exc:
        raise DirectusError(f"resume PDF unreadable: {type(exc).__name__}") from exc


class DirectusContent:
    """Read-only client for published content, using the API's own Directus token."""

    def __init__(self, http: httpx.AsyncClient, base_url: str, token: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    async def _request(self, path: str, params: dict[str, str] | None = None) -> httpx.Response:
        try:
            res = await self._http.get(
                f"{self._base}{path}", params=params, headers=self._headers, timeout=10.0
            )
        except httpx.HTTPError as exc:
            raise DirectusError(f"{path}: {type(exc).__name__}") from exc
        if res.status_code != 200:
            raise DirectusError(f"{path}: directus {res.status_code}")
        return res

    async def _data(self, path: str, params: dict[str, str] | None = None) -> Any:
        res = await self._request(path, params)
        try:
            body: Any = res.json()
        except ValueError as exc:
            raise DirectusError(f"{path}: invalid JSON") from exc
        if not isinstance(body, dict) or "data" not in body:
            raise DirectusError(f"{path}: unexpected body")
        data: Any = cast(dict[str, Any], body)["data"]
        return data

    async def _list(self, collection: str) -> list[dict[str, Any]]:
        data = await self._data(f"/items/{collection}", PUBLISHED)
        if not isinstance(data, list):
            raise DirectusError(f"{collection}: expected a list")
        rows = cast(list[Any], data)
        return [cast(dict[str, Any], item) for item in rows if isinstance(item, dict)]

    async def _singleton(self, collection: str) -> dict[str, Any] | None:
        data = await self._data(f"/items/{collection}", {"fields": "*"})
        return cast(dict[str, Any], data) if isinstance(data, dict) and data else None

    async def fetch_site_content(self) -> SiteContent:
        profile = await self._singleton("profile")
        lists = {name: await self._list(name) for name in LISTS}
        resume = await self._singleton("resume")
        resume_text: str | None = None
        file_id = resume.get("file") if resume else None
        if isinstance(file_id, str) and file_id:
            pdf = await self._request(f"/assets/{file_id}")
            resume_text = await asyncio.to_thread(pdf_text, pdf.content)
        return SiteContent(profile=profile, resume_text=resume_text, **lists)

    async def fetch_chat_settings(self) -> ChatSettings:
        data = await self._singleton("chat_settings") or {}
        enabled = data.get("enabled")
        questions = data.get("suggested_questions")
        return ChatSettings(
            enabled=enabled if isinstance(enabled, bool) else True,
            suggested_questions=[q for q in cast(list[Any], questions) if isinstance(q, str)]
            if isinstance(questions, list)
            else [],
        )
