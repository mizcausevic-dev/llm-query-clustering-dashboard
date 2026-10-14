export const LIMITS = {
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  MAX_TOTAL_BYTES: 50 * 1024 * 1024,
  MAX_METRIC_RECORDS: 20_000,
  MAX_EXAMPLE_RECORDS: 50_000,
  MAX_ID_LENGTH: 256,
  MAX_SHORT_STRING: 256,
  MAX_MEDIUM_STRING: 2048,
  MAX_QUERY_TEXT: 20_000,
  MAX_CSV_FIELD: 20_000,
  MAX_CSV_COLUMNS: 64,
  MAX_JSON_DEPTH: 20,
  MAX_RETAINED_CHARS: 55_000_000,
  MAX_RUNS_DISTINCT: 20_000,
  WORKER_CHUNK_ROWS: 2000,
} as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

export const LIMITS_TEXT = [
  `Maximum 10 MiB per file (${LIMITS.MAX_FILE_BYTES} bytes).`,
  `Maximum 50 MiB cumulative imported file bytes per workspace (${LIMITS.MAX_TOTAL_BYTES} bytes).`,
  `Maximum ${LIMITS.MAX_METRIC_RECORDS.toLocaleString()} metric records.`,
  `Maximum ${LIMITS.MAX_EXAMPLE_RECORDS.toLocaleString()} example records.`,
  `ID/short strings bounded to ${LIMITS.MAX_ID_LENGTH} chars; medium strings to ${LIMITS.MAX_MEDIUM_STRING}; query text and CSV fields to ${LIMITS.MAX_QUERY_TEXT.toLocaleString()} chars.`,
  `JSON nesting depth bounded to ${LIMITS.MAX_JSON_DEPTH}. Total retained text bounded to ${(LIMITS.MAX_RETAINED_CHARS / 1_000_000).toFixed(1)}M chars.`,
  `Browser memory overhead exceeds raw file size; large imports may slow rendering. Tables virtualize; charts cap points.`,
].join(" ");
