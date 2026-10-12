---
slug: cyber-threat-lakehouse
title: Cyber Threat Lakehouse
summary: Spark and Delta Lake pipeline over 2.5M network flow records with Bronze/Silver/Gold layers, 54 engineered features, and a three-model detection benchmark, run locally and on Databricks.
repo_url: https://github.com/chrisguzman77/cyber-lakehouse
live_url: null
award: null
date: 2026-02-01  # [CHRIS: repo was created 2026-01-31; keep Feb 2026 or use 2026-01-01?]
tech: [python, apache spark, delta lake, databricks, sql]
---

## What it is

A lakehouse pipeline that turns the full UNSW-NB15 dataset (2,540,047 network flow records) into a model that flags malicious traffic. UNSW-NB15 mixes real benign traffic with nine synthetic attack families, such as exploits, DoS, reconnaissance and worms. I wanted to show both halves: multi-million-row data engineering, and honest evaluation on imbalanced data. [CHRIS: why you built it (class, self-study, interview prep?) and one thing that surprised you]

## How it works

![Pipeline of the Cyber Threat Lakehouse: raw UNSW-NB15 CSVs flow through Bronze, Silver (dedupe to 2,013,620 unique flows) and Gold (54 features), then a ~500k sample trains three models, the best by F1 scores all flows, and results feed Spark SQL analytics and MLflow with Unity Catalog](DIAGRAM:cyber-threat-lakehouse.png)

The pipeline is five Spark jobs. They run locally in a Docker Spark container, or as a five-task Databricks Workflow.

**Bronze** loads the four raw CSVs into a Delta table with an explicit schema and ingest metadata. **Silver** normalizes labels and attack categories, fixes CSV quirks, and removes duplicate flows by hashing each flow's identity with SHA-256. That takes 2,540,047 rows down to 2,013,620 unique flows. **Gold** builds a 54-feature ML table: 38 raw flow fields, 13 derived features, and 3 frequency-encoded categorical fields (protocol, service, state).

**Train** draws a stratified sample of about 500k flows (80/20 split, fixed seed) and trains a random forest, logistic regression and a histogram gradient-boosting model. It keeps the best one by F1. On Databricks, each run is logged to MLflow and the best model is registered in Unity Catalog. **Score** runs that model over every flow and writes predictions to a Delta table.

Spark SQL then answers the analytics questions (attacks by category, most suspicious flows) and runs data-quality gates on each layer: null labels, negative durations, duplicate hashes, out-of-range probabilities. Every gate must return zero.

## Decisions worth noting

- **One shared feature module.** The local jobs and the Databricks notebooks import the same feature code, so the two deployments can't drift apart.
- **Explicit schema and hash-based dedupe.** No schema inference, and deduplication on a flow-identity hash. Dedupe removed about 20.7% of the raw rows, so every later count and metric is over unique flows.
- **Batch scoring with `mapInPandas`.** The model loads once per worker and scores in chunks, so 2M+ rows never sit in a single pandas frame.
- **F1 and ROC-AUC over accuracy.** Only about 4% of the deduplicated flows are attacks, so a model that calls everything benign would still score around 96% accuracy.

## Results

From the local run on the ~500k sample (test set of 99,960 flows):

| Model | Precision | Recall | F1 | ROC-AUC | Train time |
|---|---|---|---|---|---|
| Random forest (kept) | 0.768 | 0.991 | 0.865 | 0.9986 | 12.8 s |
| Logistic regression | 0.735 | 0.999 | 0.847 | 0.9968 | 19.8 s |
| Hist gradient boosting | 0.754 | 0.997 | 0.859 | 0.9988 | 3.9 s |

All three models catch almost every attack, and the random forest has the best F1. The trade-off is precision: nearly one in four flagged flows is benign. The full Databricks Workflow over the 2.54M-row dataset finishes in under 5 minutes on serverless compute.

## My part

This was a solo project. I built the pipeline, the feature engineering, the model benchmark, the data-quality gates, and both the Docker and Databricks deployments, with CI running lint and tests on every push.
