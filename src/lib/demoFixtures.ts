import { VERIFIED_METRICS } from "./metricRegistry.ts";
import type { ExampleRecord, RunMetricRecord, Workspace } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

function run(
  partial: Partial<RunMetricRecord> & Pick<RunMetricRecord, "run_id" | "model" | "dataset" | "metric" | "score">,
): RunMetricRecord {
  return {
    model_version: "v1",
    model_config_id: "cfg-default",
    dataset_version: "2026.01",
    evaluation_set_id: "eval-core-500",
    evaluation_config_id: "proto-clustering-v1",
    run_timestamp: "2026-09-01T12:00:00Z",
    seed: "seed-1",
    is_synthetic: true,
    sample_size: 500,
    metric_config_id: "mc-cosine-kmeans",
    latency: 1200,
    latency_unit: "ms",
    latency_basis: "run_total",
    cost: 0.42,
    cost_currency: "USD",
    cost_basis: "run_total",
    cost_provenance: "reported",
    work_item_count: 500,
    work_item_unit: "evaluated_query",
    performance_context_id: "perf-cpu-a",
    ...partial,
  };
}

export function buildDemoWorkspace(): Workspace {
  const runs: RunMetricRecord[] = [
    run({ run_id: "demo-aurora-r1", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine", dataset: "support-queries", metric: "ARI", score: 0.62, seed: "seed-11", run_timestamp: "2026-09-01T12:00:00Z", latency: 1400, cost: 0.55 }),
    run({ run_id: "demo-aurora-r2", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine", dataset: "support-queries", metric: "ARI", score: 0.58, seed: "seed-22", run_timestamp: "2026-09-02T12:00:00Z", latency: 1380, cost: 0.55 }),
    run({ run_id: "demo-aurora-r1", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine", dataset: "support-queries", metric: "NMI", score: 0.71, seed: "seed-11", run_timestamp: "2026-09-01T12:00:00Z", latency: 1400, cost: 0.55 }),
    run({ run_id: "demo-aurora-r2", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine", dataset: "support-queries", metric: "NMI", score: 0.69, seed: "seed-22", run_timestamp: "2026-09-02T12:00:00Z", latency: 1380, cost: 0.55 }),
    run({ run_id: "demo-aurora-r1", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine", dataset: "support-queries", metric: "SILHOUETTE", score: 0.31, seed: "seed-11", run_timestamp: "2026-09-01T12:00:00Z", latency: 1400, cost: 0.55 }),
    run({ run_id: "demo-borealis-r1", model: "fictional-borealis-clusterer", model_config_id: "cfg-k12-euclid", dataset: "support-queries", metric: "ARI", score: 0.55, seed: "seed-11", run_timestamp: "2026-09-01T13:00:00Z", latency: 900, cost: 0.28 }),
    run({ run_id: "demo-borealis-r2", model: "fictional-borealis-clusterer", model_config_id: "cfg-k12-euclid", dataset: "support-queries", metric: "ARI", score: null, seed: "seed-33", run_timestamp: "2026-09-03T13:00:00Z", latency: 920, cost: 0.28 }),
    run({ run_id: "demo-borealis-r1", model: "fictional-borealis-clusterer", model_config_id: "cfg-k12-euclid", dataset: "support-queries", metric: "NMI", score: 0.64, seed: "seed-11", run_timestamp: "2026-09-01T13:00:00Z", latency: 900, cost: 0.28 }),
    run({ run_id: "demo-cipher-r1", model: "fictional-cipher-clusterer", model_config_id: "cfg-hdbscan", dataset: "support-queries", metric: "ARI", score: 0.66, seed: "seed-44", run_timestamp: "2026-09-04T09:00:00Z", latency: 2600, cost: 0.81 }),
    run({ run_id: "demo-cipher-r1", model: "fictional-cipher-clusterer", model_config_id: "cfg-hdbscan", dataset: "support-queries", metric: "AMI", score: 0.63, seed: "seed-44", run_timestamp: "2026-09-04T09:00:00Z", latency: 2600, cost: 0.81 }),
    run({ run_id: "demo-aurora-billing-r1", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine", dataset: "billing-queries", metric: "ARI", score: 0.49, seed: "seed-11", run_timestamp: "2026-09-05T12:00:00Z", latency: 1500, cost: 0.6 }),
    run({ run_id: "demo-borealis-billing-r1", model: "fictional-borealis-clusterer", model_config_id: "cfg-k12-euclid", dataset: "billing-queries", metric: "ARI", score: 0.52, seed: "seed-11", run_timestamp: "2026-09-05T13:00:00Z", latency: 950, cost: 0.31 }),
    run({
      run_id: "demo-aurora-v2-incompat", model: "fictional-aurora-clusterer", model_config_id: "cfg-k8-cosine",
      dataset: "support-queries", dataset_version: "2026.02", metric: "ARI", score: 0.7,
      seed: "seed-99", run_timestamp: "2026-09-06T12:00:00Z", latency: 1400, cost: 0.55,
    }),
  ];

  const examples: ExampleRecord[] = [
    { run_id: "demo-aurora-r1", example_id: "q-001", query_text: "reset my password for the billing portal", predicted_cluster_id: "c-auth", reference_cluster_id: "r-auth", latency_ms: 12, cost: null, cost_currency: null },
    { run_id: "demo-aurora-r1", example_id: "q-002", query_text: "invoice shows duplicate charge", predicted_cluster_id: "c-billing", reference_cluster_id: "r-billing", latency_ms: 14, cost: null, cost_currency: null },
    { run_id: "demo-aurora-r1", example_id: "q-003", query_text: "how to export usage report", predicted_cluster_id: "c-report", reference_cluster_id: "r-report", latency_ms: 11, cost: null, cost_currency: null },
    { run_id: "demo-borealis-r1", example_id: "q-001", query_text: "reset my password for the billing portal", predicted_cluster_id: "k3", reference_cluster_id: "r-auth", latency_ms: 8, cost: null, cost_currency: null },
    { run_id: "demo-borealis-r1", example_id: "q-002", query_text: "invoice shows duplicate charge", predicted_cluster_id: "k7", reference_cluster_id: "r-billing", latency_ms: 9, cost: null, cost_currency: null },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    runs,
    examples,
    metricDefinitions: VERIFIED_METRICS.map((m) => ({ ...m })),
  };
}

export const DEMO_NOTE =
  "Synthetic demo fixture. Fictional candidates and illustrative scores. Scores are supplied, not recomputed from illustrative example assignments. Do not treat as real vendor benchmarks.";
