# AppSec Report (self-review, labeled)

Date: 2026-10-13
Reviewer: implementation lead (self-review). Independent senior-appsec-engineer review NOT performed; agents unavailable as Task subagents in this environment (inspected `C:\Users\chaus\.cursor\agents\protect\appsec-engineer.md`, YAML name `senior-appsec-engineer`). Gap disclosed; owner must accept before production claims.

## Scope

Local-only React+Vite viewer. Imports: canonical JSON, runs CSV, examples CSV. No backend, no auth, no model APIs. Trust boundary: file picker and synthetic demo fixture; everything else is local rendering.

## Threat model (STRIDE-lite)

- Spoofing: imported run/metric IDs are user assertions. Mitigation: UI labels them as assertions; provenance panel states hash is integrity-only, not authenticity.
- Tampering: hostile CSV/JSON (formula injection, huge fields, deep nesting, NaN/Infinity, invalid timestamps). Mitigations: strict parsers, bounds in `src/lib/limits.ts`, worker-bounded parsing, explicit preview with row/field/reason, valid-only import after confirmation.
- Repudiation: bounded provenance (filename, timestamp, SHA-256, mappings/conversions, accepted/rejected counts) retained in memory and canonical export.
- Information disclosure: imported query text stays in browser memory; canonical export warns it includes query text; CSV exports exclude query text by default. No analytics, no telemetry with imported content, no external fonts/images/URL previews (verified by grep: no fetch/WebSocket/eval/dangerouslySetInnerHTML in `src/**/*.ts(x)`).
- Denial of service: 10 MiB/file, 50 MiB cumulative, 20k metric rows, 50k examples, CSV field 20k chars, JSON depth 20, pagination (50/page) for tables, memoized aggregates, debounced search, worker with progress/cancel.
- Elevation: no eval, no executable expressions, no imported HTML execution; strings render as text.

## Checks performed (actual)

- `npm audit --audit-level=moderate`: 0 vulnerabilities (2026-10-13).
- Grep `dangerouslySetInnerHTML|eval\(|fetch\(|XMLHttpRequest|WebSocket` in `src/**/*.ts,tsx`: no matches.
- Grep secret patterns (private-key header, GitHub token prefix, live API-key prefix, AWS key prefix): no matches.
- CSV formula protection: `escapeCsvCell` prefixes `=+-@` with `'`; unit-tested (`golden.test.ts` escapes `=1+1`, `@x`, `a,b`).
- Null vs zero: `parseStrictNumber` rejects NaN/Infinity/malformed; preserves 0; unit-tested.
- Timestamp requires timezone; unit-tested.
- E2E `no imported-data network transmission` passes with localhost allowlist (dev HMR only; no external hosts observed).

## Findings

1. [Low] Recharts bundle ~676 kB minified (gzip ~198 kB). Availability/perf note, not a vuln. Mitigated by pagination and filter-scoped charts. No action required for MVP.
2. [Info] Dev-server HMR loads modules from localhost in dev; production `dist/` is static with no external requests. Verified `index.html` has no external assets.
3. [Info] SHA-256 shown as integrity fingerprint; UI explicitly states it is not authenticity proof.

## Residual risks (owner acceptance required if shipping)

- No independent AppSec review performed (gap).
- No DAST/SAST beyond oxlint + audit + manual grep. No fuzzing of parsers beyond unit tests.
- Browser-memory disclosure if user shares screen/exports canonical JSON without reading warning.

## Verdict

No confirmed high/critical issues in performed checks. Do not claim independent approval. Owner accepts self-review gap before any production or public-repo claim.
