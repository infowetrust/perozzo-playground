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

import swedenCsv from "../data/porozzo-tidy.csv?raw";
import { parseSwedenCsv, makeSwedenSurface } from "../core/sweden";

// NOTE: generated offline by `npm run build:contours` from porozzo-tidy.csv
import contourRaw from "../data/porozzo-contours.json";

type ContourPointFile = { year: number; age: number };
type ContourFile = { level: number; points: ContourPointFile[] };

const contourData = contourRaw as ContourFile[];

const WIDTH = 800;
const HEIGHT = 500;
const FLOOR_DEPTH = 0;

type Quad2D = {
  points2D: Point2D[];
  depth: number;
};

const swedenRows = parseSwedenCsv(swedenCsv);

export default function AppPlayground() {
  const [preset, setPreset] = useState<ProjectionPreset>("perozzoBasic");

  // camera / projection based on preset
  const projection: ProjectionOptions = projectionForPreset(
    preset,
    WIDTH,
    HEIGHT
  );

  // Sweden surface in core space (includes age 0 as first row)
  const swedenSurface = makeSwedenSurface(swedenRows, { maxHeight: 3 });
  const surfacePoints: Point3D[] = swedenSurface.points;
  const rows = swedenSurface.rows;
  const cols = swedenSurface.cols;
  const years = swedenSurface.years;
  const ages = swedenSurface.ages;

  // project main surface + floor
  const projectedSurface: Point2D[] = projectSurface(surfacePoints, projection);

  // silhouette polygon for clipping green value lines
  const silhouettePts = buildSurfaceSilhouette2D(projectedSurface, rows, cols);
  const silhouettePoints = silhouettePts.map((p) => `${p.x},${p.y}`).join(" ");

  const floorPoints: Point2D[] = floorPolygon(
    rows,
    cols,
    FLOOR_DEPTH,
    projection
  );

  // births ridge from age 0 row (if present)
  const birthRowIndex = ages.indexOf(0);
  const projectedBirthRow: Point2D[] = [];
  if (birthRowIndex >= 0) {
    for (let col = 0; col < cols; col++) {
      projectedBirthRow.push(projectedSurface[birthRowIndex * cols + col]);
    }
  }

  // --- auto-centering in SVG viewport ---

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

  const targetCenterX = WIDTH / 2;
  const targetCenterY = HEIGHT * 0.5; // tweak to taste

  const offsetX = targetCenterX - currentCenterX;
  const offsetY = targetCenterY - currentCenterY;

  // --- quads + depth sorting ---

  // simple depth metric: larger = nearer to viewer
  const pointDepth = (p: Point3D) => p.x + p.y + p.z;

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
        corners3D.reduce((sum, p) => sum + pointDepth(p), 0) /
        corners3D.length;

      quads.push({
        points2D: corners2D,
        depth,
      });
    }
  }

  // painter's algorithm: draw far → near
  quads.sort((a, b) => a.depth - b.depth);

  // --- isolines: red (years), black (ages), blue (cohorts) ---

  // RED: year lines (each column), heavy every 25 years
  const yearLines = years.map((year, colIndex) => {
    const pts: Point2D[] = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      pts.push(projectedSurface[rowIndex * cols + colIndex]);
    }
    const heavy = (year - years[0]) % 25 === 0;
    return { year, points: pts, heavy };
  });

  // BLACK: age lines (each row), heavy every 25 years of age
  const ageLines = ages.map((age, rowIndex) => {
    const pts: Point2D[] = [];
    for (let colIndex = 0; colIndex < cols; colIndex++) {
      pts.push(projectedSurface[rowIndex * cols + colIndex]);
    }
    const heavy = age % 25 === 0;
    return { age, points: pts, heavy };
  });

  // BLUE: cohort lines (birth-year diagonals), based on the 5-year age grid
  type CohortLine = { birthYear: number; points: Point2D[]; heavy: boolean };
  const cohortLines: CohortLine[] = [];

  const minYear = years[0];
  const maxYear = years[years.length - 1];
  const maxAge = ages[ages.length - 1];

  for (let birthYear = minYear; birthYear <= maxYear; birthYear += 5) {
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
      const heavy = (birthYear - minYear) % 25 === 0;
      cohortLines.push({ birthYear, points: pts, heavy });
    }
  }

  // --- GREEN: value isolines (precomputed in data space, then interpolated on surface) ---

  const yearToColIndex = new Map<number, number>();
  years.forEach((y, i) => yearToColIndex.set(y, i));

  function findRowBelow(age: number): number {
    if (age < ages[0] || age > ages[ages.length - 1]) return -1;
    for (let i = 0; i < ages.length - 1; i++) {
      if (age >= ages[i] && age <= ages[i + 1]) {
        return i;
      }
    }
    return -1;
  }

  const contourPolylines2D = contourData.map((iso) => {
    const pts: Point2D[] = [];

    for (const pt of iso.points) {
      const col = yearToColIndex.get(pt.year);
      if (col == null) continue;

      const rowBelow = findRowBelow(pt.age);
      if (rowBelow < 0 || rowBelow >= rows - 1) continue;

      const age0 = ages[rowBelow];
      const age1 = ages[rowBelow + 1];
      const t = (pt.age - age0) / (age1 - age0);

      const p0 = projectedSurface[rowBelow * cols + col];
      const p1 = projectedSurface[(rowBelow + 1) * cols + col];

      const x = p0.x + t * (p1.x - p0.x);
      const y = p0.y + t * (p1.y - p0.y);

      pts.push({ x, y });
    }

    return {
      level: iso.level,
      points: pts,
    };
  });

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
      <p>Sweden survivorship surface with Perozzo-style meshes.</p>

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
          {/*Green value isolines are clipped to the visible surface silhouette
          so they don't "bridge" above the ridge line.*/}
          <defs>
            <clipPath id="greenClip">
              {/* NOTE: curly braces here */}
              <polygon points={silhouettePoints} />
            </clipPath>
          </defs>
          {/* base plane */}
          <polygon
            points={floorPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#292929ff"
            stroke="none"
          />

          {/* main surface quads */}
          {quads.map((quad, i) => (
            <polygon
              key={i}
              points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="#ffffff"
              stroke="#444"
              strokeWidth={0.6}
            />
          ))}

          {/* RED: year isolines */}
          {yearLines.map((line) => (
            <polyline
              key={`year-${line.year}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#c0392b"
              strokeWidth={line.heavy ? 1.3 : 0.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* BLUE: cohort lines */}
          {cohortLines.map((line) => (
            <polyline
              key={`cohort-${line.birthYear}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#2980b9"
              strokeWidth={line.heavy ? 1.2 : 0.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* GREEN value isolines, clipped to the sheet */}
          <g clipPath="url(#greenClip)">
            {contourPolylines2D.map((iso, i) => (
              <polyline
                key={`val-${iso.level}-${i}`}
                points={iso.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#2ecc71"
                strokeWidth={iso.level % 50000 === 0 ? 1.2 : 0.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>

          {/* BLACK: age isolines */}
          {ageLines.map((line) => (
            <polyline
              key={`age-${line.age}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#000000"
              strokeWidth={line.heavy ? 1.3 : 0.5}
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