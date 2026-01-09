import type { Point2D, Point3D } from "../../core/types";
import type { LineStyle } from "../vizConfig";
import { isHeavy } from "../vizConfig";
import type { DepthBuffer, OcclusionConfig } from "../occlusion";
import { pointDepth3D, occlusionFactor } from "../occlusion";

type Polyline = {
  points: Point2D[];
  indices?: number[]; // optional: surfacePoints indices for each point
  heavy: boolean;
  // optional identifiers used by hover focus
  year?: number;
  age?: number;
  birthYear?: number;
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
  drawYears?: boolean;
  drawAges?: boolean;
  drawValues?: boolean;

  // Optional occlusion (safe if not provided)
  depthBuffer?: DepthBuffer;
  occlusion?: OcclusionConfig;
  surfacePoints?: Point3D[];
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

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
  drawYears = true,
  drawAges = true,
  drawValues = true,
  depthBuffer,
  occlusion,
  surfacePoints,
}: DataLinesLayerProps) {
  const highlightMult = hoverOpacity?.highlightMult ?? 1;
  const dimMult = hoverOpacity?.dimMult ?? 1;
  const hasFocus = !!focus;

  const applyHover = (base: number, isHit: boolean) => {
    if (!hasFocus) return base;
    const mult = isHit ? highlightMult : dimMult;
    return clamp01(base * mult);
  };

  const occlEnabled = !!(occlusion && occlusion.enabled && depthBuffer && surfacePoints);

  const segOpacity = (baseOpacity: number, p0: Point2D, p1: Point2D, d0?: number, d1?: number) => {
    if (!occlEnabled || !depthBuffer || !occlusion) return baseOpacity;
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const depthMid =
      d0 != null && d1 != null ? (d0 + d1) / 2 : 0;
    const f = occlusionFactor(depthBuffer, mx, my, depthMid, occlusion);
    return clamp01(baseOpacity * f);
  };

  const renderPolylineAsSegments = (
    line: Polyline,
    stroke: string,
    width: number,
    baseOpacity: number,
    isHit: boolean
  ) => {
    const pts = line.points;
    if (pts.length < 2) return null;

    const inds = line.indices;
    const useDepth = occlEnabled && inds && inds.length === pts.length && surfacePoints;

    const out: any[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const d0 = useDepth ? pointDepth3D(surfacePoints![inds![i]]) : undefined;
      const d1 = useDepth ? pointDepth3D(surfacePoints![inds![i + 1]]) : undefined;
      const op = segOpacity(applyHover(baseOpacity, isHit), p0, p1, d0, d1);
      if (op <= 0) continue;
      out.push(
        <line
          key={`seg-${stroke}-${i}`}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          stroke={stroke}
          strokeWidth={width}
          strokeOpacity={op}
          strokeLinecap="round"
        />
      );
    }
    return <g key={`segwrap-${stroke}`}>{out}</g>;
  };

  return (
    <g id="layer-lines">
      {/* GREEN surface value isolines */}
      {drawValues && (
        <g>
          {contourPolylines2D.map((iso, i) => {
            const heavy = isHeavy(iso.level, vizStyle.values.heavyStep);
            return (
              <polyline
                key={`val-${iso.level}-${i}`}
                points={iso.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={vizStyle.values.stroke}
                strokeWidth={heavy ? vizStyle.values.thickWidth : vizStyle.values.thinWidth}
                strokeOpacity={heavy ? vizStyle.values.thickOpacity : vizStyle.values.thinOpacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      )}

      {/* BLUE cohort lines */}
      {showCohortLines &&
        cohortLines.map((line) => {
          const isHit = !!(focus && line.birthYear === focus.birthYear);
          const width = line.heavy ? vizStyle.cohorts.thickWidth : vizStyle.cohorts.thinWidth;
          const opBase = line.heavy ? vizStyle.cohorts.thickOpacity : vizStyle.cohorts.thinOpacity;
          // Render as segments only if occlusion is enabled and indices exist; else polyline.
          if (occlEnabled && line.indices && surfacePoints) {
            return (
              <g key={`cohort-${line.birthYear}`}>
                {renderPolylineAsSegments(line, vizStyle.cohorts.stroke, width, opBase, isHit)}
              </g>
            );
          }
          return (
            <polyline
              key={`cohort-${line.birthYear}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={vizStyle.cohorts.stroke}
              strokeWidth={width}
              strokeOpacity={applyHover(opBase, isHit)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

      {/* GRAY age lines */}
      {drawAges &&
        ageLines.map((line) => {
          const isHit = !!(focus && line.age === focus.age);
          const width = line.heavy ? vizStyle.ages.thickWidth : vizStyle.ages.thinWidth;
          const opBase = line.heavy ? vizStyle.ages.thickOpacity : vizStyle.ages.thinOpacity;
          if (occlEnabled && line.indices && surfacePoints) {
            return (
              <g key={`age-${line.age}`}>
                {renderPolylineAsSegments(line, vizStyle.ages.stroke, width, opBase, isHit)}
              </g>
            );
          }
          return (
            <polyline
              key={`age-${line.age}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={vizStyle.ages.stroke}
              strokeWidth={width}
              strokeOpacity={applyHover(opBase, isHit)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

      {/* RED year lines */}
      {drawYears &&
        yearLines.map((line) => {
          const isHit = !!(focus && line.year === focus.year);
          const width = line.heavy ? vizStyle.years.thickWidth : vizStyle.years.thinWidth;
          const opBase = line.heavy ? vizStyle.years.thickOpacity : vizStyle.years.thinOpacity;
          if (occlEnabled && line.indices && surfacePoints) {
            return (
              <g key={`year-${line.year}`}>
                {renderPolylineAsSegments(line, vizStyle.years.stroke, width, opBase, isHit)}
              </g>
            );
          }
          return (
            <polyline
              key={`year-${line.year}`}
              points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={vizStyle.years.stroke}
              strokeWidth={width}
              strokeOpacity={applyHover(opBase, isHit)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

      {/* debug grid points */}
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
