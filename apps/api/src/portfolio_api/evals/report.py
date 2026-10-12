"""One chat-eval run: per-case results, its scores, the Markdown summary and the history row."""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from portfolio_api.evals.scoring import percentile
from portfolio_api.models import ChatEvalKind, ChatEvalRun

ANSWERABLE: str = "answerable"
REFUSE: str = "refuse"


@dataclass(frozen=True)
class CaseResult:
    id: str  # from the case's place in the eval file: answerable-01, refuse-03, ...
    category: str
    question: str
    reason: str | None  # why it failed; None when it passed
    seconds: float | None  # compose time; None when the model never answered (busy, down)
    tokens: int  # input + output


@dataclass(frozen=True)
class EvalReport:
    kind: ChatEvalKind
    started_at: datetime
    finished_at: datetime
    commit: str | None
    results: list[CaseResult]
    hit_at_5: float | None
    mrr: float | None

    @property
    def failures(self) -> list[CaseResult]:
        return [r for r in self.results if r.reason is not None]

    @property
    def passed(self) -> int:
        return len(self.results) - len(self.failures)

    def pass_rate(self, category: str) -> float | None:
        group = [r for r in self.results if r.category == category]
        return sum(r.reason is None for r in group) / len(group) if group else None

    def latency_ms(self, q: float) -> int:
        timed = [r.seconds for r in self.results if r.seconds is not None]
        return round(1000 * percentile(timed, q))

    @property
    def tokens_per_question(self) -> float:
        answered = [r.tokens for r in self.results if r.seconds is not None]
        return sum(answered) / len(answered) if answered else 0.0


def _rate(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1%}"


def _score(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.3f}"


def _cell(text: str) -> str:
    """One line, and no column breaks, inside a Markdown table cell."""
    return " ".join(text.split()).replace("|", "\\|")


def format_summary(report: EvalReport) -> str:
    when = report.started_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    commit = report.commit[:7] if report.commit else "unknown"
    lines = [
        f"## Chat eval ({report.kind.value})",
        "",
        f"{report.passed}/{len(report.results)} passed · {when} · commit {commit}",
        "",
        "| Score | Value |",
        "|---|---|",
        f"| Answer pass rate | {_rate(report.pass_rate(ANSWERABLE))} |",
        f"| Refusal pass rate | {_rate(report.pass_rate(REFUSE))} |",
        f"| Retrieval hit@5 | {_score(report.hit_at_5)} |",
        f"| Retrieval MRR | {_score(report.mrr)} |",
        f"| Latency p50 / p95 | {report.latency_ms(0.5)} ms / {report.latency_ms(0.95)} ms |",
        f"| Tokens per question | {report.tokens_per_question:.0f} |",
        "",
    ]
    if not report.failures:
        lines.append("No failed cases.")
    else:
        lines += [
            "### Failed cases",
            "",
            "| Case | Category | Question | Reason |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| {f.id} | {f.category} | {_cell(f.question)} | {_cell(f.reason or '')} |"
            for f in report.failures
        ]
    return "\n".join(lines)


def eval_run_row(report: EvalReport) -> ChatEvalRun:
    return ChatEvalRun(
        kind=report.kind,
        started_at=report.started_at,
        finished_at=report.finished_at,
        commit=report.commit,
        cases=len(report.results),
        passed=report.passed,
        answer_pass_rate=report.pass_rate(ANSWERABLE),
        refusal_pass_rate=report.pass_rate(REFUSE),
        hit_at_5=report.hit_at_5,
        mrr=report.mrr,
        latency_p50_ms=report.latency_ms(0.5),
        latency_p95_ms=report.latency_ms(0.95),
        tokens_per_question=report.tokens_per_question,
        failures=[
            {"id": f.id, "category": f.category, "reason": f.reason} for f in report.failures
        ],
    )


def write_summary(path: Path, summary: str) -> None:
    path.write_text(summary + "\n")
