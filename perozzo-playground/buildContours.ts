/**
 * One-off utility to precompute value-based isolines ("green lines")
 * from porozzo-tidy.csv and write src/data/porozzo-contours.json.
 *
 * Run from project root:
 *   npm run build:contours
 */

import fs from "fs";
import path from "path";

import { computeVerticalIsoLines, GridField } from "./src/core/contours";
import { parseSwedenCsv } from "./src/core/sweden";

// paths relative to project root (where you'll run `npm run build:contours`)
const tidyCsvPath = path.resolve("./src/data/porozzo-tidy.csv");
const contoursOutPath = path.resolve("./src/data/porozzo-contours.json");

// --- 1. Read tidy CSV ---

const csvText = fs.readFileSync(tidyCsvPath, "utf8");

// Reuse your existing Sweden parser; assumes it returns rows with at least:
// { year: number; age: number; survivors: number; }
const rows = parseSwedenCsv(csvText);

// --- 2. Build grid axes (years, ages) ---

const years = Array.from(new Set(rows.map((r) => r.year))).sort(
  (a, b) => a - b
);
const ages = Array.from(new Set(rows.map((r) => r.age))).sort(
  (a, b) => a - b
);

const rowsCount = ages.length;
const colsCount = years.length;

// --- 3. Fill scalar field values[row * cols + col] with survivors ---

const values = new Array<number>(rowsCount * colsCount).fill(NaN);

for (const r of rows) {
  const rowIndex = ages.indexOf(r.age);
  const colIndex = years.indexOf(r.year);
  if (rowIndex === -1 || colIndex === -1) continue;

  const idx = rowIndex * colsCount + colIndex;
  values[idx] = r.survivors;
}

const field: GridField = {
  rows: rowsCount,
  cols: colsCount,
  values,
  ages,
  years,
};

// --- 4. Decide contour levels (every 10,000 up to max survivors) ---

let maxSurvivors = -Infinity;
for (const v of values) {
  if (Number.isFinite(v) && v > maxSurvivors) maxSurvivors = v;
}
if (!Number.isFinite(maxSurvivors) || maxSurvivors <= 0) {
  throw new Error("Invalid maxSurvivors; check your data.");
}

const levelStep = 10_000;
const levels: number[] = [];
const maxLevel = Math.floor(maxSurvivors / levelStep) * levelStep;

for (let L = levelStep; L <= maxLevel; L += levelStep) {
  levels.push(L);
}

// --- 5. Compute isolines in data space ---

const isoLines = computeVerticalIsoLines(field, levels);

// --- 6. Convert to JSON-friendly structure with real years ---

const jsonReady = isoLines.map((iso) => ({
  level: iso.level,
  points: iso.points.map((p) => ({
    year: p.year,
    age: p.age,
  })),
}));

// --- 7. Write to disk ---

fs.writeFileSync(contoursOutPath, JSON.stringify(jsonReady, null, 2), "utf8");

console.log(
  `Wrote ${jsonReady.length} contour levels to ${path.relative(
    process.cwd(),
    contoursOutPath
  )}`
);
