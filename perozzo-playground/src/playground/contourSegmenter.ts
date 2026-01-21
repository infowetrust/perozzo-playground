import type { Point2D } from "../core/types";

export type ContourDataPoint = { year: number; age: number };

export type ValueSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: number;
  cellKey: string;
  runId?: number;
};

export function findRowSegmentIndex(age: number, ages: number[]): number {
  if (age < ages[0] || age > ages[ages.length - 1]) return -1;
  for (let i = 0; i < ages.length - 1; i++) {
    if (age >= ages[i] && age <= ages[i + 1]) {
      return i;
    }
  }
  return -1;
}

export function findColSegmentIndex(year: number, years: number[]): number {
  if (year < years[0] || year > years[years.length - 1]) return -1;
  for (let i = 0; i < years.length - 1; i++) {
    if (year >= years[i] && year <= years[i + 1]) {
      return i;
    }
  }
  return -1;
}

export function segmentizeContourPolyline(
  level: number,
  points: Point2D[],
  data: ContourDataPoint[],
  years: number[],
  ages: number[],
  runId?: number,
  options?: { splitByAgeLines?: boolean }
): ValueSegment[] {
  if (points.length < 2 || data.length < 2) return [];
  const segments: ValueSegment[] = [];
  const ageStep = ages.length > 1 ? ages[1] - ages[0] : 0;
  const splitByAgeLines = options?.splitByAgeLines ?? true;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const d0 = data[i];
    const d1 = data[i + 1];
    if (!p0 || !p1 || !d0 || !d1) continue;
    const midYear = (d0.year + d1.year) / 2;
    const qc = findColSegmentIndex(midYear, years);
    if (qc < 0 || ageStep <= 0) continue;
    const a0 = d0.age;
    const a1 = d1.age;
    const tAll = [0, 1];
    if (splitByAgeLines) {
      const tBreaks: number[] = [];
      if (a0 !== a1) {
        const minA = Math.min(a0, a1);
        const maxA = Math.max(a0, a1);
        const startK = Math.ceil(minA / ageStep);
        const endK = Math.floor(maxA / ageStep);
        for (let k = startK; k <= endK; k++) {
          const ageLine = k * ageStep;
          if (ageLine <= minA || ageLine >= maxA) continue;
          const t = (ageLine - a0) / (a1 - a0);
          if (t > 0 && t < 1) tBreaks.push(t);
        }
        tBreaks.sort((a, b) => a - b);
      }
      tAll.splice(1, 0, ...tBreaks);
    }
    for (let s = 0; s < tAll.length - 1; s++) {
      const t0 = tAll[s];
      const t1 = tAll[s + 1];
      const midT = (t0 + t1) / 2;
      const midAge = a0 + (a1 - a0) * midT;
      const qr = findRowSegmentIndex(midAge, ages);
      if (qr < 0) continue;
      const x1 = p0.x + (p1.x - p0.x) * t0;
      const y1 = p0.y + (p1.y - p0.y) * t0;
      const x2 = p0.x + (p1.x - p0.x) * t1;
      const y2 = p0.y + (p1.y - p0.y) * t1;
      segments.push({
        x1,
        y1,
        x2,
        y2,
        level,
        cellKey: `${qr}-${qc}`,
        runId,
      });
    }
  }
  return segments;
}
