---
title: What I changed in my Cyber Threat Lakehouse, and why
slug: cyber-lakehouse-updates
excerpt: I rebuilt my network intrusion pipeline to be incremental, made its evaluation honest, added a quality gate and a dashboard, then tested it on another lab's traffic, where it fell apart.
tags: [data-engineering, machine-learning, databricks, delta-lake, security]
published_at: "2026-10-24"
---

[Cyber Threat Lakehouse](/projects/cyber-threat-lakehouse) is my data engineering and machine learning project. It takes the full UNSW-NB15 dataset, 2,540,047 network flow records, through Bronze, Silver and Gold layers in Spark and Delta Lake, and trains a model that flags malicious traffic. It runs locally in Docker and on Databricks.

The version I finished in August worked, but I kept finding things I couldn't defend. Every run rebuilt every table from scratch. The alert threshold was a default nobody chose, and I picked the best model by its test score, which makes the test score optimistic. The data-quality checks were a SQL file I ran by hand. And nothing said whether the model would work on any network other than the one it learned from.

Between October 12 and 14, I fixed all of that. Here is each change and the reason behind it. The reasons are also written up as decision records in the repo, 12 of them for these changes.

![The project's Databricks dashboard: 2.01 million flows analyzed, 94,913 alerts raised, and alerts per hour by attack family for both capture sessions](/assets/5d62ae47-da8f-4d8d-8491-e4abbfe2a38c)

The dashboard's numbers come from the Databricks run, which trains on a smaller sample than the local run; more on that in section 5.

## 1. Process only what's new

Rebuilding every layer on each run reprocesses 2.5 million rows to add a few, and it hides problems like late or re-delivered files. Real network logs arrive over time, so the pipeline should too.

A replay script now releases the raw data as 250,000-row chunk files into a landing folder, as if logs were arriving. Each layer is a checkpointed Spark stream with an `availableNow` trigger: it processes everything new since its last run, then stops. That trigger is also the only one Databricks serverless supports, so the same code runs in both places. Locally in Docker, a rerun with no new files takes 9 to 28 seconds per job and changes nothing.

![The Cyber Threat Lakehouse pipeline: chunk files land over time, stream into Bronze, are deduplicated into Silver with an insert-only MERGE, flow into Gold and Predictions through Change Data Feed, then a quality gate writes results that a Databricks dashboard reads; training runs on demand and supplies the models](/assets/700f0127-2cb8-40c1-a89a-592e4d27ffac)

The interesting part is what happens when the same data shows up twice. Bronze keeps everything it receives. From Silver down, every write is an insert-only Delta MERGE on a SHA-256 hash of each flow's identity: a flow is added only if its hash isn't there yet. From `src/utils/incremental.py`:

```python
def first_per_key(
    df: DataFrame,
    key: str = "flow_hash",
    order_cols: tuple[str, ...] = ("ingest_ts", "source_file"),
) -> DataFrame:
    """Keep one row per key: the earliest by order_cols. Needed before an
    insert-only MERGE, which would otherwise insert in-batch duplicates."""
    w = Window.partitionBy(key).orderBy(*[F.col(c).asc() for c in order_cols])
    return df.withColumn("_rn", F.row_number().over(w)).filter(F.col("_rn") == 1).drop("_rn")


def insert_new_keys(
    spark: SparkSession,
    batch_df: DataFrame,
    key: str = "flow_hash",
    *,
    path: str | None = None,
    name: str | None = None,
) -> None:
    """MERGE batch_df into the target, inserting only keys it doesn't hold yet.
    batch_df must already be unique on key (see first_per_key)."""
    target = ensure_delta_table(spark, batch_df.schema, path=path, name=name)
    (
        target.alias("t")
        .merge(batch_df.alias("s"), f"t.{key} = s.{key}")
        .whenNotMatchedInsertAll()
        .execute()
    )
```

I chose "first seen wins" over "latest wins" on purpose. Updating a row whenever a newer copy arrives would ripple rewrites through Gold and Predictions for no new information. With insert-only, a re-delivered file causes zero writes below Bronze. Gold and Predictions then read Silver's and Gold's Change Data Feed and keep only inserted rows, so each layer processes exactly what's new upstream.

I don't take idempotency on faith. `scripts/verify_incremental.sh` runs the pipeline in Docker and fails on any mismatch: a rerun with nothing new must change nothing, a chunk re-delivered under a new name must add nothing past Bronze, and after training every flow must be scored exactly once. On Databricks the counts reconcile too: Bronze has 2,540,047 rows, Silver, Gold and Predictions each have 2,013,620, and no flow hash appears twice.

Two problems only showed up once the pipeline was incremental:

- **Encodings that drifted.** Three categorical fields are encoded by how often each value appears. Computed per micro-batch, the same value would get a different number in every batch, and the model would see inputs it was never trained on. The encodings are now computed once at training, saved, and reused at scoring.
- **Running out of memory.** My laptop has 8 GB of RAM, and the Docker VM gets about 3.8 GB of it. The first full incremental run in Docker read all of Bronze into Silver in one batch (410 seconds) and all of Silver into Gold in another (1,128 seconds), and a full rescore was killed for running out of memory. Capping each batch at 128 MB brought Silver to 153 seconds and Gold to 135, and the rescore ran in 136 seconds. When the attack-family model (section 3) doubled what each scoring worker holds, it ran out of memory again, so scoring now uses 2 partitions: a full rescore of 2,013,620 flows with both models takes 265 seconds, with a peak of 2.69 GB.

## 2. Choose on validation, report on test

The August version used a random forest that alerted at the default probability of 0.5. That caught 99.2% of attacks, but its precision was 0.766, so about 1 in 4 alerts was a false alarm. And because I picked the model by its test score, the test score was no longer an honest estimate.

Now a stratified sample of about 500,000 flows is split 60/20/20 into train, validation and test sets, stratified by attack family. Every choice is made on validation. A security team would rather miss few attacks and then cut false alarms, so each model's alert threshold is the most precise one that still catches at least 95% of validation attacks. From `src/utils/modeling.py`:

```python
# SOC operating point: catch at least this share of attacks, then cut false alarms.
TARGET_RECALL = 0.95


def choose_threshold(y_true, proba, target_recall: float = TARGET_RECALL) -> dict:
    """Highest-precision threshold whose recall is >= target_recall (ties go to
    higher recall). A flow is an attack when proba >= threshold."""
    precision, recall, thresholds = precision_recall_curve(y_true, proba)
    # The curve's last point (recall 0) has no threshold.
    precision, recall = precision[:-1], recall[:-1]
    candidates = np.flatnonzero(recall >= target_recall)
    best = max(candidates, key=lambda i: (precision[i], recall[i]))
    return {
        "threshold": float(thresholds[best]),
        "precision": float(precision[best]),
        "recall": float(recall[best]),
    }
```

The kept model is the one with the best validation precision at that floor, and the test set is used once, to report:

| Model | Threshold | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| **Histogram gradient boosting** (kept) | 0.912 | **0.839** | 0.945 | **0.889** | 0.9988 |
| Random forest | 0.766 | 0.817 | 0.955 | 0.880 | 0.9985 |
| Logistic regression | 0.948 | 0.769 | 0.950 | 0.850 | 0.9964 |

Compared with that August random forest, false alarms drop from about 1 in 4 alerts to about 1 in 6, and F1 rises from 0.865 to 0.889. That comparison also changes the model and the split, so here is the threshold alone: the kept model scores an F1 of 0.855 at 0.5 and 0.889 at its tuned threshold. The cost is real: the model now misses about 5.5% of attacks instead of about 1%, and it trains on 60% of the sample instead of 80%.

## 3. Name the attack, not just flag it

"Something's wrong" is less useful to an analyst than "this looks like reconnaissance." A second model now labels each flow as normal or one of the 9 attack families. I kept it separate from the detector so the detector keeps its tuned threshold.

In the local run a random forest won. Its test accuracy is 0.980, but that number is mostly the normal traffic. Macro-F1, which weights every family equally, is 0.585 (on Databricks a gradient-boosting model won, at 0.648), and the per-family results show where it struggles. It mislabels 1,245 benign flows as fuzzers, it labels about half of the DoS flows as exploits (a known overlap in this dataset), and with only 7 worm flows in the test set it catches none of them.

## 4. A quality gate that can stop a run

The checks used to be a SQL file I ran by hand. Nothing recorded the results, nothing stopped a bad run, and the file only knew local paths. Now 11 checks are defined as data in `src/utils/quality.py`, each a query that counts violations:

```python
CHECKS = [
    Check(
        "null_label",
        "silver",
        "label_int is null",
        "SELECT COUNT(*) FROM {silver} WHERE label_int IS NULL",
        ("silver",),
    ),
    # ... 10 more: duplicate flow hashes, an attack share outside 2-25%,
    # probabilities outside [0, 1], unscored flows, flows scored twice
]
```

A job runs them after every pipeline run, appends one row per check to `gold.quality_results` so the history is kept, and then fails the run if any check failed:

```python
# Quality gate: results are saved first, then a failure fails the job.
if failed:
    raise SystemExit(f"[FAIL] {len(failed)} data-quality check(s) failed: {failed}")
```

I looked at Great Expectations and at Databricks' declarative pipeline expectations. The first is more dependency and configuration than 11 checks need. The second would mean rewriting the pipeline in Databricks' declarative style, and it doesn't run locally.

## 5. A dashboard, kept as code

The Databricks AI/BI dashboard has three pages: threat overview, model quality and pipeline health. It's 16 SQL datasets and 27 widgets in a JSON file in the repo, so it can be reviewed and rebuilt instead of living only in a UI.

One rule shaped it: model quality comes only from the saved test-split metrics. Comparing predictions with labels across all 2 million flows would include the flows the model trained on, and the numbers would look better than they are.

![The dashboard's model quality page: the tuned alert threshold, test precision and recall, and every candidate model's validation and test metrics](/assets/a95eca11-5741-476a-b20f-f5ef2e70374c)

This screenshot is from the Databricks run, which trains on a 300,000-flow sample, so its numbers differ slightly from the local run above: threshold 0.880, precision 0.824, recall 0.953, F1 0.884. On that run the 95% recall floor held on the test set (0.953). In the local run, test recall came in at 0.945, just under it.

The pipeline health page also reconciles exactly. Its per-batch duplicate counts sum to 526,427, which is 2,540,047 raw rows minus 2,013,620 unique flows.

## 6. Does it work on someone else's network?

An F1 of 0.889 on UNSW-NB15 says nothing about traffic from another network, so I tested it on CIC-IDS2017, which comes from a different lab, with different attacks and a different flow tool.

Only 7 measurements mean the same thing in both datasets: duration, plus bytes, packets and the mean time between packets in each direction. CIC records them in different units and leaves headers out of its byte counts, so they're converted first. From `src/utils/cross_dataset.py`:

```python
def cic_to_core(df: pd.DataFrame) -> pd.DataFrame:
    """CIC rows -> CORE_COLS + label + is_attack, in UNSW units. Rows with a
    negative duration or any non-finite core value are dropped; negative
    header lengths (a known CICFlowMeter artifact) are clipped to 0."""
    out = pd.DataFrame(
        {
            "dur": df[" Flow Duration"] / 1e6,
            "sbytes": df["Total Length of Fwd Packets"] + df[" Fwd Header Length"].clip(lower=0),
            "dbytes": df[" Total Length of Bwd Packets"] + df[" Bwd Header Length"].clip(lower=0),
            "spkts": df[" Total Fwd Packets"],
            "dpkts": df[" Total Backward Packets"],
            "sintpkt": df[" Fwd IAT Mean"] / 1000,
            "dintpkt": df[" Bwd IAT Mean"] / 1000,
        }
    )
    # ... drop invalid rows, then add the label and is_attack columns
```

The detector is retrained on UNSW using only those 7 measurements plus 12 features derived from them, 19 in total, with the same split and threshold rule. Then it's scored on CIC:

| Model | Tested on | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| UNSW, all 54 features | UNSW | 0.839 | 0.945 | 0.889 | 0.999 |
| UNSW, 19 portable features | UNSW | 0.787 | 0.949 | 0.861 | 0.998 |
| **UNSW, 19 features, on CIC** | CIC | **0.026** | **0.032** | **0.028** | **0.470** |
| CIC-trained, same 19 features | CIC | 0.999 | 0.956 | 0.977 | 1.000 |

Precision isn't comparable across the two datasets, because attacks are about 4% of UNSW's test split and 16.5% of CIC's. ROC-AUC is the fairer comparison.
![F1 and ROC-AUC for each train and test pair: the UNSW detector scores near 0.9 F1 on UNSW, collapses to 0.028 F1 and 0.470 ROC-AUC on CIC-IDS2017, while a model trained on CIC reaches 0.977](/assets/55caf965-5b2f-4ede-aef7-7b4657dbc15c)

**It doesn't transfer.** On CIC it catches 3% of attacks, flags 24% of benign flows, and ranks flows slightly worse than random. No threshold fixes it: none catches 95% of CIC attacks above 19% precision. The features aren't the problem either, since dropping to 19 costs only 0.03 F1 on UNSW, and a model trained on CIC with the same 19 reaches 0.977. What the UNSW model learned is specific to UNSW:

- **CIC's normal traffic looks like UNSW's attacks.** The median benign CIC flow is 2 packets and 140 bytes, mostly short DNS-style exchanges. The median benign UNSW flow is 16 to 18 packets and about 2 KB, while UNSW's "generic" attacks have a median of 2 packets and 114 bytes. Short and small reads as an attack.
- **CIC's attacks look like nothing UNSW calls an attack.** CIC's DoS flows are long, slow connections, with medians of 60 to 100 seconds, and most UNSW attacks finish in under a second.

So the 0.889 is a within-dataset number, and a detector like this has to be retrained or fine-tuned on traffic from the network it protects. This result changes how every other number in this post should be read.

## What I took from it

- **Test idempotency, don't assume it.** The verification script is what lets me say reruns and re-deliveries are safe.
- **Choose on validation, report on test.** Every number in a results table should come from data that never influenced a choice.
- **A good score on one dataset is not a deployment score.** The cross-dataset test is what tells you how far the in-dataset numbers can be trusted.

Everything is in the repo, including all 21 decision records, the architecture and data model docs, and an operations runbook: [github.com/chrisguzman77/cyber-lakehouse](https://github.com/chrisguzman77/cyber-lakehouse). If you have questions, or you're hiring, [get in touch](/contact).
