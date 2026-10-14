import type { MetricDefinition, RunMetricRecord } from "./types.ts";
import { candidateKey, cohortKeyFor, hasUnknownCandidateIdentity } from "./compatibility.ts";

export interface RowCompat {
  status: "comparable" | "incompatible" | "unverified";
  reason: string;
}

export function isQualityComplete(run: RunMetricRecord, defs: MetricDefinition[]): boolean {
  return cohortKeyFor(run, defs).missing.length === 0;
}

export function aggregationKey(run: RunMetricRecord): string {
  if (hasUnknownCandidateIdentity(run)) return `unconfirmed-identity:${run.run_id}`;
  return candidateKey(run);
}

export function distinctRunCount(runs: RunMetricRecord[]): number {
  return new Set(runs.map((r) => r.run_id)).size;
}

export function isControlledCohort(runs: RunMetricRecord[], defs: MetricDefinition[]): boolean {
  if (runs.length === 0) return false;
  if (!isQualityComplete(runs[0], defs)) return false;
  if (runs.some((r) => cohortKeyFor(r, defs).key !== cohortKeyFor(runs[0], defs).key)) return false;
  if (runs.some((r) => !isQualityComplete(r, defs))) return false;
  return distinctRunCount(runs) >= 2;
}

export function groupByCohort(
  runs: RunMetricRecord[],
  defs: MetricDefinition[],
): Array<{ key: string; label: string; runs: RunMetricRecord[]; missing: string[] }> {
  const map = new Map<string, { key: string; label: string; runs: RunMetricRecord[]; missing: string[] }>();
  for (const r of runs) {
    const { key, missing } = cohortKeyFor(r, defs);
    const label = `${r.dataset}@${r.dataset_version ?? "?"} | ${r.evaluation_set_id ?? "?"} | ${r.evaluation_config_id ?? "?"} | ${r.metric} n=${r.sample_size ?? "?"} | ${r.is_synthetic ? "synthetic" : "real"}`;
    const e = map.get(key);
    if (!e) map.set(key, { key, label, runs: [r], missing: [...missing] });
    else e.runs.push(r);
  }
  return [...map.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
}

export function controlledCohorts(
  runs: RunMetricRecord[],
  defs: MetricDefinition[],
): Array<{ key: string; label: string; runs: RunMetricRecord[] }> {
  return groupByCohort(runs, defs)
    .filter((g) => isControlledCohort(g.runs, defs))
    .map(({ key, label, runs: rs }) => ({ key, label, runs: rs }));
}

export function rowCompatibilityLabel(
  run: RunMetricRecord,
  allRuns: RunMetricRecord[],
  defs: MetricDefinition[],
): RowCompat {
  const { key, missing } = cohortKeyFor(run, defs);
  if (missing.length > 0) {
    return { status: "unverified", reason: `missing: ${missing.join(", ")}` };
  }
  const sameKeyRuns = allRuns.filter((r) => cohortKeyFor(r, defs).key === key);
  const n = distinctRunCount(sameKeyRuns);
  const related = allRuns.filter((r) => {
    if (r.run_id === run.run_id && r.metric === run.metric) return false;
    if (!isQualityComplete(r, defs)) return false;
    return r.dataset === run.dataset && r.metric === run.metric && r.is_synthetic === run.is_synthetic;
  });
  const differs = related.some((r) => cohortKeyFor(r, defs).key !== key);
  if (n >= 2) {
    return {
      status: "comparable",
      reason: "declared metadata matches a cohort with 2+ distinct runs; comparable checks declared metadata, not the truth of the procedure",
    };
  }
  if (differs) {
    return {
      status: "incompatible",
      reason: "complete metadata differs from other complete rows that share dataset, metric, and synthetic status",
    };
  }
  return {
    status: "comparable",
    reason: "complete declared metadata; cohort has 1 distinct run so no pairwise comparison yet",
  };
}

export function plotCohortForMetric(
  runs: RunMetricRecord[],
  defs: MetricDefinition[],
  metric: string,
  focusKey: string,
): { key: string; label: string; runs: RunMetricRecord[] } | null {
  const candidates = controlledCohorts(runs, defs).filter((g) => g.runs[0]?.metric === metric);
  if (candidates.length === 0) return null;
  if (focusKey !== "all") {
    return candidates.find((c) => c.key === focusKey) ?? null;
  }
  return [...candidates].sort((a, b) => {
    const dn = distinctRunCount(b.runs) - distinctRunCount(a.runs);
    if (dn !== 0) return dn;
    return a.label < b.label ? -1 : 1;
  })[0];
}
