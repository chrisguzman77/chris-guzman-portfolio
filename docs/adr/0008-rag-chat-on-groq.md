# 0008 — "Ask about Chris" chat: local embeddings, Groq free tier, buffered cited answers

Status: accepted · 2026-10-02

## Context
Phase 5 adds a chat that answers recruiters' questions from published site content. It must cost nothing to run, must not let a provider train on visitors' questions, and must not state things the site does not say.

## Decision
- Retrieval in Postgres: `bge-small-en-v1.5` embeddings computed on CPU inside the API (fastembed, model baked into the image) in pgvector, plus full-text search, merged with reciprocal rank fusion. Every sync is a full, hash-based comparison with Directus, so it is idempotent and needs no change tracking.
- Generation on Groq's free tier (`openai/gpt-oss-120b`), which states it does not train on API data, behind a `ChatModel` protocol so Claude Haiku or another provider is a new class plus config.
- Answers are buffered, not streamed: the API checks that the answer cites at least one provided source before the visitor sees it, and replaces anything else with a fixed "I don't have information on that" reply. A relevance cutoff skips the model entirely for off-topic questions.
- Abuse and cost: Turnstile per session, per-IP limits, 10 questions per session, and a daily token budget under Groq's free cap.

## Consequences
- $0 per month, but free-tier limits (about 8,000 tokens a minute, 200,000 a day) cap traffic to roughly 60 answers a day; beyond that the chat says it is resting until tomorrow.
- The API image grows by about 150 MB and its memory limit doubles to 768 MB.
- Visitors wait 1–2 seconds before the answer types out instead of seeing tokens stream.
- Open-weight models stray more than frontier models; the citation check, the cutoff, the "may be wrong" notice and the hand-run eval (`make chat-eval`) are the guardrails.
- Free tiers can change; switching provider is a code-free config change once a second `ChatModel` exists.
