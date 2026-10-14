import { useMemo } from "react";
import type { ExampleRecord, ProvenanceEntry, RunMetricRecord } from "../lib/types.ts";
import { candidateLabel } from "../lib/compatibility.ts";
import { formatNum } from "../appState.ts";

export function RunDrawer(props: { runId: string | null; runs: RunMetricRecord[]; examples: ExampleRecord[]; onClose: () => void }) {
  const rows = useMemo(() => props.runs.filter((r) => r.run_id === props.runId), [props.runs, props.runId]);
  const ex = useMemo(() => props.examples.filter((e) => e.run_id === props.runId), [props.examples, props.runId]);
  if (!props.runId) return null;
  const first = rows[0];
  return (
    <div role="dialog" aria-label={`Run details ${props.runId}`} className="drawer" onKeyDown={(e) => { if (e.key === "Escape") props.onClose(); }}>
      <div className="drawer-head"><h3>Run {props.runId} {first?.is_synthetic ? "(synthetic)" : "(real)"}</h3><button type="button" onClick={props.onClose} autoFocus>Close (Esc)</button></div>
      {!first && <p>No such run in workspace.</p>}
      {first && (
        <dl className="kv">
          <dt>candidate</dt><dd>{candidateLabel(first)} (model={first.model}, version={first.model_version ?? "missing"}, config={first.model_config_id ?? "missing"})</dd>
          <dt>dataset</dt><dd>{first.dataset}@{first.dataset_version ?? "missing"}; eval_set={first.evaluation_set_id ?? "missing"}; eval_config={first.evaluation_config_id ?? "missing"}</dd>
          <dt>timestamp/seed</dt><dd>{first.run_timestamp}; seed={first.seed ?? "missing"}</dd>
          <dt>performance</dt><dd>latency={first.latency ?? "missing"} ms ({first.latency_basis}); cost={first.cost ?? "missing"} {first.cost_currency ?? ""} ({first.cost_basis}/{first.cost_provenance}); work={first.work_item_count ?? "missing"} {first.work_item_unit ?? ""}; ctx={first.performance_context_id ?? "missing"}</dd>
        </dl>
      )}
      <table aria-label="Metrics for run"><thead><tr><th>metric</th><th>score</th><th>n</th><th>config</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.metric}><td>{r.metric}</td><td>{r.score === null ? "missing" : r.score}</td><td>{r.sample_size ?? "missing"}</td><td>{r.metric_config_id ?? "missing"}</td></tr>)}</tbody>
      </table>
      <p className="muted">Supplied examples: {ex.length}. Declared metric sample sizes above may use different subsets; examples do not necessarily cover the whole evaluation.</p>
    </div>
  );
}

export function ExampleView(props: { runs: RunMetricRecord[]; examples: ExampleRecord[] }) {
  const byRun = useMemo(() => {
    const m = new Map<string, ExampleRecord[]>();
    for (const e of props.examples) {
      const arr = m.get(e.run_id) ?? [];
      arr.push(e);
      m.set(e.run_id, arr);
    }
    return m;
  }, [props.examples]);

  const textConflicts = useMemo(() => {
    const byEvalExample = new Map<string, Map<string, Set<string>>>();
    const runEval = new Map(props.runs.map((r) => [r.run_id, r.evaluation_set_id ?? "__missing__"]));
    for (const e of props.examples) {
      const evalId = runEval.get(e.run_id) ?? "__missing__";
      const key = `${evalId}||${e.example_id}`;
      if (!byEvalExample.has(key)) byEvalExample.set(key, new Map());
      const inner = byEvalExample.get(key) as Map<string, Set<string>>;
      if (!inner.has(e.query_text)) inner.set(e.query_text, new Set());
      inner.get(e.query_text)?.add(e.run_id);
    }
    return [...byEvalExample.entries()].filter(([, m]) => m.size > 1).map(([k]) => k);
  }, [props.examples, props.runs]);

  if (props.examples.length === 0) return <section className="panel" aria-label="Examples"><h2>Example drill-down</h2><p>Example data not supplied.</p></section>;

  return (
    <section className="panel" aria-label="Examples">
      <h2>Example drill-down (supplied query text and cluster assignments only)</h2>
      {textConflicts.length > 0 && <p role="alert">Inconsistent query_text for same evaluation-set/example ID: {textConflicts.slice(0, 5).join("; ")}. Example IDs are matched across runs only within the same declared evaluation set.</p>}
      <p className="muted">Cluster IDs are arbitrary labels; do not compare label numbers as semantic identities. Do not infer example-level quality from run-level metrics.</p>
      {[...byRun.entries()].sort().map(([runId, list]) => {
        const byCluster = new Map<string, ExampleRecord[]>();
        for (const e of list) {
          const k = e.predicted_cluster_id ?? "(unassigned)";
          const arr = byCluster.get(k) ?? [];
          arr.push(e);
          byCluster.set(k, arr);
        }
        return (
          <details key={runId}>
            <summary>{runId} — {list.length} supplied examples</summary>
            {[...byCluster.entries()].sort().map(([cluster, items]) => (
              <div key={cluster}>
                <h4>predicted cluster {cluster} ({items.length})</h4>
                <ul>{items.sort((a, b) => (a.example_id < b.example_id ? -1 : 1)).slice(0, 200).map((e) => <li key={e.example_id}><strong>{e.example_id}</strong>: {e.query_text} (ref {e.reference_cluster_id ?? "—"})</li>)}</ul>
            {items.length > 200 && <p className="muted">Showing first 200 of {items.length} examples in this cluster. Export canonical JSON for the full supplied set.</p>}
              </div>
            ))}
          </details>
        );
      })}
      <p className="muted">Mean example latency example: {formatNum(meanOrNull(props.examples.map((e) => e.latency_ms)))} ms (example-level distribution, kept separate from run-level scores).</p>
    </section>
  );
}

function meanOrNull(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => typeof x === "number");
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function ProvenancePanel(props: { entries: ProvenanceEntry[] }) {
  if (props.entries.length === 0) return <section className="panel" aria-label="Provenance"><h2>Provenance</h2><p>No imports yet.</p></section>;
  return (
    <section className="panel" aria-label="Provenance">
      <h2>Import validation and provenance</h2>
      <table><thead><tr><th>file</th><th>imported at</th><th>sha256</th><th>accepted</th><th>rejected</th><th>conversions</th></tr></thead>
        <tbody>{props.entries.map((p, i) => <tr key={i}><td>{p.filename}</td><td>{p.importTimestamp}</td><td title={p.sha256}>{p.sha256.slice(0, 16)}…</td><td>runs {p.acceptedRuns}, examples {p.acceptedExamples}</td><td>runs {p.rejectedRuns}, examples {p.rejectedExamples}</td><td>{p.conversions.join("; ") || "—"}</td></tr>)}</tbody>
      </table>
      <p className="muted">File hash is an integrity fingerprint, not proof of authenticity. Identifiers are user assertions, not independent verification.</p>
    </section>
  );
}
