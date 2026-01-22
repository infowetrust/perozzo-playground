import { useMemo, useState } from "react";
import type { Ref } from "react";
import { isHeavy } from "../vizConfig";
import { segmentizeContourPolyline } from "../contourSegmenter";

type LineStyle = {
  stroke: string;
  thinWidth: number;
  thickWidth: number;
  thinOpacity: number;
  thickOpacity: number;
  heavyStep: number;
};

type YearAgePoint = { year: number; age: number | null };

type TopViewProps = {
  width: number;
  height: number;
  years: number[];
  ages: number[];
  rows: Array<{ year: number; age: number; survivors: number }>;
  contours: Array<{ level: number; points: YearAgePoint[]; runId?: number }>;
  isotonicRows?: Array<{
    year: number;
    q25_age: number;
    q50_age: number;
    q75_age: number;
  }>;
  isotonicStyle?: {
    stroke: string;
    width: number;
    opacity: number;
  };
  showYears?: boolean;
  showAges?: boolean;
  showCohorts?: boolean;
  showContours?: boolean;
  showContourCrossings?: boolean;
  showIsotonic?: boolean;
  contourMode?: "raw" | "segmented";
  svgRef?: Ref<SVGSVGElement>;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  lineStyle: {
    years: LineStyle;
    ages: LineStyle;
    cohorts: LineStyle;
    values: LineStyle;
  };
  axisLabelStyle: {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    opacity: number;
  };
  showTitle?: boolean;
};

const DEBUG_CONTOUR_STATS = true;
let contourStatsLogged = false;
const TOPVIEW_HOVER_PX = 8;
const HOVER_POINT_A_COLOR = "#c43b3b";
const HOVER_POINT_B_COLOR = "#2f69c6";
const CROSSING_DOT_RADIUS = 1.4;
const CROSSING_DOT_OPACITY = 0.55;

// Sanity checks:
// - Fractional contour endpoints should appear at fractional x positions.
// - If stereogram misses an endpoint but Top view shows it, issue is in 3D segmentation.

export default function TopView({
  width,
  height,
  years,
  ages,
  rows,
  contours,
  isotonicRows = [],
  isotonicStyle,
  showYears = true,
  showAges = true,
  showCohorts = true,
  showContours = true,
  showContourCrossings = false,
  showIsotonic = true,
  contourMode = "raw",
  svgRef,
  padding,
  lineStyle,
  axisLabelStyle,
  showTitle = true,
}: TopViewProps) {
  const [hover, setHover] = useState<{
    level: number;
    runId: string;
    pointA: number;
    pointB: number;
    yearA: number;
    ageA: number;
    yearB: number;
    ageB: number;
    x: number;
    y: number;
  } | null>(null);
  const [crossingHover, setCrossingHover] = useState<{
    x: number;
    y: number;
    level: number;
    year: number;
    age: number;
    col: number;
    row: number;
  } | null>(null);
  const pad = {
    top: padding?.top ?? 32,
    right: padding?.right ?? 44,
    bottom: padding?.bottom ?? 44,
    left: padding?.left ?? 32,
  };
  const yearMin = years[0] ?? 0;
  const yearMax = years[years.length - 1] ?? 1;
  const ageMin = ages[0] ?? 0;
  const ageMax = ages[ages.length - 1] ?? 1;

  const plotHeight = height - pad.top - pad.bottom;
  const yPixelsPerAge = plotHeight / (ageMax - ageMin);
  const scaleX = (year: number) =>
    pad.left + (year - yearMin) * yPixelsPerAge;
  const scaleY = (age: number) =>
    pad.top + (age - ageMin) * yPixelsPerAge;

  const birthYearSet = new Set<number>();
  for (const row of rows) {
    birthYearSet.add(row.year - row.age);
  }
  const birthYears = Array.from(birthYearSet).sort((a, b) => a - b);

  const yearLabels = years.filter((year) => {
    if (year === yearMin || year === yearMax) return true;
    return (year - yearMin) % lineStyle.years.heavyStep === 0;
  });

  const ageLabels = [0, 25, 50, 75, 100].filter((age) =>
    ages.includes(age)
  );

  const renderPolyline = (
    points: { x: number; y: number }[],
    style: LineStyle,
    heavy: boolean,
    key: string
  ) => {
    if (points.length < 2) return null;
    return (
      <polyline
        key={key}
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={style.stroke}
        strokeWidth={heavy ? style.thickWidth : style.thinWidth}
        strokeOpacity={heavy ? style.thickOpacity : style.thinOpacity}
      />
    );
  };

  const isotonicRuns = useMemo(() => {
    if (!isotonicRows.length) return [];
    const build = (field: "q25_age" | "q50_age" | "q75_age") =>
      isotonicRows
        .filter(
          (row) =>
            Number.isFinite(row.year) && Number.isFinite(row[field])
        )
        .map((row) => ({
          x: scaleX(row.year),
          y: scaleY(row[field]),
        }));
    return [
      { key: "isotonic-25", pts: build("q25_age") },
      { key: "isotonic-50", pts: build("q50_age") },
      { key: "isotonic-75", pts: build("q75_age") },
    ];
  }, [isotonicRows, scaleX, scaleY]);

  const contourRuns = useMemo(
    () =>
      contours.map((iso, index) => {
        const data = iso.points
          .filter(
            (p) => Number.isFinite(p.year) && Number.isFinite(p.age ?? NaN)
          )
          .map((p) => ({
            year: p.year,
            age: p.age as number,
            x: scaleX(p.year),
            y: scaleY(p.age as number),
          }));
        const runId =
          typeof iso.runId === "number"
            ? `${iso.level}-${iso.runId}`
            : `${iso.level}-${index}`;
        return {
          runId,
          level: iso.level,
          pts: data.map((p) => ({ x: p.x, y: p.y })),
          data,
        };
      }),
    [contours, scaleX, scaleY]
  );

  const contourSegmentsRaw = useMemo(() => {
    const segs: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      level: number;
      runId: string;
    }[] = [];
    for (const run of contourRuns) {
      const pts = run.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (!a || !b) continue;
        if (a.x === b.x && a.y === b.y) continue;
        const dataA = run.data[i];
        const dataB = run.data[i + 1];
        segs.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          level: run.level,
          runId: run.runId,
          pointA: i,
          pointB: i + 1,
          yearA: dataA?.year ?? NaN,
          ageA: dataA?.age ?? NaN,
          yearB: dataB?.year ?? NaN,
          ageB: dataB?.age ?? NaN,
        });
      }
    }
    return segs;
  }, [contourRuns]);

  const contourCrossings = useMemo(() => {
    if (!showContourCrossings) return [];
    const yearIndex = new Map<number, number>();
    const ageIndex = new Map<number, number>();
    years.forEach((y, i) => yearIndex.set(y, i));
    ages.forEach((a, i) => ageIndex.set(a, i));
    const rowsCount = ages.length;
    const colsCount = years.length;
    const values: number[] = new Array(rowsCount * colsCount).fill(NaN);
    rows.forEach((row) => {
      const r = ageIndex.get(row.age);
      const c = yearIndex.get(row.year);
      if (r == null || c == null) return;
      values[r * colsCount + c] = row.survivors;
    });
    const levels = Array.from(new Set(contours.map((c) => c.level))).sort(
      (a, b) => a - b
    );
    const points: {
      x: number;
      y: number;
      level: number;
      year: number;
      age: number;
      col: number;
      row: number;
    }[] = [];
    const valueAt = (r: number, c: number) => values[r * colsCount + c];
    for (const level of levels) {
      for (let c = 0; c < colsCount; c++) {
        const year = years[c];
        for (let r = 0; r < rowsCount - 1; r++) {
          const v0 = valueAt(r, c);
          const v1 = valueAt(r + 1, c);
          if (!Number.isFinite(v0) || !Number.isFinite(v1) || v0 === v1) {
            continue;
          }
          const lo = Math.min(v0, v1);
          const hi = Math.max(v0, v1);
          if (level < lo || level > hi) continue;
          const t = (level - v0) / (v1 - v0);
          if (t < 0 || t > 1) continue;
          const age = ages[r] + t * (ages[r + 1] - ages[r]);
          points.push({
            x: scaleX(year),
            y: scaleY(age),
            level,
            year,
            age,
            col: c,
            row: r,
          });
        }
      }
    }
    return points;
  }, [showContourCrossings, rows, years, ages, contours, scaleX, scaleY]);

  const distPointToSegment = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const abLen2 = abx * abx + aby * aby;
    if (abLen2 === 0) {
      return Math.hypot(apx, apy);
    }
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
    const closestX = a.x + abx * t;
    const closestY = a.y + aby * t;
    return Math.hypot(p.x - closestX, p.y - closestY);
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!showContours || contourMode !== "raw") {
      if (hover) setHover(null);
      if (crossingHover) setCrossingHover(null);
      return;
    }
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let nearest: typeof hover = null;
    let nearestDist = TOPVIEW_HOVER_PX;
    for (const seg of contourSegmentsRaw) {
      const dist = distPointToSegment(
        { x, y },
        { x: seg.x1, y: seg.y1 },
        { x: seg.x2, y: seg.y2 }
      );
      if (dist <= nearestDist) {
        nearestDist = dist;
        nearest = {
          level: seg.level,
          runId: seg.runId,
          pointA: seg.pointA,
          pointB: seg.pointB,
          yearA: seg.yearA,
          ageA: seg.ageA,
          yearB: seg.yearB,
          ageB: seg.ageB,
          x,
          y,
        };
      }
    }
    setHover(nearest);

    if (showContourCrossings && contourCrossings.length) {
      let crossBest: typeof contourCrossings[number] | null = null;
      let crossDist = TOPVIEW_HOVER_PX;
      for (const pt of contourCrossings) {
        const d = Math.hypot(pt.x - x, pt.y - y);
        if (d <= crossDist) {
          crossDist = d;
          crossBest = pt;
        }
      }
      if (crossBest) {
        setCrossingHover({
          x,
          y,
          level: crossBest.level,
          year: crossBest.year,
          age: crossBest.age,
          col: crossBest.col,
          row: crossBest.row,
        });
      } else if (crossingHover) {
        setCrossingHover(null);
      }
    } else if (crossingHover) {
      setCrossingHover(null);
    }
  };

  const handleMouseLeave = () => {
    setHover(null);
    setCrossingHover(null);
  };

  const contourSegments =
    showContours && contourMode === "segmented"
      ? contours.flatMap((iso) => {
          const points = iso.points.filter(
            (p) =>
              Number.isFinite(p.year) && Number.isFinite(p.age ?? NaN)
          );
          if (points.length < 2) return [];
          const pts2 = points.map((p) => ({
            x: scaleX(p.year),
            y: scaleY(p.age as number),
          }));
          const data = points.map((p) => ({
            year: p.year,
            age: p.age as number,
          }));
          return segmentizeContourPolyline(
            iso.level,
            pts2,
            data,
            years,
            ages
          );
        })
      : [];

  if (DEBUG_CONTOUR_STATS && !contourStatsLogged) {
    contourStatsLogged = true;
    const level = 12_000_000;
    const rawRuns = contours.filter((iso) => iso.level === level);
    const rawPointsTotal = rawRuns.reduce(
      (sum, run) => sum + run.points.length,
      0
    );
    const segs = rawRuns.flatMap((iso) => {
      const points = iso.points.filter(
        (p) =>
          Number.isFinite(p.year) && Number.isFinite(p.age ?? NaN)
      );
      if (points.length < 2) return [];
      const pts2 = points.map((p) => ({
        x: scaleX(p.year),
        y: scaleY(p.age as number),
      }));
      const data = points.map((p) => ({
        year: p.year,
        age: p.age as number,
      }));
      return segmentizeContourPolyline(
        iso.level,
        pts2,
        data,
        years,
        ages
      );
    });
    const uniqueCellsTouched = new Set(segs.map((seg) => seg.cellKey))
      .size;
    // eslint-disable-next-line no-console
    console.log("[TOPVIEW CONTOUR STATS]", {
      level,
      rawRuns: rawRuns.length,
      rawPointsTotal,
      segLinesTotal: segs.length,
      uniqueCellsTouched,
    });
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ overflow: "visible" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <g>
        {showTitle && (
          <text
            x={pad.left}
            y={pad.top - 8}
            fontFamily={axisLabelStyle.fontFamily}
            fontSize={axisLabelStyle.fontSize}
            fontWeight={axisLabelStyle.fontWeight}
            fill="#333"
            opacity={axisLabelStyle.opacity}
          >
            Top view
          </text>
        )}

        {showAges &&
          ages.map((age) => {
            const heavy = (age - ageMin) % lineStyle.ages.heavyStep === 0;
            const points = years.map((year) => ({
              x: scaleX(year),
              y: scaleY(age),
            }));
            return renderPolyline(points, lineStyle.ages, heavy, `age-${age}`);
          })}

        {showYears &&
          years.map((year) => {
            const heavy = (year - yearMin) % lineStyle.years.heavyStep === 0;
            const points = ages.map((age) => ({
              x: scaleX(year),
              y: scaleY(age),
            }));
            return renderPolyline(
              points,
              lineStyle.years,
              heavy,
              `year-${year}`
            );
          })}

        {showCohorts &&
          birthYears.map((birthYear) => {
            const points: { x: number; y: number }[] = [];
            for (const year of years) {
              const age = year - birthYear;
              if (age < ageMin || age > ageMax) continue;
              if (age % 5 !== 0) continue;
              points.push({ x: scaleX(year), y: scaleY(age) });
            }
            const heavy =
              (birthYear - yearMin) % lineStyle.cohorts.heavyStep === 0;
            return renderPolyline(
              points,
              lineStyle.cohorts,
              heavy,
              `cohort-${birthYear}`
            );
          })}

        {showContours &&
          contourMode === "raw" &&
          contourRuns.map((run) => {
            const heavy = isHeavy(run.level, lineStyle.values.heavyStep);
            return renderPolyline(
              run.pts,
              lineStyle.values,
              heavy,
              `contour-${run.runId}`
            );
          })}
        {showContourCrossings &&
          contourCrossings.map((pt, idx) => {
            const heavy = isHeavy(pt.level, lineStyle.values.heavyStep);
            return (
              <circle
                key={`crossing-${pt.level}-${idx}`}
                cx={pt.x}
                cy={pt.y}
                r={heavy ? CROSSING_DOT_RADIUS + 0.4 : CROSSING_DOT_RADIUS}
                fill={lineStyle.values.stroke}
                opacity={heavy ? CROSSING_DOT_OPACITY + 0.15 : CROSSING_DOT_OPACITY}
                pointerEvents="none"
              />
            );
          })}
        {showContours &&
          contourMode === "segmented" &&
          contourSegments.map((seg, index) => {
            const heavy = isHeavy(seg.level, lineStyle.values.heavyStep);
            const opacity = heavy
              ? lineStyle.values.thickOpacity
              : lineStyle.values.thinOpacity;
            const boosted = Math.min(1, opacity * 1.2);
            return (
              <line
                key={`contourseg-${seg.level}-${index}`}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke={lineStyle.values.stroke}
                strokeWidth={
                  heavy
                    ? lineStyle.values.thickWidth
                    : lineStyle.values.thinWidth
                }
                strokeOpacity={boosted}
                strokeLinecap="round"
              />
            );
          })}
        {showIsotonic &&
          isotonicStyle &&
          isotonicRuns.map((run) =>
            run.pts.length < 2 ? null : (
              <polyline
                key={run.key}
                points={run.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={isotonicStyle.stroke}
                strokeWidth={isotonicStyle.width}
                strokeOpacity={isotonicStyle.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          )}
        {showContours && contourMode === "raw" && hover && (() => {
          const run = contourRuns.find((item) => item.runId === hover.runId);
          if (!run || run.pts.length < 2) return null;
          const heavy = isHeavy(run.level, lineStyle.values.heavyStep);
          return (
            <polyline
              points={run.pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={lineStyle.values.stroke}
              strokeWidth={
                (heavy ? lineStyle.values.thickWidth : lineStyle.values.thinWidth) + 1
              }
              strokeOpacity={1}
            />
          );
        })()}
        {showContourCrossings && crossingHover && (
          <g pointerEvents="none">
            <rect
              x={crossingHover.x + 8}
              y={crossingHover.y - 24}
              width={140}
              height={32}
              fill="rgba(255,255,255,0.9)"
              stroke="rgba(0,0,0,0.2)"
              strokeWidth={0.5}
              rx={4}
            />
            <text
              x={crossingHover.x + 12}
              y={crossingHover.y - 8}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill="#222"
            >
              {`${Math.round(crossingHover.level / 1_000_000)}M`}
            </text>
            <text
              x={crossingHover.x + 52}
              y={crossingHover.y - 8}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill="#444"
            >
              {`y=${crossingHover.year.toFixed(0)} a=${crossingHover.age.toFixed(2)}`}
            </text>
          </g>
        )}
        {hover && (
          <g pointerEvents="none">
            <circle
              cx={scaleX(hover.yearA)}
              cy={scaleY(hover.ageA)}
              r={2.6}
              fill={HOVER_POINT_A_COLOR}
              opacity={0.9}
            />
            <circle
              cx={scaleX(hover.yearB)}
              cy={scaleY(hover.ageB)}
              r={2.6}
              fill={HOVER_POINT_B_COLOR}
              opacity={0.9}
            />
            <rect
              x={hover.x + 8}
              y={hover.y - 28}
              width={140}
              height={42}
              fill="rgba(255,255,255,0.9)"
              stroke="rgba(0,0,0,0.2)"
              strokeWidth={0.5}
              rx={4}
            />
            <text
              x={hover.x + 12}
              y={hover.y - 12}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill="#222"
            >
              {`${Math.round(hover.level / 1_000_000)}M run ${hover.runId}`}
            </text>
            <text
              x={hover.x + 12}
              y={hover.y + 2}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill={HOVER_POINT_A_COLOR}
            >
              {`p${hover.pointA} (${hover.yearA.toFixed(2)}, ${hover.ageA.toFixed(
                2
              )})`}
            </text>
            <text
              x={hover.x + 76}
              y={hover.y + 2}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill="#222"
            >
              →
            </text>
            <text
              x={hover.x + 90}
              y={hover.y + 2}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill={HOVER_POINT_B_COLOR}
            >
              {`p${hover.pointB} (${hover.yearB.toFixed(2)}, ${hover.ageB.toFixed(
                2
              )})`}
            </text>
          </g>
        )}

        {yearLabels.map((year) => {
          const x = scaleX(year);
          const y = height - pad.bottom + 12;
          return (
            <text
              key={`year-label-${year}`}
              x={x}
              y={y}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill={lineStyle.years.stroke}
              fillOpacity={axisLabelStyle.opacity}
              textAnchor="start"
              transform={`rotate(90 ${x} ${y})`}
            >
              {year}
            </text>
          );
        })}

        {ageLabels.map((age) => {
          const label =
            age === 0 ? "Born" : age === 100 ? "100 years old" : `${age}`;
          return (
            <text
              key={`age-label-${age}`}
              x={width - pad.right + 8}
              y={scaleY(age)}
              fontFamily={axisLabelStyle.fontFamily}
              fontSize={axisLabelStyle.fontSize}
              fontWeight={axisLabelStyle.fontWeight}
              fill={lineStyle.ages.stroke}
              fillOpacity={axisLabelStyle.opacity}
              textAnchor="start"
              dominantBaseline="middle"
            >
              {label}
            </text>
          );
        })}
      </g>
      {hover && (
        <g pointerEvents="none">
          <rect
            x={hover.x + 10}
            y={hover.y + 10}
            width={90}
            height={34}
            rx={4}
            ry={4}
            fill="rgba(255,255,255,0.9)"
            stroke="#222"
            strokeWidth={0.5}
          />
          <text
            x={hover.x + 16}
            y={hover.y + 24}
            fontFamily={axisLabelStyle.fontFamily}
            fontSize={axisLabelStyle.fontSize}
            fontWeight={axisLabelStyle.fontWeight}
            fill="#222"
          >
            {`${Math.round(hover.level / 1_000_000)}M`}
          </text>
          <text
            x={hover.x + 16}
            y={hover.y + 38}
            fontFamily={axisLabelStyle.fontFamily}
            fontSize={axisLabelStyle.fontSize}
            fontWeight={axisLabelStyle.fontWeight}
            fill="#444"
          >
            {hover.level.toLocaleString("en-US")}
          </text>
        </g>
      )}
    </svg>
  );
}
