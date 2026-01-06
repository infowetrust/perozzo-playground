/**
 * Utility to precompute contour lines for the USA population data and
 * write ./src/data/usa-contours.json.
 *
 * Run from project root:
 *   ts-node buildContoursUSA.ts
 * or add a matching npm script similar to build:contours.
 */

import fs from "fs";
import path from "path";

import { contours as d3Contours } from "d3-contour";

import { GridField } from "./src/core/contours";

type UsaCsvRow = {
  year: number;
  age: number;
  survivors: number;
};

type YearAgePoint = { year: number; age: number };

function resampleToYearTicks(
  points: YearAgePoint[],
  years: number[]
): YearAgePoint[] {
  if (points.length < 2) return [];
  const out: YearAgePoint[] = [];
  const yearSet = new Set(years);
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  const push = (p: YearAgePoint) => {
    const last = out[out.length - 1];
    if (last && last.year === p.year && Math.abs(last.age - p.age) < 1e-9)
      return;
    out.push(p);
  };

  const closed =
    Math.abs(points[0].year - points[points.length - 1].year) < 1e-9 &&
    Math.abs(points[0].age - points[points.length - 1].age) < 1e-9;

  const n = closed ? points.length - 1 : points.length;

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];

    const x0 = a.year;
    const y0 = a.age;
    const x1 = b.year;
    const y1 = b.age;

    if (Math.abs(x1 - x0) < 1e-9) {
      const yr = Math.max(minYear, Math.min(maxYear, x0));
      if (yearSet.has(yr)) {
        push({ year: yr, age: y0 });
        push({ year: yr, age: y1 });
      }
      continue;
    }

    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    const ticks = years.filter((yr) => yr >= lo - 1e-9 && yr <= hi + 1e-9);
    if (ticks.length === 0) continue;

    const ordered = x1 >= x0 ? ticks : ticks.slice().reverse();

    for (const yrRaw of ordered) {
      const yr = Math.max(minYear, Math.min(maxYear, yrRaw));
      const t = (yr - x0) / (x1 - x0);
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      const age = y0 + t * (y1 - y0);
      push({ year: yr, age });
    }
  }

  return out.length >= 2 ? out : [];
}

const csvPath = path.resolve(
  "./src/data/usa-pop-1900-2025-5yr-native-topbins.csv"
);
const contoursOutPath = path.resolve("./src/data/usa-contours.json");

function parseUsaCsv(csvText: string): UsaCsvRow[] {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split(/\r?\n/);
  const headerCells = lines[0].split(",").map((cell) => cell.trim().toLowerCase());

  const yearIdx = headerCells.findIndex((h) => h === "year");
  const ageIdx = headerCells.findIndex((h) => h === "age");
  const survivorsIdx = headerCells.findIndex((h) => h === "survivors");

  if (yearIdx === -1 || ageIdx === -1 || survivorsIdx === -1) {
    throw new Error(
      "USA CSV is missing required headers (year, age, survivors)."
    );
  }

  const rows: UsaCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = line.split(",");

    const year = Number(cells[yearIdx]?.trim());
    const age = Number(cells[ageIdx]?.trim());
    const survivors = Number(cells[survivorsIdx]?.trim());

    if (
      !Number.isFinite(year) ||
      !Number.isFinite(age) ||
      !Number.isFinite(survivors)
    ) {
      continue;
    }

    rows.push({ year, age, survivors });
  }

  return rows;
}

// --- 1. Read CSV ---

const csvText = fs.readFileSync(csvPath, "utf8");
const rows = parseUsaCsv(csvText);

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

// --- 4. Decide contour levels ---

let maxSurvivors = -Infinity;
for (const v of values) {
  if (Number.isFinite(v) && v > maxSurvivors) {
    maxSurvivors = v;
  }
}

if (!Number.isFinite(maxSurvivors) || maxSurvivors <= 0) {
  throw new Error("Invalid maxSurvivors; check USA data.");
}

const levelStep = 1_000_000;
const levels: number[] = [];
const maxLevel = Math.floor(maxSurvivors / levelStep) * levelStep;

for (let level = levelStep; level <= maxLevel; level += levelStep) {
  levels.push(level);
}

// --- 5. Compute isolines via d3-contour ---

const generator = d3Contours()
  .size([field.cols, field.rows])
  .thresholds(levels);
const contourSets = generator(field.values);

const yearBase = years[0] ?? 0;
const ageBase = ages[0] ?? 0;
const maxYear = years[years.length - 1] ?? yearBase;
const maxAge = ages[ages.length - 1] ?? ageBase;
const yearStep = years.length > 1 ? years[1] - years[0] : 1;
const ageStep = ages.length > 1 ? ages[1] - ages[0] : 1;

const jsonReady: { level: number; points: { year: number; age: number }[] }[] =
  [];

for (const contour of contourSets) {
  const levelValue = Number(contour.value);
  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      if (!ring || ring.length < 2) continue;
      const points = ring.map((point) => {
        const [x, y] = point;
        const xClamped = Math.max(0, Math.min(colsCount - 1, x));
        const yClamped = Math.max(0, Math.min(rowsCount - 1, y));
        const yearRaw = yearBase + xClamped * yearStep;
        const ageRaw = ageBase + yClamped * ageStep;
        return {
          year: Math.max(yearBase, Math.min(maxYear, yearRaw)),
          age: Math.max(ageBase, Math.min(maxAge, ageRaw)),
        };
      });
      const snapped = resampleToYearTicks(points, years);
      if (snapped.length >= 2) {
        jsonReady.push({ level: levelValue, points: snapped });
      }
    }
  }
}

// --- 7. Write to disk ---

fs.writeFileSync(contoursOutPath, JSON.stringify(jsonReady, null, 2), "utf8");

console.log(
  `Wrote ${jsonReady.length} contour levels to ${path.relative(
    process.cwd(),
    contoursOutPath
  )} (maxSurvivors=${maxSurvivors}, step=1_000_000)`
);
