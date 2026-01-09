/**
 * Composes scene and draws it.
 * Picks parameters, calls core functions, draws marks.
 * Keeps React focused on layout, not math.
 */
import { useState, useRef, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  floorPolygon,
  projectSurface,
  projectIso,
  projectionForPreset,
  buildSurfaceSilhouette2D,
  type ProjectionOptions,
  type ProjectionPreset,
} from "../core/geometry";
import type { Point2D, Point3D } from "../core/types";
import {
  normalize3,
  quadNormal,
  lambert,
  inkAlphaFromBrightness,
} from "./shading";
import { TITLE_BLOCK_WIDTH, TITLE_BLOCK_HEIGHT } from "./layers/TitleBlock";
import ArchitectureLayer from "./layers/ArchitectureLayer";
import SurfaceLayer from "./layers/SurfaceLayer";
import DataLinesLayer from "./layers/DataLinesLayer";
import LabelsLayer from "./layers/LabelsLayer";
import InteractionLayer from "./layers/InteractionLayer";
import {
  buildDepthBuffer,
  type DepthBuffer,
  type OcclusionConfig,
} from "./occlusion";

import { parseSwedenCsv, makeSwedenSurface } from "../core/sweden";
import { makeFrame3D } from "../core/frame3d";
import { HOVER_HIGHLIGHT_MULT, HOVER_DIM_MULT } from "./vizConfig";

type ContourPointFile = { year: number; age: number };
type ContourFile = { level: number; points: ContourPointFile[] };
type TidyRow = ReturnType<typeof parseSwedenCsv>[number];

type PlateVizProps = {
  csvText: string;
  contours: ContourFile[] | any;
  preset?: ProjectionPreset;
  showUI?: boolean;
  canvas?: { width: number; height: number };
  frameMax?: { age: number; value: number };
  title?: { bigWord: string; years: string };
  valueLevels?: {
    left: number[];
    right: number[];
    backwallFull: number[];
    backwallRightOnly: number[];
  };
  showTitle?: boolean;
  valuesHeavyStep?: number;
  rightWallValueStep?: number;
  rightWallMinorStep?: number;
  activeKey?: string;
};

const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 700;
const FLOOR_DEPTH = 0;
const EXTEND_LEFT_YEARS = 20;
const EXTEND_RIGHT_YEARS = 10;
const DEFAULT_FRAME_MAX_AGE = 110;
const DEFAULT_FRAME_MAX_VALUE = 325_000;
const DEFAULT_VALUE_LEVELS = {
  left: [50_000, 100_000, 150_000],
  right: [50_000, 100_000, 150_000, 200_000, 250_000],
  backwallFull: [0, 50_000, 100_000, 150_000],
  backwallRightOnly: [200_000, 250_000],
};
const DEBUG_COHORT_ON_TOP = true;

// Centralized visual style for the playground.
// If you want to art-direct the plate, tweak values here.
const LINE_THIN_WIDTH = 0.5;
const LINE_THIN_OPACITY = 0.3;

const LINE_THICK_WIDTH = 1;
const LINE_THICK_OPACITY = 0.9;

const HOVER_RADIUS_PX = 16;
const HOVER_MARGIN_PX = 16;

export interface AxisLabelStyle {
  color?: string; // made optional
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  opacity: number;
}

const AXIS_LABEL_STYLE: AxisLabelStyle = {
  fontFamily: "garamond, serif",
  fontSize: 8,
  fontWeight: 600 as 400 | 500 | 600 | 700,
  opacity: 0.6,
};

const AXIS_LABEL_LAYOUT = {
  side: "both" as const,
  tickLen: 14,
  textOffset: 0,
};

const vizStyle = {
  page: {
    background: "ivory",
    text: "#eee",
  },
  svg: {
    border: "none",
    background: "ivory",
    stroke: "none",
  },
  floor: {
    fill: "none",
    stroke: "none" as "none",
  },
  wall: {
    fill: "none",
    stroke: "none" as "none",
  },
  surface: {
    fill: "ivory",
    stroke: "none",
    strokeWidth: 0.6,
  },
  years: {
    stroke: "#c0392b",
    thinWidth: LINE_THIN_WIDTH,
    thickWidth: LINE_THICK_WIDTH,
    thinOpacity: LINE_THIN_OPACITY,
    thickOpacity: LINE_THICK_OPACITY,
    heavyStep: 25, // emphasize every ## years
  },
  ages: {
    stroke: "gray",
    thinWidth: LINE_THIN_WIDTH,
    thickWidth: LINE_THICK_WIDTH,
    thinOpacity: LINE_THIN_OPACITY,
    thickOpacity: LINE_THICK_OPACITY,
    heavyStep: 25, // emphasize every ## years
  },
  cohorts: {
    stroke: "SteelBlue",
    thinWidth: LINE_THIN_WIDTH,
    thickWidth: LINE_THICK_WIDTH,
    thinOpacity: LINE_THIN_OPACITY,
    thickOpacity: LINE_THICK_OPACITY,
    heavyStep: 25, // emphasize every ## years
  },
  values: {
    stroke: "DarkSeaGreen",
    thinWidth: LINE_THIN_WIDTH,
    thickWidth: LINE_THICK_WIDTH,
    thinOpacity: LINE_THIN_OPACITY,
    thickOpacity: LINE_THICK_OPACITY,
    heavyStep: 50_000,
  },
  // lightDir is the *direction the light is coming from* in our model’s 3D (core) space.
  // We treat each quad as a tiny flat facet with a 3D normal. The dot(normal, lightDir)
  // tells us how directly that facet faces the light:
  //
  //   dot ≈ 1   → facet faces the light → brighter fill
  //   dot ≈ 0   → facet is sideways to the light → only ambient fill
  //   dot < 0   → facet faces away → we clamp to 0 (no diffuse)
  //
  // The components mean:
  //
  //   x: pushes light along the model’s X axis (roughly “year” direction on the sheet)
  //      negative x = light from the left; positive x = light from the right
  //
  //   y: pushes light along the model’s Y axis (roughly “age/depth” direction on the sheet)
  //      negative y = light from the front/toward viewer; positive y = light from the back
  //
  //   z: pushes light along the model’s Z axis (height/value)
  //      larger z = more “overhead” lighting (flatter); smaller z = more “grazing” (more relief)
  //
  // We normalize this vector, so only its *direction* matters, not its magnitude.
  // Example: {x:-1, y:-0.3, z:0.6} = a slightly overhead light coming from upper-left/front.
  shading: {
    enabled: true,
    ambient: 0.35,
    diffuse: 0.65,
    steps: 5,
    lightDir: { x: -1.0, y: -0.3, z: 0.4 },
    inkColor: "#b3a191ff",
    inkAlphaMax: 0.25,
    gamma: .4,
    shadowBias: 0.6,
    // higher alpha scale is darker
    alphaScale: {
      surface: 1,
      backWall: .5,
      rightWall: 0.5,
      floor: 0,
    },
  },
  debugPoints: {
    fill: "#ffcc66",
    opacity: 0,
    radius: 2,
  },
};


const OCCLUSION: OcclusionConfig = {
  enabled: false,
  gridW: 320,
  gridH: 320,
  epsilon: 0.02,
  mode: "dim",
  dimFactor: 0.35,
};

const TOOLTIP_WIDTH = 120;
const TOOLTIP_HEIGHT = 96;
const TOOLTIP_STYLE = {
  accent: vizStyle.debugPoints.fill,
  borderWidth: 1.5,
  bg: "rgba(255,255,240,0.92)",
  textColor: "#222",
  fontFamily: AXIS_LABEL_STYLE.fontFamily,
  fontSize: 12,
  fontWeight: 600,
  opacity: 1,
};

type Quad2D = {
  points2D: Point2D[];
  depth: number;
  corners3D: Point3D[];
  rowIndex: number;
  colIndex: number;
};

type YearLine = {
  year: number;
  points: Point2D[];
  indices: number[];
  heavy: boolean;
};
type AgeLine = {
  age: number;
  points: Point2D[];
  indices: number[];
  heavy: boolean;
};
type CohortLine = {
  birthYear: number;
  points: Point2D[];
  indices: number[];
  heavy: boolean;
};
type ValueContour2D = {
  level: number;
  points: Point2D[];
  data: { year: number; age: number }[];
};
type KissPair = {
  level: number;
  age: number;
  surface: Point2D;
  wall: Point2D;
  dist: number;
};
type CohortSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heavy: boolean;
  birthYear: number;
};
type YearSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heavy: boolean;
  year: number;
};
type AgeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heavy: boolean;
  age: number;
};
type ValueSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: number;
};

/* ---------- GEOMETRY / LAYER HELPERS ---------- */

// simple depth metric: larger = nearer to viewer
function pointDepth3D(p: Point3D): number {
  return p.x + p.y + p.z;
}

function pointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const denom = yj - yi || Number.EPSILON;
    const intersects =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / denom + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distPointToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  return Math.hypot(dx, dy);
}

function distToSilhouette(p: Point2D, poly: Point2D[]): number {
  if (poly.length === 0) return Number.POSITIVE_INFINITY;
  let minDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dist = distPointToSegment(p, a, b);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

function findRowSegmentIndex(age: number, ages: number[]): number {
  if (age < ages[0] || age > ages[ages.length - 1]) return -1;
  for (let i = 0; i < ages.length - 1; i++) {
    if (age >= ages[i] && age <= ages[i + 1]) {
      return i;
    }
  }
  return -1;
}

function findColSegmentIndex(year: number, years: number[]): number {
  if (year < years[0] || year > years[years.length - 1]) return -1;
  for (let i = 0; i < years.length - 1; i++) {
    if (year >= years[i] && year <= years[i + 1]) {
      return i;
    }
  }
  return -1;
}

function buildQuads(
  surfacePoints: Point3D[],
  rows: number,
  cols: number,
  projection: ProjectionOptions
): Quad2D[] {
  const quads: Quad2D[] = [];

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const idx00 = y * cols + x;
      const idx10 = y * cols + (x + 1);
      const idx11 = (y + 1) * cols + (x + 1);
      const idx01 = (y + 1) * cols + x;

      const p00 = surfacePoints[idx00];
      const p10 = surfacePoints[idx10];
      const p11 = surfacePoints[idx11];
      const p01 = surfacePoints[idx01];

      const corners3D: Point3D[] = [p00, p10, p11, p01];
      const corners2D: Point2D[] = corners3D.map((p) =>
        projectIso(p, projection)
      );

      const depth =
        corners3D.reduce((sum, p) => sum + pointDepth3D(p), 0) /
        corners3D.length;

      quads.push({
        points2D: corners2D,
        depth,
        corners3D,
        rowIndex: y,
        colIndex: x,
      });
    }
  }

  // painter's algorithm: draw far → near
  quads.sort((a, b) => a.depth - b.depth);
  return quads;
}

function buildYearLines(
  projectedSurface: Point2D[],
  years: number[],
  rows: number,
  cols: number
): YearLine[] {
  return years.map((year, colIndex) => {
    const pts: Point2D[] = [];
    const indices: number[] = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      const idx = rowIndex * cols + colIndex;
      pts.push(projectedSurface[idx]);
      indices.push(idx);
    }
    const heavy = (year - years[0]) % vizStyle.years.heavyStep === 0;
    return { year, points: pts, indices, heavy };
  });
}

function buildAgeLines(
  projectedSurface: Point2D[],
  ages: number[],
  _rows: number,
  cols: number
): AgeLine[] {
  return ages.map((age, rowIndex) => {
    const pts: Point2D[] = [];
    const indices: number[] = [];
    for (let colIndex = 0; colIndex < cols; colIndex++) {
      const idx = rowIndex * cols + colIndex;
      pts.push(projectedSurface[idx]);
      indices.push(idx);
    }
    const heavy = (age - ages[0]) % vizStyle.ages.heavyStep === 0;
    return { age, points: pts, indices, heavy };
  });
}

function buildCohortLines(
  swedenRowsLocal: TidyRow[],
  projectedSurface: Point2D[],
  years: number[],
  ages: number[],
  _rows: number,
  cols: number
): CohortLine[] {
  const cohortBirthYears = Array.from(
    new Set(swedenRowsLocal.map((row) => row.year - row.age))
  ).sort((a, b) => a - b);

  const cohortLines: CohortLine[] = [];
  const minYear = years[0];
  const maxAge = ages[ages.length - 1];

  for (const birthYear of cohortBirthYears) {
    const pts: Point2D[] = [];
    const indices: number[] = [];

    for (const year of years) {
      const age = year - birthYear;
      if (age < 0 || age > maxAge) continue;
      if (age % 5 !== 0) continue; // snap to 5-year age grid

      const rowIndex = ages.indexOf(age);
      const colIndex = years.indexOf(year);
      if (rowIndex === -1 || colIndex === -1) continue;

      const idx = rowIndex * cols + colIndex;
      pts.push(projectedSurface[idx]);
      indices.push(idx);
    }

    if (pts.length > 1) {
      const heavy =
        (birthYear - minYear) % vizStyle.cohorts.heavyStep === 0;
      cohortLines.push({ birthYear, points: pts, indices, heavy });
    }
  }

  return cohortLines;
}

function buildValueContours2D(
  contours: ContourFile[],
  projectedSurface: Point2D[],
  surfacePoints: Point3D[],
  ages: number[],
  years: number[],
  _rows: number,
  cols: number,
  zScale: number
): ValueContour2D[] {
  return contours.map((iso) => {
    const pts: Point2D[] = [];
    const dataPts: { year: number; age: number }[] = [];

    const contourPts = iso.points;

    const maxYearValue = years[years.length - 1];
    const EPS = 1e-6;

    const crossingAgesAtCol = (level: number, col: number): number[] => {
      if (zScale === 0) return [];
      const out: number[] = [];
      for (let row = 0; row < ages.length - 1; row++) {
        const idx0 = row * cols + col;
        const idx1 = (row + 1) * cols + col;
        const p0 = surfacePoints[idx0];
        const p1 = surfacePoints[idx1];
        if (!p0 || !p1) continue;
        const value0 = p0.z / zScale;
        const value1 = p1.z / zScale;
        if (value0 === value1) continue;
        const lo = Math.min(value0, value1);
        const hi = Math.max(value0, value1);
        if (level < lo - EPS || level > hi + EPS) continue;
        const t = (level - value0) / (value1 - value0);
        if (t < -EPS || t > 1 + EPS) continue;
        const age = ages[row] + t * (ages[row + 1] - ages[row]);
        out.push(age);
      }
      return out;
    };

    for (const pt of contourPts) {
      let adjustedAge = pt.age;
      const clampedYear =
        pt.year > maxYearValue && pt.year - maxYearValue < EPS
          ? maxYearValue
          : pt.year;
      if (Math.abs(clampedYear - maxYearValue) < EPS) {
        const crossings = crossingAgesAtCol(iso.level, cols - 1);
        if (crossings.length > 0) {
          const nearest = crossings.reduce((best, age) =>
            Math.abs(age - adjustedAge) < Math.abs(best - adjustedAge)
              ? age
              : best
          );
          adjustedAge = nearest;
        }
      }
      const colLeft = findColSegmentIndex(clampedYear, years);
      if (colLeft < 0) continue;

      const colRight = Math.min(colLeft + 1, cols - 1);
      const y0 = years[colLeft];
      const y1 = years[colRight];
      const ty = y1 === y0 ? 0 : (clampedYear - y0) / (y1 - y0);

      const rowBelow = findRowSegmentIndex(adjustedAge, ages);
      if (rowBelow < 0 || rowBelow >= _rows - 1) continue;

      const age0 = ages[rowBelow];
      const age1 = ages[rowBelow + 1];
      const ta = (adjustedAge - age0) / (age1 - age0);

      const p00 = projectedSurface[rowBelow * cols + colLeft];
      const p10 = projectedSurface[rowBelow * cols + colRight];
      const p01 = projectedSurface[(rowBelow + 1) * cols + colLeft];
      const p11 = projectedSurface[(rowBelow + 1) * cols + colRight];

      // Interpolate along year at the two age rows
      const q0x = p00.x + ty * (p10.x - p00.x);
      const q0y = p00.y + ty * (p10.y - p00.y);
      const q1x = p01.x + ty * (p11.x - p01.x);
      const q1y = p01.y + ty * (p11.y - p01.y);

      // Then interpolate along age between those two
      const x = q0x + ta * (q1x - q0x);
      const y = q0y + ta * (q1y - q0y);

      pts.push({ x, y });
      dataPts.push({ year: pt.year, age: pt.age });
    }

    return {
      level: iso.level,
      points: pts,
      data: dataPts,
    };
  });
}

function projectSurfaceYearAge(
  year: number,
  age: number,
  projectedSurface: Point2D[],
  ages: number[],
  years: number[],
  rows: number,
  cols: number
): Point2D | null {
  if (
    projectedSurface.length === 0 ||
    year < years[0] ||
    year > years[years.length - 1] ||
    age < ages[0] ||
    age > ages[ages.length - 1]
  ) {
    return null;
  }

  const colLeft = findColSegmentIndex(year, years);
  const rowBelow = findRowSegmentIndex(age, ages);
  if (colLeft < 0 || rowBelow < 0 || rowBelow >= rows - 1) return null;

  const colRight = Math.min(colLeft + 1, cols - 1);
  const rowAbove = Math.min(rowBelow + 1, rows - 1);

  const y0 = years[colLeft];
  const y1 = years[colRight];
  const ty = y1 === y0 ? 0 : (year - y0) / (y1 - y0);

  const age0 = ages[rowBelow];
  const age1 = ages[rowAbove];
  const ta = age1 === age0 ? 0 : (age - age0) / (age1 - age0);

  const p00 = projectedSurface[rowBelow * cols + colLeft];
  const p10 = projectedSurface[rowBelow * cols + colRight];
  const p01 = projectedSurface[rowAbove * cols + colLeft];
  const p11 = projectedSurface[rowAbove * cols + colRight];
  if (!p00 || !p10 || !p01 || !p11) return null;

  const q0x = p00.x + ty * (p10.x - p00.x);
  const q0y = p00.y + ty * (p10.y - p00.y);
  const q1x = p01.x + ty * (p11.x - p01.x);
  const q1y = p01.y + ty * (p11.y - p01.y);

  const x = q0x + ta * (q1x - q0x);
  const y = q0y + ta * (q1y - q0y);
  return { x, y };
}

function computeAutoCenterOffset(
  projectedSurface: Point2D[],
  floorPoints: Point2D[],
  width: number,
  height: number
): { offsetX: number; offsetY: number } {
  const allX = [
    ...projectedSurface.map((p) => p.x),
    ...floorPoints.map((p) => p.x),
  ];
  const allY = [
    ...projectedSurface.map((p) => p.y),
    ...floorPoints.map((p) => p.y),
  ];

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const currentCenterX = (minX + maxX) / 2;
  const currentCenterY = (minY + maxY) / 2;

  const targetCenterX = width / 2;
  const targetCenterY = height * 0.5; // tweak to taste

  const offsetX = targetCenterX - currentCenterX;
  const offsetY = targetCenterY - currentCenterY;

  return { offsetX, offsetY };
}

/* --------------------------- MAIN COMPONENT --------------------------- */

export default function PlateViz({
  csvText,
  contours,
  preset: presetProp = "levasseur",
  showUI = true,
  canvas,
  frameMax,
  title,
  valueLevels,
  showTitle,
  valuesHeavyStep,
  rightWallValueStep,
  rightWallMinorStep,
  activeKey,
}: PlateVizProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<null | {
    i: number;
    x: number;
    y: number;
    row: number;
    col: number;
    year: number;
    age: number;
    screenX: number;
    screenY: number;
  }>(null);

  const datasetTitleKey = title?.bigWord?.toUpperCase() ?? "";
  const normalizedKey = activeKey?.toLowerCase();
  const isUsaDataset =
    normalizedKey === "usa" ||
    datasetTitleKey.includes("UNITED") ||
    datasetTitleKey.includes("USA");

  // camera / projection based on preset
  const swedenRows = useMemo(() => {
    const parsed = parseSwedenCsv(csvText);
    if (isUsaDataset && parsed.length > 0) {
      const years = Array.from(new Set(parsed.map((r) => r.year))).sort(
        (a, b) => a - b
      );
      const ages = Array.from(new Set(parsed.map((r) => r.age))).sort(
        (a, b) => a - b
      );
      const yearFirst = years[0];
      const yearStepFirst =
        years.length > 1 ? years[1] - years[0] : Number.NaN;
      const yearLast = years[years.length - 1];
      const ageStepFirst = ages.length > 1 ? ages[1] - ages[0] : Number.NaN;
      const ageFirst = ages[0];
      const ageLast = ages[ages.length - 1];
      const uniqueYearSteps = new Set<number>();
      for (let i = 1; i < years.length; i++) {
        uniqueYearSteps.add(years[i] - years[i - 1]);
      }
      const uniqueAgeSteps = new Set<number>();
      for (let i = 1; i < ages.length; i++) {
        uniqueAgeSteps.add(ages[i] - ages[i - 1]);
      }
      let maxRow = parsed[0];
      for (const row of parsed) {
        if (row.survivors > maxRow.survivors) {
          maxRow = row;
        }
      }
    }
    return parsed;
  }, [csvText, isUsaDataset]);
  const contourData = useMemo(
    () => contours as ContourFile[],
    [contours]
  );
  const WIDTH = canvas?.width ?? DEFAULT_WIDTH;
  const HEIGHT = canvas?.height ?? DEFAULT_HEIGHT;
  const FRAME_MAX_AGE = frameMax?.age ?? DEFAULT_FRAME_MAX_AGE;
  const FRAME_MAX_VALUE = frameMax?.value ?? DEFAULT_FRAME_MAX_VALUE;
  const valueLevelConfig = valueLevels ?? DEFAULT_VALUE_LEVELS;
  const activeValuesHeavyStep =
    valuesHeavyStep ?? vizStyle.values.heavyStep;
  const activeRightWallValueStep =
    rightWallValueStep ?? activeValuesHeavyStep;
  const activeRightWallMinorStep = rightWallMinorStep ?? 10_000;
  const topValueByYear = useMemo(() => {
    const map: Record<number, number> = {};
    for (const row of swedenRows) {
      if (row.age === 0) {
        map[row.year] = row.survivors;
      }
    }
    return map;
  }, [swedenRows]);

  const projection: ProjectionOptions = useMemo(
    () => projectionForPreset(presetProp, WIDTH, HEIGHT),
    [presetProp, WIDTH, HEIGHT]
  );

  const model = useMemo(() => {
    const swedenSurface = makeSwedenSurface(swedenRows, { maxHeight: 3 });
    const { points: surfacePoints, rows, cols, years, ages } = swedenSurface;
    const maxSurvivors = swedenRows.reduce(
      (max, row) => Math.max(max, row.survivors),
      0
    );
    const frame = makeFrame3D({
      surfacePoints,
      rows,
      cols,
      years,
      ages,
      floorZ: FLOOR_DEPTH,
      maxSurvivors,
    });
    const minYearExt = frame.minYear - EXTEND_LEFT_YEARS;
    const maxYearExt = frame.maxYear + EXTEND_RIGHT_YEARS;
    const projectedSurface = projectSurface(surfacePoints, projection);
    const floorPoints = floorPolygon(rows, cols, FLOOR_DEPTH, projection);
    const silhouettePts = buildSurfaceSilhouette2D(
      projectedSurface,
      rows,
      cols
    );
    const quads = buildQuads(surfacePoints, rows, cols, projection);
    const yearLines = buildYearLines(projectedSurface, years, rows, cols);
    const ageLines = buildAgeLines(projectedSurface, ages, rows, cols);
    const cohortLines = buildCohortLines(
      swedenRows,
      projectedSurface,
      years,
      ages,
      rows,
      cols
    );
    const yearSegByQuad = new Map<string, YearSegment[]>();
    for (const line of yearLines) {
      const col = years.indexOf(line.year);
      if (col === -1) continue;
      const qc = Math.min(col, cols - 2);
      for (let row = 0; row < rows - 1; row++) {
        const p0 = line.points[row];
        const p1 = line.points[row + 1];
        if (!p0 || !p1) continue;
        const key = `${row}-${qc}`;
        const seg: YearSegment = {
          x1: p0.x,
          y1: p0.y,
          x2: p1.x,
          y2: p1.y,
          heavy: line.heavy,
          year: line.year,
        };
        const bucket = yearSegByQuad.get(key);
        if (bucket) {
          bucket.push(seg);
        } else {
          yearSegByQuad.set(key, [seg]);
        }
      }
    }
    const ageSegByQuad = new Map<string, AgeSegment[]>();
    for (const line of ageLines) {
      const row = ages.indexOf(line.age);
      if (row < 0) continue;
      const qr = Math.min(row, rows - 2);
      for (let col = 0; col < cols - 1; col++) {
        const p0 = line.points[col];
        const p1 = line.points[col + 1];
        if (!p0 || !p1) continue;
        const key = `${qr}-${col}`;
        const seg: AgeSegment = {
          x1: p0.x,
          y1: p0.y,
          x2: p1.x,
          y2: p1.y,
          heavy: line.heavy,
          age: line.age,
        };
        const bucket = ageSegByQuad.get(key);
        if (bucket) {
          bucket.push(seg);
        } else {
          ageSegByQuad.set(key, [seg]);
        }
      }
    }
    const cohortSegByQuad = new Map<string, CohortSegment[]>();
    for (const line of cohortLines) {
      if (!line.indices || line.indices.length !== line.points.length) continue;
      for (let i = 0; i < line.points.length - 1; i++) {
        const idx0 = line.indices[i];
        const idx1 = line.indices[i + 1];
        const r0 = Math.floor(idx0 / cols);
        const c0 = idx0 % cols;
        const r1 = Math.floor(idx1 / cols);
        const c1 = idx1 % cols;
        const qr = Math.min(r0, r1);
        const qc = Math.min(c0, c1);
        const key = `${qr}-${qc}`;
        const p0 = line.points[i];
        const p1 = line.points[i + 1];
        const seg: CohortSegment = {
          x1: p0.x,
          y1: p0.y,
          x2: p1.x,
          y2: p1.y,
          heavy: line.heavy,
          birthYear: line.birthYear,
        };
        const bucket = cohortSegByQuad.get(key);
        if (bucket) {
          bucket.push(seg);
        } else {
          cohortSegByQuad.set(key, [seg]);
        }
      }
    }
    const maxZ = surfacePoints.reduce((max, p) => Math.max(max, p.z), 0);
    const zScale = maxSurvivors > 0 ? maxZ / maxSurvivors : 1;
    const contourPolylines2D = buildValueContours2D(
      contourData,
      projectedSurface,
      surfacePoints,
      ages,
      years,
      rows,
      cols,
      zScale
    );
    const valueSegByQuad = new Map<string, ValueSegment[]>();
    const ageStep = ages.length > 1 ? ages[1] - ages[0] : 0;
    for (const iso of contourPolylines2D) {
      const pts = iso.points;
      const data = iso.data;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const d0 = data[i];
        const d1 = data[i + 1];
        if (!p0 || !p1 || !d0 || !d1) continue;
        const midYear = (d0.year + d1.year) / 2;
        const qc = findColSegmentIndex(midYear, years);
        if (qc < 0 || ageStep <= 0) continue;
        const a0 = d0.age;
        const a1 = d1.age;
        const tBreaks: number[] = [];
        if (a0 !== a1) {
          const minA = Math.min(a0, a1);
          const maxA = Math.max(a0, a1);
          const startK = Math.ceil(minA / ageStep);
          const endK = Math.floor(maxA / ageStep);
          for (let k = startK; k <= endK; k++) {
            const ageLine = k * ageStep;
            if (ageLine <= minA || ageLine >= maxA) continue;
            const t = (ageLine - a0) / (a1 - a0);
            if (t > 0 && t < 1) tBreaks.push(t);
          }
          tBreaks.sort((a, b) => a - b);
        }
        const tAll = [0, ...tBreaks, 1];
        for (let s = 0; s < tAll.length - 1; s++) {
          const t0 = tAll[s];
          const t1 = tAll[s + 1];
          const midT = (t0 + t1) / 2;
          const midAge = a0 + (a1 - a0) * midT;
          const qr = findRowSegmentIndex(midAge, ages);
          if (qr < 0) continue;
          const x1 = p0.x + (p1.x - p0.x) * t0;
          const y1 = p0.y + (p1.y - p0.y) * t0;
          const x2 = p0.x + (p1.x - p0.x) * t1;
          const y2 = p0.y + (p1.y - p0.y) * t1;
          const key = `${qr}-${qc}`;
          const seg: ValueSegment = { x1, y1, x2, y2, level: iso.level };
          const bucket = valueSegByQuad.get(key);
          if (bucket) {
            bucket.push(seg);
          } else {
            valueSegByQuad.set(key, [seg]);
          }
        }
      }
    }
    return {
      surfacePoints,
      rows,
      cols,
      years,
      ages,
      maxSurvivors,
      zScale,
      frame,
      minYearExt,
      maxYearExt,
      projectedSurface,
      floorPoints,
      silhouettePts,
      quads,
      yearLines,
      ageLines,
      cohortLines,
      yearSegByQuad,
      ageSegByQuad,
      cohortSegByQuad,
      valueSegByQuad,
      contourPolylines2D,
      maxZ,
    };
  }, [projection, swedenRows, contourData]);
  const layersEnabled = {
    architecture: true,
    surface: true,
    lines: true,
    cohortLines: true,
    labels: true,
    interaction: true,
  };
  const depthBuffer: DepthBuffer | null = useMemo(() => {
    if (!model.projectedSurface.length || !model.surfacePoints.length) {
      return null;
    }
    return buildDepthBuffer(
      model.projectedSurface,
      model.surfacePoints,
      OCCLUSION.gridW,
      OCCLUSION.gridH
    );
  }, [model.projectedSurface, model.surfacePoints]);

  const { offsetX, offsetY } = useMemo(() => {
    return computeAutoCenterOffset(
      model.projectedSurface,
      model.floorPoints,
      WIDTH,
      HEIGHT
    );
  }, [model.projectedSurface, model.floorPoints, WIDTH, HEIGHT]);
  const maxZ = model.maxZ;
  const shadingConfig = vizStyle.shading;
  const lightDir = normalize3(shadingConfig.lightDir);
  const floorNormal = quadNormal(
    model.frame.point(model.minYearExt, 0, 0),
    model.frame.point(model.minYearExt, 25, 0),
    model.frame.point(model.frame.minYear, 0, 0)
  );
  const floorBrightness = lambert(
    floorNormal,
    lightDir,
    shadingConfig.ambient,
    shadingConfig.diffuse
  );
  const floorAlpha =
    shadingConfig.enabled
      ? inkAlphaFromBrightness({
        brightness: floorBrightness,
        ambient: shadingConfig.ambient,
        diffuse: shadingConfig.diffuse,
        steps: shadingConfig.steps,
        inkAlphaMax: shadingConfig.inkAlphaMax,
        gamma: shadingConfig.gamma,
        shadowBias: shadingConfig.shadowBias,
        alphaScale: shadingConfig.alphaScale.floor,
      })
      : 0;

  const floorFramePoints = [
    projectIso(model.frame.point(model.minYearExt, 0, 0), projection),
    projectIso(
      model.frame.point(model.minYearExt, FRAME_MAX_AGE, 0),
      projection
    ),
    projectIso(
      model.frame.point(model.maxYearExt, FRAME_MAX_AGE, 0),
      projection
    ),
    projectIso(model.frame.point(model.maxYearExt, 0, 0), projection),
    projectIso(model.frame.point(model.minYearExt, 0, 0), projection),
  ];
  const backWallFramePoints = [
    projectIso(model.frame.point(model.minYearExt, 0, 0), projection),
    projectIso(model.frame.point(model.maxYearExt, 0, 0), projection),
    projectIso(
      model.frame.point(model.maxYearExt, 0, FRAME_MAX_VALUE),
      projection
    ),
    projectIso(
      model.frame.point(model.minYearExt, 0, FRAME_MAX_VALUE),
      projection
    ),
    projectIso(model.frame.point(model.minYearExt, 0, 0), projection),
  ];
  const floorFrameString = floorFramePoints
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
  const backWallTopLeft = backWallFramePoints[3];
  const titlePos = {
    x: backWallTopLeft.x - TITLE_BLOCK_WIDTH * 0.5,
    y: backWallTopLeft.y - TITLE_BLOCK_HEIGHT - 12,
  };
  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || model.silhouettePts.length === 0) {
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = event.clientX - rect.left;
    const svgY = event.clientY - rect.top;
    const scenePoint = { x: svgX - offsetX, y: svgY - offsetY };
    const inside = pointInPolygon(scenePoint, model.silhouettePts);
    const near =
      distToSilhouette(scenePoint, model.silhouettePts) <= HOVER_MARGIN_PX;
    if (!inside && !near) {
      setHover(null);
      return;
    }
    let nearestIndex = -1;
    let nearestDist2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < model.projectedSurface.length; i++) {
      const pt = model.projectedSurface[i];
      const dx = pt.x - scenePoint.x;
      const dy = pt.y - scenePoint.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < nearestDist2) {
        nearestDist2 = dist2;
        nearestIndex = i;
      }
    }
    if (
      nearestIndex === -1 ||
      nearestDist2 > HOVER_RADIUS_PX * HOVER_RADIUS_PX
    ) {
      setHover(null);
      return;
    }
    const row = Math.floor(nearestIndex / model.cols);
    const col = nearestIndex % model.cols;
    setHover({
      i: nearestIndex,
      x: model.projectedSurface[nearestIndex].x,
      y: model.projectedSurface[nearestIndex].y,
      row,
      col,
      year: model.years[col],
      age: model.ages[row],
      screenX: svgX,
      screenY: svgY,
    });
  };

  const handleMouseLeave = () => {
    setHover(null);
  };

  const handleDownloadSvg = () => {
    if (!svgRef.current) {
      return;
    }
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.querySelector("#layer-interaction")?.remove();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    const serialized = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "porozzo-sweden-1750-1875.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const tooltipData = hover
    ? {
      left: Math.min(
        Math.max(hover.screenX + 14, 0),
        WIDTH - TOOLTIP_WIDTH
      ),
      top: Math.min(
        Math.max(hover.screenY - 14, 0),
        HEIGHT - TOOLTIP_HEIGHT
      ),
      survivors:
        maxZ > 0
          ? Math.max(
            0,
            Math.round(
              ((model.surfacePoints[hover.i]?.z ?? 0) / maxZ) *
              model.maxSurvivors
            )
          )
          : 0,
    }
    : null;
  const tooltipTextStyle = {
    fontFamily: TOOLTIP_STYLE.fontFamily,
    fontSize: TOOLTIP_STYLE.fontSize,
    fontWeight: TOOLTIP_STYLE.fontWeight,
    opacity: TOOLTIP_STYLE.opacity,
  };
  const focusYear = hover?.year ?? null;
  const focusAge = hover?.age ?? null;
  const focusBirthYear = hover ? hover.year - hover.age : null;
  const hoverFocus =
    focusYear !== null && focusAge !== null && focusBirthYear !== null
      ? { year: focusYear, age: focusAge, birthYear: focusBirthYear }
      : null;
  const ageStart = hover ? Math.max(0, hover.age - 4) : 0;
  const ageLineText =
    hover && hover.age === 0
      ? "Births"
      : hover
        ? `${ageStart} to ${hover.age} years old`
        : "";
  const bornEnd = hover ? hover.year - hover.age : 0;
  const bornStart = hover ? Math.max(0, bornEnd - 4) : 0;
  const bornLineText = hover ? `born ${bornStart} to ${bornEnd}` : "";
  const backWallStyle = {
    stroke: vizStyle.values.stroke,
    thinWidth: vizStyle.values.thinWidth,
    thickWidth: vizStyle.values.thickWidth,
    thinOpacity: vizStyle.values.thinOpacity,
    thickOpacity: vizStyle.values.thickOpacity,
    heavyStep: activeValuesHeavyStep,
  };
  const floorStyle = {
    fill: vizStyle.surface.fill,
    stroke: vizStyle.floor.stroke,
  };
  const floorAgeStyle = {
    stroke: vizStyle.ages.stroke,
    strokeWidth: vizStyle.ages.thickWidth,
  };
  const rightWallStyle = {
    wallFill: vizStyle.wall.fill,
    wallStroke: vizStyle.wall.stroke,
    ageStroke: vizStyle.ages.stroke,
    ageThin: vizStyle.ages.thinWidth,
    ageThick: vizStyle.ages.thickWidth,
    ageHeavyStep: vizStyle.ages.heavyStep,
    ageThinOpacity: vizStyle.ages.thinOpacity,
    ageThickOpacity: vizStyle.ages.thickOpacity,
    valueStroke: vizStyle.values.stroke,
    valueThin: vizStyle.values.thinWidth,
    valueThick: vizStyle.values.thickWidth,
    valueHeavyStep: activeValuesHeavyStep,
    valueThinOpacity: vizStyle.values.thinOpacity,
    valueThickOpacity: vizStyle.values.thickOpacity,
    surfaceFill: vizStyle.surface.fill,
    surfaceStroke: vizStyle.surface.stroke,
    surfaceStrokeWidth: vizStyle.surface.strokeWidth,
  };
  const linesVizStyle = {
    years: vizStyle.years,
    ages: vizStyle.ages,
    cohorts: vizStyle.cohorts,
    values: {
      ...vizStyle.values,
      heavyStep: activeValuesHeavyStep,
    },
    debugPoints: vizStyle.debugPoints,
  };
  const surfaceClipId = "surfaceClip";
  const silhouettePointsStr = model.silhouettePts
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
  const leftEdgePts: Point2D[] = [];
  const rightEdgePts: Point2D[] = [];
  const topEdgePts: Point2D[] = [];
  const bottomEdgePts: Point2D[] = [];
  for (let row = 0; row < model.rows; row++) {
    const left = model.projectedSurface[row * model.cols];
    const right = model.projectedSurface[row * model.cols + (model.cols - 1)];
    if (left) leftEdgePts.push(left);
    if (right) rightEdgePts.push(right);
  }
  for (let col = 0; col < model.cols; col++) {
    const top = model.projectedSurface[col];
    const bottom =
      model.projectedSurface[(model.rows - 1) * model.cols + col];
    if (top) topEdgePts.push(top);
    if (bottom) bottomEdgePts.push(bottom);
  }
  const leftEdgeStr = leftEdgePts.map((p) => `${p.x},${p.y}`).join(" ");
  const rightEdgeStr = rightEdgePts.map((p) => `${p.x},${p.y}`).join(" ");
  const topEdgeStr = topEdgePts.map((p) => `${p.x},${p.y}`).join(" ");
  const bottomEdgeStr = bottomEdgePts.map((p) => `${p.x},${p.y}`).join(" ");
  const titleProps = {
    x: titlePos.x + 125,
    y: titlePos.y + 130,
    style: { text: "#282828ff" },
    legend: {
      ages: vizStyle.ages.stroke,
      values: vizStyle.values.stroke,
      cohorts: vizStyle.cohorts.stroke,
      years: vizStyle.years.stroke,
      thin: LINE_THIN_WIDTH,
      thick: LINE_THICK_WIDTH,
    },
    title,
  };

  return (
    <div
      style={{
        padding: "1rem",
        background: vizStyle.page.background,
        color: vizStyle.page.text,
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      {showUI && (
        <button
          type="button"
          onClick={handleDownloadSvg}
          style={{
            marginBottom: "0.5rem",
            padding: "0.4rem 0.8rem",
            fontFamily: "inherit",
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          Download SVG
        </button>
      )}
      <div
        style={{
          position: "relative",
          width: WIDTH,
          height: HEIGHT,
        }}
      >
        <svg
          ref={svgRef}
          width={WIDTH}
          height={HEIGHT}
          style={{
            border: `1px solid ${vizStyle.svg.border}`,
            background: vizStyle.svg.background,
            display: "block",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <g transform={`translate(${offsetX}, ${offsetY})`}>
            {layersEnabled.architecture && (
              <ArchitectureLayer
                frame={model.frame}
                projection={projection}
                minYearExt={model.minYearExt}
                maxYearExt={model.maxYearExt}
                extendLeftYears={EXTEND_LEFT_YEARS}
                extendRightYears={EXTEND_RIGHT_YEARS}
                floorFrameString={floorFrameString}
                floorAlpha={floorAlpha}
                shadingInkColor={shadingConfig.inkColor}
                backWallStyle={backWallStyle}
                backwallFullLevels={valueLevelConfig.backwallFull}
                backwallRightLevels={valueLevelConfig.backwallRightOnly}
                floorStyle={floorStyle}
                floorAgeStyle={floorAgeStyle}
                rightWallStyle={rightWallStyle}
                shadingConfig={shadingConfig}
                surfacePoints={model.surfacePoints}
                rows={model.rows}
                cols={model.cols}
                ages={model.ages}
                maxSurvivors={model.maxSurvivors}
                floorZ={FLOOR_DEPTH}
                valueStep={activeRightWallValueStep}
                valueMinorStep={activeRightWallMinorStep}
              />
            )}
            {layersEnabled.surface && (
              <>
                <SurfaceLayer
                  quads={model.quads}
                  surfaceStyle={{
                    fill: vizStyle.surface.fill,
                    stroke: vizStyle.surface.stroke,
                    strokeWidth: vizStyle.surface.strokeWidth,
                  }}
                  shading={shadingConfig}
                  lightDir={lightDir}
                  drawSegments={false}
                  yearSegByQuad={model.yearSegByQuad}
                  yearStyle={vizStyle.years}
                  ageSegByQuad={model.ageSegByQuad}
                  ageStyle={vizStyle.ages}
                valueSegByQuad={model.valueSegByQuad}
                valueStyle={linesVizStyle.values}
                cohortSegByQuad={
                  DEBUG_COHORT_ON_TOP ? undefined : model.cohortSegByQuad
                }
                cohortStyle={vizStyle.cohorts}
              />
                <g>
                  <SurfaceLayer
                    quads={model.quads}
                    surfaceStyle={{
                      fill: vizStyle.surface.fill,
                      stroke: vizStyle.surface.stroke,
                      strokeWidth: vizStyle.surface.strokeWidth,
                    }}
                    shading={shadingConfig}
                    lightDir={lightDir}
                    drawQuads={false}
                    yearSegByQuad={model.yearSegByQuad}
                    yearStyle={vizStyle.years}
                    ageSegByQuad={model.ageSegByQuad}
                    ageStyle={vizStyle.ages}
                    valueSegByQuad={model.valueSegByQuad}
                    valueStyle={linesVizStyle.values}
                    cohortSegByQuad={model.cohortSegByQuad}
                    cohortStyle={vizStyle.cohorts}
                  />
                </g>
                <g id="surface-boundary">
                  <polyline
                    points={leftEdgeStr}
                    fill="none"
                    stroke={vizStyle.years.stroke}
                    strokeWidth={vizStyle.years.thickWidth}
                    strokeOpacity={vizStyle.years.thickOpacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={rightEdgeStr}
                    fill="none"
                    stroke={vizStyle.years.stroke}
                    strokeWidth={vizStyle.years.thickWidth}
                    strokeOpacity={vizStyle.years.thickOpacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={topEdgeStr}
                    fill="none"
                    stroke={vizStyle.ages.stroke}
                    strokeWidth={vizStyle.ages.thickWidth}
                    strokeOpacity={vizStyle.ages.thickOpacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={bottomEdgeStr}
                    fill="none"
                    stroke={vizStyle.ages.stroke}
                    strokeWidth={vizStyle.ages.thickWidth}
                    strokeOpacity={vizStyle.ages.thickOpacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </>
            )}
            {layersEnabled.lines && (
              <DataLinesLayer
                yearLines={model.yearLines}
                ageLines={model.ageLines}
                cohortLines={model.cohortLines}
                contourPolylines2D={model.contourPolylines2D}
                vizStyle={linesVizStyle}
                projectedSurface={model.projectedSurface}
                focus={hoverFocus}
                hoverOpacity={{
                  highlightMult: HOVER_HIGHLIGHT_MULT,
                  dimMult: HOVER_DIM_MULT,
                }}
                drawValues={false}
                drawAges={false}
                drawYears={false}
                showCohortLines={DEBUG_COHORT_ON_TOP}
                depthBuffer={depthBuffer}
                occlusion={OCCLUSION}
                surfacePoints={model.surfacePoints}
              />
            )}
            {layersEnabled.labels && (
              <LabelsLayer
                frame={model.frame}
                projection={projection}
                years={model.years}
                minYearExt={model.minYearExt}
                maxYearExt={model.maxYearExt}
                axisLabelBaseStyle={AXIS_LABEL_STYLE}
                axisLabelLayout={AXIS_LABEL_LAYOUT}
                vizStyle={{
                  ages: { stroke: vizStyle.ages.stroke },
                  values: { stroke: vizStyle.values.stroke },
                  years: { stroke: vizStyle.years.stroke },
                }}
                valueLevels={{
                  left: valueLevelConfig.left,
                  right: valueLevelConfig.right,
                }}
                showTitle={showTitle}
                titleProps={titleProps}
                topValueByYear={topValueByYear}
              />
            )}
            {layersEnabled.interaction && (
              <InteractionLayer
                hover={hover ? { x: hover.x, y: hover.y } : null}
                accentColor={TOOLTIP_STYLE.accent}
                radius={vizStyle.debugPoints.radius * 2}
                strokeWidth={TOOLTIP_STYLE.borderWidth}
              />
            )}
          </g>
        </svg>
        {hover && tooltipData && (
          <div
            style={{
              position: "absolute",
              left: tooltipData.left,
              top: tooltipData.top,
              minWidth: 96,
              maxWidth: TOOLTIP_WIDTH,
              background: TOOLTIP_STYLE.bg,
              border: `${TOOLTIP_STYLE.borderWidth}px solid ${TOOLTIP_STYLE.accent}`,
              borderRadius: 6,
              padding: "6px 10px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
              pointerEvents: "none",
              fontFamily: TOOLTIP_STYLE.fontFamily,
              lineHeight: 1.05,
            }}
          >
            <div
              style={{
                color: vizStyle.years.stroke,
                ...tooltipTextStyle,
              }}
            >
              In {hover.year}
            </div>
            <div
              style={{
                color: vizStyle.values.stroke,
                ...tooltipTextStyle,
              }}
            >
              {tooltipData.survivors.toLocaleString("en-US")} living males
            </div>
            <div
              style={{
                color: vizStyle.ages.stroke,
                ...tooltipTextStyle,
              }}
            >
              {ageLineText}
            </div>
            <div
              style={{
                color: vizStyle.cohorts.stroke,
                ...tooltipTextStyle,
              }}
            >
              {bornLineText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
