import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Frame3D } from "../../core/frame3d";
import type { LineStyle } from "../vizConfig";
import { isHeavy } from "../vizConfig";

type Age0WallIsolinesProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  minYearExt: number;
  maxYearExt: number;
  fullLevels: number[];
  rightOnlyLevels: number[];
  style: LineStyle;
};

export default function Age0WallIsolines({
  frame,
  projection,
  minYearExt,
  maxYearExt,
  fullLevels,
  rightOnlyLevels,
  style,
}: Age0WallIsolinesProps) {
  const { yearStep } = frame;

  return (
    <>
      {[{ levels: fullLevels, start: minYearExt }, { levels: rightOnlyLevels, start: frame.maxYear }].map(
        ({ levels, start }) =>
          levels.map((level) => {
            const pts = [];
            for (let year = start; year <= maxYearExt; year += yearStep) {
              pts.push(projectIso(frame.point(year, 0, level), projection));
            }

            if (pts.length < 2) return null;

            const heavy =
              style.heavyStep > 0 ? isHeavy(level, style.heavyStep) : level === 0;

            return (
              <polyline
                key={`backwall-iso-${start}-${level}`}
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={style.stroke}
                strokeWidth={heavy ? style.thickWidth : style.thinWidth}
                strokeOpacity={heavy ? style.thickOpacity : style.thinOpacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })
      )}
    </>
  );
}
