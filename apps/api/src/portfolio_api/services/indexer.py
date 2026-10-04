import asyncio
from dataclasses import dataclass
from typing import Protocol

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.metrics import RAG_SYNC_RUNS
from portfolio_api.rag.chunking import chunk_markdown, content_hash
from portfolio_api.rag.documents import SiteContent, build_documents
from portfolio_api.rag.embedder import Embedder
from portfolio_api.repositories import rag as repo

log = structlog.get_logger()


class ContentSource(Protocol):
    async def fetch_site_content(self) -> SiteContent: ...


@dataclass(frozen=True)
class SyncResult:
    documents: int
    chunks_added: int
    chunks_removed: int


class IndexService:
    """Keeps rag_* equal to published content. Every sync is a full, idempotent comparison."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        source: ContentSource,
        embedder: Embedder,
        *,
        debounce: float = 5.0,
    ) -> None:
        self._sessions = sessions
        self._source = source
        self._embedder = embedder
        self._debounce = debounce
        self._lock = asyncio.Lock()
        self._pending = False
        self._task: asyncio.Task[None] | None = None

    async def sync(self) -> SyncResult:
        async with self._lock:
            # Fetch first: a Directus failure raises here, before anything is deleted.
            docs = build_documents(await self._source.fetch_site_content())
            model = self._embedder.model_name
            async with self._sessions() as session:
                stored = await repo.load_index(session)
            added = removed = 0
            seen: set[tuple[str, str]] = set()
            for doc in docs:
                key = (doc.source_type, doc.source_id)
                seen.add(key)
                by_hash = {
                    content_hash(model, c): c for c in chunk_markdown(doc.title, doc.markdown)
                }
                existing = stored.get(key)
                old: frozenset[str] = existing.hashes if existing else frozenset()
                new = [h for h in by_hash if h not in old]
                gone: frozenset[str] = old - by_hash.keys()
                # Embed outside the transaction; it is the slow part.
                vectors = await self._embedder.embed_documents([by_hash[h] for h in new])
                async with self._sessions.begin() as session:
                    document_id = await repo.upsert_document(session, doc)
                    await repo.delete_chunks(session, document_id, gone)
                    await repo.add_chunks(
                        session,
                        document_id,
                        [(h, by_hash[h], v) for h, v in zip(new, vectors, strict=True)],
                        model,
                    )
                added += len(new)
                removed += len(gone)
            stale = [d for k, d in stored.items() if k not in seen]
            if stale:
                async with self._sessions.begin() as session:
                    await repo.delete_documents(session, [d.id for d in stale])
                removed += sum(len(d.hashes) for d in stale)
            result = SyncResult(len(docs), added, removed)
        log.info("rag sync done", documents=result.documents, added=added, removed=removed)
        return result

    async def sync_job(self) -> None:
        """For the nightly job and startup: never raises, so the job loop keeps running."""
        try:
            await self.sync()
        except Exception:
            RAG_SYNC_RUNS.labels(result="error").inc()
            log.exception("rag sync failed; index left as it was")
        else:
            RAG_SYNC_RUNS.labels(result="ok").inc()

    def request_reindex(self) -> None:
        """Schedule a sync after the debounce window; a burst of requests becomes one sync."""
        self._pending = True
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._debounced(), name="rag-reindex")

    async def _debounced(self) -> None:
        while self._pending:
            await asyncio.sleep(self._debounce)
            # Requests during the sleep are covered by this sync; requests during it loop again.
            self._pending = False
            await self.sync_job()
