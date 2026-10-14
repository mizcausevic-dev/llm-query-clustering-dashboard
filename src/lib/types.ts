export const SCHEMA_VERSION = 1 as const;

export type LatencyBasis =
  | "run_total"
  | "example_mean"
  | "example_p50"
  | "example_p95"
  | "unknown";

export type CostBasis = "run_total" | "per_work_item" | "unknown";
export type CostProvenance = "reported" | "estimated" | "unknown";

export interface RunMetricRecord {
  run_id: string;
  model: string;
  model_version: string | null;
  model_config_id: string | null;
  dataset: string;
  dataset_version: string | null;
  evaluation_set_id: string | null;
  evaluation_config_id: string | null;
  run_timestamp: string;
  seed: string | null;
  is_synthetic: boolean;
  metric: string;
  score: number | null;
  sample_size: number | null;
  metric_config_id: string | null;
  latency: number | null;
  latency_unit: "ms";
  latency_basis: LatencyBasis;
  cost: number | null;
  cost_currency: string | null;
  cost_basis: CostBasis;
  cost_provenance: CostProvenance;
  work_item_count: number | null;
  work_item_unit: string | null;
  performance_context_id: string | null;
}

export interface ExampleRecord {
  run_id: string;
  example_id: string;
  query_text: string;
  predicted_cluster_id: string | null;
  reference_cluster_id: string | null;
  latency_ms: number | null;
  cost: number | null;
  cost_currency: string | null;
}

export type MetricDirection = "higher" | "lower";

export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  direction: MetricDirection;
  unit: string;
  scaleLabel: string;
  minExpected: number | null;
  maxExpected: number | null;
  tolerance: number;
  requiresMetricConfig: string[];
  aggregationNote: string;
}

export interface Workspace {
  schemaVersion: number;
  runs: RunMetricRecord[];
  examples: ExampleRecord[];
  metricDefinitions: MetricDefinition[];
}

export interface ProvenanceEntry {
  filename: string;
  importTimestamp: string;
  sha256: string;
  mappings: Record<string, string>;
  conversions: string[];
  acceptedRuns: number;
  rejectedRuns: number;
  acceptedExamples: number;
  rejectedExamples: number;
  note: string;
}

export interface ValidationIssue {
  row: number | null;
  field: string | null;
  reason: string;
  recordKind: "run" | "example" | "workspace" | "metricDefinition";
}

export interface ParseOutcome<T> {
  valid: T[];
  invalid: Array<{ index: number; raw: unknown; issues: ValidationIssue[] }>;
  issues: ValidationIssue[];
}

export function emptyWorkspace(): Workspace {
  return { schemaVersion: SCHEMA_VERSION, runs: [], examples: [], metricDefinitions: [] };
}
