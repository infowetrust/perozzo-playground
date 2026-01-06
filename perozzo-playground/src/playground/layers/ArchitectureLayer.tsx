import BackWallIsolines from "./BackWallIsolines";
import FloorAgeLines from "./FloorAgeLines";
import RightWall from "./RightWall";
import type { Frame3D } from "../../core/frame3d";
import type { ProjectionOptions } from "../../core/geometry";
import type { Point3D } from "../../core/types";
import type { LineStyle, ShadingConfig } from "../vizConfig";

type FloorStyle = {
  fill: string;
  stroke: string;
};

type FloorAgeStyle = {
  stroke: string;
  strokeWidth: number;
};

type RightWallStyle = {
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

type ArchitectureLayerProps = {
  frame: Frame3D;
  projection: ProjectionOptions;
  minYearExt: number;
  maxYearExt: number;
  extendLeftYears: number;
  extendRightYears: number;
  floorFrameString: string;
  floorAlpha: number;
  shadingInkColor: string;
  backWallStyle: LineStyle;
  backwallFullLevels: number[];
  backwallRightLevels: number[];
  floorStyle: FloorStyle;
  floorAgeStyle: FloorAgeStyle;
  rightWallStyle: RightWallStyle;
  shadingConfig: ShadingConfig;
  surfacePoints: Point3D[];
  rows: number;
  cols: number;
  ages: number[];
  maxSurvivors: number;
  floorZ: number;
  valueStep: number;
  valueMinorStep: number;
};

export default function ArchitectureLayer({
  frame,
  projection,
  minYearExt,
  maxYearExt,
  extendLeftYears,
  extendRightYears,
  floorFrameString,
  floorAlpha,
  shadingInkColor,
  backWallStyle,
  backwallFullLevels,
  backwallRightLevels,
  floorStyle,
  floorAgeStyle,
  rightWallStyle,
  shadingConfig,
  surfacePoints,
  rows,
  cols,
  ages,
  maxSurvivors,
  floorZ,
  valueStep,
  valueMinorStep,
}: ArchitectureLayerProps) {
  return (
    <g id="layer-architecture">
      <BackWallIsolines
        frame={frame}
        projection={projection}
        minYearExt={minYearExt}
        maxYearExt={maxYearExt}
        fullLevels={backwallFullLevels}
        rightOnlyLevels={backwallRightLevels}
        style={backWallStyle}
      />
      <polygon
        points={floorFrameString}
        fill={floorStyle.fill}
        stroke={floorStyle.stroke}
      />
      {floorAlpha > 0 && (
        <polygon
          points={floorFrameString}
          fill={shadingInkColor}
          fillOpacity={floorAlpha}
          stroke="none"
        />
      )}
      <FloorAgeLines
        frame={frame}
        projection={projection}
        heavyAges={[0, 25, 50, 75, 100]}
        extendLeftYears={extendLeftYears}
        extendRightYears={extendRightYears}
        style={floorAgeStyle}
      />
      <RightWall
        surfacePoints={surfacePoints}
        rows={rows}
        cols={cols}
        projection={projection}
        floorZ={floorZ}
        ages={ages}
        maxSurvivors={maxSurvivors}
        valueStep={valueStep}
        valueMinorStep={valueMinorStep}
        frame={frame}
        shading={shadingConfig}
        style={rightWallStyle}
      />
    </g>
  );
}
