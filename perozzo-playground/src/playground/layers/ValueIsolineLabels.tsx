import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Frame3D } from "../../core/frame3d";
import type { Point2D } from "../../core/types";
import type { AxisLabelStyle } from "../vizConfig";

type LabelSide = "left" | "right";

type ValueIsolineLabelsProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  minYearExt: number;
  maxYearExt: number;
  side: LabelSide | "both";
  tickLen: number;
  textOffset: number;
  style: AxisLabelStyle;
  leftLevels: number[];
  rightLevels: number[];
  labelFormat?: "millions";
  textAnchorOverride?: "start" | "middle" | "end";
  showTicks?: boolean;
  tickScale?: number;
  tickOffset?: number;
  includeZeroLevel?: boolean;
};

export default function ValueIsolineLabels({
  frame,
  projection,
  minYearExt,
  maxYearExt,
  side,
  tickLen,
  textOffset,
  style,
  leftLevels,
  rightLevels,
  labelFormat,
  textAnchorOverride,
  showTicks = false,
  tickScale = 1,
  tickOffset = 0,
  includeZeroLevel = false,
}: ValueIsolineLabelsProps) {
  const sides: LabelSide[] =
    side === "both" ? ["left", "right"] : [side ?? "left"];

  const levelsForSide = (s: LabelSide): number[] => {
    const base = s === "right" ? rightLevels : leftLevels;
    return includeZeroLevel && !base.includes(0) ? [0, ...base] : base;
  };

  const baseYearFor = (s: LabelSide): number => {
    if (s === "right") {
      return Math.max(maxYearExt - frame.yearStep, frame.maxYear + 5);
    }
    return Math.min(minYearExt + frame.yearStep, frame.minYear - 5);
  };

  const inwardYearFor = (s: LabelSide, baseYear: number): number =>
    s === "right" ? baseYear - frame.yearStep : baseYear + frame.yearStep;

  const dirForLevel = (
    level: number,
    s: LabelSide,
    baseYear: number,
    inwardYear: number
  ): Point2D => {
    const pA = projectIso(frame.point(baseYear, 0, level), projection);
    const pB = projectIso(frame.point(inwardYear, 0, level), projection);
    const dx = pA.x - pB.x;
    const dy = pA.y - pB.y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag };
  };

  const formatLevel = (level: number): string =>
    labelFormat === "millions"
      ? `${Math.round(level / 1_000_000)} million`
      : level.toLocaleString("en-US");

  return (
    <g>
      {sides.map((s) => {
        const baseYear = baseYearFor(s);
        const inwardYear = inwardYearFor(s, baseYear);
        return levelsForSide(s).map((level) => {
          const anchor = projectIso(
            frame.point(baseYear, 0, level),
            projection
          );
          const dir = dirForLevel(level, s, baseYear, inwardYear);
          const textPos = {
            x: anchor.x + dir.x * (tickLen * tickScale + textOffset + tickOffset),
            y: anchor.y + dir.y * (tickLen * tickScale + textOffset + tickOffset),
          };

          return (
            <g key={`value-label-${s}-${level}`}>
              {showTicks && (
                <line
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={anchor.x + dir.x * tickLen * tickScale}
                  y2={anchor.y + dir.y * tickLen * tickScale}
                  stroke={style.color}
                  strokeOpacity={style.opacity}
                  strokeWidth={1}
                  strokeLinecap="round"
                />
              )}
              <text
                x={textPos.x}
                y={textPos.y}
                dominantBaseline="middle"
                textAnchor={textAnchorOverride ?? (s === "right" ? "start" : "end")}
                fill={style.color}
                fillOpacity={style.opacity}
                fontFamily={style.fontFamily}
                fontSize={style.fontSize}
                fontWeight={style.fontWeight}
              >
                {formatLevel(level)}
              </text>
            </g>
          );
        });
      })}
    </g>
  );
}
