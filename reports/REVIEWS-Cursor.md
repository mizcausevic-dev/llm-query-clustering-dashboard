# Consolidated Review Findings (implementation lead; self-reviews labeled)

Date: 2026-10-13
Routing: inspected actual Team OS specs at `C:\Users\chaus\.cursor\agents/{build,protect,deliver,meta}`. Required roles per brief: senior-backend-developer, senior-appsec-engineer, senior-frontend-engineer, senior-qa-automation-engineer, senior-ux-ui-engineer, senior-release-supply-chain-engineer, senior-llm-evals-output-qa-engineer (+ senior-data-analyst for unresolved stats). These roles are NOT available as `Task` subagent_types in this environment (available: generalPurpose, explore, browser-use, cursor-guide, ci-investigator, bugbot, security-review, etc.). No reviews were invented. All findings below are labeled SELF-REVIEW by the implementation lead against the inspected role checklists. Independent reviews remain open.

## 1. Backend/contracts (self-review vs senior-backend-developer checklist)

- Contracts typed at every boundary (`src/lib/types.ts`); runtime validation at trust edges (`validation.ts`, `importLocal.ts`, worker). PASS.
- Error paths disciplined: invalid rows reported with row/field/reason; valid-only import gated on explicit confirmation. PASS.
- No new production dependency without reason: only `recharts` added with documented reason. PASS.
- Observability: N/A (local-only, no backend). Provenance log in-memory + export. PASS with note.
- Finding: duplicate/conflict enforcement duplicated in `importLocal.ts` and `importWorker.ts`; drift risk. Recommendation: extract shared helper (future refactor; behavior covered by identical unit path tests for local; worker path manually aligned).

## 2. AppSec (self-review vs senior-appsec-engineer checklist)

See `reports/APPSEC-Cursor.md`. No high/critical in performed checks. Threat model documented. OWASP Top-10 mapping: A03 injection (CSV formula escaping, no eval/HTML), A05 misconfig (no external assets), A08 integrity (SBOM, lockfile, audit clean). Gap: no independent review, no DAST/SAST beyond grep/audit.

## 3. Frontend (self-review vs senior-frontend-engineer checklist)

- State consistency: single `WorkspaceState` in `App.tsx`; filters memoize and update tables/charts/counts/exports together. PASS.
- Chart correctness: run-level scatters default; captions state metric/direction/units/basis/cohort/counts/point semantics; exclusion counts shown; no zero-as-missing; linear axes only. PASS.
- Accessibility: labels, dialog with Esc, keyboard-focusable controls, tooltips with companion tables, not color-alone (badges + text + direct labels). E2E keyboard test passes. Remaining: full axe audit not run (gap).
- Performance: pagination (50/page), debounced search, `useMemo`, worker parsing. Bundle warning acknowledged. PASS for MVP.

## 4. QA (self-review vs senior-qa-automation-engineer checklist)

- Golden fixtures hand-calculated (mean/median/SD 0.62/0.58). Invariants: order invariance, incompatible-add stability, cost dedup, filter restore (via Clear filters control), synthetic isolation. 30/30 unit PASS. E2E 5/5 PASS (demo load, filter/compare, validation drill-down, export round-trip, keyboard, no-external-transmission). UI tests correctly do not claim statistical correctness. Gap: no fuzz/property tests, no cross-browser matrix (chromium only).

## 5. UX (self-review vs senior-ux-ui-engineer checklist)

- Cohort clarity: cohort labels show dataset@version | eval set | metric n= | synthetic; raw rows show compat + reason; no force-compatible. PASS.
- Missing-data states: "missing (not zero)", "Example data not supplied", SD n/a, plot exclusion counts. PASS.
- Denominators: n_total/n_valid/n_missing everywhere; distinct-run dedup stated. PASS.
- Misleading visuals: honest linear axes, nonzero baselines disclosed when present, no log scales, Pareto labeled trade-off not winner. PASS.

## 6. Supply chain (self-review vs senior-release-supply-chain-engineer checklist)

See `reports/SUPPLY_CHAIN-Cursor.md`. Lockfile present, audit clean, SBOM generated, build preflight PASS. Gap: no independent review, no license decision.

## 7. LLM evals / output QA (self-review vs evals checklist)

- Context: eval_set/config/model_config semantics documented and enforced in compatibility; identifiers labeled as assertions. PASS.
- Metric interpretation: ARI/AMI/NMI/Silhouette with directions, bounds, tolerance 1e-9, out-of-range flagged not clipped; unknown metrics need direction/scale before Pareto (Pareto disabled without poolable cost cohort). PASS.
- Comparison validity: synthetic/real separation enforced; mean-vs-p50 blocked; currency no-conversion; per-work-item only with explicit counts; repeated metric rows never double-count runs/cost (unit-tested). PASS.
- Limits on conclusions: no winner language; variation labeled observed across-run; no significance/CIs; illustrative examples explicitly not recomputed. PASS.
- Unresolved stats questions: none beyond MVP scope; senior-data-analyst escalation not triggered (no CIs/significance implemented by design).

## Deduplicated fix list (applied)

1. Worker/local duplicate+conflict enforcement + auto run_id for minimal CSV (unit failures fixed).
2. Debounce hook useMemo-to-useEffect (lint warning fixed).
3. Playwright baseURL/test allowlists (E2E fixed; app logic unchanged).

## Open gaps requiring owner acceptance

- All reviews are self-reviews; independent specialist approval not obtained.
- Accessibility audit (axe), cross-browser E2E, parser fuzzing, and license selection not done.
