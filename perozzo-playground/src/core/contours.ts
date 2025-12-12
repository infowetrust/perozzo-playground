// src/core/contours.ts

/**
 * A scalar field on a regular grid:
 * - rows correspond to age bands (ages[rowIndex])
 * - cols correspond to years (years[colIndex])
 * - values are survivor counts (or any scalar), stored row-major:
 *   values[rowIndex * cols + colIndex]
 */
export type GridField = {
  rows: number;
  cols: number;
  values: number[]; // length = rows * cols, row-major
  ages: number[];   // length = rows, e.g. [5, 10, 15, ...]
  years: number[];  // length = cols, e.g. [1750, 1755, ...]
};

/**
 * One point on a value isoline, in data space.
 * - yearIndex: column index into `years`
 * - age: interpolated age in years (may be fractional)
 */
export type ValueIsoPoint = {
  yearIndex: number;
  age: number;
};

/**
 * One continuous isoline for a given scalar level.
 * - level: the scalar value (e.g. survivors = 50_000)
 * - points: ordered along increasing yearIndex
 *
 * Styling decisions (thin/thick, color, etc.) are left to the caller.
 */
export type ValueIsoPolyline = {
  level: number;
  points: ValueIsoPoint[];
};

/**
 * Compute value-based isolines by scanning vertically (per year/column).
 *
 * For each requested scalar `level`, and for each year column, we:
 *   - look at the values down that column (as age increases),
 *   - find the first adjacent pair that straddles the level,
 *   - interpolate a single crossing age between those two ages.
 *
 * Assumes the values are *monotone* with age in each column
 * (as in life tables, where survivors decrease with age),
 * so each level can cross a column at most once.
 *
 * This is purely geometric: it does not decide which levels to use
 * or how to style them. The caller chooses the `levels` array and
 * handles line weights/colors.
 */
export function computeVerticalIsoLines(
  field: GridField,
  levels: number[]
): ValueIsoPolyline[] {
  const { rows, cols, values, ages } = field;

  if (rows < 2 || cols < 1 || values.length !== rows * cols) {
    return [];
  }

  if (!levels.length) return [];

  const isolines: ValueIsoPolyline[] = [];

  for (const level of levels) {
    const pointsForLevel: ValueIsoPoint[] = [];

    // for each column (year), scan down the ages to find the first crossing
    for (let col = 0; col < cols; col++) {
      // walk row pairs: (row, row+1)
      for (let row = 0; row < rows - 1; row++) {
        const idx0 = row * cols + col;
        const idx1 = (row + 1) * cols + col;
        const v0 = values[idx0];
        const v1 = values[idx1];

        // skip if both values are invalid
        if (!Number.isFinite(v0) && !Number.isFinite(v1)) continue;

        // determine if [v0, v1] brackets the level
        const minV = Math.min(v0, v1);
        const maxV = Math.max(v0, v1);

        if (level < minV || level > maxV || v0 === v1) {
          // no crossing on this segment
          continue;
        }

        const age0 = ages[row];
        const age1 = ages[row + 1];

        // linear interpolation in age
        const t = (level - v0) / (v1 - v0); // 0..1
        const ageStar = age0 + t * (age1 - age0);

        pointsForLevel.push({ yearIndex: col, age: ageStar });

        // at most one crossing per column (monotone assumption)
        break;
      }
    }

    // we only care about levels that appear in at least 2 columns
    if (pointsForLevel.length > 1) {
      isolines.push({
        level,
        points: pointsForLevel,
      });
    }
  }

  return isolines;
}