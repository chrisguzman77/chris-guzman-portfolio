import asyncio
from dataclasses import replace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import DirectusError
from portfolio_api.models import RagChunk, RagDocument
from portfolio_api.rag.documents import SiteContent
from portfolio_api.services.indexer import IndexService, SyncResult
from tests.fakes import FakeEmbedder

Sessions = async_sessionmaker[AsyncSession]


def content_with_projects() -> SiteContent:
    return SiteContent(
        profile={"name": "Christopher Guzman", "intro": "CS student in Augusta.", "location": "GA"},
        experience=[],
        education=[],
        involvement=[],
        certifications=[],
        projects=[
            {
                "id": 1,
                "slug": "acm",
                "title": "ACM platform",
                "summary": "Chapter website.",
                "body": "## Auth\n\nRotating refresh tokens and TOTP.",
                "tech": ["fastapi"],
            },
            {
                "id": 2,
                "slug": "lakehouse",
                "title": "Lakehouse",
                "summary": "Spark pipeline over network flows.",
                "body": None,
                "tech": ["spark"],
            },
        ],
        posts=[],
        resume_text=None,
    )


class FakeSource:
    def __init__(self, content: SiteContent | Exception) -> None:
        self.content = content
        self.calls = 0

    async def fetch_site_content(self) -> SiteContent:
        self.calls += 1
        if isinstance(self.content, Exception):
            raise self.content
        return self.content


async def counts(db: Sessions) -> tuple[int, int]:
    async with db() as session:
        docs = await session.scalar(select(func.count()).select_from(RagDocument))
        chunks = await session.scalar(select(func.count()).select_from(RagChunk))
    return docs or 0, chunks or 0


async def test_first_sync_indexes_everything(db: Sessions) -> None:
    embedder = FakeEmbedder()
    result = await IndexService(db, FakeSource(content_with_projects()), embedder).sync()
    assert result == SyncResult(documents=3, chunks_added=3, chunks_removed=0)
    assert await counts(db) == (3, 3)
    assert len(embedder.embedded) == 3


async def test_second_sync_changes_nothing(db: Sessions) -> None:
    embedder = FakeEmbedder()
    service = IndexService(db, FakeSource(content_with_projects()), embedder)
    await service.sync()
    embedder.embedded.clear()
    assert await service.sync() == SyncResult(documents=3, chunks_added=0, chunks_removed=0)
    assert embedder.embedded == []


async def test_edit_replaces_only_the_changed_document(db: Sessions) -> None:
    embedder = FakeEmbedder()
    source = FakeSource(content_with_projects())
    service = IndexService(db, source, embedder)
    await service.sync()
    content = content_with_projects()
    projects = [dict(p) for p in content.projects]
    projects[1]["summary"] = "Spark pipeline over 2M network flows."
    source.content = replace(content, projects=projects)
    embedder.embedded.clear()
    assert await service.sync() == SyncResult(documents=3, chunks_added=1, chunks_removed=1)
    assert len(embedder.embedded) == 1 and "2M" in embedder.embedded[0]
    async with db() as session:
        titles = set((await session.scalars(select(RagDocument.title))).all())
    assert titles == {"About Christopher Guzman", "ACM platform", "Lakehouse"}


async def test_unpublished_item_is_removed(db: Sessions) -> None:
    source = FakeSource(content_with_projects())
    service = IndexService(db, source, FakeEmbedder())
    await service.sync()
    content = content_with_projects()
    source.content = replace(content, projects=content.projects[:1])
    assert await service.sync() == SyncResult(documents=2, chunks_added=0, chunks_removed=1)
    assert await counts(db) == (2, 2)


async def test_directus_failure_deletes_nothing(db: Sessions) -> None:
    source = FakeSource(content_with_projects())
    service = IndexService(db, source, FakeEmbedder())
    await service.sync()
    source.content = DirectusError("down")
    with pytest.raises(DirectusError):
        await service.sync()
    assert await counts(db) == (3, 3)


async def test_sync_job_logs_instead_of_raising(db: Sessions) -> None:
    service = IndexService(db, FakeSource(DirectusError("down")), FakeEmbedder())
    await service.sync_job()  # must not raise


async def test_request_reindex_debounces_bursts(db: Sessions) -> None:
    source = FakeSource(content_with_projects())
    service = IndexService(db, source, FakeEmbedder(), debounce=0.05)
    for _ in range(5):
        service.request_reindex()
    await asyncio.sleep(0.3)
    assert source.calls == 1
    assert await counts(db) == (3, 3)
