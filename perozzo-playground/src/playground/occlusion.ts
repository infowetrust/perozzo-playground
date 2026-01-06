import type { Point2D, Point3D } from "../core/types";

export type DepthBuffer = {
  gridW: number;
  gridH: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  data: Float32Array;
};

export type OcclusionConfig = {
  enabled: boolean;
  gridW: number;
  gridH: number;
  epsilon: number;
  mode: "dim" | "hide";
  dimFactor: number;
};

export function pointDepth3D(p: Point3D): number {
  return p.x + p.y + p.z;
}

export function buildDepthBuffer(
  projectedSurface: Point2D[],
  surfacePoints: Point3D[],
  gridW: number,
  gridH: number
): DepthBuffer {
  const minX = Math.min(...projectedSurface.map((p) => p.x));
  const maxX = Math.max(...projectedSurface.map((p) => p.x));
  const minY = Math.min(...projectedSurface.map((p) => p.y));
  const maxY = Math.max(...projectedSurface.map((p) => p.y));

  const data = new Float32Array(gridW * gridH).fill(-Infinity);

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const clampIndex = (value: number, max: number) =>
    Math.max(0, Math.min(max, value));

  for (let i = 0; i < projectedSurface.length; i++) {
    const p2d = projectedSurface[i];
    const p3d = surfacePoints[i];
    if (!p2d || !p3d) continue;
    const depth = pointDepth3D(p3d);
    const gx = clampIndex(
      Math.round(((p2d.x - minX) / spanX) * (gridW - 1)),
      gridW - 1
    );
    const gy = clampIndex(
      Math.round(((p2d.y - minY) / spanY) * (gridH - 1)),
      gridH - 1
    );
    const idx = gy * gridW + gx;
    data[idx] = Math.max(data[idx], depth);
  }

  const dilate = () => {
    const copy = data.slice();
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        let maxVal = -Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || ny >= gridH || nx < 0 || nx >= gridW) continue;
            const nIdx = ny * gridW + nx;
            if (copy[nIdx] > maxVal) maxVal = copy[nIdx];
          }
        }
        const idx = y * gridW + x;
        if (maxVal > data[idx]) {
          data[idx] = maxVal;
        }
      }
    }
  };

  dilate();
  dilate();

  return {
    gridW,
    gridH,
    minX,
    minY,
    maxX,
    maxY,
    data,
  };
}

export function sampleDepth(
  db: DepthBuffer,
  x: number,
  y: number
): number {
  const spanX = db.maxX - db.minX || 1;
  const spanY = db.maxY - db.minY || 1;
  const gx = Math.max(
    0,
    Math.min(
      db.gridW - 1,
      Math.round(((x - db.minX) / spanX) * (db.gridW - 1))
    )
  );
  const gy = Math.max(
    0,
    Math.min(
      db.gridH - 1,
      Math.round(((y - db.minY) / spanY) * (db.gridH - 1))
    )
  );
  return db.data[gy * db.gridW + gx] ?? -Infinity;
}

export function occlusionFactor(
  db: DepthBuffer | null,
  x: number,
  y: number,
  depth: number,
  cfg: OcclusionConfig
): number {
  if (!cfg.enabled || !db) return 1;
  const surfaceDepth = sampleDepth(db, x, y);
  if (!Number.isFinite(surfaceDepth)) return 1;
  if (depth < surfaceDepth - cfg.epsilon) {
    return cfg.mode === "hide" ? 0 : cfg.dimFactor;
  }
  return 1;
}
