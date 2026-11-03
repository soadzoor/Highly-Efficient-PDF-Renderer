import type { EditorColor, EditorSourceEdit } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { normalizePrimitiveColor } from "./colorInput";
import { retainEditorPaintIdentity } from "./editorPaintIdentity";
import { getPrimitiveVisibilityConditions, validatePrimitiveRef, type PrimitiveRef } from "./scenePrimitives";

type Rgb = [number, number, number];
const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;
const gradientIndex = (scene: VectorScene, ref: PrimitiveRef): number => ref.kind === "gradient-fill"
  ? scene.gradientFillPaintMeta[ref.index * 4] : ref.kind === "gradient-stroke" ? scene.gradientStrokeRunMetaA[ref.index * 4 + 2] : -1;
const fill = (ref: PrimitiveRef): boolean => ref.kind === "fill" || ref.kind === "gradient-fill";

/** Current source RGB values; unsupported images and mask-only paint have no color controls. */
export function editorSourcePaintColors(scene: VectorScene, refs: readonly PrimitiveRef[], edits: readonly EditorSourceEdit[] = []): {
  color: EditorColor[];
  fill: EditorColor[];
} {
  const overrides = new Map(edits.map(edit => [key(edit.ref), edit])), color = new Map<string, Rgb>(), fills = new Map<string, Rgb>();
  const add = (ref: PrimitiveRef, rgb: Rgb): void => { const value = rgb.join(","); color.set(value, rgb); if (fill(ref)) fills.set(value, rgb); };
  for (const ref of refs) {
    validatePrimitiveRef(scene, ref);
    const edit = overrides.get(key(ref));
    if (ref.kind === "raster" || edit?.deleted || getPrimitiveVisibilityConditions(scene, ref) === null) continue;
    if (edit?.color !== undefined) { add(ref, normalizePrimitiveColor(edit.color)); continue; }
    const i = ref.index * 4, gradient = gradientIndex(scene, ref);
    if (gradient >= 0) {
      const mesh = scene.gradientMetaA[gradient * 4] === 2, stride = scene.gradientCount ? scene.gradientLut.length / scene.gradientCount : 0;
      if (!mesh) for (let offset = gradient * stride; offset < (gradient + 1) * stride; offset += 4)
        add(ref, [scene.gradientLut[offset] / 255, scene.gradientLut[offset + 1] / 255, scene.gradientLut[offset + 2] / 255]);
      const encoded = scene.gradientMetaA[gradient * 4 + 3];
      if (encoded > 0) { const packed = Math.round(encoded) - 1; add(ref, [(packed >>> 16) / 255, ((packed >>> 8) & 255) / 255, (packed & 255) / 255]); }
      if (mesh && scene.gradientMeshRanges && scene.gradientMeshIndices && scene.gradientMeshColors) {
        const first = scene.gradientMeshRanges[gradient * 2], count = scene.gradientMeshRanges[gradient * 2 + 1];
        for (let offset = first; offset < first + count; offset++) {
          const vertex = scene.gradientMeshIndices[offset] * 4;
          add(ref, [scene.gradientMeshColors[vertex], scene.gradientMeshColors[vertex + 1], scene.gradientMeshColors[vertex + 2]]);
        }
      }
    } else if (ref.kind === "stroke" || ref.kind === "gradient-stroke") {
      const first = ref.kind === "stroke" ? ref.index : scene.gradientStrokeRunMetaA[i], count = ref.kind === "stroke" ? 1 : scene.gradientStrokeRunMetaA[i + 1];
      const styles = ref.kind === "stroke" ? scene.styles : scene.gradientStrokeStyles;
      for (let segment = first; segment < first + count; segment++) add(ref, [styles[segment * 4 + 1], styles[segment * 4 + 2], styles[segment * 4 + 3]]);
    } else if (fill(ref)) {
      const b = ref.kind === "fill" ? scene.fillPathMetaB : scene.gradientFillPathMetaB, c = ref.kind === "fill" ? scene.fillPathMetaC : scene.gradientFillPathMetaC;
      add(ref, [b[i + 2], b[i + 3], c[i + 2]]);
    } else if (ref.kind === "text") add(ref, [scene.textInstanceC[i], scene.textInstanceC[i + 1], scene.textInstanceC[i + 2]]);
  }
  return { color: [...color.values()], fill: [...fills.values()] };
}

/** Replace RGB only, retaining geometry, alpha, masks, clips and resource sharing outside the edited paint. */
export function applyEditorSourceColors(source: VectorScene, edits: readonly EditorSourceEdit[]): VectorScene {
  const changes = new Map<string, { ref: PrimitiveRef; rgb: Rgb }>();
  for (const edit of edits) {
    if (edit.color === undefined || edit.deleted) continue;
    validatePrimitiveRef(source, edit.ref);
    if (edit.ref.kind === "raster") throw new TypeError("Raster image pixels do not support a source paint color.");
    if (getPrimitiveVisibilityConditions(source, edit.ref) === null) throw new TypeError("Mask-only or statically hidden paint cannot be recolored independently.");
    changes.set(key(edit.ref), { ref: edit.ref, rgb: normalizePrimitiveColor(edit.color) });
  }
  if (!changes.size) return source;
  const scene: VectorScene = { ...source }, detached = new Set<keyof VectorScene>();
  const writable = (key: keyof VectorScene): Float32Array => {
    if (!detached.has(key)) { (scene as unknown as Record<string, unknown>)[key] = (scene[key] as Float32Array).slice(); detached.add(key); }
    return scene[key] as Float32Array;
  };
  type PaintArray = Float32Array | Uint8Array | Uint32Array;
  const appended = new Map<keyof VectorScene, { parts: PaintArray[]; length: number; type: "float" | "byte" | "uint" }>();
  const append = (key: keyof VectorScene, values: PaintArray, type: "float" | "byte" | "uint" = "float"): void => {
    let pending = appended.get(key); if (!pending) appended.set(key, pending = { parts: [], length: 0, type });
    pending.parts.push(values); pending.length += values.length;
  };
  const copiedGradients = new Map<string, number>();
  let vertexCount = (source.gradientMeshPositions?.length ?? 0) / 2, indexCount = source.gradientMeshIndices?.length ?? 0;
  const gradient = (index: number, rgb: Rgb): number => {
    if (index < 0) return -1;
    const identity = `${index}/${rgb.join(",")}`, previous = copiedGradients.get(identity); if (previous !== undefined) return previous;
    const offset = index * 4, next = scene.gradientCount++, packed = (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255);
    for (const key of ["gradientMetaA", "gradientMetaB", "gradientMetaC", "gradientMetaD", "gradientMetaE"] as const) {
      const values = source[key].slice(offset, offset + 4); if (key === "gradientMetaA" && values[3] > 0) values[3] = packed + 1; append(key, values);
    }
    const stride = source.gradientLut.length / source.gradientCount, lut = source.gradientLut.slice(index * stride, (index + 1) * stride);
    for (let offset = 0; offset < lut.length; offset += 4) lut.set(rgb.map(value => Math.round(value * 255)), offset);
    append("gradientLut", lut, "byte");
    if (source.gradientMeshRanges) {
      const first = source.gradientMeshRanges[index * 2], count = source.gradientMeshRanges[index * 2 + 1];
      if (source.gradientMetaA[offset] === 2 && count) {
        if (!source.gradientMeshIndices || !source.gradientMeshPositions || !source.gradientMeshColors) throw new TypeError("A mesh gradient requires its retained vertex resources.");
        const vertices = new Map<number, number>(), positions: number[] = [], colors: number[] = [], indices: number[] = [];
        for (let i = first; i < first + count; i++) {
          const old = source.gradientMeshIndices[i]; let vertex = vertices.get(old);
          if (vertex === undefined) { vertex = vertexCount++; vertices.set(old, vertex); positions.push(...source.gradientMeshPositions.subarray(old * 2, old * 2 + 2)); colors.push(...rgb, source.gradientMeshColors[old * 4 + 3]); }
          indices.push(vertex);
        }
        append("gradientMeshRanges", Uint32Array.of(indexCount, count), "uint"); indexCount += count;
        append("gradientMeshPositions", Float32Array.from(positions)); append("gradientMeshColors", Float32Array.from(colors)); append("gradientMeshIndices", Uint32Array.from(indices), "uint");
      } else append("gradientMeshRanges", source.gradientMeshRanges.slice(index * 2, index * 2 + 2), "uint");
    }
    copiedGradients.set(identity, next); return next;
  };
  for (const { ref, rgb } of changes.values()) {
    const i = ref.index * 4;
    if (ref.kind === "stroke" || ref.kind === "gradient-stroke") {
      const first = ref.kind === "stroke" ? ref.index : source.gradientStrokeRunMetaA[i], count = ref.kind === "stroke" ? 1 : source.gradientStrokeRunMetaA[i + 1];
      const styles = writable(ref.kind === "stroke" ? "styles" : "gradientStrokeStyles");
      for (let segment = first; segment < first + count; segment++) styles.set(rgb, segment * 4 + 1);
      if (ref.kind === "gradient-stroke") writable("gradientStrokeRunMetaA")[i + 2] = gradient(source.gradientStrokeRunMetaA[i + 2], rgb);
    } else if (fill(ref)) {
      const prefix = ref.kind === "fill" ? "fill" : "gradientFill";
      writable(`${prefix}PathMetaB`).set(rgb.slice(0, 2), i + 2); writable(`${prefix}PathMetaC`)[i + 2] = rgb[2];
      if (ref.kind === "gradient-fill") writable("gradientFillPaintMeta")[i] = gradient(source.gradientFillPaintMeta[i], rgb);
    } else if (ref.kind === "text") writable("textInstanceC").set(rgb, i);
  }
  for (const [key, pending] of appended) {
    const old = scene[key] as PaintArray | undefined, size = (old?.length ?? 0) + pending.length;
    const values = pending.type === "byte" ? new Uint8Array(size) : pending.type === "uint" ? new Uint32Array(size) : new Float32Array(size);
    if (old) values.set(old); let offset = old?.length ?? 0;
    for (const part of pending.parts) { values.set(part, offset); offset += part.length; }
    (scene as unknown as Record<string, unknown>)[key] = values;
  }
  retainEditorPaintIdentity(source, scene); return scene;
}
