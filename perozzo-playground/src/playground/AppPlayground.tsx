/**
 * Composes scene and draws it.
 * Picks parameters, calls core functions, draws marks.
 * Keeps React focused on layout, not math.
 */
import { useState } from "react";
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

import swedenCsv from "../data/porozzo-tidy.csv?raw";
import { parseSwedenCsv, makeSwedenSurface } from "../core/sweden";

// NOTE: generated offline by `npm run build:contours` from porozzo-tidy.csv
import contourRaw from "../data/porozzo-contours.json";
import RightWall from "./layers/RightWall";
import FloorAgeLines from "./layers/FloorAgeLines";
import BackWall from "./layers/BackWall";
import { makeFrame3D } from "../core/frame3d";

type ContourPointFile = { year: number; age: number };
type ContourFile = { level: number; points: ContourPointFile[] };

const contourData = contourRaw as ContourFile[];

const WIDTH = 700;
const HEIGHT = 700;
const FLOOR_DEPTH = 0;
const EXTEND_LEFT_YEARS = 30;
const EXTEND_RIGHT_YEARS = 20;

// Centralized visual style for the playground.
// If you want to art-direct the plate, tweak values here.
const LINE_THIN_WIDTH = 0.5;
const LINE_THICK_WIDTH = 1;
const LINE_THIN_OPACITY = 0.5;
const LINE_THICK_OPACITY = 0.9;

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
      floor: 0.3,
    },
  },
  debugPoints: {
    fill: "#ffcc66",
    opacity: 0,
    radius: 2,
  },
};

type Quad2D = {
  points2D: Point2D[];
  depth: number;
  corners3D: Point3D[];
};

type YearLine = { year: number; points: Point2D[]; heavy: boolean };
type AgeLine = { age: number; points: Point2D[]; heavy: boolean };
type CohortLine = { birthYear: number; points: Point2D[]; heavy: boolean };
type ValueContour2D = { level: number; points: Point2D[] };

const swedenRows = parseSwedenCsv(swedenCsv);

/* ---------- GEOMETRY / LAYER HELPERS ---------- */

// simple depth metric: larger = nearer to viewer
function pointDepth3D(p: Point3D): number {
  return p.x + p.y + p.z;
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
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      pts.push(projectedSurface[rowIndex * cols + colIndex]);
    }
    const heavy = (year - years[0]) % vizStyle.years.heavyStep === 0;
    return { year, points: pts, heavy };
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
    for (let colIndex = 0; colIndex < cols; colIndex++) {
      pts.push(projectedSurface[rowIndex * cols + colIndex]);
    }
    const heavy = (age - ages[0]) % vizStyle.ages.heavyStep === 0;
    return { age, points: pts, heavy };
  });
}

function buildCohortLines(
  swedenRowsLocal: typeof swedenRows,
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

    for (const year of years) {
      const age = year - birthYear;
      if (age < 0 || age > maxAge) continue;
      if (age % 5 !== 0) continue; // snap to 5-year age grid

      const rowIndex = ages.indexOf(age);
      const colIndex = years.indexOf(year);
      if (rowIndex === -1 || colIndex === -1) continue;

      pts.push(projectedSurface[rowIndex * cols + colIndex]);
    }

    if (pts.length > 1) {
      const heavy =
        (birthYear - minYear) % vizStyle.cohorts.heavyStep === 0;
      cohortLines.push({ birthYear, points: pts, heavy });
    }
  }

  return cohortLines;
}

function buildValueContours2D(
  contours: ContourFile[],
  projectedSurface: Point2D[],
  ages: number[],
  years: number[],
  _rows: number,
  cols: number
): ValueContour2D[] {
  function findRowBelow(age: number): number {
    if (age < ages[0] || age > ages[ages.length - 1]) return -1;
    for (let i = 0; i < ages.length - 1; i++) {
      if (age >= ages[i] && age <= ages[i + 1]) {
        return i;
      }
    }
    return -1;
  }

  function findColLeft(year: number): number {
    if (year < years[0] || year > years[years.length - 1]) return -1;
    for (let i = 0; i < years.length - 1; i++) {
      if (year >= years[i] && year <= years[i + 1]) return i;
    }
    return -1;
  }

  return contours.map((iso) => {
    const pts: Point2D[] = [];

    const contourPts = iso.points;

    for (const pt of contourPts) {
      const colLeft = findColLeft(pt.year);
      if (colLeft < 0) continue;

      const colRight = Math.min(colLeft + 1, cols - 1);
      const y0 = years[colLeft];
      const y1 = years[colRight];
      const ty = y1 === y0 ? 0 : (pt.year - y0) / (y1 - y0);

      const rowBelow = findRowBelow(pt.age);
      if (rowBelow < 0 || rowBelow >= _rows - 1) continue;

      const age0 = ages[rowBelow];
      const age1 = ages[rowBelow + 1];
      const ta = (pt.age - age0) / (age1 - age0);

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
    }

    return {
      level: iso.level,
      points: pts,
    };
  });
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

export default function AppPlayground() {
  const [preset, setPreset] = useState<ProjectionPreset>("levasseur");

  // camera / projection based on preset
  const projection: ProjectionOptions = projectionForPreset(
    preset,
    WIDTH,
    HEIGHT
  );

  // Sweden surface in core space (includes age 0 as first row)
  const swedenSurface = makeSwedenSurface(swedenRows, { maxHeight: 3 });
  const maxSurvivors = swedenRows.reduce(
    (max, row) => Math.max(max, row.survivors),
    0
  );
  const surfacePoints: Point3D[] = swedenSurface.points;
  const rows = swedenSurface.rows;
  const cols = swedenSurface.cols;
  const years = swedenSurface.years;
  const ages = swedenSurface.ages;
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
  const FRAME_MAX_AGE = 110;
  const FRAME_MAX_VALUE = 325_000;
  const shadingConfig = vizStyle.shading;
  const lightDir = normalize3(shadingConfig.lightDir);
  const floorNormal = quadNormal(
    frame.point(minYearExt, 0, 0),
    frame.point(minYearExt, 25, 0),
    frame.point(frame.minYear, 0, 0)
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
    projectIso(frame.point(minYearExt, 0, 0), projection),
    projectIso(frame.point(minYearExt, FRAME_MAX_AGE, 0), projection),
    projectIso(frame.point(maxYearExt, FRAME_MAX_AGE, 0), projection),
    projectIso(frame.point(maxYearExt, 0, 0), projection),
    projectIso(frame.point(minYearExt, 0, 0), projection),
  ];
  const backWallFramePoints = [
    projectIso(frame.point(minYearExt, 0, 0), projection),
    projectIso(frame.point(maxYearExt, 0, 0), projection),
    projectIso(frame.point(maxYearExt, 0, FRAME_MAX_VALUE), projection),
    projectIso(frame.point(minYearExt, 0, FRAME_MAX_VALUE), projection),
    projectIso(frame.point(minYearExt, 0, 0), projection),
  ];
  const floorFrameString = floorFramePoints
    .map((p) => `${p.x},${p.y}`)
    .join(" ");


  // project main surface + floor
  const projectedSurface: Point2D[] = projectSurface(surfacePoints, projection);

  const floorPoints: Point2D[] = floorPolygon(
    rows,
    cols,
    FLOOR_DEPTH,
    projection
  );

  // auto-centering offsets
  const { offsetX, offsetY } = computeAutoCenterOffset(
    projectedSurface,
    floorPoints,
    WIDTH,
    HEIGHT
  );

  // surface mesh quads
  const quads = buildQuads(surfacePoints, rows, cols, projection);

  // isoline layers
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
  const contourPolylines2D = buildValueContours2D(
    contourData,
    projectedSurface,
    ages,
    years,
    rows,
    cols
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
      <h1>Perozzo Playground</h1>
      <p>Sweden survivorship surface with Perozzo-style meshes.</p>
      <svg
        width={WIDTH}
        height={HEIGHT}
        style={{
          border: `1px solid ${vizStyle.svg.border}`,
          background: vizStyle.svg.background,
        }}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>

          <polyline
            points={floorFramePoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={vizStyle.ages.stroke}
            strokeWidth={vizStyle.ages.thinWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={backWallFramePoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={vizStyle.ages.stroke}
            strokeWidth={vizStyle.ages.thinWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <BackWall
            surfacePoints={surfacePoints}
            rows={rows}
            cols={cols}
            projection={projection}
            floorZ={FLOOR_DEPTH}
            years={years}
            ages={ages}
            maxSurvivors={maxSurvivors}
            extendLeftYears={EXTEND_LEFT_YEARS}
            extendRightYears={EXTEND_RIGHT_YEARS}
            majorStep={50_000}
            frame={frame}
            minYearExt={minYearExt}
            maxYearExt={maxYearExt}
            maxValueForFrame={FRAME_MAX_VALUE}
            shading={shadingConfig}
            style={{
              stroke: vizStyle.values.stroke,
              thinWidth: vizStyle.values.thinWidth,
              thickWidth: vizStyle.values.thickWidth,
              heavyStep: vizStyle.values.heavyStep,
              surfaceFill: vizStyle.surface.fill,
              thinOpacity: vizStyle.values.thinOpacity,
              thickOpacity: vizStyle.values.thickOpacity,
            }}
          />
          {/* shaded floor plane */}
          <polygon
            points={floorFrameString}
            fill={vizStyle.surface.fill}
            stroke={vizStyle.floor.stroke}
          />
          {floorAlpha > 0 && (
            <polygon
              points={floorFrameString}
              fill={shadingConfig.inkColor}
              fillOpacity={floorAlpha}
              stroke="none"
            />
          )}
          <FloorAgeLines
            frame={frame}
            projection={projection}
            heavyAges={[0, 25, 50, 75, 100]}
            extendLeftYears={EXTEND_LEFT_YEARS}
            extendRightYears={EXTEND_RIGHT_YEARS}
            style={{
              stroke: vizStyle.ages.stroke,
              strokeWidth: vizStyle.ages.thickWidth,
            }}
          />
          <RightWall
            surfacePoints={surfacePoints}
            rows={rows}
            cols={cols}
            projection={projection}
            floorZ={FLOOR_DEPTH}
            ages={ages}
            maxSurvivors={maxSurvivors}
            valueStep={vizStyle.values.heavyStep}
            frame={frame}
            shading={shadingConfig}
            style={{
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
              valueHeavyStep: vizStyle.values.heavyStep,
              valueThinOpacity: vizStyle.values.thinOpacity,
              valueThickOpacity: vizStyle.values.thickOpacity,
              surfaceFill: vizStyle.surface.fill,
              surfaceStroke: vizStyle.surface.stroke,
              surfaceStrokeWidth: vizStyle.surface.strokeWidth,
            }}
          />

          {/* main surface quads */}
          {quads.map((quad, i) => {
            const base = (
              <polygon
                points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={vizStyle.surface.fill}
                stroke={vizStyle.surface.stroke}
                strokeWidth={vizStyle.surface.strokeWidth}
              />
            );

            if (!shadingConfig.enabled) {
              return <g key={`quad-${i}`}>{base}</g>;
            }

            let normal = quadNormal(
              quad.corners3D[0],
              quad.corners3D[1],
              quad.corners3D[3]
            );
            if (normal.z < 0) {
              normal = { x: -normal.x, y: -normal.y, z: -normal.z };
            }
            const brightness = lambert(
              normal,
              lightDir,
              shadingConfig.ambient,
              shadingConfig.diffuse
            );
            const alpha = inkAlphaFromBrightness({
              brightness,
              ambient: shadingConfig.ambient,
              diffuse: shadingConfig.diffuse,
              steps: shadingConfig.steps,
              inkAlphaMax: shadingConfig.inkAlphaMax,
              gamma: shadingConfig.gamma,
              shadowBias: shadingConfig.shadowBias,
              alphaScale: shadingConfig.alphaScale.surface,
            });

            return (
              <g key={`quad-${i}`}>
                {base}
                {alpha > 0 && (
                  <polygon
                    points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={shadingConfig.inkColor}
                    fillOpacity={Math.min(
                      1,
                      alpha * shadingConfig.alphaScale.surface
                    )}
                    stroke="none"
                  />
                )}
              </g>
            );
          })}

          {/* GREEN value isolines, clipped to the sheet */}
          <g>
            {contourPolylines2D.map((iso, i) => (
              <polyline
                key={`val-${iso.level}-${i}`}
                points={iso.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={vizStyle.values.stroke}
                strokeWidth={
                  iso.level % vizStyle.values.heavyStep === 0
                    ? vizStyle.values.thickWidth
                    : vizStyle.values.thinWidth
                }
                strokeOpacity={
                  iso.level % vizStyle.values.heavyStep === 0
                    ? vizStyle.values.thickOpacity
                    : vizStyle.values.thinOpacity
                }
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>

          {/* BLUE: cohort lines */}
          {cohortLines.map((line) => (
            <polyline
              key={`cohort-${line.birthYear}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={vizStyle.cohorts.stroke}
              strokeWidth={
                line.heavy
                  ? vizStyle.cohorts.thickWidth
                  : vizStyle.cohorts.thinWidth
              }
              strokeOpacity={
                line.heavy
                  ? vizStyle.cohorts.thickOpacity
                  : vizStyle.cohorts.thinOpacity
              }
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* BLACK: age isolines */}
          {ageLines.map((line) => (
            <polyline
              key={`age-${line.age}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={vizStyle.ages.stroke}
              strokeWidth={
                line.heavy
                  ? vizStyle.ages.thickWidth
                  : vizStyle.ages.thinWidth
              }
              strokeOpacity={
                line.heavy
                  ? vizStyle.ages.thickOpacity
                  : vizStyle.ages.thinOpacity
              }
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* RED: year isolines */}
          {yearLines.map((line) => (
            <polyline
              key={`year-${line.year}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={vizStyle.years.stroke}
              strokeWidth={
                line.heavy
                  ? vizStyle.years.thickWidth
                  : vizStyle.years.thinWidth
              }
              strokeOpacity={
                line.heavy
                  ? vizStyle.years.thickOpacity
                  : vizStyle.years.thinOpacity
              }
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* optional: invisible grid points for debugging */}
          {projectedSurface.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={vizStyle.debugPoints.radius}
              fill={vizStyle.debugPoints.fill}
              opacity={vizStyle.debugPoints.opacity}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
