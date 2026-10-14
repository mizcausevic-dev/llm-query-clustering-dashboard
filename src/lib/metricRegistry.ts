import type { MetricDefinition } from "./types.ts";

export const VERIFIED_METRICS: MetricDefinition[] = [
  {
    id: "ARI",
    name: "Adjusted Rand Index",
    description:
      "Chance-adjusted agreement between predicted and reference partitions. 1 is identical, expected 0 for random labeling. May be negative when agreement is worse than chance. Reference: scikit-learn sklearn.metrics.adjusted_rand_score.",
    direction: "higher",
    unit: "index",
    scaleLabel: "expected [-1, 1]",
    minExpected: -1,
    maxExpected: 1,
    tolerance: 1e-9,
    requiresMetricConfig: [
      "normalization/averaging method",
      "feature or embedding representation",
      "distance metric",
      "sampling procedure",
      "treatment of noise or unassigned records",
    ],
    aggregationNote:
      "Non-additive clustering index. Aggregate only as mean of distinct runs within one compatible cohort. Never weight by sample size. Never average across datasets or definitions.",
  },
  {
    id: "AMI",
    name: "Adjusted Mutual Information",
    description:
      "Chance-adjusted mutual information between predicted and reference partitions. 1 is identical, expected 0 for random. May be negative when worse than chance. Reference: scikit-learn sklearn.metrics.adjusted_mutual_info_score.",
    direction: "higher",
    unit: "index",
    scaleLabel: "expected [0, 1], negative permitted",
    minExpected: -1,
    maxExpected: 1,
    tolerance: 1e-9,
    requiresMetricConfig: [
      "average_method (e.g. arithmetic/min/max/geometric)",
      "feature or embedding representation",
      "distance metric",
      "sampling procedure",
      "treatment of noise or unassigned records",
    ],
    aggregationNote:
      "Non-additive. Mean of distinct runs within one compatible cohort only. Never weight by sample size.",
  },
  {
    id: "NMI",
    name: "Normalized Mutual Information",
    description:
      "Mutual information normalized to [0, 1]. 1 is identical partitions, 0 is no mutual information. Reference: scikit-learn sklearn.metrics.normalized_mutual_info_score.",
    direction: "higher",
    unit: "index",
    scaleLabel: "[0, 1]",
    minExpected: 0,
    maxExpected: 1,
    tolerance: 1e-9,
    requiresMetricConfig: [
      "average_method (min/geometric/arithmetic/max)",
      "feature or embedding representation",
      "distance metric",
      "sampling procedure",
      "treatment of noise or unassigned records",
    ],
    aggregationNote:
      "Non-additive. Mean of distinct runs within one compatible cohort only.",
  },
  {
    id: "SILHOUETTE",
    name: "Silhouette score",
    description:
      "Mean silhouette coefficient over evaluated items. Range [-1, 1]; higher means denser, better-separated clusters. Reference: scikit-learn sklearn.metrics.silhouette_score.",
    direction: "higher",
    unit: "index",
    scaleLabel: "[-1, 1]",
    minExpected: -1,
    maxExpected: 1,
    tolerance: 1e-9,
    requiresMetricConfig: [
      "feature or embedding representation",
      "distance metric (e.g. euclidean/cosine)",
      "sampling procedure and sample size",
      "treatment of noise or unassigned records",
    ],
    aggregationNote:
      "Non-additive. Mean of distinct runs within one compatible cohort only. Never average run-level means as a pooled item-level value.",
  },
];

export function findMetricDefinition(
  defs: MetricDefinition[],
  metricId: string,
): MetricDefinition | undefined {
  return defs.find((d) => d.id === metricId);
}

export function mergedDefinitions(
  custom: MetricDefinition[],
): MetricDefinition[] {
  const map = new Map<string, MetricDefinition>();
  for (const v of VERIFIED_METRICS) map.set(v.id, v);
  for (const c of custom) {
    if (!map.has(c.id)) map.set(c.id, c);
  }
  return [...map.values()];
}

export function checkMetricBounds(
  def: MetricDefinition,
  score: number | null,
): { outOfRange: boolean; detail: string | null } {
  if (score === null || !Number.isFinite(score)) return { outOfRange: false, detail: null };
  const tol = def.tolerance ?? 1e-9;
  if (def.minExpected !== null && score < def.minExpected - tol) {
    return {
      outOfRange: true,
      detail: `score ${score} below expected minimum ${def.minExpected} (tolerance ${tol})`,
    };
  }
  if (def.maxExpected !== null && score > def.maxExpected + tol) {
    return {
      outOfRange: true,
      detail: `score ${score} above expected maximum ${def.maxExpected} (tolerance ${tol})`,
    };
  }
  return { outOfRange: false, detail: null };
}
