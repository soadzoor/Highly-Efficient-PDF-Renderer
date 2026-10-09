import type { VectorScene } from "./pdfVectorExtractor";
import { HepArchive } from "./hepContainer";

interface PointRecipe {
  /** Zero stores two residuals; otherwise zigzag(source point - predicted point) + 1. */
  references: Uint32Array;
  residuals: Uint32Array;
}
export interface VectorLodPointRecipes {
  version: 1;
  start: PointRecipe;
  end: PointRecipe;
}
export interface PointRecipeData {
  literals: { segmentCount: number; endpoints: Uint32Array; primitiveMeta: Uint32Array };
  origins?: Uint32Array;
  positionQuantum?: number;
  positionQuanta?: Float32Array;
  pointRecipes?: VectorLodPointRecipes;
}
type PointSource = Pick<VectorScene, "segmentCount" | "endpoints" | "primitiveMeta">;
const asWords = (array: Float32Array): Uint32Array => new Uint32Array(array.buffer, array.byteOffset, array.length);

/** Canonical start/end points are shared by all derived levels. No hierarchy is rebuilt. */
export async function encodeVectorLodPointRecipes<T extends PointRecipeData>(
  scene: PointSource, data: T, signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  if (data.pointRecipes || !data.origins || data.literals.segmentCount === 0) return data;
  validate(data, scene, false);
  const count = data.literals.segmentCount;
  const references = [new Uint32Array(count), new Uint32Array(count)];
  const canonical = [asWords(scene.endpoints), asWords(scene.primitiveMeta)];
  const compact = data.positionQuanta !== undefined || data.positionQuantum !== undefined;
  let lastYield = performance.now();
  const yieldIfNeeded = async (): Promise<void> => {
    signal?.throwIfAborted();
    if (performance.now() - lastYield < 50) return;
    await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
    signal?.throwIfAborted();
    lastYield = performance.now();
  };
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const q = compact ? quantum(data, i) : 0;
    const records = groups.get(q);
    if (records) records.push(i); else groups.set(q, [i]);
  }
  // Hold only one grid's point table at a time. A file can have many different grids.
  for (const [q, records] of groups) {
    signal?.throwIfAborted();
    const points = new Map<string, number | number[]>();
    for (let i = 0; i < scene.segmentCount; i++) {
      if ((i & 4095) === 0) await yieldIfNeeded();
      for (let kind = 0; kind < 2; kind++) {
        const source = kind === 0 ? scene.endpoints : scene.primitiveMeta, at = i * 4;
        const x = compact ? Math.round(source[at] / q) | 0 : canonical[kind][at];
        const y = compact ? Math.round(source[at + 1] / q) | 0 : canonical[kind][at + 1];
        const key = `${x},${y}`, id = i * 2 + kind, previous = points.get(key);
        if (previous === undefined) points.set(key, id);
        else if (typeof previous === "number") points.set(key, [previous, id]);
        else previous.push(id);
      }
    }
    for (const i of records) {
      if ((i & 4095) === 0) await yieldIfNeeded();
      for (let kind = 0; kind < 2; kind++) {
        const field = kind === 0 ? "endpoints" : "primitiveMeta", origin = data.origins[i], at = origin * 4;
        const source = kind === 0 ? scene.endpoints : scene.primitiveMeta;
        const px = compact ? Math.round(source[at] / q) | 0 : canonical[kind][at];
        const py = compact ? Math.round(source[at + 1] / q) | 0 : canonical[kind][at + 1];
        const x = compact ? (data.literals[field][i] + px) | 0 : (data.literals[field][i] ^ px) >>> 0;
        const y = compact ? (data.literals[field][count + i] + py) | 0 : (data.literals[field][count + i] ^ py) >>> 0;
        const predicted = origin * 2 + kind;
        const matches = points.get(`${x},${y}`);
        if (matches === undefined) continue;
        const id = x === px && y === py ? predicted : closestPoint(matches, predicted);
        const delta = id - predicted;
        const code = delta >= 0 ? delta * 2 + 1 : -delta * 2;
        if (Number.isSafeInteger(code) && code <= 0xffffffff) references[kind][i] = code;
      }
    }
  }
  const recipes = references.map((refs, kind): PointRecipe => {
    let literals = 0;
    for (const ref of refs) if (ref === 0) literals++;
    const residuals = new Uint32Array(literals * 2), field = kind === 0 ? "endpoints" : "primitiveMeta";
    let cursor = 0;
    for (let i = 0; i < count; i++) if (refs[i] === 0) {
      residuals[cursor] = data.literals[field][i];
      residuals[literals + cursor++] = data.literals[field][count + i];
    }
    return { references: refs, residuals };
  });
  const candidate: T = { ...data, literals: { ...data.literals,
    endpoints: data.literals.endpoints.slice(count * 2), primitiveMeta: data.literals.primitiveMeta.slice(count * 2) },
    pointRecipes: { version: 1, start: recipes[0], end: recipes[1] } };
  const before = await pointRecipeStorageBytes(data, signal);
  const after = await pointRecipeStorageBytes(candidate, signal);
  return after < before ? candidate : data;
}

/** Expand original packed residuals, before the existing Float32 decoder runs. */
export function decodeVectorLodPointRecipes<T extends PointRecipeData>(scene: PointSource, data: T): T {
  if (data.pointRecipes === undefined) return data;
  validate(data, scene, true);
  const count = data.literals.segmentCount, compact = data.positionQuanta !== undefined || data.positionQuantum !== undefined;
  const canonical = [asWords(scene.endpoints), asWords(scene.primitiveMeta)];
  const arrays: Uint32Array[] = [];
  for (let kind = 0; kind < 2; kind++) {
    const field = kind === 0 ? "endpoints" : "primitiveMeta";
    const recipe = kind === 0 ? data.pointRecipes.start : data.pointRecipes.end;
    const residualCount = recipe.residuals.length / 2, output = new Uint32Array(count * 4);
    output.set(data.literals[field], count * 2);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      const code = recipe.references[i];
      if (code === 0) {
        output[i] = recipe.residuals[cursor]; output[count + i] = recipe.residuals[residualCount + cursor++];
        continue;
      }
      const encoded = code - 1, delta = encoded % 2 ? -(encoded + 1) / 2 : encoded / 2;
      const id = data.origins![i] * 2 + kind + delta;
      const source = id % 2 === 0 ? scene.endpoints : scene.primitiveMeta, at = Math.floor(id / 2) * 4;
      const predicted = kind === 0 ? scene.endpoints : scene.primitiveMeta, origin = data.origins![i] * 4;
      for (let c = 0; c < 2; c++) output[c * count + i] = compact
        ? ((Math.round(source[at + c] / quantum(data, i)) | 0) -
          (Math.round(predicted[origin + c] / quantum(data, i)) | 0)) >>> 0
        : canonical[id % 2][at + c] ^ canonical[kind][origin + c];
    }
    arrays.push(output);
  }
  const { pointRecipes: _recipes, ...rest } = data;
  return { ...rest, literals: { ...data.literals, endpoints: arrays[0], primitiveMeta: arrays[1] } } as T;
}

/** Compare actual container compression, descriptors, section records and padding. */
export async function pointRecipeStorageBytes(data: PointRecipeData, signal?: AbortSignal): Promise<number> {
  const archive = new HepArchive();
  let next = 0;
  const json = JSON.stringify(data, (_key, value: unknown) => {
    if (!(value instanceof Uint32Array || value instanceof Float32Array || value instanceof Float64Array)) return value;
    signal?.throwIfAborted();
    const file = `lod-vector/${next++}.bin`, width = value.BYTES_PER_ELEMENT;
    const bytes = new Uint8Array(value.byteLength), word = new DataView(new ArrayBuffer(width));
    for (let i = 0; i < value.length; i++) {
      if ((i & 4095) === 0) signal?.throwIfAborted();
      if (value instanceof Float64Array) word.setFloat64(0, value[i], true);
      else if (value instanceof Float32Array) word.setFloat32(0, value[i], true);
      else word.setUint32(0, value[i], true);
      for (let byte = 0; byte < width; byte++) bytes[byte * value.length + i] = word.getUint8(byte);
    }
    archive.file(file, bytes);
    return { array: value instanceof Float64Array ? "f64" : value instanceof Float32Array ? "f32" : "u32", file, length: value.length };
  });
  archive.file("lod-vector/index.json", json);
  const result = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE", signal });
  return result.byteLength;
}

function closestPoint(points: number | number[], predicted: number): number {
  if (typeof points === "number") return points;
  let lo = 0, hi = points.length;
  while (lo < hi) { const middle = (lo + hi) >>> 1; if (points[middle] < predicted) lo = middle + 1; else hi = middle; }
  if (lo === 0) return points[0];
  if (lo === points.length) return points[lo - 1];
  return predicted - points[lo - 1] <= points[lo] - predicted ? points[lo - 1] : points[lo];
}
function quantum(data: PointRecipeData, i: number): number { return data.positionQuanta?.[i] ?? data.positionQuantum!; }
function validate(data: PointRecipeData, scene: PointSource, recipes: boolean): void {
  const count = data?.literals?.segmentCount;
  check(Number.isSafeInteger(count) && count >= 0 && count <= 0x3fffffff);
  check(Number.isSafeInteger(scene.segmentCount) && scene.segmentCount > 0 && scene.segmentCount <= 0x3fffffff);
  check(scene.endpoints instanceof Float32Array && scene.endpoints.length >= scene.segmentCount * 4 &&
    scene.primitiveMeta instanceof Float32Array && scene.primitiveMeta.length >= scene.segmentCount * 4);
  check(data.origins instanceof Uint32Array && data.origins.length === count && data.origins.every(id => id < scene.segmentCount));
  check(data.positionQuantum === undefined || data.positionQuantum === 1 / 512);
  if (data.positionQuanta !== undefined) check(data.positionQuantum === undefined && data.positionQuanta instanceof Float32Array &&
    data.positionQuanta.length === count && data.positionQuanta.every(q => Number.isFinite(q) && q > 0 && Number.isInteger(Math.log2(q))));
  for (const field of ["endpoints", "primitiveMeta"] as const) check(data.literals[field] instanceof Uint32Array && data.literals[field].length === count * (recipes ? 2 : 4));
  if (recipes) {
    check(data.pointRecipes?.version === 1);
    for (const [kind, recipe] of [data.pointRecipes.start, data.pointRecipes.end].entries()) {
      check(recipe && recipe.references instanceof Uint32Array && recipe.references.length === count && recipe.residuals instanceof Uint32Array);
      let literals = 0;
      for (let i = 0; i < count; i++) {
        const ref = recipe.references[i];
        if (ref === 0) { literals++; continue; }
        const encoded = ref - 1, delta = encoded % 2 ? -(encoded + 1) / 2 : encoded / 2;
        const id = data.origins[i] * 2 + kind + delta;
        check(Number.isSafeInteger(id) && id >= 0 && id < scene.segmentCount * 2);
      }
      check(recipe.residuals.length === literals * 2);
    }
  }
}
function check(condition: unknown): asserts condition { if (!condition) throw new Error("invalid vector LOD point recipe"); }
