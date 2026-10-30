import { normalizePrimitiveColor } from "./colorInput";
import { editorShapeGeometry, type EditorShapePoint } from "./editorShapeGeometry";
import type { EditorShapeObject } from "./editorTypes";
import { editorReviewShapes } from "./editorReview";

export type EditorShapePreviewInput = Pick<EditorShapeObject,
  "shape" | "x" | "y" | "width" | "height" | "points" | "color" | "strokeWidth" | "fill" | "opacity" | "fillOpacity" | "review">;
export interface EditorShapePreviewGeometry {
  /** SVG attributes in canonical fill, arrowhead, stroke paint order. */
  paths: readonly Readonly<Record<string, string | number>>[];
}
interface ShapePreviewPaths { stroke: string; fills: readonly string[]; arrowhead?: string }

function pathData(input: readonly EditorShapePoint[], closed: boolean, discardDegenerates: boolean): string {
  const points: EditorShapePoint[] = [];
  for (const point of input) {
    const next = [Math.fround(point[0]), Math.fround(point[1])] as const;
    if (!next.every(Number.isFinite)) throw new RangeError("Shape preview coordinates must be float32-representable.");
    const previous = points[points.length - 1];
    if (!discardDegenerates || !previous || previous[0] !== next[0] || previous[1] !== next[1]) points.push(next);
  }
  if (discardDegenerates && closed && points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop();
  if (points.length < (discardDegenerates ? 2 : 3)) return "";
  return `M${points[0][0]} ${points[0][1]} ${points.slice(1).map(point => `L${point[0]} ${point[1]}`).join(" ")}${closed ? " Z" : ""}`;
}

function previewPaths(input: EditorShapePreviewInput): ShapePreviewPaths {
  const geometry = editorShapeGeometry(input);
  return { stroke: geometry.paths.map(path => pathData(path, geometry.closed, true)).filter(Boolean).join(" "),
    fills: geometry.paths.filter(path => path.length >= 3).map(path => pathData(path, true, false)),
    ...(geometry.arrowhead ? { arrowhead: pathData(geometry.arrowhead, true, false) } : {}) };
}

const colorCss = (color: NonNullable<EditorShapePreviewInput["color"]>): string =>
  `rgb(${normalizePrimitiveColor(color).map(component => component * 255).join(",")})`;

function styledPreview(input: EditorShapePreviewInput, geometry: ShapePreviewPaths, hairlineWidth: number): EditorShapePreviewGeometry {
  const width = input.strokeWidth ?? 1, opacity = input.opacity ?? 1, fillOpacity = input.fillOpacity ?? opacity;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(Math.fround(width)) || width > 0 && Math.fround(width / 2) === 0 ||
      !Number.isFinite(hairlineWidth) || hairlineWidth <= 0) throw new RangeError("Shape preview widths must be finite and nonnegative; hairline width must be positive.");
  if (![opacity, fillOpacity].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError("Shape preview opacity must be between zero and one.");
  const paths: Record<string, string | number>[] = [], stroke = colorCss(input.color ?? 0);
  if (input.fill !== undefined && input.fill !== null) {
    const fill = colorCss(input.fill);
    for (const d of geometry.fills) paths.push({ d, fill, "fill-opacity": fillOpacity, "fill-rule": "nonzero", stroke: "none" });
  }
  if (geometry.arrowhead) paths.push({ d: geometry.arrowhead, fill: stroke, "fill-opacity": opacity, "fill-rule": "nonzero", stroke: "none" });
  if (geometry.stroke) paths.push({ d: geometry.stroke, fill: "none", stroke, "stroke-width": width || hairlineWidth,
    "stroke-opacity": opacity, "stroke-linecap": "round", "stroke-linejoin": "round",
    ...(width === 0 ? { "vector-effect": "non-scaling-stroke" } : {}) });
  return { paths };
}

/** Hairlines use CSS pixels; pass 1 / devicePixelRatio for a device-pixel pen. */
export function editorShapePreviewGeometry(input: EditorShapePreviewInput, hairlineWidth = 1): EditorShapePreviewGeometry {
  if (input.review) {
    const shapes = editorReviewShapes({ ...input, kind: "shape", id: "preview", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0] });
    const paths = shapes.flatMap(shape => {
      const styled = styledPreview(shape, previewPaths(shape), hairlineWidth);
      return input.review!.type === "highlight" ? styled.paths.filter(path => path.stroke === "none").map(path => ({ ...path, style: "mix-blend-mode:multiply" })) : styled.paths;
    });
    return { paths };
  }
  return styledPreview(input, previewPaths(input), hairlineWidth);
}

/** Cache only the current outline; replace points for same-length interior edits. */
export function createEditorShapePreviewCache(): { get(input: EditorShapePreviewInput, hairlineWidth?: number): EditorShapePreviewGeometry } {
  let previous: { shape: EditorShapeObject["shape"]; x: number; y: number; width: number; height: number; arrowWidth?: number;
    points?: readonly EditorShapePoint[]; count: number; lastX?: number; lastY?: number } | undefined;
  let geometry: ShapePreviewPaths;
  return { get(input, hairlineWidth = 1) {
    if (input.review) return editorShapePreviewGeometry(input, hairlineWidth);
    const points = input.points, last = points?.[points.length - 1], arrowWidth = input.shape === "arrow" ? input.strokeWidth ?? 1 : undefined;
    if (!previous || previous.shape !== input.shape || previous.x !== input.x || previous.y !== input.y || previous.width !== input.width ||
        previous.height !== input.height || previous.arrowWidth !== arrowWidth || previous.points !== points ||
        previous.count !== (points?.length ?? 0) || previous.lastX !== last?.[0] || previous.lastY !== last?.[1]) {
      geometry = previewPaths(input);
      previous = { shape: input.shape, x: input.x, y: input.y, width: input.width, height: input.height, arrowWidth,
        points, count: points?.length ?? 0, lastX: last?.[0], lastY: last?.[1] };
    }
    return styledPreview(input, geometry, hairlineWidth);
  } };
}
