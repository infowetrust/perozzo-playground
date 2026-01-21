export type AxisLabelStyle = {
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  opacity: number;
};

export type AxisLabelBaseStyle = Omit<AxisLabelStyle, "color">;

export type AxisLabelLayout = {
  side: "left" | "right" | "both";
  tickLen: number;
  textOffset: number;
};

export type LineStyle = {
  stroke: string;
  thinWidth: number;
  thickWidth: number;
  thinOpacity: number;
  thickOpacity: number;
  heavyStep: number;
};

export const HOVER_HIGHLIGHT_MULT = 2;
export const HOVER_DIM_MULT = 0.85;

export const OCCLUSION = {
  enabled: true,
  // when true, all surface-following lines are drawn via interleaving (occluded)
  // and the old on-top polyline pass is disabled
};

export function isHeavy(value: number, heavyStep: number): boolean {
  if (!heavyStep) return false;
  return value % heavyStep === 0;
}

export type ShadingConfig = {
  enabled: boolean;
  ambient: number;
  diffuse: number;
  steps: number;
  lightDir: { x: number; y: number; z: number };
  inkColor: string;
  inkAlphaMax: number;
  gamma: number;
  shadowBias: number;
  alphaScale: {
    surface: number;
    backWall: number;
    rightWall: number;
    floor: number;
  };
};

export const TRI_RENDER = {
  enabled: true,
  backfaceCull: true,
  sortMetric: "maxY" as const,
  // Skip triangles that are nearly edge-on / slivers in screen space.
  // Larger = more aggressive culling (fewer spikes but may remove facets).
  degenerateAreaEps: 0,
  minArea2D: 0.5,
  keepBothTris: true,
  cullMode: "bothOnly" as const,
  split4Enabled: true,
  split4CenterDiffPx: 5,
  split4DebugStroke: true,
  debugTriVis: false,
};
