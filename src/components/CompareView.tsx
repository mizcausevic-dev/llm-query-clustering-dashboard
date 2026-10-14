import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import type { ExampleRecord, MetricDefinition, RunMetricRecord } from "../lib/types.ts";
import { findMetricDefinition } from "../lib/metricRegistry.ts";
import { cohortKeyFor, candidateLabel, performanceCompatibility } from "../lib/compatibility.ts";
import { summarizeCohort, distinctRuns } from "../lib/aggregation.ts";
import { checkMetricBounds } from "../lib/metricRegistry.ts";
import { paretoFrontier } from "../lib/pareto.ts";
import { formatNum, timezoneLabel } from "../appState.ts";
import { controlledCohorts, groupByCohort, plotCohortForMetric, rowCompatibilityLabel } from "../lib/compareLogic.ts";

function useDebounced<T>(value: T, ms = 300): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDeb(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return deb;
}

export interface FilterState {
  datasets: string[];
  candidates: string[];
  metrics: string[];
  from: string;
  to: string;
  synthetic: "all" | "real" | "synthetic";
  compat: "all" | "comparable" | "incompatible" | "unverified";
  search: string;
}

export function CompareView(props: {
  runs: RunMetricRecord[];
  examples: ExampleRecord[];
  defs: MetricDefinition[];
  onSelectRun: (runId: string) => void;
}) {
  const { runs, examples, defs } = props;
  const [f, setF] = useState<FilterState>({ datasets: [], candidates: [], metrics: [], from: "", to: "", synthetic: "all", compat: "all", search: "" });
  const searchDeb = useDebounced(f.search, 300);
  const [page, setPage] = useState(0);
  const [cohortFocus, setCohortFocus] = useState<string>("all");
  const [qualityMetric, setQualityMetric] = useState<string>("");
  const [paretoOn, setParetoOn] = useState(false);

  const datasets = useMemo(() => [...new Set(runs.map((r) => r.dataset))].sort(), [runs]);
  const candidates = useMemo(() => [...new Set(runs.map((r) => candidateLabel(r)))].sort(), [runs]);
  const metrics = useMemo(() => [...new Set(runs.map((r) => r.metric))].sort(), [runs]);

  function compatOf(r: RunMetricRecord): { status: string; reason: string } {
    return rowCompatibilityLabel(r, runs, defs);
  }

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (f.datasets.length && !f.datasets.includes(r.dataset)) return false;
      if (f.candidates.length && !f.candidates.includes(candidateLabel(r))) return false;
      if (f.metrics.length && !f.metrics.includes(r.metric)) return false;
      if (f.synthetic === "real" && r.is_synthetic) return false;
      if (f.synthetic === "synthetic" && !r.is_synthetic) return false;
      if (f.from) {
        const fromIso = new Date(f.from).toISOString();
        if (r.run_timestamp < fromIso) return false;
      }
      if (f.to) {
        const toIso = new Date(f.to).toISOString();
        if (r.run_timestamp > toIso) return false;
      }
      if (searchDeb && !`${r.run_id} ${r.model} ${r.metric}`.toLowerCase().includes(searchDeb.toLowerCase())) return false;
      const c = rowCompatibilityLabel(r, runs, defs);
      if (f.compat !== "all" && c.status !== f.compat) return false;
      if (cohortFocus !== "all") {
        const { key } = cohortKeyFor(r, defs);
        if (key !== cohortFocus) return false;
      }
      return true;
    }).sort((a, b) => (a.run_id === b.run_id ? (a.metric < b.metric ? -1 : 1) : a.run_id < b.run_id ? -1 : 1));
  }, [runs, f, searchDeb, cohortFocus, defs]);

  const cohorts = useMemo(() => groupByCohort(filtered, defs), [filtered, defs]);

  const comparisonGroups = useMemo(() => {
    return controlledCohorts(filtered, defs).map((c) => ({
      ...c,
      metric: c.runs[0].metric,
      summaries: summarizeCohort(c.runs, candidateLabel),
    }));
  }, [filtered, defs]);

  const effQuality = qualityMetric || metrics[0] || "";
  const def = findMetricDefinition(defs, effQuality);
  const direction = def?.direction ?? "higher";

  const plotCohort = useMemo(
    () => plotCohortForMetric(filtered, defs, effQuality, cohortFocus),
    [filtered, defs, effQuality, cohortFocus],
  );

  const costQualityPoints = useMemo(() => {
    const pts: Array<{ x: number; y: number; label: string; run: string }> = [];
    let excluded = 0;
    const reasons = new Map<string, number>();
    const source = plotCohort?.runs ?? [];
    for (const r of source) {
      if (typeof r.score !== "number" || typeof r.cost !== "number") {
        excluded += 1;
        const k = r.score === null ? "missing quality" : "missing cost";
        reasons.set(k, (reasons.get(k) ?? 0) + 1);
        continue;
      }
      pts.push({ x: r.cost, y: r.score, label: candidateLabel(r), run: r.run_id });
    }
    pts.sort((a, b) => (a.run === b.run ? 0 : a.run < b.run ? -1 : 1));
    return { pts, excluded, reasons, currency: source.find((r) => r.cost_currency)?.cost_currency ?? "?", cohort: plotCohort?.label ?? "no controlled cohort for this metric" };
  }, [plotCohort]);

  const latencyQualityPoints = useMemo(() => {
    const pts: Array<{ x: number; y: number; label: string; run: string }> = [];
    let excluded = 0;
    const source = plotCohort?.runs ?? [];
    for (const r of source) {
      if (typeof r.score !== "number" || typeof r.latency !== "number") {
        excluded += 1;
        continue;
      }
      pts.push({ x: r.latency, y: r.score, label: candidateLabel(r), run: r.run_id });
    }
    pts.sort((a, b) => (a.run === b.run ? 0 : a.run < b.run ? -1 : 1));
    return { pts, excluded, cohort: plotCohort?.label ?? "no controlled cohort for this metric" };
  }, [plotCohort]);

  const outOfRange = useMemo(() => {
    return filtered.filter((r) => {
      const d = findMetricDefinition(defs, r.metric);
      if (!d || typeof r.score !== "number") return false;
      return checkMetricBounds(d, r.score).outOfRange;
    });
  }, [filtered, defs]);

  const pareto = useMemo(() => {
    if (!paretoOn || !effQuality) return null;
    if (!plotCohort) return { points: [], disabled: "Pareto needs one controlled quality cohort (complete metadata, 2+ distinct runs)" };
    const base = plotCohort.runs.filter((r) => typeof r.score === "number" && typeof r.cost === "number");
    if (base.length === 0) return { points: [], disabled: "no rows with both quality and cost in the controlled cohort" };
    const first = base[0];
    for (const r of base.slice(1)) {
      const c = performanceCompatibility(first, r, "cost");
      if (c.status !== "comparable" || c.reasons.some((x) => x.startsWith("side-by-side"))) {
        return { points: [], disabled: `cost cohort not poolable: ${c.reasons.join("; ")}` };
      }
    }
    const pts = paretoFrontier(base.map((r) => ({ candidate: candidateLabel(r), quality: r.score as number, cost: r.cost as number, runId: r.run_id })), direction);
    return { points: pts, disabled: null as string | null };
  }, [paretoOn, plotCohort, effQuality, direction]);

  const PAGE_SIZE = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const exampleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of examples) m.set(e.run_id, (m.get(e.run_id) ?? 0) + 1);
    return m;
  }, [examples]);

  return (
    <section aria-label="Compare view" className="panel">
      <h2>Controlled comparisons and raw inspection</h2>
      <p className="muted">Timezone for timestamps: {timezoneLabel()} (run_timestamp values shown as stored ISO-8601; filtering compares lexicographically on ISO strings). Comparable means declared metadata matches, not that the procedure was verified.</p>
      <div className="filters">
        <fieldset><legend>Datasets</legend>{datasets.map((d) => <label key={d}><input type="checkbox" checked={f.datasets.includes(d)} onChange={(e) => setF({ ...f, datasets: e.target.checked ? [...f.datasets, d] : f.datasets.filter((x) => x !== d) })} /> {d}</label>)}</fieldset>
        <fieldset><legend>Candidates (model + version + config)</legend>{candidates.map((c) => <label key={c}><input type="checkbox" checked={f.candidates.includes(c)} onChange={(e) => setF({ ...f, candidates: e.target.checked ? [...f.candidates, c] : f.candidates.filter((x) => x !== c) })} /> {c}</label>)}</fieldset>
        <fieldset><legend>Metrics</legend>{metrics.map((m) => <label key={m}><input type="checkbox" checked={f.metrics.includes(m)} onChange={(e) => setF({ ...f, metrics: e.target.checked ? [...f.metrics, m] : f.metrics.filter((x) => x !== m) })} /> {m}</label>)}</fieldset>
        <label>From (local, compared as ISO) <input type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>To (local, compared as ISO) <input type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label>Synthetic
          <select value={f.synthetic} onChange={(e) => setF({ ...f, synthetic: e.target.value as FilterState["synthetic"] })}>
            <option value="all">all (labeled)</option>
            <option value="real">real only</option>
            <option value="synthetic">synthetic only</option>
          </select>
        </label>
        <label>Compatibility
          <select value={f.compat} onChange={(e) => setF({ ...f, compat: e.target.value as FilterState["compat"] })}>
            <option value="all">all</option>
            <option value="comparable">comparable</option>
            <option value="incompatible">incompatible</option>
            <option value="unverified">unverified</option>
          </select>
        </label>
        <label>Cohort focus
          <select value={cohortFocus} onChange={(e) => { setCohortFocus(e.target.value); setPage(0); }}>
            <option value="all">all cohorts</option>
            {cohorts.map((c) => <option key={c.key} value={c.key}>{c.label} ({new Set(c.runs.map((r) => r.run_id)).size} runs)</option>)}
          </select>
        </label>
        <label>Search runs <input type="search" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="run_id, model, metric" /></label>
        <button type="button" onClick={() => { setF({ datasets: [], candidates: [], metrics: [], from: "", to: "", synthetic: "all", compat: "all", search: "" }); setCohortFocus("all"); setPage(0); }}>Clear filters (restores original results)</button>
      </div>

      {outOfRange.length > 0 && (
        <p role="alert">Out-of-range scores flagged (not clipped): {outOfRange.slice(0, 8).map((r) => `${r.run_id}/${r.metric}=${r.score}`).join(", ")}{outOfRange.length > 8 ? ` +${outOfRange.length - 8} more` : ""}. Tolerance 1e-9 around expected bounds.</p>
      )}

      <h3>Raw run table ({filtered.length} metric rows; {distinctRuns(filtered).length} distinct runs; virtualized by pagination)</h3>
      <p className="muted">Incompatible/unverified rows stay here with exact exclusion reasons. There is no force-compatible button; fix metadata via explicit workspace edits (re-import with remap).</p>
      <table>
        <thead><tr><th>run_id</th><th>candidate</th><th>dataset</th><th>metric</th><th>score</th><th>compat</th><th>reason</th><th>synthetic</th><th>examples</th></tr></thead>
        <tbody>
          {pageRows.map((r, i) => {
            const c = compatOf(r);
            return (
              <tr key={`${r.run_id}-${r.metric}-${i}`}>
                <td><button type="button" className="link" onClick={() => props.onSelectRun(r.run_id)}>{r.run_id}</button></td>
                <td>{candidateLabel(r)}</td>
                <td>{r.dataset}@{r.dataset_version ?? "?"}</td>
                <td>{r.metric}</td>
                <td>{r.score === null ? "missing (not zero)" : r.score}</td>
                <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                <td>{c.reason}</td>
                <td>{r.is_synthetic ? "synthetic" : "real"}</td>
                <td>{exampleCounts.get(r.run_id) ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row"><button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button><span>Page {page + 1}/{pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button></div>

      <h3>Controlled comparison table (comparable cohorts only)</h3>
      {comparisonGroups.length === 0 && <p>No comparable cohorts under current filters. Raw table above explains exclusions.</p>}
      {comparisonGroups.map((g) => (
        <div key={g.key} className="cohort">
          <h4>{g.label} · metric {g.metric} · {new Set(g.runs.map((r) => r.run_id)).size} distinct runs</h4>
          <table>
            <thead><tr><th>candidate</th><th>n_total</th><th>n_valid</th><th>n_missing</th><th>mean</th><th>median</th><th>min</th><th>max</th><th>sample SD</th><th>unknown identity</th></tr></thead>
            <tbody>
              {g.summaries.map((s) => (
                <tr key={s.candidateKey}>
                  <td>{s.label} {s.model_version === null || s.model_config_id === null ? "(displayed individually; identity missing)" : ""}</td>
                  <td>{s.totalRuns}</td><td>{s.validScores}</td><td>{s.missingScores}</td>
                  <td>{formatNum(s.mean)}</td><td>{formatNum(s.median)}</td><td>{formatNum(s.min)}</td><td>{formatNum(s.max)}</td>
                  <td>{s.sd === null ? "n/a (<2 scores)" : formatNum(s.sd)}</td>
                  <td>{s.unknownIdentity ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Variation is observed across-run variation (one run = one observation). No significance tests or CIs. Non-additive clustering metrics are never sample-size weighted; percentiles are never averaged as pooled percentiles; metric rows are never counted as runs.</p>
        </div>
      ))}

      <h3>Distributions (run-level score points; one observation = one point)</h3>
      <label>Quality metric for plots
        <select value={effQuality} onChange={(e) => setQualityMetric(e.target.value)}>
          {metrics.map((m) => <option key={m} value={m}>{m} ({findMetricDefinition(defs, m)?.direction ?? "direction unknown"})</option>)}
        </select>
      </label>
      <div className="charts">
        <figure>
          <figcaption>Cost vs quality · metric {effQuality} ({direction} is better) · cohort {costQualityPoints.cohort} · points are runs · n={costQualityPoints.pts.length} shown, {costQualityPoints.excluded} excluded (missing quality/cost only for this plot)</figcaption>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="x" name="cost" label={{ value: `cost (${costQualityPoints.currency})`, position: "bottom" }} />
              <YAxis type="number" dataKey="y" name="score" />
              <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="tooltip"><p>{String(payload[0]?.payload?.run)}</p><p>{String(payload[0]?.payload?.label)}: cost {String(payload[0]?.payload?.x)}, score {String(payload[0]?.payload?.y)}</p></div> : null} />
              <Legend />
              <Scatter name="runs (labeled, not color-only)" data={costQualityPoints.pts} fill="#45A29E" />
            </ScatterChart>
          </ResponsiveContainer>
          <table aria-label="Cost quality companion data"><thead><tr><th>run</th><th>candidate</th><th>cost</th><th>score</th></tr></thead><tbody>{costQualityPoints.pts.slice(0, 30).map((p) => <tr key={p.run}><td>{p.run}</td><td>{p.label}</td><td>{p.x}</td><td>{p.y}</td></tr>)}</tbody></table>
        </figure>
        <figure>
          <figcaption>Latency vs quality · metric {effQuality} · cohort {latencyQualityPoints.cohort} · points are runs · latency ms as declared · n={latencyQualityPoints.pts.length} shown, {latencyQualityPoints.excluded} excluded</figcaption>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="x" name="latency_ms" label={{ value: "latency (ms)", position: "bottom" }} />
              <YAxis type="number" dataKey="y" name="score" />
              <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="tooltip"><p>{String(payload[0]?.payload?.run)}</p><p>{String(payload[0]?.payload?.label)}: {String(payload[0]?.payload?.x)} ms, score {String(payload[0]?.payload?.y)}</p></div> : null} />
              <Legend />
              <Scatter name="runs" data={latencyQualityPoints.pts} fill="#66FCF1" />
            </ScatterChart>
          </ResponsiveContainer>
        </figure>
        <figure>
          <figcaption>Candidate mean scores (bars show mean of distinct runs; see table for median/min/max/SD and denominators)</figcaption>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={(comparisonGroups.find((g) => g.metric === effQuality)?.summaries ?? []).filter((s) => s.mean !== null).map((s) => ({ name: s.label.slice(0, 18), mean: s.mean, valid: s.validScores }))} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
              <CartesianGrid />
              <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} height={60} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="mean" name="mean score (run-level)" fill="#8b5cff" />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      </div>
      <p className="muted">Axes use linear scales with honest baselines (no log scales with zero/negative; nonzero baselines disclosed in captions when present). Missing values never become zero.</p>

      <details>
        <summary>Optional Pareto view (one quality metric + one compatible cost cohort; non-dominated only)</summary>
        <label><input type="checkbox" checked={paretoOn} onChange={(e) => setParetoOn(e.target.checked)} /> Enable Pareto (disabled automatically when cost metadata is not poolable)</label>
        {pareto && pareto.disabled && <p>{pareto.disabled}</p>}
        {pareto && !pareto.disabled && (
          <table><thead><tr><th>run</th><th>candidate</th><th>quality</th><th>cost</th><th>frontier</th></tr></thead>
            <tbody>{pareto.points.map((p) => <tr key={p.runId}><td>{p.runId}</td><td>{p.candidate}</td><td>{p.quality}</td><td>{p.cost}</td><td>{p.dominated ? "dominated" : "non-dominated (trade-off, not universal winner)"}</td></tr>)}</tbody>
          </table>
        )}
      </details>
    </section>
  );
}
