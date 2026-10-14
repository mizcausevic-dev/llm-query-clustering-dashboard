import { splitCsv, tableToObjects, applyMapping } from "../lib/csv.ts";
import type { ColumnMapping } from "../lib/csv.ts";
import { validateExampleRecord, validateRunRecord, validateMetricDefinition, jsonDepth } from "../lib/validation.ts";
import { LIMITS } from "../lib/limits.ts";
import type { ExampleRecord, MetricDefinition, RunMetricRecord, ValidationIssue } from "../lib/types.ts";

export interface WorkerRequest {
  jobId: string;
  kind: "runs-csv" | "examples-csv" | "workspace-json";
  text: string;
  mapping?: ColumnMapping;
  defaults?: Record<string, string | boolean | null>;
}

export interface WorkerProgress {
  jobId: string;
  type: "progress";
  done: number;
  total: number;
}

export interface WorkerDone {
  jobId: string;
  type: "done";
  runs?: RunMetricRecord[];
  examples?: ExampleRecord[];
  metricDefinitions?: MetricDefinition[];
  schemaVersion?: number;
  runIssues: ValidationIssue[];
  invalidRuns: Array<{ index: number; issues: ValidationIssue[] }>;
  invalidExamples: Array<{ index: number; issues: ValidationIssue[] }>;
  missingCompatibility: string[];
}

export interface WorkerError {
  jobId: string;
  type: "error";
  message: string;
}

function postProgress(jobId: string, done: number, total: number) {
  postMessage({ jobId, type: "progress", done, total } satisfies WorkerProgress);
}

function toRunInput(obj: Record<string, string>, defaults: Record<string, string | boolean | null>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined || out[k] === "") out[k] = v;
  }
  if (typeof out.is_synthetic === "string") {
    out.is_synthetic = out.is_synthetic === "true";
  }
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

function toExampleInput(obj: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const f of ["predicted_cluster_id", "reference_cluster_id", "cost_currency"]) {
    if (out[f] === "") out[f] = null;
  }
  for (const f of ["latency_ms", "cost"]) {
    if (out[f] === "") out[f] = null;
  }
  return out;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === "runs-csv") {
      const table = splitCsv(req.text);
      const objs = tableToObjects(table);
      const mapped = req.mapping ? applyMapping(objs, req.mapping) : objs;
      const runs: RunMetricRecord[] = [];
      const invalidRuns: Array<{ index: number; issues: ValidationIssue[] }> = [];
      const runIssues: ValidationIssue[] = [];
      const total = mapped.length;
      const seenKeys = new Set<string>();
      const firstByRun = new Map<string, RunMetricRecord>();
      mapped.forEach((o, i) => {
        const withId: Record<string, string> = { ...o };
        if (!withId.run_id || withId.run_id.trim() === "") withId.run_id = `imported-row-${i + 1}`;
        const input = toRunInput(withId, req.defaults ?? {});
        const { record, issues } = validateRunRecord(input, i);
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
            let conflict: string | null = null;
            if (first) {
              const fields: Array<keyof RunMetricRecord> = ["model", "dataset", "dataset_version", "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed", "is_synthetic", "latency", "cost"];
              for (const fld of fields) {
                if (!Object.is(first[fld], record[fld])) { conflict = fld; break; }
              }
            } else {
              firstByRun.set(record.run_id, record);
            }
            if (conflict) {
              const ci = [{ row: i, field: conflict, reason: `conflicting ${conflict} for run_id ${record.run_id}`, recordKind: "run" as const }];
              invalidRuns.push({ index: i, issues: ci });
              runIssues.push(...ci);
            } else {
              seenKeys.add(key);
              runs.push(record);
            }
          }
        }
        if (i % LIMITS.WORKER_CHUNK_ROWS === 0) postProgress(req.jobId, i, total);
      });
      postProgress(req.jobId, total, total);
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
      const done: WorkerDone = { jobId: req.jobId, type: "done", runs, runIssues, invalidRuns, invalidExamples: [], missingCompatibility: missing };
      postMessage(done);
    } else if (req.kind === "examples-csv") {
      const table = splitCsv(req.text);
      const objs = tableToObjects(table);
      const examples: ExampleRecord[] = [];
      const invalidExamples: Array<{ index: number; issues: ValidationIssue[] }> = [];
      const runIssues: ValidationIssue[] = [];
      objs.forEach((o, i) => {
        const { record, issues } = validateExampleRecord(toExampleInput(o), i);
        if (record && issues.length === 0) examples.push(record);
        else {
          invalidExamples.push({ index: i, issues });
          runIssues.push(...issues);
        }
        if (i % LIMITS.WORKER_CHUNK_ROWS === 0) postProgress(req.jobId, i, objs.length);
      });
      postProgress(req.jobId, objs.length, objs.length);
      const done: WorkerDone = { jobId: req.jobId, type: "done", examples, runIssues, invalidRuns: [], invalidExamples, missingCompatibility: [] };
      postMessage(done);
    } else {
      if (req.text.length > LIMITS.MAX_FILE_BYTES * 2) {
        throw new Error("JSON text exceeds worker bound");
      }
      const parsed: unknown = JSON.parse(req.text);
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
      runsRaw.forEach((r, i) => {
        const { record, issues } = validateRunRecord(r, i);
        if (record && issues.length === 0) runs.push(record);
        else {
          invalidRuns.push({ index: i, issues });
          runIssues.push(...issues);
        }
        if (i % LIMITS.WORKER_CHUNK_ROWS === 0) postProgress(req.jobId, i, runsRaw.length);
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
      postProgress(req.jobId, runsRaw.length, runsRaw.length);
      const done: WorkerDone = {
        jobId: req.jobId, type: "done", runs, examples, metricDefinitions,
        schemaVersion: 1, runIssues, invalidRuns, invalidExamples, missingCompatibility: [],
      };
      postMessage(done);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    postMessage({ jobId: req.jobId, type: "error", message: msg } satisfies WorkerError);
  }
};
