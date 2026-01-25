// Hard-coded contour run overrides for USA artifact fixes.
// Keep this isolated and easily toggleable for future comparisons.
export const CONTOUR_OVERRIDES_ENABLED = true;

type ContourDepthParams = {
  level: number;
  runId?: number;
  minDepth: number;
  maxDepth: number;
  nearBias: number;
  farBias: number;
};

export function shouldSkipContourRun(level: number, runId?: number): boolean {
  if (!CONTOUR_OVERRIDES_ENABLED) return false;
  if (runId == null) return false;
  // 20M run-30 should be hidden in the stereogram.
  return level === 20_000_000 && runId === 30;
}

export function contourDepthForRun({
  level,
  runId,
  minDepth,
  maxDepth,
  nearBias,
  farBias,
}: ContourDepthParams): number {
  if (!CONTOUR_OVERRIDES_ENABLED) {
    return maxDepth + nearBias;
  }
  // Push 20M run-29 behind the ridge.
  if (runId != null && level === 20_000_000 && runId === 29) {
    return minDepth + farBias;
  }
  return maxDepth + nearBias;
}
