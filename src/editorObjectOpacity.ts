import type { EditorObject } from "./editorTypes";

/** A transparent stroke can still own a visible independently painted fill. */
export function editorObjectHasVisiblePaint(object: EditorObject): boolean {
  if ((object.opacity ?? 1) > 0) return true;
  if (object.kind !== "shape" && object.kind !== "ink" && object.kind !== "signature") return false;
  if (object.fill == null || (object.fillOpacity ?? object.opacity ?? 1) <= 0) return false;
  if (object.kind === "shape") return object.shape === "rectangle" || object.shape === "ellipse" ||
    (object.shape === "polygon" || object.shape === "polyline") && (object.points?.length ?? 0) >= 3;
  return object.paths.some(path => path.length >= 3);
}
