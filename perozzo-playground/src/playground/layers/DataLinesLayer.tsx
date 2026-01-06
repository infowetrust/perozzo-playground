import { useRef } from "react";

import type { Point2D, Point3D } from "../../core/types";
import type { LineStyle } from "../vizConfig";
import { isHeavy } from "../vizConfig";
import {
  occlusionFactor,
  pointDepth3D,
  type DepthBuffer,
  type OcclusionConfig,
} from "../occlusion";

type Polyline = {
  points: Point2D[];
  indices: number[];
  heavy: boolean;
  [key: string]: any;
};

type ValueContour = {
  level: number;
  points: Point2D[];
};

type DataLinesLayerProps = {
  yearLines: Polyline[];
  ageLines: Polyline[];
  cohortLines: Polyline[];
  contourPolylines2D: ValueContour[];
  vizStyle: {
    years: LineStyle;
    ages: LineStyle;
    cohorts: LineStyle;
    values: LineStyle;
    debugPoints: { radius: number; fill: string; opacity: number };
  };
  projectedSurface: Point2D[];
  showCohortLines: boolean;
  focus?: { year: number; age: number; birthYear: number } | null;
  hoverOpacity?: { highlightMult: number; dimMult: number };
  depthBuffer?: DepthBuffer | null;
  occlusion?: OcclusionConfig;
  surfacePoints: Point3D[];
};

export default function DataLinesLayer({
  yearLines,
  ageLines,
  cohortLines,
  contourPolylines2D,
  vizStyle,
  projectedSurface,
  showCohortLines,
  focus,
  hoverOpacity,
  depthBuffer,
  occlusion,
  surfacePoints,
}: DataLinesLayerProps) {
  const highlightMult = hoverOpacity?.highlightMult ?? 1;
  const dimMult = hoverOpacity?.dimMult ?? 1;
  const hasFocus = !!focus;

  const applyHover = (base: number, isHit: boolean, hasFocus: boolean) => {
    if (!hasFocus) return base;
    const mult = isHit ? highlightMult : dimMult;
    return Math.min(1, Math.max(0, base * mult));
  };

  const lastLoggedRef = useRef<number | null>(null);

  if (lastLoggedRef.current !== vizStyle.values.heavyStep) {
    const levels = contourPolylines2D.map((iso) => iso.level);
    const head = levels.slice(0, 5);
    const tail = levels.slice(-5);
    console.log("[VALUES DEBUG]", {
      heavyStep: vizStyle.values.heavyStep,
      firstLevels: head,
      lastLevels: tail,
    });
    lastLoggedRef.current = vizStyle.values.heavyStep;
  }

  const occlusionCfg = occlusion;

  const renderOccludedPolyline = (
    line: Polyline,
    keyBase: string,
    stroke: string,
    strokeWidth: number,
    baseOpacity: number
  ) => {
    const segments: JSX.Element[] = [];
    if (!line.points || line.points.length < 2) return segments;
    for (let i = 0; i < line.points.length - 1; i++) {
      const p0 = line.points[i];
      const p1 = line.points[i + 1];
      if (!p0 || !p1) continue;
      let opacity = baseOpacity;
      if (occlusionCfg && depthBuffer && line.indices) {
        const idx0 = line.indices[i];
        const idx1 = line.indices[i + 1];
        const sp0 = surfacePoints[idx0];
        const sp1 = surfacePoints[idx1];
        if (sp0 && sp1) {
          const depthMid =
            (pointDepth3D(sp0) + pointDepth3D(sp1)) * 0.5;
          const midX = (p0.x + p1.x) * 0.5;
          const midY = (p0.y + p1.y) * 0.5;
          const factor = occlusionFactor(
            depthBuffer,
            midX,
            midY,
            depthMid,
            occlusionCfg
          );
          if (factor === 0) continue;
          opacity *= factor;
        }
      }
      if (opacity <= 0) continue;
      segments.push(
        <line
          key={`${keyBase}-seg-${i}`}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeOpacity={opacity}
          strokeLinecap="round"
        />
      );
    }
    return segments;
  };

  return (
    <g id="layer-lines">
      <g>
        {contourPolylines2D.map((iso, i) => (
          <polyline
            key={`val-${iso.level}-${i}`}
            points={iso.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={vizStyle.values.stroke}
            strokeWidth={
              isHeavy(iso.level, vizStyle.values.heavyStep)
                ? vizStyle.values.thickWidth
                : vizStyle.values.thinWidth
            }
            strokeOpacity={
              isHeavy(iso.level, vizStyle.values.heavyStep)
                ? vizStyle.values.thickOpacity
                : vizStyle.values.thinOpacity
            }
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
      {showCohortLines &&
        cohortLines.map((line) => {
          const baseOpacity = applyHover(
            line.heavy
              ? vizStyle.cohorts.thickOpacity
              : vizStyle.cohorts.thinOpacity,
            !!(focus && line.birthYear === focus.birthYear),
            hasFocus
          );
          return (
            <g key={`cohort-${line.birthYear}`}>
              {renderOccludedPolyline(
                line,
                `cohort-${line.birthYear}`,
                vizStyle.cohorts.stroke,
                line.heavy
                  ? vizStyle.cohorts.thickWidth
                  : vizStyle.cohorts.thinWidth,
                baseOpacity
              )}
            </g>
          );
        })}
      {ageLines.map((line) => {
        const baseOpacity = applyHover(
          line.heavy
            ? vizStyle.ages.thickOpacity
            : vizStyle.ages.thinOpacity,
          !!(focus && line.age === focus.age),
          hasFocus
        );
        return (
          <g key={`age-${line.age}`}>
            {renderOccludedPolyline(
              line,
              `age-${line.age}`,
              vizStyle.ages.stroke,
              line.heavy
                ? vizStyle.ages.thickWidth
                : vizStyle.ages.thinWidth,
              baseOpacity
            )}
          </g>
        );
      })}
      {yearLines.map((line) => {
        const baseOpacity = applyHover(
          line.heavy
            ? vizStyle.years.thickOpacity
            : vizStyle.years.thinOpacity,
          !!(focus && line.year === focus.year),
          hasFocus
        );
        return (
          <g key={`year-${line.year}`}>
            {renderOccludedPolyline(
              line,
              `year-${line.year}`,
              vizStyle.years.stroke,
              line.heavy
                ? vizStyle.years.thickWidth
                : vizStyle.years.thinWidth,
              baseOpacity
            )}
          </g>
        );
      })}
      {projectedSurface.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={vizStyle.debugPoints.radius}
          fill={vizStyle.debugPoints.fill}
          opacity={vizStyle.debugPoints.opacity}
        />
      ))}
    </g>
  );
}
