import { quadNormal, lambert, inkAlphaFromBrightness } from "../shading";
import type { Point2D, Point3D } from "../../core/types";
import type { LineStyle, ShadingConfig } from "../vizConfig";
import { isHeavy } from "../vizConfig";

type Quad = {
  points2D: Point2D[];
  corners3D: Point3D[];
  rowIndex: number;
  colIndex: number;
};

type Triangle = {
  pts2: [Point2D, Point2D, Point2D];
  pts3: [Point3D, Point3D, Point3D];
  depthKey: number;
  cellKey: string;
};

type SurfaceLayerProps = {
  quads: Quad[];
  triangles?: Triangle[];
  surfaceStyle: {
    fill: string;
    stroke: string;
    strokeWidth: number;
  };
  shading: ShadingConfig;
  lightDir: { x: number; y: number; z: number };
  drawQuads?: boolean;
  drawSegments?: boolean;
  cohortSegByQuad?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      heavy: boolean;
      birthYear: number;
    }[]
  >;
  cohortStyle?: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  yearSegByQuad?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      heavy: boolean;
      year: number;
    }[]
  >;
  yearStyle?: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  ageSegByQuad?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      heavy: boolean;
      age: number;
    }[]
  >;
  ageStyle?: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  valueSegByQuad?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      level: number;
    }[]
  >;
  valueStyle?: LineStyle;
};

export default function SurfaceLayer({
  quads,
  triangles,
  surfaceStyle,
  shading,
  lightDir,
  cohortSegByQuad,
  cohortStyle,
  yearSegByQuad,
  yearStyle,
  ageSegByQuad,
  ageStyle,
  valueSegByQuad,
  valueStyle,
  drawQuads = true,
  drawSegments = true,
}: SurfaceLayerProps) {
  const useTriangles = Boolean(triangles && triangles.length > 0);
  const drawQuadFill = drawQuads && !useTriangles;
  return (
    <g id="layer-surface">
      {drawQuads && useTriangles && triangles && (
        <g id="layer-surface-tris">
          {triangles.map((tri, i) => (
            <polygon
              key={`tri-${tri.cellKey}-${i}`}
              points={tri.pts2.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={surfaceStyle.fill}
              stroke={surfaceStyle.stroke}
              strokeWidth={surfaceStyle.strokeWidth}
            />
          ))}
        </g>
      )}
      {quads.map((quad, i) => {
        const base = drawQuadFill ? (
          <polygon
            points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={surfaceStyle.fill}
            stroke={surfaceStyle.stroke}
            strokeWidth={surfaceStyle.strokeWidth}
          />
        ) : null;

        const quadKey = `${quad.rowIndex}-${quad.colIndex}`;
        const yearSegs = yearSegByQuad?.get(quadKey);
        const renderYearSegs =
          drawSegments && yearSegs && yearStyle
            ? yearSegs.map((seg, segIndex) => (
                <line
                  key={`yearseg-${seg.year}-${quad.rowIndex}-${quad.colIndex}-${segIndex}`}
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={yearStyle.stroke}
                  strokeWidth={
                    seg.heavy ? yearStyle.thickWidth : yearStyle.thinWidth
                  }
                  strokeOpacity={
                    seg.heavy
                      ? yearStyle.thickOpacity
                      : yearStyle.thinOpacity
                  }
                  strokeLinecap="round"
                />
              ))
            : null;
        const ageSegs = ageSegByQuad?.get(quadKey);
        const renderAgeSegs =
          drawSegments && ageSegs && ageStyle
            ? ageSegs.map((seg, segIndex) => (
                <line
                  key={`ageseg-${seg.age}-${quad.rowIndex}-${quad.colIndex}-${segIndex}`}
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={ageStyle.stroke}
                  strokeWidth={
                    seg.heavy ? ageStyle.thickWidth : ageStyle.thinWidth
                  }
                  strokeOpacity={
                    seg.heavy
                      ? ageStyle.thickOpacity
                      : ageStyle.thinOpacity
                  }
                  strokeLinecap="round"
                />
              ))
            : null;
        const valueSegs = valueSegByQuad?.get(quadKey);
        const renderValueSegs =
          drawSegments && valueSegs && valueStyle
            ? valueSegs.map((seg, segIndex) => {
                const heavy = isHeavy(seg.level, valueStyle.heavyStep);
                return (
                  <line
                    key={`valueseg-${seg.level}-${quad.rowIndex}-${quad.colIndex}-${segIndex}`}
                    x1={seg.x1}
                    y1={seg.y1}
                    x2={seg.x2}
                    y2={seg.y2}
                    stroke={valueStyle.stroke}
                    strokeWidth={
                      heavy ? valueStyle.thickWidth : valueStyle.thinWidth
                    }
                    strokeOpacity={
                      heavy
                        ? valueStyle.thickOpacity
                        : valueStyle.thinOpacity
                    }
                    strokeLinecap="round"
                  />
                );
              })
            : null;
        const cohortSegs = cohortSegByQuad?.get(quadKey);
        const renderCohortSegs =
          drawSegments && cohortSegs && cohortStyle
            ? cohortSegs.map((seg, segIndex) => (
                <line
                  key={`cohort-${seg.birthYear}-${segIndex}`}
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={cohortStyle.stroke}
                  strokeWidth={
                    seg.heavy
                      ? cohortStyle.thickWidth
                      : cohortStyle.thinWidth
                  }
                  strokeOpacity={
                    seg.heavy
                      ? cohortStyle.thickOpacity
                      : cohortStyle.thinOpacity
                  }
                  strokeLinecap="round"
                />
              ))
            : null;
        const hasSegments =
          renderYearSegs ||
          renderAgeSegs ||
          renderValueSegs ||
          renderCohortSegs;

        if (drawQuadFill && !shading.enabled) {
          return (
            <g key={`quad-${i}`}>
              {base}
              {renderYearSegs}
              {renderAgeSegs}
              {renderValueSegs}
              {renderCohortSegs}
            </g>
          );
        }

        if (!drawQuads || !drawQuadFill) {
          if (!hasSegments) return null;
          return (
            <g key={`quad-${i}`}>
              {renderYearSegs}
              {renderAgeSegs}
              {renderValueSegs}
              {renderCohortSegs}
            </g>
          );
        }

        let normal = quadNormal(
          quad.corners3D[0],
          quad.corners3D[1],
          quad.corners3D[3]
        );
        if (normal.z < 0) {
          normal = { x: -normal.x, y: -normal.y, z: -normal.z };
        }
        const brightness = lambert(
          normal,
          lightDir,
          shading.ambient,
          shading.diffuse
        );
        const alpha = inkAlphaFromBrightness({
          brightness,
          ambient: shading.ambient,
          diffuse: shading.diffuse,
          steps: shading.steps,
          inkAlphaMax: shading.inkAlphaMax,
          gamma: shading.gamma,
          shadowBias: shading.shadowBias,
          alphaScale: shading.alphaScale.surface,
        });

        return (
          <g key={`quad-${i}`}>
            {base}
            {alpha > 0 && (
              <polygon
                points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={shading.inkColor}
                fillOpacity={Math.min(
                  1,
                  alpha * shading.alphaScale.surface
                )}
                stroke="none"
              />
            )}
            {renderYearSegs}
            {renderAgeSegs}
            {renderValueSegs}
            {renderCohortSegs}
          </g>
        );
      })}
    </g>
  );
}
