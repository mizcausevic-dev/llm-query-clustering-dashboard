# LLM Query-Clustering Evaluation Viewer

Evaluation viewer, not an execution service. Inspect imported evidence, compare compatible runs, understand quality/latency/cost trade-offs. No model APIs, no benchmark generation, no universal winner.

## Quick start

```sh
npm install
npm run dev
npm run build
npm test
```

## Exact configured limits

- Maximum 10 MiB per file (10485760 bytes).
- Maximum 50 MiB cumulative imported file bytes per workspace (52428800 bytes).
- Maximum 20,000 metric records.
- Maximum 50,000 example records.
- ID/short strings bounded to 256 chars; medium strings to 2048; query text and CSV fields to 20,000 chars.
- JSON nesting depth bounded to 20. Total retained text bounded to 55.0M chars.
- Browser memory overhead exceeds raw file size; large imports may slow rendering. Tables virtualize via pagination; charts cap rendered points by filtering.

See `src/lib/limits.ts` and `SPEC.md`.

## Imports

1. Canonical JSON workspace (`samples/canonical.json`, schema `schemas/workspace.schema.json`).
2. Long-form runs CSV (`samples/runs.csv`).
3. Optional examples CSV (`samples/examples.csv`) linked to existing or concurrently imported runs.
4. Minimal legacy CSV (`samples/minimal.csv` with model,dataset,metric,score,latency,cost,run_timestamp): requires column mapping, latency-unit (ms) and cost currency/basis/provenance confirmation, synthetic classification, and explains missing comparison metadata. Default one run per row; optional explicit grouping with preview; contradictory groups rejected.

Import preview shows valid/invalid (row, field, reason), missing fields, missing compatibility metadata, duplicate/conflicting IDs, synthetic status, conversions. Reject file or import valid-only after confirmation. Existing-ID policy: reject conflicts without overwriting; offer incoming-ID remapping (`old=new` per line, example refs remapped); never assume same names mean same runs. Provenance records filename, timestamp, SHA-256 (integrity only, not authenticity), mappings/conversions, accepted/rejected counts.

## Compatibility and aggregation

See `docs/COMPATIBILITY_AND_AGGREGATION.md` and `SPEC.md`. Synthetic and real never share a cohort. No force-compatible button.

## Exports

- Canonical workspace JSON (includes query text; warn before sharing; re-imports without losing meaning).
- Filtered raw metrics CSV (no query text; formula-safe with leading `'` for `=+-@`; preserves units/IDs/synthetic/missing).
- Filtered comparison-summary CSV (cohort keys, counts, aggregation definitions, exclusions).

## Safety

Imported data stays in the browser. No analytics, telemetry with imported content, external fonts, remote images, or URL previews. Strings render as text; no `dangerouslySetInnerHTML` for imported content. See `reports/APPSEC-Cursor.md`.

## Scripts

- `npm run dev` — local dev
- `npm run build` — typecheck + production build
- `npm test` — vitest unit/invariant tests
- `npm run test:e2e` — Playwright flows (requires `npx playwright install`)
- `npm run sbom` — CycloneDX SBOM to `sbom.json`
