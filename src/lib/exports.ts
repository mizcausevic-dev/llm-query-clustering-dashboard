import type { ExampleRecord, ProvenanceEntry, RunMetricRecord, Workspace } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export function toCanonicalJson(
  runs: RunMetricRecord[],
  examples: ExampleRecord[],
  metricDefinitions: Workspace["metricDefinitions"],
): Workspace {
  return {
    schemaVersion: SCHEMA_VERSION,
    runs: runs.map((r) => ({ ...r })),
    examples: examples.map((e) => ({ ...e })),
    metricDefinitions: metricDefinitions.map((d) => ({ ...d })),
  };
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
export function escapeCsvCell(v: string): string {
  let s = v;
  if (FORMULA_PREFIX.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvCellFor(value: unknown): string {
  if (value === null || value === undefined) return "";
  return escapeCsvCell(String(value));
}

export function rawMetricsCsv(runs: RunMetricRecord[]): string {
  const headers = [
    "run_id", "model", "model_version", "model_config_id", "dataset", "dataset_version",
    "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed", "is_synthetic",
    "metric", "score", "sample_size", "metric_config_id", "latency", "latency_unit",
    "latency_basis", "cost", "cost_currency", "cost_basis", "cost_provenance",
    "work_item_count", "work_item_unit", "performance_context_id",
  ];
  const lines = [headers.map(escapeCsvCell).join(",")];
  const sorted = [...runs].sort((a, b) =>
    a.run_id === b.run_id ? (a.metric < b.metric ? -1 : 1) : a.run_id < b.run_id ? -1 : 1,
  );
  for (const r of sorted) {
    lines.push(
      [
        r.run_id, r.model, r.model_version, r.model_config_id, r.dataset, r.dataset_version,
        r.evaluation_set_id, r.evaluation_config_id, r.run_timestamp, r.seed, String(r.is_synthetic),
        r.metric, r.score, r.sample_size, r.metric_config_id, r.latency, r.latency_unit,
        r.latency_basis, r.cost, r.cost_currency, r.cost_basis, r.cost_provenance,
        r.work_item_count, r.work_item_unit, r.performance_context_id,
      ]
        .map(csvCellFor)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export interface SummaryRow {
  cohort_key: string;
  dataset: string;
  dataset_version: string | null;
  evaluation_set_id: string | null;
  evaluation_config_id: string | null;
  metric: string;
  metric_config_id: string | null;
  sample_size: number | null;
  is_synthetic: boolean;
  candidate: string;
  model: string;
  model_version: string | null;
  model_config_id: string | null;
  n_total_runs: number;
  n_valid_scores: number;
  n_missing_scores: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sample_sd: number | null;
  aggregation: string;
  exclusions: string;
}

export function summaryCsv(rows: SummaryRow[]): string {
  const headers = [
    "cohort_key", "dataset", "dataset_version", "evaluation_set_id", "evaluation_config_id",
    "metric", "metric_config_id", "sample_size", "is_synthetic", "candidate", "model",
    "model_version", "model_config_id", "n_total_runs", "n_valid_scores", "n_missing_scores",
    "mean", "median", "min", "max", "sample_sd", "aggregation", "exclusions",
  ];
  const lines = [headers.map(escapeCsvCell).join(",")];
  const sorted = [...rows].sort((a, b) =>
    a.cohort_key === b.cohort_key ? (a.candidate < b.candidate ? -1 : 1) : a.cohort_key < b.cohort_key ? -1 : 1,
  );
  for (const r of sorted) {
    lines.push(
      [
        r.cohort_key, r.dataset, r.dataset_version, r.evaluation_set_id, r.evaluation_config_id,
        r.metric, r.metric_config_id, r.sample_size, String(r.is_synthetic), r.candidate, r.model,
        r.model_version, r.model_config_id, r.n_total_runs, r.n_valid_scores, r.n_missing_scores,
        r.mean, r.median, r.min, r.max, r.sample_sd, r.aggregation, r.exclusions,
      ]
        .map(csvCellFor)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function provenanceToJson(entries: ProvenanceEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
