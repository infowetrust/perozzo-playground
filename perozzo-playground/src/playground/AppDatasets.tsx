import { useState, ChangeEvent } from "react";

import PlateViz from "./PlateViz";
import swedenCsv from "../data/porozzo-tidy.csv?raw";
import swedenContours from "../data/porozzo-contours.json";
import usaCsv from "../data/usa-pop-1900-2025-5yr-native-topbins.csv?raw";
import usaContours from "../data/usa-contours.json";

const DATASETS = {
  sweden: {
    label: "Sweden (1750–1875)",
    csvText: swedenCsv,
    contours: swedenContours,
    preset: "levasseur" as const,
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
    showTitle: true,
  },
  usa: {
    label: "USA (1900–2025)",
    csvText: usaCsv,
    contours: usaContours,
    preset: "levasseur" as const,
    canvas: { width: 900, height: 650 },
    frameMax: { age: 110, value: 25_000_000 },
    title: { bigWord: "UNITED STATES", years: "1900–2025" },
    valueLevels: {
      left: [5_000_000, 10_000_000, 15_000_000],
      right: [5_000_000, 10_000_000, 15_000_000, 20_000_000, 25_000_000],
      backwallFull: [0, 5_000_000, 10_000_000, 15_000_000],
      backwallRightOnly: [20_000_000, 25_000_000],
    },
    valuesHeavyStep: 5_000_000,
    rightWallValueStep: 5_000_000,
    rightWallMinorStep: 1_000_000,
    showTitle: false,
  },
} as const;

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
        showTitle={active.showTitle}
        activeKey={datasetKey}
      />
    </div>
  );
}

export { DATASETS };
