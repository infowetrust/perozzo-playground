import { quadNormal, lambert, inkAlphaFromBrightness } from "../shading";
import type { Point2D, Point3D } from "../../core/types";
import type { LineStyle, ShadingConfig } from "../vizConfig";
import { isHeavy, TRI_RENDER } from "../vizConfig";

type Quad = {
  points2D: Point2D[];
  corners3D: Point3D[];
  rowIndex: number;
  colIndex: number;
};

type Tri2 = {
  pts2: [Point2D, Point2D, Point2D];
  pts3: [Point3D, Point3D, Point3D];
  degenerate?: boolean;
};

type CellRender = {
  cellKey: string;
  depthKey: number;
  tris: Tri2[];
  split4?: boolean;
  splitCenter?: Point2D;
};

type SurfaceLayerProps = {
  quads: Quad[];
  cells?: CellRender[];
  globalTriSort?: boolean;
  surfaceStyle: {
    fill: string;
    stroke: string;
    strokeWidth: number;
  };
  shading: ShadingConfig;
  lightDir: { x: number; y: number; z: number };
  drawQuads?: boolean;
  drawSegments?: boolean;
  cohortSegByCell?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      heavy: boolean;
      birthYear: number;
      visible?: boolean;
    }[]
  >;
  cohortStyle?: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  yearSegByCell?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      heavy: boolean;
      year: number;
      visible?: boolean;
    }[]
  >;
  yearStyle?: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  ageSegByCell?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      heavy: boolean;
      age: number;
      visible?: boolean;
    }[]
  >;
  ageStyle?: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  valueSegByCell?: Map<
    string,
    {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      level: number;
      visible?: boolean;
    }[]
  >;
  valueStyle?: LineStyle;
};

type SegmentRenderItem = {
  key: string;
  depthKey: number;
  tieKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  level?: number;
  isContour?: boolean;
  runId?: number;
};

let triVisLogged = false;

export default function SurfaceLayer({
  quads,
  cells,
  surfaceStyle,
  shading,
  lightDir,
  cohortSegByCell,
  cohortStyle,
  yearSegByCell,
  yearStyle,
  ageSegByCell,
  ageStyle,
  valueSegByCell,
  valueStyle,
  globalTriSort = false,
  drawQuads = true,
  drawSegments = true,
}: SurfaceLayerProps) {
  const useCells = Boolean(cells && cells.length > 0);
  const drawQuadFill = drawQuads && !useCells;
  const debugTriVis = TRI_RENDER.debugTriVis;
  const debugTriStroke = "rgba(0,0,0,0.35)";
  const debugTriStrokeWidth = 0.6;
  const debugTriFill = (index: number) =>
    index % 2 === 0 ? "rgba(0,0,0,0.03)" : "rgba(0,0,0,0.06)";
  const renderSegmentsForCell = (
    quadKey: string
  ): {
    segments: React.ReactNode;
    hasSegments: boolean;
  } => {
    if (!drawSegments) {
      return { segments: null, hasSegments: false };
    }
    const [rowStr, colStr] = quadKey.split("-");
    const rowIndex = Number(rowStr);
    const colIndex = Number(colStr);
    const yearSegs = yearSegByCell?.get(quadKey);
    const renderYearSegs =
      yearSegs && yearStyle
        ? yearSegs.map((seg, segIndex) => (
            <line
              key={`yearseg-${seg.year}-${rowIndex}-${colIndex}-${segIndex}`}
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={yearStyle.stroke}
              strokeWidth={
                seg.heavy ? yearStyle.thickWidth : yearStyle.thinWidth
              }
              strokeOpacity={
                seg.heavy ? yearStyle.thickOpacity : yearStyle.thinOpacity
              }
              strokeLinecap="round"
            />
          ))
        : null;
    const ageSegs = ageSegByCell?.get(quadKey);
    const renderAgeSegs =
      ageSegs && ageStyle
        ? ageSegs.map((seg, segIndex) => {
            if (seg.age === 0 && seg.visible === false) {
              return null;
            }
            return (
              <line
                key={`ageseg-${seg.age}-${rowIndex}-${colIndex}-${segIndex}`}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke={ageStyle.stroke}
                strokeWidth={
                  seg.heavy ? ageStyle.thickWidth : ageStyle.thinWidth
                }
                strokeOpacity={
                  seg.heavy ? ageStyle.thickOpacity : ageStyle.thinOpacity
                }
                strokeLinecap="round"
              />
            );
          })
        : null;
    const valueSegs = valueSegByCell?.get(quadKey);
    const renderValueSegs =
      valueSegs && valueStyle
        ? valueSegs.map((seg, segIndex) => {
            const heavy = isHeavy(seg.level, valueStyle.heavyStep);
            return (
              <line
                key={`valueseg-${seg.level}-${rowIndex}-${colIndex}-${segIndex}`}
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
    const cohortSegs = cohortSegByCell?.get(quadKey);
    const renderCohortSegs =
      cohortSegs && cohortStyle
        ? cohortSegs.map((seg, segIndex) => (
            <line
              key={`cohortseg-${seg.birthYear}-${quadKey}-${segIndex}`}
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
      !!(
        renderYearSegs ||
        renderAgeSegs ||
        renderValueSegs ||
        renderCohortSegs
      );
    return {
      segments: (
        <>
          {renderYearSegs}
          {renderAgeSegs}
          {renderValueSegs}
          {renderCohortSegs}
        </>
      ),
      hasSegments,
    };
  };
  const buildSegmentItemsForCell = (
    quadKey: string,
    segDepth: number
  ): SegmentRenderItem[] => {
    if (!drawSegments) return [];
    const [rowStr, colStr] = quadKey.split("-");
    const rowIndex = Number(rowStr);
    const colIndex = Number(colStr);
    const items: SegmentRenderItem[] = [];
    const pushSeg = (
      key: string,
      tieKey: string,
      seg: { x1: number; y1: number; x2: number; y2: number },
      stroke: string,
      strokeWidth: number,
      strokeOpacity: number,
      extras?: { level?: number; isContour?: boolean; runId?: number }
    ) => {
      const depthKey =
        Number.isFinite(segDepth) && segDepth !== 0
          ? segDepth
          : (seg.y1 + seg.y2) / 2;
      items.push({
        key,
        tieKey,
        depthKey,
        stroke,
        strokeWidth,
        strokeOpacity,
        x1: seg.x1,
        y1: seg.y1,
        x2: seg.x2,
        y2: seg.y2,
        level: extras?.level,
        isContour: extras?.isContour,
        runId: extras?.runId,
      });
    };
    const yearSegs = yearSegByCell?.get(quadKey);
    if (yearSegs && yearStyle) {
      yearSegs.forEach((seg, segIndex) => {
        pushSeg(
          `yearseg-${seg.year}-${rowIndex}-${colIndex}-${segIndex}`,
          `year-${quadKey}-${segIndex}`,
          seg,
          yearStyle.stroke,
          seg.heavy ? yearStyle.thickWidth : yearStyle.thinWidth,
          seg.heavy ? yearStyle.thickOpacity : yearStyle.thinOpacity
        );
      });
    }
    const ageSegs = ageSegByCell?.get(quadKey);
    if (ageSegs && ageStyle) {
      ageSegs.forEach((seg, segIndex) => {
        if (seg.age === 0 && seg.visible === false) return;
        pushSeg(
          `ageseg-${seg.age}-${rowIndex}-${colIndex}-${segIndex}`,
          `age-${quadKey}-${segIndex}`,
          seg,
          ageStyle.stroke,
          seg.heavy ? ageStyle.thickWidth : ageStyle.thinWidth,
          seg.heavy ? ageStyle.thickOpacity : ageStyle.thinOpacity
        );
      });
    }
    const valueSegs = valueSegByCell?.get(quadKey);
    if (valueSegs && valueStyle) {
      valueSegs.forEach((seg, segIndex) => {
        const heavy = isHeavy(seg.level, valueStyle.heavyStep);
        pushSeg(
          `valueseg-${seg.level}-${rowIndex}-${colIndex}-${segIndex}`,
          `value-${quadKey}-${segIndex}`,
          seg,
          valueStyle.stroke,
          heavy ? valueStyle.thickWidth : valueStyle.thinWidth,
          heavy ? valueStyle.thickOpacity : valueStyle.thinOpacity,
          { level: seg.level, isContour: true, runId: seg.runId }
        );
      });
    }
    const cohortSegs = cohortSegByCell?.get(quadKey);
    if (cohortSegs && cohortStyle) {
      cohortSegs.forEach((seg, segIndex) => {
        pushSeg(
          `cohortseg-${seg.birthYear}-${quadKey}-${segIndex}`,
          `cohort-${quadKey}-${segIndex}`,
          seg,
          cohortStyle.stroke,
          seg.heavy ? cohortStyle.thickWidth : cohortStyle.thinWidth,
          seg.heavy ? cohortStyle.thickOpacity : cohortStyle.thinOpacity
        );
      });
    }
    return items;
  };
  if (debugTriVis && useCells && cells && !triVisLogged) {
    triVisLogged = true;
    const hist: Record<number, number> = {};
    let totalPolys = 0;
    for (const cell of cells) {
      const count = cell.tris.length;
      totalPolys += count;
      hist[count] = (hist[count] ?? 0) + 1;
    }
    // eslint-disable-next-line no-console
    console.log("[TRI_DEBUG_VIS]", { hist, totalPolys });
  }
  const stitchContourSegments = (
    segments: SegmentRenderItem[]
  ): {
    level: number;
    points: Point2D[];
    depthKey: number;
  }[] => {
    const CONTOUR_STITCH_PX = 1.25;
    const buckets = new Map<string, SegmentRenderItem[]>();
    for (const seg of segments) {
      if (seg.level == null) continue;
      const runKey = `${seg.level}-${seg.runId ?? "none"}`;
      const list = buckets.get(runKey) ?? [];
      list.push(seg);
      buckets.set(runKey, list);
    }
    const results: { level: number; points: Point2D[]; depthKey: number }[] =
      [];
    const keyFor = (p: Point2D) =>
      `${Math.round(p.x / CONTOUR_STITCH_PX)},${Math.round(
        p.y / CONTOUR_STITCH_PX
      )}`;
    for (const [runKey, segs] of buckets.entries()) {
      const level = Number(runKey.split("-")[0]);
      const endpointMap = new Map<
        string,
        { segIndex: number; end: 0 | 1 }[]
      >();
      segs.forEach((seg, segIndex) => {
        const p1 = { x: seg.x1, y: seg.y1 };
        const p2 = { x: seg.x2, y: seg.y2 };
        const key1 = keyFor(p1);
        const key2 = keyFor(p2);
        const list1 = endpointMap.get(key1) ?? [];
        list1.push({ segIndex, end: 0 });
        endpointMap.set(key1, list1);
        const list2 = endpointMap.get(key2) ?? [];
        list2.push({ segIndex, end: 1 });
        endpointMap.set(key2, list2);
      });
      const visited = new Array(segs.length).fill(false);
      const dist = (a: Point2D, b: Point2D) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const getPoint = (seg: SegmentRenderItem, end: 0 | 1) =>
        end === 0
          ? { x: seg.x1, y: seg.y1 }
          : { x: seg.x2, y: seg.y2 };
      for (let i = 0; i < segs.length; i++) {
        if (visited[i]) continue;
        visited[i] = true;
        const seg = segs[i];
        let chain = [
          { x: seg.x1, y: seg.y1 },
          { x: seg.x2, y: seg.y2 },
        ];
        let maxDepth = seg.depthKey;
        const extend = (atStart: boolean) => {
          let extended = true;
          while (extended) {
            extended = false;
            const endpoint = atStart ? chain[0] : chain[chain.length - 1];
            const key = keyFor(endpoint);
            const candidates = endpointMap.get(key) ?? [];
            let best: { segIndex: number; end: 0 | 1; other: Point2D } | null =
              null;
            for (const cand of candidates) {
              if (visited[cand.segIndex]) continue;
              const cseg = segs[cand.segIndex];
              const c0 = getPoint(cseg, 0);
              const c1 = getPoint(cseg, 1);
              const other = cand.end === 0 ? c1 : c0;
              if (dist(endpoint, getPoint(cseg, cand.end)) > CONTOUR_STITCH_PX) {
                continue;
              }
              if (
                !best ||
                dist(endpoint, getPoint(cseg, cand.end)) <
                  dist(endpoint, getPoint(segs[best.segIndex], best.end))
              ) {
                best = { segIndex: cand.segIndex, end: cand.end, other };
              }
            }
            if (best) {
              visited[best.segIndex] = true;
              if (segs[best.segIndex].depthKey > maxDepth) {
                maxDepth = segs[best.segIndex].depthKey;
              }
              if (atStart) {
                chain.unshift(best.other);
              } else {
                chain.push(best.other);
              }
              extended = true;
            }
          }
        };
        extend(true);
        extend(false);
        if (chain.length >= 2) {
          results.push({
            level,
            points: chain,
            depthKey: maxDepth + 1e-6,
          });
        }
      }
    }
    return results;
  };
  return (
    <g id="layer-surface">
      {drawQuads && useCells && cells && globalTriSort && (() => {
        const cellDepthByKey = new Map<string, number>();
        for (const cell of cells) {
          cellDepthByKey.set(cell.cellKey, cell.depthKey ?? 0);
        }
        const renderItems: (
          | {
              kind: "tri";
              key: string;
              tieKey: string;
              depthKey: number;
              pts2: [Point2D, Point2D, Point2D];
              pts3: [Point3D, Point3D, Point3D];
              triIndex: number;
            }
          | (SegmentRenderItem & { kind: "seg" })
          | {
              kind: "contour";
              key: string;
              tieKey: string;
              depthKey: number;
              level: number;
              points: Point2D[];
            }
        )[] = [];
        const contourSegs: SegmentRenderItem[] = [];
        for (const cell of cells) {
          const cellDepth = cellDepthByKey.get(cell.cellKey) ?? 0;
          let maxTriDepth = -Infinity;
          cell.tris.forEach((tri, triIndex) => {
            const depthKey =
              (tri.pts3[0].x +
                tri.pts3[0].y +
                tri.pts3[0].z +
                tri.pts3[1].x +
                tri.pts3[1].y +
                tri.pts3[1].z +
                tri.pts3[2].x +
                tri.pts3[2].y +
                tri.pts3[2].z) /
              3;
            if (depthKey > maxTriDepth) maxTriDepth = depthKey;
            renderItems.push({
              kind: "tri",
              key: `tri-${cell.cellKey}-${triIndex}`,
              tieKey: `tri-${cell.cellKey}-${triIndex}`,
              depthKey,
              pts2: tri.pts2,
              pts3: tri.pts3,
              triIndex,
            });
          });
          if (drawSegments) {
            const segDepth =
              Number.isFinite(maxTriDepth) && maxTriDepth > -Infinity
                ? maxTriDepth + 1e-6
                : cellDepth;
            const segItems = buildSegmentItemsForCell(cell.cellKey, segDepth);
            for (const seg of segItems) {
              if (seg.isContour) {
                contourSegs.push(seg);
              } else {
                renderItems.push({ kind: "seg", ...seg });
              }
            }
          }
        }
        const stitchedContours = stitchContourSegments(contourSegs);
        stitchedContours.forEach((chain, chainIndex) => {
          renderItems.push({
            kind: "contour",
            key: `contour-chain-${chain.level}-${chainIndex}`,
            tieKey: `contour-${chain.level}-${chainIndex}`,
            depthKey: chain.depthKey,
            level: chain.level,
            points: chain.points,
          });
        });
        renderItems.sort((a, b) => {
          if (a.depthKey !== b.depthKey) return a.depthKey - b.depthKey;
          return a.tieKey.localeCompare(b.tieKey);
        });
        return (
          <g id="layer-surface-global">
            {renderItems.map((item) =>
              item.kind === "tri" ? (
                <polygon
                  key={item.key}
                  points={item.pts2.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={
                    debugTriVis
                      ? debugTriFill(item.triIndex)
                      : surfaceStyle.fill
                  }
                  stroke={debugTriVis ? debugTriStroke : surfaceStyle.stroke}
                  strokeWidth={
                    debugTriVis
                      ? debugTriStrokeWidth
                      : surfaceStyle.strokeWidth
                  }
                />
              ) : (
                item.kind === "contour" ? (
                  <polyline
                    key={item.key}
                    points={item.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={valueStyle?.stroke ?? "#5c8f6a"}
                    strokeWidth={
                      valueStyle
                        ? isHeavy(item.level, valueStyle.heavyStep)
                          ? valueStyle.thickWidth
                          : valueStyle.thinWidth
                        : 1
                    }
                    strokeOpacity={
                      valueStyle
                        ? isHeavy(item.level, valueStyle.heavyStep)
                          ? valueStyle.thickOpacity
                          : valueStyle.thinOpacity
                        : 1
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <line
                    key={item.key}
                    x1={item.x1}
                    y1={item.y1}
                    x2={item.x2}
                    y2={item.y2}
                    stroke={item.stroke}
                    strokeWidth={item.strokeWidth}
                    strokeOpacity={item.strokeOpacity}
                    strokeLinecap="round"
                  />
                )
              )
            )}
            {debugTriVis &&
              cells.map((cell) =>
                cell.split4 && cell.splitCenter ? (
                  <circle
                    key={`split-center-${cell.cellKey}`}
                    cx={cell.splitCenter.x}
                    cy={cell.splitCenter.y}
                    r={2}
                    fill="magenta"
                    opacity={0.9}
                    pointerEvents="none"
                  />
                ) : null
              )}
          </g>
        );
      })()}
      {drawQuads && useCells && cells && !globalTriSort && (
        <g id="layer-surface-cells">
          {cells.map((cell) => {
            const { segments, hasSegments } = drawSegments
              ? renderSegmentsForCell(cell.cellKey)
              : { segments: null, hasSegments: false };
            return (
              <g key={`cell-${cell.cellKey}`}>
                {cell.tris.map((tri, triIndex) => (
                  <polygon
                    key={`tri-${cell.cellKey}-${triIndex}`}
                    points={tri.pts2.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={
                      debugTriVis ? debugTriFill(triIndex) : surfaceStyle.fill
                    }
                    stroke={debugTriVis ? debugTriStroke : surfaceStyle.stroke}
                    strokeWidth={
                      debugTriVis
                        ? debugTriStrokeWidth
                        : surfaceStyle.strokeWidth
                    }
                  />
                ))}
                {debugTriVis && cell.split4 && cell.splitCenter && (
                  <circle
                    cx={cell.splitCenter.x}
                    cy={cell.splitCenter.y}
                    r={2}
                    fill="magenta"
                    opacity={0.9}
                    pointerEvents="none"
                  />
                )}
                {hasSegments && segments}
              </g>
            );
          })}
        </g>
      )}
      {quads.map((quad, i) => {
        if (useCells) {
          return null;
        }
        const base = drawQuadFill ? (
          <polygon
            points={quad.points2D.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={surfaceStyle.fill}
            stroke={surfaceStyle.stroke}
            strokeWidth={surfaceStyle.strokeWidth}
          />
        ) : null;

        const quadKey = `${quad.rowIndex}-${quad.colIndex}`;
        const yearSegs = yearSegByCell?.get(quadKey);
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
        const ageSegs = ageSegByCell?.get(quadKey);
        const renderAgeSegs =
          drawSegments && ageSegs && ageStyle
            ? ageSegs.map((seg, segIndex) => {
                if (seg.age === 0 && seg.visible === false) {
                  return null;
                }
                return (
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
                );
              })
            : null;
        const valueSegs = valueSegByCell?.get(quadKey);
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
        const cohortSegs = cohortSegByCell?.get(quadKey);
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
          !!(renderYearSegs || renderAgeSegs || renderValueSegs || renderCohortSegs);

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
