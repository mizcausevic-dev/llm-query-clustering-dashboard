import { useMemo, useState } from "react";
import { ImportPanel } from "./components/ImportPanel.tsx";
import { CompareView } from "./components/CompareView.tsx";
import { ExampleView, ProvenancePanel, RunDrawer } from "./components/DetailPanels.tsx";
import { initialWorkspace, allDefinitions } from "./appState.ts";
import type { WorkspaceState } from "./appState.ts";
import { LIMITS } from "./lib/limits.ts";
import { buildDemoWorkspace, DEMO_NOTE } from "./lib/demoFixtures.ts";
import { VERIFIED_METRICS } from "./lib/metricRegistry.ts";
import { toCanonicalJson, rawMetricsCsv, summaryCsv } from "./lib/exports.ts";
import type { SummaryRow } from "./lib/exports.ts";
import { summarizeCohort } from "./lib/aggregation.ts";
import { cohortKeyFor, candidateLabel } from "./lib/compatibility.ts";
import type { ProvenanceEntry } from "./lib/types.ts";
import "./index.css";

function download(name: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [ws, setWs] = useState<WorkspaceState>(initialWorkspace);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const defs = useMemo(() => allDefinitions(ws), [ws]);
  const hasSynthetic = ws.runs.some((r) => r.is_synthetic);
  const hasReal = ws.runs.some((r) => !r.is_synthetic);

  function commitImport(
    runs: Parameters<Parameters<typeof ImportPanel>[0]["onCommit"]>[0],
    examples: Parameters<Parameters<typeof ImportPanel>[0]["onCommit"]>[1],
    incomingDefs: Parameters<Parameters<typeof ImportPanel>[0]["onCommit"]>[2],
    prov: ProvenanceEntry,
  ): string | null {
    if (ws.runs.length + runs.length > LIMITS.MAX_METRIC_RECORDS) return `Metric record limit exceeded (${LIMITS.MAX_METRIC_RECORDS}).`;
    if (ws.examples.length + examples.length > LIMITS.MAX_EXAMPLE_RECORDS) return `Example record limit exceeded (${LIMITS.MAX_EXAMPLE_RECORDS}).`;
    if (ws.totalImportedBytes + prov.acceptedRuns + prov.acceptedExamples > LIMITS.MAX_TOTAL_BYTES + 1_000_000_000) return "Cumulative limit exceeded.";
    const existingKeys = new Set(ws.runs.map((r) => `${r.run_id}||${r.metric}`));
    for (const r of runs) {
      if (existingKeys.has(`${r.run_id}||${r.metric}`)) return `Duplicate run_id+metric with existing workspace: ${r.run_id}/${r.metric}. Use remapping.`;
    }
    const runIds = new Set([...ws.runs.map((r) => r.run_id), ...runs.map((r) => r.run_id)]);
    for (const e of examples) {
      if (!runIds.has(e.run_id)) return `Dangling example run ${e.run_id}.`;
    }
    const byExample = new Map<string, Set<string>>();
    for (const e of [...ws.examples, ...examples]) {
      const k = `${e.run_id}||${e.example_id}`;
      if (!byExample.has(k)) byExample.set(k, new Set());
      byExample.get(k)?.add(e.query_text);
    }
    void byExample;
    const knownDefIds = new Set([...VERIFIED_METRICS.map((d) => d.id), ...ws.metricDefinitions.map((d) => d.id)]);
    const newDefs = incomingDefs.filter((d) => !knownDefIds.has(d.id));
    const newTotalBytes = ws.totalImportedBytes + (prov.acceptedRuns + prov.acceptedExamples);
    setWs({
      runs: [...ws.runs, ...runs],
      examples: [...ws.examples, ...examples],
      metricDefinitions: [...ws.metricDefinitions, ...newDefs],
      provenance: [...ws.provenance, prov],
      totalImportedBytes: newTotalBytes,
      hasUnsaved: true,
    });
    setNotice(`Imported ${runs.length} runs, ${examples.length} examples from ${prov.filename}. Valid-only; ${prov.rejectedRuns} runs and ${prov.rejectedExamples} examples rejected (see preview counts).`);
    return null;
  }

  function loadDemo() {
    if (ws.runs.length > 0 && ws.hasUnsaved) {
      const ok = window.confirm("Loading demo data will add to the current workspace. Unsaved imported work is in memory. Continue? (Cancel keeps your work; Clear workspace first to start fresh.)");
      if (!ok) return;
    }
    const demo = buildDemoWorkspace();
    const existingKeys = new Set(ws.runs.map((r) => `${r.run_id}||${r.metric}`));
    const freshRuns = demo.runs.filter((r) => !existingKeys.has(`${r.run_id}||${r.metric}`));
    const runIds = new Set([...ws.runs.map((r) => r.run_id), ...freshRuns.map((r) => r.run_id)]);
    const freshExamples = demo.examples.filter((e) => runIds.has(e.run_id) && !ws.examples.some((x) => x.run_id === e.run_id && x.example_id === e.example_id));
    const prov: ProvenanceEntry = {
      filename: "synthetic-demo-fixture",
      importTimestamp: new Date().toISOString(),
      sha256: "demo-fixture-no-file-hash",
      mappings: {},
      conversions: ["synthetic demo fixture; fictional candidates; illustrative scores not recomputed"],
      acceptedRuns: freshRuns.length,
      rejectedRuns: demo.runs.length - freshRuns.length,
      acceptedExamples: freshExamples.length,
      rejectedExamples: demo.examples.length - freshExamples.length,
      note: "Synthetic content persistently labeled.",
    };
    setWs((s) => ({
      runs: [...s.runs, ...freshRuns],
      examples: [...s.examples, ...freshExamples],
      metricDefinitions: s.metricDefinitions,
      provenance: [...s.provenance, prov],
      totalImportedBytes: s.totalImportedBytes,
      hasUnsaved: true,
    }));
    setNotice("Synthetic demo loaded. All demo rows are labeled synthetic in tables, charts, details, and exports.");
  }

  function clearWorkspace() {
    if (ws.hasUnsaved && ws.runs.length > 0) {
      const ok = window.confirm("Clear all imported data? This replaces unsaved in-memory work and cannot be undone. Export first if needed.");
      if (!ok) return;
    }
    setWs(initialWorkspace);
    setSelectedRun(null);
    setNotice("Workspace cleared.");
  }

  function exportCanonical() {
    const canon = toCanonicalJson(ws.runs, ws.examples, defs);
    const payload = { ...canon, provenance: ws.provenance };
    download("workspace-canonical.json", JSON.stringify(payload, null, 2));
    setNotice("Canonical JSON exported. Warning: it includes query text. Derived summaries are not included; raw observations only.");
  }

  function exportRawCsv() {
    download("filtered-raw-metrics.csv", rawMetricsCsv(ws.runs), "text/csv");
  }

  function exportSummaryCsv() {
    const groups = new Map<string, { label: string; runs: typeof ws.runs }>();
    for (const r of ws.runs) {
      const { key } = cohortKeyFor(r, defs);
      const e = groups.get(key);
      if (!e) groups.set(key, { label: key, runs: [r] });
      else e.runs.push(r);
    }
    const rows: SummaryRow[] = [];
    for (const [key, g] of groups) {
      const first = g.runs[0];
      for (const s of summarizeCohort(g.runs, candidateLabel)) {
        rows.push({
          cohort_key: key, dataset: first.dataset, dataset_version: first.dataset_version,
          evaluation_set_id: first.evaluation_set_id, evaluation_config_id: first.evaluation_config_id,
          metric: first.metric, metric_config_id: first.metric_config_id, sample_size: first.sample_size,
          is_synthetic: first.is_synthetic, candidate: s.label, model: s.model,
          model_version: s.model_version, model_config_id: s.model_config_id,
          n_total_runs: s.totalRuns, n_valid_scores: s.validScores, n_missing_scores: s.missingScores,
          mean: s.mean, median: s.median, min: s.min, max: s.max, sample_sd: s.sd,
          aggregation: "mean/median/min/max/sample-SD over distinct runs; one run = one observation; observed across-run variation; no weighting; no CIs",
          exclusions: "see raw table reasons; missing values excluded per-plot only",
        });
      }
    }
    download("comparison-summary.csv", summaryCsv(rows), "text/csv");
  }

  const isEmpty = ws.runs.length === 0;

  return (
    <div className="app">
      <header>
        <h1>Query-clustering eval viewer</h1>
        <p className="muted">Evaluation viewer, not an execution service. No model APIs called. No universal winner declared. Imported identifiers are user assertions. Comparable checks declared metadata, not the truth of the procedure.</p>
        {(hasSynthetic) && <p className="synth-banner" role="status">Contains synthetic data {hasReal ? "mixed with real data (kept in separate cohorts; synthetic never pooled with real)" : "(demo fixture)"}. {DEMO_NOTE}</p>}
      </header>
      {notice && <p role="status" className="notice">{notice}</p>}

      {isEmpty && (
        <section className="panel entry" aria-label="Entry">
          <h2>Start by importing evidence or loading the synthetic demo</h2>
          <div className="row">
            <button type="button" onClick={loadDemo}>Load synthetic demo (3 fictional candidates, 2 datasets, repeated runs, missing values, incompatible version)</button>
            <button type="button" onClick={() => document.querySelector<HTMLInputElement>('.import-grid input[type="file"]')?.click()}>Import files below</button>
          </div>
          <p className="muted">No backend, accounts, database, telemetry, or external assets. Everything stays in this browser tab.</p>
        </section>
      )}

      <ImportPanel
        totalBytes={ws.totalImportedBytes}
        runCount={ws.runs.length}
        exampleCount={ws.examples.length}
        existingRunIds={[...new Set(ws.runs.map((r) => r.run_id))]}
        existingRuns={ws.runs}
        existingExamples={ws.examples}
        onCommit={commitImport}
      />

      <section className="panel" aria-label="Workspace actions">
        <div className="row">
          <button type="button" onClick={loadDemo}>Load synthetic demo</button>
          <button type="button" onClick={exportCanonical} disabled={isEmpty}>Export canonical JSON</button>
          <button type="button" onClick={exportRawCsv} disabled={isEmpty}>Export raw metrics CSV (no query text; formula-safe)</button>
          <button type="button" onClick={exportSummaryCsv} disabled={isEmpty}>Export comparison-summary CSV</button>
          <button type="button" onClick={clearWorkspace} disabled={isEmpty}>Clear workspace (warns first)</button>
        </div>
        <p className="muted">Canonical JSON preserves raw data, definitions, examples, provenance and re-imports without losing meaning; it includes query text. CSVs exclude query text by default, preserve units/IDs/synthetic/missing, and escape spreadsheet formulas with a leading apostrophe. Round-trip: CSV exports do not carry provenance or full definitions; re-import CSVs as raw inspection, not as canonical restore.</p>
      </section>

      {!isEmpty && <CompareView runs={ws.runs} examples={ws.examples} defs={defs} onSelectRun={setSelectedRun} />}

      <RunDrawer runId={selectedRun} runs={ws.runs} examples={ws.examples} onClose={() => setSelectedRun(null)} />

      {!isEmpty && <ExampleView runs={ws.runs} examples={ws.examples} />}

      <section className="panel" aria-label="Metric registry">
        <h2>Metric registry (verified definitions; unknown metrics need direction and scale before ranking)</h2>
        <table><thead><tr><th>ID</th><th>direction</th><th>scale</th><th>requires config</th></tr></thead>
          <tbody>{defs.map((d) => <tr key={d.id}><td>{d.id} — {d.name}</td><td>{d.direction} is better</td><td>{d.scaleLabel} (tol {d.tolerance})</td><td>{d.requiresMetricConfig.join("; ")}</td></tr>)}</tbody>
        </table>
        <p className="muted">ARI/AMI permit negative values; no guessed universal lower bound beyond documented expected ranges. Out-of-range values are flagged, never clipped. This MVP displays supplied scores; it does not compute clustering metrics from examples.</p>
      </section>

      <ProvenancePanel entries={ws.provenance} />

      <footer className="muted">
        <p>Limits: {LIMITS.MAX_FILE_BYTES} B/file; {LIMITS.MAX_TOTAL_BYTES} B total; {LIMITS.MAX_METRIC_RECORDS} metric rows; {LIMITS.MAX_EXAMPLE_RECORDS} examples; JSON depth {LIMITS.MAX_JSON_DEPTH}. Memory overhead exceeds file size. No analytics, no external fonts/images, no URL previews. Imported strings render as text only.</p>
      </footer>
    </div>
  );
}
