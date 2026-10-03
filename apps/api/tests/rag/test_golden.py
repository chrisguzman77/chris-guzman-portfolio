import os
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.rag.embedder import FastEmbedEmbedder
from portfolio_api.rag.retrieval import Retriever
from portfolio_api.services.indexer import IndexService
from tests.rag.seed import load_seed_content
from tests.rag.test_indexer import FakeSource

GOLDEN = Path(__file__).with_name("golden.yaml")
REQUIRED_HITS = 14


async def test_golden_questions_find_their_sources(
    db: async_sessionmaker[AsyncSession],
) -> None:
    """Real embedder over the seed content; downloads the model on first run (~130 MB)."""
    cases: list[dict[str, Any]] = yaml.safe_load(GOLDEN.read_text())
    embedder = FastEmbedEmbedder(os.environ.get("API_EMBEDDING_CACHE_DIR") or None)
    await IndexService(db, FakeSource(load_seed_content()), embedder).sync()
    retriever = Retriever(db, embedder)
    misses: list[str] = []
    for case in cases:
        result = await retriever.search(case["question"])
        titles = [h.title for h in result.hits]
        if not any(e in t for e in case["expect"] for t in titles):
            misses.append(f"{case['question']!r} -> {titles}")
    assert len(cases) - len(misses) >= REQUIRED_HITS, "\n".join(misses)
