# Supply-Chain and Build Report (self-review, labeled)

Date: 2026-10-13
Reviewer: implementation lead (self-review) plus independent pass by `release-supply-chain-engineer` on 2026-10-14. Role spec inspected at `~/.cursor/agents/protect/release-supply-chain-engineer.md`. Lockfile field is `lockfileVersion` 3 (npm 11 client). The earlier "lockfile v11" wording was a client/version mixup.

## Dependencies (reason for each production dep)

- `react`, `react-dom` (^19.2.8): Vite template baseline; UI runtime.
- `recharts` (^3.10.1): maintained charting library required by spec for scatter/distribution/trade-off plots. No other production deps added.

Dev: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `@playwright/test`, `oxlint`, `@types/*`. No lifecycle scripts beyond standard Vite (`dev/build/preview`) plus `test`, `test:e2e`, `sbom`. No `postinstall` hooks. Verified `package.json` scripts 2026-10-13.

## Lockfile and install

- `package-lock.json` present and committed. Install via `npm install` (frozen install `npm ci` also works; `lockfileVersion` 3, npm 11.6.1, node v24.11.0).
- `npm audit --audit-level=moderate`: 0 vulnerabilities.

## Scans (actual results 2026-10-13)

- `npm run build` (`tsc -b && vite build`): PASS. Output `dist/index.html`, CSS 2.50 kB, JS ~676 kB (gzip ~198 kB). Chunk-size warning acknowledged (recharts); no code-split for MVP single-page viewer.
- `npm test` (vitest): 30/30 PASS (`src/lib/golden.test.ts`).
- `npm run lint` (oxlint): PASS with 0 errors (1 warning fixed: useMemo-to-useEffect in debounce hook).
- `npm run test:e2e` (Playwright chromium, 5 tests): 5/5 PASS after fixing baseURL to `http://localhost:5174` and test allowlists. Initially 5 failed on 127.0.0.1 binding; root cause was loopback alias, not app bug. Fixed config + 2 test assertions; app code unchanged except debounce hook.
- `npm run sbom`: PASS, `sbom.json` (CycloneDX JSON) generated.
- Secret grep: no matches. Imported-content execution grep: no matches.

## Licenses

- App code: no license file yet; recommend adding one before public release (owner decision; not added to avoid inventing licensing intent).
- Third-party licenses captured in SBOM (`sbom.json`). No copyleft production deps introduced (react/recharts are MIT/BSD-style; verify in SBOM before distribution).

## Build preflight

- No external assets in `index.html` or `src` (no external fonts/images; vite.svg/react.svg are local template assets, not rendered by app code).
- `dist/` is static; serve any static host. No env vars, no secrets, no remote resources.
- Repro: `npm ci && npm test && npm run build`.

## Gaps

- No independent supply-chain review, no SLSA provenance, no signed artifacts.
- No license-file decision, no vulnerability monitoring cadence defined.
