import type { VectorStrokeLodStats } from "./vectorStrokeLodCore";

export function formatVectorStrokeLodStats(stats: VectorStrokeLodStats | null): string {
  if (!stats || stats.totalLevels <= 1) {
    return "";
  }

  const activeLevels = stats.activeLevels.length > 0
    ? stats.activeLevels
      .map((level) => `${formatLodTolerance(level.tolerance)}:${formatCompactCount(level.renderedSegments)}`)
      .join(" ")
    : "none";

  return (
    `lod ${formatCompactCount(stats.renderedSegments)} seg | ` +
    `${stats.visibleTileCount.toLocaleString()} tiles | ` +
    `target ${formatCompactCount(stats.targetSegmentsPerTile)}/tile | ` +
    `zoom ${formatLodTolerance(stats.baselineTolerance)} | ` +
    `active ${activeLevels} | ` +
    `dense exact ${stats.maxBaselineTileSegments.toLocaleString()} -> ` +
    `${stats.maxBaselineTileSelectedSegments.toLocaleString()} @${formatLodTolerance(stats.maxBaselineTileSelectedTolerance)} | ` +
    `peak ${stats.maxSelectedTileSegments.toLocaleString()} @${formatLodTolerance(stats.maxSelectedTileTolerance)}`
  );
}

function formatCompactCount(value: number): string {
  const count = Math.max(0, Math.round(value));
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1_000)}k`;
  }
  return count.toLocaleString();
}

function formatLodTolerance(tolerance: number): string {
  return tolerance <= 0 ? "exact" : `tol${tolerance}`;
}
