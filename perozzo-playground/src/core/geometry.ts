/*
defines the physics (how space and projection work)
Reusable functions for generating and projecting 3D surfaces.
*/

import type { Point2D, Point3D } from "./types";

export type ProjectionOptions = {
  originX: number;
  originY: number;
  scaleXY: number;
  scaleZ: number;
  baseRotation?: number; // radians; rotation of (x,y) before projection
};

export type ProjectionPreset = "perozzoBasic" | "isometric30" | "steep45";

/**
 * Create projection options based on a named historic-ish preset.
 * These are rough artistic approximations, not strict reconstructions.
 */
export function projectionForPreset(
  preset: ProjectionPreset,
  width: number,
  height: number
): ProjectionOptions {
  switch (preset) {
    case "perozzoBasic":
      // close to what you dialed in by eye
      return {
        originX: width / 2 - 50,
        originY: height - 440,
        scaleXY: 10,
        scaleZ: 80,
        baseRotation: -.5, // start at 0; we can tweak
      };

    case "isometric30":
      // more classic isometric: lower height, centered origin
      return {
        originX: width / 2,
        originY: height - 160,
        scaleXY: 12,
        scaleZ: 60,
        baseRotation: -Math.PI / 12, // about -15°

      };

    case "steep45":
      // steeper "statistics plate" look: exaggerated height
      return {
        originX: width / 2 - 40,
        originY: height - 140,
        scaleXY: 10,
        scaleZ: 120,
        baseRotation: -Math.PI / 7,

      };

    default:
      // fallback
      return {
        originX: width / 2,
        originY: height - 160,
        scaleXY: 10,
        scaleZ: 80,
      };
  }
}

/**
 * Simple rectangular 2D grid (not currently used, but handy to keep around).
 */
export function demoGrid(rows: number, cols: number): Point2D[] {
  const points: Point2D[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ x: c, y: r });
    }
  }

  return points;
}

/**
 * Tiny “mountain range” surface on a regular grid.
 * This is just a toy function: later this can be real data.
 */
export function demoSurface(rows: number, cols: number): Point3D[] {
  const points: Point3D[] = [];

  const maxX = cols - 1;
  const maxY = rows - 1;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // normalize to 0..1
      const nx = x / maxX;
      const ny = y / maxY;

      // make a bump with some wiggles – purely decorative
      const radius = Math.hypot(nx - 0.5, ny - 0.5);
      const hill = Math.max(0, 1 - radius * 2); // cone-ish
      const waves =
        0.25 * Math.sin(nx * Math.PI * 4) * Math.cos(ny * Math.PI * 3);

      const z = hill + waves; // overall height

      points.push({ x, y, z });
    }
  }

  return points;
}

/**
 * Very simple isometric-ish projection: 3D (x, y, z) → 2D (x, y)
 */
export function projectIso(
  p: Point3D,
  options: ProjectionOptions
): Point2D {
  const { originX, originY, scaleXY, scaleZ, baseRotation = 0 } = options;

  // rotate base (x,y) around the vertical axis, if requested
  let bx = p.x;
  let by = p.y;

  if (baseRotation !== 0) {
    const cos = Math.cos(baseRotation);
    const sin = Math.sin(baseRotation);
    const rx = bx * cos - by * sin;
    const ry = bx * sin + by * cos;
    bx = rx;
    by = ry;
  }

  const sx = (bx - by) * scaleXY;
  const sy = (bx + by) * 0.5 * scaleXY - p.z * scaleZ;

  return {
    x: originX + sx,
    y: originY + sy,
  };
}

/**
 * Project an entire surface at once.
 */
export function projectSurface(
  points: Point3D[],
  options: ProjectionOptions
): Point2D[] {
  return points.map((p) => projectIso(p, options));
}

/**
 * Compute a projected floor polygon for a given grid and depth.
 */
export function floorPolygon(
  rows: number,
  cols: number,
  depthZ: number,
  options: ProjectionOptions
): Point2D[] {
  const floorCorners3D: Point3D[] = [
    { x: 0, y: 0, z: depthZ },
    { x: cols - 1, y: 0, z: depthZ },
    { x: cols - 1, y: rows - 1, z: depthZ },
    { x: 0, y: rows - 1, z: depthZ },
  ];

  return floorCorners3D.map((p) => projectIso(p, options));
}