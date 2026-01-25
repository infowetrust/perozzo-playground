import type { ProjectionOptions } from "../../../core/geometry";
import type { Frame3D } from "../../../core/frame3d";
import type { Point2D, Point3D } from "../../../core/types";
import type {
  AxisLabelBaseStyle,
  AxisLabelLayout,
  LineStyle,
  ShadingConfig,
} from "../../vizConfig";
import ArchitectureLayer from "../ArchitectureLayer";
import LabelsLayer from "../LabelsLayer";
import SurfaceLayer from "../SurfaceLayer";
import YearWall from "../YearWall";

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

type YearSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heavy: boolean;
  year: number;
  visible?: boolean;
};

type AgeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heavy: boolean;
  age: number;
  visible?: boolean;
};

type CohortSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heavy: boolean;
  birthYear: number;
  visible?: boolean;
};

type ValueSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: number;
  visible?: boolean;
};

type IsotonicSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  quantile: 25 | 50 | 75;
};

type ReverseModel = {
  frame: Frame3D;
  minYearExt: number;
  maxYearExt: number;
  surfacePoints: Point3D[];
  rows: number;
  cols: number;
  ages: number[];
  maxSurvivors: number;
  quads: Quad[];
  cells?: CellRender[];
  yearSegByQuad?: Map<string, YearSegment[]>;
  ageSegByQuad?: Map<string, AgeSegment[]>;
  valueSegByQuad?: Map<string, ValueSegment[]>;
  cohortSegByQuad?: Map<string, CohortSegment[]>;
  isotonicSegByQuad?: Map<string, IsotonicSegment[]>;
  yearLines: { year: number; points: Point2D[] }[];
  ageLines: { age: number; points: Point2D[] }[];
  years: number[];
};

type WallLine = {
  year: number;
  start: Point2D;
  end: Point2D;
  heavy: boolean;
};

type WallValueLine = {
  level: number;
  start: Point2D;
  end: Point2D;
  heavy: boolean;
};

type WallStyle = {
  wallFill: string;
  wallStroke: string;
  ageStroke: string;
  ageThin: number;
  ageThick: number;
  ageHeavyStep: number;
  ageThinOpacity: number;
  ageThickOpacity: number;
  valueStroke: string;
  valueThin: number;
  valueThick: number;
  valueHeavyStep: number;
  valueThinOpacity: number;
  valueThickOpacity: number;
  surfaceFill: string;
  surfaceStroke: string;
  surfaceStrokeWidth: number;
};

type CommonLabelProps = {
  axisLabelBaseStyle: AxisLabelBaseStyle;
  vizStyle: {
    ages: { stroke: string };
    values: { stroke: string };
    years: { stroke: string };
  };
  valueLevels: {
    left: number[];
    right: number[];
  };
  valueLabelFormat?: "millions";
  age100Text?: string;
  titleProps: {
    x: number;
    y: number;
    style: { text: string };
    legend: {
      ages: string;
      values: string;
      cohorts: string;
      years: string;
      quadrants?: string;
      thin: number;
      thick: number;
    };
    title?: {
      bigWord?: string;
      years?: string;
    };
  };
  titleVariant?: "usa";
  topValueByYear: Record<number, number>;
  yearLabelSides?: ("top" | "bottom")[];
};

type ReverseLabelConfig = {
  ageSide: "left" | "right" | "both";
  ageTextAnchor: "start" | "middle" | "end";
  ageTickScale: number;
  ageTickOffset: number;
  valueSide: "left" | "right" | "both";
  valueTextAnchor: "start" | "middle" | "end";
  valueTickScale: number;
  valueTickOffset: number;
  valueIncludeZero: boolean;
  yearAngleDeg: number;
  yearYOffset: number;
  yearXOffset: number;
  yearAnchorAge: number;
};

type ReverseViewProps = {
  width: number;
  height: number;
  svgStyle: { border: string; background: string };
  offsetX: number;
  offsetY: number;
  layersEnabled: {
    architecture: boolean;
    surface: boolean;
    labels: boolean;
  };
  showWall1900: boolean;
  model: ReverseModel;
  projection: ProjectionOptions;
  floorFrameString: string;
  floorAlpha: number;
  shadingConfig: ShadingConfig;
  floorStyle: { fill: string; stroke: string };
  floorAgeStyle: { stroke: string; strokeWidth: number };
  age0WallIsolineStyle: LineStyle;
  wall2025Style: WallStyle;
  wall1900Style: WallStyle;
  wall1900TopEdge2D: Point2D[];
  floorZ: number;
  valueStep: number;
  valueMinorStep: number;
  extendLeftYears: number;
  extendRightYears: number;
  globalTriSort: boolean;
  lightDir: { x: number; y: number; z: number };
  surfaceStyle: { fill: string; stroke: string; strokeWidth: number };
  yearStyle: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
    heavyStep: number;
  };
  ageStyle: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
    heavyStep: number;
  };
  cohortStyle: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
    heavyStep: number;
  };
  valueStyle: LineStyle;
  isotonicStyle: {
    stroke: string;
    thinWidth: number;
    thickWidth: number;
    thinOpacity: number;
    thickOpacity: number;
  };
  age0Wall: string | null;
  age0WallClipId: string;
  age0WallYearLines: WallLine[];
  age0WallValueLines: WallValueLine[];
  age0WallTopLine?: { points: Point2D[] };
  axisLabelLayout: AxisLabelLayout;
  reverseLabelConfig: ReverseLabelConfig;
  commonLabelProps: CommonLabelProps;
};

export default function ReverseView({
  width,
  height,
  svgStyle,
  offsetX,
  offsetY,
  layersEnabled,
  showWall1900,
  model,
  projection,
  floorFrameString,
  floorAlpha,
  shadingConfig,
  floorStyle,
  floorAgeStyle,
  age0WallIsolineStyle,
  wall2025Style,
  wall1900Style,
  wall1900TopEdge2D,
  floorZ,
  valueStep,
  valueMinorStep,
  extendLeftYears,
  extendRightYears,
  globalTriSort,
  lightDir,
  surfaceStyle,
  yearStyle,
  ageStyle,
  cohortStyle,
  valueStyle,
  isotonicStyle,
  age0Wall,
  age0WallClipId,
  age0WallYearLines,
  age0WallValueLines,
  age0WallTopLine,
  axisLabelLayout,
  reverseLabelConfig,
  commonLabelProps,
}: ReverseViewProps) {
  const minYearLine = model.yearLines.find(
    (line) => line.year === model.frame.minYear
  );
  const age0Line = model.ageLines.find((line) => line.age === model.ages[0]);
  const age0YearMaxLine = age0WallYearLines.find(
    (line) => line.year === model.frame.maxYear
  );
  const age0ValueLine = age0WallValueLines.find((line) => line.level === 0);

  return (
    <div
      style={{
        marginTop: 24,
        position: "relative",
        width,
        height,
      }}
    >
      <svg
        width={width}
        height={height}
        style={{
          border: `1px solid ${svgStyle.border}`,
          background: svgStyle.background,
          display: "block",
        }}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {layersEnabled.architecture && (
            <ArchitectureLayer
              frame={model.frame}
              projection={projection}
              minYearExt={model.minYearExt}
              maxYearExt={model.maxYearExt}
              extendLeftYears={extendLeftYears}
              extendRightYears={extendRightYears}
              floorFrameString={floorFrameString}
              floorAlpha={floorAlpha}
              shadingInkColor={shadingConfig.inkColor}
              age0WallIsolineStyle={age0WallIsolineStyle}
              age0WallFullLevels={[]}
              age0Wall2025OnlyLevels={[]}
              floorStyle={floorStyle}
              floorAgeStyle={floorAgeStyle}
              wall2025Style={wall2025Style}
              shadingConfig={shadingConfig}
              surfacePoints={model.surfacePoints}
              rows={model.rows}
              cols={model.cols}
              ages={model.ages}
              maxSurvivors={model.maxSurvivors}
              floorZ={floorZ}
              valueStep={valueStep}
              valueMinorStep={valueMinorStep}
              showWall2025={false}
            />
          )}
          {layersEnabled.surface && (
            <SurfaceLayer
              quads={model.quads}
              cells={model.cells}
              globalTriSort={globalTriSort}
              depthSortSign={-1}
              surfaceStyle={surfaceStyle}
              shading={shadingConfig}
              lightDir={lightDir}
              drawSegments={model.cells.length > 0}
              yearSegByCell={model.yearSegByQuad}
              yearStyle={yearStyle}
              ageSegByCell={model.ageSegByQuad}
              ageStyle={ageStyle}
              valueSegByCell={model.valueSegByQuad}
              valueStyle={valueStyle}
              cohortSegByCell={model.cohortSegByQuad}
              cohortStyle={cohortStyle}
              isotonicSegByCell={model.isotonicSegByQuad}
              isotonicStyle={isotonicStyle}
            />
          )}
          {age0Wall && (
            <>
              <defs>
                <clipPath id={age0WallClipId} clipPathUnits="userSpaceOnUse">
                  <polygon points={age0Wall} />
                </clipPath>
              </defs>
              <polygon
                id="layer-reverse-age0-wall"
                points={age0Wall}
                fill="#f5f3e5"
                stroke="none"
              />
              <g clipPath={`url(#${age0WallClipId})`}>
                {age0WallYearLines.map((line) => (
                  <line
                    key={`rev-age0-year-${line.year}`}
                    x1={line.start.x}
                    y1={line.start.y}
                    x2={line.end.x}
                    y2={line.end.y}
                    stroke={yearStyle.stroke}
                    strokeWidth={
                      line.heavy ? yearStyle.thickWidth : yearStyle.thinWidth
                    }
                    strokeOpacity={
                      line.heavy ? yearStyle.thickOpacity : yearStyle.thinOpacity
                    }
                    strokeLinecap="round"
                  />
                ))}
                {age0WallValueLines.map((line) => (
                  <line
                    key={`rev-age0-val-${line.level}`}
                    x1={line.start.x}
                    y1={line.start.y}
                    x2={line.end.x}
                    y2={line.end.y}
                    stroke={valueStyle.stroke}
                    strokeWidth={
                      line.heavy ? valueStyle.thickWidth : valueStyle.thinWidth
                    }
                    strokeOpacity={
                      line.heavy
                        ? valueStyle.thickOpacity
                        : valueStyle.thinOpacity
                    }
                    strokeLinecap="round"
                  />
                ))}
              </g>
            </>
          )}
          {showWall1900 && (
            <YearWall
              surfacePoints={model.surfacePoints}
              topEdge2D={wall1900TopEdge2D}
              wallYear={model.frame.minYear}
              colIndex={0}
              rows={model.rows}
              cols={model.cols}
              projection={projection}
              floorZ={floorZ}
              ages={model.ages}
              maxSurvivors={model.maxSurvivors}
              valueStep={valueStep}
              valueMinorStep={valueMinorStep}
              frame={model.frame}
              shading={shadingConfig}
              style={wall1900Style}
            />
          )}
          {minYearLine && (
            <polyline
              points={minYearLine.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={yearStyle.stroke}
              strokeWidth={yearStyle.thickWidth}
              strokeOpacity={yearStyle.thickOpacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {age0YearMaxLine && age0WallTopLine && (
            <line
              x1={age0YearMaxLine.start.x}
              y1={age0YearMaxLine.start.y}
              x2={
                age0WallTopLine.points[
                  Math.max(0, model.years.indexOf(model.frame.maxYear))
                ]?.x ?? age0YearMaxLine.end.x
              }
              y2={
                age0WallTopLine.points[
                  Math.max(0, model.years.indexOf(model.frame.maxYear))
                ]?.y ?? age0YearMaxLine.end.y
              }
              stroke={yearStyle.stroke}
              strokeWidth={yearStyle.thickWidth}
              strokeOpacity={yearStyle.thickOpacity}
              strokeLinecap="round"
            />
          )}
          {age0Line && (
            <polyline
              points={age0Line.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={ageStyle.stroke}
              strokeWidth={ageStyle.thickWidth}
              strokeOpacity={ageStyle.thickOpacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {age0ValueLine && (
            <line
              x1={age0ValueLine.start.x}
              y1={age0ValueLine.start.y}
              x2={age0ValueLine.end.x}
              y2={age0ValueLine.end.y}
              stroke={valueStyle.stroke}
              strokeWidth={valueStyle.thickWidth}
              strokeOpacity={valueStyle.thickOpacity}
              strokeLinecap="round"
            />
          )}
          {layersEnabled.labels && (
            <LabelsLayer
              frame={model.frame}
              projection={projection}
              years={model.years}
              minYearExt={model.minYearExt}
              maxYearExt={model.maxYearExt}
              axisLabelLayout={axisLabelLayout}
              showTitle={false}
              ageLabelSideOverride={reverseLabelConfig.ageSide}
              ageLabelTextAnchorOverride={reverseLabelConfig.ageTextAnchor}
              ageLabelShowTicks
              ageLabelTickScale={reverseLabelConfig.ageTickScale}
              ageLabelTickOffset={reverseLabelConfig.ageTickOffset}
              valueLabelSideOverride={reverseLabelConfig.valueSide}
              valueLabelTextAnchorOverride={reverseLabelConfig.valueTextAnchor}
              valueLabelShowTicks
              valueLabelTickScale={reverseLabelConfig.valueTickScale}
              valueLabelTickOffset={reverseLabelConfig.valueTickOffset}
              valueLabelIncludeZero={reverseLabelConfig.valueIncludeZero}
              yearBottomAngleDeg={reverseLabelConfig.yearAngleDeg}
              yearBottomYOffset={reverseLabelConfig.yearYOffset}
              yearBottomXOffset={reverseLabelConfig.yearXOffset}
              yearBottomAnchorAge={reverseLabelConfig.yearAnchorAge}
              {...commonLabelProps}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
