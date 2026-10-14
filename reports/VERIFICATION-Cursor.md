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
