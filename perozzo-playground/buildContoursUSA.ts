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


const csvPath = path.resolve(
  "./src/data/usa-pop-1900-2025-5yr-native-to100.csv"
);
const contoursOutPath = path.resolve("./src/data/usa-contours.json");

// Run stitching tolerance, expressed in grid cells (not years)
const JOIN_TOL_CELLS_X = 0.5; // year-axis tolerance in units of one year step
const JOIN_TOL_CELLS_Y = 0.5; // age-axis tolerance in units of one age step
const AGE0_ASSIGN_TOL_CELLS = 0.75; // max year tolerance for age=0 endpoint snapping
const DEBUG_JOIN = false;
const DEBUG_AGE0 = true;

/* ---------- TYPES ---------- */

type UsaCsvRow = {
  year: number;
  age: number;
  survivors: number;
};

type YearAgePoint = { year: number; age: number };

type GridField = {
  rows: number;
  cols: number;
  values: number[];
  ages: number[];
  years: number[];
};

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

function dedupeRuns(runs: YearAgePoint[][]): YearAgePoint[][] {
  const seen = new Set<string>();
  const out: YearAgePoint[][] = [];
  for (const run of runs) {
    const signature = run
      .map((p) => {
        const year = Math.round(p.year * 1e3) / 1e3;
        const age = Math.round(p.age * 1e3) / 1e3;
        return `${year},${age}`;
      })
      .join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(run);
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

function nearestBoundaryYearCrossingAtAge(
  level: number,
  ageFixed: number,
  approxYear: number,
  yearsArr: number[],
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): number | null {
  const yearMin = yearsArr[0];
  const yearMax = yearsArr[yearsArr.length - 1];
  const target = Math.max(yearMin, Math.min(yearMax, approxYear));
  let best: number | null = null;
  let bestDist = Infinity;
  for (let col = 0; col < yearsArr.length - 1; col++) {
    const yFrac = fractionalYearAtAge(
      level,
      ageFixed,
      col,
      col + 1,
      yearsArr,
      agesArr,
      valuesArr,
      colsTotal
    );
    if (!Number.isFinite(yFrac ?? NaN)) continue;
    const y = yFrac as number;
    const d = Math.abs(y - target);
    if (d < bestDist) {
      bestDist = d;
      best = y;
    }
  }
  return best;
}

function boundaryYearCrossingsAtAge(
  level: number,
  ageFixed: number,
  yearsArr: number[],
  agesArr: number[],
  valuesArr: number[],
  colsTotal: number
): number[] {
  const out: number[] = [];
  for (let col = 0; col < yearsArr.length - 1; col++) {
    const yFrac = fractionalYearAtAge(
      level,
      ageFixed,
      col,
      col + 1,
      yearsArr,
      agesArr,
      valuesArr,
      colsTotal
    );
    if (!Number.isFinite(yFrac ?? NaN)) continue;
    out.push(yFrac as number);
  }
  out.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const y of out) {
    const last = deduped[deduped.length - 1];
    if (last != null && Math.abs(last - y) < 1e-6) continue;
    deduped.push(y);
  }
  return deduped;
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
    const clampedYear = Math.max(yearMin, Math.min(yearMax, point.year));
    const yNearest = nearestBoundaryYearCrossingAtAge(
      level,
      ageFixed,
      clampedYear,
      yearsArr,
      agesArr,
      valuesArr,
      colsTotal
    );
    if (!Number.isFinite(yNearest ?? NaN)) return point;
    const yearClamped = Math.max(yearMin, Math.min(yearMax, yNearest as number));
    return { year: yearClamped, age: ageFixed };
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
const USE_COLUMN_CONTOURS = true;
const USE_OPTIMAL_PAIRING = true;
const COLUMN_JOIN_MAX_AGE_STEPS = 2;
const ALLOW_ONE_COLUMN_BRIDGE = false;
const USE_LEGACY_20M_REWIRE = false;
const levels: number[] = [];
const maxLevel = Math.floor(maxSurvivors / levelStep) * levelStep;
for (let level = levelStep; level <= maxLevel; level += levelStep) {
  levels.push(level);
}

/* ---------- COMPUTE RAW ISOLINES ---------- */
const yearBase = years[0] ?? 0;
const ageBase = ages[0] ?? 0;
const maxYear = years[years.length - 1] ?? yearBase;
const maxAge = ages[ages.length - 1] ?? ageBase;
const yearStep = years.length > 1 ? years[1] - years[0] : 1;
const ageStep = ages.length > 1 ? ages[1] - ages[0] : 1;
const joinTolYear = JOIN_TOL_CELLS_X * yearStep;
const joinTolAge = JOIN_TOL_CELLS_Y * ageStep;
const age0AssignTolYear = AGE0_ASSIGN_TOL_CELLS * yearStep;
const RUN_JUMP_YEAR_MULT = 1.1;
const RUN_JUMP_AGE_MULT = 1.8;
const TURN_SPLIT_LEVEL = 20_000_000;
const TURN_SPLIT_ANGLE_DEG = 95;
const LEVEL20_BRIDGE_TOL_CELLS = { year: 0.75, age: 0.75 };

const levelRuns = new Map<number, YearAgePoint[][]>();
const jsonReady: { level: number; points: YearAgePoint[] }[] = [];

/* ---------- NORMALIZE EACH RING INTO CLEAN POLYLINE ---------- */

if (USE_COLUMN_CONTOURS) {
  const runsMap = buildColumnContourRuns(levels, years, ages, field.values, colsCount);
  for (const [level, runs] of runsMap.entries()) {
    levelRuns.set(level, runs);
  }
}

const generator = d3Contours()
  .size([field.cols, field.rows])
  .thresholds(levels);
const contourSets = generator(field.values);

const heavyStep = 5_000_000;
const minRunPts = 4;
const minBboxArea = yearStep * ageStep * 0.25;

function buildColumnContourRuns(
  levelsLocal: number[],
  yearsLocal: number[],
  agesLocal: number[],
  valuesLocal: number[],
  colsLocal: number
) {
  const runsByLevel = new Map<number, YearAgePoint[][]>();
  const rowsLocal = agesLocal.length;
  const maxJoinAge = COLUMN_JOIN_MAX_AGE_STEPS * ageStep;

  const valueAt = (row: number, col: number) =>
    valuesLocal[row * colsLocal + col];

  for (const level of levelsLocal) {
    const crossingsByCol: number[][] = [];
    for (let col = 0; col < yearsLocal.length; col++) {
      const agesCross: number[] = [];
      for (let row = 0; row < rowsLocal - 1; row++) {
        const v0 = valueAt(row, col);
        const v1 = valueAt(row + 1, col);
        if (v0 === v1) continue;
        const lo = Math.min(v0, v1);
        const hi = Math.max(v0, v1);
        if (level < lo || level > hi) continue;
        const t = (level - v0) / (v1 - v0);
        if (t < 0 || t > 1) continue;
        const age =
          agesLocal[row] + t * (agesLocal[row + 1] - agesLocal[row]);
        agesCross.push(age);
      }
      agesCross.sort((a, b) => a - b);
      crossingsByCol.push(agesCross);
    }

    const runs: { points: YearAgePoint[]; lastAge: number }[] = [];
    let active: { points: YearAgePoint[]; lastAge: number }[] = [];
    for (let col = 0; col < yearsLocal.length; col++) {
      const year = yearsLocal[col];
      const crossings = crossingsByCol[col];
      const nextActive: { points: YearAgePoint[]; lastAge: number }[] = [];

      const used = new Array(crossings.length).fill(false);

      if (USE_OPTIMAL_PAIRING && active.length && crossings.length) {
        const activeSorted = active
          .map((run, idx) => ({ run, idx }))
          .sort((a, b) => a.run.lastAge - b.run.lastAge);
        const aAges = activeSorted.map((item) => item.run.lastAge);
        const cAges = crossings;
        const memo = new Map<string, { matches: number; cost: number; choice: number }>();
        const solve = (i: number, j: number): { matches: number; cost: number } => {
          const key = `${i},${j}`;
          const cached = memo.get(key);
          if (cached) return { matches: cached.matches, cost: cached.cost };
          if (i >= aAges.length || j >= cAges.length) {
            memo.set(key, { matches: 0, cost: 0, choice: -1 });
            return { matches: 0, cost: 0 };
          }
          let best = solve(i + 1, j);
          let bestChoice = 0; // skip active
          let skipCross = solve(i, j + 1);
          if (
            skipCross.matches > best.matches ||
            (skipCross.matches === best.matches && skipCross.cost < best.cost)
          ) {
            best = skipCross;
            bestChoice = 1; // skip crossing
          }
          const dist = Math.abs(aAges[i] - cAges[j]);
          if (dist <= maxJoinAge) {
            const next = solve(i + 1, j + 1);
            const candidate = { matches: next.matches + 1, cost: next.cost + dist };
            if (
              candidate.matches > best.matches ||
              (candidate.matches === best.matches && candidate.cost < best.cost)
            ) {
              best = candidate;
              bestChoice = 2; // match
            }
          }
          memo.set(key, { matches: best.matches, cost: best.cost, choice: bestChoice });
          return best;
        };
        solve(0, 0);
        const matches: Array<{ ai: number; ci: number }> = [];
        let i = 0;
        let j = 0;
        while (i < aAges.length && j < cAges.length) {
          const state = memo.get(`${i},${j}`);
          if (!state) break;
          if (state.choice === 2) {
            matches.push({ ai: i, ci: j });
            i += 1;
            j += 1;
          } else if (state.choice === 1) {
            j += 1;
          } else {
            i += 1;
          }
        }
        const matchedActive = new Set<number>();
        for (const match of matches) {
          const activeItem = activeSorted[match.ai];
          const age = cAges[match.ci];
          used[match.ci] = true;
          activeItem.run.points.push({ year, age });
          activeItem.run.lastAge = age;
          nextActive.push(activeItem.run);
          matchedActive.add(activeItem.idx);
        }
        active.forEach((run, idx) => {
          if (!matchedActive.has(idx)) runs.push(run);
        });
      } else {
        for (const run of active) {
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < crossings.length; i++) {
            if (used[i]) continue;
            const dist = Math.abs(crossings[i] - run.lastAge);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          if (bestIdx >= 0 && bestDist <= maxJoinAge) {
            const age = crossings[bestIdx];
            used[bestIdx] = true;
            run.points.push({ year, age });
            run.lastAge = age;
            nextActive.push(run);
          } else {
            runs.push(run);
          }
        }
      }

      if (ALLOW_ONE_COLUMN_BRIDGE && col + 1 < yearsLocal.length) {
        const nextCrossings = crossingsByCol[col + 1];
        if (nextCrossings.length) {
          const usedNext = new Array(nextCrossings.length).fill(false);
          const carry: { points: YearAgePoint[]; lastAge: number }[] = [];
          for (const run of runs.splice(0)) {
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < nextCrossings.length; i++) {
              if (usedNext[i]) continue;
              const dist = Math.abs(nextCrossings[i] - run.lastAge);
              if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
              }
            }
            if (bestIdx >= 0 && bestDist <= maxJoinAge * 1.5) {
              const age = nextCrossings[bestIdx];
              usedNext[bestIdx] = true;
              run.points.push({ year: yearsLocal[col + 1], age });
              run.lastAge = age;
              carry.push(run);
            } else {
              runs.push(run);
            }
          }
          if (carry.length) {
            active = carry;
            continue;
          }
        }
      }

      for (let i = 0; i < crossings.length; i++) {
        if (used[i]) continue;
        nextActive.push({
          points: [{ year, age: crossings[i] }],
          lastAge: crossings[i],
        });
      }

      active = nextActive;
    }
    runs.push(...active);
    runsByLevel.set(
      level,
      runs.map((run) => run.points)
    );
  }
  return runsByLevel;
}

const isBoundaryPoint = (x: number, y: number) => {
  const eps = 1e-6;
  return (
    x <= eps ||
    y <= eps ||
    x >= colsCount - 1 - eps ||
    y >= rowsCount - 1 - eps
  );
};

const toYearAge = (x: number, y: number): YearAgePoint => ({
  year: yearBase + x * yearStep,
  age: ageBase + y * ageStep,
});

const normalizeRun = (run: YearAgePoint[]): YearAgePoint[] => {
  const out: YearAgePoint[] = [];
  for (const p of run) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.year - p.year) < 1e-9 &&
      Math.abs(last.age - p.age) < 1e-9
    ) {
      continue;
    }
    out.push(p);
  }
  if (out.length < 2) return [];
  return out;
};

const isClosedRun = (run: YearAgePoint[]) => {
  if (run.length < 2) return false;
  const first = run[0];
  const last = run[run.length - 1];
  return (
    Math.abs(first.year - last.year) < 1e-9 &&
    Math.abs(first.age - last.age) < 1e-9
  );
};

const runWithoutClosingPoint = (run: YearAgePoint[]) =>
  isClosedRun(run) ? run.slice(0, -1) : run;

const runSignature = (run: YearAgePoint[]): string => {
  const base = runWithoutClosingPoint(run);
  const key = base
    .map((p) => {
      const year = Math.round(p.year * 1e6) / 1e6;
      const age = Math.round(p.age * 1e6) / 1e6;
      return `${year},${age}`;
    })
    .join("|");
  const rev = base
    .slice()
    .reverse()
    .map((p) => {
      const year = Math.round(p.year * 1e6) / 1e6;
      const age = Math.round(p.age * 1e6) / 1e6;
      return `${year},${age}`;
    })
    .join("|");
  return key < rev ? key : rev;
};

const isOnBoundary = (p: YearAgePoint) =>
  Math.abs(p.age - ageBase) < 1e-6 ||
  Math.abs(p.age - maxAge) < 1e-6 ||
  Math.abs(p.year - yearBase) < 1e-6 ||
  Math.abs(p.year - maxYear) < 1e-6;

const isTop = (p: YearAgePoint) => Math.abs(p.age - ageBase) < 1e-6;
const isBottom = (p: YearAgePoint) => Math.abs(p.age - maxAge) < 1e-6;

const endpointsClose = (a: YearAgePoint, b: YearAgePoint) => {
  const boundary = isOnBoundary(a) || isOnBoundary(b);
  const tolYear = boundary ? joinTolYear * 0.25 : joinTolYear;
  const tolAge = boundary ? joinTolAge * 0.25 : joinTolAge;
  return (
    Math.abs(a.year - b.year) <= tolYear &&
    Math.abs(a.age - b.age) <= tolAge
  );
};

const DEBUG_MERGE_LEVEL = 20_000_000;
const DEBUG_MERGE = true;

const dirAt = (
  run: YearAgePoint[],
  which: "start" | "end"
): { x: number; y: number } | null => {
  if (run.length < 2) return null;
  if (which === "start") {
    const a = run[0];
    const b = run[1];
    const dx = b.year - a.year;
    const dy = b.age - a.age;
    const n = Math.hypot(dx, dy);
    if (!n) return null;
    return { x: dx / n, y: dy / n };
  }
  const a = run[run.length - 2];
  const b = run[run.length - 1];
  const dx = b.year - a.year;
  const dy = b.age - a.age;
  const n = Math.hypot(dx, dy);
  if (!n) return null;
  return { x: dx / n, y: dy / n };
};

const directionsCompatible = (
  mode: "aEnd-bStart" | "aEnd-bEnd" | "aStart-bStart" | "aStart-bEnd",
  a: YearAgePoint[],
  b: YearAgePoint[]
) => {
  const COS_THRESH = 0.85; // tighter (~32 degrees)
  let dirA: { x: number; y: number } | null = null;
  let dirB: { x: number; y: number } | null = null;
  if (mode === "aEnd-bStart") {
    dirA = dirAt(a, "end");
    dirB = dirAt(b, "start");
  } else if (mode === "aEnd-bEnd") {
    dirA = dirAt(a, "end");
    const d = dirAt(b, "end");
    dirB = d ? { x: -d.x, y: -d.y } : null;
  } else if (mode === "aStart-bStart") {
    const d = dirAt(a, "start");
    dirA = d ? { x: -d.x, y: -d.y } : null;
    dirB = dirAt(b, "start");
  } else if (mode === "aStart-bEnd") {
    dirA = dirAt(b, "end");
    dirB = dirAt(a, "start");
  }
  if (!dirA || !dirB) return false;
  const dot = dirA.x * dirB.x + dirA.y * dirB.y;
  return dot >= COS_THRESH;
};

const endpointTrendSign = (
  run: YearAgePoint[],
  which: "start" | "end"
) => {
  const dir = dirAt(run, which);
  if (!dir) return 0;
  const dx = dir.x;
  const dy = dir.y;
  if (Math.abs(dx) < 1e-6) return Math.sign(dy);
  return Math.sign(dy / dx);
};

const splitRunOnJumps = (run: YearAgePoint[]) => {
  const out: YearAgePoint[][] = [];
  if (run.length < 2) return out;
  let current: YearAgePoint[] = [run[0]];
  for (let i = 1; i < run.length; i++) {
    const prev = run[i - 1];
    const next = run[i];
    const dYear = Math.abs(next.year - prev.year);
    const dAge = Math.abs(next.age - prev.age);
    const jump =
      dYear > yearStep * RUN_JUMP_YEAR_MULT ||
      dAge > ageStep * RUN_JUMP_AGE_MULT;
    if (jump && current.length >= 2) {
      out.push(current);
      current = [prev, next];
    } else {
      current.push(next);
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
};

const splitRunOnTurns = (run: YearAgePoint[], angleDeg: number) => {
  const out: YearAgePoint[][] = [];
  if (run.length < 3) return [run];
  const cosThresh = Math.cos((angleDeg * Math.PI) / 180);
  let current: YearAgePoint[] = [run[0], run[1]];
  for (let i = 2; i < run.length; i++) {
    const a = run[i - 2];
    const b = run[i - 1];
    const c = run[i];
    const ux = b.year - a.year;
    const uy = b.age - a.age;
    const vx = c.year - b.year;
    const vy = c.age - b.age;
    const un = Math.hypot(ux, uy);
    const vn = Math.hypot(vx, vy);
    const dot = un && vn ? (ux * vx + uy * vy) / (un * vn) : 1;
    if (dot < cosThresh && current.length >= 2) {
      out.push(current);
      current = [b, c];
    } else {
      current.push(c);
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
};

const keyForPoint = (p: YearAgePoint) =>
  `${Math.round(p.year * 1e6) / 1e6},${Math.round(p.age * 1e6) / 1e6}`;

const buildGraphPathsForLevel = (
  runs: YearAgePoint[][],
  anchors: { start: YearAgePoint; end: YearAgePoint; via?: YearAgePoint }[],
  options?: { bridgeEndpointTol?: { year: number; age: number } }
) => {
  const nodes: YearAgePoint[] = [];
  const nodeIndex = new Map<string, number>();
  const addNode = (p: YearAgePoint) => {
    const key = keyForPoint(p);
    if (!nodeIndex.has(key)) {
      nodeIndex.set(key, nodes.length);
      nodes.push({ year: p.year, age: p.age });
    }
    return nodeIndex.get(key)!;
  };
  const adj: { to: number; w: number }[][] = [];
  const segments: { a: YearAgePoint; b: YearAgePoint }[] = [];
  const addEdge = (a: YearAgePoint, b: YearAgePoint) => {
    const ia = addNode(a);
    const ib = addNode(b);
    const w = Math.hypot(b.year - a.year, b.age - a.age);
    if (!adj[ia]) adj[ia] = [];
    if (!adj[ib]) adj[ib] = [];
    adj[ia].push({ to: ib, w });
    adj[ib].push({ to: ia, w });
  };
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i];
      const b = run[i + 1];
      segments.push({ a, b });
      addEdge(a, b);
    }
  }
  const closestPointOnSegment = (
    p: YearAgePoint,
    a: YearAgePoint,
    b: YearAgePoint
  ) => {
    const vx = b.year - a.year;
    const vy = b.age - a.age;
    const len2 = vx * vx + vy * vy;
    if (len2 === 0) {
      return { point: { year: a.year, age: a.age }, dist: Math.hypot(p.year - a.year, p.age - a.age) };
    }
    const t =
      ((p.year - a.year) * vx + (p.age - a.age) * vy) / len2;
    const tc = Math.max(0, Math.min(1, t));
    const point = { year: a.year + vx * tc, age: a.age + vy * tc };
    return { point, dist: Math.hypot(p.year - point.year, p.age - point.age) };
  };
  const anchorIndex = new Map<string, number>();
  const anchorNodeForPoint = (target: YearAgePoint) => {
    const key = keyForPoint(target);
    if (anchorIndex.has(key)) return anchorIndex.get(key)!;
    let best: { point: YearAgePoint; a: YearAgePoint; b: YearAgePoint } | null =
      null;
    let bestDist = Infinity;
    for (const seg of segments) {
      const hit = closestPointOnSegment(target, seg.a, seg.b);
      if (hit.dist < bestDist) {
        bestDist = hit.dist;
        best = { point: hit.point, a: seg.a, b: seg.b };
      }
    }
    const point = best ? best.point : target;
    const idx = addNode(point);
    if (best) {
      const ia = addNode(best.a);
      const ib = addNode(best.b);
      const wa = Math.hypot(point.year - best.a.year, point.age - best.a.age);
      const wb = Math.hypot(point.year - best.b.year, point.age - best.b.age);
      if (!adj[idx]) adj[idx] = [];
      adj[idx].push({ to: ia, w: wa });
      adj[idx].push({ to: ib, w: wb });
      adj[ia].push({ to: idx, w: wa });
      adj[ib].push({ to: idx, w: wb });
    }
    anchorIndex.set(key, idx);
    return idx;
  };
  if (options?.bridgeEndpointTol) {
    const tolYear = options.bridgeEndpointTol.year;
    const tolAge = options.bridgeEndpointTol.age;
    const endpoints: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if ((adj[i]?.length ?? 0) === 1) endpoints.push(i);
    }
    for (let i = 0; i < endpoints.length; i++) {
      const a = nodes[endpoints[i]];
      for (let j = i + 1; j < endpoints.length; j++) {
        const b = nodes[endpoints[j]];
        if (Math.abs(a.year - b.year) > tolYear) continue;
        if (Math.abs(a.age - b.age) > tolAge) continue;
        const w = Math.hypot(b.year - a.year, b.age - a.age);
        adj[endpoints[i]].push({ to: endpoints[j], w });
        adj[endpoints[j]].push({ to: endpoints[i], w });
      }
    }
  }
  const shortestPath = (startIdx: number, endIdx: number) => {
    const dist = new Array(nodes.length).fill(Infinity);
    const prev = new Array<number | null>(nodes.length).fill(null);
    const visited = new Array(nodes.length).fill(false);
    dist[startIdx] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (!visited[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u === -1 || u === endIdx) break;
      visited[u] = true;
      for (const edge of adj[u] ?? []) {
        if (dist[u] + edge.w < dist[edge.to]) {
          dist[edge.to] = dist[u] + edge.w;
          prev[edge.to] = u;
        }
      }
    }
    if (!Number.isFinite(dist[endIdx])) return null;
    const path: YearAgePoint[] = [];
    let cur: number | null = endIdx;
    while (cur != null) {
      path.push(nodes[cur]);
      cur = prev[cur];
    }
    path.reverse();
    return path;
  };
  const result: YearAgePoint[][] = [];
  for (const anchor of anchors) {
    const startIdx = anchorNodeForPoint(anchor.start);
    const endIdx = anchorNodeForPoint(anchor.end);
    if (anchor.via) {
      const viaIdx = anchorNodeForPoint(anchor.via);
      const p1 = shortestPath(startIdx, viaIdx);
      const p2 = shortestPath(viaIdx, endIdx);
      if (p1 && p2) {
        result.push(p1.concat(p2.slice(1)));
      }
    } else {
      const p = shortestPath(startIdx, endIdx);
      if (p) result.push(p);
    }
  }
  return result;
};

if (!USE_COLUMN_CONTOURS) {
for (const contour of contourSets) {
  const levelValue = Number(contour.value);
  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      if (!ring || ring.length < 2) continue;
      const points = ring.map(([x, y]) => ({ x, y }));
      const boundaryHits = points
        .map((p, idx) => (isBoundaryPoint(p.x, p.y) ? idx : -1))
        .filter((idx) => idx >= 0);
      const runs: { points: YearAgePoint[]; closedCandidate: boolean }[] = [];
      if (boundaryHits.length > 0) {
        const splitIdx = Array.from(new Set(boundaryHits)).sort((a, b) => a - b);
        const indices = [...splitIdx, splitIdx[0] + points.length];
        for (let i = 0; i < indices.length - 1; i++) {
          const start = indices[i];
          const end = indices[i + 1];
          const slice: { x: number; y: number }[] = [];
          for (let j = start; j <= end; j++) {
            slice.push(points[j % points.length]);
          }
          if (slice.length < 2) continue;
          const boundaryCount = slice.filter((p) =>
            isBoundaryPoint(p.x, p.y)
          ).length;
          const boundaryRatio = boundaryCount / slice.length;
          if (boundaryRatio > 0.5) continue;
          runs.push({
            points: slice.map((p) => toYearAge(p.x, p.y)),
            closedCandidate: false,
          });
        }
      } else {
        runs.push({
          points: points.map((p) => toYearAge(p.x, p.y)),
          closedCandidate: true,
        });
      }

      for (const run of runs) {
        const normalized = normalizeRun(run.points);
        if (normalized.length < 2) continue;
        const first = normalized[0];
        const last = normalized[normalized.length - 1];
        const isClosed =
          Math.abs(first.year - last.year) < 1e-9 &&
          Math.abs(first.age - last.age) < 1e-9;
        if (run.closedCandidate) {
          if (!isClosed) {
            normalized.push(first);
          }
        } else if (isClosed) {
          normalized.pop();
        }
        if (normalized.length < 2) continue;
        const bucket = levelRuns.get(levelValue) ?? [];
        bucket.push(normalized);
        levelRuns.set(levelValue, bucket);
      }
    }
  }
}
}

/* ---------- VALIDATION + WRITE JSON ---------- */

const perLevelSummary: { level: number; runs: number; points: number }[] = [];
const levelsSorted = Array.from(levelRuns.keys()).sort((a, b) => a - b);
// Hard-coded 20M anchors: d3-contour produces ambiguous joins near the ridge,
// so we force paths through known endpoints to avoid incorrect cross-ridge merges.
const level20Anchors = [
  {
    start: { year: 1959.038701, age: 0 },
    end: { year: 2027.5, age: 66.569233 },
  },
  {
    start: { year: 1963.297678, age: 0 },
    end: { year: 2006.458699, age: 0 },
    via: { year: 2008.958699, age: 2.5 },
  },
  {
    start: { year: 2013.635103, age: 0 },
    end: { year: 2025.0, age: 5.255406 },
  },
];
for (const level of levelsSorted) {
  let runs = levelRuns.get(level) ?? [];
  const seen = new Set<string>();
  runs = runs.filter((run) => {
    const sig = runSignature(run);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  const dedupedRuns = runs;
  let skipMerge = false;
  if (USE_COLUMN_CONTOURS) {
    runs = dedupedRuns;
    skipMerge = true;
  } else if (level === TURN_SPLIT_LEVEL) {
    // Hard-code 20M: avoid split/merge heuristics that join across the ridge.
    runs = dedupedRuns;
    const graphRuns = buildGraphPathsForLevel(dedupedRuns, level20Anchors, {
      bridgeEndpointTol: {
        year: LEVEL20_BRIDGE_TOL_CELLS.year * yearStep,
        age: LEVEL20_BRIDGE_TOL_CELLS.age * ageStep,
      },
    });
    if (graphRuns.length === level20Anchors.length) {
      runs = graphRuns;
      skipMerge = true;
    } else if (DEBUG_MERGE) {
      console.log(
        `[GRAPH] level=${level} pathsFound=${graphRuns.length} expected=${level20Anchors.length}`
      );
    }
    if (!skipMerge) {
      // Drop tiny closed 20M islands that cause incorrect joins.
      const trimmed = runs.filter(
        (run) => !(isClosedRun(run) && run.length <= 5)
      );
      if (trimmed.length >= 3) {
        runs = trimmed;
      }
    }
  } else if (DEBUG_MERGE && level === DEBUG_MERGE_LEVEL) {
    const before = dedupedRuns.length;
    let splitRuns = dedupedRuns.flatMap(splitRunOnJumps);
    if (level === TURN_SPLIT_LEVEL) {
      splitRuns = splitRuns.flatMap((run) =>
        splitRunOnTurns(run, TURN_SPLIT_ANGLE_DEG)
      );
    }
    console.log(
      `[SPLIT] level=${level} runsBefore=${before} runsAfter=${splitRuns.length}`
    );
    runs = splitRuns;
  } else {
    runs = dedupedRuns.flatMap(splitRunOnJumps);
    if (level === TURN_SPLIT_LEVEL) {
      runs = runs.flatMap((run) =>
        splitRunOnTurns(run, TURN_SPLIT_ANGLE_DEG)
      );
    }
  }

  const closedRuns = runs.filter((run) => isClosedRun(run));
  let openRuns = runs.filter((run) => !isClosedRun(run));

  let merges = 0;
  if (DEBUG_MERGE && level === DEBUG_MERGE_LEVEL) {
    runs.forEach((run, idx) => {
      let maxLen = 0;
      let maxIdx = -1;
      for (let i = 0; i < run.length - 1; i++) {
        const a = run[i];
        const b = run[i + 1];
        const d = Math.hypot(b.year - a.year, b.age - a.age);
        if (d > maxLen) {
          maxLen = d;
          maxIdx = i;
        }
      }
      console.log(
        `[RUN] level=${level} run=${idx} pts=${run.length} maxSeg=${maxLen.toFixed(
          3
        )} at=${maxIdx}`
      );
    });
  }
  if (!skipMerge) {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < openRuns.length; i++) {
        for (let j = i + 1; j < openRuns.length; j++) {
          const a = openRuns[i];
          const b = openRuns[j];
          const aStart = a[0];
          const aEnd = a[a.length - 1];
          const bStart = b[0];
          const bEnd = b[b.length - 1];
          const pairs = [
            { aP: aEnd, bP: bStart, mode: "aEnd-bStart" },
            { aP: aEnd, bP: bEnd, mode: "aEnd-bEnd" },
            { aP: aStart, bP: bStart, mode: "aStart-bStart" },
            { aP: aStart, bP: bEnd, mode: "aStart-bEnd" },
          ];
          let matched = false;
          for (const pair of pairs) {
            if (
              (isTop(pair.aP) && isTop(pair.bP)) ||
              (isBottom(pair.aP) && isBottom(pair.bP))
            ) {
              continue;
            }
            if (!endpointsClose(pair.aP, pair.bP)) {
              continue;
            }
            const dirOk = directionsCompatible(pair.mode, a, b);
            if (!dirOk) {
              continue;
            }
            if (level === TURN_SPLIT_LEVEL) {
              const aTrend =
                pair.mode.startsWith("aStart")
                  ? endpointTrendSign(a, "start")
                  : endpointTrendSign(a, "end");
              const bTrend =
                pair.mode.endsWith("bStart")
                  ? endpointTrendSign(b, "start")
                  : endpointTrendSign(b, "end");
              if (aTrend !== 0 && bTrend !== 0 && aTrend !== bTrend) {
                continue;
              }
            }
            if (DEBUG_MERGE && level === DEBUG_MERGE_LEVEL) {
              const da = Math.hypot(
                pair.aP.year - pair.bP.year,
                pair.aP.age - pair.bP.age
              );
              const dirA = dirAt(
                pair.mode.startsWith("aStart") ? a : a,
                pair.mode.startsWith("aStart") ? "start" : "end"
              );
              const dirB = dirAt(
                pair.mode.endsWith("bStart") ? b : b,
                pair.mode.endsWith("bStart") ? "start" : "end"
              );
              const dot =
                dirA && dirB ? dirA.x * dirB.x + dirA.y * dirB.y : NaN;
              console.log(
                `[MERGE] level=${level} mode=${pair.mode} dist=${da.toFixed(
                  3
                )} dot=${Number.isFinite(dot) ? dot.toFixed(3) : "NaN"}`
              );
            }
            if (pair.mode === "aEnd-bStart") {
              openRuns[i] = a.concat(b);
            } else if (pair.mode === "aEnd-bEnd") {
              openRuns[i] = a.concat(b.slice().reverse());
            } else if (pair.mode === "aStart-bStart") {
              openRuns[i] = a.slice().reverse().concat(b);
            } else if (pair.mode === "aStart-bEnd") {
              openRuns[i] = b.concat(a);
            }
            matched = true;
            break;
          }
          if (!matched) {
            continue;
          }
          openRuns.splice(j, 1);
          merged = true;
          merges += 1;
          break outer;
        }
      }
    }
  }
  openRuns = openRuns.map((run) => {
    if (run.length < 2) return run;
    const start = adjustEndpointToBoundary(
      run[0],
      level,
      years,
      ages,
      values,
      colsCount
    );
    const end = adjustEndpointToBoundary(
      run[run.length - 1],
      level,
      years,
      ages,
      values,
      colsCount
    );
    return [start, ...run.slice(1, -1), end];
  });
  runs = closedRuns.concat(openRuns);
  if (DEBUG_JOIN) {
    // eslint-disable-next-line no-console
    console.log(
      `[JOIN] level=${level} merges=${merges} runsBefore=${levelRuns.get(level)?.length ?? 0} runsAfter=${runs.length}`
    );
  }
  if (runs.length > 0) {
    const crossings = boundaryYearCrossingsAtAge(
      level,
      ageBase,
      years,
      ages,
      values,
      colsCount
    );
    if (crossings.length > 0) {
      const endpoints: {
        runIndex: number;
        pos: "start" | "end";
        year: number;
        assigned: boolean;
      }[] = [];
      runs.forEach((run, idx) => {
        if (run.length < 2) return;
        const first = run[0];
        const last = run[run.length - 1];
        if (isTop(first)) {
          endpoints.push({
            runIndex: idx,
            pos: "start",
            year: first.year,
            assigned: false,
          });
        }
        if (isTop(last)) {
          endpoints.push({
            runIndex: idx,
            pos: "end",
            year: last.year,
            assigned: false,
          });
        }
      });
      const used = new Set<number>();
      const assignments = endpoints
        .map((ep) => {
          let bestDist = Infinity;
          for (const y of crossings) {
            bestDist = Math.min(bestDist, Math.abs(y - ep.year));
          }
          return { ...ep, bestDist };
        })
        .sort((a, b) => a.bestDist - b.bestDist);
      for (const ep of assignments) {
        let bestIndex = -1;
        let bestDist = Infinity;
        for (let i = 0; i < crossings.length; i++) {
          if (used.has(i)) continue;
          const y = crossings[i];
          const dist = Math.abs(y - ep.year);
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }
        if (bestIndex < 0 || bestDist > age0AssignTolYear) {
          continue;
        }
        used.add(bestIndex);
        const y = crossings[bestIndex];
        const run = runs[ep.runIndex];
        if (!run || run.length < 2) continue;
        if (ep.pos === "start") {
          run[0] = { year: y, age: ageBase };
        } else {
          run[run.length - 1] = { year: y, age: ageBase };
        }
        ep.assigned = true;
      }
      const keyOf = (year: number) => Math.round(year * 1e6) / 1e6;
      const seenKeys = new Set<number>();
      for (const ep of endpoints) {
        const run = runs[ep.runIndex];
        if (!run || run.length < 2) continue;
        const point = ep.pos === "start" ? run[0] : run[run.length - 1];
        const key = keyOf(point.year);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          continue;
        }
        if (ep.assigned) {
          continue;
        }
        let bestIndex = -1;
        let bestDist = Infinity;
        for (let i = 0; i < crossings.length; i++) {
          if (used.has(i)) continue;
          const y = crossings[i];
          const dist = Math.abs(y - point.year);
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }
        if (bestIndex < 0) continue;
        used.add(bestIndex);
        const y = crossings[bestIndex];
        if (ep.pos === "start") {
          run[0] = { year: y, age: ageBase };
        } else {
          run[run.length - 1] = { year: y, age: ageBase };
        }
      }
    }
  }
  if (DEBUG_AGE0 && (level === 17_000_000 || level === 18_000_000)) {
    runs.forEach((run, idx) => {
      const first = run[0];
      const last = run[run.length - 1];
      if (isTop(first) || isTop(last)) {
        // eslint-disable-next-line no-console
        console.log(
          `[AGE0-ENDS] level=${level} run=${idx + 1} start=(${first.year.toFixed(
            6
          )}, ${first.age.toFixed(6)}) end=(${last.year.toFixed(
            6
          )}, ${last.age.toFixed(6)})`
        );
      }
    });
  }

  const isThick = level % heavyStep === 0;
  runs = runs.filter((run) => {
    if (run.length < 2) return false;
    if (isThick) return true;
    if (run.length < minRunPts) return false;
    let minYearRun = Infinity;
    let maxYearRun = -Infinity;
    let minAgeRun = Infinity;
    let maxAgeRun = -Infinity;
    for (const p of run) {
      minYearRun = Math.min(minYearRun, p.year);
      maxYearRun = Math.max(maxYearRun, p.year);
      minAgeRun = Math.min(minAgeRun, p.age);
      maxAgeRun = Math.max(maxAgeRun, p.age);
    }
    const bboxArea = (maxYearRun - minYearRun) * (maxAgeRun - minAgeRun);
    return bboxArea >= minBboxArea;
  });

  if (runs.length === 0) continue;
  let totalPts = 0;
  for (const run of runs) {
    totalPts += run.length;
    for (const p of run) {
      if (!Number.isFinite(p.year) || !Number.isFinite(p.age)) {
        throw new Error(
          `Invalid contour point at level=${level}: ${JSON.stringify(p)}`
        );
      }
    }
    jsonReady.push({ level, points: run });
  }
  perLevelSummary.push({ level, runs: runs.length, points: totalPts });
}

const rewireLevel20Runs = (
  runsJson: { level: number; points: YearAgePoint[] }[]
) => {
  const runAIdx = 29;
  const runBIdx = 31;
  const runA = runsJson[runAIdx];
  const runB = runsJson[runBIdx];
  if (!runA || !runB) return runsJson;
  if (runA.level !== 20_000_000 || runB.level !== 20_000_000) return runsJson;
  if (runA.points.length < 3 || runB.points.length < 28) return runsJson;

  const nodeKey = (runIdx: number, pointIdx: number) =>
    `${runIdx}:${pointIdx}`;
  const nodes = new Map<string, YearAgePoint>();
  const adj = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  const removeEdge = (a: string, b: string) => {
    adj.get(a)?.delete(b);
    adj.get(b)?.delete(a);
  };

  [runA, runB].forEach((run, runIdx) => {
    run.points.forEach((p, idx) => {
      nodes.set(nodeKey(runIdx === 0 ? runAIdx : runBIdx, idx), p);
    });
    for (let i = 0; i < run.points.length - 1; i++) {
      const aKey = nodeKey(runIdx === 0 ? runAIdx : runBIdx, i);
      const bKey = nodeKey(runIdx === 0 ? runAIdx : runBIdx, i + 1);
      addEdge(aKey, bKey);
    }
  });

  const a0 = nodeKey(runAIdx, 0);
  const a1 = nodeKey(runAIdx, 1);
  const a2 = nodeKey(runAIdx, 2);
  const b26 = nodeKey(runBIdx, 26);
  const b27 = nodeKey(runBIdx, 27);
  removeEdge(a0, a1);
  removeEdge(b26, b27);
  addEdge(a0, b26);
  addEdge(a2, b27);

  const paths: { keys: string[]; points: YearAgePoint[] }[] = [];
  const remaining = new Map<string, Set<string>>();
  for (const [k, v] of adj) remaining.set(k, new Set(v));

  const takeEdge = (a: string, b: string) => {
    remaining.get(a)?.delete(b);
    remaining.get(b)?.delete(a);
  };
  const degree = (k: string) => remaining.get(k)?.size ?? 0;
  const nextNeighbor = (k: string) =>
    remaining.get(k) ? Array.from(remaining.get(k)!) : [];

  const visitPath = (start: string) => {
    const pathKeys: string[] = [start];
    let cur = start;
    let prev: string | null = null;
    for (;;) {
      const neighbors = nextNeighbor(cur).filter((n) => n !== prev);
      if (neighbors.length === 0) break;
      const next = neighbors[0];
      takeEdge(cur, next);
      pathKeys.push(next);
      prev = cur;
      cur = next;
    }
    paths.push({
      keys: pathKeys,
      points: pathKeys.map((k) => nodes.get(k)!).filter(Boolean),
    });
  };

  // Open paths first.
  for (const [k] of remaining) {
    if (degree(k) === 1) {
      visitPath(k);
    }
  }
  // Any closed loops left.
  for (const [k] of remaining) {
    if (degree(k) > 0) {
      visitPath(k);
    }
  }

  if (paths.length < 2) return runsJson;

  const a0Key = nodeKey(runAIdx, 0);
  const b27Key = nodeKey(runBIdx, 27);
  const pathA = paths.find((p) => p.keys.includes(a0Key)) ?? paths[0];
  const pathB =
    paths.find((p) => p.keys.includes(b27Key) && p !== pathA) ??
    paths.find((p) => p !== pathA) ??
    paths[1];
  const extras = paths.filter((p) => p !== pathA && p !== pathB);

  const updated = runsJson.slice();
  updated[runAIdx] = { level: runA.level, points: pathA.points };
  updated[runBIdx] = { level: runB.level, points: pathB.points };
  if (extras.length) {
    updated.splice(
      runBIdx + 1,
      0,
      ...extras.map((p) => ({ level: runA.level, points: p.points }))
    );
  }
  return updated;
};

// Hard-coded 20M joins: avoid incorrect cross-ridge segments without changing other levels.
type RunEdit = {
  type: "add" | "remove";
  a?: { runIndex: number; pointIndex: number };
  b?: { runIndex: number; pointIndex: number };
  pointA?: { year: number; age: number };
  pointB?: { year: number; age: number };
  level?: number;
  removeByCoord?: boolean;
};

const rewireRunsByIndex = (
  runsJson: { level: number; points: YearAgePoint[] }[],
  edits: RunEdit[]
) => {
  if (edits.length === 0) return runsJson;
  const byRun = new Map<number, RunEdit[]>();
  edits.forEach((edit) => {
    const indices: number[] = [];
    if (edit.a) indices.push(edit.a.runIndex);
    if (edit.b) indices.push(edit.b.runIndex);
    indices.forEach((idx) => {
      const list = byRun.get(idx) ?? [];
      list.push(edit);
      byRun.set(idx, list);
    });
  });
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const idx of byRun.keys()) {
    if (seen.has(idx)) continue;
    const stack = [idx];
    const group: number[] = [];
    seen.add(idx);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const edit of byRun.get(cur) ?? []) {
        const neighbors: number[] = [];
        if (edit.a) neighbors.push(edit.a.runIndex);
        if (edit.b) neighbors.push(edit.b.runIndex);
        neighbors.forEach((other) => {
          if (!seen.has(other)) {
            seen.add(other);
            stack.push(other);
          }
        });
      }
    }
    groups.push(group.sort((a, b) => a - b));
  }

  const updated = runsJson.slice();
  const nodeKey = (runIndex: number, pointIndex: number) =>
    `${runIndex}:${pointIndex}`;
  const pointKey = (p: { year: number; age: number }) =>
    `point:${p.year.toFixed(6)},${p.age.toFixed(6)}`;

  for (const group of groups) {
    const nodes = new Map<string, YearAgePoint>();
    const adj = new Map<string, Set<string>>();
    const addEdge = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    };
    const removeEdge = (a: string, b: string) => {
      adj.get(a)?.delete(b);
      adj.get(b)?.delete(a);
    };

    for (const runIndex of group) {
      const run = runsJson[runIndex];
      if (!run) continue;
      run.points.forEach((p, idx) => {
        nodes.set(nodeKey(runIndex, idx), p);
      });
      for (let i = 0; i < run.points.length - 1; i++) {
        addEdge(nodeKey(runIndex, i), nodeKey(runIndex, i + 1));
      }
    }

    for (const edit of edits) {
      if (
        edit.a &&
        edit.b &&
        (!group.includes(edit.a.runIndex) ||
          !group.includes(edit.b.runIndex))
      ) {
        continue;
      }
      const aKey = edit.a
        ? nodeKey(edit.a.runIndex, edit.a.pointIndex)
        : edit.pointA
        ? pointKey(edit.pointA)
        : null;
      const bKey = edit.b
        ? nodeKey(edit.b.runIndex, edit.b.pointIndex)
        : edit.pointB
        ? pointKey(edit.pointB)
        : null;
      if (!aKey || !bKey) continue;
      if (edit.pointA) nodes.set(aKey, edit.pointA);
      if (edit.pointB) nodes.set(bKey, edit.pointB);
      if (edit.removeByCoord && edit.pointA && edit.pointB) {
        const tol = 1e-6;
        for (const [k, v] of nodes) {
          if (
            Math.abs(v.year - edit.pointA.year) <= tol &&
            Math.abs(v.age - edit.pointA.age) <= tol
          ) {
            for (const [k2, v2] of nodes) {
              if (
                Math.abs(v2.year - edit.pointB.year) <= tol &&
                Math.abs(v2.age - edit.pointB.age) <= tol
              ) {
                removeEdge(k, k2);
              }
            }
          }
        }
      } else if (edit.type === "remove") {
        removeEdge(aKey, bKey);
      } else {
        addEdge(aKey, bKey);
      }
    }

    const remaining = new Map<string, Set<string>>();
    for (const [k, v] of adj) remaining.set(k, new Set(v));
    const degree = (k: string) => remaining.get(k)?.size ?? 0;
    const nextNeighbor = (k: string) =>
      remaining.get(k) ? Array.from(remaining.get(k)!) : [];
    const takeEdge = (a: string, b: string) => {
      remaining.get(a)?.delete(b);
      remaining.get(b)?.delete(a);
    };
    const paths: YearAgePoint[][] = [];
    const visitPath = (start: string) => {
      const pathKeys: string[] = [start];
      let cur = start;
      let prev: string | null = null;
      for (;;) {
        const neighbors = nextNeighbor(cur).filter((n) => n !== prev);
        if (neighbors.length === 0) break;
        const next = neighbors[0];
        takeEdge(cur, next);
        pathKeys.push(next);
        prev = cur;
        cur = next;
      }
      paths.push(pathKeys.map((k) => nodes.get(k)!).filter(Boolean));
    };
    for (const [k] of remaining) {
      if (degree(k) === 1) visitPath(k);
    }
    for (const [k] of remaining) {
      if (degree(k) > 0) visitPath(k);
    }

    const runIndices = group.slice().sort((a, b) => a - b);
    const sortedPaths = paths.sort((a, b) => b.length - a.length);
    const assignCount = Math.min(runIndices.length, sortedPaths.length);
    for (let i = 0; i < assignCount; i++) {
      const runIndex = runIndices[i];
      const run = runsJson[runIndex];
      if (run) {
        updated[runIndex] = { level: run.level, points: sortedPaths[i] };
      }
    }
    if (sortedPaths.length > runIndices.length) {
      const insertAt = runIndices[runIndices.length - 1] + 1;
      const extras = sortedPaths
        .slice(runIndices.length)
        .map((points) => ({ level: runsJson[runIndices[0]].level, points }));
      updated.splice(insertAt, 0, ...extras);
    }
  }

  return updated;
};

const jsonReadyAdjusted = USE_LEGACY_20M_REWIRE
  ? rewireLevel20Runs(jsonReady)
  : jsonReady;

const jsonReadyFinal = rewireRunsByIndex(jsonReadyAdjusted, [
  {
    type: "remove",
    a: { runIndex: 28, pointIndex: 0 },
    b: { runIndex: 28, pointIndex: 1 },
  },
  {
    type: "add",
    a: { runIndex: 28, pointIndex: 0 },
    b: { runIndex: 30, pointIndex: 0 },
  },
  {
    type: "add",
    a: { runIndex: 12, pointIndex: 14 },
    b: { runIndex: 13, pointIndex: 0 },
  },
  {
    type: "add",
    a: { runIndex: 32, pointIndex: 0 },
    b: { runIndex: 31, pointIndex: 0 },
  },
  {
    type: "remove",
    pointA: { year: 1985, age: 51.95117658353423 },
    pointB: { year: 1990, age: 52.09960393640306 },
    removeByCoord: true,
  },
  {
    type: "add",
    a: { runIndex: 12, pointIndex: 15 },
    pointB: { year: 1985, age: 49.03 },
  },
  {
    type: "add",
    a: { runIndex: 13, pointIndex: 1 },
    pointB: { year: 1985, age: 49.03 },
  },
]);

// Manual 22M run: bridge missing crossings into a single contour path.
jsonReadyFinal.push({
  level: 22_000_000,
  points: [
    { year: 2025, age: 13.89 },
    { year: 2020, age: 21.96 },
    { year: 2015, age: 17.84 },
    { year: 2015, age: 27.73 },
    { year: 2020, age: 35.76 },
    { year: 2025, age: 41.56 },
  ],
});

const serialized = JSON.stringify(jsonReadyFinal, null, 2);
if (serialized.includes('"age": null')) {
  throw new Error("Found age:null in output; NaN leaked into JSON.");
}

fs.writeFileSync(contoursOutPath, serialized, "utf8");

console.log(
  `Wrote ${jsonReady.length} contour runs (${perLevelSummary.length} levels) to ${path.relative(
    process.cwd(),
    contoursOutPath
  )}`
);
for (const summary of perLevelSummary) {
  const prefix = summary.runs > 5 ? "⚠" : " ";
  console.log(
    `${prefix} level=${summary.level} runs=${summary.runs} pts=${summary.points}`
  );
}
