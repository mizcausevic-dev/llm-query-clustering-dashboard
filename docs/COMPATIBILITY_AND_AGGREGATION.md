# Compatibility and Aggregation Guide

## Compatibility states

- **Comparable**: all required quality fields match by declared values, metric definition/scale matches, and the cohort has 2+ distinct runs. Comparable checks declared metadata, not the truth of the evaluation procedure.
- **Incompatible**: a required field differs (different dataset_version, evaluation_set_id, evaluation_config_id, metric/config, currency, performance context, latency statistic, cost basis). Synthetic vs non-synthetic is always incompatible.
- **Unverified**: a required field is missing (null). The row stays available for raw inspection but is excluded from controlled comparisons.

Quality comparison requires matching: synthetic flag, dataset + dataset_version, evaluation_set_id, evaluation_config_id, metric ID + definition + scale + metric_config_id, metric sample_size. Same sample_size does not establish the same evaluated items.

Candidate identity is model + model_version + model_config_id. Different candidates may be compared side by side. Within-candidate repeated-run aggregation requires matching candidate identity. If version/config is missing, runs display individually unless the user supplies confirmed identity metadata.

Seed and timestamp may vary across repeated runs; their values and coverage are shown in the comparison table tooltips and run drawer.

Performance compatibility additionally requires: matching performance_context_id, matching latency statistic (never mean vs p50/p95) or cost basis, compatible work scope/units, matching currency (no conversion), and matching cost provenance for pooled summaries. Reported and estimated costs view side by side with labels but never pool as equivalent.

Per-work-item derivation only when work_item_count and scope are explicitly provided: derived = run_total / work_item_count, labeled as derived with originals retained.

## Aggregation

Within one compatible metric cohort and candidate:

- Each distinct run_id is one observation.
- Report n_total_runs, n_valid_scores, n_missing_scores.
- Show mean, median, min, max, sample standard deviation (SD = sqrt(sum((x-mean)^2)/(n-1))); SD is n/a with fewer than two scores.
- Label variation as observed across-run variation. Do not imply independent population samples. No significance tests or CIs in this MVP.

Forbidden: summing sample sizes as independent examples; averaging across datasets/definitions; weighting non-additive clustering metrics by sample size; averaging run-level percentiles as a pooled percentile; counting metric rows as runs; summing run cost once per metric (deduplicate run IDs first when multiple metrics are selected).

Distributions: run-level score points (one point per run) vs example-level latency/cost points (only when those measurements exist). Never a density curve from one observation. Keep run/candidate groups separate.

## Worked golden example

Cohort: support-queries@2026.01, eval-core-500, ARI, n=500, synthetic. Candidate fictional-aurora-clusterer v1 cfg-k8-cosine, runs r1=0.62, r2=0.58.

- mean = 0.60, median = 0.60, min = 0.58, max = 0.62, sample SD = sqrt(((0.02)^2+(0.02)^2)/1) = 0.02828...
- Adding an incompatible run (dataset_version 2026.02, score 0.70) does not change this summary.
- Adding another metric row (NMI) for r1 does not duplicate run cost in performance summaries (distinct runs = 2, not 3 rows).
