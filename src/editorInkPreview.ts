import { normalizePrimitiveColor } from "./colorInput";
import { editorInkPathData, fitEditorInkPaths, type InkPoint } from "./editorInkGeometry";
import type { EditorInkObject, EditorMatrix } from "./editorTypes";

export type EditorInkPreviewInput = Pick<EditorInkObject,
  "paths" | "smoothing" | "color" | "strokeWidth" | "fill" | "opacity" | "fillOpacity">;
export interface EditorInkPreviewGeometry {
  /** SVG path attributes, in the same fill-before-stroke order as committed ink. */
  paths: readonly Readonly<Record<string, string | number>>[];
}
interface FittedInkPreview { stroke: string; fills: readonly string[] }

function fitPreview(input: EditorInkPreviewInput): FittedInkPreview {
  const curves = fitEditorInkPaths(input.paths, input.smoothing ?? 0);
  return { stroke: editorInkPathData(curves), fills: curves.flatMap((path, index) =>
    input.paths[index].length >= 3 && path.length ? [editorInkPathData([path])] : []) };
}

const colorCss = (color: NonNullable<EditorInkPreviewInput["color"]>): string =>
  `rgb(${normalizePrimitiveColor(color).map(component => component * 255).join(",")})`;

function styledPreview(input: EditorInkPreviewInput, fitted: FittedInkPreview, hairlineWidth: number): EditorInkPreviewGeometry {
  const width = input.strokeWidth ?? 1, opacity = input.opacity ?? 1, fillOpacity = input.fillOpacity ?? opacity;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(hairlineWidth) || hairlineWidth <= 0) throw new RangeError("Ink preview widths must be finite and nonnegative; hairline width must be positive.");
  if (![opacity, fillOpacity].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError("Ink preview opacity must be between zero and one.");
  const paths: Record<string, string | number>[] = [];
  if (input.fill !== undefined && input.fill !== null) {
    const fill = colorCss(input.fill);
    for (const d of fitted.fills) paths.push({ d, fill, "fill-opacity": fillOpacity, "fill-rule": "nonzero", stroke: "none" });
  }
  if (fitted.stroke) paths.push({ d: fitted.stroke, fill: "none", stroke: colorCss(input.color ?? 0),
    "stroke-width": width || hairlineWidth, "stroke-opacity": opacity, "stroke-linecap": "round", "stroke-linejoin": "round",
    ...(width === 0 ? { "vector-effect": "non-scaling-stroke" } : {}) });
  return { paths };
}

/** Fit only the active stroke. Hairlines use CSS pixels; pass 1 / devicePixelRatio. */
export function editorInkPreviewGeometry(input: EditorInkPreviewInput, hairlineWidth = 1): EditorInkPreviewGeometry {
  return styledPreview(input, fitPreview(input), hairlineWidth);
}

/**
 * Reuse fitting while only the camera or style changes. Captures append points;
 * replace a path when editing its interior without changing its point count.
 */
export function createEditorInkPreviewCache(): { get(input: EditorInkPreviewInput, hairlineWidth?: number): EditorInkPreviewGeometry } {
  let previous: { path: readonly InkPoint[]; length: number; x?: number; y?: number }[] | undefined;
  let smoothing: number | undefined, fitted: FittedInkPreview;
  return { get(input, hairlineWidth = 1) {
    const tolerance = input.smoothing ?? 0;
    if (!previous || smoothing !== tolerance || previous.length !== input.paths.length || input.paths.some((path, index) => {
      const entry = previous![index], last = path[path.length - 1];
      return entry.path !== path || entry.length !== path.length || entry.x !== last?.[0] || entry.y !== last?.[1];
    })) {
      fitted = fitPreview(input); smoothing = tolerance;
      previous = input.paths.map(path => ({ path, length: path.length, x: path[path.length - 1]?.[0], y: path[path.length - 1]?.[1] }));
    }
    return styledPreview(input, fitted, hairlineWidth);
  } };
}

/** Page-local ink to overlay-local CSS pixels, retaining the complete affine pen. */
export function editorInkPreviewTransform(transform: EditorMatrix, pageOrigin: InkPoint,
  project: (x: number, y: number) => { x: number; y: number } | null,
  overlayOrigin: { x: number; y: number }): EditorMatrix | null {
  const [a, b, c, d, e, f] = transform, [pageX, pageY] = pageOrigin;
  const origin = project(pageX + e, pageY + f), x = project(pageX + e + a, pageY + f + b), y = project(pageX + e + c, pageY + f + d);
  if (!origin || !x || !y) return null;
  const matrix: EditorMatrix = [x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y,
    origin.x - overlayOrigin.x, origin.y - overlayOrigin.y];
  return matrix.every(Number.isFinite) && matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0 ? matrix : null;
}
