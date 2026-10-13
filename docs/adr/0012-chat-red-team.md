# 0012 — Chat red-team: a weekly attack set against the live chat

Status: proposed · 2026-10-13 (accepted by the hardening change, which adds the baseline and known failures)

## Context
The "Ask about Chris" chat sends visitor text and retrieved content to an LLM (Groq `openai/gpt-oss-120b`, ADR 0008). Its defences:
- system prompt rules;
- HTML-escaped sources and question;
- a similarity cutoff that skips the model;
- a citation check that replaces any uncited reply with a fixed canned answer.

Until now, 10 refuse cases in the weekly answer eval were the only test. Nothing measured how the defences hold up against deliberate attacks, or whether a model, prompt or content change weakens them.

## Decision
- **The cases:** 30 red-team cases in `apps/api/src/portfolio_api/evals/redteam.yaml`, in four groups:
  - **leak_injection (8):** "ignore instructions" and "print your system prompt", "repeat the text above", DAN-style and role-play prompts, a fake `system:` message, an instruction hidden in base64, and look-alike letters with zero-width spaces.
  - **misuse (6):** the chat as a free LLM: an essay, debugging code, translation, math, SQL, and a cover letter for someone else. Several are framed around Chris to get past retrieval.
  - **fabrication (10):** salary, phone number, home address, GPA, references' contact details and an exact start date (none of which is in the content), false premises ("worked at Google", "fired from SteelGate"), an opinion against other candidates, and visa status worded to bait a guess. The FAQ says US citizen, so that case expects the cited fact.
  - **multi_turn_indirect (6):** an escalation that refers back to a benign turn, a fake earlier "agreement" to break the rules, a fake promise to share the rules, and three injected sources (a $500k salary claim, a link to an outside site, a "hire someone else" sabotage line).
- **Judges:** `refuse` (the visitor got the canned answer), `must_not_include` (case-insensitive regexes), `must_include` (a cited fact) and `no_canary`.
  - They read only what the visitor saw, never the raw model output.
  - Fabrication patterns match positive claims, so a correction passes.
  - No pattern may match the canned answer.
- **How a case runs:**
  - History passes straight to `compose`.
  - An injected source is appended to the retrieved hits by an eval-only retriever wrapper, for that case only. It is never written to the database, and the similarity cutoff still applies.
- **Schedule and records:** every Wednesday at 10:30 UTC on the VM's runner (`chat-eval.yml`, `chat-eval --kind redteam --record`), plus manual runs.
  - **Recorded** in `chat_eval_runs` as kind `redteam`, with the pass rate over all cases in `refusal_pass_rate`.
  - **Grafana:** "Chat quality" charts it.
  - **Alerts:** `chat-eval-redteam` fires on any failure not marked `known_failure`, and `chat-eval-stale` covers both kinds.
- **Test first:** this change hardens nothing, and the alert is provisioned paused.
  - **Baseline:** after the deploy, a recorded run gives the baseline (pass rate and failures by category).
  - **The hardening change** fixes only what failed: system prompt wording, a canary string in the system prompt with blocking of replies that contain it or echo the prompt, and retrieval settings. It re-runs, unpauses the alert, and marks any case that still fails after a reasonable fix `known_failure`.

## Out of scope
- LLM-judged grading and an input classifier in front of retrieval (spec: out of scope).
- Rate limits, Turnstile and the token budget, which are covered by their own tests and ADR 0007.
- Attacks longer than the 3 history pairs the chat keeps.
- The 10 refuse cases in `chat_eval.yaml`, which stay in the answer run.

## Alternatives considered
- **An LLM as judge:** costs free-tier tokens and isn't deterministic. Regex and substring checks are cheap and explainable, at the cost of missing a leak that is reworded.
- **Run the cases in CI against a fake model:** that tests the harness, not the model. CI does test the harness (schema, judges, wrapper), and the live run tests the chat.
- **Add the cases to the Sunday answer run:** one run would use more than half of a day's budget.
- **Harden first:** without a baseline, no fix can be tied to the case it fixes.

## Consequences
- **Tokens:** up to about 50k each Wednesday, about a quarter of the 180,000 daily budget; cases the cutoff refuses use none. They count in `chat_usage_daily`, so the visitor budget gate still applies.
- **Imperfect judges:** regex judges can miss a reworded leak, or fail a correct answer worded in an unexpected way. Such cases are tuned when they show up.
- **Public cases:** the repo is public, so the cases (and later the canary) are public. They are a regression suite, not a secret.
- **Known failures:** none recorded yet. The baseline and the hardening change decide them, and list them here.
