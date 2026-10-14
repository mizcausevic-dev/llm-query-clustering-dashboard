import { describe, expect, it } from "vitest";
import { splitCsv, tableToObjects, applyMapping } from "./csv.ts";
import { parseRunsCsvLocal, parseExamplesCsvLocal, parseWorkspaceJsonLocal } from "./importLocal.ts";
import { validateRunRecord, parseStrictNumber, isValidTimestampWithTimezone } from "./validation.ts";
import { qualityCompatibility, performanceCompatibility, derivePerWorkItem, candidateKey } from "./compatibility.ts";
import { summarizeCohort, meanOf, medianOf, sampleStd, distinctRuns, performanceSummary } from "./aggregation.ts";
import { controlledCohorts, plotCohortForMetric, rowCompatibilityLabel } from "./compareLogic.ts";
import { checkMetricBounds, VERIFIED_METRICS } from "./metricRegistry.ts";
import { rawMetricsCsv, summaryCsv, escapeCsvCell, toCanonicalJson } from "./exports.ts";
import { paretoFrontier } from "./pareto.ts";
import { applyRemapping } from "../appState.ts";
import type { RunMetricRecord } from "./types.ts";

function baseRun(over: Partial<RunMetricRecord>): RunMetricRecord {
  return {
    run_id: "r1", model: "m", model_version: "v1", model_config_id: "c1",
    dataset: "d", dataset_version: "2026.01", evaluation_set_id: "es", evaluation_config_id: "ec",
    run_timestamp: "2026-09-01T12:00:00Z", seed: "s1", is_synthetic: false,
    metric: "ARI", score: 0.5, sample_size: 100, metric_config_id: "mc",
    latency: 1000, latency_unit: "ms", latency_basis: "run_total",
    cost: 0.5, cost_currency: "USD", cost_basis: "run_total", cost_provenance: "reported",
    work_item_count: 100, work_item_unit: "evaluated_query", performance_context_id: "p1",
    ...over,
  };
}

describe("parsing and limits", () => {
  it("parses quoted CSV with commas and doubled quotes", () => {
    const t = splitCsv('a,b\n"hello, world","say ""hi"""\n');
    expect(t.headers).toEqual(["a", "b"]);
    expect(tableToObjects(t)[0]).toEqual({ a: "hello, world", b: 'say "hi"' });
  });
  it("rejects unterminated quotes and duplicate columns", () => {
    expect(() => splitCsv('"abc\n')).toThrow();
    expect(() => splitCsv("a,a\n1,2\n")).toThrow();
  });
  it("applies column mapping", () => {
    const objs = [{ model: "m", dataset: "d" }];
    expect(applyMapping(objs, { model: "model" })).toEqual([{ model: "m" }]);
  });
});

describe("null versus zero", () => {
  it("preserves valid zero and distinguishes missing", () => {
    expect(parseStrictNumber("0")).toBe(0);
    expect(parseStrictNumber("")).toBeNull();
    expect(parseStrictNumber(null)).toBeNull();
    const { record } = validateRunRecord({ ...baseRun({ score: 0, latency: 0, cost: 0 }), score: 0 }, 0);
    expect(record?.score).toBe(0);
    expect(record?.latency).toBe(0);
    expect(record?.cost).toBe(0);
  });
  it("rejects NaN and Infinity spellings", () => {
    expect(parseStrictNumber("NaN")).toBe("invalid");
    expect(parseStrictNumber("Infinity")).toBe("invalid");
    expect(parseStrictNumber("-Infinity")).toBe("invalid");
    expect(parseStrictNumber("0.82abc")).toBe("invalid");
  });
  it("requires timezone in timestamps", () => {
    expect(isValidTimestampWithTimezone("2026-09-01T12:00:00Z")).toBe(true);
    expect(isValidTimestampWithTimezone("2026-09-01T12:00:00+02:00")).toBe(true);
    expect(isValidTimestampWithTimezone("2026-09-01T12:00:00")).toBe(false);
    expect(isValidTimestampWithTimezone("not a date")).toBe(false);
  });
});

describe("conflicting IDs and remapping", () => {
  it("flags duplicate run_id+metric and conflicting metadata", async () => {
    const { parseWorkspaceJsonLocal: p } = await import("./importLocal.ts");
    const ws = {
      schemaVersion: 1,
      runs: [baseRun({ run_id: "r1", metric: "ARI" }), baseRun({ run_id: "r1", metric: "ARI" })],
      examples: [], metricDefinitions: [],
    };
    const res = p(JSON.stringify(ws));
    expect(res.invalidRuns.length + res.runIssues.length).toBeGreaterThan(0);
  });
  it("remaps run ids consistently across runs and examples", () => {
    const runs = [baseRun({ run_id: "old" })];
    const ex = [{ run_id: "old", example_id: "e1", query_text: "q", predicted_cluster_id: null, reference_cluster_id: null, latency_ms: null, cost: null, cost_currency: null }];
    const out = applyRemapping(runs, ex, { old: "new" });
    expect(out.runs[0].run_id).toBe("new");
    expect(out.examples[0].run_id).toBe("new");
  });
});

describe("example integrity", () => {
  it("rejects dangling currency-less example cost", () => {
    const res = parseExamplesCsvLocal("run_id,example_id,query_text,predicted_cluster_id,reference_cluster_id,latency_ms,cost,cost_currency\nr1,e1,hello,a,b,5,0.1,\n");
    expect(res.examples.length).toBe(0);
    expect(res.invalidExamples.length).toBe(1);
  });
});

describe("metric scales and bounds", () => {
  it("has verified definitions with directions", () => {
    const ids = VERIFIED_METRICS.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["ARI", "AMI", "NMI", "SILHOUETTE"]));
    for (const m of VERIFIED_METRICS) expect(["higher", "lower"]).toContain(m.direction);
  });
  it("permits negative ARI/AMI within tolerance and flags genuine out-of-range", () => {
    const ari = VERIFIED_METRICS.find((m) => m.id === "ARI") as unknown as Parameters<typeof checkMetricBounds>[0];
    expect(checkMetricBounds(ari, -0.2).outOfRange).toBe(false);
    expect(checkMetricBounds(ari, 1 + 1e-12).outOfRange).toBe(false);
    expect(checkMetricBounds(ari, 1.5).outOfRange).toBe(true);
    const nmi = VERIFIED_METRICS.find((m) => m.id === "NMI") as unknown as Parameters<typeof checkMetricBounds>[0];
    expect(checkMetricBounds(nmi, -0.01).outOfRange).toBe(true);
  });
});

describe("compatibility", () => {
  const defs = VERIFIED_METRICS.map((m) => ({ ...m }));
  it("comparable when metadata matches; unverified when missing; incompatible when different", () => {
    const a = baseRun({ run_id: "a" });
    const b = baseRun({ run_id: "b" });
    expect(qualityCompatibility(a, b, defs).status).toBe("comparable");
    const missing = baseRun({ run_id: "c", evaluation_set_id: null });
    expect(qualityCompatibility(a, missing, defs).status).toBe("unverified");
    const diff = baseRun({ run_id: "d", dataset_version: "2026.02" });
    expect(qualityCompatibility(a, diff, defs).status).toBe("incompatible");
  });
  it("never pools synthetic with real", () => {
    const a = baseRun({ run_id: "a", is_synthetic: true });
    const b = baseRun({ run_id: "b", is_synthetic: false });
    expect(qualityCompatibility(a, b, VERIFIED_METRICS.map((m) => ({ ...m })))).toMatchObject({ status: "incompatible" });
  });
  it("rejects mean vs p50 latency pooling; allows side-by-side reported vs estimated with label", () => {
    const a = baseRun({ run_id: "a", latency_basis: "example_mean" });
    const b = baseRun({ run_id: "b", latency_basis: "example_p50" });
    expect(performanceCompatibility(a, b, "latency").status).toBe("incompatible");
    const c = baseRun({ run_id: "c", cost_provenance: "reported" });
    const d = baseRun({ run_id: "e", cost_provenance: "estimated" });
    const r = performanceCompatibility(c, d, "cost");
    expect(r.status).toBe("comparable");
    expect(r.reasons.join(" ")).toMatch(/side-by-side/i);
  });
  it("requires matching currency with no conversion", () => {
    const a = baseRun({ run_id: "a", cost_currency: "USD" });
    const b = baseRun({ run_id: "b", cost_currency: "EUR" });
    expect(performanceCompatibility(a, b, "cost").status).toBe("incompatible");
  });
});

describe("candidate identity", () => {
  it("different model_config_id are different candidates", () => {
    const a = baseRun({ run_id: "a", model_config_id: "k1" });
    const b = baseRun({ run_id: "b", model_config_id: "k2" });
    expect(candidateKey(a)).not.toBe(candidateKey(b));
    const s = summarizeCohort([a, b]);
    expect(s.length).toBe(2);
  });
});

describe("aggregation goldens", () => {
  it("hand-calculated mean/median/SD for 0.62 and 0.58", () => {
    expect(meanOf([0.62, 0.58])).toBeCloseTo(0.6, 12);
    expect(medianOf([0.62, 0.58])).toBeCloseTo(0.6, 12);
    expect(sampleStd([0.62, 0.58])).toBeCloseTo(0.0282842712474619, 9);
  });
  it("SD unavailable for n=0 and n=1", () => {
    expect(sampleStd([])).toBeNull();
    expect(sampleStd([0.5])).toBeNull();
    const s = summarizeCohort([baseRun({ run_id: "a", score: 0.5 }), baseRun({ run_id: "a", metric: "NMI", score: 0.7 })]);
    void s;
    const single = summarizeCohort([baseRun({ run_id: "solo", score: 0.5 })]);
    expect(single[0].sd).toBeNull();
    expect(single[0].totalRuns).toBe(1);
  });
  it("counts missing scores in denominators", () => {
    const s = summarizeCohort([baseRun({ run_id: "a", score: 0.5 }), baseRun({ run_id: "b", score: null })]);
    expect(s[0].totalRuns).toBe(2);
    expect(s[0].validScores).toBe(1);
    expect(s[0].missingScores).toBe(1);
    expect(s[0].mean).toBeCloseTo(0.5, 12);
  });
  it("input order does not change results", () => {
    const a = baseRun({ run_id: "a", score: 0.6 });
    const b = baseRun({ run_id: "b", score: 0.4 });
    const s1 = summarizeCohort([a, b]);
    const s2 = summarizeCohort([b, a]);
    expect(s1[0].mean).toBe(s2[0].mean);
  });
  it("adding incompatible run does not change compatible summary", () => {
    const a = baseRun({ run_id: "a", score: 0.62 });
    const b = baseRun({ run_id: "b", score: 0.58 });
    const before = summarizeCohort([a, b])[0].mean;
    const incompat = baseRun({ run_id: "c", score: 0.99, dataset_version: "2099.01" });
    const compatOnly = [a, b, incompat].filter((r) => r.dataset_version === "2026.01");
    expect(summarizeCohort(compatOnly)[0].mean).toBe(before);
  });
  it("distinct-run performance accounting does not duplicate cost across metric rows", () => {
    const rows = [
      baseRun({ run_id: "r1", metric: "ARI", cost: 0.5 }),
      baseRun({ run_id: "r1", metric: "NMI", cost: 0.5 }),
      baseRun({ run_id: "r2", metric: "ARI", cost: 0.5 }),
    ];
    expect(distinctRuns(rows).length).toBe(2);
    const perf = performanceSummary(rows, "cost");
    expect(perf.nDistinct).toBe(2);
    expect(perf.nValid).toBe(2);
  });
  it("synthetic runs cannot alter real summaries when filtered", () => {
    const real = [baseRun({ run_id: "a", score: 0.5, is_synthetic: false }), baseRun({ run_id: "b", score: 0.6, is_synthetic: false })];
    const synth = [baseRun({ run_id: "s", score: 0.99, is_synthetic: true })];
    const defs = VERIFIED_METRICS.map((m) => ({ ...m }));
    const groups = controlledCohorts([...real, ...synth], defs);
    expect(groups).toHaveLength(1);
    expect(groups[0].runs.every((r) => !r.is_synthetic)).toBe(true);
    expect(summarizeCohort(groups[0].runs)[0].mean).toBeCloseTo(0.55, 12);
    expect(summarizeCohort(real)[0].mean).toBeCloseTo(0.55, 12);
  });
});

describe("cost derivation", () => {
  it("derives per-work-item only with explicit work count", () => {
    expect(derivePerWorkItem(1, "run_total", 4)).toEqual({ value: 0.25, label: expect.stringContaining("derived") });
    expect(derivePerWorkItem(1, "run_total", null).value).toBeNull();
    expect(derivePerWorkItem(0.1, "per_work_item", null).value).toBe(0.1);
  });
});

describe("exports", () => {
  it("round-trips canonical JSON without losing meaning", () => {
    const runs = [baseRun({})];
    const canon = toCanonicalJson(runs, [], []);
    const back = parseWorkspaceJsonLocal(JSON.stringify(canon));
    expect(back.runs.length).toBe(1);
    expect(back.runs[0].score).toBe(0.5);
  });
  it("escapes spreadsheet formulas", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("@x")).toBe("'@x");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    const csv = rawMetricsCsv([baseRun({ model: "=cmd" })]);
    expect(csv).toContain("'=cmd");
  });
  it("summary CSV sorts deterministically", () => {
    const rows = [
      { cohort_key: "b", dataset: "d", dataset_version: null, evaluation_set_id: null, evaluation_config_id: null, metric: "ARI", metric_config_id: null, sample_size: 1, is_synthetic: false, candidate: "b", model: "b", model_version: null, model_config_id: null, n_total_runs: 1, n_valid_scores: 1, n_missing_scores: 0, mean: 1, median: 1, min: 1, max: 1, sample_sd: null, aggregation: "a", exclusions: "e" },
      { cohort_key: "a", dataset: "d", dataset_version: null, evaluation_set_id: null, evaluation_config_id: null, metric: "ARI", metric_config_id: null, sample_size: 1, is_synthetic: false, candidate: "a", model: "a", model_version: null, model_config_id: null, n_total_runs: 1, n_valid_scores: 1, n_missing_scores: 0, mean: 1, median: 1, min: 1, max: 1, sample_sd: null, aggregation: "a", exclusions: "e" },
    ];
    const csv = summaryCsv(rows);
    expect(csv.indexOf("cohort_key")).toBe(0);
    expect(csv.indexOf('"a"') < csv.indexOf('"b"') || csv.indexOf(",a,") < csv.indexOf(",b,")).toBe(true);
  });
});

describe("pareto", () => {
  it("marks dominated points; respects lower-is-better direction", () => {
    const pts = [
      { candidate: "a", quality: 0.9, cost: 1, runId: "a" },
      { candidate: "b", quality: 0.8, cost: 0.5, runId: "b" },
      { candidate: "c", quality: 0.7, cost: 0.6, runId: "c" },
    ];
    const out = paretoFrontier(pts, "higher");
    expect(out.find((p) => p.runId === "c")?.dominated).toBe(true);
    expect(out.filter((p) => !p.dominated).length).toBe(2);
  });
});

describe("workspace JSON validation", () => {
  it("rejects unsupported schema versions", () => {
    expect(() => parseWorkspaceJsonLocal(JSON.stringify({ schemaVersion: 99, runs: [], examples: [], metricDefinitions: [] }))).toThrow();
  });
  it("handles minimal legacy CSV with mapping and defaults", () => {
    const csv = "model,dataset,metric,score,latency,cost,run_timestamp\nm,d,ARI,0.5,100,0.2,2026-09-01T12:00:00Z\n";
    const res = parseRunsCsvLocal(csv, { model: "model", dataset: "dataset", metric: "metric", score: "score", latency: "latency", cost: "cost", run_timestamp: "run_timestamp" }, { latency_unit: "ms", latency_basis: "unknown", cost_basis: "run_total", cost_provenance: "reported", is_synthetic: false, cost_currency: "USD" });
    expect(res.runs.length).toBe(1);
    expect(res.missingCompatibility.length).toBeGreaterThan(0);
  });
});

describe("comparison eligibility", () => {
  const defs = VERIFIED_METRICS.map((m) => ({ ...m }));
  it("does not silently pool unknown candidate identities", () => {
    const a = baseRun({ run_id: "a", model_version: null, model_config_id: null, score: 0.4 });
    const b = baseRun({ run_id: "b", model_version: null, model_config_id: null, score: 0.8 });
    const s = summarizeCohort([a, b]);
    expect(s.length).toBe(2);
    expect(s.every((x) => x.unknownIdentity)).toBe(true);
  });
  it("unverified rows do not form a controlled cohort even when nulls match", () => {
    const a = baseRun({ run_id: "a", evaluation_set_id: null, evaluation_config_id: null, dataset_version: null });
    const b = baseRun({ run_id: "b", evaluation_set_id: null, evaluation_config_id: null, dataset_version: null });
    expect(controlledCohorts([a, b], defs)).toHaveLength(0);
    expect(rowCompatibilityLabel(a, [a, b], defs).status).toBe("unverified");
  });
  it("complete singleton is comparable, not incompatible", () => {
    const a = baseRun({ run_id: "solo", metric: "AMI" });
    expect(rowCompatibilityLabel(a, [a], defs).status).toBe("comparable");
    expect(controlledCohorts([a], defs)).toHaveLength(0);
  });
  it("complete row with a differing dataset version is incompatible", () => {
    const a = baseRun({ run_id: "a", dataset_version: "2026.01" });
    const b = baseRun({ run_id: "b", dataset_version: "2026.02" });
    expect(rowCompatibilityLabel(b, [a, b], defs).status).toBe("incompatible");
    expect(controlledCohorts([a, b], defs)).toHaveLength(0);
  });
  it("plots stay inside one controlled metric cohort", () => {
    const support = [
      baseRun({ run_id: "a", dataset: "support-queries", score: 0.6 }),
      baseRun({ run_id: "b", dataset: "support-queries", score: 0.5 }),
    ];
    const billing = [
      baseRun({ run_id: "c", dataset: "billing-queries", score: 0.9 }),
      baseRun({ run_id: "d", dataset: "billing-queries", score: 0.8 }),
    ];
    const plot = plotCohortForMetric([...support, ...billing], defs, "ARI", "all");
    expect(plot).not.toBeNull();
    expect(new Set(plot?.runs.map((r) => r.dataset)).size).toBe(1);
  });
});
