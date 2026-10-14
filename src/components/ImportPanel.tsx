import { useMemo, useRef, useState } from "react";
import { LIMITS, formatBytes } from "../lib/limits.ts";
import { applyMapping, splitCsv, suggestMapping, tableToObjects } from "../lib/csv.ts";
import type { ColumnMapping } from "../lib/csv.ts";
import { parseExamplesCsvLocal, parseRunsCsvLocal, parseWorkspaceJsonLocal } from "../lib/importLocal.ts";
import type { LocalParseResult } from "../lib/importLocal.ts";
import { sha256Hex } from "../lib/hash.ts";
import { runImportInWorker, terminateWorker } from "../lib/workerClient.ts";
import type { ExampleRecord, ProvenanceEntry, RunMetricRecord, ValidationIssue } from "../lib/types.ts";
import { detectConflicts } from "../appState.ts";

interface PendingFile {
  filename: string;
  bytes: number;
  sha256: string;
  kind: "workspace-json" | "runs-csv" | "examples-csv";
  text: string;
  headers: string[];
  result: LocalParseResult;
  mapping?: ColumnMapping;
}

const RUN_TARGETS = [
  "run_id", "model", "model_version", "model_config_id", "dataset", "dataset_version",
  "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed", "is_synthetic",
  "metric", "score", "sample_size", "metric_config_id", "latency", "latency_basis",
  "cost", "cost_currency", "cost_basis", "cost_provenance", "work_item_count",
  "work_item_unit", "performance_context_id",
];

export function ImportPanel(props: {
  totalBytes: number;
  runCount: number;
  exampleCount: number;
  existingRunIds: string[];
  existingRuns: RunMetricRecord[];
  existingExamples: ExampleRecord[];
  onCommit: (runs: RunMetricRecord[], examples: ExampleRecord[], defs: LocalParseResult["metricDefinitions"], prov: ProvenanceEntry, remap: Record<string, string>) => string | null;
}) {
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [latencyConfirm, setLatencyConfirm] = useState("ms");
  const [costCurrency, setCostCurrency] = useState("USD");
  const [costBasis, setCostBasis] = useState("run_total");
  const [costProvenance, setCostProvenance] = useState("reported");
  const [syntheticChoice, setSyntheticChoice] = useState<"true" | "false">("false");
  const [percentConvert, setPercentConvert] = useState(false);
  const [groupIntoRuns, setGroupIntoRuns] = useState(false);
  const [groupKeys, setGroupKeys] = useState<string[]>(["model", "dataset"]);
  const [remapText, setRemapText] = useState("");
  const [confirmValidOnly, setConfirmValidOnly] = useState(false);
  const [confirmExistingRefs, setConfirmExistingRefs] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [usedWorker, setUsedWorker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const minimalMode = useMemo(() => {
    if (!pending || pending.kind !== "runs-csv") return false;
    const mappedTargets = new Set(Object.values(pending.mapping ?? mapping));
    return !mappedTargets.has("run_id") || !mappedTargets.has("evaluation_set_id");
  }, [pending, mapping]);

  async function handleFile(f: File, kind: PendingFile["kind"]) {
    setError(null);
    setPending(null);
    if (f.size > LIMITS.MAX_FILE_BYTES) {
      setError(`File ${f.name} is ${formatBytes(f.size)}; limit is ${formatBytes(LIMITS.MAX_FILE_BYTES)} per file.`);
      return;
    }
    if (props.totalBytes + f.size > LIMITS.MAX_TOTAL_BYTES) {
      setError(`Cumulative bytes would exceed ${formatBytes(LIMITS.MAX_TOTAL_BYTES)}. Current ${formatBytes(props.totalBytes)}, incoming ${formatBytes(f.size)}.`);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setIsWorking(true);
    setUsedWorker(false);
    setProgress({ done: 0, total: 100 });
    try {
      const text = await f.text();
      if (ac.signal.aborted) throw new Error("cancelled");
      const hash = await sha256Hex(text);
      const defaults = { latency_unit: "ms", latency_basis: "unknown", cost_basis: "unknown", cost_provenance: "unknown", is_synthetic: false } as Record<string, string | boolean | null>;
      let headers: string[] = [];
      let suggested: ColumnMapping | undefined;
      if (kind !== "workspace-json") {
        const table = splitCsv(text);
        headers = table.headers;
        if (kind === "runs-csv") {
          suggested = suggestMapping(table.headers);
          setMapping(suggested);
        }
      }
      let result: LocalParseResult;
      try {
        const job = await runImportInWorker(
          { kind, text, mapping: suggested, defaults },
          { filename: f.name, bytes: f.size, sha256: hash },
          (d, t) => setProgress({ done: d, total: t }),
          ac.signal,
        );
        result = {
          runs: job.runs ?? [],
          examples: job.examples ?? [],
          metricDefinitions: job.metricDefinitions ?? [],
          runIssues: job.runIssues,
          invalidRuns: job.invalidRuns,
          invalidExamples: job.invalidExamples,
          missingCompatibility: job.missingCompatibility,
          schemaVersion: job.schemaVersion,
        };
        setUsedWorker(true);
      } catch (workerErr) {
        if (ac.signal.aborted) throw workerErr;
        const onProg = (d: number, t: number) => setProgress({ done: d, total: t });
        if (kind === "workspace-json") result = parseWorkspaceJsonLocal(text);
        else if (kind === "runs-csv") result = parseRunsCsvLocal(text, suggested, defaults, onProg);
        else result = parseExamplesCsvLocal(text);
        setUsedWorker(false);
      }
      setPending({ filename: f.name, bytes: f.size, sha256: hash, kind, text, headers, result, mapping: suggested });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsWorking(false);
      setProgress(null);
    }
  }

  function reparseWithMapping() {
    if (!pending || pending.kind !== "runs-csv") return;
    try {
      const defaults = {
        latency_unit: "ms",
        latency_basis: "unknown",
        cost_basis: costBasis,
        cost_provenance: costProvenance,
        is_synthetic: syntheticChoice === "true",
      } as Record<string, string | boolean | null>;
      if (pending.mapping) {
        void 0;
      }
      const effMapping = mapping;
      let result = parseRunsCsvLocal(pending.text, effMapping, defaults);
      if (percentConvert) {
        result = {
          ...result,
          runs: result.runs.map((r) => (typeof r.score === "number" && r.score > 1 && r.score <= 100 ? { ...r, score: r.score / 100 } : r)),
        };
      }
      setPending({ ...pending, result, mapping: effMapping });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const remap: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    for (const line of remapText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [a, b] = t.split("=").map((s) => s.trim());
      if (a && b) out[a] = b;
    }
    return out;
  }, [remapText]);

  const conflicts = useMemo(() => {
    if (!pending) return null;
    return detectConflicts(props.existingRuns, pending.result.runs, props.existingExamples, pending.result.examples);
  }, [pending, props.existingRuns, props.existingExamples]);

  const groupingPreview = useMemo(() => {
    if (!pending || pending.kind !== "runs-csv" || !groupIntoRuns) return null;
    const table = (() => {
      try {
        const t = splitCsv(pending.text);
        return tableToObjects(t);
      } catch {
        return [];
      }
    })();
    const mapped = applyMapping(table, mapping);
    const groups = new Map<string, Array<Record<string, string>>>();
    for (const row of mapped) {
      const key = groupKeys.map((k) => row[k] ?? "").join("||");
      const arr = groups.get(key) ?? [];
      arr.push(row);
      groups.set(key, arr);
    }
    let contradictions = 0;
    for (const rows of groups.values()) {
      const metrics = new Set(rows.map((r) => r.metric));
      if (metrics.size !== rows.length) contradictions += 1;
    }
    return { groupCount: groups.size, rowCount: mapped.length, contradictions };
  }, [pending, groupIntoRuns, groupKeys, mapping]);

  function commit() {
    if (!pending) return;
    if (!confirmValidOnly) {
      setError("Confirm that you reviewed invalid rows and agree to import valid records only.");
      return;
    }
    if (pending.kind === "examples-csv" && pending.result.examples.some((e) => props.existingRunIds.includes(e.run_id)) && !confirmExistingRefs) {
      setError("Attaching to existing runs requires explicit confirmation of the referenced run IDs.");
      return;
    }
    if (conflicts && conflicts.conflictingRunIds.length > 0 && Object.keys(remap).length === 0) {
      setError(`Incoming run IDs conflict with existing records (${conflicts.conflictingRunIds.slice(0, 5).join(", ")}...). Provide incoming-ID remapping (old=new per line) or reject the file. Existing records are never overwritten.`);
      return;
    }
    if (conflicts && conflicts.danglingExampleRuns.length > 0) {
      setError(`Dangling example references: ${conflicts.danglingExampleRuns.slice(0, 8).join(", ")}. Each example must reference an existing run or a concurrently imported run.`);
      return;
    }
    if (groupIntoRuns && groupingPreview && groupingPreview.contradictions > 0) {
      setError("Grouped rows contradict each other (duplicate metric within a group). Fix identity columns or disable grouping.");
      return;
    }
    const conversions: string[] = [];
    if (pending.kind === "runs-csv") {
      conversions.push(`mapping=${JSON.stringify(mapping)}`);
      conversions.push(`latency_unit=${latencyConfirm}`);
      conversions.push(`cost_currency=${costCurrency};cost_basis=${costBasis};cost_provenance=${costProvenance}`);
      conversions.push(`is_synthetic=${syntheticChoice}`);
      if (percentConvert) conversions.push("percent-to-fraction score/100 (explicit user confirmation)");
      if (groupIntoRuns) conversions.push(`grouping preview only; import keeps one run per row unless grouped IDs confirmed (keys=${groupKeys.join(",")})`);
    }
    let runs = pending.result.runs;
    let examples = pending.result.examples;
    if (Object.keys(remap).length > 0) {
      runs = runs.map((r) => ({ ...r, run_id: remap[r.run_id] ?? r.run_id }));
      examples = examples.map((e) => ({ ...e, run_id: remap[e.run_id] ?? e.run_id }));
    }
    if (pending.kind === "runs-csv") {
      runs = runs.map((r) => ({
        ...r,
        cost_currency: r.cost_currency ?? (r.cost !== null ? costCurrency : null),
        cost_basis: r.cost_basis === "unknown" ? (costBasis as RunMetricRecord["cost_basis"]) : r.cost_basis,
        cost_provenance: r.cost_provenance === "unknown" ? (costProvenance as RunMetricRecord["cost_provenance"]) : r.cost_provenance,
        is_synthetic: syntheticChoice === "true" ? true : r.is_synthetic,
      }));
      if (groupIntoRuns) {
        const byGroup = new Map<string, RunMetricRecord[]>();
        for (const r of runs) {
          const k = groupKeys.map((kk) => String((r as unknown as Record<string, unknown>)[kk] ?? "")).join("||");
          const arr = byGroup.get(k) ?? [];
          arr.push(r);
          byGroup.set(k, arr);
        }
        const regrouped: RunMetricRecord[] = [];
        let counter = 1;
        for (const rows of byGroup.values()) {
          const newId = `grouped-${String(counter).padStart(3, "0")}`;
          counter += 1;
          for (const row of rows) regrouped.push({ ...row, run_id: newId });
        }
        runs = regrouped;
      }
    }
    const prov: ProvenanceEntry = {
      filename: pending.filename,
      importTimestamp: new Date().toISOString(),
      sha256: pending.sha256,
      mappings: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v])),
      conversions,
      acceptedRuns: runs.length,
      rejectedRuns: pending.result.invalidRuns.length,
      acceptedExamples: examples.length,
      rejectedExamples: pending.result.invalidExamples.length,
      importedBytes: pending.bytes,
      note: "SHA-256 is a full-file integrity fingerprint, not proof of authenticity.",
    };
    const err = props.onCommit(runs, examples, pending.result.metricDefinitions, prov, remap);
    if (err) {
      setError(err);
      return;
    }
    setPending(null);
    setRemapText("");
    setConfirmValidOnly(false);
    setConfirmExistingRefs(false);
    setGroupIntoRuns(false);
  }

  return (
    <section aria-label="Import panel" className="panel">
      <h2>Import evidence</h2>
      <p className="muted">
        Limits: {formatBytes(LIMITS.MAX_FILE_BYTES)} per file, {formatBytes(LIMITS.MAX_TOTAL_BYTES)} cumulative,{" "}
        {LIMITS.MAX_METRIC_RECORDS.toLocaleString()} metric records, {LIMITS.MAX_EXAMPLE_RECORDS.toLocaleString()} examples.
        Browser memory overhead exceeds raw file size. Parsing runs in a worker with progress; imports stay in this browser.
      </p>
      <div className="import-grid">
        <label>Canonical JSON workspace <input ref={fileRef} type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f, "workspace-json"); e.target.value = ""; }} /></label>
        <label>Long-form runs CSV <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f, "runs-csv"); e.target.value = ""; }} /></label>
        <label>Examples CSV <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f, "examples-csv"); e.target.value = ""; }} /></label>
      </div>
      {isWorking && (
        <p role="status">
          Parsing and validating… {progress ? `${progress.done}/${progress.total}` : ""} ({usedWorker ? "worker" : "trying worker, then local fallback"})
          <button type="button" onClick={() => { abortRef.current?.abort(); terminateWorker(); }}>Cancel</button>
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {!pending && (
        <details>
          <summary>Minimal legacy columns and required confirmations</summary>
          <p>Accepted minimal columns: model, dataset, metric, score, latency, cost, run_timestamp. Provide column mapping, confirm latency unit (ms), cost currency/basis/provenance, and synthetic classification. Missing comparison metadata (dataset_version, evaluation_set_id, evaluation_config_id, sample_size, metric config) stays missing; it is never inferred. Default is one generated run ID per row; grouping into multi-metric runs requires explicit identity columns plus preview.</p>
        </details>
      )}
      {pending && (
        <div className="preview">
          <h3>Preview: {pending.filename}</h3>
          <p className="muted">SHA-256 {pending.sha256.slice(0, 16)}… (integrity fingerprint only, not authenticity proof) · {formatBytes(pending.bytes)} · valid runs {pending.result.runs.length} · invalid runs {pending.result.invalidRuns.length} · valid examples {pending.result.examples.length} · invalid examples {pending.result.invalidExamples.length}</p>
          {pending.result.missingCompatibility.length > 0 && <p>Missing compatibility metadata: {pending.result.missingCompatibility.join(", ")}. These rows will be Unverified, not silently inferred.</p>}
          {conflicts && conflicts.conflictingRunIds.length > 0 && (
            <p role="alert" className="error">Conflicting run IDs with existing workspace: {conflicts.conflictingRunIds.slice(0, 10).join(", ")}. Existing records are never overwritten. Supply remapping below or reject the file. Do not assume same names mean same runs.</p>
          )}
          {pending.result.invalidRuns.slice(0, 20).map((inv, i) => (
            <p key={i} className="muted">Row {inv.index}: {inv.issues.map((x) => `${x.field ?? "row"}: ${x.reason}`).join("; ")}</p>
          ))}
          {pending.result.invalidExamples.slice(0, 20).map((inv, i) => (
            <p key={i} className="muted">Example row {inv.index}: {inv.issues.map((x) => `${x.field ?? "row"}: ${x.reason}`).join("; ")}</p>
          ))}
          {pending.kind === "runs-csv" && (
            <div className="mapping">
              <h4>Column mapping (minimal files need explicit mapping)</h4>
              {pending.headers.map((h) => (
                <label key={h} className="map-row">{h}
                  <select value={mapping[h] ?? "__ignore"} onChange={(e) => { const v = e.target.value; setMapping((m) => { const n = { ...m }; if (v === "__ignore") delete n[h]; else n[h] = v; return n; }); }}>
                    <option value="__ignore">ignore</option>
                    {RUN_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              ))}
              <div className="confirm-grid">
                <label>Latency unit confirmation
                  <select value={latencyConfirm} onChange={(e) => setLatencyConfirm(e.target.value)}>
                    <option value="ms">ms (required; other units rejected)</option>
                  </select>
                </label>
                <label>Cost currency <input value={costCurrency} onChange={(e) => setCostCurrency(e.target.value.toUpperCase().slice(0, 8))} /></label>
                <label>Cost basis
                  <select value={costBasis} onChange={(e) => setCostBasis(e.target.value)}>
                    <option value="run_total">run_total</option>
                    <option value="per_work_item">per_work_item</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>
                <label>Cost provenance
                  <select value={costProvenance} onChange={(e) => setCostProvenance(e.target.value)}>
                    <option value="reported">reported</option>
                    <option value="estimated">estimated</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>
                <fieldset><legend>Synthetic classification</legend>
                  <label><input type="radio" name="syn" checked={syntheticChoice === "false"} onChange={() => setSyntheticChoice("false")} /> non-synthetic</label>
                  <label><input type="radio" name="syn" checked={syntheticChoice === "true"} onChange={() => setSyntheticChoice("true")} /> synthetic</label>
                </fieldset>
                <label><input type="checkbox" checked={percentConvert} onChange={(e) => setPercentConvert(e.target.checked)} /> Convert scores like 82 to 0.82 (explicit percentage confirmation)</label>
              </div>
              <button type="button" onClick={reparseWithMapping}>Apply mapping and confirmations</button>
              {minimalMode && <p className="muted">Minimal import: missing evaluation_set_id / evaluation_config_id / versions keep rows Unverified for controlled comparison, but available for raw inspection.</p>}
              <details>
                <summary>Optional grouping into multi-metric runs (explicit only)</summary>
                <label><input type="checkbox" checked={groupIntoRuns} onChange={(e) => setGroupIntoRuns(e.target.checked)} /> Group rows into multi-metric runs</label>
                <label>Identity columns (comma-separated) <input value={groupKeys.join(",")} onChange={(e) => setGroupKeys(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></label>
                {groupingPreview && <p>Groups {groupingPreview.groupCount} from {groupingPreview.rowCount} rows; contradictions {groupingPreview.contradictions}. Contradictory groups are rejected.</p>}
              </details>
            </div>
          )}
          {(conflicts && (conflicts.conflictingRunIds.length > 0 || pending.kind === "examples-csv")) && (
            <div>
              <h4>Incoming-ID remapping (old=new per line; example refs remapped consistently)</h4>
              <textarea rows={3} cols={60} value={remapText} onChange={(e) => setRemapText(e.target.value)} placeholder={"demo-aurora-r1=import2-aurora-r1"} aria-label="ID remapping" />
              {pending.kind === "examples-csv" && (
                <label><input type="checkbox" checked={confirmExistingRefs} onChange={(e) => setConfirmExistingRefs(e.target.checked)} /> I confirm the referenced existing runs are the intended runs ({pending.result.examples.map((e) => e.run_id).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10).join(", ")})</label>
              )}
            </div>
          )}
          {pending.kind === "examples-csv" && pending.result.examples.some((e) => props.existingRunIds.includes(e.run_id)) && (
            <label><input type="checkbox" checked={confirmExistingRefs} onChange={(e) => setConfirmExistingRefs(e.target.checked)} /> I confirm the referenced existing runs are the intended runs</label>
          )}
          <label><input type="checkbox" checked={confirmValidOnly} onChange={(e) => setConfirmValidOnly(e.target.checked)} /> I reviewed invalid rows above; import valid records only (invalid rows are not silently discarded, they are listed here and counted in provenance)</label>
          <div className="row">
            <button type="button" onClick={commit}>Import valid records</button>
            <button type="button" onClick={() => setPending(null)}>Reject file</button>
          </div>
          <p className="muted">Issue detail (row, field, reason) retained in this preview. Synthetic status: runs in this file marked per mapping/defaults; synthetic and real never share a cohort.</p>
          {pending.result.runs.length > 0 && (
            <p className="muted">Synthetic preview: {pending.result.runs.filter((r) => r.is_synthetic).length} synthetic, {pending.result.runs.filter((r) => !r.is_synthetic).length} non-synthetic.</p>
          )}
        </div>
      )}
    </section>
  );
}

export type { ValidationIssue };
