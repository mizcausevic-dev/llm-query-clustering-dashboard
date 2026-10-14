import { useMemo } from "react";
import type { ExampleRecord, MetricDefinition, ProvenanceEntry, RunMetricRecord } from "./lib/types.ts";
import { mergedDefinitions } from "./lib/metricRegistry.ts";
import { cohortKeyFor } from "./lib/compatibility.ts";
import { candidateLabel } from "./lib/compatibility.ts";

export interface WorkspaceState {
  runs: RunMetricRecord[];
  examples: ExampleRecord[];
  metricDefinitions: MetricDefinition[];
  provenance: ProvenanceEntry[];
  totalImportedBytes: number;
  hasUnsaved: boolean;
}

export const initialWorkspace: WorkspaceState = {
  runs: [],
  examples: [],
  metricDefinitions: [],
  provenance: [],
  totalImportedBytes: 0,
  hasUnsaved: false,
};

export function allDefinitions(state: WorkspaceState): MetricDefinition[] {
  return mergedDefinitions(state.metricDefinitions);
}

export interface ConflictInfo {
  conflictingRunIds: string[];
  danglingExampleRuns: string[];
}

export function detectConflicts(
  existing: RunMetricRecord[],
  incoming: RunMetricRecord[],
  existingExamples: ExampleRecord[],
  incomingExamples: ExampleRecord[],
): ConflictInfo {
  const existingIds = new Set(existing.map((r) => r.run_id));
  const conflictingRunIds = [...new Set(incoming.map((r) => r.run_id))].filter((id) => existingIds.has(id));
  void existingExamples;
  const allRunIds = new Set([...existingIds, ...incoming.map((r) => r.run_id)]);
  const danglingExampleRuns = [...new Set(incomingExamples.map((e) => e.run_id))].filter((id) => !allRunIds.has(id));
  return { conflictingRunIds, danglingExampleRuns };
}

export function applyRemapping(
  runs: RunMetricRecord[],
  examples: ExampleRecord[],
  remap: Record<string, string>,
): { runs: RunMetricRecord[]; examples: ExampleRecord[] } {
  if (Object.keys(remap).length === 0) return { runs, examples };
  return {
    runs: runs.map((r) => ({ ...r, run_id: remap[r.run_id] ?? r.run_id })),
    examples: examples.map((e) => ({ ...e, run_id: remap[e.run_id] ?? e.run_id })),
  };
}

export function useCohorts(state: WorkspaceState) {
  return useMemo(() => {
    const defs = allDefinitions(state);
    const map = new Map<string, { key: string; label: string; runs: RunMetricRecord[]; missing: string[] }>();
    for (const r of state.runs) {
      const { key, cohort, missing } = cohortKeyFor(r, defs);
      const entry = map.get(key);
      const label = `${r.dataset}@${r.dataset_version ?? "?"} | ${r.evaluation_set_id ?? "?"} | ${r.evaluation_config_id ?? "?"} | ${r.metric} n=${r.sample_size ?? "?"} | ${r.is_synthetic ? "synthetic" : "real"}`;
      void cohort;
      if (!entry) map.set(key, { key, label, runs: [r], missing: [...missing] });
      else {
        entry.runs.push(r);
        for (const m of missing) if (!entry.missing.includes(m)) entry.missing.push(m);
      }
    }
    return [...map.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
  }, [state]);
}

export function exampleCountsByRun(examples: ExampleRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of examples) m.set(e.run_id, (m.get(e.run_id) ?? 0) + 1);
  return m;
}

export function formatNum(v: number | null, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Number(v.toFixed(digits)).toString();
}

export function candidateName(r: RunMetricRecord): string {
  return candidateLabel(r);
}

export function timezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";
  } catch {
    return "local";
  }
}
