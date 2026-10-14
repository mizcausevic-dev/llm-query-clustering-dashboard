import { LIMITS } from "./limits.ts";
import type {
  ExampleRecord,
  MetricDefinition,
  RunMetricRecord,
  ValidationIssue,
} from "./types.ts";

const LATENCY_BASES = new Set(["run_total", "example_mean", "example_p50", "example_p95", "unknown"]);
const COST_BASES = new Set(["run_total", "per_work_item", "unknown"]);
const COST_PROV = new Set(["reported", "estimated", "unknown"]);

function issue(
  recordKind: ValidationIssue["recordKind"],
  row: number | null,
  field: string | null,
  reason: string,
): ValidationIssue {
  return { recordKind, row, field, reason };
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function parseStrictNumber(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : "invalid";
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return null;
    if (/^(NaN|Infinity|\+?Infinity|-Infinity)$/i.test(t)) return "invalid";
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return "invalid";
    const n = Number(t);
    return Number.isFinite(n) ? n : "invalid";
  }
  return "invalid";
}

export function parseStrictInt(raw: unknown): number | null | "invalid" {
  const n = parseStrictNumber(raw);
  if (n === null || n === "invalid") return n;
  if (!Number.isInteger(n)) return "invalid";
  return n;
}

export function isValidTimestampWithTimezone(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (v.length > LIMITS.MAX_SHORT_STRING) return false;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return false;
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(v.trim());
}

function checkStr(
  v: unknown,
  opts: { allowNull: boolean; nonempty?: boolean; max: number },
): "ok" | "null" | "invalid" {
  if (v === null || v === undefined) return opts.allowNull ? "null" : "invalid";
  if (typeof v !== "string") return "invalid";
  if (v.length > opts.max) return "invalid";
  if (opts.nonempty && v.trim().length === 0) return "invalid";
  return "ok";
}

export interface RunValidationResult {
  valid: RunMetricRecord[];
  invalid: Array<{ index: number; raw: unknown; issues: ValidationIssue[] }>;
}

function normalizeNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v as string;
}

export function validateRunRecord(raw: unknown, index: number): { record?: RunMetricRecord; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { issues: [issue("run", index, null, "record must be an object")] };
  }
  const r = raw as Record<string, unknown>;

  const req = (field: string, max = LIMITS.MAX_ID_LENGTH, nonempty = true) => {
    const c = checkStr(r[field], { allowNull: false, nonempty, max });
    if (c !== "ok") issues.push(issue("run", index, field, `must be a nonempty string (max ${max} chars)`));
  };
  const opt = (field: string, max = LIMITS.MAX_ID_LENGTH) => {
    if (r[field] === null || r[field] === undefined || (typeof r[field] === "string" && r[field].trim() === "")) return;
    const c = checkStr(r[field], { allowNull: true, max });
    if (c !== "ok") issues.push(issue("run", index, field, `must be a string or null (max ${max} chars)`));
  };

  req("run_id");
  req("model");
  opt("model_version");
  opt("model_config_id");
  req("dataset");
  opt("dataset_version");
  opt("evaluation_set_id");
  opt("evaluation_config_id");
  opt("seed", LIMITS.MAX_SHORT_STRING);
  req("metric");

  if (typeof r.is_synthetic !== "boolean") {
    issues.push(issue("run", index, "is_synthetic", "must be boolean"));
  }
  if (!isValidTimestampWithTimezone(r.run_timestamp)) {
    issues.push(issue("run", index, "run_timestamp", "must be ISO-8601 timestamp with timezone"));
  }

  const score = parseStrictNumber(r.score);
  if (score === "invalid") issues.push(issue("run", index, "score", "must be a finite number or null"));
  const sample = parseStrictInt(r.sample_size);
  if (sample === "invalid" || (typeof sample === "number" && sample <= 0)) {
    issues.push(issue("run", index, "sample_size", "must be a positive integer or null"));
  }
  opt("metric_config_id");

  const latency = parseStrictNumber(r.latency);
  if (latency === "invalid" || (typeof latency === "number" && latency < 0)) {
    issues.push(issue("run", index, "latency", "must be a nonnegative finite number or null"));
  }
  if (r.latency_unit !== "ms") {
    issues.push(issue("run", index, "latency_unit", 'must be "ms"'));
  }
  if (typeof r.latency_basis !== "string" || !LATENCY_BASES.has(r.latency_basis)) {
    issues.push(issue("run", index, "latency_basis", "must be run_total|example_mean|example_p50|example_p95|unknown"));
  }
  const cost = parseStrictNumber(r.cost);
  if (cost === "invalid" || (typeof cost === "number" && cost < 0)) {
    issues.push(issue("run", index, "cost", "must be a nonnegative finite number or null"));
  }
  if (r.cost_currency !== null && r.cost_currency !== undefined && (typeof r.cost_currency !== "string" || (r.cost_currency as string).trim() === "")) {
    if (r.cost_currency !== null) issues.push(issue("run", index, "cost_currency", "must be a documented currency code or null"));
  } else if (typeof r.cost_currency === "string" && r.cost_currency.length > 16) {
    issues.push(issue("run", index, "cost_currency", "currency code too long"));
  }
  if (typeof r.cost_basis !== "string" || !COST_BASES.has(r.cost_basis)) {
    issues.push(issue("run", index, "cost_basis", "must be run_total|per_work_item|unknown"));
  }
  if (typeof r.cost_provenance !== "string" || !COST_PROV.has(r.cost_provenance)) {
    issues.push(issue("run", index, "cost_provenance", "must be reported|estimated|unknown"));
  }
  const wic = parseStrictInt(r.work_item_count);
  if (wic === "invalid" || (typeof wic === "number" && wic <= 0)) {
    issues.push(issue("run", index, "work_item_count", "must be a positive integer or null"));
  }
  opt("work_item_unit", LIMITS.MAX_SHORT_STRING);
  opt("performance_context_id");

  if (issues.length > 0) return { issues };
  const record: RunMetricRecord = {
    run_id: (r.run_id as string).trim(),
    model: (r.model as string).trim(),
    model_version: normalizeNullableString(r.model_version),
    model_config_id: normalizeNullableString(r.model_config_id),
    dataset: (r.dataset as string).trim(),
    dataset_version: normalizeNullableString(r.dataset_version),
    evaluation_set_id: normalizeNullableString(r.evaluation_set_id),
    evaluation_config_id: normalizeNullableString(r.evaluation_config_id),
    run_timestamp: r.run_timestamp as string,
    seed: normalizeNullableString(r.seed),
    is_synthetic: r.is_synthetic as boolean,
    metric: (r.metric as string).trim(),
    score: score === null ? null : (score as number),
    sample_size: sample === null ? null : (sample as number),
    metric_config_id: normalizeNullableString(r.metric_config_id),
    latency: latency === null ? null : (latency as number),
    latency_unit: "ms",
    latency_basis: r.latency_basis as RunMetricRecord["latency_basis"],
    cost: cost === null ? null : (cost as number),
    cost_currency: normalizeNullableString(r.cost_currency),
    cost_basis: r.cost_basis as RunMetricRecord["cost_basis"],
    cost_provenance: r.cost_provenance as RunMetricRecord["cost_provenance"],
    work_item_count: wic === null ? null : (wic as number),
    work_item_unit: normalizeNullableString(r.work_item_unit),
    performance_context_id: normalizeNullableString(r.performance_context_id),
  };
  return { record, issues };
}

export function validateRunsList(raw: unknown): RunValidationResult {
  const valid: RunMetricRecord[] = [];
  const invalid: Array<{ index: number; raw: unknown; issues: ValidationIssue[] }> = [];
  if (!Array.isArray(raw)) {
    return { valid, invalid: [{ index: -1, raw, issues: [issue("run", null, null, "runs must be an array")] }] };
  }
  if (raw.length > LIMITS.MAX_METRIC_RECORDS) {
    invalid.push({
      index: -1,
      raw: null,
      issues: [issue("run", null, null, `too many metric records (${raw.length} > ${LIMITS.MAX_METRIC_RECORDS})`)],
    });
    return { valid, invalid };
  }
  raw.forEach((rec, i) => {
    const { record, issues } = validateRunRecord(rec, i);
    if (record && issues.length === 0) valid.push(record);
    else invalid.push({ index: i, raw: rec, issues });
  });

  const seen = new Map<string, number>();
  valid.forEach((r) => {
    const k = `${r.run_id}||${r.metric}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  });
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupes.length > 0) {
    for (const d of dupes) {
      invalid.push({
        index: -1,
        raw: null,
        issues: [issue("run", null, "run_id+metric", `duplicate run_id + metric key: ${d}`)],
      });
    }
  }

  const byRun = new Map<string, RunMetricRecord[]>();
  for (const r of valid) {
    const arr = byRun.get(r.run_id) ?? [];
    arr.push(r);
    byRun.set(r.run_id, arr);
  }
  for (const [runId, rows] of byRun) {
    const first = rows[0];
    for (const other of rows.slice(1)) {
      const fields: Array<keyof RunMetricRecord> = [
        "model", "model_version", "model_config_id", "dataset", "dataset_version",
        "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed",
        "is_synthetic", "latency", "latency_unit", "latency_basis", "cost",
        "cost_currency", "cost_basis", "cost_provenance", "work_item_count",
        "work_item_unit", "performance_context_id",
      ];
      for (const f of fields) {
        if (!Object.is(first[f], other[f])) {
          invalid.push({
            index: -1,
            raw: null,
            issues: [issue("run", null, f, `conflicting ${f} for run_id ${runId}`)],
          });
          break;
        }
      }
      if (first.metric_config_id !== undefined) {
        void 0;
      }
    }
  }
  return { valid: dupes.length > 0 ? [] : valid, invalid };
}

export function validateExampleRecord(raw: unknown, index: number): { record?: ExampleRecord; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { issues: [issue("example", index, null, "record must be an object")] };
  }
  const r = raw as Record<string, unknown>;
  for (const f of ["run_id", "example_id"]) {
    if (typeof r[f] !== "string" || (r[f] as string).trim() === "" || (r[f] as string).length > LIMITS.MAX_ID_LENGTH) {
      issues.push(issue("example", index, f, `must be nonempty string (max ${LIMITS.MAX_ID_LENGTH})`));
    }
  }
  if (typeof r.query_text !== "string" || r.query_text.length > LIMITS.MAX_QUERY_TEXT) {
    issues.push(issue("example", index, "query_text", `must be a string (max ${LIMITS.MAX_QUERY_TEXT})`));
  }
  for (const f of ["predicted_cluster_id", "reference_cluster_id"]) {
    const v = r[f];
    if (v !== null && v !== undefined && (typeof v !== "string" || v.length > LIMITS.MAX_ID_LENGTH)) {
      issues.push(issue("example", index, f, "must be string or null"));
    }
  }
  const lat = parseStrictNumber(r.latency_ms);
  if (lat === "invalid" || (typeof lat === "number" && lat < 0)) {
    issues.push(issue("example", index, "latency_ms", "must be nonnegative finite number or null"));
  }
  const cost = parseStrictNumber(r.cost);
  if (cost === "invalid" || (typeof cost === "number" && cost < 0)) {
    issues.push(issue("example", index, "cost", "must be nonnegative finite number or null"));
  }
  const cur = r.cost_currency;
  if (cur !== null && cur !== undefined && (typeof cur !== "string" || cur.length > 16)) {
    issues.push(issue("example", index, "cost_currency", "must be string or null"));
  }
  if (cost !== null && cost !== "invalid" && (cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === ""))) {
    issues.push(issue("example", index, "cost_currency", "example costs must declare their currency"));
  }
  if (issues.length > 0) return { issues };
  return {
    record: {
      run_id: (r.run_id as string).trim(),
      example_id: (r.example_id as string).trim(),
      query_text: r.query_text as string,
      predicted_cluster_id: r.predicted_cluster_id == null || (r.predicted_cluster_id as string) === "" ? null : (r.predicted_cluster_id as string),
      reference_cluster_id: r.reference_cluster_id == null || (r.reference_cluster_id as string) === "" ? null : (r.reference_cluster_id as string),
      latency_ms: lat === null ? null : (lat as number),
      cost: cost === null ? null : (cost as number),
      cost_currency: cur == null || (typeof cur === "string" && cur.trim() === "") ? null : (cur as string),
    },
    issues,
  };
}

export function validateMetricDefinition(raw: unknown, index: number): { record?: MetricDefinition; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null) return { issues: [issue("metricDefinition", index, null, "must be object")] };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.trim() === "" || r.id.length > LIMITS.MAX_ID_LENGTH) {
    issues.push(issue("metricDefinition", index, "id", "must be nonempty string"));
  }
  if (r.direction !== "higher" && r.direction !== "lower") {
    issues.push(issue("metricDefinition", index, "direction", "must be higher|lower"));
  }
  for (const f of ["name", "description", "unit", "scaleLabel"]) {
    if (typeof r[f] !== "string" || (r[f] as string).length > LIMITS.MAX_MEDIUM_STRING) {
      issues.push(issue("metricDefinition", index, f, "must be string within bounds"));
    }
  }
  if (issues.length > 0) return { issues };
  return {
    record: {
      id: (r.id as string).trim(),
      name: r.name as string,
      description: r.description as string,
      direction: r.direction as "higher" | "lower",
      unit: r.unit as string,
      scaleLabel: r.scaleLabel as string,
      minExpected: typeof r.minExpected === "number" && Number.isFinite(r.minExpected) ? r.minExpected : null,
      maxExpected: typeof r.maxExpected === "number" && Number.isFinite(r.maxExpected) ? r.maxExpected : null,
      tolerance: typeof r.tolerance === "number" && Number.isFinite(r.tolerance) ? r.tolerance : 1e-9,
      requiresMetricConfig: Array.isArray(r.requiresMetricConfig) ? (r.requiresMetricConfig as string[]) : [],
      aggregationNote: typeof r.aggregationNote === "string" ? r.aggregationNote : "",
    },
    issues,
  };
}

export function jsonDepth(v: unknown, depth = 0): number {
  if (depth > LIMITS.MAX_JSON_DEPTH + 2) return depth;
  if (Array.isArray(v)) {
    let m = depth;
    for (const item of v) m = Math.max(m, jsonDepth(item, depth + 1));
    return m;
  }
  if (typeof v === "object" && v !== null) {
    let m = depth;
    for (const k of Object.keys(v)) m = Math.max(m, jsonDepth((v as Record<string, unknown>)[k], depth + 1));
    return m;
  }
  return depth;
}
