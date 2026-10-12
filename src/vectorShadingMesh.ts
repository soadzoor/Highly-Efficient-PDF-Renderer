import { HEPR_GRADIENT_KIND, type HeprPageData } from "./heprDocumentData";
import { HeprFunctionEvaluator } from "./heprFunctionEvaluator";
import { HeprColorEvaluator } from "./heprColorEvaluator";
import { tessellateHeprPatchMesh } from "./heprPatchMeshTessellator";
import { PdfError } from "./pdf/nativeTypes";

export interface VectorShadingMesh {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
}
export interface VectorShadingOptions {
  readonly signal?: AbortSignal;
  readonly maxTriangles?: number;
  readonly maxDepth?: number;
  readonly colorTolerance?: number;
  /** Geometric error in shading coordinates for curved patch boundaries. */
  readonly flatness?: number;
}
export interface RetainedShadingDescription {
  readonly kind: number;
  readonly colorSpaceIndex: number;
  readonly componentCount: number;
  readonly functions: readonly number[];
  readonly coordinates: Float32Array;
  readonly bbox: readonly [number, number, number, number] | null;
  readonly background: readonly number[] | null;
  readonly flags: number;
}

export function readRetainedShading(page: HeprPageData, index: number): RetainedShadingDescription {
  const gradients = page.stores.gradients;
  if (!Number.isSafeInteger(index) || index < 0 || index >= gradients.kinds.length)
    throw new PdfError("invalid-object", "Invalid retained shading index.");
  const kind = gradients.kinds[index], colorSpaceIndex = gradients.colorSpaceIndices[index];
  const componentCount = page.stores.colors.componentCounts[colorSpaceIndex];
  const payload = gradients.coordinates.subarray(gradients.coordinateOffsets[index], gradients.coordinateOffsets[index + 1]);
  const base = kind === HEPR_GRADIENT_KIND.Axial ? 6 : kind === HEPR_GRADIENT_KIND.Radial ? 8 :
    kind === HEPR_GRADIENT_KIND.Function ? 10 : 0;
  const flags = gradients.extendFlags[index];
  let cursor = base;
  const functions = flags & 32 ? Array.from(payload.subarray(cursor, cursor += componentCount)) :
    gradients.functionIndices[index] >= 0 ? [gradients.functionIndices[index]] : [];
  const bbox = flags & 8 ? Array.from(payload.subarray(cursor, cursor += 4)) as [number, number, number, number] : null;
  const background = flags & 16 ? Array.from(payload.subarray(cursor, cursor += componentCount)) : null;
  if (cursor !== payload.length || !Number.isSafeInteger(componentCount) || componentCount < 1 ||
      !payload.every(Number.isFinite) || functions.some(value => !Number.isSafeInteger(value) || value < 0 || value >= page.stores.functions.kinds.length))
    throw new PdfError("invalid-object", "Malformed retained shading metadata.");
  return { kind, colorSpaceIndex, componentCount, coordinates: payload.subarray(0, base), functions, bbox, background, flags };
}

export function createRetainedShadingEvaluator(page: HeprPageData, signal?: AbortSignal) {
  const functions = new HeprFunctionEvaluator(page.stores.functions);
  const evaluate = (indices: readonly number[], inputs: readonly number[]): readonly number[] => {
    if (indices.length === 1) return Array.from(functions.evaluate(indices[0], inputs, { signal }));
    return indices.map(index => {
      const values = functions.evaluate(index, inputs, { signal });
      if (values.length !== 1) throw new PdfError("invalid-object", "A shading component function returned multiple values.");
      return values[0];
    });
  };
  const colors = new HeprColorEvaluator(page.stores.colors, evaluate, signal);
  return { evaluate, colors };
}

interface Vertex { x: number; y: number; inputs: readonly number[]; rgb: readonly number[] }

/** Adaptive vector approximation; source function/color conversion happens before RGB interpolation. */
export async function buildHeprVectorShadingMesh(page: HeprPageData, gradientIndex: number,
  options: VectorShadingOptions = {}): Promise<VectorShadingMesh> {
  const { signal } = options;
  // Match the patch tessellator's addressable index range. Resource ceilings
  // are caller-selected; valid complex meshes should use the available memory.
  const maximum = options.maxTriangles ?? 0xffff_ffff, maxDepth = options.maxDepth ?? Number.MAX_SAFE_INTEGER;
  const tolerance = options.colorTolerance ?? 1 / 255, flatness = options.flatness ?? .05;
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 0xffff_ffff ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 0 ||
      !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 1 || !Number.isFinite(flatness) || flatness <= 0)
    throw new RangeError("Invalid vector shading tessellation limits.");
  signal?.throwIfAborted();
  const description = readRetainedShading(page, gradientIndex), { evaluate, colors } = createRetainedShadingEvaluator(page, signal);
  const rgb = (inputs: readonly number[]): readonly number[] => colors.convert(description.colorSpaceIndex,
    description.functions.length ? evaluate(description.functions, inputs) : inputs, "vector-shading");
  const vertices: number[] = [], outputColors: number[] = [], indices: number[] = [], seen = new Map<string, number>();
  const queue: Array<{ vertices: readonly [Vertex, Vertex, Vertex]; depth: number }> = [];
  let lastYield = performance.now(), evaluations = 0;
  const vertex = (x: number, y: number, inputs: readonly number[]): Vertex => {
    if (++evaluations > maximum * 64) throw new PdfError("resource-limit", "Vector shading exceeds its function-evaluation budget.");
    return { x, y, inputs, rgb: rgb(inputs) };
  };
  const push = (a: Vertex, b: Vertex, c: Vertex, depth = 0): void => {
    if (queue.length + indices.length / 3 >= maximum) throw new PdfError("resource-limit", "Vector shading exceeds its triangle budget.");
    queue.push({ vertices: [a, b, c], depth });
  };
  const matrixPoint = (matrix: ArrayLike<number>, x: number, y: number): readonly [number, number] =>
    [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  if (description.kind === HEPR_GRADIENT_KIND.Function) {
    const d = description.coordinates, matrix = d.subarray(4, 10);
    if (!(d[0] < d[1] && d[2] < d[3])) throw new PdfError("invalid-object", "A function shading has an empty domain.");
    const at = (x: number, y: number) => vertex(...matrixPoint(matrix, x, y), [x, y]);
    const a = at(d[0], d[2]), b = at(d[1], d[2]), c = at(d[1], d[3]), d0 = at(d[0], d[3]);
    push(a, b, c); push(a, c, d0);
  } else if (description.kind === HEPR_GRADIENT_KIND.FreeFormMesh || description.kind === HEPR_GRADIENT_KIND.LatticeMesh) {
    const meshes = page.stores.meshes, mesh = page.stores.gradients.meshIndices[gradientIndex];
    const first = meshes.indexOffsets[mesh], end = meshes.indexOffsets[mesh + 1];
    if ((end - first) / 3 > maximum) throw new PdfError("resource-limit", "Source shading mesh exceeds its triangle budget.");
    const read = (index: number): Vertex => vertex(meshes.positions[index * 2], meshes.positions[index * 2 + 1],
      Array.from(meshes.colors.subarray(index * 4, index * 4 + (description.functions.length ? 1 : description.componentCount))));
    for (let i = first; i < end; i += 3) {
      push(read(meshes.indices[i]), read(meshes.indices[i + 1]), read(meshes.indices[i + 2]));
      if ((i & 255) === 0) signal?.throwIfAborted();
    }
  } else if (description.kind === HEPR_GRADIENT_KIND.CoonsPatchMesh || description.kind === HEPR_GRADIENT_KIND.TensorPatchMesh) {
    const mesh = tessellateHeprPatchMesh(page, gradientIndex, { flatness, componentFlatness: tolerance,
      maxTriangles: maximum, maxDepth, maxOutputBytes: maximum * 96, maxSubdivisionNodes: maximum * 4,
      maxFunctionEvaluations: maximum * 16, signal,
      evaluateFunction: (index, inputs) => evaluate([index], inputs) });
    for (let i = 0; i < mesh.positions.length / 2; i += 3) {
      const at = (v: number): Vertex => vertex(mesh.positions[v * 2], mesh.positions[v * 2 + 1],
        mesh.functionInputs.length ? [mesh.functionInputs[v]] :
          Array.from(mesh.components.subarray(v * mesh.componentCount, (v + 1) * mesh.componentCount)));
      push(at(i), at(i + 1), at(i + 2));
    }
  } else throw new PdfError("unsupported-content", "An analytic shading does not need mesh tessellation.");

  queue.reverse();
  while (queue.length) {
    signal?.throwIfAborted();
    if (performance.now() - lastYield > 8) { await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
    const { vertices: [a, b, c], depth } = queue.pop()!;
    const mid = (p: Vertex, q: Vertex): Vertex => vertex((p.x + q.x) / 2, (p.y + q.y) / 2,
      p.inputs.map((value, i) => (value + q.inputs[i]) / 2));
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    const center = vertex((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3,
      a.inputs.map((value, i) => (value + b.inputs[i] + c.inputs[i]) / 3));
    const error = Math.max(...ab.rgb.map((v, i) => Math.abs(v - (a.rgb[i] + b.rgb[i]) / 2)),
      ...bc.rgb.map((v, i) => Math.abs(v - (b.rgb[i] + c.rgb[i]) / 2)),
      ...ca.rgb.map((v, i) => Math.abs(v - (c.rgb[i] + a.rgb[i]) / 2)),
      ...center.rgb.map((v, i) => Math.abs(v - (a.rgb[i] + b.rgb[i] + c.rgb[i]) / 3)));
    // Opaque PDF functions need interior sampling even when endpoint colors coincide.
    const minDepth = description.functions.length ? Math.min(3, maxDepth) : 0;
    if (depth < minDepth || error > tolerance) {
      if (depth >= maxDepth) throw new PdfError("resource-limit", "Vector shading color tolerance exceeds its subdivision-depth budget.");
      const same = (p: Vertex, q: Vertex): boolean => p.x === q.x && p.y === q.y &&
        p.inputs.every((value, i) => value === q.inputs[i]);
      // Stop when floating-point midpoints can no longer refine this surface.
      // Otherwise a discontinuous function could keep generating identical
      // triangles after the caller leaves subdivision depth unrestricted.
      if ((same(ab, a) || same(ab, b)) && (same(bc, b) || same(bc, c)) && (same(ca, c) || same(ca, a))) {
        throw new PdfError("unsupported-content", "Vector shading color tolerance exceeds numeric subdivision precision.");
      }
      push(a, ab, ca, depth + 1); push(ab, b, bc, depth + 1);
      push(ca, bc, c, depth + 1); push(ab, bc, ca, depth + 1);
      continue;
    }
    // Ignore a degenerate surface; retaining a zero-area triangle has no visible benefit.
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-15) continue;
    for (const v of [a, b, c]) {
      const values = [v.x, v.y, ...v.rgb, 1].map(Math.fround);
      if (!values.every(Number.isFinite)) throw new PdfError("unsupported-content", "Shading tessellation exceeds finite GPU coordinates.");
      const key = values.join(",");
      let index = seen.get(key);
      if (index === undefined) { index = vertices.length / 2; seen.set(key, index); vertices.push(values[0], values[1]); outputColors.push(...values.slice(2)); }
      indices.push(index);
    }
  }
  return { positions: Float32Array.from(vertices), colors: Float32Array.from(outputColors), indices: Uint32Array.from(indices) };
}
