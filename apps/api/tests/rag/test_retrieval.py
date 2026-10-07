from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.rag.retrieval import PER_DOCUMENT, TOP_K, Retriever, fuse
from portfolio_api.repositories import rag as repo
from portfolio_api.repositories.rag import ChunkHit
from portfolio_api.services.indexer import IndexService
from tests.fakes import FakeEmbedder
from tests.rag.test_indexer import FakeSource, content_with_projects

Sessions = async_sessionmaker[AsyncSession]


def hit(chunk_id: int, document_id: int, similarity: float | None = None) -> ChunkHit:
    return ChunkHit(chunk_id, document_id, f"T{document_id}", f"/d/{document_id}", "c", similarity)


def test_fuse_rewards_chunks_found_by_both_searches() -> None:
    vector = [hit(1, 1, 0.9), hit(2, 2, 0.8)]
    keyword = [hit(2, 2), hit(3, 3)]
    fused = fuse(vector, keyword)
    assert [h.chunk_id for h in fused] == [2, 1, 3]
    # The vector copy (with its similarity) wins over the keyword copy.
    assert fused[0].similarity == 0.8


def test_fuse_caps_chunks_per_document_and_total() -> None:
    vector = [hit(i, 1 if i < 4 else i, 0.5) for i in range(1, 12)]
    fused = fuse(vector, [])
    assert sum(1 for h in fused if h.document_id == 1) == PER_DOCUMENT
    assert len(fused) == TOP_K


async def test_search_returns_relevant_chunks_and_best_similarity(db: Sessions) -> None:
    embedder = FakeEmbedder()
    await IndexService(db, FakeSource(content_with_projects()), embedder).sync()
    result = await Retriever(db, embedder).search("rotating refresh tokens")
    assert result.hits and result.hits[0].url == "/projects/acm"
    assert 0.0 < result.best_similarity <= 1.0


async def test_search_on_empty_index(db: Sessions) -> None:
    result = await Retriever(db, FakeEmbedder()).search("anything")
    assert result.hits == [] and result.best_similarity == 0.0


async def test_keyword_search_matches_any_term(db: Sessions) -> None:
    await IndexService(db, FakeSource(content_with_projects()), FakeEmbedder()).sync()
    async with db() as session:
        hits = await repo.keyword_search(session, "rotating zeppelin", 20)
        stopwords_only = await repo.keyword_search(session, "the and of", 20)
    assert [h.url for h in hits] == ["/projects/acm"]
    assert stopwords_only == []
