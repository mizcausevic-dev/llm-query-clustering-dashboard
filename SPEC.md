# SPEC: LLM Query-Clustering Evaluation Viewer (Dashboard)

Version: 0.1.0
Status: MVP implementation spec
Date: 2026-10-13

## 1. Purpose

Help users inspect imported evidence, compare compatible runs, and understand quality, latency, and cost trade-offs for LLM query-clustering evaluations.

This is an evaluation **viewer**, not an evaluation execution service. It does not call model APIs, generate benchmark results, or declare a universal winning model.

## 2. Non-goals

- No backend, accounts, database, telemetry, or external assets.
- No model inference, no metric recomputation from examples.
- No automatic currency conversion, no significance tests, no confidence intervals.
- No universal winner declaration, no pooled incompatible runs.

## 3. Data schema (canonical JSON, schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "runs": [ { "run_id": "...", "model": "...", "...": "..." } ],
  "examples": [ ... ],
  "metricDefinitions": [ ... ]
}
```

### 3.1 Run record (long-form: one record per run_id + metric)

Identity and evaluation context:

- `run_id`: nonempty string
- `model`: nonempty string
- `model_version`: string or null
- `model_config_id`: string or null
- `dataset`: nonempty string
- `dataset_version`: string or null
- `evaluation_set_id`: string or null
- `evaluation_config_id`: string or null
- `run_timestamp`: ISO-8601 with timezone
- `seed`: string or null
- `is_synthetic`: boolean

Definitions:

- `evaluation_set_id` identifies exact evaluated items and reference annotations.
- `evaluation_config_id` identifies shared evaluation protocol (task, preprocessing, scoring, conditions).
- `model_config_id` identifies model-specific prompts, generation settings, clustering config.
- Different model configs may be compared as distinct candidates.
- Candidate identity must not be embedded in shared evaluation protocol ID.
- Imported identifiers are user assertions, not independent verification.

Metric fields:

- `metric`: nonempty string
- `score`: finite number or null
- `sample_size`: positive integer or null
- `metric_config_id`: string or null

Performance fields:

- `latency`: nonnegative finite number or null
- `latency_unit`: "ms"
- `latency_basis`: "run_total" | "example_mean" | "example_p50" | "example_p95" | "unknown"
- `cost`: nonnegative finite number or null
- `cost_currency`: documented currency code or null (e.g. USD)
- `cost_basis`: "run_total" | "per_work_item" | "unknown"
- `cost_provenance`: "reported" | "estimated" | "unknown"
- `work_item_count`: positive integer or null
- `work_item_unit`: string or null (e.g. evaluated_query)
- `performance_context_id`: string or null

Rules:

- `work_item_count` describes work covered by performance figures. Must not be inferred from metric `sample_size`. Document unit. Do not assume one request equals one query.
- Repeated records for same `run_id` must agree on identity, context, timestamp, seed, performance. Metric-specific sample sizes may differ.
- Never count repeated metric rows as separate runs or repeat run costs.

### 3.2 Example records (optional)

- `run_id`, `example_id`, `query_text`, `predicted_cluster_id` (string|null), `reference_cluster_id` (string|null), `latency_ms` (nonneg|null), `cost` (nonneg|null), `cost_currency` (string|null)
- IDs unique within each run. Each example must reference existing run. Example costs must declare currency.
- Do not infer example-level measurement semantics from run-level values.
- Cluster IDs are arbitrary labels. Do not mark wrong solely because predicted != reference.
- Do not fabricate example-level quality scores from run-level metrics.

### 3.3 Metric definitions

Each: ID, name, description, direction (higher/lower better), unit/scale, expected bounds, required metric config, permitted aggregation interpretation.

Verified definitions required: ARI, AMI, NMI, Silhouette. Permit negative ARI/AMI. No guessed universal lower bound. Tolerance documented. Flag out-of-range, do not clip.

Metric config captures: normalization/averaging, feature/embedding, distance, sampling, noise treatment.

Unknown metrics can be inspected. Require explicit direction+scale before ranking/Pareto. Never combine unrelated metrics into single quality score.

## 4. Imports

Support:

1. Canonical JSON workspace.
2. Long-form runs CSV.
3. Optional examples CSV linked to existing or concurrently imported runs.

Minimal legacy columns: `model,dataset,metric,score,latency,cost,run_timestamp`.

For minimal files:

- Provide column mapping.
- Require explicit latency-unit and cost-unit/basis confirmation.
- Allow classification synthetic vs non-synthetic.
- Explain missing comparison metadata.
- Default one generated run ID per row.
- Offer grouping into multi-metric runs only on explicit identity-column confirmation + preview.
- Reject contradictory grouped rows.
- Do not merge records from different files automatically.

Minimal imports remain available for raw inspection. Missing compatibility fields must not silently become inferred values.

### 4.1 Validation and limits

Exact configured limits (see README and `src/lib/limits.ts`):

- 10 MiB per file, 50 MiB cumulative, 20000 metric records, 50000 example records.
- Bounded string lengths, CSV field lengths, JSON depth, total retained text.
- Reject malformed numbers, NaN, Infinity, invalid timestamps.
- No guessing 0.82 means 82 percent. Percentage conversion requires explicit user confirmation.
- Null/missing is not zero. Preserve valid zero.
- Reject unsupported schema versions, conflicting run metadata, duplicate run_id+metric, dangling example refs.
- Treat imported content as plain data. No eval, executable expressions, imported HTML, external URL fetches.
- Worker for bounded parsing/validation. Support cancellation and progress. Disclose browser memory overhead exceeds raw file size.

### 4.2 Import preview

Show valid records, invalid rows with row/field/reason, missing optional fields, missing compatibility metadata, duplicate/conflicting IDs, synthetic status, explicitly requested conversions. Allow reject or import-valid-after-confirmation. Do not silently discard invalid rows.

Existing-ID policy (default):

- Reject incoming conflicts without changing existing records.
- Offer explicit incoming-ID remapping. Remap example refs consistently.
- Do not infer identically named IDs from unrelated files are same run.
- Attaching examples file requires explicit confirmation of referenced existing runs.

Bounded provenance: filename, import timestamp, SHA-256 hash, applied mappings/conversions, accepted/rejected counts. Do not present hash as authenticity proof.

## 5. Compatibility engine

Three states: Comparable (by supplied metadata), Incompatible, Unverified (missing metadata). Explain comparable checks declared metadata, not truth of procedure.

Quality comparison requires matching: synthetic/non-synthetic, dataset+version, evaluation-set ID, shared evaluation-config ID, metric ID/definition/scale/metric-config ID, metric sample size.

Missing required fields -> unverified. Different declared values -> incompatible. Same sample size does not establish same items.

Candidate identity: model, model_version, model_config_id. Different candidates may be compared. Within-candidate repeated-run aggregation requires matching candidate identity. If version/config missing, display individually unless user supplies confirmed identity metadata. Seed/timestamp may vary; show values/coverage. Synthetic and non-synthetic never share cohort. Loading both permitted only with explicit confirmation + persistent labels.

Performance compatibility additionally requires: matching performance context, matching latency statistic or cost basis, compatible work scope/units, matching currency, matching cost provenance for pooled summaries. Allow reported+estimated side-by-side with labels, do not pool as equivalent. No currency conversion. Never compare mean with p50/p95. Only derive per-work-item when matching work count/scope explicitly provided. Label derived, retain originals.

Raw inspection allows incompatible/unverified in raw table with exact exclusion reasons. No force-compatible button. Corrections are explicit auditable workspace edits.

## 6. Aggregation

Within one compatible metric cohort and candidate:

- Each distinct run is one observation.
- Report total runs, valid-score runs, missing-score runs.
- Examples per run separate from run count.
- Show mean, median, min, max, sample SD. SD unavailable with <2 scores.
- Label variation as observed across-run variation. Do not imply independent population samples.
- No significance tests or CIs in MVP.

Do not: sum sample sizes as independent examples; average across datasets/definitions; weight non-additive metrics by sample size; average percentiles as pooled percentile; count metric rows as runs; sum run cost once per metric.

Performance summaries use distinct runs and matching scope. If multiple metrics selected, deduplicate run IDs before performance counts/summaries.

Distributions: run-level score distribution vs example-level latency/cost distribution. Use example-level only when measurements exist. Keep run/candidate groups separate. One observation one point, not density curve.

## 7. Dashboard

Provide: import/demo entry, dataset/candidate/metric/timestamp/synthetic filters, compatibility-status filter, raw run table, controlled comparison table, metric distributions, cost-vs-quality plot, latency-vs-quality plot, run details drawer, example drill-down, import validation and provenance panel.

Charts specify: metric+direction, units+basis, cohort, sample counts, whether points are runs or candidate summaries. Run-level scatter default. Missing values exclude only corresponding plot. Show exclusion counts/reasons. No zero-as-missing.

Accessible tooltips + companion data tables. Do not rely on color alone. Deterministic sorting/tie handling. All filters update tables/charts/counts/exports consistently. Timezone explicitly displayed.

Avoid misleading axes. Disclose nonzero baselines. No log scales with zero/negative.

### 7.1 Optional Pareto

Only after core comparisons pass tests. One quality metric + compatible cost cohort. Respect direction. Show non-dominated trade-offs. Do not call frontier universal winners. Keep synthetic/real separate. Disable when metadata missing.

### 7.2 Example drill-down

Show query text + cluster assignments. Group by cluster within run. Match example IDs across runs only within same declared evaluation set. Flag inconsistent query text for same eval-set/example ID. Do not compare label numbers as semantic identities. Do not claim coverage without evidence. Show supplied-example count and declared metric sample sizes separately. Explain metrics may use different subsets. Show example data not supplied when absent.

### 7.3 Synthetic demo

Deterministic fixtures: >=3 fictional candidates, 2 datasets, repeated compatible runs, multiple metrics, missing values, incompatible dataset version, different trade-offs, optional illustrative examples. Persistently label synthetic in tables/charts/details/exports. No invented benchmark claims about real vendors. No implied recomputed scores. Loading demo must not silently overwrite imported work.

## 8. Exports

1. Canonical workspace JSON. 2. Filtered raw metrics CSV. 3. Filtered comparison-summary CSV.

Canonical JSON preserves raw data, definitions, examples, provenance. Warn it includes query text. Support tested re-import without losing meaning. Derived summaries separate from raw observations.

CSV preserves units, candidate/context IDs, synthetic status, missing values. Includes aggregation definitions, cohort keys, counts, exclusions in summary. Protect against formula injection. Document escaping + round-trip limits. No query text by default.

## 9. Safety and performance

Imported data stays in browser. No analytics, error telemetry with imported content, external fonts, remote images, URL previews. Render strings as text. No dangerouslySetInnerHTML for imported content. Bound parsing/chart rendering. Virtualize large tables. Debounce search. Tested memoization + worker cancellation. Avoid recompute per keystroke. Keep secrets/imported content out of logs.

## 10. Tests

Unit/invariant: CSV/JSON parsing+limits, null vs zero, numeric/timestamp validation, conflicting IDs+remapping, example integrity, metric scales/directions/bounds, compatibility reasons, synthetic/real separation, candidate identity+unknown versions, unique-run performance accounting, filters+stable sorting, missing-value denominators, SD n=0/1/multi, cost/work-count derivation, percentile mismatches, export/re-import, formula protection, Pareto if implemented. Small hand-calculated golden fixtures. Verify: input order invariance; adding incompatible run does not change compatible summary; adding metric row does not duplicate run cost; clearing filters restores results; synthetic cannot alter real summaries.

Playwright: load demo, import CSV/JSON, inspect validation, confirm mappings, filter+compare, explain excluded runs, drill into examples, handle absent examples, export/re-import, keyboard nav, confirm no network transmission of imported data during core workflows.

UI tests do not establish statistical correctness.

## 11. Delivery gates

Do not claim completion if: incompatible/unverified silently pooled; metric rows double-count runs/cost; missing becomes zero; unknown identities silently merged; synthetic affects real summaries; private data leaves browser unexpectedly; confirmed high/critical security issues unresolved; required builds/tests not run or failed.

Only owner may accept unresolved risks. Never fabricate clean scans or independent approval.

## 12. Acceptance criteria

- [ ] Canonical JSON/CSV/examples imports validate, preview shows valid/invalid/missing/conflicts/synthetic/conversions, valid-only import after confirmation, provenance recorded.
- [ ] Minimal legacy CSV requires mapping + unit/basis confirmation + synthetic classification, defaults one run per row, optional explicit grouping with preview + contradiction rejection.
- [ ] Metric registry has ARI/AMI/NMI/Silhouette with direction/bounds/tolerance, out-of-range flagged not clipped, unknown metrics need direction/scale before ranking/Pareto.
- [ ] Compatibility yields comparable/incompatible/unverified with reasons; synthetic/real never share cohort; performance rules enforced; raw table explains exclusions; no force-compatible.
- [ ] Aggregation per cohort/candidate reports n_total/n_valid/n_missing, mean/median/min/max/sample-SD (SD n/a <2), distinct-run performance dedup, no forbidden pooling.
- [ ] Dashboard has all listed views, run-level scatters default, exclusion counts, accessible tooltips+tables, deterministic sorting, consistent filters, explicit timezone, honest axes.
- [ ] Examples drill-down groups by cluster, matches IDs only within same eval set, flags text inconsistency, shows counts separately, handles absent data.
- [ ] Exports round-trip, preserve units/IDs/synthetic/missing, include cohort/counts/exclusions, formula-safe, no query text by default, canonical warns about query text.
- [ ] Limits enforced and documented, worker with progress/cancel, memory disclosure, no external transmission, no imported HTML execution.
- [ ] Unit golden tests + Playwright flows pass; build succeeds; SBOM + AppSec + supply-chain reports present; reviews labeled independent/self with gaps disclosed.
