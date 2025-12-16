import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Point2D, Point3D } from "../../core/types";

type WallStyle = {
  wallFill: string;
  wallStroke: string;
  ageStroke: string;
  ageThin: number;
  ageThick: number;
  ageHeavyStep: number;
  valueStroke: string;
  valueThin: number;
  valueThick: number;
  valueHeavyStep: number;
  surfaceFill: string;
  surfaceStroke?: string;
  surfaceStrokeWidth?: number;
};

type RightWallProps = {
  surfacePoints: Point3D[];
  rows: number;
  cols: number;
  projection: ProjectionOptions;
  floorZ: number;
  ages: number[];
  maxSurvivors: number;
  valueStep: number;
  style: WallStyle;
};

export default function RightWall({
  surfacePoints,
  rows,
  cols,
  projection,
  floorZ,
  ages,
  maxSurvivors,
  valueStep,
  style,
}: RightWallProps) {
  if (rows <= 0 || cols <= 0 || surfacePoints.length === 0) {
    return null;
  }

  void valueStep;

  const colMax = cols - 1;
  const clipPathId = "rightWallClip";

  const wallTop: Point2D[] = [];
  const wallFloor: Point2D[] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    const idx = rowIndex * cols + colMax;
    const topPoint3D = surfacePoints[idx];
    wallTop.push(projectIso(topPoint3D, projection));
    wallFloor.push(
      projectIso({ x: topPoint3D.x, y: topPoint3D.y, z: floorZ }, projection)
    );
  }

  const wallBottom = [...wallFloor].reverse();
  const polygonPoints = [...wallTop, ...wallBottom];
  const polygonString = polygonPoints.map((p) => `${p.x},${p.y}`).join(" ");

  const ageBase = ages[0] ?? 0;
  const ageLines = wallTop.map((topPoint, rowIndex) => {
    const bottomPoint = wallFloor[rowIndex];
    const age = ages[rowIndex] ?? ageBase + rowIndex * 5;
    const heavy =
      style.ageHeavyStep > 0
        ? (age - ageBase) % style.ageHeavyStep === 0
        : age === ageBase;
    return {
      key: `age-${age}-${rowIndex}`,
      top: topPoint,
      bottom: bottomPoint,
      heavy,
    };
  });

  let maxZ = 0;
  for (const pt of surfacePoints) {
    if (pt.z > maxZ) maxZ = pt.z;
  }

  const topIdx = colMax;
  const bottomIdx = (rows - 1) * cols + colMax;
  const xMax = surfacePoints[topIdx]?.x ?? 0;
  const yMin = surfacePoints[topIdx]?.y ?? 0;
  const yMax = surfacePoints[bottomIdx]?.y ?? yMin;

  const minorStep = 10_000;
  const valueLines: {
    key: string;
    start: Point2D;
    end: Point2D;
    heavy: boolean;
  }[] = [];
  for (let level = 0; level <= maxSurvivors; level += minorStep) {
    const zLevel =
      maxSurvivors === 0 ? 0 : (level / maxSurvivors) * (maxZ || 0);
    const start = projectIso({ x: xMax, y: yMin, z: zLevel }, projection);
    const end = projectIso({ x: xMax, y: yMax, z: zLevel }, projection);
    valueLines.push({
      key: `val-${level}`,
      start,
      end,
      heavy:
        style.valueHeavyStep > 0
          ? level % style.valueHeavyStep === 0
          : level === 0,
    });
  }

  if (
    maxSurvivors > 0 &&
    maxSurvivors % minorStep !== 0 &&
    valueLines[valueLines.length - 1]?.key !== `val-${maxSurvivors}`
  ) {
    const level = maxSurvivors;
    const zLevel = (level / maxSurvivors) * (maxZ || 0);
    const start = projectIso({ x: xMax, y: yMin, z: zLevel }, projection);
    const end = projectIso({ x: xMax, y: yMax, z: zLevel }, projection);
    valueLines.push({
      key: `val-${level}`,
      start,
      end,
      heavy:
        style.valueHeavyStep > 0
          ? level % style.valueHeavyStep === 0
          : level === 0,
    });
  }

  if (valueLines.length === 0) {
    const zLevel = 0;
    const start = projectIso({ x: xMax, y: yMin, z: zLevel }, projection);
    const end = projectIso({ x: xMax, y: yMax, z: zLevel }, projection);
    valueLines.push({
      key: "val-0",
      start,
      end,
      heavy: true,
    });
  }

  return (
    <>
      <defs>
        <clipPath id={clipPathId}>
          <polygon points={polygonString} />
        </clipPath>
      </defs>

      <polygon
        points={polygonString}
        fill={style.surfaceFill}
        stroke={style.surfaceStroke ?? style.wallStroke}
        strokeWidth={style.surfaceStrokeWidth}
      />

      <g clipPath={`url(#${clipPathId})`}>
        {ageLines.map((line) => (
          <line
            key={line.key}
            x1={line.top.x}
            y1={line.top.y}
            x2={line.bottom.x}
            y2={line.bottom.y}
            stroke={style.ageStroke}
            strokeWidth={line.heavy ? style.ageThick : style.ageThin}
            strokeLinecap="round"
          />
        ))}

        {valueLines.map((line) => (
          <line
            key={line.key}
            x1={line.start.x}
            y1={line.start.y}
            x2={line.end.x}
            y2={line.end.y}
            stroke={style.valueStroke}
            strokeWidth={line.heavy ? style.valueThick : style.valueThin}
            strokeLinecap="round"
          />
        ))}
      </g>
    </>
  );
}
