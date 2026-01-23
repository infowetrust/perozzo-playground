import TitleBlock from "./TitleBlock";
import TitleBlockUSA from "./TitleBlockUSA";
import AgeLabels from "./AgeLabels";
import ValueIsolineLabels from "./ValueIsolineLabels";
import YearLabels from "./YearLabels";
import type { Frame3D } from "../../core/frame3d";
import type { ProjectionOptions } from "../../core/geometry";
import type {
  AxisLabelStyle,
  AxisLabelLayout,
  AxisLabelBaseStyle,
} from "../vizConfig";

type LabelsLayerProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  years: number[];
  minYearExt: number;
  maxYearExt: number;
  axisLabelBaseStyle: AxisLabelBaseStyle;
  axisLabelLayout: AxisLabelLayout;
  vizStyle: {
    ages: { stroke: string };
    values: { stroke: string };
    years: { stroke: string };
  };
  valueLevels: {
    left: number[];
    right: number[];
  };
  showTitle?: boolean;
  valueLabelFormat?: "millions";
  age100Text?: string;
  ageLabelSideOverride?: "left" | "right" | "both";
  ageLabelTextAnchorOverride?: "start" | "middle" | "end";
  ageLabelShowLeaders?: boolean;
  ageLabelLeaderScale?: number;
  ageLabelLeaderOffset?: number;
  valueLabelSideOverride?: "left" | "right" | "both";
  valueLabelTextAnchorOverride?: "start" | "middle" | "end";
  valueLabelShowLeaders?: boolean;
  valueLabelLeaderScale?: number;
  valueLabelLeaderOffset?: number;
  valueLabelIncludeZero?: boolean;
  yearBottomAngleDeg?: number;
  yearBottomYOffset?: number;
  yearBottomXOffset?: number;
  yearBottomAnchorAge?: number;
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

export default function LabelsLayer({
  frame,
  projection,
  years,
  minYearExt,
  maxYearExt,
  axisLabelBaseStyle,
  axisLabelLayout,
  vizStyle,
  valueLevels,
  showTitle = true,
  valueLabelFormat,
  age100Text,
  ageLabelSideOverride,
  ageLabelTextAnchorOverride,
  ageLabelShowLeaders,
  ageLabelLeaderScale,
  ageLabelLeaderOffset,
  valueLabelSideOverride,
  valueLabelTextAnchorOverride,
  valueLabelShowLeaders,
  valueLabelLeaderScale,
  valueLabelLeaderOffset,
  valueLabelIncludeZero,
  yearBottomAngleDeg,
  yearBottomYOffset,
  yearBottomXOffset,
  yearBottomAnchorAge,
  titleProps,
  topValueByYear,
  yearLabelSides,
  titleVariant,
}: LabelsLayerProps) {
  const ageLabelStyle: AxisLabelStyle = {
    ...axisLabelBaseStyle,
    color: vizStyle.ages.stroke,
  };
  const valueLabelStyle: AxisLabelStyle = {
    ...axisLabelBaseStyle,
    color: vizStyle.values.stroke,
  };
  const yearLabelStyle: AxisLabelStyle = {
    ...axisLabelBaseStyle,
    color: vizStyle.years.stroke,
  };
  return (
    <g id="layer-labels">
      <AgeLabels
        frame={frame}
        projection={projection}
        minYearExt={minYearExt}
        maxYearExt={maxYearExt}
        side={ageLabelSideOverride ?? axisLabelLayout.side}
        tickLen={axisLabelLayout.tickLen}
        textOffset={axisLabelLayout.textOffset}
        style={ageLabelStyle}
        age100Text={age100Text}
        textAnchorOverride={ageLabelTextAnchorOverride}
        showLeaders={ageLabelShowLeaders}
        leaderScale={ageLabelLeaderScale}
        leaderOffset={ageLabelLeaderOffset}
      />
      <ValueIsolineLabels
        frame={frame}
        projection={projection}
        minYearExt={minYearExt}
        maxYearExt={maxYearExt}
        side={valueLabelSideOverride ?? axisLabelLayout.side}
        tickLen={axisLabelLayout.tickLen}
        textOffset={axisLabelLayout.textOffset}
        style={valueLabelStyle}
        leftLevels={valueLevels.left}
        rightLevels={valueLevels.right}
        labelFormat={valueLabelFormat}
        textAnchorOverride={valueLabelTextAnchorOverride}
        showLeaders={valueLabelShowLeaders}
        leaderScale={valueLabelLeaderScale}
        leaderOffset={valueLabelLeaderOffset}
        includeZeroLevel={valueLabelIncludeZero}
      />
      <YearLabels
        frame={frame}
        projection={projection}
        years={years}
        minYearExt={minYearExt}
        maxYearExt={maxYearExt}
        majorStep={25}
        tickLen={axisLabelLayout.tickLen}
        textOffset={axisLabelLayout.textOffset}
        style={yearLabelStyle}
        bottomAngleDeg={yearBottomAngleDeg ?? -50}
        bottomYOffset={yearBottomYOffset}
        bottomXOffset={yearBottomXOffset}
        bottomAnchorAge={yearBottomAnchorAge}
        topValueByYear={topValueByYear}
        labelSides={yearLabelSides}
      />
      {showTitle !== false &&
        (titleVariant === "usa" && titleProps.legend.quadrants ? (
          <TitleBlockUSA
            x={titleProps.x}
            y={titleProps.y}
            style={titleProps.style}
            legend={{
              ages: titleProps.legend.ages,
              values: titleProps.legend.values,
              cohorts: titleProps.legend.cohorts,
              years: titleProps.legend.years,
              quadrants: titleProps.legend.quadrants,
              thin: titleProps.legend.thin,
              thick: titleProps.legend.thick,
            }}
            title={titleProps.title}
          />
        ) : (
          <TitleBlock {...titleProps} />
        ))}
    </g>
  );
}
