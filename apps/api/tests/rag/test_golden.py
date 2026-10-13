import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.evals.scoring import hit_rate, load_golden, mean_reciprocal_rank, run_golden
from portfolio_api.rag.embedder import FastEmbedEmbedder
from portfolio_api.rag.retrieval import Retriever
from portfolio_api.services.indexer import IndexService
from tests.rag.seed import load_seed_content
from tests.rag.test_indexer import FakeSource

REQUIRED_HITS = 39  # of 40: measured 40/40 on the seed, minus one question (golden.yaml)


def _append_step_summary(text: str) -> None:
    """GitHub Actions shows $GITHUB_STEP_SUMMARY on the run page (sync: no async file I/O)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as summary:
            summary.write(text)


async def test_golden_questions_find_their_sources(
    db: async_sessionmaker[AsyncSession], capsys: pytest.CaptureFixture[str]
) -> None:
    """Real embedder over the seed content; downloads the model on first run (~130 MB)."""
    embedder = FastEmbedEmbedder(os.environ.get("API_EMBEDDING_CACHE_DIR") or None)
    await IndexService(db, FakeSource(load_seed_content()), embedder).sync()
    results = await run_golden(Retriever(db, embedder), load_golden())
    ranks = [r.rank for r in results]
    hits = sum(r is not None for r in ranks)
    line = (
        f"golden retrieval (seed): hit@5 {hit_rate(ranks):.3f} ({hits}/{len(ranks)}), "
        f"MRR {mean_reciprocal_rank(ranks):.3f}"
    )
    with capsys.disabled():
        print(f"\n{line}")
    _append_step_summary(f"### Golden retrieval\n\n{line}\n\n")
    misses = [f"{r.question!r} -> {r.titles}" for r in results if r.rank is None]
    assert hits >= REQUIRED_HITS, "\n".join(misses)
