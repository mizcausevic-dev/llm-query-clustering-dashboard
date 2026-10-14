# Verification (actual results, no fabrication)

Date: 2026-10-13 (UTC). Environment: Windows 10.0.26200, Node v24.11.0, npm 11.6.1.

## Commands run and outcomes

- `npm install`: PASS (71 packages base; 110 with recharts; 133 with vitest+playwright; 0 vulnerabilities at each step).
- `npm run build` (`tsc -b && vite build`): PASS. `dist/index.html` 0.48 kB, CSS 2.50 kB, JS ~676 kB (gzip ~198 kB). Chunk-size warning present (recharts single chunk); not a failure.
- `npm test` (vitest run): 30/30 PASS (`src/lib/golden.test.ts`). Two initial failures fixed (duplicate enforcement + minimal-CSV run_id); rerun green.
- `npm run lint` (oxlint): PASS, 0 errors (1 warning fixed).
- `npm run test:e2e` (Playwright chromium): 5/5 PASS. Initial 5 failures were harness binding (127.0.0.1 vs localhost) plus 2 test-assertion issues; fixed config/tests; final green on `http://localhost:5174` with existing dev server.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- `npm run sbom`: PASS, `sbom.json` (CycloneDX JSON) written.
- Greps: secret patterns no matches; `dangerouslySetInnerHTML|eval\(|fetch\(|XMLHttpRequest|WebSocket` in `src/**/*.ts(x)` no matches.
- Dev-server reachability: `Invoke-WebRequest http://localhost:5174/` returned 200.

## Test evidence locations

- Unit: `src/lib/golden.test.ts` (30 tests).
- E2E: `tests/e2e/core.spec.ts` (5 tests), `playwright.config.ts`.
- Samples: `samples/canonical.json`, `samples/runs.csv`, `samples/examples.csv`, `samples/minimal.csv`.
- Schema: `schemas/workspace.schema.json`.
- SBOM: `sbom.json`.
- Build output: `dist/` (generated; not committed unless owner requests).

## What was NOT run

- No cross-browser E2E (chromium only), no axe accessibility scan, no SAST/DAST beyond above, no parser fuzzing, no `npm ci` clean-room repro (used `npm install`; lockfile present so `npm ci` expected to work but not executed).

## GitHub release (2026-10-13, owner-confirmed)

- Pre-public gate (preflight-security): Gate 3 history `gitleaks detect --source . --log-opts="--all" --redact` = no leaks (1 commit scanned); Gate 4 CI = N/A (no workflows, Dockerfiles, or deploy scripts in repo); Gate 5 topology = clean (no hostnames, IPs, usernames, env references in `src`; no `.env` files). No STOP conditions triggered.
- Created private repo `mizcausevic-dev/llm-query-clustering-dashboard`, pushed `main` (commit `79aae1c` + branch rename). About + 8 topics set and verified via `gh repo view`.
- Secret scanning + push protection: unavailable on the private personal repo (HTTP 422/404). The local gitleaks *pre-commit hook is not installed* (`.git/hooks` has only Git samples). Compensating control that *did* run: `gitleaks detect --log-opts="--all"` on history, plus the repo pre-commit secret scanner that blocked a report-pattern false positive during the first commit. Public visibility is the path to GitHub secret scanning and push protection.

## Sanity pass (2026-10-14)

Independent reviews: `senior-appsec-engineer` and `release-supply-chain-engineer` both proceed-to-public, no STOP.

Fixes applied before the public flip (logic, not just docs):

- Cumulative byte budget now uses `importedBytes` / `f.size`. The old check added record counts to a byte field and compared against 50 MiB + 1e9.
- Import tries the worker first; Vite now emits `importWorker-*.js`. Local validators remain the fallback.
- Full-file SHA-256 (not a 5 MiB prefix).
- Unknown candidate identity is not pooled.
- Unverified rows (matching nulls) cannot form a controlled cohort.
- Complete singletons are comparable, not mislabeled incompatible.
- Scatter / Pareto / summary CSV stay inside one controlled quality cohort.
- Bar chart drops null means instead of drawing zero.
- Synthetic/real mix requires confirmation.
- Example drill-down caps at 200 items per cluster.
- `.gitignore` now covers `.env` / `.env.*`.
- Stale "gitleaks hook active" and "lockfile v11" claims corrected.

`npm test`: 35/35 PASS. `npm run lint`: 0 errors. `npm run build`: PASS (worker chunk 13.68 kB + main ~680 kB).
