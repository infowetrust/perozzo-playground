import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Point2D, Point3D } from "../../core/types";

type FloorAgeLineStyle = {
  stroke: string;
  strokeWidth: number;
};

type FloorAgeLinesProps = {
  surfacePoints: Point3D[];
  rows: number;
  cols: number;
  projection: ProjectionOptions;
  floorZ: number;
  years: number[];
  ages: number[];
  heavyAges: number[];
  extendLeftYears: number;
  extendRightYears: number;
  style: FloorAgeLineStyle;
};

function buildExtendedPolyline(
  rowIndex: number,
  cols: number,
  surfacePoints: Point3D[],
  projection: ProjectionOptions,
  floorZ: number,
  stepsLeft: number,
  stepsRight: number
): Point2D[] {
  const idx0 = rowIndex * cols;
  const idx1 = idx0 + 1;
  const p0 = surfacePoints[idx0];
  const p1 = surfacePoints[idx1];
  if (!p0 || !p1) return [];

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  const startStep = -stepsLeft;
  const endStep = cols - 1 + stepsRight;
  const points: Point2D[] = [];

  for (let k = startStep; k <= endStep; k++) {
    const x = p0.x + k * dx;
    const y = p0.y + k * dy;
    points.push(projectIso({ x, y, z: floorZ }, projection));
  }

  return points;
}

export default function FloorAgeLines({
  surfacePoints,
  rows,
  cols,
  projection,
  floorZ,
  years,
  ages,
  heavyAges,
  extendLeftYears,
  extendRightYears,
  style,
}: FloorAgeLinesProps) {
  if (rows <= 0 || cols < 2 || surfacePoints.length < rows * cols) {
    return null;
  }

  const yearStep = years.length > 1 ? years[1] - years[0] : 5;
  const safeStep = yearStep === 0 ? 5 : yearStep;
  const stepsLeft = Math.round(extendLeftYears / safeStep);
  const stepsRight = Math.round(extendRightYears / safeStep);

  return (
    <g>
      {heavyAges.map((age) => {
        const rowIndex = ages.indexOf(age);
        if (rowIndex === -1) return null;

        const pts = buildExtendedPolyline(
          rowIndex,
          cols,
          surfacePoints,
          projection,
          floorZ,
          stepsLeft,
          stepsRight
        );

        if (pts.length === 0) return null;

        const path = pts.map((p) => `${p.x},${p.y}`).join(" ");

        return (
          <polyline
            key={`floor-age-${age}`}
            points={path}
            fill="none"
            stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}
