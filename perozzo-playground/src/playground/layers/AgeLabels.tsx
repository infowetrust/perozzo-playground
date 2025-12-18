import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Frame3D } from "../../core/frame3d";
import type { Point2D } from "../../core/types";

type AgeLabelsProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  ages: number[];
  minYearExt: number;
  style: {
    stroke: string;
    fontFamily: string;
    fontSize: number;
    opacity: number;
  };
};

const LABEL_AGES = [0, 25, 50, 75, 100];
const LABEL_TEXT: Record<number, string> = {
  0: "BORN",
  25: "25",
  50: "50",
  75: "75",
  100: "100",
};

const LABEL_OFFSET_YEAR = -10; // relative to frame.minYear
const TICK_LENGTH = 18;
const TEXT_OFFSET = 6;

export default function AgeLabels({
  frame,
  projection,
  minYearExt,
  style,
}: AgeLabelsProps) {
  const labelYear = Math.min(minYearExt + 5, frame.minYear + LABEL_OFFSET_YEAR);

  const dirForAge = (age: number): Point2D => {
    const pA = projectIso(frame.point(labelYear, age, 0), projection);
    const pB = projectIso(
      frame.point(labelYear + frame.yearStep, age, 0),
      projection
    );
    const dx = pA.x - pB.x;
    const dy = pA.y - pB.y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag };
  };

  return (
    <g fontFamily={style.fontFamily} fontSize={style.fontSize}>
      {LABEL_AGES.map((age) => {
        const text = LABEL_TEXT[age] ?? `${age}`;
        const anchor = projectIso(frame.point(labelYear, age, 0), projection);
        const dir = dirForAge(age);
        const tickEnd = {
          x: anchor.x + dir.x * TICK_LENGTH,
          y: anchor.y + dir.y * TICK_LENGTH,
        };
        const textPos = {
          x: tickEnd.x + dir.x * TEXT_OFFSET,
          y: tickEnd.y + dir.y * TEXT_OFFSET,
        };

        return (
          <g key={`age-label-${age}`} opacity={style.opacity}>
            <line
              x1={anchor.x}
              y1={anchor.y}
              x2={tickEnd.x}
              y2={tickEnd.y}
              stroke={style.stroke}
              strokeWidth={1}
              strokeLinecap="round"
            />
            <text
              x={textPos.x}
              y={textPos.y}
              fill={style.stroke}
              dominantBaseline="middle"
              textAnchor="start"
            >
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
