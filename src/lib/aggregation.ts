import type { RunMetricRecord } from "./types.ts";
import { candidateKey } from "./compatibility.ts";

export interface CandidateSummary {
  candidateKey: string;
  label: string;
  model: string;
  model_version: string | null;
  model_config_id: string | null;
  totalRuns: number;
  validScores: number;
  missingScores: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sd: number | null;
  scores: number[];
  runIds: string[];
  seeds: Array<string | null>;
  timestamps: string[];
  unknownIdentity: boolean;
}

export function meanOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

export function sampleStd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = meanOf(xs) as number;
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

export function summarizeCohort(
  runs: RunMetricRecord[],
  labelFor: (r: RunMetricRecord) => string = (r) => r.model,
): CandidateSummary[] {
  const groups = new Map<string, RunMetricRecord[]>();
  const order: string[] = [];
  for (const r of runs) {
    const k = candidateKey(r);
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)?.push(r);
  }
  order.sort();
  return order.map((k) => {
    const rows = (groups.get(k) ?? []).slice().sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0));
    const scores = rows.map((r) => r.score).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
    const first = rows[0];
    return {
      candidateKey: k,
      label: labelFor(first),
      model: first.model,
      model_version: first.model_version,
      model_config_id: first.model_config_id,
      totalRuns: new Set(rows.map((r) => r.run_id)).size,
      validScores: scores.length,
      missingScores: rows.length - scores.length,
      mean: meanOf(scores),
      median: medianOf(scores),
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      sd: sampleStd(scores),
      scores: [...scores].sort((a, b) => a - b),
      runIds: rows.map((r) => r.run_id),
      seeds: [...new Set(rows.map((r) => r.seed))],
      timestamps: [...new Set(rows.map((r) => r.run_timestamp))].sort(),
      unknownIdentity: first.model_version === null || first.model_config_id === null,
    };
  });
}

export function distinctRuns(runs: RunMetricRecord[]): RunMetricRecord[] {
  const seen = new Map<string, RunMetricRecord>();
  for (const r of runs) {
    if (!seen.has(r.run_id)) seen.set(r.run_id, r);
  }
  return [...seen.values()].sort((a, b) => (a.run_id < b.run_id ? -1 : 1));
}

export function performanceSummary(
  runs: RunMetricRecord[],
  field: "latency" | "cost",
): { nDistinct: number; nValid: number; nMissing: number; mean: number | null; median: number | null; min: number | null; max: number | null; sd: number | null } {
  const distinct = distinctRuns(runs);
  const vals = distinct.map((r) => (field === "latency" ? r.latency : r.cost)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    nDistinct: distinct.length,
    nValid: vals.length,
    nMissing: distinct.length - vals.length,
    mean: meanOf(vals),
    median: medianOf(vals),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    sd: sampleStd(vals),
  };
}
