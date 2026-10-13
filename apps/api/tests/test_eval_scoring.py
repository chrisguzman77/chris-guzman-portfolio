import pytest

from portfolio_api.evals.scoring import (
    first_hit_rank,
    hit_rate,
    load_golden,
    mean_reciprocal_rank,
    percentile,
    run_golden,
)
from portfolio_api.repositories.rag import ChunkHit
from tests.fakes import HIT, FakeRetriever


def test_first_hit_rank_is_one_based_and_stops_at_five() -> None:
    titles = [
        "About Christopher Guzman",
        "SteelGate",
        "B.S. in Computer Science",
        "x",
        "y",
        "Delta Chi",
    ]
    assert first_hit_rank(titles, ["SteelGate"]) == 2
    assert first_hit_rank(titles, ["Computer Science", "About"]) == 1  # the best-ranked match
    assert first_hit_rank(titles, ["Delta Chi"]) is None  # 6th: outside the top 5
    assert first_hit_rank([], ["x"]) is None


def test_hit_rate_and_mean_reciprocal_rank() -> None:
    ranks = [1, 2, None, 4]
    assert hit_rate(ranks) == 0.75
    assert mean_reciprocal_rank(ranks) == pytest.approx((1 + 0.5 + 0 + 0.25) / 4)
    assert hit_rate([]) == 0.0 and mean_reciprocal_rank([]) == 0.0


def test_percentile_is_nearest_rank() -> None:
    values = [float(v) for v in range(10, 0, -1)]  # 10..1, unsorted on purpose
    assert percentile(values, 0.5) == 5.0
    assert percentile(values, 0.95) == 10.0
    assert percentile([3.0], 0.95) == 3.0
    assert percentile([], 0.5) == 0.0


def test_golden_set_ships_in_the_package_and_is_well_formed() -> None:
    cases = load_golden()
    assert len(cases) == 40
    assert len({case["question"] for case in cases}) == 40  # no duplicates
    assert all(case["question"] and case["expect"] for case in cases)


async def test_run_golden_ranks_each_question_without_a_model() -> None:
    lakehouse = ChunkHit(2, 2, "Cyber Threat Lakehouse", "/projects/ctl", "Spark.", 0.8)
    retriever = FakeRetriever([HIT, lakehouse])
    results = await run_golden(
        retriever,
        [{"question": "Spark?", "expect": ["Lakehouse"]}, {"question": "Go?", "expect": ["Go"]}],
    )
    assert [r.rank for r in results] == [2, None]
    assert results[0].titles == ["ACM@AU platform", "Cyber Threat Lakehouse"]
    assert retriever.questions == ["Spark?", "Go?"]
