"""Retrieval and latency scores for chat-eval and the golden test."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from importlib.resources import files
from typing import Any

import yaml

from portfolio_api.services.chat import SearchesIndex

HIT_K = 5  # hit@5: an expected title in the top 5 hits (the retriever returns at most 5)


def load_golden() -> list[dict[str, Any]]:
    text = files("portfolio_api.evals").joinpath("golden.yaml").read_text()
    cases: list[dict[str, Any]] = yaml.safe_load(text)
    return cases


def first_hit_rank(titles: Sequence[str], expect: Sequence[str]) -> int | None:
    """1-based rank of the first title containing an expected substring, within the top HIT_K."""
    for rank, title in enumerate(titles[:HIT_K], start=1):
        if any(e in title for e in expect):
            return rank
    return None


def hit_rate(ranks: Sequence[int | None]) -> float:
    """hit@5: the share of questions with an expected title in the top 5 (0.0 for none)."""
    return sum(r is not None for r in ranks) / len(ranks) if ranks else 0.0


def mean_reciprocal_rank(ranks: Sequence[int | None]) -> float:
    """MRR: the mean of 1/rank of the first expected title, 0 when none is in the top 5."""
    return sum(1 / r for r in ranks if r is not None) / len(ranks) if ranks else 0.0


def percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile, q in (0, 1]; 0.0 when there are no values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)]


@dataclass(frozen=True)
class GoldenResult:
    question: str
    titles: list[str]  # the retrieved hits' titles, best first
    rank: int | None


async def run_golden(
    retriever: SearchesIndex, cases: Sequence[dict[str, Any]]
) -> list[GoldenResult]:
    """Each golden question through retrieval only: no model call, no tokens."""
    results: list[GoldenResult] = []
    for case in cases:
        titles = [h.title for h in (await retriever.search(case["question"])).hits]
        results.append(
            GoldenResult(case["question"], titles, first_hit_rank(titles, case["expect"]))
        )
    return results
