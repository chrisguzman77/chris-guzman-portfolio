---
slug: cyber-threat-lakehouse
title: Cyber Threat Lakehouse
summary: Incremental Spark and Delta Lake pipeline over 2.5M network flows, with a validation-tuned intrusion detector, an attack-family model, a data-quality gate, a Databricks dashboard, and a cross-dataset test of whether it generalizes.
repo_url: https://github.com/chrisguzman77/cyber-lakehouse
live_url: null
award: null
date: 2026-10-14
tech: [python, apache spark, delta lake, databricks, sql, scikit-learn, mlflow, docker]
cover: IMAGE:lakehouse-dashboard.jpg
---

## What it is

A lakehouse pipeline that turns the full UNSW-NB15 dataset (2,540,047 network flow records) into a model that flags malicious traffic and names the attack type. UNSW-NB15 mixes real benign traffic with nine synthetic attack families, such as exploits, DoS, reconnaissance and worms. I built it to practice the data engineering and ML side of security work, and to show both halves: multi-million-row pipelines that are safe to rerun, and honest evaluation on imbalanced data. The surprise was the dedupe: the raw data is about 13% attacks, but attack flows are heavily duplicated, so after deduplication only about 4% are.

## How it works

![The Cyber Threat Lakehouse pipeline: chunk files land over time, stream into Bronze, are deduplicated into Silver with an insert-only MERGE, flow into Gold and Predictions through Change Data Feed, then a quality gate writes results that a Databricks dashboard reads; training runs on demand and supplies the models](DIAGRAM:cyber-threat-lakehouse.png)

The pipeline is incremental. A replay script releases the raw data as 250,000-row chunk files over time, and each layer is a checkpointed Spark stream that processes only what's new, then stops. It runs locally in Docker, or on Databricks as two Workflows. On serverless compute, the pipeline takes 2 to 3 minutes per run, and training, which retrains and rescores every flow, takes about 4.5 minutes.

**Bronze** appends the raw rows to a Delta table with an explicit schema. **Silver** normalizes labels, fixes CSV quirks, and adds each flow only if the SHA-256 hash of its identity isn't there yet, using an insert-only MERGE. That takes 2,540,047 rows down to 2,013,620 unique flows. **Gold** reads Silver's Change Data Feed and builds a 54-feature table: 38 raw flow fields, 13 derived features and 3 frequency-encoded categorical fields. **Predictions** scores only new Gold rows with `mapInPandas`, so every flow is scored exactly once.

**Training** runs on demand. It splits a stratified sample of about 500,000 flows 60/20/20 into train, validation and test, and trains a random forest, logistic regression and histogram gradient boosting for two tasks: attack or benign, and which of the 9 attack families. On Databricks, every run is logged to MLflow and the best models are registered in Unity Catalog.

After every run, **11 data-quality checks** append their results to `gold.quality_results`, and any failure fails the run. A three-page **Databricks AI/BI dashboard**, kept as code in the repo, shows alerts, model quality and pipeline health.

## Decisions worth noting

- **Insert-only MERGE, first seen wins.** A re-delivered file writes nothing below Bronze, and a script verifies it: a rerun with nothing new changes nothing, and every flow is scored once.
- **Threshold tuned on validation, not left at 0.5.** Each model alerts at the most precise threshold that still catches 95% of validation attacks, and the test split is used once, to report.
- **Frozen encodings.** The frequency encodings are computed once at training and reused at scoring, so micro-batches can't encode the same value differently.
- **Model quality from the test split only.** The dashboard never compares predictions with labels across all flows, which would include the training sample and overstate quality.
- **One shared code base.** The local jobs and the Databricks notebooks import the same modules, so the two deployments can't drift apart. The reasoning behind every decision is in 21 decision records in the repo.

## Results

From the local run (about 500,000 flows, 60/20/20 split):

| Model | Threshold | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| **Histogram gradient boosting** (kept) | 0.912 | **0.839** | 0.945 | **0.889** | 0.9988 |
| Random forest | 0.766 | 0.817 | 0.955 | 0.880 | 0.9985 |
| Logistic regression | 0.948 | 0.769 | 0.950 | 0.850 | 0.9964 |

Compared with the August version, a random forest alerting at the default 0.5, false alarms fell from about 1 in 4 alerts to about 1 in 6, at the cost of missing about 5.5% of attacks instead of about 1%. The threshold alone takes the kept model from an F1 of 0.855 at 0.5 to 0.889. The attack-family model (a random forest, in the local run) reaches a test macro-F1 of 0.585. It is strong on generic and reconnaissance attacks and weak on the rarest families, with only 7 worm flows in the test set.

The cross-dataset test is the honest limit. Retrained on the 19 features both datasets share and scored on CIC-IDS2017, traffic from another lab, the detector's F1 falls from 0.861 to **0.028** and its ROC-AUC to **0.470**, slightly worse than random. A model trained on CIC with the same features reaches 0.977, so the features aren't the problem: what the UNSW model learned doesn't carry over to another network. The 0.889 is a within-dataset number. The full story is in [What I changed in my Cyber Threat Lakehouse, and why](/blog/cyber-lakehouse-updates).

## My part

This was a solo project. I built the pipeline, the incremental ingestion, the feature engineering, the model benchmarks and evaluation protocol, the cross-dataset test, the quality gate, the dashboard, and both the Docker and Databricks deployments, with CI running lint and tests on every push.
