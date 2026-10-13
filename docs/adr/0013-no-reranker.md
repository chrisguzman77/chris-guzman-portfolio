# 0013 — No reranker: keep RRF hybrid retrieval

Status: accepted · 2026-10-13

## Context
Chat retrieval fuses vector and keyword hits with reciprocal rank fusion (RRF), then keeps the top 5 chunks (at most 2 per document). A cross-encoder reranker over the top RRF candidates can sometimes reorder them better, at the cost of latency, memory and a larger image.

The chat-quality spec (`docs/superpowers/specs/2026-10-12-chat-quality-design.md`, "PR 4: Reranker") set a ship gate for a reranker, measured on the live index:
- MRR up by at least 0.05;
- hit@5 not lower;
- added p95 latency of at most 300 ms.

## Decision
Keep RRF hybrid retrieval with no reranker. No reranker module, `API_RERANKER` setting, model download or `chat-eval --reranker` flag ships.

The expanded 40-question golden set and the hit@5 / MRR tracking ship regardless. The live baseline before this change was an MRR of 0.783 over the 16 original questions (Actions run 38342534300).

## Measurement
Measured locally during planning on 2026-10-13 against the seed index (the 40-question golden set, with the blog post included), on an Apple M1 (native) and in a Linux arm64 container. The reranker was fastembed's `TextCrossEncoder` with `Xenova/ms-marco-MiniLM-L-6-v2`, reranking the top 20 RRF candidates.

| | Reranker off | minilm |
|---|---|---|
| Seed golden hit@5 (40 questions, post included) | 1.000 (40/40) | 0.975 (39/40) |
| Seed golden MRR | 0.867 | 0.908 |
| Rerank time per question over the seed golden set, Apple M1 (native) | — | p50 ≈ 0.9–1.2 s, p95 ≈ 1.6–2.2 s |
| Rerank of 20 × 250-word chunks, Linux arm64 container on the M1 | — | p50 ≈ 4.0 s at batch 1, 4.5 s at batch 4 |
| Peak RSS of one process with the embedder, Linux container | ≈ 190 MB | batch 1: ≈ 334 MB · batch 4: ≈ 452 MB · one batch of 20 (the fastembed default): ≈ 1,117 MB |

Against the three gates:
- **MRR:** +0.041 (0.867 to 0.908), under the +0.05 needed.
- **hit@5:** 40/40 fell to 39/40, which is a drop. The one miss is "What machine learning experience does he have?": the cross-encoder ranks the College of Allied Health Professions internship and post chunks above SteelGate and the lakehouse.
- **Latency:** the rerank alone has a p95 of 1.6–2.2 s on the M1, 5–7× the 300 ms gate.
- **Memory (not a spec gate):** about 334 MB at batch 1 against about 1.1 GB at the default batch of 20, which alone exceeds the api container's 768m limit.

## Alternatives considered
- **A full trial on the VM:** skipped. The VM's CPU is unlikely to be faster than the M1, and every gate had already failed by a wide margin, so a live run was very unlikely to change the outcome.
- **Rerank fewer candidates:** cuts latency roughly in proportion, but even at 5 candidates the estimated p95 stays above the gate, and fewer candidates leave less for the reranker to improve.
- **A larger reranker such as `bge-reranker-base`:** slower and bigger than MiniLM, so it makes the latency and memory failures worse.
- **LLM rerank through Groq:** spends free-tier quota on every question and adds a network round trip, so latency and the daily token budget both get worse.

## Consequences
- Retrieval stays as it is: no new model in the image, no extra memory, no added latency.
- **Revisit** if the content grows enough that the right page drops out of the top 5, that is, if hit@5 falls. The weekly eval's hit@5 and MRR on the "Chat quality" dashboard are the trigger.
- hit@5 and MRR are tracked weekly over the 40 questions. The recorded values step up or down once, when the set grew from 16 to 40; there is no data migration.
- The decision rests on local measurements, not a live-index run. If a revisit happens, measure on the live index first.
