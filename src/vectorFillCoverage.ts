import type { VectorScene } from "./pdfVectorExtractor";

/** Renderer-only metadata; the scene's canonical/exported stores stay unchanged. */
export interface VectorFillCoverageMetadata {
  readonly pathMetaA: Float32Array;
  readonly pathMetaB: Float32Array;
  readonly pathMetaC: Float32Array;
}

interface FillGeometryMetadata {
  readonly segmentsA: Float32Array;
  readonly segmentsB: Float32Array;
  readonly pathCount: number;
  readonly segmentCount: number;
  readonly pathMetaA: Float32Array;
  readonly upperBounds: Float32Array;
  readonly areas: Float32Array;
  /** Bit 0: finite decoded hull; bit 1: usable area; bit 2: open contour. */
  readonly flags: Uint8Array;
}

interface FillMetadataCache {
  readonly sourceB: Float32Array;
  readonly sourceC: Float32Array;
  readonly geometry: FillGeometryMetadata;
  readonly result: VectorFillCoverageMetadata;
}

const geometries = new WeakMap<Float32Array, FillGeometryMetadata>();
const metadata = new WeakMap<Float32Array, FillMetadataCache>();
const floatBits = new Float32Array(1);
const uintBits = new Uint32Array(floatBits.buffer);

/** Round toward the outside, including when a future decoded store uses doubles. */
function outwardFloat32(value: number, lower: boolean): number {
  const rounded = Math.fround(value);
  if (lower ? rounded <= value : rounded >= value) return rounded;
  if (rounded === 0) return lower ? -(2 ** -149) : 2 ** -149;
  floatBits[0] = rounded;
  uintBits[0] += (rounded > 0) === lower ? -1 : 1;
  return floatBits[0];
}

function buildGeometry(scene: VectorScene): FillGeometryMetadata {
  const sourceA = scene.fillPathMetaA;
  const segmentsA = scene.fillSegmentsA, segmentsB = scene.fillSegmentsB;
  const pathCount = scene.fillPathCount, segmentCount = scene.fillSegmentCount;
  const pathMetaA = sourceA.slice();
  const upperBounds = new Float32Array(pathCount * 2);
  const areas = new Float32Array(pathCount);
  const flags = new Uint8Array(pathCount);

  for (let path = 0; path < pathCount; path++) {
    const offset = path * 4;
    const first = sourceA[offset], count = sourceA[offset + 1], end = first + count;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || first < 0 || count <= 0 ||
        end > segmentCount || end * 4 > segmentsA.length || end * 4 > segmentsB.length) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let contourX = 0, contourY = 0, previousX = 0, previousY = 0;
    let finite = true, closed = true;
    for (let segment = first; segment < end; segment++) {
      const i = segment * 4;
      const x0 = segmentsA[i], y0 = segmentsA[i + 1];
      const x2 = segmentsB[i], y2 = segmentsB[i + 1], curve = segmentsB[i + 2];
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x2) ||
          !Number.isFinite(y2) || !Number.isFinite(curve)) { finite = false; break; }
      if (segment === first || x0 !== previousX || y0 !== previousY) {
        // Disconnected contours are allowed, but each must close before the next starts.
        if (segment !== first && (previousX !== contourX || previousY !== contourY)) closed = false;
        contourX = x0; contourY = y0;
      }
      previousX = x2; previousY = y2;
      minX = Math.min(minX, x0, x2); minY = Math.min(minY, y0, y2);
      maxX = Math.max(maxX, x0, x2); maxY = Math.max(maxY, y0, y2);
      if (curve >= 1) {
        const x1 = segmentsA[i + 2], y1 = segmentsA[i + 3];
        if (!Number.isFinite(x1) || !Number.isFinite(y1)) { finite = false; break; }
        minX = Math.min(minX, x1); minY = Math.min(minY, y1);
        maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
      }
    }
    if (!finite) continue;
    const open = !closed || previousX !== contourX || previousY !== contourY;
    // Open winding can reach left of its hull. Preserve the old drawing domain
    // as well as any newly decoded reach, without enabling the area shortcut.
    pathMetaA[offset + 2] = outwardFloat32(open ? Math.min(minX, sourceA[offset + 2]) : minX, true);
    pathMetaA[offset + 3] = outwardFloat32(open ? Math.min(minY, sourceA[offset + 3]) : minY, true);
    upperBounds[path * 2] = outwardFloat32(maxX, false);
    upperBounds[path * 2 + 1] = outwardFloat32(maxY, false);
    flags[path] = open ? 5 : 1;
    if (open) continue;

    // Green's integral, in double precision relative to the hull's lower corner.
    // Subtracting the origin before the products avoids cancellation from large
    // page coordinates. Compensated summation also preserves small holes/loops.
    let area = 0, correction = 0;
    for (let segment = first; segment < end; segment++) {
      const i = segment * 4;
      const x0 = segmentsA[i] - minX, y0 = segmentsA[i + 1] - minY;
      const x2 = segmentsB[i] - minX, y2 = segmentsB[i + 1] - minY;
      let contribution = (x0 * y2 - y0 * x2) / 2;
      if (segmentsB[i + 2] >= 1) {
        const x1 = segmentsA[i + 2] - minX, y1 = segmentsA[i + 3] - minY;
        contribution = (x0 * y1 - y0 * x1) / 3 +
          (x1 * y2 - y1 * x2) / 3 + (x0 * y2 - y0 * x2) / 6;
      }
      const next = area + contribution;
      correction += Math.abs(area) >= Math.abs(contribution)
        ? (area - next) + contribution : (contribution - next) + area;
      area = next;
    }
    area += correction;
    const stored = Math.fround(area);
    // An overflowing or underflowed integral cannot safely stand in for the loop.
    if (!Number.isFinite(stored) || (stored === 0 && area !== 0)) continue;
    areas[path] = stored;
    flags[path] = 3;
  }
  return { segmentsA, segmentsB, pathCount, segmentCount, pathMetaA, upperBounds, areas, flags };
}

/**
 * Conservative decoded control hulls and whole-path winding integrals for fill
 * shaders. A.zw/B.xy hold the hull, C.y the signed integral. C.x retains the
 * original 0/1 fill rule when that integral is usable; otherwise it is
 * `-(rule + 1)` and C.y is zero. Decode the rule with `x < 0 ? -x - 1 : x`.
 * An open path keeps the union of its original bounds and finite decoded hull,
 * while invalid geometry retains its original bounds. Only a hull no larger
 * than a pixel footprint may use the integral instead of evaluating the
 * individual segments (see heprHullAreaWinding).
 *
 * Cached by source array identities and counts. Scene stores are immutable:
 * replace an array when changing geometry or colors. Geometry is cached apart
 * from colors so recoloring does not repeat the segment scan.
 */
export function vectorFillCoverageMetadata(scene: VectorScene): VectorFillCoverageMetadata {
  const sourceA = scene.fillPathMetaA, sourceB = scene.fillPathMetaB, sourceC = scene.fillPathMetaC;
  let geometry = geometries.get(sourceA);
  if (!geometry || geometry.segmentsA !== scene.fillSegmentsA || geometry.segmentsB !== scene.fillSegmentsB ||
      geometry.pathCount !== scene.fillPathCount || geometry.segmentCount !== scene.fillSegmentCount) {
    geometry = buildGeometry(scene);
    geometries.set(sourceA, geometry);
  }
  const cached = metadata.get(sourceA);
  if (cached?.sourceB === sourceB && cached.sourceC === sourceC && cached.geometry === geometry) return cached.result;

  const pathMetaB = sourceB.slice(), pathMetaC = sourceC.slice();
  for (let path = 0; path < scene.fillPathCount; path++) {
    const offset = path * 4;
    if (geometry.flags[path] & 1) {
      const open = (geometry.flags[path] & 4) !== 0;
      pathMetaB[offset] = open ? Math.max(sourceB[offset], geometry.upperBounds[path * 2]) : geometry.upperBounds[path * 2];
      pathMetaB[offset + 1] = open ? Math.max(sourceB[offset + 1], geometry.upperBounds[path * 2 + 1]) : geometry.upperBounds[path * 2 + 1];
    }
    const rule = sourceC[offset];
    const eligible = geometry.flags[path] === 3 && (rule === 0 || rule === 1);
    pathMetaC[offset] = eligible ? rule : -(rule >= 0.5 ? 2 : 1);
    pathMetaC[offset + 1] = eligible ? geometry.areas[path] : 0;
  }
  const result = { pathMetaA: geometry.pathMetaA, pathMetaB, pathMetaC };
  metadata.set(sourceA, { sourceB, sourceC, geometry, result });
  return result;
}
