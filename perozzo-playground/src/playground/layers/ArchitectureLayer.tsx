import Age0WallIsolines from "./Age0WallIsolines";
import FloorAgeLines from "./FloorAgeLines";
import YearWall from "./YearWall";
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

type YearWallStyle = {
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
  age0WallIsolineStyle: LineStyle;
  age0WallFullLevels: number[];
  age0Wall2025OnlyLevels: number[];
  floorStyle: FloorStyle;
  floorAgeStyle: FloorAgeStyle;
  wall2025Style: YearWallStyle;
  shadingConfig: ShadingConfig;
  surfacePoints: Point3D[];
  rows: number;
  cols: number;
  ages: number[];
  maxSurvivors: number;
  floorZ: number;
  valueStep: number;
  valueMinorStep: number;
  showWall2025?: boolean;
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
  age0WallIsolineStyle,
  age0WallFullLevels,
  age0Wall2025OnlyLevels,
  floorStyle,
  floorAgeStyle,
  wall2025Style,
  shadingConfig,
  surfacePoints,
  rows,
  cols,
  ages,
  maxSurvivors,
  floorZ,
  valueStep,
  valueMinorStep,
  showWall2025 = true,
}: ArchitectureLayerProps) {
  const isUsaDataset = frame.maxYear >= 2025;
  const age0WallMinYearExt = isUsaDataset ? frame.maxYear : minYearExt;
  const floorExtendLeftYears = isUsaDataset ? 0 : extendLeftYears;
  return (
    <g id="layer-architecture">
      <Age0WallIsolines
        frame={frame}
        projection={projection}
        minYearExt={age0WallMinYearExt}
        maxYearExt={maxYearExt}
        fullLevels={age0WallFullLevels}
        rightOnlyLevels={age0Wall2025OnlyLevels}
        style={age0WallIsolineStyle}
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
        extendLeftYears={floorExtendLeftYears}
        extendRightYears={extendRightYears}
        style={floorAgeStyle}
      />
      {showWall2025 && (
        <YearWall
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
          style={wall2025Style}
        />
      )}
    </g>
  );
}
