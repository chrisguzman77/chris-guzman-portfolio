# Chat Reranker Trial (PR 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Executed: Task 1 only. Chris chose to record the negative result (ADR 0013) instead of Tasks 2-3.**

**Goal:** Grow the golden retrieval set from 16 to 40 questions and recalibrate its CI gate. Add an optional cross-encoder reranker (`API_RERANKER=off|minilm`, default `off`), so production is unchanged. Add `chat-eval --reranker` so the deployed image can measure off vs. on against the live index. PR 4b decides whether to keep it.

**Architecture:**
- **Golden set:** `evals/golden.yaml` gains 24 questions: paraphrases, FAQ answers, and questions that only the blog post answers.
  - **Seed:** the test seed loader (`tests/rag/seed.py`) adds the published post from `content/posts/*.md`, because Directus seeds no posts.
  - **Gate:** `REQUIRED_HITS` becomes 39 of 40, which is the measured 40/40 with the reranker off, minus one.
- **Reranker:**
  - **`rag/reranker.py`:** `FastEmbedReranker` wraps fastembed's `TextCrossEncoder("Xenova/ms-marco-MiniLM-L-6-v2")`. It loads lazily in a worker thread, like the embedder.
  - **`rag/retrieval.py`:** splits `fuse` into `rrf` (fusion, best first) and `pick` (the per-document cap and `TOP_K`); `fuse` stays as `pick(rrf(...))`. With a reranker, `Retriever.search` scores the first `RERANK_CANDIDATES`=20 fused hits, sorts them by score, then calls `pick`.
  - **Unchanged:** `best_similarity`, the no-match cutoff, still uses vector similarity.
  - **Timing:** `Retrieved` gains `rerank_seconds`.
- **Setting and image:** `Settings.reranker` is `API_RERANKER`. `main.py` passes `make_reranker(...)` into `Retriever`. The Dockerfile bakes the model into `/app/models`, next to the embedder.
- **Measurement:**
  - **`chat-eval --reranker off|minilm`** overrides the setting for one run. It can't be combined with `--record`, so a comparison run is summary-only and no migration is needed.
  - **The summary** gains a `Reranker` row, plus `Rerank p50 / p95 (golden)` when it reranked.
  - **The `chat-eval` workflow** gains a `reranker` input and an "api container memory" table.
  - **The CI golden test** runs both modes on the seed and prints an off/on table.
  - **CI caches** both models.
- **Docs:** a runbook note on running the comparison.

**Tech Stack:** FastAPI service code, fastembed 0.8.1 (`TextCrossEncoder`, onnxruntime on CPU), pydantic-settings, pytest (via `uv`), GitHub Actions (`actions/cache`), Docker.

**Spec:** `docs/superpowers/specs/2026-10-12-chat-quality-design.md`, section "PR 4: Reranker". These subsections are binding for **PR 4a**, except for the resolutions below:
- "Golden set expansion";
- "Reranker";
- "Measurement";
- "Two PRs", the PR 4a bullet;
- "Tests".

The decision and ADR 0013 belong to PR 4b.

**Base:** `main` at `f0516d6`, which includes PRs 1–3b: feedback, `chat_eval_runs` with `--record/--summary-file/--kind`, the golden set with hit@5/MRR, the red-team cases and the hardening.

**fastembed API (verified during planning against the installed fastembed 0.8.1 in this worktree's `uv` env):**
- **Import:** `from fastembed.rerank.cross_encoder import TextCrossEncoder`. It's not exported from the top-level `fastembed`.
- **Constructor:** `TextCrossEncoder(model_name: str, cache_dir: str | None = None, threads: int | None = None, providers=None, cuda=..., device_ids=None, lazy_load: bool = False, **kwargs)`. It raises `ValueError` for an unsupported name.
- **Scoring:** `rerank(query: str, documents: Iterable[str], batch_size: int = 64, **kwargs) -> Iterable[float]`. It yields one plain Python `float` per document, in input order (a raw logit, higher is better, often negative).
  - **Also available:** `rerank_pairs(pairs, batch_size=64, parallel=None)` and `list_supported_models()`.
- **Supported models:** `TextCrossEncoder.list_supported_models()` lists `Xenova/ms-marco-MiniLM-L-6-v2` (`size_in_GB` 0.08, file `onnx/model.onnx`), alongside MiniLM-L-12, bge-reranker-base and the jina rerankers.
- **Caching and offline use:**
  - **Cache lookup first:** `download_model` tries the cache with `local_files_only=True`, and `HF_HUB_OFFLINE=1` forces it. So a cached model never touches the network.
  - **Default cache:** with `cache_dir=None`, the cache is `$FASTEMBED_CACHE_PATH`, or else `<tmp>/fastembed_cache`.
- **Session options:** the only exposed one is `enable_cpu_mem_arena`.

**Early measurement (during planning, 2026-10-13; scratch database, nothing committed):**

| | Reranker off | minilm |
|---|---|---|
| Seed golden hit@5 (40 questions below, post included) | 1.000 (40/40) | 0.975 (39/40) |
| Seed golden MRR | 0.867 | 0.908 |
| Rerank time per question over the seed golden set, Apple M1 (native) | — | p50 ≈ 0.9–1.2 s, p95 ≈ 1.6–2.2 s |
| Rerank of 20 × 250-word chunks, Linux arm64 container on the M1 | — | p50 ≈ 4.0 s at batch 1, 4.5 s at batch 4 |
| Peak RSS of one process with the embedder, Linux container | ≈ 190 MB | batch 1: ≈ 334 MB · batch 4: ≈ 452 MB · one batch of 20 (the fastembed default): ≈ 1,117 MB |

- **The only minilm miss** is "What machine learning experience does he have?": the cross-encoder puts the College of Allied Health Professions internship and post chunks above SteelGate and the lakehouse.
- **Latency:** the spec's ship gate is added p95 ≤ 300 ms. Locally the rerank alone is 5–7× that, and the VM's CPU is unlikely to be faster.

**Chris must decide before Task 2** (the golden expansion, Task 1, ships either way):
- **(a) Recommended:** run Tasks 2–3 as specified, so the live VM numbers decide in PR 4b, as the spec requires.
- **(b)** Stop after Task 1, and let PR 4b record "removed" with the local numbers above.

**Spec resolutions (decided while planning):**
1. **Post content in the seed.**
   - **Why the seed needs it:** `infra/directus/bootstrap.mjs` `SEED_ORDER` seeds no posts; posts are written in Directus. Without the post, no question "whose answer sits in a post" can pass in CI.
   - **The minimal addition:** `tests/rag/seed.py` reads `content/posts/*.md` (front matter plus body) into `SiteContent.posts`. That is the published post's text, so there's no copied JSON that could drift, and no bootstrap change.
   - **Effect on the original 16:** measured off, all 16 still hit after the post's 11 extra chunks.
2. **Two original expectations gain the FAQ title.** "What is Chris studying?" and "When does he graduate?" also accept `"What are you studying"`. The FAQ "What are you studying, and when do you graduate?" (added in 7b, after the golden set) answers both directly. Chris reviews them with the new questions.
3. **The gates.**
   - **`REQUIRED_HITS = 39`:** the spec's rule, the measured 40/40 off minus one question.
   - **`RERANKED_REQUIRED_HITS = 38`:** the minilm run, measured at 39/40, minus one. The spec has no gate for the "on" mode; this floor only catches a broken reranker (for example, scores applied to the wrong hits) and doesn't judge the trial.
   - **Both thresholds and their measurements are in the YAML header.**
   - **If CI measures differently** (onnxruntime on x86 vs. arm64 can flip a near-tie), the CI log's numbers win: set each constant to the CI count minus one, and update the header to match.
4. **The reranker's interface.**
   - **The protocol:** `Reranker` with `async scores(question: str, texts: Sequence[str]) -> list[float]`, implemented by `FastEmbedReranker(cache_dir)`.
   - **One factory:** `make_reranker(mode: str, cache_dir: str | None) -> Reranker | None`, used by `main.py`, `cli.py` and nothing else.
   - **No new cache setting:** both models live in `embedding_cache_dir` (`/app/models` in the image).
5. **`RERANK_BATCH = 1`, not the fastembed default of 64 (one batch of all 20).**
   - **Memory:** measured in a Linux container, one batch of 20 peaks at ≈ 1.1 GB, more than the api container's whole 768m limit. Batch 4 peaks at ≈ 450 MB and batch 1 at ≈ 334 MB.
   - **Speed:** batch 1 is no slower, because there's no padding to the longest chunk.
   - **Arena:** turning off onnxruntime's arena (`enable_cpu_mem_arena=False`) made it worse (643 MB at batch 4), so it stays on.
6. **Retrieval order.**
   - **Candidates:** the first 20 hits of the full RRF list, before any per-document cap. Each `(question, chunk content)` pair is scored, the chunk content starting with its title.
   - **Order:** a stable sort by score, so ties keep the fused order. Then `pick` applies `PER_DOCUMENT` and `TOP_K`.
   - **With the reranker off,** `search` still returns `fuse(...)`, byte-for-byte today's behaviour.
   - **A reranker error** propagates like an embedder error. `ChatService` already turns a retrieval failure into the `error` outcome.
7. **Recording: no migration.**
   - **Comparison runs aren't recorded:** `--reranker` and `--record` are a mutually exclusive argparse group. So every `chat_eval_runs` row is the deployed setting, identified by its `commit`.
   - **The mode appears in the summary:** a `| Reranker | off/minilm |` row from `chat-eval`, both kinds, plus `| Rerank p50 / p95 (golden) |` when it reranked.
   - **The workflow:** a non-default `reranker` input passes `--reranker` and drops `--record`. Scheduled runs are unchanged.
8. **Rerank latency** is timed inside `Retriever.search` around the scoring call only (`Retrieved.rerank_seconds`), and carried by `GoldenResult.rerank_seconds`.
   - **On the VM, the timings are warm:** the answer cases run first through the same retriever and load the model.
   - **In the seed test,** the first golden question includes the model load. With 40 values, nearest-rank p95 is the 38th, so that one cold outlier doesn't reach p95.
9. **Memory on the VM** (estimate from the measurements above; the api server process is about 300 MB, per the compose comment).
   - **Today's answer eval:** a second process with the embedder, about 250 MB, so the container peaks near 550 MB.
   - **A minilm comparison eval:** embedder plus reranker at batch 1, about 340–400 MB, so the container peaks near **700 MB of 768m**. That's tight but under.
   - **If it's OOM-killed:**
     - **Which process dies:** the memcg OOM killer takes the largest process in the cgroup, which is the eval, not uvicorn.
     - **What shows:** the eval step exits 137.
     - **What to do:** the runbook says to raise `mem_limit` to `1g` in a PR and re-run.
   - **4a doesn't change `mem_limit`.**
   - **The workflow** prints the container's memory before and after the run, plus the cgroup v2 `memory.peak`. So Claude can collect the numbers without SSH.
10. **The trial never touches production.** `API_RERANKER` isn't set in compose, so the default `off` applies. The image grows by about 90 MB (the ONNX model). The api server never loads the reranker.
11. **CI caching.**
    - **The cache:** `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0` (the pin `ci.yml` already uses). Its path is `${{ runner.temp }}/fastembed`, and its key hashes `rag/embedder.py` and `rag/reranker.py`, where the model names live.
    - **How the test finds it:** the pytest step sets `FASTEMBED_CACHE_PATH`. The test still passes `cache_dir=None`, so `Settings` is untouched.
    - **The Docker build** still downloads both models once per build (≈ 5 s more than today).
12. **CI time** (estimate).
    - **Today:** the api job takes about 1.5 min (pytest 28 s on run 115482635041).
    - **Added:**
      - the minilm golden pass, 40 questions × 20 pairs, about 40–80 s on a 4-vCPU x86 runner;
      - the post's chunks, a few seconds;
      - the image's model download, about 5 s.
    - **Expected total:** about **2.5–3 min**. The 15-minute timeout is unchanged.
    - **Locally:** `uv run pytest` grows by about 45 s on an M1.
13. **Content the CI can't seed.** No question depends only on the resume PDF, which is indexed live but isn't in the repo. Live, the `Resume` document may also rank, which is why "Can I download his resume?" accepts `"Resume"` too.
14. **The dashboard trend.** hit@5 and MRR in `chat_eval_runs` step when the set grows from 16 to 40. The runbook says so. No data migration.

## Global Constraints

- **Work location:** only the git worktree `/Users/christopherguzman/Desktop/coding_projects/chris-guzman-portfolio/.superpowers/worktrees/chat-reranker`, on branch `feat/chat-reranker`. Every path below is relative to it. Never touch, or run git in, the main checkout `/Users/christopherguzman/Desktop/coding_projects/chris-guzman-portfolio`, which Chris is using on another branch.
- **Names (use exactly):**
  - **`portfolio_api.rag.reranker`:**
    - `RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"`;
    - `RERANK_BATCH = 1`;
    - `class Reranker(Protocol)` with `async def scores(self, question: str, texts: Sequence[str]) -> list[float]`;
    - `class FastEmbedReranker` with `__init__(self, cache_dir: str | None = None)`;
    - `make_reranker(mode: str, cache_dir: str | None) -> Reranker | None`.
  - **`portfolio_api.rag.retrieval`:**
    - `RERANK_CANDIDATES = 20`;
    - `rrf(vector_hits, keyword_hits) -> list[ChunkHit]`;
    - `pick(hits) -> list[ChunkHit]`;
    - `rerank_order(hits, scores) -> list[ChunkHit]`;
    - `fuse` kept;
    - `Retriever(sessions, embedder, reranker: Reranker | None = None)`;
    - `Retrieved.rerank_seconds: float | None = None`.
  - **Settings:** `reranker: Literal["off", "minilm"] = "off"` (env `API_RERANKER`).
  - **Evals:**
    - `GoldenResult.rerank_seconds: float | None = None`;
    - `EvalReport.reranker: str | None = None`;
    - `EvalReport.rerank_seconds: tuple[float, ...] = ()`;
    - `EvalReport.rerank_ms(q)`.
  - **CLI:** `--reranker {off,minilm}`, mutually exclusive with `--record`.
- **Production unchanged:** no compose change, no `mem_limit` change, no migration (`alembic current` stays `e4a1b7c3d826 (head)`), no ADR in this PR (ADR 0013 is PR 4b).
- **Secrets and tooling:**
  - Never create, read or write `.env` or `.env.*` files. (`apps/api/env.example` is a committed example, not one of them.) Never run sops, `make secrets-*` or `scripts/deploy.sh`.
  - Python only through `uv` (`uv run ...`, from `apps/api`), never pip and never plain `python` or `python3`, even for one-off edits or checks.
- **Style:** match the existing code style, comment density and naming. Make surgical changes only. Add no dependencies (fastembed is already one). Lines are at most 100 characters (ruff). pyright is `strict`.
- **YAML:** quote `"off"` wherever it's a value in a GitHub workflow (YAML 1.1 reads a bare `off` as `false`).
- **Commits:** on branch `feat/chat-reranker`. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
- **Command timeouts:** run every test suite, docker or model-download command with an explicit timeout on the tool call (10 minutes is enough for each). macOS has no `timeout` binary, so use the tool's timeout setting instead.
- **DB tests** need the migrated dev Postgres on host port 55432 (port 5432 is taken on Chris's Mac; see `apps/api/README.md`).
  - **Shared container:** the compose project `portfolio-dev` is shared by every checkout, so its container `portfolio-dev-postgres-1` may already be running from another worktree. If `docker ps` shows it healthy on `127.0.0.1:55432`, use it as it is. Only if it's absent, start it from this worktree: `POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres`.
  - **The prefix:** every API command that touches the database is prefixed with `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio`. Shell state doesn't persist between commands, so always write the prefix out.
  - **One checkout at a time:** the `db` fixture truncates every app table, so run the suite from only one checkout at a time.
- **Models:** the first golden run downloads bge-small (≈ 67 MB) and the MiniLM cross-encoder (≈ 90 MB) into fastembed's default cache. Later runs are offline.
- **Before a task's final checks** (API, from `apps/api`): `uv run ruff format . && uv run ruff check --fix .`, then `uv run pyright`.
- **Checks that must pass at the end:**
  - **API** (from `apps/api`): `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `alembic check`, and `uv run pytest`. Each command that touches the database carries the `API_DATABASE_URL` prefix.
  - **Image:** `docker build` of `apps/api`, then the offline reranker smoke run (Task 2, Step 9).

## File map

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/portfolio_api/evals/golden.yaml` | 40 questions; header with both gates | 1 |
| `apps/api/tests/rag/seed.py` | Posts from `content/posts/*.md` | 1 |
| `apps/api/tests/rag/test_documents.py` | The seed has one post | 1 |
| `apps/api/tests/test_eval_scoring.py` | 40 unique golden questions; `rerank_seconds` carried | 1, 2 |
| `apps/api/tests/rag/test_golden.py` | Gate 39; then both modes, off/on table, floor 38 | 1, 2 |
| `apps/api/src/portfolio_api/rag/reranker.py` (new) | `Reranker`, `FastEmbedReranker`, `make_reranker` | 2 |
| `apps/api/src/portfolio_api/rag/retrieval.py` | `rrf`, `pick`, `rerank_order`, reranking `Retriever`, `rerank_seconds` | 2 |
| `apps/api/src/portfolio_api/config.py` | `reranker` setting | 2 |
| `apps/api/src/portfolio_api/main.py` | Pass `make_reranker(...)` to `Retriever` | 2 |
| `apps/api/src/portfolio_api/evals/scoring.py` | `GoldenResult.rerank_seconds` | 2 |
| `apps/api/Dockerfile` | Bake the cross-encoder into `/app/models` | 2 |
| `apps/api/env.example` | `API_RERANKER=off` | 2 |
| `apps/api/tests/rag/test_reranker.py` (new) | Order, cap after rerank, setting, lazy load, supported model, `Retriever` with a fake | 2 |
| `apps/api/tests/fakes.py` | `FakeRetriever(rerank_seconds=...)` | 2 |
| `apps/api/src/portfolio_api/evals/report.py` | `reranker`, `rerank_seconds`, `rerank_ms`, two summary rows | 3 |
| `apps/api/src/portfolio_api/cli.py` | `--reranker` (exclusive with `--record`), threaded to `Retriever`, `evaluate`, `evaluate_redteam` | 3 |
| `apps/api/tests/test_eval_report.py`, `apps/api/tests/test_cli.py` | Summary rows; flag parsing and override; evaluate carries timings | 3 |
| `.github/workflows/chat-eval.yml` | `reranker` input; memory table | 3 |
| `.github/workflows/ci.yml` | Model cache; `FASTEMBED_CACHE_PATH` on pytest | 3 |
| `docs/runbook.md` | Golden set note; reranker comparison | 3 |

---

### Task 1: Golden set from 16 to 40, the post in the seed, gate 39

**Files:**
- Modify: `apps/api/src/portfolio_api/evals/golden.yaml` (whole file).
- Modify: `apps/api/tests/rag/seed.py` (whole file).
- Modify: `apps/api/tests/rag/test_documents.py:163-169` (`test_seed_content_builds_one_document_per_item`).
- Modify: `apps/api/tests/test_eval_scoring.py:43-46` (`test_golden_set_ships_in_the_package_and_is_well_formed`).
- Modify: `apps/api/tests/rag/test_golden.py:13,26` (`REQUIRED_HITS`, docstring).

**Interfaces:**
- Consumes (existing; don't change them):
  - `load_golden()`, `run_golden(retriever, cases)` and `first_hit_rank` in `portfolio_api.evals.scoring`;
  - `SiteContent` and `build_documents` in `portfolio_api.rag.documents`, whose `_post` reads `title`, `slug`, `excerpt`, `tags`, `published_at` and `body`.
- Produces:
  - `tests.rag.seed.load_seed_content()`, now with `posts` filled from `content/posts/*.md`;
  - `POSTS_DIR` in `tests.rag.seed`;
  - `golden.yaml` with 40 questions;
  - `REQUIRED_HITS = 39`.

- [ ] **Step 1: Check the dev Postgres**

Run: `docker ps --filter name=portfolio-dev-postgres-1 --format '{{.Names}} {{.Status}} {{.Ports}}'`

Expected: `portfolio-dev-postgres-1 Up … (healthy) 127.0.0.1:55432->5432/tcp`. If it prints nothing, run `POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres` from the repo root and wait until it's healthy.

Then (from `apps/api`): `uv sync --frozen && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run alembic upgrade head && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run alembic current`

Expected: `e4a1b7c3d826 (head)`.

- [ ] **Step 2: Write the failing tests**

In `apps/api/tests/rag/test_documents.py`, in `test_seed_content_builds_one_document_per_item`, after `assert len(by_type(docs, "faq")) == 8`, add:

```python
    # content/posts/*.md: Directus seeds no posts, so the seed loader reads the post's text.
    [post] = by_type(docs, "posts")
    assert post.title == "How I built this site"
    assert post.url == "/blog/how-i-built-this-site"
    assert "Published Oct 2026." in post.markdown and "Cloudflare Tunnel" in post.markdown
```

In `apps/api/tests/test_eval_scoring.py`, replace `test_golden_set_ships_in_the_package_and_is_well_formed` with:

```python
def test_golden_set_ships_in_the_package_and_is_well_formed() -> None:
    cases = load_golden()
    assert len(cases) == 40
    assert len({case["question"] for case in cases}) == 40  # no duplicates
    assert all(case["question"] and case["expect"] for case in cases)
```

- [ ] **Step 3: Run them to verify they fail**

Run (from `apps/api`): `uv run pytest tests/rag/test_documents.py::test_seed_content_builds_one_document_per_item tests/test_eval_scoring.py::test_golden_set_ships_in_the_package_and_is_well_formed -v`

Expected: both FAIL. The first with `ValueError: not enough values to unpack (expected 1, got 0)`, the second with `assert 16 == 40`.

- [ ] **Step 4: Load the post in the seed**

Replace `apps/api/tests/rag/seed.py` with:

```python
import json
import warnings
from pathlib import Path
from typing import Any

import yaml

from portfolio_api.rag.documents import SiteContent

SEED_DIR = Path(__file__).resolve().parents[4] / "infra" / "directus" / "seed"
POSTS_DIR = SEED_DIR.parents[2] / "content" / "posts"  # infra/directus/seed -> repo root


def _items(name: str) -> list[dict[str, Any]]:
    path = SEED_DIR / f"{name}.json"
    if not path.exists():
        warnings.warn(f"seed file missing: {path}", stacklevel=2)
        return []
    items: list[dict[str, Any]] = json.loads(path.read_text())
    # Seed rows have no ids (Directus assigns them); number them like Directus would.
    return [{"id": i, **item} for i, item in enumerate(items, start=1)]


def _posts() -> list[dict[str, Any]]:
    """The published posts' text: front matter plus body of each content/posts/*.md."""
    posts: list[dict[str, Any]] = []
    for i, path in enumerate(sorted(POSTS_DIR.glob("*.md")), start=1):
        _, front_matter, body = path.read_text().split("---\n", 2)
        fields: dict[str, Any] = yaml.safe_load(front_matter)
        posts.append({"id": i, **fields, "body": body.strip()})
    return posts


def load_seed_content() -> SiteContent:
    profile: dict[str, Any] = json.loads((SEED_DIR / "profile.json").read_text())
    return SiteContent(
        profile=profile,
        experience=_items("experience"),
        education=_items("education"),
        involvement=_items("involvement"),
        # infra/directus/bootstrap.mjs SEED_ORDER has no certifications or posts; posts are
        # written in Directus, so the golden questions about a post read its content/ text.
        certifications=[],
        faq=_items("faq"),
        projects=_items("projects"),
        posts=_posts(),
        resume_text=None,
    )
```

- [ ] **Step 5: Write the 40-question golden set**

Replace `apps/api/src/portfolio_api/evals/golden.yaml` with this exact content. Chris reviews the new questions in the PR.

```yaml
# Golden retrieval questions: each should find one of its expected documents (by title
# substring) in the top 5 results. Scored two ways, both by retrieval only (no model call):
# - CI (tests/rag/test_golden.py) over infra/directus/seed/*.json plus content/posts/*.md
#   (Directus seeds no posts), with the reranker off and on (API_RERANKER). Passing
#   thresholds: 39 of 40 off (measured 40/40 on 2026-10-13, minus one question) and 38 of 40
#   with minilm (measured 39/40, minus one).
# - `portfolio-api chat-eval` over the live index, recorded as hit@5 and MRR.
# Lives in the package so the CLI can read it from the image.
# The first 16 are the original set; the other 24 were added for the reranker trial (PR 4a).

- question: What is Chris studying?
  expect: ["B.S. in Computer Science", "What are you studying"]
- question: When does he graduate?
  expect: ["B.S. in Computer Science", "About Christopher Guzman", "What are you studying"]
- question: Has he done any cybersecurity compliance or risk work?
  expect: ["SIEGE CyberOps"]
- question: What machine learning experience does he have?
  expect: ["SteelGate", "Cyber Threat Lakehouse"]
- question: Has he built anything with Three.js?
  expect: ["College of Allied Health Professions"]
- question: What did he do at Jubilee Farms?
  expect: ["Jubilee Farms"]
- question: Tell me about the offline payment project.
  expect: ["OFFRes"]
- question: Did he win any hackathons?
  expect: ["OFFRes"]
- question: Has he worked with Apache Spark?
  expect: ["Cyber Threat Lakehouse"]
- question: How did he implement authentication for the ACM site?
  expect: ["ACM@AU"]
- question: How is this portfolio deployed?
  expect: ["This portfolio"]
- question: Where is Chris located?
  expect: ["About Christopher Guzman"]
- question: Is he in a fraternity?
  expect: ["Delta Chi"]
- question: Has he worked with Kubernetes?
  expect: ["SteelGate"]
- question: Does he know FastAPI?
  expect: ["ACM@AU", "OFFRes", "This portfolio", "College of Allied Health Professions"]
- question: Is Chris open to relocation?
  expect: ["relocate"]

# Answered by the FAQ (shown on /contact), in a recruiter's words.
- question: Where does Chris go to school?
  expect: ["B.S. in Computer Science", "What are you studying"]
- question: Is he looking for an internship or a full-time job?
  expect: ["internships or full-time roles"]
- question: What kinds of jobs is he interested in?
  expect: ["What roles are you interested in"]
- question: Would he need a visa to work in the US?
  expect: ["visa sponsorship"]
- question: Can he work remotely?
  expect: ["relocate"]
- question: Which languages and frameworks is he strongest in?
  expect: ["strongest stack"]
- question: How can I contact Chris?
  expect: ["best way to reach you"]
- question: Can I download his resume?
  expect: ["Where can I get your resume", "Resume"]

# Experience, paraphrased (none of these repeat the page's own words).
- question: Tell me about the radiation therapy simulator.
  expect: ["College of Allied Health Professions"]
- question: Has he maintained a legacy ASP.NET application?
  expect: ["Jubilee Farms"]
- question: Has he built an anomaly detection model?
  expect: ["SteelGate"]
- question: Does he have experience with Elasticsearch and Kibana?
  expect: ["SteelGate"]
- question: Has he assessed the security of third-party vendors?
  expect: ["SIEGE CyberOps"]
- question: Has he handled regulated data like PHI or FERPA records?
  expect: ["SIEGE CyberOps"]

# Projects, paraphrased.
- question: How does the offline device verify a payment without a server?
  expect: ["OFFRes"]
- question: Has he worked with Delta Lake or Databricks?
  expect: ["Cyber Threat Lakehouse"]
- question: Has he set up two-factor authentication?
  expect: ["ACM@AU"]
- question: Has he built a content management system?
  expect: ["ACM@AU"]
- question: Has he built a RAG system or run a local LLM?
  expect: ["OFFRes", "How I built this site"]

# Answered by the blog post "How I built this site", not by a project page.
- question: How is the site backed up?
  expect: ["How I built this site"]
- question: How does he monitor the site and get alerts?
  expect: ["How I built this site"]
- question: Which model answers questions in the site's chat?
  expect: ["How I built this site"]
- question: What went wrong with the newsletter subscription confirmations?
  expect: ["How I built this site"]
- question: Why did he pick Directus as the CMS?
  expect: ["How I built this site", "This portfolio"]
```

- [ ] **Step 6: Recalibrate the gate**

In `apps/api/tests/rag/test_golden.py`, change `REQUIRED_HITS = 15` to:

```python
REQUIRED_HITS = 39  # of 40: measured 40/40 on the seed, minus one question (golden.yaml)
```

- [ ] **Step 7: Run the tests to verify they pass, and read the measurement**

Run (from `apps/api`, timeout 10 minutes): `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/rag/test_documents.py tests/test_eval_scoring.py tests/rag/test_golden.py tests/test_grounding.py -v -s`

Expected:
- all PASS;
- the golden line reads `golden retrieval (seed): hit@5 1.000 (40/40), MRR 0.867` (MRR within ±0.01; the planning run measured 0.867);
- `test_grounding.py` stays green: the post was already in its content list.

If hit@5 isn't 40/40, set `REQUIRED_HITS` to the measured count minus one and fix the YAML header to match. Then tell the reviewer which questions missed: the assert message lists them when the threshold is temporarily raised to 40.

- [ ] **Step 8: Lint, type-check, run the whole suite, commit**

Run (from `apps/api`, timeout 10 minutes): `uv run ruff format . && uv run ruff check --fix . && uv run pyright && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest -q`

Expected: no ruff or pyright errors, and every test passes.

```bash
git add apps/api/src/portfolio_api/evals/golden.yaml apps/api/tests/rag/seed.py apps/api/tests/rag/test_documents.py apps/api/tests/test_eval_scoring.py apps/api/tests/rag/test_golden.py
git commit -m "test(api): golden set grows to 40 with the post in the seed; gate 39 of 40

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reranker module, retrieval wiring, setting, image, golden both modes

**Checkpoint:** before starting, confirm Chris chose option (a) under "Chris must decide before Task 2".

**Files:**
- Create: `apps/api/src/portfolio_api/rag/reranker.py`.
- Modify: `apps/api/src/portfolio_api/rag/retrieval.py` (whole file).
- Modify: `apps/api/src/portfolio_api/config.py:36` (after `embedding_cache_dir`).
- Modify: `apps/api/src/portfolio_api/main.py` (imports, `Retriever(...)` at line 141).
- Modify: `apps/api/src/portfolio_api/evals/scoring.py:56-73` (`GoldenResult`, `run_golden`).
- Modify: `apps/api/Dockerfile:13-14`, `apps/api/env.example:20`.
- Modify: `apps/api/tests/fakes.py` (`FakeRetriever`).
- Create: `apps/api/tests/rag/test_reranker.py`.
- Modify: `apps/api/tests/test_eval_scoring.py` (`test_run_golden_ranks_each_question_without_a_model`), `apps/api/tests/rag/test_golden.py` (whole file).

**Interfaces:**
- Consumes:
  - `FastEmbedEmbedder` and `check_dimensions` in `portfolio_api.rag.embedder`;
  - `repo.vector_search` and `repo.keyword_search`;
  - `ChunkHit(chunk_id, document_id, title, url, content, similarity)`;
  - the `db` fixture;
  - `FakeEmbedder`, plus `FakeSource` and `content_with_projects()` (3 documents, one chunk each, from `tests.rag.test_indexer`);
  - `REQUIRED_HITS` (Task 1).
- Produces (Task 3 relies on these):
  - `make_reranker(mode: str, cache_dir: str | None) -> Reranker | None`;
  - `Retriever(sessions, embedder, reranker=None)`;
  - `Retrieved(hits, best_similarity, rerank_seconds=None)`;
  - `GoldenResult(question, titles, rank, rerank_seconds=None)`;
  - `Settings.reranker`;
  - `FakeRetriever(hits=None, best=0.9, rerank_seconds=None)`.

- [ ] **Step 1: Write the failing reranker tests**

Create `apps/api/tests/rag/test_reranker.py`:

```python
from collections.abc import Sequence

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.config import Settings
from portfolio_api.rag.reranker import RERANKER_MODEL, FastEmbedReranker, make_reranker
from portfolio_api.rag.retrieval import RERANK_CANDIDATES, Retriever, pick, rerank_order
from portfolio_api.repositories.rag import ChunkHit
from portfolio_api.services.indexer import IndexService
from tests.fakes import FakeEmbedder
from tests.rag.test_indexer import FakeSource, content_with_projects

Sessions = async_sessionmaker[AsyncSession]


def hit(chunk_id: int, document_id: int) -> ChunkHit:
    return ChunkHit(chunk_id, document_id, f"T{document_id}", f"/d/{document_id}", "c", None)


class LastFirstReranker:
    """Scores each text by its position, so the last fused candidate ranks first."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    async def scores(self, question: str, texts: Sequence[str]) -> list[float]:
        self.calls.append((question, list(texts)))
        return [float(i) for i in range(len(texts))]


def test_rerank_order_sorts_by_score_and_keeps_fused_order_on_ties() -> None:
    hits = [hit(1, 1), hit(2, 2), hit(3, 3), hit(4, 4)]
    reranked = rerank_order(hits, [0.1, 2.0, 0.1, -1.0])
    assert [h.chunk_id for h in reranked] == [2, 1, 3, 4]


def test_per_document_cap_applies_after_reranking() -> None:
    # Fused order puts three chunks of document 1 first. Capping first would drop chunk 3;
    # reranking first keeps document 1's two best-scored chunks (3 and 1).
    fused = [hit(1, 1), hit(2, 1), hit(3, 1), hit(4, 2)]
    picked = pick(rerank_order(fused, [0.5, 0.1, 0.9, 3.0]))
    assert [h.chunk_id for h in picked] == [4, 3, 1]


async def test_search_reranks_the_fused_candidates_and_keeps_vector_similarity(
    db: Sessions,
) -> None:
    embedder = FakeEmbedder()
    await IndexService(db, FakeSource(content_with_projects()), embedder).sync()
    plain = await Retriever(db, embedder).search("rotating refresh tokens")
    reranker = LastFirstReranker()
    reranked = await Retriever(db, embedder, reranker).search("rotating refresh tokens")
    [(question, texts)] = reranker.calls
    assert question == "rotating refresh tokens"
    assert 1 < len(texts) <= RERANK_CANDIDATES
    assert texts[0] == plain.hits[0].content  # candidates arrive in fused order
    assert [h.content for h in reranked.hits] == texts[::-1]  # 3 documents: nothing capped
    assert reranked.best_similarity == plain.best_similarity  # the cutoff ignores the reranker
    assert plain.rerank_seconds is None
    assert reranked.rerank_seconds is not None and reranked.rerank_seconds >= 0.0


def test_reranker_setting_defaults_off_and_selects_minilm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("API_RERANKER", raising=False)
    assert Settings().reranker == "off"
    assert make_reranker("off", None) is None
    monkeypatch.setenv("API_RERANKER", "minilm")
    reranker = make_reranker(Settings().reranker, "/nonexistent")
    assert isinstance(reranker, FastEmbedReranker)
    # Lazy: nothing is loaded (or downloaded) until the first search.
    assert reranker._model is None  # pyright: ignore[reportPrivateUsage]
    monkeypatch.setenv("API_RERANKER", "bge")
    with pytest.raises(ValidationError):
        Settings()


def test_reranker_model_is_supported_by_fastembed() -> None:
    """Guards a fastembed upgrade: no download, only the registry."""
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    assert RERANKER_MODEL in [m["model"] for m in TextCrossEncoder.list_supported_models()]
```

In `apps/api/tests/test_eval_scoring.py`, replace `test_run_golden_ranks_each_question_without_a_model` with:

```python
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
    assert [r.rerank_seconds for r in results] == [None, None]  # reranker off


async def test_run_golden_carries_the_rerank_time() -> None:
    results = await run_golden(
        FakeRetriever(rerank_seconds=0.25), [{"question": "ACM?", "expect": ["ACM@AU"]}]
    )
    assert [(r.rank, r.rerank_seconds) for r in results] == [(1, 0.25)]
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `apps/api`): `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/rag/test_reranker.py tests/test_eval_scoring.py -v`

Expected: collection ERROR in `test_reranker.py` (`ModuleNotFoundError: No module named 'portfolio_api.rag.reranker'`). `test_run_golden_carries_the_rerank_time` FAILS with `TypeError: FakeRetriever.__init__() got an unexpected keyword argument 'rerank_seconds'`.

- [ ] **Step 3: Create the reranker module**

Create `apps/api/src/portfolio_api/rag/reranker.py`:

```python
import asyncio
import threading
from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from fastembed.rerank.cross_encoder import TextCrossEncoder

RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"
# One pair per onnxruntime call. Measured while planning PR 4a: scoring the 20 candidates in
# one batch (fastembed's default) peaked at ~1.1 GB, batches of 4 at ~450 MB, single pairs at
# ~330 MB (embedder included), with no loss of speed.
RERANK_BATCH = 1


class Reranker(Protocol):
    async def scores(self, question: str, texts: Sequence[str]) -> list[float]: ...


class FastEmbedReranker:
    """MiniLM cross-encoder on CPU. Loaded on first use (~90 MB); every call runs in a worker
    thread. A score is a raw logit: higher is more relevant, and it is often negative."""

    def __init__(self, cache_dir: str | None = None) -> None:
        self._cache_dir = cache_dir
        self._model: TextCrossEncoder | None = None
        self._lock = threading.Lock()

    def _load(self) -> "TextCrossEncoder":
        with self._lock:
            if self._model is None:
                from fastembed.rerank.cross_encoder import TextCrossEncoder

                self._model = TextCrossEncoder(model_name=RERANKER_MODEL, cache_dir=self._cache_dir)
            return self._model

    async def scores(self, question: str, texts: Sequence[str]) -> list[float]:
        if not texts:
            return []

        def run() -> list[float]:
            return list(self._load().rerank(question, list(texts), batch_size=RERANK_BATCH))

        return await asyncio.to_thread(run)


def make_reranker(mode: str, cache_dir: str | None) -> Reranker | None:
    """API_RERANKER: "minilm" reorders the fused hits with the cross-encoder; "off" doesn't."""
    return FastEmbedReranker(cache_dir) if mode == "minilm" else None
```

- [ ] **Step 4: Wire it into retrieval**

Replace `apps/api/src/portfolio_api/rag/retrieval.py` with:

```python
import time
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.rag.embedder import Embedder, check_dimensions
from portfolio_api.rag.reranker import Reranker
from portfolio_api.repositories import rag as repo
from portfolio_api.repositories.rag import ChunkHit

CANDIDATES = 20
TOP_K = 5
PER_DOCUMENT = 2
RRF_K = 60
RERANK_CANDIDATES = 20  # the best fused hits the reranker scores (API_RERANKER=minilm)


@dataclass(frozen=True)
class Retrieved:
    hits: list[ChunkHit]
    best_similarity: float
    rerank_seconds: float | None = None  # time spent reranking; None with the reranker off


def rrf(vector_hits: Sequence[ChunkHit], keyword_hits: Sequence[ChunkHit]) -> list[ChunkHit]:
    """Reciprocal rank fusion: every hit from either search, best first."""
    scores: dict[int, float] = {}
    by_id: dict[int, ChunkHit] = {}
    for ranked in (vector_hits, keyword_hits):
        for rank, hit in enumerate(ranked, start=1):
            scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            by_id.setdefault(hit.chunk_id, hit)  # vector copy first: it carries the similarity
    return [by_id[chunk_id] for chunk_id in sorted(scores, key=lambda c: (-scores[c], c))]


def pick(hits: Sequence[ChunkHit]) -> list[ChunkHit]:
    """In order, at most PER_DOCUMENT chunks per document and TOP_K in total."""
    picked: list[ChunkHit] = []
    per_document: Counter[int] = Counter()
    for hit in hits:
        if per_document[hit.document_id] >= PER_DOCUMENT:
            continue
        picked.append(hit)
        per_document[hit.document_id] += 1
        if len(picked) == TOP_K:
            break
    return picked


def fuse(vector_hits: Sequence[ChunkHit], keyword_hits: Sequence[ChunkHit]) -> list[ChunkHit]:
    """Reciprocal rank fusion, then at most PER_DOCUMENT chunks per document, TOP_K in total."""
    return pick(rrf(vector_hits, keyword_hits))


def rerank_order(hits: Sequence[ChunkHit], scores: Sequence[float]) -> list[ChunkHit]:
    """Hits by reranker score, best first; equal scores keep their fused order."""
    return [hits[i] for i in sorted(range(len(hits)), key=lambda i: -scores[i])]


class Retriever:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        embedder: Embedder,
        reranker: Reranker | None = None,
    ) -> None:
        self._sessions = sessions
        self._embedder = embedder
        self._reranker = reranker

    async def search(self, question: str) -> Retrieved:
        embedding = await self._embedder.embed_query(question)
        check_dimensions([embedding])
        async with self._sessions() as session:
            vector_hits = await repo.vector_search(session, embedding, CANDIDATES)
            keyword_hits = await repo.keyword_search(session, question, CANDIDATES)
        best = max((h.similarity or 0.0 for h in vector_hits), default=0.0)
        if self._reranker is None:
            return Retrieved(fuse(vector_hits, keyword_hits), best)
        # The no-match cutoff (best) stays on vector similarity; the reranker only reorders.
        candidates = rrf(vector_hits, keyword_hits)[:RERANK_CANDIDATES]
        started = time.perf_counter()
        scores = await self._reranker.scores(question, [h.content for h in candidates])
        seconds = time.perf_counter() - started
        return Retrieved(pick(rerank_order(candidates, scores)), best, seconds)
```

- [ ] **Step 5: The setting, the app wiring, the golden timing, the fake**

In `apps/api/src/portfolio_api/config.py`, after `embedding_cache_dir: str | None = None` (line 36), add:

```python
    # The reranker trial (PR 4a): "minilm" reorders the 20 best fused hits with a cross-encoder
    # baked into the image next to the embedder (both in embedding_cache_dir). Off by default.
    reranker: Literal["off", "minilm"] = "off"
```

In `apps/api/src/portfolio_api/main.py`:
- Add the import `from portfolio_api.rag.reranker import make_reranker`, next to the existing `from portfolio_api.rag.retrieval import Retriever` import, in isort order.
- Replace `            Retriever(sessions, embedder),` with:

```python
            Retriever(
                sessions, embedder, make_reranker(settings.reranker, settings.embedding_cache_dir)
            ),
```

In `apps/api/src/portfolio_api/evals/scoring.py`, replace `GoldenResult` and `run_golden` (lines 56-73) with:

```python
@dataclass(frozen=True)
class GoldenResult:
    question: str
    titles: list[str]  # the retrieved hits' titles, best first
    rank: int | None
    rerank_seconds: float | None = None  # the reranker's time for this question; None when off


async def run_golden(
    retriever: SearchesIndex, cases: Sequence[dict[str, Any]]
) -> list[GoldenResult]:
    """Each golden question through retrieval only: no model call, no tokens."""
    results: list[GoldenResult] = []
    for case in cases:
        retrieved = await retriever.search(case["question"])
        titles = [h.title for h in retrieved.hits]
        rank = first_hit_rank(titles, case["expect"])
        results.append(GoldenResult(case["question"], titles, rank, retrieved.rerank_seconds))
    return results
```

In `apps/api/tests/fakes.py`, replace `FakeRetriever` with:

```python
class FakeRetriever:
    def __init__(
        self,
        hits: list[ChunkHit] | None = None,
        best: float = 0.9,
        rerank_seconds: float | None = None,
    ) -> None:
        self.hits = [HIT] if hits is None else hits
        self.best = best
        self.rerank_seconds = rerank_seconds
        self.questions: list[str] = []

    async def search(self, question: str) -> Retrieved:
        self.questions.append(question)
        return Retrieved(self.hits, self.best, self.rerank_seconds)
```

In `apps/api/env.example`, after `API_EMBEDDING_CACHE_DIR=`, add:

```
# Reranker trial: off (default) or minilm
API_RERANKER=off
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run (from `apps/api`): `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/rag/test_reranker.py tests/rag/test_retrieval.py tests/test_eval_scoring.py tests/test_chat_foundation.py -v`

Expected: all PASS. `test_retrieval.py` is unchanged and passes, so `fuse` behaves as before.

- [ ] **Step 7: Run the golden test in both modes**

Replace `apps/api/tests/rag/test_golden.py` with:

```python
import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.evals.scoring import (
    GoldenResult,
    hit_rate,
    load_golden,
    mean_reciprocal_rank,
    percentile,
    run_golden,
)
from portfolio_api.rag.embedder import FastEmbedEmbedder
from portfolio_api.rag.reranker import FastEmbedReranker
from portfolio_api.rag.retrieval import Retriever
from portfolio_api.services.indexer import IndexService
from tests.rag.seed import load_seed_content
from tests.rag.test_indexer import FakeSource

REQUIRED_HITS = 39  # of 40: measured 40/40 on the seed, minus one question (golden.yaml)
RERANKED_REQUIRED_HITS = 38  # of 40 with minilm: measured 39/40, minus one (golden.yaml)


def _append_step_summary(text: str) -> None:
    """GitHub Actions shows $GITHUB_STEP_SUMMARY on the run page (sync: no async file I/O)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as summary:
            summary.write(text)


def _row(mode: str, results: list[GoldenResult]) -> str:
    ranks = [r.rank for r in results]
    hits = sum(r is not None for r in ranks)
    timed = [r.rerank_seconds for r in results if r.rerank_seconds is not None]
    rerank = "n/a"
    if timed:
        p50, p95 = (1000 * percentile(timed, q) for q in (0.5, 0.95))
        rerank = f"{p50:.0f} ms / {p95:.0f} ms"
    return (
        f"| {mode} | {hit_rate(ranks):.3f} ({hits}/{len(ranks)}) "
        f"| {mean_reciprocal_rank(ranks):.3f} | {rerank} |"
    )


async def test_golden_questions_find_their_sources(
    db: async_sessionmaker[AsyncSession], capsys: pytest.CaptureFixture[str]
) -> None:
    """Real models over the seed content, reranker off then minilm. The first run downloads
    both (~160 MB); the first reranked question also loads the cross-encoder."""
    cache_dir = os.environ.get("API_EMBEDDING_CACHE_DIR") or None
    embedder = FastEmbedEmbedder(cache_dir)
    await IndexService(db, FakeSource(load_seed_content()), embedder).sync()
    golden = load_golden()
    off = await run_golden(Retriever(db, embedder), golden)
    minilm = await run_golden(Retriever(db, embedder, FastEmbedReranker(cache_dir)), golden)
    table = "\n".join(
        [
            "| Reranker | hit@5 | MRR | Rerank p50 / p95 |",
            "|---|---|---|---|",
            _row("off", off),
            _row("minilm", minilm),
        ]
    )
    with capsys.disabled():
        print(f"\ngolden retrieval (seed)\n{table}")
    _append_step_summary(f"### Golden retrieval (seed)\n\n{table}\n\n")
    for mode, results, required in [
        ("off", off, REQUIRED_HITS),
        ("minilm", minilm, RERANKED_REQUIRED_HITS),
    ]:
        misses = [f"{r.question!r} -> {r.titles}" for r in results if r.rank is None]
        assert len(results) - len(misses) >= required, f"{mode}:\n" + "\n".join(misses)
```

Run (from `apps/api`, timeout 10 minutes): `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/rag/test_golden.py -v -s`

Expected: PASS (about 1 minute on an M1, most of it reranking), printing a table close to the planning run:

```
| Reranker | hit@5 | MRR | Rerank p50 / p95 |
|---|---|---|---|
| off | 1.000 (40/40) | 0.867 | n/a |
| minilm | 0.975 (39/40) | 0.908 | ~1000 ms / ~2000 ms |
```

If minilm differs from 39/40, set `RERANKED_REQUIRED_HITS` to the measured count minus one, and update the YAML header line to match.

- [ ] **Step 8: Bake the model into the image**

In `apps/api/Dockerfile`, after the embedder's `RUN` line (line 14), add:

```dockerfile
# The reranker trial's cross-encoder (~90 MB), used only when API_RERANKER=minilm.
RUN /app/.venv/bin/python -c "from fastembed.rerank.cross_encoder import TextCrossEncoder; TextCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2', cache_dir='/app/models')"
```

- [ ] **Step 9: Check that the image scores offline**

Run (from the repo root, timeout 10 minutes): `docker build -t reranker-check apps/api`

Expected: the build succeeds.

Then run: `docker run --rm --network none reranker-check python -c "import asyncio; from portfolio_api.rag.reranker import FastEmbedReranker; print(asyncio.run(FastEmbedReranker('/app/models').scores('Has he used Apache Spark?', ['He built a Spark lakehouse.', 'He is in a fraternity.'])))"`

Expected: two floats with the first clearly higher, for example `[5.1, -11.0]`, and no download. `--network none` plus the image's `HF_HUB_OFFLINE=1` prove the model is baked.

Then run: `docker image ls reranker-check --format '{{.Size}}' && docker rmi reranker-check`

Expected: the size, roughly 90 MB more than the previous api image, and the image removed.

- [ ] **Step 10: Lint, type-check, run the whole suite, commit**

Run (from `apps/api`, timeout 10 minutes): `uv run ruff format . && uv run ruff check --fix . && uv run pyright && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest -q`

Expected: no ruff or pyright errors, and every test passes.

```bash
git add apps/api/src/portfolio_api/rag/reranker.py apps/api/src/portfolio_api/rag/retrieval.py apps/api/src/portfolio_api/config.py apps/api/src/portfolio_api/main.py apps/api/src/portfolio_api/evals/scoring.py apps/api/Dockerfile apps/api/env.example apps/api/tests/fakes.py apps/api/tests/rag/test_reranker.py apps/api/tests/test_eval_scoring.py apps/api/tests/rag/test_golden.py
git commit -m "feat(api): optional MiniLM reranker (API_RERANKER, off by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `chat-eval --reranker`, summary rows, workflow input and memory, CI cache, runbook

**Files:**
- Modify: `apps/api/src/portfolio_api/evals/report.py:3,26-34,56-58,95-107`.
- Modify: `apps/api/src/portfolio_api/cli.py:41-42` (imports), `272-311` (`evaluate`), `332-361` (`evaluate_redteam`), `412-455` (`_chat_eval`), `458-485` (`main`).
- Modify: `apps/api/tests/test_eval_report.py`, `apps/api/tests/test_cli.py`.
- Modify: `.github/workflows/chat-eval.yml`, `.github/workflows/ci.yml:116-139`.
- Modify: `docs/runbook.md` (the "Chat quality" section, after the "Run it now" bullet).

**Interfaces:**
- Consumes (Task 2): `make_reranker`, `Retriever(sessions, embedder, reranker)`, `GoldenResult.rerank_seconds`, `Settings.reranker`, `FakeRetriever(rerank_seconds=...)`.
- Produces:
  - `EvalReport(..., reranker: str | None = None, rerank_seconds: tuple[float, ...] = ())` and `EvalReport.rerank_ms(q: float) -> int`;
  - `evaluate(..., reranker: str | None = None)` and `evaluate_redteam(..., reranker: str | None = None)`;
  - `_chat_eval(settings, kind, record, summary_file, reranker: str)`;
  - the CLI flag `--reranker`.

- [ ] **Step 1: Write the failing report and CLI tests**

In `apps/api/tests/test_eval_report.py`:
- Add `from dataclasses import replace` as the first import line, above the existing `from datetime import UTC, datetime, timedelta` (isort order).
- After `test_format_summary_without_failures_or_golden`, add:

```python
def test_format_summary_shows_the_reranker_and_its_golden_latency() -> None:
    reranked = format_summary(replace(REPORT, reranker="minilm", rerank_seconds=(0.2, 0.4, 0.3)))
    assert (
        "| Retrieval MRR | 0.844 |\n"
        "| Reranker | minilm |\n"
        "| Rerank p50 / p95 (golden) | 300 ms / 400 ms |\n"
        "| Latency p50 / p95 |"
    ) in reranked
    plain = format_summary(replace(REPORT, reranker="off"))
    assert "| Retrieval MRR | 0.844 |\n| Reranker | off |\n| Latency p50 / p95 |" in plain
    # The history row has no reranker column: comparison runs are never recorded.
    assert eval_run_row(replace(REPORT, reranker="minilm")).hit_at_5 == 0.9375
```

In `apps/api/tests/test_cli.py`:
- Add `from portfolio_api import cli` above `from portfolio_api.cli import (`.
- After `test_chat_eval_rejects_an_unknown_kind`, add:

```python
def test_chat_eval_reranker_comparison_runs_are_never_recorded(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit):
        main(["chat-eval", "--record", "--reranker", "minilm"])
    assert "not allowed with argument" in capsys.readouterr().err


def test_chat_eval_rejects_an_unknown_reranker() -> None:
    with pytest.raises(SystemExit):
        main(["chat-eval", "--reranker", "bge"])


def test_chat_eval_reranker_overrides_the_setting_for_that_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[bool, str]] = []

    async def fake_chat_eval(
        settings: Settings,
        kind: ChatEvalKind,
        record: bool,
        summary_file: Path | None,
        reranker: str,
    ) -> int:
        seen.append((record, reranker))
        return 0

    monkeypatch.setattr(cli, "_chat_eval", fake_chat_eval)
    monkeypatch.setenv("API_RERANKER", "off")
    assert main(["chat-eval", "--reranker", "minilm"]) == 0
    assert main(["chat-eval", "--record"]) == 0
    assert seen == [(False, "minilm"), (True, "off")]


async def test_evaluate_reports_the_reranker_and_its_golden_latency(
    db: Sessions, tmp_path: Path
) -> None:
    summary = tmp_path / "chat-eval.md"
    await evaluate(
        chat(db, FakeChatModel()),
        FakeRetriever(rerank_seconds=0.25),
        cases={"answerable": [], "refuse": []},
        golden=[{"question": "ACM?", "expect": ["ACM@AU"]}],
        commit=None,
        reranker="minilm",
        summary_file=summary,
        out=lambda _: None,
    )
    text = read(summary)
    assert "| Reranker | minilm |\n| Rerank p50 / p95 (golden) | 250 ms / 250 ms |\n" in text
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `apps/api`): `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_eval_report.py tests/test_cli.py -v -k "reranker"`

Expected:
- `test_format_summary_shows_the_reranker...` FAILS with `TypeError: ... unexpected keyword argument 'reranker'`;
- the comparison-run test FAILS with `DID NOT RAISE` or with an argparse error about `--reranker`;
- the override test FAILS with an argparse `SystemExit`;
- `test_evaluate_reports...` FAILS with `TypeError: evaluate() got an unexpected keyword argument 'reranker'`.

- [ ] **Step 3: Report fields and summary rows**

In `apps/api/src/portfolio_api/evals/report.py`, add two fields at the end of `EvalReport`, after `mrr: float | None`:

```python
    reranker: str | None = None  # the retrieval mode chat-eval ran with (off, minilm)
    rerank_seconds: tuple[float, ...] = ()  # per golden question, when it reranked
```

After `latency_ms`, add:

```python
    def rerank_ms(self, q: float) -> int:
        return round(1000 * percentile(self.rerank_seconds, q))
```

In `format_summary`, replace:

```python
        *_score_rows(report),
        f"| Latency p50 / p95 | {report.latency_ms(0.5)} ms / {report.latency_ms(0.95)} ms |",
```

with:

```python
        *_score_rows(report),
        *_retrieval_rows(report),
        f"| Latency p50 / p95 | {report.latency_ms(0.5)} ms / {report.latency_ms(0.95)} ms |",
```

Add this helper above `format_summary`:

```python
def _retrieval_rows(report: EvalReport) -> list[str]:
    rows = [f"| Reranker | {report.reranker} |"] if report.reranker else []
    if report.rerank_seconds:
        p50, p95 = report.rerank_ms(0.5), report.rerank_ms(0.95)
        rows.append(f"| Rerank p50 / p95 (golden) | {p50} ms / {p95} ms |")
    return rows
```

`eval_run_row` doesn't change (resolution 7).

- [ ] **Step 4: The CLI flag and threading**

In `apps/api/src/portfolio_api/cli.py`:
- Add `from portfolio_api.rag.reranker import make_reranker` after `from portfolio_api.rag.embedder import FastEmbedEmbedder`.
- In `evaluate`, add the parameter `reranker: str | None = None,` after `commit: str | None,`.
- Replace the body from `started_at = datetime.now(UTC)` to the `report = EvalReport(...)` statement with:

```python
    started_at = datetime.now(UTC)
    results = await run_eval(service, cases, out=out, timer=timer)
    golden_error: str | None = None
    try:
        golden_results = await run_golden(retriever, golden)
    except Exception as exc:  # retrieval is the embedder and the database: any failure
        # Keep the answer results; hit@5 and MRR are recorded as NULL. Type name only.
        golden_error = type(exc).__name__
        golden_results = []
    ranks = [g.rank for g in golden_results]
    report = EvalReport(
        kind=ChatEvalKind.answer,
        started_at=started_at,
        finished_at=datetime.now(UTC),
        commit=commit,
        results=results,
        hit_at_5=hit_rate(ranks) if ranks else None,
        mrr=mean_reciprocal_rank(ranks) if ranks else None,
        reranker=reranker,
        rerank_seconds=tuple(
            g.rerank_seconds for g in golden_results if g.rerank_seconds is not None
        ),
    )
```

In `evaluate_redteam`:
- Add the parameter `reranker: str | None = None,` after `commit: str | None,`.
- Add `reranker=reranker,` after `mrr=None,` in its `EvalReport(...)`.

Replace `_chat_eval`'s signature and its `retriever = ...` line:

```python
async def _chat_eval(
    settings: Settings,
    kind: ChatEvalKind,
    record: bool,
    summary_file: Path | None,
    reranker: str,
) -> int:
```

```python
            retriever = Retriever(
                sessions,
                FastEmbedEmbedder(settings.embedding_cache_dir),
                make_reranker(reranker, settings.embedding_cache_dir),
            )
```

Then add `reranker=reranker,` after `commit=commit,` in both the `evaluate_redteam(...)` call and the `evaluate(...)` call.

In `main`, replace:

```python
    evals.add_argument("--record", action="store_true", help="store the run in chat_eval_runs")
```

with:

```python
    # A --reranker run is a comparison: it never writes chat_eval_runs, so that history only
    # holds the deployed setting (API_RERANKER).
    mode = evals.add_mutually_exclusive_group()
    mode.add_argument("--record", action="store_true", help="store the run in chat_eval_runs")
    mode.add_argument(
        "--reranker",
        choices=["off", "minilm"],
        help="override API_RERANKER for this run only (not recordable)",
    )
```

and replace the final `return asyncio.run(...)` with:

```python
    return asyncio.run(
        _chat_eval(
            settings,
            ChatEvalKind(args.kind),
            args.record,
            args.summary_file,
            args.reranker or settings.reranker,
        )
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `apps/api`): `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_eval_report.py tests/test_cli.py -v`

Expected: all PASS. The existing exact `format_summary` tests are unchanged, because `reranker` defaults to `None`.

- [ ] **Step 6: The chat-eval workflow: input and memory table**

In `.github/workflows/chat-eval.yml`, add a line to the header comment after `# summary. Scheduled runs use the default branch only.`:

```yaml
# A manual run can compare retrieval modes (`reranker` input): such a run passes --reranker,
# is never recorded, and only writes the summary (docs/runbook.md, Chat quality).
```

Under `workflow_dispatch.inputs`, after `kind`, add:

```yaml
      reranker:
        description: Retrieval mode. "configured" uses API_RERANKER and records the run; "off" or "minilm" is a comparison run (summary only)
        type: choice
        options: ["configured", "off", "minilm"]
        default: "configured"
```

Replace the steps from `Clear the last summary` through the end of the file with:

```yaml
      - name: Clear the last summary
        run: docker exec portfolio-api-1 rm -f /tmp/chat-eval.md
      - name: Note the api container's memory
        run: docker stats --no-stream --format '{{.MemUsage}}' portfolio-api-1 > "${RUNNER_TEMP}/memory-before.txt"
      - name: Run the eval in the api container
        env:
          KIND: ${{ steps.kind.outputs.kind }}
          RERANKER: ${{ inputs.reranker || 'configured' }}
        run: |
          if [[ "${RERANKER}" == configured ]]; then
            mode=(--record)
          else
            mode=(--reranker "${RERANKER}") # a comparison run: never recorded
          fi
          docker exec portfolio-api-1 portfolio-api chat-eval --kind "${KIND}" "${mode[@]}" --summary-file /tmp/chat-eval.md
      - name: Add the summary to this run's page
        if: always()
        run: |
          if docker cp portfolio-api-1:/tmp/chat-eval.md "${RUNNER_TEMP}/chat-eval.md"; then
            cat "${RUNNER_TEMP}/chat-eval.md" >> "${GITHUB_STEP_SUMMARY}"
          else
            echo "No summary was written; the eval stopped early. See the eval step's log." >> "${GITHUB_STEP_SUMMARY}"
          fi
      - name: Add the api container's memory to this run's page
        if: always()
        run: |
          # memory.peak (cgroup v2, kernel 5.19+) is the container's peak since it started.
          peak=$(docker exec portfolio-api-1 cat /sys/fs/cgroup/memory.peak 2>/dev/null || true)
          if [[ "${peak}" =~ ^[0-9]+$ ]]; then
            peak="$((peak / 1048576))MiB"
          else
            peak="n/a (no cgroup v2 memory.peak)"
          fi
          {
            echo ""
            echo "### api container memory"
            echo ""
            echo "| When | Memory |"
            echo "|---|---|"
            echo "| Before the eval | $(cat "${RUNNER_TEMP}/memory-before.txt" 2>/dev/null || echo n/a) |"
            echo "| After the eval | $(docker stats --no-stream --format '{{.MemUsage}}' portfolio-api-1) |"
            echo "| Peak since the container started | ${peak} |"
          } >> "${GITHUB_STEP_SUMMARY}"
```

- [ ] **Step 7: CI: cache both models**

In `.github/workflows/ci.yml`, in the `api` job:
- After the `- run: uv sync --frozen` step, add:

```yaml
      # The golden test runs the real embedding model and reranker (~160 MB together).
      - name: Model cache
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${{ runner.temp }}/fastembed
          key: fastembed-${{ runner.os }}-${{ hashFiles('apps/api/src/portfolio_api/rag/embedder.py', 'apps/api/src/portfolio_api/rag/reranker.py') }}
```

- Replace `      - run: uv run pytest` with:

```yaml
      - run: uv run pytest
        env:
          FASTEMBED_CACHE_PATH: ${{ runner.temp }}/fastembed
```

- [ ] **Step 8: Check both workflows parse, and that "off" stayed a string**

Run (from `apps/api`): `uv run python -c "import yaml; wf = yaml.safe_load(open('../../.github/workflows/chat-eval.yml')); assert wf[True]['workflow_dispatch']['inputs']['reranker']['options'] == ['configured', 'off', 'minilm']; ci = yaml.safe_load(open('../../.github/workflows/ci.yml')); assert any(s.get('name') == 'Model cache' for s in ci['jobs']['api']['steps']); print('ok')"`

Expected: `ok`. PyYAML reads the `on:` key as `True`, which is why the check indexes `wf[True]`.

- [ ] **Step 9: Runbook**

In `docs/runbook.md`, in "## Chat quality", after the "**Run it now:**" bullet and its two sub-bullets, insert:

```markdown
- **Golden set:** 40 questions since PR 4a (16 before), so the hit@5 and MRR trend on the Chat quality dashboard steps at that date. Don't compare runs across it. CI needs 39 of 40 on the seed content with the reranker off, and 38 of 40 with it on. The header of `apps/api/src/portfolio_api/evals/golden.yaml` says how these were measured.
- **Reranker trial (`API_RERANKER`):** `off` (the default; compose doesn't set it) or `minilm`. `minilm` is a cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`), baked into the image next to the embedding model. It reorders the 20 best fused hits before the top 5 are kept (at most 2 per page). The no-match cutoff still uses vector similarity.
  - **Compare off and on:** run `gh workflow run chat-eval.yml -f kind=answer -f reranker=off`, wait for it to finish, then run the same with `-f reranker=minilm`.
    - **Not recorded:** a run whose `reranker` isn't `configured` passes `--reranker` and is never recorded (`--reranker` and `--record` can't be combined). So Chat quality keeps only the deployed setting's history.
    - **Where the numbers are:** each run's Summary has hit@5, MRR, the rerank p50/p95 over the golden questions, the answer pass rate, and an "api container memory" table: before, after, and the peak since the container started.
    - **Order:** run `off` first. The peak only grows, so the `minilm` run's peak includes the `off` run's.
  - **Budget:** the pair uses about two thirds of a day's Groq budget. Don't run it on a Sunday (the scheduled answer eval).
  - **By hand on the VM:**
    1. `docker stats --no-stream portfolio-api-1` (idle).
    2. `docker exec portfolio-api-1 portfolio-api chat-eval --reranker minilm`, with `docker stats portfolio-api-1` running in a second shell to watch the peak.
    3. `docker exec portfolio-api-1 cat /sys/fs/cgroup/memory.peak` (bytes since the container started).

    Grafana → "Host & containers" → api memory shows the same over time.
  - **Memory:** a comparison eval is a second process in `portfolio-api-1` that holds both models, about 350–400 MB. So the container peaks near 700 MB of its 768m limit. If the eval step exits with 137, it was OOM-killed: raise the api `mem_limit` to `1g` in a PR, then run it again.
```

- [ ] **Step 10: Lint, type-check, run the whole suite, commit**

Run (from `apps/api`, timeout 10 minutes): `uv run ruff format . && uv run ruff check --fix . && uv run pyright && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run alembic check && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest -q`

Expected: no ruff or pyright errors, `No new upgrade operations detected.`, and every test passes.

```bash
git add apps/api/src/portfolio_api/evals/report.py apps/api/src/portfolio_api/cli.py apps/api/tests/test_eval_report.py apps/api/tests/test_cli.py .github/workflows/chat-eval.yml .github/workflows/ci.yml docs/runbook.md
git commit -m "feat(api): chat-eval --reranker comparison runs; CI caches both models

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the PR is open

- **CI:**
  - **The step summary** shows the "Golden retrieval (seed)" off/on table. If its counts differ from the local run, apply resolution 3 (CI's count minus one) in a follow-up commit on this branch.
  - **The api job** should take about 2.5–3 minutes on the first run (cache miss), and a few seconds less after that.
- **Chris:** review the 24 new golden questions and the two widened expectations (Task 1, Step 5), plus the decision under "Chris must decide before Task 2".

## After merge and deploy (Claude, spec "Two PRs", PR 4a)

1. **Wait for the deploy.** The release deploy recreates `portfolio-api-1` (new image), so its `memory.peak` starts fresh.
2. **Run the comparison, `off` first** (not on a Sunday):
   1. `gh workflow run chat-eval.yml -f kind=answer -f reranker=off`, then `gh run watch` on it.
   2. `gh workflow run chat-eval.yml -f kind=answer -f reranker=minilm`, then `gh run watch` on it.
3. **Post one PR comment with the table,** using each run's Summary and this PR's CI step summary:

| | off | minilm |
|---|---|---|
| Golden hit@5, live (40 questions) | | |
| Golden MRR, live | | |
| Rerank p50 / p95, live (golden) | n/a | |
| Answer pass rate, live | | |
| api memory before / after / peak | | |
| Golden hit@5 / MRR, seed (CI) | | |

4. **Check the spec's ship gate:**
   - live MRR improves by ≥ 0.05;
   - live hit@5 doesn't drop;
   - added p95 ≤ 300 ms.

   PR 4b applies the result and writes `docs/adr/0013-reranker.md`.
   - **If 4b ships:** the api server then holds the reranker (about +145 MB, so about 450 MB), and the weekly eval adds another process of about 400 MB. That needs `mem_limit: 1g` (the spec's maximum).
