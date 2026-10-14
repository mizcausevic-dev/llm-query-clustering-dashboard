# Declared metadata is not the truth of an evaluation

**Subtitle:** How I built a local-first viewer that refuses to invent a winning model.

**Status:** Draft for Medium. First-hand implementation note from shipping `llm-query-clustering-dashboard`. Not a benchmark. Not a vendor ranking.

**Effective date:** 14 October 2026.

---

Most clustering-eval spreadsheets fail the same way. Two rows share a model name and an ARI, so the sheet treats them as repeats of one experiment. They are not. One row may be a different dataset version, a different evaluation set, a different scoring config, or a synthetic fixture sitting next to a real run.

I built a browser-only viewer that imports long-form eval records and only aggregates what the file actually declared. It does not call model APIs. It does not recompute ARI from example assignments. It does not name a winner.

Repo: https://github.com/mizcausevic-dev/llm-query-clustering-dashboard

## What the product is

A local-first dashboard for inspecting imported LLM query-clustering evaluations. You bring JSON or CSV. The app validates, previews, and compares compatible runs on quality, latency, and cost.

It is for people who already have evaluation evidence and need to read it without the tool inventing a study design.

## The rule that drives the UI

Comparable means the *declared* fields match. It does not mean the evaluation procedure was independently verified.

Required matches for a quality cohort:

- synthetic vs non-synthetic
- dataset and dataset version
- evaluation-set ID
- shared evaluation-config ID
- metric ID, definition, scale, and metric-config ID
- metric sample size

Missing required fields stay unverified. Different declared values stay incompatible. Both remain visible in the raw table with reasons. There is no "force compatible" button.

Same sample size is not proof of the same items. Imported IDs are user assertions.

## What I will not do in a comparison

These are implemented constraints, not slogans:

- Null is not zero. Zero is preserved when it is a real measurement.
- Metric rows are not runs. Cost is counted once per distinct `run_id`.
- Unknown `model_version` / `model_config_id` is not pooled. Those runs stay individual until identity is confirmed.
- Synthetic and real never share a cohort. Loading both requires an explicit confirm.
- Mean latency is never treated as p50 or p95.
- Currencies are not converted.
- Reported and estimated costs can sit side by side. They are not pooled.
- Per-work-item cost is derived only when work count and scope are supplied, and the original run-total stays on the record.
- ARI and AMI may be negative. Out-of-range scores are flagged, not clipped.
- Pareto, when enabled, is a non-dominated trade-off in one quality cohort and one poolable cost cohort. It is not a winner list.

Hand-checked golden case used in tests: runs 0.62 and 0.58 give mean 0.60, median 0.60, sample SD ≈ 0.02828. Adding an incompatible dataset version does not move that summary.

## How the data is shaped

Canonical workspace, schemaVersion 1:

- `runs`: one record per `run_id` + metric
- `examples`: optional, must reference a real run
- `metricDefinitions`: ARI, AMI, NMI, Silhouette shipped with direction, scale, and tolerance 1e-9

Repeated metric rows for one run must agree on identity, context, timestamp, seed, and performance. Example costs must declare currency. Cluster IDs are labels, not a right/wrong bit.

## Privacy posture (what I actually checked)

Imported files stay in the tab. Canonical export warns that it includes query text. CSV exports omit query text and prefix `=+-@` so spreadsheets do not execute formulas.

Checks that ran:

- `gitleaks detect --log-opts="--all"`: no leaks
- `npm audit --audit-level=moderate`: 0 vulnerabilities
- `npm test`: 35 unit tests
- `npm run build`: TypeScript + Vite production build
- no `fetch`, `eval`, `WebSocket`, or `dangerouslySetInnerHTML` in application TypeScript

Limits that are enforced: 10 MiB per file, 20,000 metric rows, 50,000 example rows. Cumulative 50 MiB is now counted from file bytes, not from record counts. Parsing tries a worker and falls back to the same local validators.

This is a viewer you run yourself. It is not a hosted evaluation service.

## Limits of the claim

I am not publishing a ranking of clustering models. The synthetic demo uses fictional candidates so nobody can scrape it as a vendor scoreboard.

UI tests do not prove statistical correctness. There is no significance test and no confidence interval in this MVP. Variation is labeled as observed across-run variation.

No license file is attached yet. Until one is added, the default is all rights reserved.

Independent AppSec and supply-chain reviews on 14 October 2026 found no STOP conditions for making the source public. They also found that an earlier note about a local gitleaks hook was overstated: history was scanned, but the hook is not installed. I corrected the report rather than leaving a fake control in the record.

## If you use this

1. Import only files you are allowed to hold in a browser.
2. Read the unverified and incompatible reasons before you trust a chart.
3. Export the canonical JSON if you need a round trip that keeps examples and provenance.
4. Do not paste a Pareto frontier into a slide titled "the winner."

The useful output is not a trophy. It is a cohort you can defend.
