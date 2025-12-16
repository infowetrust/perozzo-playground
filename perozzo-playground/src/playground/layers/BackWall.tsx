import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Point2D, Point3D } from "../../core/types";

type BackWallStyle = {
  stroke: string;
  thinWidth: number;
  thickWidth: number;
  heavyStep: number;
};

type BackWallProps = {
  surfacePoints: Point3D[];
  rows: number;
  cols: number;
  projection: ProjectionOptions;
  floorZ: number;
  years: number[];
  ages: number[];
  maxSurvivors: number;
  extendLeftYears: number;
  extendRightYears: number;
  majorStep: number;
  style: BackWallStyle;
};

export default function BackWall({
  surfacePoints,
  rows,
  cols,
  projection,
  floorZ,
  years,
  ages,
  maxSurvivors,
  extendLeftYears,
  extendRightYears,
  majorStep,
  style,
}: BackWallProps) {
  if (rows <= 0 || cols < 2 || surfacePoints.length < rows * cols) {
    return null;
  }

  void floorZ;

  const ageZeroIndex = ages.indexOf(0);
  const rowIndex =
    ageZeroIndex >= 0 && ageZeroIndex < rows ? ageZeroIndex : 0;
  const idx0 = rowIndex * cols;
  const idx1 = idx0 + 1;
  const basePoint = surfacePoints[idx0];
  const nextPoint = surfacePoints[idx1];
  if (!basePoint || !nextPoint) {
    return null;
  }

  const maxZ = surfacePoints.reduce(
    (max, pt) => (pt.z > max ? pt.z : max),
    0
  );

  const yearStep = years.length > 1 ? years[1] - years[0] : 5;
  const safeYearStep = yearStep === 0 ? 5 : yearStep;
  const stepsLeft = Math.round(extendLeftYears / safeYearStep);
  const stepsRight = Math.round(extendRightYears / safeYearStep);

  const dx = nextPoint.x - basePoint.x;
  const dy = nextPoint.y - basePoint.y;

  const ridgePoint = (k: number): { x: number; y: number } => ({
    x: basePoint.x + k * dx,
    y: basePoint.y + k * dy,
  });

  const maxLevel =
    majorStep > 0
      ? Math.max(0, Math.floor(maxSurvivors / majorStep) * majorStep)
      : maxSurvivors;

  const levels: number[] = [];
  const step = majorStep > 0 ? majorStep : 50_000;
  for (let level = 0; level <= maxLevel; level += step) {
    levels.push(level);
  }
  if (levels.length === 0) {
    levels.push(0);
  }

  const kEnd = (cols - 1) + stepsRight;

  return (
    <>
      {levels.map((level) => {
        const zRatio = maxSurvivors > 0 ? level / maxSurvivors : 0;
        const zLevel = zRatio * (maxZ || 0);

        const kStart =
          level <= 150_000 ? -stepsLeft : (cols - 1);

        const pts: Point2D[] = [];
        for (let k = kStart; k <= kEnd; k++) {
          const { x, y } = ridgePoint(k);
          pts.push(projectIso({ x, y, z: zLevel }, projection));
        }

        if (pts.length < 2) return null;

        const strokeWidth =
          style.heavyStep > 0 && level % style.heavyStep === 0
            ? style.thickWidth
            : style.thinWidth;

        return (
          <polyline
            key={`backwall-${level}`}
            points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={style.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </>
  );
}
