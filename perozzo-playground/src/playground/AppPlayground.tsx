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
  type ProjectionOptions,
  type ProjectionPreset,
} from "../core/geometry";
import type { Point2D, Point3D } from "../core/types";

import swedenCsv from "../data/porozzo-tidy.csv?raw";
import { parseSwedenCsv, makeSwedenSurface } from "../core/sweden";

const WIDTH = 800;
const HEIGHT = 600;
const FLOOR_DEPTH = 0;

type Quad2D = {
  points2D: Point2D[];
  depth: number;
};

// parse tidy CSV once at module load
const swedenRows = parseSwedenCsv(swedenCsv);

// helpers for line thickness
const yearStrokeWidth = (year: number): number =>
  (year - 1750) % 25 === 0 ? 1 : 0.25;

const ageStrokeWidth = (age: number): number =>
  age === 0 || age % 25 === 0 ? 1 : 0.25;

// thicker cohorts every 25 years of birth
const cohortStrokeWidth = (birthYear: number, baseYear = 1750): number =>
  (birthYear - baseYear) % 25 === 0 ? 1 : 0.25;

export default function AppPlayground() {
  const [preset, setPreset] = useState<ProjectionPreset>("perozzoBasic");

  // choose camera based on preset
  const projection: ProjectionOptions = projectionForPreset(
    preset,
    WIDTH,
    HEIGHT
  );

  // Sweden surface in core space
  const swedenSurface = makeSwedenSurface(swedenRows, { maxHeight: 3 });
  const surfacePoints: Point3D[] = swedenSurface.points; // ages >= 5
  const rows = swedenSurface.rows;
  const cols = swedenSurface.cols;
  const years = swedenSurface.years;
  const ages = swedenSurface.ages;

  // choose which birth cohorts to draw (every 5th year, then emphasize every 25)
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  // estimate the full birth-year span covered by our surface
  const minSurfaceAge = ages[0];                 // e.g. 5
  const maxSurfaceAge = ages[ages.length - 1];   // e.g. 85 or 90

  const minBirthYear = minYear - maxSurfaceAge;  // earliest cohorts still alive
  const maxBirthYear = maxYear;                  // youngest cohorts at age 0

  // build cohort birth years across the whole range (every 5 years)
  const cohortBirthYears: number[] = [];
  for (let b = minBirthYear; b <= maxBirthYear; b += 5) {
    cohortBirthYears.push(b);
  }

  const birthPoints3D: Point3D[] = swedenSurface.births; // age 0 ridge

  // project surface + floor + births
  const projectedSurface: Point2D[] = projectSurface(
    surfacePoints,
    projection
  );
  const floorPoints: Point2D[] = floorPolygon(
    rows,
    cols,
    FLOOR_DEPTH,
    projection
  );
  const projectedBirths: Point2D[] = birthPoints3D.map((p) =>
    projectIso(p, projection)
  );

  // --- helper: build polyline points for a given year column (red lines) ---
  const yearColumnPoints = (colIndex: number): string => {
    const pts: Point2D[] = [];

    // births point at this year
    const birth = projectedBirths[colIndex];
    pts.push(birth);

    // surface points from age 5 band downwards
    for (let row = 0; row < rows; row++) {
      const p = projectedSurface[row * cols + colIndex];
      pts.push(p);
    }

    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  };

  // --- helper: build polyline points for a given age row (black lines) ---
  const ageRowPoints = (rowIndex: number): string => {
    const pts: Point2D[] = [];

    for (let col = 0; col < cols; col++) {
      const p = projectedSurface[rowIndex * cols + col];
      pts.push(p);
    }

    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  };

  // --- helper: build polyline points for one cohort (blue lines) ---
  // birthYear B: follow points where birthYear = year - age ≈ B
  const cohortPoints = (birthYear: number): string => {
    const pts: Point2D[] = [];

    const minSurfaceAge = 5;         // first age band on the sheet
    const ageStep = 5;               // 5-year bands
    const maxSurfaceAge = minSurfaceAge + (rows - 1) * ageStep;

    for (let col = 0; col < cols; col++) {
      const year = years[col];
      const age = year - birthYear;

      // before this cohort is born
      if (age < 0) continue;

      // at birth: use the births ridge point
      if (age === 0) {
        const birthPt = projectedBirths[col];
        pts.push(birthPt);
        continue;
      }

      // beyond our age table -> stop following this cohort
      if (age > maxSurfaceAge) break;

      // map age to nearest age band row index in the surface grid
      const rowIndex = Math.round((age - minSurfaceAge) / ageStep);
      if (rowIndex < 0 || rowIndex >= rows) continue;

      const p = projectedSurface[rowIndex * cols + col];
      pts.push(p);
    }

    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  };

  // --- auto-centering of the projected scene (X and Y) ---

  const allX = [
    ...projectedSurface.map((p) => p.x),
    ...floorPoints.map((p) => p.x),
    ...projectedBirths.map((p) => p.x),
  ];
  const allY = [
    ...projectedSurface.map((p) => p.y),
    ...floorPoints.map((p) => p.y),
    ...projectedBirths.map((p) => p.y),
  ];

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const currentCenterX = (minX + maxX) / 2;
  const currentCenterY = (minY + maxY) / 2;

  const targetCenterX = WIDTH / 2;
  const targetCenterY = HEIGHT * 0.5; // tweak vertical anchoring

  const offsetX = targetCenterX - currentCenterX;
  const offsetY = targetCenterY - currentCenterY;

  // --- build quads + depth sort (white surface + birth lip) ---

  const pointDepth = (p: Point3D) => p.x + p.y + p.z;

  const surfaceQuads: Quad2D[] = [];

  // main sheet quads (ages >= 5)
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
        corners3D.reduce((sum, p) => sum + pointDepth(p), 0) /
        corners3D.length;

      surfaceQuads.push({ points2D: corners2D, depth });
    }
  }

  // vertical quads connecting births (age 0) down to the first age band (age 5)
  const birthQuads: Quad2D[] = [];
  const firstRowOffset = 0; // ageIndex 0 → first age-band row in surfacePoints

  for (let x = 0; x < cols - 1; x++) {
    const b0 = birthPoints3D[x];
    const b1 = birthPoints3D[x + 1];

    const s0 = surfacePoints[firstRowOffset + x];
    const s1 = surfacePoints[firstRowOffset + x + 1];

    const corners3D: Point3D[] = [b0, b1, s1, s0];
    const corners2D: Point2D[] = corners3D.map((p) =>
      projectIso(p, projection)
    );

    const depth =
      corners3D.reduce((sum, p) => sum + pointDepth(p), 0) /
      corners3D.length;

    birthQuads.push({ points2D: corners2D, depth });
  }

  const allQuads = [...surfaceQuads, ...birthQuads];
  allQuads.sort((a, b) => a.depth - b.depth);

  // --- render ---

  return (
    <div
      style={{
        padding: "1rem",
        background: "gray",
        color: "#eee",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h1>Perozzo Playground</h1>
      <p>Fifth test: add simple lines.</p>

      <div style={{ marginBottom: "0.75rem" }}>
        <label>
          Projection preset:{" "}
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as ProjectionPreset)}
          >
            <option value="perozzoBasic">Perozzo basic</option>
            <option value="isometric30">Isometric (30°)</option>
            <option value="steep45">Steep 19th-c plate</option>
          </select>
        </label>
      </div>

      <svg
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid #555", background: "gray" }}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* base plane */}
          <polygon
            points={floorPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#292929"
            stroke="none"
          />

          {/* white surface quads (depth sorted) */}
          {allQuads.map((quad, i) => (
            <polygon
              key={i}
              points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="ivory"
              stroke="none"
              strokeWidth={0.6}
            />
          ))}

          {/* RED: census-year lines (one per year col; thicker every 25 years) */}
          {years.map((year, colIndex) => (
            <polyline
              key={`year-line-${year}`}
              points={yearColumnPoints(colIndex)}
              fill="none"
              stroke="firebrick"
              strokeWidth={yearStrokeWidth(year)}
            />
          ))}

          {/* BLACK: age lines across years (ages 5,10,…; thicker every 25 years) */}
          {Array.from({ length: rows }, (_, rowIndex) => {
            const age = 5 + rowIndex * 5; // age bands on the surface
            return (
              <polyline
                key={`age-line-${age}`}
                points={ageRowPoints(rowIndex)}
                fill="none"
                stroke="dimgray"
                strokeWidth={ageStrokeWidth(age)}
              />
            );
          })}

          {/* BLUE: cohort lines (birth cohorts), follow year - age ≈ birthYear */}
          {cohortBirthYears.map((birthYear) => (
            <polyline
              key={`cohort-${birthYear}`}
              points={cohortPoints(birthYear)}
              fill="none"
              stroke="steelblue"
              strokeWidth={cohortStrokeWidth(birthYear, 1700)}
            />
          ))}

          {/* BLACK: births ridge (age 0), co-located above age 5 */}
          <polyline
            points={projectedBirths.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#000"
            strokeWidth={ageStrokeWidth(0)}
          />

          {/* invisible points – reserved for future interaction */}
          {projectedSurface.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={2}
              fill="#ffcc66"
              opacity={0}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}