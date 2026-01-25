import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Frame3D } from "../../core/frame3d";
import type { Point2D } from "../../core/types";
import type { AxisLabelStyle } from "../vizConfig";

type LabelSide = "left" | "right";

type AgeLabelsProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  minYearExt: number;
  maxYearExt: number;
  side: LabelSide | "both";
  tickLen: number;
  textOffset: number;
  style: AxisLabelStyle;
  age100Text?: string;
  textAnchorOverride?: "start" | "middle" | "end";
  showTicks?: boolean;
  tickScale?: number;
  tickOffset?: number;
};

const LABEL_AGES = [0, 25, 50, 75, 100];
const LABEL_TEXT: Record<number, string> = {
  0: "Newborns",
  25: "25",
  50: "50",
  75: "75",
  100: "100+",
};

export default function AgeLabels({
  frame,
  projection,
  minYearExt,
  maxYearExt,
  side,
  tickLen,
  textOffset,
  style,
  age100Text,
  textAnchorOverride,
  showTicks = false,
  tickScale = 1,
  tickOffset = 0,
}: AgeLabelsProps) {
  const sides: LabelSide[] =
    side === "both" ? ["left", "right"] : [side ?? "left"];

  const labelYearFor = (s: LabelSide): number => {
    if (s === "right") {
      return Math.max(maxYearExt - 5, frame.maxYear + 5);
    }
    return Math.min(minYearExt + 5, frame.minYear - 10);
  };

  const inwardYearFor = (s: LabelSide, baseYear: number): number => {
    return s === "right" ? baseYear - frame.yearStep : baseYear + frame.yearStep;
  };

  const dirForAge = (
    age: number,
    s: LabelSide,
    baseYear: number,
    inwardYear: number
  ): Point2D => {
    const pA = projectIso(frame.point(baseYear, age, 0), projection);
    const pB = projectIso(frame.point(inwardYear, age, 0), projection);
    const dx = pA.x - pB.x;
    const dy = pA.y - pB.y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag };
  };

  return (
    <g>
      {sides.map((s) => {
        const baseYear = labelYearFor(s);
        const inwardYear = inwardYearFor(s, baseYear);
        return LABEL_AGES.map((age) => {
          const text =
            age === 100 && age100Text ? age100Text : LABEL_TEXT[age] ?? `${age}`;
          const anchor = projectIso(frame.point(baseYear, age, 0), projection);
          const dir = dirForAge(age, s, baseYear, inwardYear);
          const textPos = {
            x: anchor.x + dir.x * (tickLen * tickScale + textOffset + tickOffset),
            y: anchor.y + dir.y * (tickLen * tickScale + textOffset + tickOffset),
          };

          return (
            <g key={`age-label-${s}-${age}`}>
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
                {text}
              </text>
            </g>
          );
        });
      })}
    </g>
  );
}
