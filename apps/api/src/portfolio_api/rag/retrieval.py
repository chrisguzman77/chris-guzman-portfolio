from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.rag.embedder import Embedder
from portfolio_api.repositories import rag as repo
from portfolio_api.repositories.rag import ChunkHit

CANDIDATES = 20
TOP_K = 5
PER_DOCUMENT = 2
RRF_K = 60


@dataclass(frozen=True)
class Retrieved:
    hits: list[ChunkHit]
    best_similarity: float


def fuse(vector_hits: Sequence[ChunkHit], keyword_hits: Sequence[ChunkHit]) -> list[ChunkHit]:
    """Reciprocal rank fusion, then at most PER_DOCUMENT chunks per document, TOP_K in total."""
    scores: dict[int, float] = {}
    by_id: dict[int, ChunkHit] = {}
    for ranked in (vector_hits, keyword_hits):
        for rank, hit in enumerate(ranked, start=1):
            scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            by_id.setdefault(hit.chunk_id, hit)  # vector copy first: it carries the similarity
    picked: list[ChunkHit] = []
    per_document: Counter[int] = Counter()
    for chunk_id in sorted(scores, key=lambda c: (-scores[c], c)):
        hit = by_id[chunk_id]
        if per_document[hit.document_id] >= PER_DOCUMENT:
            continue
        picked.append(hit)
        per_document[hit.document_id] += 1
        if len(picked) == TOP_K:
            break
    return picked


class Retriever:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], embedder: Embedder) -> None:
        self._sessions = sessions
        self._embedder = embedder

    async def search(self, question: str) -> Retrieved:
        embedding = await self._embedder.embed_query(question)
        async with self._sessions() as session:
            vector_hits = await repo.vector_search(session, embedding, CANDIDATES)
            keyword_hits = await repo.keyword_search(session, question, CANDIDATES)
        best = max((h.similarity or 0.0 for h in vector_hits), default=0.0)
        return Retrieved(fuse(vector_hits, keyword_hits), best)
