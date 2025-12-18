import { projectIso, type ProjectionOptions } from "../../core/geometry";
import type { Frame3D } from "../../core/frame3d";

type BackWallIsoStyle = {
  stroke: string;
  thinWidth: number;
  thickWidth: number;
  thinOpacity: number;
  thickOpacity: number;
  heavyStep: number;
};

type BackWallIsolinesProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  minYearExt: number;
  maxYearExt: number;
  levels: number[];
  style: BackWallIsoStyle;
};

export default function BackWallIsolines({
  frame,
  projection,
  minYearExt,
  maxYearExt,
  levels,
  style,
}: BackWallIsolinesProps) {
  const { yearStep } = frame;

  return (
    <>
      {levels.map((level) => {
        const pts = [];
        for (let year = minYearExt; year <= maxYearExt; year += yearStep) {
          pts.push(projectIso(frame.point(year, 0, level), projection));
        }

        if (pts.length < 2) return null;

        const heavy =
          style.heavyStep > 0 ? level % style.heavyStep === 0 : level === 0;

        return (
          <polyline
            key={`backwall-iso-${level}`}
            points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={style.stroke}
            strokeWidth={heavy ? style.thickWidth : style.thinWidth}
            strokeOpacity={heavy ? style.thickOpacity : style.thinOpacity}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </>
  );
}
