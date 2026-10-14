import { LIMITS } from "./limits.ts";

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function splitCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    if (field.length > LIMITS.MAX_CSV_FIELD) {
      throw new Error(`CSV field exceeds ${LIMITS.MAX_CSV_FIELD} chars`);
    }
    row.push(field);
    field = "";
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i += 1;
      } else if (c === ",") {
        pushField();
        i += 1;
      } else if (c === "\r") {
        i += 1;
      } else if (c === "\n") {
        pushField();
        rows.push(row);
        row = [];
        i += 1;
      } else {
        field += c;
        i += 1;
      }
    }
    if (rows.length > 60_000) throw new Error("CSV has too many rows");
  }
  if (inQuotes) throw new Error("CSV has unterminated quote");
  if (field !== "" || row.length > 0) {
    pushField();
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  if (headers.length > LIMITS.MAX_CSV_COLUMNS) throw new Error("CSV has too many columns");
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) throw new Error(`CSV has duplicate column: ${h}`);
    seen.add(h);
  }
  return { headers, rows: nonEmpty.slice(1) };
}

export function tableToObjects(table: CsvTable): Array<Record<string, string>> {
  return table.rows.map((r) => {
    const o: Record<string, string> = {};
    table.headers.forEach((h, idx) => {
      o[h] = (r[idx] ?? "").trim();
    });
    return o;
  });
}

export const MINIMAL_COLUMNS = ["model", "dataset", "metric", "score", "latency", "cost", "run_timestamp"] as const;

export interface ColumnMapping {
  [csvColumn: string]: string;
}

export function suggestMapping(headers: string[]): ColumnMapping {
  const map: ColumnMapping = {};
  const lower = headers.map((h) => h.toLowerCase().trim());
  const targets = [
    "run_id", "model", "model_version", "model_config_id", "dataset", "dataset_version",
    "evaluation_set_id", "evaluation_config_id", "run_timestamp", "seed", "is_synthetic",
    "metric", "score", "sample_size", "metric_config_id", "latency", "latency_basis",
    "cost", "cost_currency", "cost_basis", "cost_provenance", "work_item_count",
    "work_item_unit", "performance_context_id",
  ];
  headers.forEach((h, i) => {
    const l = lower[i];
    if (targets.includes(l)) map[h] = l;
  });
  return map;
}

export function applyMapping(
  objs: Array<Record<string, string>>,
  mapping: ColumnMapping,
): Array<Record<string, string>> {
  return objs.map((o) => {
    const out: Record<string, string> = {};
    for (const [src, dst] of Object.entries(mapping)) {
      out[dst] = o[src] ?? "";
    }
    return out;
  });
}
