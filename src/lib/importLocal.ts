import { applyMapping, splitCsv, tableToObjects } from "./csv.ts";
import type { ColumnMapping } from "./csv.ts";
import { jsonDepth, validateExampleRecord, validateMetricDefinition, validateRunRecord } from "./validation.ts";
import { LIMITS } from "./limits.ts";
import type { ExampleRecord, MetricDefinition, RunMetricRecord, ValidationIssue } from "./types.ts";

export interface LocalParseResult {
  runs: RunMetricRecord[];
  examples: ExampleRecord[];
  metricDefinitions: MetricDefinition[];
  runIssues: ValidationIssue[];
  invalidRuns: Array<{ index: number; issues: ValidationIssue[] }>;
  invalidExamples: Array<{ index: number; issues: ValidationIssue[] }>;
  missingCompatibility: string[];
  schemaVersion?: number;
}

function runDefaults(obj: Record<string, string>, defaults: Record<string, string | boolean | null>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined || out[k] === "") out[k] = v;
  }
  if (typeof out.is_synthetic === "string") out.is_synthetic = out.is_synthetic === "true";
  for (const f of ["score", "sample_size", "latency", "cost", "work_item_count"]) {
    if (out[f] === "") out[f] = null;
  }
  for (const f of ["model_version", "model_config_id", "dataset_version", "evaluation_set_id", "evaluation_config_id", "seed", "metric_config_id", "cost_currency", "work_item_unit", "performance_context_id"]) {
    if (out[f] === "") out[f] = null;
  }
  if (!out.latency_unit) out.latency_unit = "ms";
  if (!out.latency_basis) out.latency_basis = "unknown";
  if (!out.cost_basis) out.cost_basis = "unknown";
  if (!out.cost_provenance) out.cost_provenance = "unknown";
  return out;
}

export function parseRunsCsvLocal(
  text: string,
  mapping: ColumnMapping | undefined,
  defaults: Record<string, string | boolean | null>,
  onProgress?: (done: number, total: number) => void,
): LocalParseResult {
  const table = splitCsv(text);
  const objs = tableToObjects(table);
  const mapped = mapping ? applyMapping(objs, mapping) : objs;
  const runs: RunMetricRecord[] = [];
  const invalidRuns: Array<{ index: number; issues: ValidationIssue[] }> = [];
  const runIssues: ValidationIssue[] = [];
  const seenKeys = new Set<string>();
  const firstByRun = new Map<string, RunMetricRecord>();
  mapped.forEach((o, i) => {
    const withId: Record<string, string> = { ...o };
    if (!withId.run_id || withId.run_id.trim() === "") withId.run_id = `imported-row-${i + 1}`;
    const { record, issues } = validateRunRecord(runDefaults(withId, defaults), i);
    if (!record || issues.length > 0) {
      invalidRuns.push({ index: i, issues });
      runIssues.push(...issues);
    } else {
      const key = `${record.run_id}||${record.metric}`;
      if (seenKeys.has(key)) {
        const dup = [{ row: i, field: "run_id+metric", reason: `duplicate run_id + metric key: ${key}`, recordKind: "run" as const }];
        invalidRuns.push({ index: i, issues: dup });
        runIssues.push(...dup);
      } else {
        const first = firstByRun.get(record.run_id);
        if (first) {
          const fields: Array<keyof RunMetricRecord> = [
            "model", "model_version", "model_config_id", "dataset", "dataset_version",
            "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed",
            "is_synthetic", "latency", "latency_unit", "latency_basis", "cost",
            "cost_currency", "cost_basis", "cost_provenance", "work_item_count",
            "work_item_unit", "performance_context_id",
          ];
          const conflict = fields.find((fld) => !Object.is(first[fld], record[fld]));
          if (conflict) {
            const ci = [{ row: i, field: conflict, reason: `conflicting ${conflict} for run_id ${record.run_id}`, recordKind: "run" as const }];
            invalidRuns.push({ index: i, issues: ci });
            runIssues.push(...ci);
          } else {
            seenKeys.add(key);
            runs.push(record);
          }
        } else {
          firstByRun.set(record.run_id, record);
          seenKeys.add(key);
          runs.push(record);
        }
      }
    }
    if (i % LIMITS.WORKER_CHUNK_ROWS === 0) onProgress?.(i, mapped.length);
  });
  onProgress?.(mapped.length, mapped.length);
  const missing = Array.from(
    new Set(
      runs.flatMap((r) => {
        const m: string[] = [];
        if (r.dataset_version === null) m.push("dataset_version");
        if (r.evaluation_set_id === null) m.push("evaluation_set_id");
        if (r.evaluation_config_id === null) m.push("evaluation_config_id");
        if (r.sample_size === null) m.push("sample_size");
        return m;
      }),
    ),
  );
  return { runs, examples: [], metricDefinitions: [], runIssues, invalidRuns, invalidExamples: [], missingCompatibility: missing };
}

export function parseExamplesCsvLocal(text: string): LocalParseResult {
  const table = splitCsv(text);
  const objs = tableToObjects(table);
  const examples: ExampleRecord[] = [];
  const invalidExamples: Array<{ index: number; issues: ValidationIssue[] }> = [];
  const runIssues: ValidationIssue[] = [];
  objs.forEach((o, i) => {
    const input: Record<string, unknown> = { ...o };
    for (const f of ["predicted_cluster_id", "reference_cluster_id", "cost_currency"]) {
      if (input[f] === "") input[f] = null;
    }
    for (const f of ["latency_ms", "cost"]) {
      if (input[f] === "") input[f] = null;
    }
    const { record, issues } = validateExampleRecord(input, i);
    if (record && issues.length === 0) examples.push(record);
    else {
      invalidExamples.push({ index: i, issues });
      runIssues.push(...issues);
    }
  });
  return { runs: [], examples, metricDefinitions: [], runIssues, invalidRuns: [], invalidExamples, missingCompatibility: [] };
}

export function parseWorkspaceJsonLocal(text: string): LocalParseResult {
  const parsed: unknown = JSON.parse(text);
  const depth = jsonDepth(parsed);
  if (depth > LIMITS.MAX_JSON_DEPTH) throw new Error(`JSON depth ${depth} exceeds ${LIMITS.MAX_JSON_DEPTH}`);
  if (typeof parsed !== "object" || parsed === null) throw new Error("workspace must be an object");
  const ws = parsed as Record<string, unknown>;
  if (ws.schemaVersion !== 1) throw new Error(`unsupported schemaVersion ${String(ws.schemaVersion)}`);
  const runsRaw = Array.isArray(ws.runs) ? ws.runs : [];
  const exRaw = Array.isArray(ws.examples) ? ws.examples : [];
  const defRaw = Array.isArray(ws.metricDefinitions) ? ws.metricDefinitions : [];
  if (runsRaw.length > LIMITS.MAX_METRIC_RECORDS) throw new Error("too many metric records");
  if (exRaw.length > LIMITS.MAX_EXAMPLE_RECORDS) throw new Error("too many example records");
  const runs: RunMetricRecord[] = [];
  const invalidRuns: Array<{ index: number; issues: ValidationIssue[] }> = [];
  const runIssues: ValidationIssue[] = [];
  const seenKeys = new Set<string>();
  const firstByRun = new Map<string, RunMetricRecord>();
  runsRaw.forEach((r, i) => {
    const { record, issues } = validateRunRecord(r, i);
    if (!record || issues.length > 0) {
      invalidRuns.push({ index: i, issues });
      runIssues.push(...issues);
      return;
    }
    const key = `${record.run_id}||${record.metric}`;
    if (seenKeys.has(key)) {
      const dup = [{ row: i, field: "run_id+metric", reason: `duplicate run_id + metric key: ${key}`, recordKind: "run" as const }];
      invalidRuns.push({ index: i, issues: dup });
      runIssues.push(...dup);
      return;
    }
    const first = firstByRun.get(record.run_id);
    if (first) {
      const fields: Array<keyof RunMetricRecord> = [
        "model", "model_version", "model_config_id", "dataset", "dataset_version",
        "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed",
        "is_synthetic", "latency", "latency_unit", "latency_basis", "cost",
        "cost_currency", "cost_basis", "cost_provenance", "work_item_count",
        "work_item_unit", "performance_context_id",
      ];
      const conflict = fields.find((fld) => !Object.is(first[fld], record[fld]));
      if (conflict) {
        const ci = [{ row: i, field: conflict, reason: `conflicting ${conflict} for run_id ${record.run_id}`, recordKind: "run" as const }];
        invalidRuns.push({ index: i, issues: ci });
        runIssues.push(...ci);
        return;
      }
    } else {
      firstByRun.set(record.run_id, record);
    }
    seenKeys.add(key);
    runs.push(record);
  });
  const examples: ExampleRecord[] = [];
  const invalidExamples: Array<{ index: number; issues: ValidationIssue[] }> = [];
  (exRaw as unknown[]).forEach((r, i) => {
    const { record, issues } = validateExampleRecord(r, i);
    if (record && issues.length === 0) examples.push(record);
    else {
      invalidExamples.push({ index: i, issues });
      runIssues.push(...issues);
    }
  });
  const metricDefinitions: MetricDefinition[] = [];
  (defRaw as unknown[]).forEach((r, i) => {
    const { record, issues } = validateMetricDefinition(r, i);
    if (record && issues.length === 0) metricDefinitions.push(record);
    else runIssues.push(...issues);
  });
  return { runs, examples, metricDefinitions, runIssues, invalidRuns, invalidExamples, missingCompatibility: [], schemaVersion: 1 };
}
