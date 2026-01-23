import { projectIso, type ProjectionOptions } from "../../core/geometry";
import { type Frame3D } from "../../core/frame3d";
import type { Point2D, Point3D } from "../../core/types";
import {
  normalize3,
  quadNormal,
  lambert,
  inkAlphaFromBrightness,
} from "../shading";

type WallStyle = {
  wallFill: string;
  wallStroke: string;
  ageStroke: string;
  ageThin: number;
  ageThick: number;
  ageHeavyStep: number;
  ageThinOpacity: number;
  ageThickOpacity: number;
  valueStroke: string;
  valueThin: number;
  valueThick: number;
  valueHeavyStep: number;
  valueThinOpacity: number;
  valueThickOpacity: number;
  surfaceFill: string;
  surfaceStroke?: string;
  surfaceStrokeWidth?: number;
};

type YearWallProps = {
  surfacePoints: Point3D[];
  topEdge2D?: Point2D[];
  wallYear?: number;
  colIndex?: number;
  rows: number;
  cols: number;
  projection: ProjectionOptions;
  floorZ: number;
  ages: number[];
  maxSurvivors: number;
  valueStep: number;
  valueMinorStep: number;
  frame: Frame3D;
  shading?: {
    enabled: boolean;
    ambient: number;
    diffuse: number;
    steps: number;
    lightDir: { x: number; y: number; z: number };
    inkColor: string;
    inkAlphaMax: number;
    gamma: number;
    shadowBias: number;
    alphaScale?: {
      surface?: number;
      age0Wall?: number;
      wall2025?: number;
      floor?: number;
    };
  };
  style: WallStyle;
};

const DEBUG_WALL_GRID = true;
const DEBUG_WALL_CLIP = false;
let loggedWallGridOnce = false;

export default function YearWall({
  surfacePoints,
  topEdge2D,
  wallYear,
  colIndex,
  rows,
  cols,
  projection,
  floorZ,
  ages,
  maxSurvivors,
  valueStep,
  valueMinorStep,
  frame,
  shading,
  style,
}: YearWallProps) {
  const DEBUG_LOG_KEY = "reverse-1900";
  if (rows <= 0 || cols <= 0 || surfacePoints.length === 0) {
    return null;
  }

  void valueStep;

  const colMax = cols - 1;
  const wallCol = colIndex ?? colMax;
  const yearMax = wallYear ?? frame.maxYear;
  const ageStart = ages[0] ?? 0;
  const ageEnd = ages[ages.length - 1] ?? ageStart;
  const shadingConfig = shading && shading.enabled ? shading : null;
  const lightVec = shadingConfig ? normalize3(shadingConfig.lightDir) : null;
  const wallNormal =
    shadingConfig && lightVec
      ? quadNormal(
        frame.point(yearMax, ageStart, 0),
        frame.point(yearMax, ageEnd, 0),
        frame.point(yearMax, ageStart, maxSurvivors)
      )
      : null;
  const wallAlpha =
    shadingConfig && lightVec && wallNormal
      ? inkAlphaFromBrightness({
        brightness: lambert(
          wallNormal,
          lightVec,
          shadingConfig.ambient,
          shadingConfig.diffuse
        ),
        ambient: shadingConfig.ambient,
        diffuse: shadingConfig.diffuse,
        steps: shadingConfig.steps,
        inkAlphaMax: shadingConfig.inkAlphaMax,
        gamma: shadingConfig.gamma,
        shadowBias: shadingConfig.shadowBias,
        alphaScale: shadingConfig.alphaScale?.wall2025 ?? 1,
      })
      : 0;
  const clipPathId =
    wallYear != null ? `yearWallClip-${wallYear}` : `yearWallClip-${wallCol}`;

  let wallTop: Point2D[] = topEdge2D ? [...topEdge2D] : [];
  let wallFloor: Point2D[] = ages.map((age) =>
    projectIso(frame.point(yearMax, age, floorZ), projection)
  );
  if (wallTop.length === 0) {
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      const topPoint3D = surfacePoints[rowIndex * cols + wallCol];
      if (!topPoint3D) continue;
      wallTop.push(projectIso(topPoint3D, projection));
    }
  }
  const n = Math.min(wallTop.length, wallFloor.length);
  wallTop = wallTop.slice(0, n);
  wallFloor = wallFloor.slice(0, n);

  const wallBottom = [...wallFloor].reverse();
  const polygonPoints = [...wallTop, ...wallBottom];
  const yearWallPolyString = polygonPoints
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

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
  const insetPoint = (p: Point2D): Point2D => p;
  const ageBaseLine = ageLines[0];
  const ageLinesInner = ageLines.slice(1);

  const edgeStart3D = surfacePoints[0 * cols + wallCol];
  const edgeEnd3D = surfacePoints[(rows - 1) * cols + wallCol];
  const zSpan = frame.maxZ - floorZ || 1;
  const zForValue = (level: number) =>
    frame.maxSurvivors > 0
      ? floorZ + (level / frame.maxSurvivors) * zSpan
      : floorZ;

  const minorStep = Math.max(1, valueMinorStep);
  const valueLines: {
    key: string;
    start: Point2D;
    end: Point2D;
    heavy: boolean;
  }[] = [];
  for (let level = 0; level <= maxSurvivors; level += minorStep) {
    if (!edgeStart3D || !edgeEnd3D) continue;
    const z = zForValue(level);
    const start = projectIso(
      { x: edgeStart3D.x, y: edgeStart3D.y, z },
      projection
    );
    const end = projectIso(
      { x: edgeEnd3D.x, y: edgeEnd3D.y, z },
      projection
    );
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
    if (!edgeStart3D || !edgeEnd3D) {
      // skip adding the maxSurvivors line if we can't compute edge points
    } else {
      const z = zForValue(level);
      const start = projectIso(
        { x: edgeStart3D.x, y: edgeStart3D.y, z },
        projection
      );
      const end = projectIso(
        { x: edgeEnd3D.x, y: edgeEnd3D.y, z },
        projection
      );
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
  }

  if (valueLines.length === 0) {
    if (edgeStart3D && edgeEnd3D) {
      const start = projectIso(
        { x: edgeStart3D.x, y: edgeStart3D.y, z: floorZ },
        projection
      );
      const end = projectIso(
        { x: edgeEnd3D.x, y: edgeEnd3D.y, z: floorZ },
        projection
      );
      valueLines.push({
        key: "val-0",
        start,
        end,
        heavy: true,
      });
    }
  }
  const valueZeroLine = valueLines.find((line) => line.key === "val-0");
  const valueLinesInner = valueLines.filter((line) => line.key !== "val-0");
  if (
    DEBUG_WALL_GRID &&
    !loggedWallGridOnce &&
    typeof wallYear === "number" &&
    wallYear === frame.minYear &&
    DEBUG_LOG_KEY === "reverse-1900"
  ) {
    loggedWallGridOnce = true;
    console.log("[WALL GRID COUNTS]", {
      wallYear,
      ages: ageLines.length,
      ageInner: ageLinesInner.length,
      values: valueLines.length,
      valueInner: valueLinesInner.length,
    });
  }

  return (
    <>
      <defs>
        <clipPath id={clipPathId} clipPathUnits="userSpaceOnUse">
          <polygon points={yearWallPolyString} />
        </clipPath>
      </defs>

      <polygon
        points={yearWallPolyString}
        fill={style.surfaceFill}
        stroke={style.wallStroke}
        strokeWidth={style.surfaceStrokeWidth}
      />
      {wallAlpha > 0 && shadingConfig && (
        <polygon
          points={yearWallPolyString}
          fill={shadingConfig.inkColor}
          fillOpacity={Math.min(1, wallAlpha)}
          stroke="none"
        />
      )}

      <g clipPath={`url(#${clipPathId})`}>
        {ageLinesInner.map((line) => (
          <line
            key={line.key}
            x1={line.top.x}
            y1={line.top.y}
            x2={line.bottom.x}
            y2={line.bottom.y}
            stroke={style.ageStroke}
            strokeWidth={line.heavy ? style.ageThick : style.ageThin}
            strokeOpacity={
              line.heavy ? style.ageThickOpacity : style.ageThinOpacity
            }
            strokeLinecap="round"
          />
        ))}

        {valueLinesInner.map((line) => (
          <line
            key={line.key}
            x1={line.start.x}
            y1={line.start.y}
            x2={line.end.x}
            y2={line.end.y}
            stroke={style.valueStroke}
            strokeWidth={line.heavy ? style.valueThick : style.valueThin}
            strokeOpacity={
              line.heavy ? style.valueThickOpacity : style.valueThinOpacity
            }
            strokeLinecap="square"
          />
        ))}
      </g>
      {DEBUG_WALL_CLIP && (
        <polygon
          points={yearWallPolyString}
          fill="none"
          stroke="magenta"
          strokeWidth={2.5}
          strokeOpacity={0.8}
        />
      )}
      {ageBaseLine && (
        <line
          x1={insetPoint(ageBaseLine.top).x}
          y1={insetPoint(ageBaseLine.top).y}
          x2={insetPoint(ageBaseLine.bottom).x}
          y2={insetPoint(ageBaseLine.bottom).y}
          stroke={style.ageStroke}
          strokeWidth={
            ageBaseLine.heavy ? style.ageThick : style.ageThin
          }
          strokeOpacity={
            ageBaseLine.heavy
              ? style.ageThickOpacity
              : style.ageThinOpacity
          }
          strokeLinecap="round"
        />
      )}
      {valueZeroLine && (
        <line
          x1={insetPoint(valueZeroLine.start).x}
          y1={insetPoint(valueZeroLine.start).y}
          x2={insetPoint(valueZeroLine.end).x}
          y2={insetPoint(valueZeroLine.end).y}
          stroke={style.valueStroke}
          strokeWidth={
            valueZeroLine.heavy ? style.valueThick : style.valueThin
          }
          strokeOpacity={
            valueZeroLine.heavy
              ? style.valueThickOpacity
              : style.valueThinOpacity
          }
          strokeLinecap="square"
        />
      )}
    </>
  );
}
