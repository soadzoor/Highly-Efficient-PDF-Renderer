import { getEditorSignatureInkPaths, type EditorSignature } from "./editorSignatures";
import { editorInkBounds, editorInkPathData } from "./editorInkGeometry";
import type { EditorMatrix } from "./editorTypes";

const geometry = new WeakMap<EditorSignature, { centerX: number; centerY: number; width: number; path: string }>();

/** Reuse canonical template geometry while the cursor, camera or style changes. */
export function editorSignaturePlacement(signature: EditorSignature, center: readonly [number, number], width: number) {
  let cached = geometry.get(signature);
  if (!cached) {
    const curves = getEditorSignatureInkPaths(signature), bounds = editorInkBounds(curves);
    if (!bounds) throw new TypeError("A signature needs visible stroke geometry.");
    cached = { centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2,
      width: Math.max(1, bounds.maxX - bounds.minX), path: editorInkPathData(curves) };
    geometry.set(signature, cached);
  }
  const scale = width / cached.width;
  // Template Y points down, while page Y points up. Both fitted bounds share
  // the cursor center, including signatures whose fitted extrema overshoot samples.
  const transform: EditorMatrix = [scale, 0, 0, -scale, center[0] - cached.centerX * scale, center[1] + cached.centerY * scale];
  return { transform, scale, path: cached.path };
}
