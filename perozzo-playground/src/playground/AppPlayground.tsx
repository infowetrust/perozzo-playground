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

export default function AppPlayground() {
  const [preset, setPreset] = useState<ProjectionPreset>("perozzoBasic");

  // choose camera based on preset
  const projection: ProjectionOptions = projectionForPreset(
    preset,
    WIDTH,
    HEIGHT
  );

  // build Sweden surface in core
  const swedenSurface = makeSwedenSurface(swedenRows, { maxHeight: 3.5 });
  const surfacePoints: Point3D[] = swedenSurface.points; // ages >= 5
  const rows = swedenSurface.rows;
  const cols = swedenSurface.cols;
  const birthPoints3D: Point3D[] = swedenSurface.births; // age 0 ridge

  // years where we want red "census" lines (every 25 years from 1750)
  const markYears = swedenSurface.years.filter(
    (y) => (y - 1750) % 25 === 0
  );

  const markYearCols = markYears.map((year) =>
    swedenSurface.years.indexOf(year)
  );

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
  // build a polyline string for one year-column:
  // start on the births ridge, then walk down through all age bands
  const yearColumnPoints = (colIndex: number): string => {
    const pts: Point2D[] = [];

    // births point at this year
    const birth = projectedBirths[colIndex];
    pts.push(birth);

    // surface points from top band (age 5) down to oldest age
    for (let row = 0; row < rows; row++) {
      const p = projectedSurface[row * cols + colIndex];
      pts.push(p);
    }

    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  };

  // -----------------------
  // Auto-centering (X & Y)
  // -----------------------

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

  // -----------------------
  // Build quads + depth sort
  // -----------------------

  // simple depth metric: larger = nearer to viewer
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

    // ordering: top edge (b0, b1) then bottom edge (s1, s0) to form a lip
    const corners3D: Point3D[] = [b0, b1, s1, s0];
    const corners2D: Point2D[] = corners3D.map((p) =>
      projectIso(p, projection)
    );

    const depth =
      corners3D.reduce((sum, p) => sum + pointDepth(p), 0) /
      corners3D.length;

    birthQuads.push({ points2D: corners2D, depth });
  }

  // combine and sort all quads: far → near (painter's algorithm)
  const allQuads = [...surfaceQuads, ...birthQuads];
  allQuads.sort((a, b) => a.depth - b.depth);

  // -----------------------
  // Render
  // -----------------------

  return (
    <div
      style={{
        padding: "1rem",
        background: "#111",
        color: "#eee",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h1>Perozzo Playground</h1>
      <p>Fourth test: connect data.</p>

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
        style={{ border: "1px solid #555", background: "#181818" }}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* base plane */}
          <polygon
            points={floorPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#292929ff"
            stroke="none"
          />

          {/* surface + births quads, depth-sorted */}
          {allQuads.map((quad, i) => (
            <polygon
              key={i}
              points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="#fff"
              stroke="#444"
              strokeWidth={0.6}
            />
          ))}

          {/* red census lines: same year, every 25 years */}
          {markYearCols.map((col, i) => (
            <polyline
              key={`year-line-${i}`}
              points={yearColumnPoints(col)}
              fill="none"
              stroke="#e53935" // red
              strokeWidth={1.5}
            />
          ))}

          {/* births ridge stroke on top */}
          <polyline
            points={projectedBirths.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#000"
            strokeWidth={1.2}
          />

          {/* births ridge stroke on top */}
          <polyline
            points={projectedBirths.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#000"
            strokeWidth={1.2}
          />

          {/* invisible points for future interaction */}
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