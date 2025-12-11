import type { Point3D } from "./types";

export type SwedenRow = {
  year: number;
  age: number;
  survivors: number;
  ageIndex: number;   // NEW
};

export type SwedenSurfaceGrid = {
  points: Point3D[];     // grid for ages >= 5
  rows: number;          // number of age rows (5,10,...,100)
  cols: number;          // number of year columns
  ages: number[];        // age bands used in the surface (no 0)
  years: number[];
  births: Point3D[];     // separate ridge for age 0
};

/**
 * Very small CSV parser for the tidy Sweden table.
 * Assumes header: Year,Age,Survivors
 */
export function parseSwedenCsv(csvText: string): SwedenRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  const rows: SwedenRow[] = [];

  // skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [yearStr, ageStr, survivorsStr] = line.split(",");

    const year = Number(yearStr);
    const age = Number(ageStr);
    const survivors = Number(survivorsStr);

    if (
      !Number.isFinite(year) ||
      !Number.isFinite(age) ||
      !Number.isFinite(survivors)
    ) {
      continue;
    }

    // ageIndex: 0 & 5 share 0, then every 5-year step increments
    const ageIndex =
      age === 0 || age === 5 ? 0 : age / 5 - 1;

    rows.push({ year, age, survivors, ageIndex });
  }

  return rows;
}

/**
 * Map the Sweden survivor table into a regular grid of Point3D.
 *
 * x = year index, y = age index (starting at age = 5), z = scaled survivor count.
 * Age 0 is handled separately as a "births" ridge that sits directly above age 5.
 */
export function makeSwedenSurface(
  data: SwedenRow[],
  opts?: { zScale?: number; maxHeight?: number }
): SwedenSurfaceGrid {
  const survivorsValues = data.map((d) => d.survivors);
  const maxSurvivors = Math.max(...survivorsValues);

  let zScale: number;
  if (opts?.zScale != null) {
    zScale = opts.zScale;
  } else {
    const maxHeight = opts?.maxHeight ?? 3; // in "z units"
    zScale = maxHeight / maxSurvivors;
  }

  // unique sorted axes
  const years = Array.from(new Set(data.map((d) => d.year))).sort(
    (a, b) => a - b
  );
  const allAges = Array.from(new Set(data.map((d) => d.age))).sort(
    (a, b) => a - b
  );

  const ages = allAges.filter((a) => a !== 0); // drop age 0 from surface grid
  const cols = years.length;
  const rowsCount = ages.length;

  // lookup survivors by (year, age)
  const key = (year: number, age: number) => `${year}-${age}`;
  const map = new Map<string, number>();
  for (const d of data) {
    map.set(key(d.year, d.age), d.survivors);
  }

  const points: Point3D[] = [];

  // row-major order: y = age index, x = year index (ages >= 5)
  for (let rowIndex = 0; rowIndex < rowsCount; rowIndex++) {
    const age = ages[rowIndex];

    for (let colIndex = 0; colIndex < cols; colIndex++) {
      const year = years[colIndex];
      const survivors = map.get(key(year, age)) ?? 0;

      const x = colIndex;
      const y = rowIndex;      // age 5 → y=0
      const z = survivors * zScale;

      points.push({ x, y, z });
    }
  }

  // births ridge: age 0, but placed at the same y index as age 5 (y = 0)
  const births: Point3D[] = [];
  const birthAge = 0;
  const yIndexForBirths = 0; // directly above the first age band (5)

  for (let colIndex = 0; colIndex < cols; colIndex++) {
    const year = years[colIndex];
    const survivorsBirth = map.get(key(year, birthAge)) ?? 0;

    const x = colIndex;
    const y = yIndexForBirths;
    const z = survivorsBirth * zScale;

    births.push({ x, y, z });
  }

  return {
    points,
    rows: rowsCount,
    cols,
    ages,
    years,
    births,
  };
}