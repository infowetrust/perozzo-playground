/**
 * Precompute contour isolines for USA population survivors and write
 * ./src/data/usa-contours.json.
 *
 * Run from project root:
 *   ts-node buildContoursUSA.ts
 * or via package script (npm run build:contours:usa).
 */

/* ---------- IMPORTS + PATHS ---------- */

import fs from "fs";
import path from "path";
import { contours as d3Contours } from "d3-contour";

import { GridField } from "./src/core/contours";

const csvPath = path.resolve(
  "./src/data/usa-pop-1900-2025-5yr-native-topbins.csv"
);
const contoursOutPath = path.resolve("./src/data/usa-contours.json");

/* ---------- TYPES ---------- */

type UsaCsvRow = {
  year: number;
  age: number;
  survivors: number;
};

type YearAgePoint = { year: number; age: number };

/* ---------- HELPER FUNCTIONS ---------- */

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

function dedupPoints(
  pts: YearAgePoint[],
  epsYear = 1e-9,
  epsAge = 1e-9
): YearAgePoint[] {
  const out: YearAgePoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.year - p.year) < epsYear &&
      Math.abs(last.age - p.age) < epsAge
    ) {
      continue;
    }
    out.push(p);
  }
  return out;
}

function nearest(target: number, xs: number[]): number | null {
  if (xs.length === 0 || !Number.isFinite(target)) return null;
  let best = xs[0];
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    if (Math.abs(x - target) < Math.abs(best - target)) {
      best = x;
    }
  }
  return Number.isFinite(best) ? best : null;
}

function rowBelowForAge(age: number, agesArr: number[]): number {
  if (age <= agesArr[0]) return 0;
  if (age >= agesArr[agesArr.length - 1]) return agesArr.length - 2;
  for (let r = 0; r < agesArr.length - 1; r++) {
    if (age >= agesArr[r] && age <= agesArr[r + 1]) return r;
  }
  return agesArr.length - 2;
}

function valueAtColAge(
  col: number,
  age: number,
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): number | null {
  if (col < 0 || col >= colsTotal) return null;
  if (age < agesArr[0] || age > agesArr[agesArr.length - 1]) return null;
  let row = -1;
  for (let i = 0; i < agesArr.length - 1; i++) {
    if (age >= agesArr[i] && age <= agesArr[i + 1]) {
      row = i;
      break;
    }
  }
  if (row < 0) return null;
  const age0 = agesArr[row];
  const age1 = agesArr[row + 1];
  const v0 = valuesArr[row * colsTotal + col];
  const v1 = valuesArr[(row + 1) * colsTotal + col];
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;
  if (age1 === age0) return v0;
  const t = (age - age0) / (age1 - age0);
  return v0 + t * (v1 - v0);
}

function crossingAgesForCol(
  level: number,
  col: number,
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): number[] {
  const out: number[] = [];
  for (let r = 0; r < agesArr.length - 1; r++) {
    const v0 = valuesArr[r * colsTotal + col];
    const v1 = valuesArr[(r + 1) * colsTotal + col];
    if (!Number.isFinite(v0) || !Number.isFinite(v1) || v0 === v1) continue;
    const lo = Math.min(v0, v1);
    const hi = Math.max(v0, v1);
    if (level < lo || level > hi) continue;
    const t = (level - v0) / (v1 - v0);
    const age = agesArr[r] + t * (agesArr[r + 1] - agesArr[r]);
    if (Number.isFinite(age)) {
      out.push(age);
    }
  }
  return out;
}

function fractionalYearAtAge(
  level: number,
  age: number,
  col0: number,
  col1: number,
  yearsArr: number[],
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): number | null {
  const v0 = valueAtColAge(col0, age, agesArr, valuesArr, colsTotal);
  const v1 = valueAtColAge(col1, age, agesArr, valuesArr, colsTotal);
  if (v0 == null || v1 == null || v0 === v1) return null;
  const lo = Math.min(v0, v1);
  const hi = Math.max(v0, v1);
  if (level < lo || level > hi) return null;
  const t = (level - v0) / (v1 - v0);
  return yearsArr[col0] + t * (yearsArr[col1] - yearsArr[col0]);
}

function fractionalAgeAtYear(
  level: number,
  col: number,
  row0: number,
  row1: number,
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): number | null {
  const v0 = valuesArr[row0 * colsTotal + col];
  const v1 = valuesArr[row1 * colsTotal + col];
  if (!Number.isFinite(v0) || !Number.isFinite(v1) || v0 === v1) return null;
  const lo = Math.min(v0, v1);
  const hi = Math.max(v0, v1);
  if (level < lo || level > hi) return null;
  const t = (level - v0) / (v1 - v0);
  return agesArr[row0] + t * (agesArr[row1] - agesArr[row0]);
}

function adjustEndpointToBoundary(
  point: YearAgePoint,
  level: number,
  yearsArr: number[],
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): YearAgePoint {
  const yearMin = yearsArr[0];
  const yearMax = yearsArr[yearsArr.length - 1];
  const ageMin = agesArr[0];
  const ageMax = agesArr[agesArr.length - 1];
  const yearStep = yearsArr[1] - yearsArr[0];
  const ageStep = agesArr[1] - agesArr[0];
  const eps = 1e-6;

  const dTop = Math.abs(point.age - ageMin);
  const dBottom = Math.abs(ageMax - point.age);
  const dLeft = Math.abs(point.year - yearMin);
  const dRight = Math.abs(yearMax - point.year);

  const candidates: { side: "top" | "bottom" | "left" | "right"; d: number }[] =
    [];
  if (dTop <= ageStep + eps) candidates.push({ side: "top", d: dTop });
  if (dBottom <= ageStep + eps)
    candidates.push({ side: "bottom", d: dBottom });
  if (dLeft <= yearStep + eps) candidates.push({ side: "left", d: dLeft });
  if (dRight <= yearStep + eps) candidates.push({ side: "right", d: dRight });
  if (candidates.length === 0) return point;

  candidates.sort((a, b) => a.d - b.d);
  const side = candidates[0].side;

  if (side === "top" || side === "bottom") {
    const ageFixed = side === "top" ? ageMin : ageMax;
    const colIdx = yearsArr.indexOf(point.year);
    if (colIdx < 0) return point;
    const colBefore = Math.max(0, colIdx - 1);
    const colAfter = Math.min(yearsArr.length - 1, colIdx + 1);

    let yFrac: number | null = null;
    if (colBefore !== colIdx) {
      yFrac = fractionalYearAtAge(
        level,
        ageFixed,
        colBefore,
        colIdx,
        yearsArr,
        agesArr,
        valuesArr,
        colsTotal
      );
    }
    if (yFrac == null && colAfter !== colIdx) {
      yFrac = fractionalYearAtAge(
        level,
        ageFixed,
        colIdx,
        colAfter,
        yearsArr,
        agesArr,
        valuesArr,
        colsTotal
      );
    }
    return yFrac != null ? { year: yFrac, age: ageFixed } : point;
  }

  if (side === "left" || side === "right") {
    const col = side === "left" ? 0 : yearsArr.length - 1;
    const row = rowBelowForAge(point.age, agesArr);
    const ageFrac = fractionalAgeAtYear(
      level,
      col,
      row,
      row + 1,
      agesArr,
      valuesArr,
      colsTotal
    );
    return ageFrac != null ? { year: yearsArr[col], age: ageFrac } : point;
  }

  return point;
}

function rotateToMinYear(pts: YearAgePoint[]): YearAgePoint[] {
  if (pts.length === 0) return pts;
  let minIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].year < pts[minIdx].year) {
      minIdx = i;
    }
  }
  return pts.slice(minIdx).concat(pts.slice(0, minIdx));
}

function extendByColumnCrossings(
  pts: YearAgePoint[],
  level: number,
  yearsArr: number[],
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): YearAgePoint[] {
  if (pts.length < 2) return pts;
  const yearIndex = new Map<number, number>();
  yearsArr.forEach((y, i) => yearIndex.set(y, i));
  const eps = 1e-6;

  while (true) {
    const first = pts[0];
    const col = yearIndex.get(first.year);
    if (col == null || col <= 0) break;
    const prevCol = col - 1;
    const prevYear = yearsArr[prevCol];
    if (Math.abs(prevYear - first.year) < eps) break;
    const crosses = crossingAgesForCol(
      level,
      prevCol,
      agesArr,
      valuesArr,
      colsTotal
    );
    if (crosses.length === 0) break;
    const age = nearest(first.age, crosses);
    if (age == null) break;
    pts.unshift({ year: prevYear, age });
  }

  while (true) {
    const last = pts[pts.length - 1];
    const col = yearIndex.get(last.year);
    if (col == null || col >= yearsArr.length - 1) break;
    const nextCol = col + 1;
    const nextYear = yearsArr[nextCol];
    if (Math.abs(nextYear - last.year) < eps) break;
    const crosses = crossingAgesForCol(
      level,
      nextCol,
      agesArr,
      valuesArr,
      colsTotal
    );
    if (crosses.length === 0) break;
    const age = nearest(last.age, crosses);
    if (age == null) break;
    pts.push({ year: nextYear, age });
  }

  return pts;
}

function splitByYearDirection(pts: YearAgePoint[]): YearAgePoint[][] {
  if (pts.length === 0) return [];
  const runs: YearAgePoint[][] = [];
  let current: YearAgePoint[] = [pts[0]];
  let prevSign = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const diff = curr.year - prev.year;
    const sign = Math.sign(diff);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      runs.push(current);
      current = [prev, curr];
      prevSign = sign;
      continue;
    }
    if (sign !== 0) prevSign = sign;
    current.push(curr);
  }
  if (current.length >= 1) {
    runs.push(current);
  }
  return runs;
}

function pickBestRun(runs: YearAgePoint[][]): YearAgePoint[] | null {
  if (runs.length === 0) return null;
  let best = runs[0];
  let bestSpan =
    best.length >= 2 ? Math.abs(best[best.length - 1].year - best[0].year) : 0;
  for (let i = 1; i < runs.length; i++) {
    const run = runs[i];
    const span =
      run.length >= 2 ? Math.abs(run[run.length - 1].year - run[0].year) : 0;
    if (span > bestSpan) {
      best = run;
      bestSpan = span;
    } else if (span === bestSpan && run.length > best.length) {
      best = run;
    }
  }
  return best;
}

/* ---------- READ + PARSE TIDY CSV ---------- */

function parseUsaCsv(csvText: string): UsaCsvRow[] {
  const trimmed = csvText.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  const headerCells = lines[0].split(",").map((cell) => cell.trim().toLowerCase());

  const yearIdx = headerCells.findIndex((h) => h === "year");
  const ageIdx = headerCells.findIndex((h) => h === "age");
  const survivorsIdx = headerCells.findIndex((h) => h === "survivors");

  if (yearIdx === -1 || ageIdx === -1 || survivorsIdx === -1) {
    throw new Error("USA CSV missing required headers (year, age, survivors)");
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

const csvText = fs.readFileSync(csvPath, "utf8");
const rows = parseUsaCsv(csvText);

/* ---------- BUILD GRID (YEARS/AGES/VALUES) ---------- */

const years = Array.from(new Set(rows.map((r) => r.year))).sort(
  (a, b) => a - b
);
const ages = Array.from(new Set(rows.map((r) => r.age))).sort(
  (a, b) => a - b
);

const rowsCount = ages.length;
const colsCount = years.length;

const values = new Array<number>(rowsCount * colsCount).fill(NaN);
for (const r of rows) {
  const rowIndex = ages.indexOf(r.age);
  const colIndex = years.indexOf(r.year);
  if (rowIndex === -1 || colIndex === -1) continue;
  values[rowIndex * colsCount + colIndex] = r.survivors;
}

const field: GridField = {
  rows: rowsCount,
  cols: colsCount,
  values,
  ages,
  years,
};

/* ---------- CHOOSE CONTOUR LEVELS ---------- */

let maxSurvivors = -Infinity;
for (const v of values) {
  if (Number.isFinite(v) && v > maxSurvivors) maxSurvivors = v;
}
if (!Number.isFinite(maxSurvivors) || maxSurvivors <= 0) {
  throw new Error("Invalid maxSurvivors; check input data.");
}

const levelStep = 1_000_000;
const levels: number[] = [];
const maxLevel = Math.floor(maxSurvivors / levelStep) * levelStep;
for (let level = levelStep; level <= maxLevel; level += levelStep) {
  levels.push(level);
}

/* ---------- COMPUTE RAW ISOLINES ---------- */

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

const jsonReady: { level: number; points: YearAgePoint[] }[] = [];

/* ---------- NORMALIZE EACH RING INTO CLEAN POLYLINE ---------- */

for (const contour of contourSets) {
  const levelValue = Number(contour.value);

  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      if (!ring || ring.length < 2) continue;

      const ringPoints = ring.map((point) => {
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

      const snapped = resampleToYearTicks(ringPoints, years);
      let corrected: YearAgePoint[] = [];
      for (const pt of snapped) {
        const col = years.indexOf(pt.year);
        if (col < 0) continue;
        const crossings = crossingAgesForCol(
          levelValue,
          col,
          ages,
          values,
          colsCount
        );
        if (crossings.length === 0) continue;
        const snappedAge = nearest(pt.age, crossings);
        if (snappedAge == null) continue;
        corrected.push({ year: pt.year, age: snappedAge });
      }

      corrected = dedupPoints(corrected);
      if (corrected.length >= 2) {
        const first = corrected[0];
        const last = corrected[corrected.length - 1];
        if (
          Math.abs(first.year - last.year) < 1e-9 &&
          Math.abs(first.age - last.age) < 1e-9
        ) {
          corrected.pop();
        }
      }
      corrected = rotateToMinYear(corrected);
      corrected = extendByColumnCrossings(
        corrected,
        levelValue,
        years,
        ages,
        values,
        colsCount
      );

      if (corrected.length >= 2) {
        const eps = 1e-6;
        const yearMin = years[0];
        const minYearInLine = Math.min(...corrected.map((p) => p.year));
        const wantsLeft = minYearInLine <= yearMin + yearStep + eps;
        if (wantsLeft) {
          const leftCross = crossingAgesForCol(
            levelValue,
            0,
            ages,
            values,
            colsCount
          );
          if (leftCross.length > 0) {
            const firstIdx = corrected.reduce(
              (bestIdx, p, idx) =>
                p.year < corrected[bestIdx].year ? idx : bestIdx,
              0
            );
            const targetAge = corrected[firstIdx].age;
            const chosenAge = nearest(targetAge, leftCross);
            if (chosenAge != null) {
              const alreadyHas = corrected.some(
                (p) =>
                  p.year === yearMin && Math.abs(p.age - chosenAge) < 1e-6
              );
              if (!alreadyHas) {
                corrected.unshift({ year: yearMin, age: chosenAge });
              }
            }
          }
        }
      }

      if (corrected.length >= 2) {
        corrected[0] = adjustEndpointToBoundary(
          corrected[0],
          levelValue,
          years,
          ages,
          values,
          colsCount
        );
        corrected[corrected.length - 1] = adjustEndpointToBoundary(
          corrected[corrected.length - 1],
          levelValue,
          years,
          ages,
          values,
          colsCount
        );

        corrected = corrected.filter(
          (p) => Number.isFinite(p.year) && Number.isFinite(p.age)
        );
        corrected = dedupPoints(corrected);

        const runs = splitByYearDirection(corrected);
        const best = pickBestRun(runs);
        if (!best || best.length < 2) continue;
        corrected = best;

        let flips = 0;
        let prevSign = 0;
        for (let i = 1; i < corrected.length; i++) {
          const dy = corrected[i].year - corrected[i - 1].year;
          const s = Math.sign(dy);
          if (s !== 0 && prevSign !== 0 && s !== prevSign) flips++;
          if (s !== 0) prevSign = s;
        }
        if (flips > 0) {
          throw new Error(
            `Contour still flips year direction at level=${levelValue} flips=${flips}`
          );
        }

        jsonReady.push({ level: levelValue, points: corrected });
      }
    }
  }
}

/* ---------- VALIDATION + WRITE JSON ---------- */

for (const iso of jsonReady) {
  for (const p of iso.points) {
    if (!Number.isFinite(p.year) || !Number.isFinite(p.age)) {
      throw new Error(
        `Invalid contour point at level=${iso.level}: ${JSON.stringify(p)}`
      );
    }
  }
}

const serialized = JSON.stringify(jsonReady, null, 2);
if (serialized.includes('"age": null')) {
  throw new Error("Found age:null in output; NaN leaked into JSON.");
}

fs.writeFileSync(contoursOutPath, serialized, "utf8");

console.log(
  `Wrote ${jsonReady.length} contour levels to ${path.relative(
    process.cwd(),
    contoursOutPath
  )} (maxSurvivors=${maxSurvivors}, step=${levelStep})`
);
