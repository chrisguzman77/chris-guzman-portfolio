# Chat: keep citations on follow-up questions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the chat from answering follow-up questions with the canned "I don't have information" reply. That happens when the model drops its `[n]` citations after seeing earlier answers that had theirs stripped.

**Root cause:** the production log (`make chats`, 2026-10-15) shows the evidence. "What projects has Chris built?" was asked first and `answered` with `[1][5]…`. Asked third in a session, it came back `uncited`, with the same correct text and no `[n]`.
- `build_messages` (`apps/api/src/portfolio_api/services/grounding.py`) sends earlier assistant answers through `strip_citations`.
- After two citation-free "own" answers, gpt-oss imitates that style.
- `cited_sources` then returns `None`, and `compose` swaps in `CANNED_ANSWER`.

**Approach (approved by Chris):**
1. **Reminder:** when there is history, the final user message ends with a one-line reminder to cite this answer's sources with `[n]`.
2. **One retry:** if a reply still has text but no valid citations, and was neither blocked nor a deliberate `NO_ANSWER`, ask the model once more to add the source numbers. The retry also catches leftover cases.
3. **Regression eval:** a multi-turn answerable case in `chat_eval.yaml` that replays Chris's three-question sequence against the real model.

**Tech stack:** Python 3.12, FastAPI service code, pytest (DB tests need `API_DATABASE_URL`; follow `apps/api` README/Makefile for running tests), `uv` only, never plain `python`/`pip`.

## Global Constraints
- Python is run only via `uv` (`uv run pytest`, `uv run ruff`, `uv run pyright`), from `apps/api`.
- Don't change: `CANNED_ANSWER`, `SYSTEM_PROMPT`, the `blocked_reason` checks, `HISTORY_PAIRS`, retrieval, the public API shape, the DB schema.
- **Retry only once**, and only for a reply that has text, isn't blocked, doesn't contain `NO_ANSWER`, and has no valid citations. Never retry a blocked reply. Never retry `NO_ANSWER`, which is a deliberate refusal: the redteam suite depends on refusals staying refusals. Never retry a model error.
- **Tokens:** both calls' input and output tokens are counted, so usage, the budget and metrics stay honest.
- **Stored answer:** if the retry still fails, the stored raw answer is the retry's text.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never create, read or write `.env` files.

---

### Task 1: Reminder on follow-ups + one citation retry

**Files:**
- Modify: `apps/api/src/portfolio_api/services/grounding.py`: `build_messages`, plus two new constants.
- Modify: `apps/api/src/portfolio_api/services/chat.py`: `ChatService.compose`.
- Test: `apps/api/tests/test_grounding.py`, `apps/api/tests/test_chat.py`.

**Interfaces:**
- Produces:
  - `CITE_REMINDER: str` and `CITE_RETRY: str` in `grounding.py`;
  - `build_messages` (signature unchanged) appends `CITE_REMINDER` to the last user turn only when the history it keeps is non-empty.

- [ ] **Step 1: Failing grounding tests.** Append to `apps/api/tests/test_grounding.py`. Also import `CITE_REMINDER` from `portfolio_api.services.grounding` alongside the existing imports.

```python
def test_follow_up_reminds_the_model_to_cite() -> None:
    history = [Exchange("What has he done with ML?", "Built a lakehouse [1].")]
    last = build_messages("What projects has he built?", HITS, history)[-1].content
    assert last.endswith(f"Question: What projects has he built?\n\n{CITE_REMINDER}")


def test_first_question_has_no_reminder() -> None:
    last = build_messages("What projects has he built?", HITS, [])[-1].content
    assert CITE_REMINDER not in last
```

The existing `test_history_keeps_last_pairs_without_citations` and `test_build_messages_numbers_and_escapes_sources` must keep passing. The first slices `turns[1:-1]`, so the last turn's extra line doesn't affect it. Check the second, and adjust only if it asserts the exact final content with history.

Run: `uv run pytest tests/test_grounding.py -q`. Expected: the 2 new tests FAIL (`CITE_REMINDER` doesn't exist yet).

- [ ] **Step 2: Implement the reminder.** In `grounding.py`, after `ECHO_WORDS`:

```python
# Earlier answers reach the model with their [n] removed (their numbers point at older sources),
# and after a couple of those gpt-oss copies the style and stops citing; both nudges counter it.
CITE_REMINDER = (
    "Earlier answers in this chat had their source numbers removed. Still cite every fact in"
    " this answer with the number of its source above, like [1]."
)
CITE_RETRY = (
    "Your answer has no source numbers. Give the same answer again, citing every fact with the"
    " number of its source from the sources above in square brackets, like [1]. If the sources"
    f" do not support it, reply with exactly {NO_ANSWER}."
)
```

In `build_messages`, replace the body after `turns = [ChatTurn("system", SYSTEM_PROMPT)]` with:

```python
    kept = history[-HISTORY_PAIRS:]
    for exchange in kept:
        turns.append(ChatTurn("user", exchange.question))
        turns.append(ChatTurn("assistant", strip_citations(exchange.answer)))
    question_text = html.escape(question, quote=False)
    content = f"{_sources_block(hits)}\n\nQuestion: {question_text}"
    if kept:
        content += f"\n\n{CITE_REMINDER}"
    turns.append(ChatTurn("user", content))
    return turns
```

Run: `uv run pytest tests/test_grounding.py -q`. Expected: all PASS. Also confirm `blocked_reason`'s echo check still compares only against `SYSTEM_PROMPT`. The reminder is not in the system prompt, so a reply that repeats it isn't blocked by the echo check. That's fine.

- [ ] **Step 3: Failing chat-service tests.** In `apps/api/tests/test_chat.py`:

(a) Update the existing `test_uncited_reply_becomes_canned_but_keeps_raw_and_usage`. Its `FakeChatModel` repeats its only reply, so the retry now makes a second call and is uncited again:
- the input-token metric grows by `900 + 900`;
- `day.tokens == 1840`;
- the model's `calls` has length 2;
- the stored raw answer is still `"He is great."`.

Keep every other assertion.

(b) Add these tests. Copy the module's existing helpers (`service`, `messages`, `usage`, `IP`, `metric`) and import `CITE_RETRY` from grounding.

```python
async def test_uncited_reply_is_retried_once_and_can_recover(db: Sessions) -> None:
    model = FakeChatModel(
        ModelReply("He built a lakehouse and OFFPay.", 900, 20),
        ModelReply("He built a lakehouse [1].", 950, 25),
    )
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "What projects has he built?")
    assert answer.outcome == ChatOutcome.answered
    assert answer.answer == "He built a lakehouse [1]."
    assert len(model.calls) == 2
    retry = model.calls[1]
    assert [t.role for t in retry[-2:]] == ["assistant", "user"]
    assert retry[-2].content == "He built a lakehouse and OFFPay."
    assert retry[-1].content == CITE_RETRY
    assert retry[:-2] == model.calls[0]  # same system prompt, history and sources
    day = await usage(db)
    assert day is not None and day.tokens == 900 + 20 + 950 + 25


async def test_no_answer_is_not_retried(db: Sessions) -> None:
    model = FakeChatModel(ModelReply("NO_ANSWER", 900, 5))
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    assert (await chat.ask(session_id, IP, "Write me a poem")).outcome == ChatOutcome.uncited
    assert len(model.calls) == 1


async def test_empty_reply_is_not_retried(db: Sessions) -> None:
    model = FakeChatModel(ModelReply("", 900, 700))
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    assert (await chat.ask(session_id, IP, "Anything?")).outcome == ChatOutcome.uncited
    assert len(model.calls) == 1


async def test_blocked_reply_is_not_retried(db: Sessions) -> None:
    model = FakeChatModel(ModelReply(f"He built it with FastAPI [1]. {CANARY}", 900, 20))
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    assert (await chat.ask(session_id, IP, "Rules?")).outcome == ChatOutcome.uncited
    assert len(model.calls) == 1


async def test_a_model_error_on_the_retry_is_a_model_error(db: Sessions) -> None:
    model = FakeChatModel(ModelReply("He built a lakehouse.", 900, 20), ModelBusyError("busy"))
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(ModelBusyError):
        await chat.ask(session_id, IP, "What projects has he built?")
    [msg] = await messages(db)
    assert msg.outcome == ChatOutcome.error
```

Check two things against the real code and adjust only the mechanics, keeping the intent of each assertion:
- `ModelBusyError`'s constructor;
- how existing error tests assert the recorded `error` outcome.

The retry must use the same error path as the first call. Then add one compose-level test with history, showing the follow-up reminder reaches the model: a scripted ask after one answered ask in the same session, where `model.calls[-1][-1].content` ends with `CITE_REMINDER`.

Run: `uv run pytest tests/test_chat.py -q`. You need the test database: see `apps/api` README or Makefile for `API_DATABASE_URL` and how CI runs it, and reuse the same Postgres service or docker container the README describes. Expected: the new tests FAIL.

- [ ] **Step 4: Implement the retry in `compose`.** In `chat.py`, import `CITE_RETRY` and `ChatTurn` (from `portfolio_api.clients.groq`, if it isn't imported already). Replace the section from `reply = await self._model.complete(...)` to the `if sources is None:` return, so that it reads:

```python
        messages = build_messages(question, retrieved.hits, history)
        reply = await self._model.complete(messages)
        text = normalize_citations(reply.text)
        input_tokens, output_tokens = reply.input_tokens, reply.output_tokens
        blocked = blocked_reason(text, self._link_hosts)
        sources = None if blocked else cited_sources(text, retrieved.hits)
        if sources is None and blocked is None and text.strip() and NO_ANSWER not in text:
            # A real answer without usable [n] (typical on follow-ups): ask once to add them.
            retry = await self._model.complete(
                [*messages, ChatTurn("assistant", text), ChatTurn("user", CITE_RETRY)]
            )
            text = normalize_citations(retry.text)
            input_tokens += retry.input_tokens
            output_tokens += retry.output_tokens
            blocked = blocked_reason(text, self._link_hosts)
            sources = None if blocked else cited_sources(text, retrieved.hits)
        if blocked is not None:
            # Same path as an uncited reply: the visitor gets the canned answer, raw is kept.
            log.warning("chat.reply_blocked", reason=blocked)
        if sources is None:
            return Composed(
                CANNED_ANSWER, [CONTACT_SOURCE], ChatOutcome.uncited, text, input_tokens, output_tokens
            )
        return Composed(text, sources, ChatOutcome.answered, text, input_tokens, output_tokens)
```

Import `NO_ANSWER` from grounding if `chat.py` doesn't already. Keep the existing `log.warning("chat.reply_blocked", …)` semantics: it still logs once when the final reply is blocked. Keep the retry's model errors propagating exactly like the first call's. They are raised from `compose`, and `ask` already records them as `error`.

Run: `uv run pytest tests/test_chat.py tests/test_grounding.py -q`. Expected: all PASS. Then run the full API suite once: `uv run pytest -q`, `uv run ruff check . && uv run ruff format --check . && uv run pyright`.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/portfolio_api/services/grounding.py apps/api/src/portfolio_api/services/chat.py apps/api/tests/test_grounding.py apps/api/tests/test_chat.py
git commit -m "fix(api): follow-up chat answers keep their citations (reminder + one retry)

Earlier answers reach the model with their [n] stripped; after two of them gpt-oss stopped
citing and correct follow-up answers were replaced by the canned reply.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regression eval for the three-question sequence

**Files:**
- Modify: `apps/api/src/portfolio_api/cli.py` (`run_eval`: pass an answerable case's optional `history`)
- Modify: `apps/api/src/portfolio_api/evals/chat_eval.yaml` (header comment + one new case at the END of `answerable`, so existing case ids `answerable-01…` keep their numbers)
- Test: the existing CLI/eval test file that covers `run_eval` (find it: `grep -rn "run_eval" apps/api/tests`)

- [ ] **Step 1: Failing test.** In the file that tests `run_eval`, add a test where `cases = {"answerable": [{"question": "What projects has Chris built?", "must_include": ["lakehouse"], "sources": ["/projects/acm"], "history": [{"question": "q1", "answer": "a1 [1]."}, {"question": "q2", "answer": "a2 [1]."}]}], "refuse": []}`. Use that file's existing fakes and service builder. Assert that the model's first call contains the two history pairs, without citations, before the final user turn: `[t.content for t in model.calls[0][1:5]] == ["q1", "a1.", "q2", "a2."]`.
  Run it: FAIL (history ignored today).

- [ ] **Step 2: Implement.** In `run_eval`, build the work list so each answerable item carries its history, then pass it to `_run_case(..., history=...)`:

```python
    work: list[tuple[str, str, str, Callable[[Composed], str | None], list[Exchange]]] = [
        (
            f"{ANSWERABLE}-{i:02d}",
            ANSWERABLE,
            c["question"],
            partial(judge_answerable, c),
            [Exchange(h["question"], h["answer"]) for h in c.get("history", [])],
        )
        for i, c in enumerate(cases["answerable"], start=1)
    ] + [
        (f"{REFUSE}-{i:02d}", REFUSE, q, judge_refusal, [])
        for i, q in enumerate(cases["refuse"], start=1)
    ]
```

…and in the loop `for case_id, category, question, judge, history in work:` pass `history=history` to `_run_case`. (`Exchange` is already imported in cli.py for redteam; reuse it.)

- [ ] **Step 3: Add the case.** Update the header comment of `chat_eval.yaml` to document `history` (an optional list of `{question, answer}` asked earlier in the same chat; answers as the chat stored them, with their `[n]`). Append at the end of `answerable`:

```yaml
  # 2026-10-15 regression: asked third in a chat this came back uncited (history had its [n]
  # stripped and the model stopped citing). History answers are verbatim from production.
  - question: What projects has Chris built?
    history:
      - question: What has Chris done with AI and Machine Learning
        answer: He integrated a local LLM (TinyLlama 1.1B) with BM25-based retrieval-augmented generation for a disaster-knowledge base [2]. He built a Cyber Threat Lakehouse pipeline using Python, PySpark, Databricks and scikit-learn, tuning models to raise intrusion-alert precision from 77 % to 84 % [2]. His technical skill set includes deep-learning frameworks such as PyTorch and TensorFlow [3].
      - question: What's Chris's technical background
        answer: Christopher Guzman is studying Computer Science and Cyber Operations at Augusta University, graduating in May 2027, with a minor in Mathematics [1]. He has experience with many programming languages (Python, Java, C#, C/C++, JavaScript/TypeScript) and technologies including PyTorch, TensorFlow, scikit-learn, Apache Spark, Databricks, React, FastAPI, Docker and Kubernetes [1].
    must_include: ["Lakehouse", "OFFPay"]
    sources: ["/projects/cyber-threat-lakehouse", "/projects/offres-offpay", "/resume", "/"]
```

Check the eval loader or any yaml-shape test, and the golden or `chat-eval` tests that count cases or validate keys, then update them if they assert the case count or the allowed keys (`grep -rn "answerable" apps/api/tests`).

Run: `uv run pytest -q` (full API suite), `uv run ruff check . && uv run ruff format --check . && uv run pyright`.

- [ ] **Step 4: Commit.**

```bash
git add apps/api/src/portfolio_api/cli.py apps/api/src/portfolio_api/evals/chat_eval.yaml apps/api/tests
git commit -m "test(api): chat eval replays the three-question sequence that lost its citations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After merge (controller)

- **Deploy:** the release workflow deploys the merge.
- **Run the eval:** `gh workflow run chat-eval.yml -f kind=answer`. Confirm the new last answerable case PASSes and the rest hold.
- **Ask Chris** to retry his three suggestions in one chat on the live site.
