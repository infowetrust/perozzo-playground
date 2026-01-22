import { useState } from "react";
import type { ChangeEvent } from "react";

import PlateViz from "./PlateViz";
import swedenCsv from "../data/porozzo-tidy.csv?raw";
import swedenContours from "../data/porozzo-contours.json";
import usaCsv from "../data/usa-pop-1900-2025-5yr-native-to100.csv?raw";
import usaContours from "../data/usa-contours.json";
import usaIsotonicCsv from "../data/usa-isotonic-quarters.csv?raw";

type DatasetConfig = {
  label: string;
  csvText: string;
  contours: unknown;
  preset: "perozzoBasic" | "isometric30" | "steep45" | "levasseur";
  canvas: { width: number; height: number };
  frameMax: { age: number; value: number };
  title: { bigWord: string; years: string };
  valueLevels: {
    left: number[];
    right: number[];
    backwallFull: number[];
    backwallRightOnly: number[];
  };
  valuesHeavyStep: number;
  rightWallValueStep: number;
  rightWallMinorStep: number;
  maxHeight: number;
  projectionTweaks?: { ageScaleMultiplier?: number; ageAxisAngleDeg?: number };
  showTitle: boolean;
  isotonicCsvText?: string;
};

const DATASETS: Record<string, DatasetConfig> = {
  sweden: {
    label: "Sweden (1750–1875)",
    csvText: swedenCsv,
    contours: swedenContours,
    preset: "levasseur",
    canvas: { width: 700, height: 700 },
    frameMax: { age: 110, value: 325_000 },
    title: { bigWord: "SWEDEN", years: "1750–1875" },
    valueLevels: {
      left: [50_000, 100_000, 150_000],
      right: [50_000, 100_000, 150_000, 200_000, 250_000],
      backwallFull: [0, 50_000, 100_000, 150_000],
      backwallRightOnly: [200_000, 250_000],
    },
    valuesHeavyStep: 50_000,
    rightWallValueStep: 50_000,
    rightWallMinorStep: 10_000,
    maxHeight: 3.0,
    showTitle: true,
    isotonicCsvText: undefined,
  },
  usa: {
    label: "USA (1900–2025)",
    csvText: usaCsv,
    contours: usaContours,
    preset: "levasseur",
    canvas: { width: 900, height: 650 },
    frameMax: { age: 110, value: 25_000_000 },
    title: { bigWord: "UNITED STATES", years: "1900–2025" },
    valueLevels: {
      left: [5_000_000, 10_000_000, 15_000_000],
      right: [5_000_000, 10_000_000, 15_000_000],
      backwallFull: [0, 5_000_000, 10_000_000, 15_000_000],
      backwallRightOnly: [],
    },
    valuesHeavyStep: 5_000_000,
    rightWallValueStep: 5_000_000,
    rightWallMinorStep: 1_000_000,
    maxHeight: 2.6,
    projectionTweaks: { ageScaleMultiplier: 1.1, ageAxisAngleDeg: 140 },
    showTitle: true,
    isotonicCsvText: usaIsotonicCsv,
  },
};

type DatasetKey = keyof typeof DATASETS;

export default function AppDatasets() {
  const [datasetKey, setDatasetKey] = useState<DatasetKey>("usa");
  const active = DATASETS[datasetKey];

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextKey = event.target.value as DatasetKey;
    setDatasetKey(nextKey);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: "0.25rem",
          marginBottom: "0.75rem",
          fontSize: "0.85rem",
        }}
      >
        Dataset
        <select
          value={datasetKey}
          onChange={handleChange}
          style={{ padding: "0.25rem 0.5rem", fontSize: "0.95rem" }}
        >
          {Object.entries(DATASETS).map(([key, dataset]) => (
            <option key={key} value={key}>
              {dataset.label}
            </option>
          ))}
        </select>
      </label>
      <PlateViz
        csvText={active.csvText}
        contours={active.contours}
        preset={active.preset}
        showUI
        canvas={active.canvas}
        frameMax={active.frameMax}
        title={active.title}
        valueLevels={active.valueLevels}
        valuesHeavyStep={active.valuesHeavyStep}
        rightWallValueStep={active.rightWallValueStep}
        rightWallMinorStep={active.rightWallMinorStep}
        maxHeight={active.maxHeight}
        projectionTweaks={active.projectionTweaks}
        showTitle={active.showTitle}
        isotonicCsvText={active.isotonicCsvText}
        activeKey={datasetKey}
      />
    </div>
  );
}

export { DATASETS };
