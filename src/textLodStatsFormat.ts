import type { TextLodStats } from "./textLodCore";

/** Compact clustered-text LOD diagnostics for the example HUDs. */
export function formatTextLodStats(stats: TextLodStats | null | undefined): string {
  if (!stats) {
    return "";
  }
  if (stats.mode === "off") {
    return "off";
  }
  if (!stats.available) {
    return stats.fallbackReason ? `exact (${stats.fallbackReason})` : "exact";
  }

  const clusterSummary = `${stats.exactClusters.toLocaleString()} exact / ${stats.coarseClusters.toLocaleString()} coarse`;
  const instanceSummary = `${stats.selectedInstances.toLocaleString()} selected`;
  const budgetSuffix = stats.exactBudgetOverage > 0
    ? ` | +${stats.exactBudgetOverage.toLocaleString()} exact over target`
    : "";
  return `${clusterSummary} clusters | ${instanceSummary}${budgetSuffix}`;
}
