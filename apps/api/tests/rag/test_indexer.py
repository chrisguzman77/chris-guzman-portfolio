import asyncio
from collections.abc import Sequence
from dataclasses import replace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import DirectusError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import RagChunk, RagDocument
from portfolio_api.rag.documents import SiteContent
from portfolio_api.services.indexer import IndexService, SyncResult
from tests.fakes import FakeEmbedder, metric

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


async def test_sync_runs_are_measured(db: Sessions) -> None:
    ok = metric("rag_sync_runs_total", result="ok")
    error = metric("rag_sync_runs_total", result="error")
    source = FakeSource(content_with_projects())
    service = IndexService(db, source, FakeEmbedder())
    await service.sync_job()
    assert metric("rag_sync_runs_total", result="ok") == ok + 1
    source.content = DirectusError("down")
    await service.sync_job()
    assert metric("rag_sync_runs_total", result="error") == error + 1
    assert metric("rag_sync_runs_total", result="ok") == ok + 1


async def test_long_title_is_truncated_and_does_not_abort_the_sync(db: Sessions) -> None:
    content = content_with_projects()
    projects = [dict(p) for p in content.projects]
    projects[0]["title"] = "word " * 80  # 400 characters
    service = IndexService(db, FakeSource(replace(content, projects=projects)), FakeEmbedder())
    result = await service.sync()
    assert result.documents == 3
    async with db() as session:
        titles = list((await session.scalars(select(RagDocument.title))).all())
    assert len(titles) == 3
    assert max(len(t) for t in titles) == 300


async def test_unchanged_document_keeps_its_updated_at(db: Sessions) -> None:
    service = IndexService(db, FakeSource(content_with_projects()), FakeEmbedder())
    await service.sync()
    async with db() as session:
        before = {d.id: d.updated_at for d in (await session.scalars(select(RagDocument))).all()}
    await service.sync()
    async with db() as session:
        after = {d.id: d.updated_at for d in (await session.scalars(select(RagDocument))).all()}
    assert after == before


class ShortEmbedder(FakeEmbedder):
    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [[1.0, 0.0, 0.0] for _ in texts]


async def test_wrong_embedding_dimension_is_a_clear_error(db: Sessions) -> None:
    service = IndexService(db, FakeSource(content_with_projects()), ShortEmbedder())
    with pytest.raises(ValueError, match="3 dimensions, expected 384"):
        await service.sync()
    assert await counts(db) == (0, 0)


async def test_lifespan_exit_cancels_a_pending_reindex(settings: Settings) -> None:
    configured = settings.model_copy(
        update={"directus_token": "tok", "directus_url": "http://127.0.0.1:1"}
    )
    app = create_app(configured)
    indexer: IndexService = app.state.indexer
    async with app.router.lifespan_context(app):
        indexer.request_reindex()  # debounce is 5 s: still sleeping at shutdown
        assert [t for t in asyncio.all_tasks() if t.get_name() == "rag-reindex"]
    assert not [t for t in asyncio.all_tasks() if t.get_name() == "rag-reindex"]
