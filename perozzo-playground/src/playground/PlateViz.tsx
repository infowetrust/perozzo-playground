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
import LabelsLayer from "./layers/LabelsLayer";
import InteractionLayer from "./layers/InteractionLayer";
import RightWall from "./layers/RightWall";
import TopView from "./layers/TopView";

import { parseSwedenCsv, makeSwedenSurface } from "../core/sweden";
import { makeFrame3D, type Frame3D } from "../core/frame3d";
import { TRI_RENDER } from "./vizConfig";
import { segmentizeContourPolyline } from "./contourSegmenter";

type ContourPointFile = { year: number; age: number };
type ContourFile = {
  level: number;
  runId?: number;
  points?: ContourPointFile[];
  runs?: ContourPointFile[][];
};
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
  maxHeight?: number;
  projectionTweaks?: {
    ageScaleMultiplier?: number;
    ageAxisAngleDeg?: number;
  };
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
const DEBUG_CONTOUR_PROJ = false;
const DEBUG_CONTOUR_LEVEL = 10_000_000;
let contourDebugLogged = false;
const FEATURES = {
  labels: true,
  hover: true,
  exportSvg: true,
  rightWall: true,
  occlusion: true,
};

// Centralized visual style for the playground.
// If you want to art-direct the plate, tweak values here.
const LINE_THIN_WIDTH = 0.5;
const LINE_THIN_OPACITY = 0.3;

const LINE_THICK_WIDTH = 1;
const LINE_THICK_OPACITY = 0.9;

const HOVER_RADIUS_PX = 16;
const HOVER_MARGIN_PX = 16;
const BIRTHS_SKYLINE_EPS = 1e-6;

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

    // ambient: baseline brightness applied everywhere (independent of light angle).
    // Higher = flatter/less contrast; lower = deeper shadows and more relief.
    ambient: 0.5,      // Sweden was 0.35

    // diffuse: angle‑dependent brightness from the light direction.
    // Higher = stronger highlight/shadow contrast; lower = softer shading.
    diffuse: .2,      // Sweden was 0.65

    steps: 7,           // Sweden was 5

    // lightDir is in model space (x=year axis, y=age/depth axis, z=value/height).
    // Negative x = light from the left; positive x = from the right.
    // Negative y = light from the front (toward viewer); positive y = from the back.
    // Higher z = more overhead; lower z = more grazing (stronger ridge relief).

    lightDir: { x: -.5, y: 0.5, z: 0.35 }, // Sweden was x: -1.0, y: -0.3, z: 0.4 
    inkColor: "#b3a191ff",

    // inkAlphaMax: upper cap on the shadow-ink overlay opacity.
    // Higher = darker/more contrasty shading; lower = lighter, subtler relief.
    inkAlphaMax: 0.45,  // Sweden was 0.25

    // gamma: perceptual curve for brightness → ink mapping.
    // Higher = compresses highlights and emphasizes mid/shadows; lower = flatter, more linear shading.
    gamma: 0.6,         // Sweden was 0.4

    // shadowBias: shifts the brightness threshold before ink appears.
    // Higher = fewer areas receive shadow ink (cleaner, flatter); lower = more area gets ink (stronger shading).
    shadowBias: 0.45,   // Sweden was 0.6

    // higher alpha scale is darker
    alphaScale: {
      surface: 1,     // Sweden was 1
      backWall: .5,
      rightWall: 0.2, // Sweden was 0.5
      floor: 0,
    },
  },
  debugPoints: {
    fill: "#ffcc66",
    opacity: 0,
    radius: 2,
  },
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
  depth2D: number;
  corners3D: Point3D[];
  rowIndex: number;
  colIndex: number;
};
type Tri2 = {
  pts2: [Point2D, Point2D, Point2D];
  pts3: [Point3D, Point3D, Point3D];
  degenerate?: boolean;
};
type CellRender = {
  cellKey: string;
  depthKey: number;
  tris: Tri2[];
  split4?: boolean;
  splitCenter?: Point2D;
};

const CELL_SORT_MODE: "avgXYZ" | "maxY" = "avgXYZ";
const ISLAND_AREA_MULT = 1.05;

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
  runId?: number;
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
  visible?: boolean;
};
type ValueSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: number;
};

type Vec3 = { x: number; y: number; z: number };
let triCellHistLogged = false;
let split4CountLogged = false;

/* ---------- GEOMETRY / LAYER HELPERS ---------- */

function sub3(a: Point3D, b: Point3D): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross3(u: Vec3, v: Vec3): Vec3 {
  return {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
}
function norm3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z) || 1;
}
function normalizeV3(v: Vec3): Vec3 {
  const n = norm3(v);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
function triNormal(a: Point3D, b: Point3D, c: Point3D): Vec3 {
  const u = sub3(b, a);
  const v = sub3(c, a);
  return normalizeV3(cross3(u, v));
}
function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function triArea2(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function avg3(a: Point2D, b: Point2D, c: Point2D): Point2D {
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}
function triDepthKeyMaxY(a: Point2D, b: Point2D, c: Point2D): number {
  return Math.max(a.y, b.y, c.y);
}
function avg3D(
  a: Point3D,
  b: Point3D,
  c: Point3D,
  d: Point3D
): Point3D {
  return {
    x: (a.x + b.x + c.x + d.x) / 4,
    y: (a.y + b.y + c.y + d.y) / 4,
    z: (a.z + b.z + c.z + d.z) / 4,
  };
}
function diagIntersection2D(
  a: Point2D,
  c: Point2D,
  b: Point2D,
  d: Point2D
): Point2D | null {
  const x1 = a.x;
  const y1 = a.y;
  const x2 = c.x;
  const y2 = c.y;
  const x3 = b.x;
  const y3 = b.y;
  const x4 = d.x;
  const y4 = d.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return null;
  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) -
      (x1 - x2) * (x3 * y4 - y3 * x4)) /
    denom;
  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) -
      (y1 - y2) * (x3 * y4 - y3 * x4)) /
    denom;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { x: px, y: py };
}
function dist2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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
      const depth2D =
        (corners2D[0].y +
          corners2D[1].y +
          corners2D[2].y +
          corners2D[3].y) /
        4;

      const depth =
        corners3D.reduce((sum, p) => sum + pointDepth3D(p), 0) /
        corners3D.length;

      quads.push({
        points2D: corners2D,
        depth,
        depth2D,
        corners3D,
        rowIndex: y,
        colIndex: x,
      });
    }
  }

  // painter's algorithm: draw far → near
  quads.sort((a, b) => {
    if (a.depth2D !== b.depth2D) return a.depth2D - b.depth2D;
    const ax =
      (a.points2D[0].x +
        a.points2D[1].x +
        a.points2D[2].x +
        a.points2D[3].x) /
      4;
    const bx =
      (b.points2D[0].x +
        b.points2D[1].x +
        b.points2D[2].x +
        b.points2D[3].x) /
      4;
    if (ax !== bx) return ax - bx;
    return (a.depth ?? 0) - (b.depth ?? 0);
  });
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
  _projectedSurface: Point2D[],
  surfacePoints: Point3D[],
  ages: number[],
  years: number[],
  _rows: number,
  cols: number,
  zScale: number,
  frame: Frame3D,
  projection: ProjectionOptions
): ValueContour2D[] {
  const maxYearValue = years[years.length - 1];
  const EPS = 1e-6;

  const ensureRightBoundaryPoint = (
    pts: ContourPointFile[]
  ): ContourPointFile[] => {
    if (pts.length < 2) return pts;
    if (pts.some((p) => Math.abs(p.year - maxYearValue) < EPS)) {
      return pts;
    }
    let insertIndex = -1;
    let intersectAge = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const minY = Math.min(a.year, b.year);
      const maxY = Math.max(a.year, b.year);
      if (maxYearValue < minY - EPS || maxYearValue > maxY + EPS) {
        continue;
      }
      const dy = b.year - a.year;
      if (Math.abs(dy) < EPS) continue;
      const t = (maxYearValue - a.year) / dy;
      if (t < -EPS || t > 1 + EPS) continue;
      intersectAge = a.age + t * (b.age - a.age);
      insertIndex = i + 1;
    }
    if (insertIndex === -1) {
      return pts;
    }
    const next = pts.slice();
    next.splice(insertIndex, 0, {
      year: maxYearValue,
      age: intersectAge,
    });
    return next;
  };

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

  const buildRun = (
    iso: ContourFile,
    contourPts: ContourPointFile[]
  ): ValueContour2D | null => {
    const pts: Point2D[] = [];
    const dataPts: { year: number; age: number }[] = [];

    const contourWithBoundary = ensureRightBoundaryPoint(contourPts);

    for (const pt of contourWithBoundary) {
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
      const directPoint = projectIso(
        frame.point(clampedYear, adjustedAge, iso.level),
        projection
      );
      pts.push(directPoint);
      dataPts.push({ year: clampedYear, age: adjustedAge });
    }

    if (pts.length < 2) return null;
    return {
      level: iso.level,
      runId: iso.runId,
      points: pts,
      data: dataPts,
    };
  };

  return contours.flatMap((iso) => {
    const runs =
      iso.runs ??
      (iso.points && iso.points.length > 0 ? [iso.points] : []);
    return runs
      .map((run) => buildRun(iso, run))
      .filter((run): run is ValueContour2D => run !== null);
  });
}

function isClosedRun(
  points: ContourPointFile[],
  eps = 1e-6
): boolean {
  if (points.length < 2) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    Math.abs(first.year - last.year) <= eps &&
    Math.abs(first.age - last.age) <= eps
  );
}

function runAreaYearAge(points: ContourPointFile[]): number {
  if (points.length < 3) return 0;
  const closed = isClosedRun(points);
  const pts = closed ? points.slice(0, -1) : points;
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.year * b.age - b.year * a.age;
  }
  return Math.abs(sum) / 2;
}

function flattenContourRuns(contours: ContourFile[]): ContourFile[] {
  const out: ContourFile[] = [];
  let runId = 0;
  for (const iso of contours) {
    if (iso.runs && iso.runs.length > 0) {
      for (const run of iso.runs) {
        out.push({ level: iso.level, points: run, runId });
        runId += 1;
      }
      continue;
    }
    if (iso.points && iso.points.length > 0) {
      out.push({ level: iso.level, points: iso.points, runId });
      runId += 1;
    }
  }
  return out;
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
  maxHeight = 3,
  projectionTweaks,
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
  const globalTriSort = true;
  const [topShowYears, setTopShowYears] = useState<boolean>(true);
  const [topShowAges, setTopShowAges] = useState<boolean>(true);
  const [topShowCohorts, setTopShowCohorts] = useState<boolean>(true);
  const [topShowContours, setTopShowContours] = useState<boolean>(true);
  const [topShowContourCrossings, setTopShowContourCrossings] =
    useState<boolean>(false);
  const [topContourMode, setTopContourMode] =
    useState<"raw" | "segmented">("raw");
  const topViewSvgRef = useRef<SVGSVGElement | null>(null);

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
  const contourRuns = useMemo(
    () => flattenContourRuns(contourData),
    [contourData]
  );
  const topViewContourRuns = useMemo(
    () =>
      contourRuns
        .filter(
          (run): run is { level: number; points: YearAgePoint[]; runId?: number } =>
            !!run.points && run.points.length > 0
        )
        .map((run) => ({
          level: run.level,
          points: run.points,
          runId: run.runId,
        })),
    [contourRuns]
  );
  const stereoContourRuns = useMemo(() => {
    const targetLevel = 12_000_000;
    const closedRuns = contourRuns.filter(
      (run) =>
        run.level === targetLevel &&
        run.points &&
        isClosedRun(run.points)
    );
    const maxArea = closedRuns.reduce((max, run) => {
      if (!run.points) return max;
      return Math.max(max, runAreaYearAge(run.points));
    }, 0);
    const threshold = maxArea * ISLAND_AREA_MULT;
    return contourRuns.filter((run) => {
      if (!run.points || run.points.length < 3) return true;
      if (!isClosedRun(run.points)) return true;
      const area = runAreaYearAge(run.points);
      return area > threshold;
    });
  }, [contourRuns]);
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

  const projection: ProjectionOptions = useMemo(() => {
    const base = projectionForPreset(presetProp, WIDTH, HEIGHT);
    const ageScaleMultiplier = projectionTweaks?.ageScaleMultiplier;
    const ageAxisAngleDeg = projectionTweaks?.ageAxisAngleDeg;
    const scale =
      ageScaleMultiplier && ageScaleMultiplier !== 1
        ? ageScaleMultiplier
        : 1;
    const nextBasisY = {
      x: base.basis.basisY.x * scale,
      y: base.basis.basisY.y * scale,
    };
    if (ageAxisAngleDeg === undefined) {
      if (scale === 1) {
        return base;
      }
      return {
        ...base,
        basis: {
          ...base.basis,
          basisY: nextBasisY,
        },
      };
    }
    const mag = Math.hypot(nextBasisY.x, nextBasisY.y) || 1;
    const rad = (ageAxisAngleDeg * Math.PI) / 180;
    return {
      ...base,
      basis: {
        ...base.basis,
        basisY: {
          x: Math.cos(rad) * mag,
          y: Math.sin(rad) * mag,
        },
      },
    };
  }, [
    presetProp,
    WIDTH,
    HEIGHT,
    projectionTweaks?.ageScaleMultiplier,
    projectionTweaks?.ageAxisAngleDeg,
  ]);

  const model = useMemo(() => {
    const swedenSurface = makeSwedenSurface(swedenRows, { maxHeight });
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
    const cellMap = new Map<string, CellRender>();
    let split4Count = 0;
    const triangles = TRI_RENDER.enabled
      ? (() => {
        const tris: {
          pts2: [Point2D, Point2D, Point2D];
          pts3: [Point3D, Point3D, Point3D];
          depthKey: number;
          cellKey: string;
          cx: number;
          cy: number;
          isPrimaryForCell: boolean;
        }[] = [];
        for (const quad of quads) {
          const [p00, p10, p11, p01] = quad.corners3D;
          const [P00, P10, P11, P01] = quad.points2D;
          const center3D = avg3D(p00, p10, p11, p01);
          const center2D = projectIso(center3D, projection);
          const diagCenter2D = diagIntersection2D(P00, P11, P10, P01);
          const shouldSplit4 =
            TRI_RENDER.split4Enabled &&
            diagCenter2D !== null &&
            dist2D(center2D, diagCenter2D) >= TRI_RENDER.split4CenterDiffPx;
          const cellKey = `${quad.rowIndex}-${quad.colIndex}`;
          if (shouldSplit4) {
            const tris4: Tri2[] = [
              {
                pts2: [P00, P10, center2D] as [
                  Point2D,
                  Point2D,
                  Point2D
                ],
                pts3: [p00, p10, center3D] as [
                  Point3D,
                  Point3D,
                  Point3D
                ],
              },
              {
                pts2: [P10, P11, center2D] as [
                  Point2D,
                  Point2D,
                  Point2D
                ],
                pts3: [p10, p11, center3D] as [
                  Point3D,
                  Point3D,
                  Point3D
                ],
              },
              {
                pts2: [P11, P01, center2D] as [
                  Point2D,
                  Point2D,
                  Point2D
                ],
                pts3: [p11, p01, center3D] as [
                  Point3D,
                  Point3D,
                  Point3D
                ],
              },
              {
                pts2: [P01, P00, center2D] as [
                  Point2D,
                  Point2D,
                  Point2D
                ],
                pts3: [p01, p00, center3D] as [
                  Point3D,
                  Point3D,
                  Point3D
                ],
              },
            ].map((tri) => {
              const area2 = triArea2(tri.pts2[0], tri.pts2[1], tri.pts2[2]);
              const absArea2 = Math.abs(area2);
              if (area2 < 0) {
                return {
                  ...tri,
                  pts2: [
                    tri.pts2[0],
                    tri.pts2[2],
                    tri.pts2[1],
                  ] as [Point2D, Point2D, Point2D],
                  degenerate: absArea2 < TRI_RENDER.minArea2D,
                };
              }
              return {
                ...tri,
                degenerate: absArea2 < TRI_RENDER.minArea2D,
              };
            });
            const p00d = surfacePoints[quad.rowIndex * cols + quad.colIndex];
            const p10d =
              surfacePoints[quad.rowIndex * cols + (quad.colIndex + 1)];
            const p11d =
              surfacePoints[(quad.rowIndex + 1) * cols + (quad.colIndex + 1)];
            const p01d =
              surfacePoints[(quad.rowIndex + 1) * cols + quad.colIndex];
            const avgDepth3D =
              (pointDepth3D(p00d) +
                pointDepth3D(p10d) +
                pointDepth3D(p11d) +
                pointDepth3D(p01d)) /
              4;
            const maxYDepth = Math.max(
              ...tris4.flatMap((t) => t.pts2.map((p) => p.y))
            );
            const cellDepthKey =
              CELL_SORT_MODE === "avgXYZ" ? avgDepth3D : maxYDepth;
            cellMap.set(cellKey, {
              cellKey,
              depthKey: cellDepthKey,
              tris: tris4,
              split4: true,
              splitCenter: center2D,
            });
            split4Count += 1;
            continue;
          }
          const diagA = [
            {
              pts2: [P00, P10, P11] as [Point2D, Point2D, Point2D],
              pts3: [p00, p10, p11] as [Point3D, Point3D, Point3D],
            },
            {
              pts2: [P00, P11, P01] as [Point2D, Point2D, Point2D],
              pts3: [p00, p11, p01] as [Point3D, Point3D, Point3D],
            },
          ];
          const diagB = [
            {
              pts2: [P00, P10, P01] as [Point2D, Point2D, Point2D],
              pts3: [p00, p10, p01] as [Point3D, Point3D, Point3D],
            },
            {
              pts2: [P10, P11, P01] as [Point2D, Point2D, Point2D],
              pts3: [p10, p11, p01] as [Point3D, Point3D, Point3D],
            },
          ];
          const areaScore = (t: { pts2: [Point2D, Point2D, Point2D] }) =>
            Math.abs(triArea2(t.pts2[0], t.pts2[1], t.pts2[2]));
          const scoreA = Math.min(areaScore(diagA[0]), areaScore(diagA[1]));
          const scoreB = Math.min(areaScore(diagB[0]), areaScore(diagB[1]));
          const candidates = scoreA >= scoreB ? diagA : diagB;
          const kept: {
            pts2: [Point2D, Point2D, Point2D];
            pts3: [Point3D, Point3D, Point3D];
            depthKey: number;
            cx: number;
            cy: number;
            degenerate?: boolean;
          }[] = [];
          const triInfo = candidates.map((tri) => {
            const [a, b, c] = tri.pts2;
            const area2 = triArea2(a, b, c);
            const absArea2 = Math.abs(area2);
            const depthKey = triDepthKeyMaxY(a, b, c);
            const centroid = avg3(a, b, c);
            return {
              tri,
              area2,
              absArea2,
              depthKey,
              centroid,
            };
          });
          const frontFacingFlags = triInfo.map((info) => info.area2 > 0);
          const shouldCullBoth =
            TRI_RENDER.backfaceCull &&
            TRI_RENDER.cullMode === "bothOnly" &&
            !TRI_RENDER.keepBothTris &&
            frontFacingFlags.every((f) => !f);
          if (!shouldCullBoth) {
            for (const info of triInfo) {
              kept.push({
                pts2: info.tri.pts2,
                pts3: info.tri.pts3,
                depthKey: info.depthKey,
                cx: info.centroid.x,
                cy: info.centroid.y,
                degenerate: info.absArea2 < TRI_RENDER.minArea2D,
              });
            }
          }
          if (kept.length > 0) {
            let primaryIndex = 0;
            for (let i = 1; i < kept.length; i++) {
              if (kept[i].depthKey > kept[primaryIndex].depthKey) {
                primaryIndex = i;
              }
            }
            kept.forEach((tri, index) => {
              tris.push({
                ...tri,
                cellKey,
                isPrimaryForCell: index === primaryIndex,
              });
            });
            const cellTris: Tri2[] = kept.map((tri) => ({
              pts2: tri.pts2,
              pts3: tri.pts3,
              degenerate: tri.degenerate,
            }));
            if (cellTris.length > 0) {
              const p00 = surfacePoints[quad.rowIndex * cols + quad.colIndex];
              const p10 =
                surfacePoints[quad.rowIndex * cols + (quad.colIndex + 1)];
              const p11 =
                surfacePoints[(quad.rowIndex + 1) * cols + (quad.colIndex + 1)];
              const p01 =
                surfacePoints[(quad.rowIndex + 1) * cols + quad.colIndex];
              const avgDepth3D =
                (pointDepth3D(p00) +
                  pointDepth3D(p10) +
                  pointDepth3D(p11) +
                  pointDepth3D(p01)) /
                4;
              const maxYDepth = Math.max(
                ...cellTris.flatMap((t) => t.pts2.map((p) => p.y))
              );
              const cellDepthKey =
                CELL_SORT_MODE === "avgXYZ" ? avgDepth3D : maxYDepth;
              cellMap.set(cellKey, {
                cellKey,
                depthKey: cellDepthKey,
                tris: cellTris,
              });
            }
          }
        }
        tris.sort((a, b) => a.depthKey - b.depthKey);
        return tris;
      })()
      : [];
    const cells = TRI_RENDER.enabled
      ? [...cellMap.values()].sort((a, b) => a.depthKey - b.depthKey)
      : [];
    if (!triCellHistLogged && cells.length > 0) {
      triCellHistLogged = true;
      const hist: Record<number, number> = {};
      for (const cell of cells) {
        const count = cell.tris.length;
        hist[count] = (hist[count] ?? 0) + 1;
      }
      // eslint-disable-next-line no-console
      console.log("[TRI_CELL_TRI_COUNT_HIST]", hist);
    }
    if (!split4CountLogged && TRI_RENDER.enabled && cells.length > 0) {
      split4CountLogged = true;
      // eslint-disable-next-line no-console
      console.log("[TRI_SPLIT4_COUNT]", split4Count);
    }
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
    const maxZByCol = new Array(cols).fill(-Infinity);
    const birthZByCol = new Array(cols).fill(-Infinity);
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const idx = row * cols + col;
        const z = surfacePoints[idx]?.z ?? -Infinity;
        if (z > maxZByCol[col]) {
          maxZByCol[col] = z;
        }
        if (row === 0) {
          birthZByCol[col] = z;
        }
      }
    }
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
        let visible: boolean | undefined;
        if (line.age === 0) {
          const isSkyline = (c: number) =>
            birthZByCol[c] >= maxZByCol[c] - BIRTHS_SKYLINE_EPS;
          visible = isSkyline(col) || isSkyline(col + 1);
        }
        const key = `${qr}-${col}`;
        const seg: AgeSegment = {
          x1: p0.x,
          y1: p0.y,
          x2: p1.x,
          y2: p1.y,
          heavy: line.heavy,
          age: line.age,
          visible,
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
      stereoContourRuns,
      projectedSurface,
      surfacePoints,
      ages,
      years,
      rows,
      cols,
      zScale,
      frame,
      projection
    );
    const valueSegByQuad = new Map<string, ValueSegment[]>();
    contourPolylines2D.forEach((iso, isoIndex) => {
      const segments = segmentizeContourPolyline(
        iso.level,
        iso.points,
        iso.data,
        years,
        ages,
        iso.runId ?? isoIndex,
        { splitByAgeLines: false }
      );
      for (const seg of segments) {
        const { cellKey } = seg;
        const bucket = valueSegByQuad.get(cellKey);
        const { cellKey: _cellKey, ...rest } = seg;
        if (bucket) {
          bucket.push(rest);
        } else {
          valueSegByQuad.set(cellKey, [rest]);
        }
      }
    });
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
      triangles,
      cells,
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
  }, [projection, swedenRows, stereoContourRuns]);
  const debugContourOverlay = useMemo(() => {
    if (!DEBUG_CONTOUR_PROJ) return null;
    const level = DEBUG_CONTOUR_LEVEL;
    const rawRuns = model.contourPolylines2D
      .filter((iso) => iso.level === level)
      .map((iso) => iso.points);
    const directRuns: Point2D[][] = [];
    const rawWallDots: Point2D[] = [];
    const directWallDots: Point2D[] = [];
    const maxYear = model.frame.maxYear;
    let maxDelta = 0;
    let sumDelta = 0;
    let count = 0;
    for (const iso of model.contourPolylines2D) {
      if (iso.level !== level) continue;
      iso.data.forEach((d, i) => {
        if (!Number.isFinite(d.year) || !Number.isFinite(d.age)) return;
        const direct = projectIso(
          model.frame.point(d.year, d.age, level),
          projection
        );
        const surface = iso.points[i];
        if (!surface) return;
        const dx = direct.x - surface.x;
        const dy = direct.y - surface.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDelta) maxDelta = dist;
        sumDelta += dist;
        count += 1;
        if (Math.abs(d.year - maxYear) < 1e-6) {
          rawWallDots.push(surface);
          directWallDots.push(direct);
        }
      });
    }
    for (const run of stereoContourRuns) {
      if (run.level !== level || !run.points) continue;
      const pts: Point2D[] = [];
      for (const p of run.points) {
        if (!Number.isFinite(p.year) || !Number.isFinite(p.age)) continue;
        const pt = projectIso(
          model.frame.point(p.year, p.age, level),
          projection
        );
        pts.push(pt);
      }
      if (pts.length > 1) directRuns.push(pts);
    }
    return {
      level,
      rawRuns,
      directRuns,
      rawWallDots,
      directWallDots,
      stats: {
        count,
        maxDelta,
        meanDelta: count > 0 ? sumDelta / count : 0,
      },
    };
  }, [model.contourPolylines2D, model.frame, projection, stereoContourRuns]);

  const frontWall = useMemo(() => {
    const frontAge = model.ages[model.ages.length - 1];
    const topLine = model.ageLines.find((line) => line.age === frontAge);
    if (!topLine || topLine.points.length < 2) return null;
    const bottomPoints = model.years.map((year) =>
      projectIso(model.frame.point(year, frontAge, 0), projection)
    );
    const polygonPoints = [...topLine.points, ...bottomPoints.slice().reverse()];
    return polygonPoints.map((p) => `${p.x},${p.y}`).join(" ");
  }, [model.ageLines, model.ages, model.frame, model.years, projection]);
  if (DEBUG_CONTOUR_PROJ && debugContourOverlay && !contourDebugLogged) {
    contourDebugLogged = true;
    // eslint-disable-next-line no-console
    console.log("[CONTOUR_PROJ_DEBUG]", {
      level: debugContourOverlay.level,
      ...debugContourOverlay.stats,
    });
  }
  const layersEnabled = {
    architecture: true,
    surface: true,
    lines: true,
    cohortLines: true,
    labels: true,
    interaction: true,
  };
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
  const handleDownloadTopViewSvg = () => {
    if (!topViewSvgRef.current) {
      return;
    }
    const clone = topViewSvgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    const serialized = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "usa-topview-contours.svg";
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
  const activeAxisLabelLayout = isUsaDataset
    ? { ...AXIS_LABEL_LAYOUT, side: "right" as const }
    : AXIS_LABEL_LAYOUT;
  const yearMax = model.frame.maxYear;
  const yearMaxLine = model.yearLines.find((line) => line.year === yearMax);
  const yearMaxPointsStr = yearMaxLine
    ? yearMaxLine.points.map((p) => `${p.x},${p.y}`).join(" ")
    : "";
  const colMax = model.cols - 1;
  const rightWallTopEdge2D = model.ages.map(
    (_age, row) => model.projectedSurface[row * model.cols + colMax]
  );

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
      {showUI && FEATURES.exportSvg && (
        <div style={{ display: "inline-flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={handleDownloadSvg}
            style={{
              marginBottom: "0.75rem",
              padding: "0.4rem 0.8rem",
              fontFamily: "inherit",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Download SVG
          </button>
          <button
            type="button"
            onClick={handleDownloadTopViewSvg}
            style={{
              marginBottom: "0.75rem",
              padding: "0.4rem 0.8rem",
              fontFamily: "inherit",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Download Top View SVG
          </button>
        </div>
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
          onMouseMove={FEATURES.hover ? handleMouseMove : undefined}
          onMouseLeave={FEATURES.hover ? handleMouseLeave : undefined}
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
                showRightWall={false}
              />
            )}
            {layersEnabled.surface && (
              <>
                {frontWall && (
                  <polygon
                    points={frontWall}
                    fill={"#b3a19155"}//{rightWallStyle.wallFill ?? vizStyle.wall.fill}
                    stroke="none"
                    id="layer-front-wall"
                  />
                )}
                <g id="surface-clipped">
                  <SurfaceLayer
                    quads={model.quads}
                    cells={model.cells}
                    globalTriSort={globalTriSort}
                    surfaceStyle={{
                      fill: vizStyle.surface.fill,
                      stroke: vizStyle.surface.stroke,
                      strokeWidth: vizStyle.surface.strokeWidth,
                    }}
                    shading={shadingConfig}
                    lightDir={lightDir}
                    drawSegments={model.cells.length > 0}
                    yearSegByCell={model.yearSegByQuad}
                    yearStyle={vizStyle.years}
                    ageSegByCell={model.ageSegByQuad}
                    ageStyle={vizStyle.ages}
                    valueSegByCell={model.valueSegByQuad}
                    valueStyle={linesVizStyle.values}
                    cohortSegByCell={model.cohortSegByQuad}
                    cohortStyle={vizStyle.cohorts}
                  />
                </g>
              </>
            )}
            {FEATURES.rightWall && (
              <RightWall
                surfacePoints={model.surfacePoints}
                topEdge2D={rightWallTopEdge2D}
                rows={model.rows}
                cols={model.cols}
                projection={projection}
                floorZ={FLOOR_DEPTH}
                ages={model.ages}
                maxSurvivors={model.maxSurvivors}
                valueStep={activeRightWallValueStep}
                valueMinorStep={activeRightWallMinorStep}
                frame={model.frame}
                shading={shadingConfig}
                style={rightWallStyle}
              />
            )}
            {FEATURES.labels && layersEnabled.labels && (
              <LabelsLayer
                frame={model.frame}
                projection={projection}
                years={model.years}
                minYearExt={model.minYearExt}
                maxYearExt={model.maxYearExt}
                axisLabelBaseStyle={AXIS_LABEL_STYLE}
                axisLabelLayout={activeAxisLabelLayout}
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
                valueLabelFormat={isUsaDataset ? "millions" : undefined}
                age100Text={isUsaDataset ? "100+ years old" : undefined}
                titleProps={titleProps}
                topValueByYear={topValueByYear}
                yearLabelSides={isUsaDataset ? ["bottom"] : undefined}
              />
            )}
            {FEATURES.hover && layersEnabled.interaction && (
              <InteractionLayer
                hover={hover ? { x: hover.x, y: hover.y } : null}
                accentColor={TOOLTIP_STYLE.accent}
                radius={vizStyle.debugPoints.radius * 2}
                strokeWidth={TOOLTIP_STYLE.borderWidth}
              />
            )}
            {yearMaxLine && (
              <polyline
                points={yearMaxPointsStr}
                fill="none"
                stroke={vizStyle.years.stroke}
                strokeWidth={vizStyle.years.thickWidth}
                strokeOpacity={vizStyle.years.thickOpacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {DEBUG_CONTOUR_PROJ && debugContourOverlay && (
              <g id="layer-debug-contours" pointerEvents="none">
                {debugContourOverlay.rawRuns.map((run, runIndex) => (
                  <polyline
                    key={`debug-raw-${runIndex}`}
                    points={run.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="magenta"
                    strokeWidth={1}
                    strokeOpacity={0.8}
                  />
                ))}
                {debugContourOverlay.directRuns.map((run, runIndex) => (
                  <polyline
                    key={`debug-direct-${runIndex}`}
                    points={run.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="cyan"
                    strokeWidth={1}
                    strokeOpacity={0.8}
                  />
                ))}
                {debugContourOverlay.rawWallDots.map((p, i) => (
                  <circle
                    key={`debug-raw-dot-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={1.6}
                    fill="magenta"
                    opacity={0.9}
                  />
                ))}
                {debugContourOverlay.directWallDots.map((p, i) => (
                  <circle
                    key={`debug-direct-dot-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={1.6}
                    fill="cyan"
                    opacity={0.9}
                  />
                ))}
              </g>
            )}
          </g>
        </svg>
        {FEATURES.hover && hover && tooltipData && (
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
      <div
        style={{
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {(() => {
          const topPad = 44;
          const rightPad = 140;
          const bottomPad = 68;
          const leftPad = 52;
          const plotHeight = Math.round(HEIGHT * 0.45);
          const yPxPerAge =
            plotHeight / (model.ages[model.ages.length - 1] - model.ages[0]);
          const plotWidth = Math.round(
            yPxPerAge * (model.years[model.years.length - 1] - model.years[0])
          );
          const topViewWidth = plotWidth + leftPad + rightPad;
          const topViewHeight = plotHeight + topPad + bottomPad;
          return (
            <>
              <TopView
                width={topViewWidth}
                height={topViewHeight}
                svgRef={topViewSvgRef}
                years={model.years}
                ages={model.ages}
                rows={swedenRows}
                contours={topViewContourRuns}
                padding={{
                  top: topPad,
                  right: rightPad,
                  bottom: bottomPad,
                  left: leftPad,
                }}
                showYears={topShowYears}
                showAges={topShowAges}
                showCohorts={topShowCohorts}
                showContours={topShowContours}
                showContourCrossings={topShowContourCrossings}
                contourMode={topContourMode}
                lineStyle={{
                  years: vizStyle.years,
                  ages: vizStyle.ages,
                  cohorts: vizStyle.cohorts,
                  values: linesVizStyle.values,
                }}
                axisLabelStyle={AXIS_LABEL_STYLE}
                showTitle
              />
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  fontSize: "0.85rem",
                  alignItems: "center",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  Contour mode
                  <select
                    value={topContourMode}
                    onChange={(e) =>
                      setTopContourMode(e.target.value as "raw" | "segmented")
                    }
                  >
                    <option value="raw">raw</option>
                    <option value="segmented">segmented</option>
                  </select>
                </label>
                <label style={{ display: "inline-flex", gap: "0.4rem" }}>
                  <input
                    type="checkbox"
                    checked={topShowAges}
                    onChange={(e) => setTopShowAges(e.target.checked)}
                  />
                  Age lines
                </label>
                <label style={{ display: "inline-flex", gap: "0.4rem" }}>
                  <input
                    type="checkbox"
                    checked={topShowYears}
                    onChange={(e) => setTopShowYears(e.target.checked)}
                  />
                  Year lines
                </label>
                <label style={{ display: "inline-flex", gap: "0.4rem" }}>
                  <input
                    type="checkbox"
                    checked={topShowCohorts}
                    onChange={(e) => setTopShowCohorts(e.target.checked)}
                  />
                  Cohort lines
                </label>
                <label style={{ display: "inline-flex", gap: "0.4rem" }}>
                  <input
                    type="checkbox"
                    checked={topShowContours}
                    onChange={(e) => setTopShowContours(e.target.checked)}
                  />
                  Contour lines
                </label>
                <label style={{ display: "inline-flex", gap: "0.4rem" }}>
                  <input
                    type="checkbox"
                    checked={topShowContourCrossings}
                    onChange={(e) =>
                      setTopShowContourCrossings(e.target.checked)
                    }
                  />
                  Contour crossings
                </label>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
