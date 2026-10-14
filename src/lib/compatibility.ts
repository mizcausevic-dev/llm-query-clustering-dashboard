import type { MetricDefinition, RunMetricRecord } from "./types.ts";
import { findMetricDefinition } from "./metricRegistry.ts";

export type CompatStatus = "comparable" | "incompatible" | "unverified";

export interface CompatResult {
  status: CompatStatus;
  reasons: string[];
}

export interface CohortKey {
  dataset: string;
  dataset_version: string | null;
  evaluation_set_id: string | null;
  evaluation_config_id: string | null;
  metric: string;
  metric_config_id: string | null;
  sample_size: number | null;
  is_synthetic: boolean;
  metricScale: string;
  metricDefinitionId: string;
}

export function cohortKeyFor(
  run: RunMetricRecord,
  defs: MetricDefinition[],
): { key: string; cohort: CohortKey; missing: string[] } {
  const def = findMetricDefinition(defs, run.metric);
  const missing: string[] = [];
  if (run.dataset_version === null) missing.push("dataset_version");
  if (run.evaluation_set_id === null) missing.push("evaluation_set_id");
  if (run.evaluation_config_id === null) missing.push("evaluation_config_id");
  if (run.sample_size === null) missing.push("sample_size");
  if (!def) missing.push(`metric definition for ${run.metric}`);
  const cohort: CohortKey = {
    dataset: run.dataset,
    dataset_version: run.dataset_version,
    evaluation_set_id: run.evaluation_set_id,
    evaluation_config_id: run.evaluation_config_id,
    metric: run.metric,
    metric_config_id: run.metric_config_id,
    sample_size: run.sample_size,
    is_synthetic: run.is_synthetic,
    metricScale: def ? `${def.minExpected ?? "?"}..${def.maxExpected ?? "?"}:${def.unit}` : "unknown-scale",
    metricDefinitionId: def ? def.id : run.metric,
  };
  const key = JSON.stringify([
    cohort.dataset,
    cohort.dataset_version,
    cohort.evaluation_set_id,
    cohort.evaluation_config_id,
    cohort.metric,
    cohort.metric_config_id,
    cohort.sample_size,
    cohort.is_synthetic,
    cohort.metricScale,
  ]);
  return { key, cohort, missing };
}

export function qualityCompatibility(
  a: RunMetricRecord,
  b: RunMetricRecord,
  defs: MetricDefinition[],
): CompatResult {
  const reasons: string[] = [];
  if (a.is_synthetic !== b.is_synthetic) {
    return { status: "incompatible", reasons: ["synthetic status differs; synthetic and non-synthetic never share a cohort"] };
  }
  const required: Array<[string, unknown, unknown]> = [
    ["dataset", a.dataset, b.dataset],
    ["dataset_version", a.dataset_version, b.dataset_version],
    ["evaluation_set_id", a.evaluation_set_id, b.evaluation_set_id],
    ["evaluation_config_id", a.evaluation_config_id, b.evaluation_config_id],
    ["metric", a.metric, b.metric],
    ["metric_config_id", a.metric_config_id, b.metric_config_id],
    ["sample_size", a.sample_size, b.sample_size],
  ];
  for (const [field, va, vb] of required) {
    if (va === null || va === undefined || vb === null || vb === undefined) {
      const label = `missing ${field}`;
      if (!reasons.includes(label)) reasons.push(label);
    } else if (!Object.is(va, vb)) {
      return { status: "incompatible", reasons: [`different ${field}: ${String(va)} vs ${String(vb)}`] };
    }
  }
  const da = findMetricDefinition(defs, a.metric);
  const db = findMetricDefinition(defs, b.metric);
  if (!da || !db) {
    reasons.push("missing metric definition");
  } else if (da.id !== db.id || da.unit !== db.unit || da.scaleLabel !== db.scaleLabel) {
    return { status: "incompatible", reasons: ["different metric definition/scale"] };
  }
  if (reasons.length > 0) return { status: "unverified", reasons };
  return {
    status: "comparable",
    reasons: ["declared metadata matches; comparable checks declared metadata, not the truth of the procedure"],
  };
}

export function candidateKey(run: RunMetricRecord): string {
  return JSON.stringify([run.model, run.model_version, run.model_config_id]);
}

export function candidateLabel(run: RunMetricRecord): string {
  const parts = [run.model];
  if (run.model_version) parts.push(run.model_version);
  if (run.model_config_id) parts.push(`cfg:${run.model_config_id}`);
  return parts.join(" ");
}

export function hasUnknownCandidateIdentity(run: RunMetricRecord): boolean {
  return run.model_version === null || run.model_config_id === null;
}

export interface PerformanceCompatResult extends CompatResult {
  derivedPerWorkItem: boolean;
}

export function performanceCompatibility(
  a: RunMetricRecord,
  b: RunMetricRecord,
  kind: "latency" | "cost",
): CompatResult {
  if (kind === "latency") {
    if (a.latency === null || b.latency === null) return { status: "unverified", reasons: ["missing latency"] };
    if (a.performance_context_id !== b.performance_context_id) {
      if (a.performance_context_id === null || b.performance_context_id === null) {
        return { status: "unverified", reasons: ["missing performance_context_id"] };
      }
      return { status: "incompatible", reasons: ["different performance_context_id"] };
    }
    if (a.latency_basis !== b.latency_basis) {
      const set = new Set([a.latency_basis, b.latency_basis]);
      if (set.has("example_mean") && (set.has("example_p50") || set.has("example_p95"))) {
        return { status: "incompatible", reasons: ["never compare mean latency with p50/p95"] };
      }
      if (a.latency_basis === "unknown" || b.latency_basis === "unknown") {
        return { status: "unverified", reasons: ["unknown latency basis"] };
      }
      return { status: "incompatible", reasons: [`different latency basis: ${a.latency_basis} vs ${b.latency_basis}`] };
    }
    if ((a.work_item_unit ?? null) !== (b.work_item_unit ?? null)) {
      if (a.work_item_unit === null || b.work_item_unit === null) {
        return { status: "unverified", reasons: ["missing work_item_unit"] };
      }
      return { status: "incompatible", reasons: ["different work_item_unit"] };
    }
    return { status: "comparable", reasons: ["matching performance context and latency statistic"] };
  }
  if (a.cost === null || b.cost === null) return { status: "unverified", reasons: ["missing cost"] };
  if (a.performance_context_id !== b.performance_context_id) {
    if (a.performance_context_id === null || b.performance_context_id === null) {
      return { status: "unverified", reasons: ["missing performance_context_id"] };
    }
    return { status: "incompatible", reasons: ["different performance_context_id"] };
  }
  if (a.cost_currency !== b.cost_currency) {
    if (a.cost_currency === null || b.cost_currency === null) return { status: "unverified", reasons: ["missing cost currency; no automatic conversion"] };
    return { status: "incompatible", reasons: [`different currency: ${a.cost_currency} vs ${b.cost_currency}; no conversion`] };
  }
  if (a.cost_basis !== b.cost_basis) {
    if (a.cost_basis === "unknown" || b.cost_basis === "unknown") return { status: "unverified", reasons: ["unknown cost basis"] };
    return { status: "incompatible", reasons: [`different cost basis: ${a.cost_basis} vs ${b.cost_basis}`] };
  }
  if (a.cost_provenance !== b.cost_provenance) {
    return { status: "comparable", reasons: [`side-by-side only: ${a.cost_provenance} vs ${b.cost_provenance}; do not pool reported with estimated`] };
  }
  return { status: "comparable", reasons: ["matching currency, basis, provenance, context"] };
}

export function derivePerWorkItem(
  cost: number,
  costBasis: RunMetricRecord["cost_basis"],
  workCount: number | null,
): { value: number | null; label: string | null } {
  if (costBasis === "per_work_item") return { value: cost, label: "as-reported per-work-item" };
  if (costBasis === "run_total" && workCount !== null && workCount > 0) {
    return { value: cost / workCount, label: `derived per-work-item = run_total / ${workCount}` };
  }
  return { value: null, label: null };
}
