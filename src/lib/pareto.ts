import type { MetricDefinition } from "./types.ts";

export interface ParetoPoint {
  candidate: string;
  quality: number;
  cost: number;
  runId: string;
  dominated: boolean;
}

/** Non-dominated set for higher-is-better quality vs lower-is-better cost. */
export function paretoFrontier(
  points: Array<{ candidate: string; quality: number; cost: number; runId: string }>,
  direction: MetricDefinition["direction"],
): ParetoPoint[] {
  const betterQuality = (a: number, b: number) => (direction === "higher" ? a > b : a < b);
  const equalQuality = (a: number, b: number) => a === b;
  return points.map((p) => {
    let dominated = false;
    for (const q of points) {
      if (q === p) continue;
      const qBetterOrEqualQuality = betterQuality(q.quality, p.quality) || equalQuality(q.quality, p.quality);
      const qBetterOrEqualCost = q.cost <= p.cost;
      const strictlyBetter = betterQuality(q.quality, p.quality) || q.cost < p.cost;
      if (qBetterOrEqualQuality && qBetterOrEqualCost && strictlyBetter) {
        dominated = true;
        break;
      }
    }
    return { ...p, dominated };
  });
}
