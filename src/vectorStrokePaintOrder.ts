import type { VectorScene } from "./pdfVectorExtractor";

// Runtime metadata only: never serialized into a PDF/HEP scene.
const origins = new WeakMap<VectorScene, Uint32Array>();
const groups = new WeakMap<VectorScene, Uint32Array>();

export function strokePaintOrigins(scene: VectorScene): Uint32Array | undefined {
  if (!scene.drawRuns) return origins.get(scene);
  let result = origins.get(scene);
  if (!result) {
    result = new Uint32Array(scene.segmentCount);
    for (let index = 0; index < result.length; index++) result[index] = index;
    origins.set(scene, result);
  }
  return result;
}

export function setStrokePaintOrigins(scene: VectorScene, values?: Uint32Array): void {
  if (values) origins.set(scene, values);
}

/**
 * Explicit paint origins only. A scene with draw runs and none is canonical:
 * each stroke is its own origin, which needs no identity table.
 */
export function explicitStrokePaintOrigins(scene: VectorScene): Uint32Array | undefined {
  return origins.get(scene);
}

/** Whether strokes carry paint origins, explicit or implied by draw runs. */
export function hasStrokePaintOrigins(scene: VectorScene): boolean {
  return origins.has(scene) || scene.drawRuns !== undefined;
}

/** Paint origin of one stroke, without allocating an identity table. */
export function strokePaintOrigin(scene: VectorScene, index: number): number | undefined {
  const explicit = origins.get(scene);
  return explicit ? explicit[index] : scene.drawRuns ? index : undefined;
}

/** Paint groups are only needed while simplifying; recompute them on demand. */
export function releaseStrokePaintGroups(scene: VectorScene): void {
  groups.delete(scene);
}

/** Merge only within one paint operation, clip, and consecutive opaque color. */
export function strokePaintGroups(scene: VectorScene): Uint32Array | undefined {
  if (!scene.drawRuns) return undefined;
  let result = groups.get(scene);
  if (result) return result;
  result = new Uint32Array(scene.segmentCount);
  for (const run of scene.drawRuns) {
    if (run.kind !== "stroke") continue;
    let group = run.first;
    for (let index = run.first; index < run.first + run.count; index++) {
      const offset = index * 4;
      const packed = scene.primitiveMeta[offset + 3];
      const alpha = packed - Math.floor(packed / 2 + 1e-6) * 2;
      if (index > run.first && (alpha < 0.999 || packed !== scene.primitiveMeta[offset - 1] ||
          scene.styles[offset + 1] !== scene.styles[offset - 3] ||
          scene.styles[offset + 2] !== scene.styles[offset - 2] ||
          scene.styles[offset + 3] !== scene.styles[offset - 1])) group = index;
      result[index] = group;
    }
  }
  groups.set(scene, result);
  return result;
}
