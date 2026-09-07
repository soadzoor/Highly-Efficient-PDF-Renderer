import type {
  DensePdfBounds,
  DensePdfMatrix
} from "./nativeContentCompiler";
import type { NativePdfPage } from "./nativeDocument";
import { PdfError } from "./nativeTypes";

type PdfBox = readonly [number, number, number, number];

/** PDF default user space to HEPR's page-native Y-up coordinates. */
export function computeNativePdfPageGeometry(page: Pick<
  NativePdfPage,
  "mediaBox" | "cropBox" | "rotation" | "userUnit"
>): { pageMatrix: DensePdfMatrix; pageBounds: DensePdfBounds } {
  const media = normalizeBox(page.mediaBox);
  const crop = normalizeBox(page.cropBox);
  const view = intersectBoxes(media, crop) ?? media;
  const userUnit = Number.isFinite(page.userUnit) && page.userUnit > 0 ? page.userUnit : 1;
  const rotation = normalizeRotation(page.rotation);
  const centerX = (view[0] + view[2]) / 2;
  const centerY = (view[1] + view[3]) / 2;
  let a = 1;
  let b = 0;
  let c = 0;
  let d = -1;
  if (rotation === 90) [a, b, c, d] = [0, 1, 1, 0];
  else if (rotation === 180) [a, b, c, d] = [-1, 0, 0, 1];
  else if (rotation === 270) [a, b, c, d] = [0, -1, -1, 0];
  const unrotatedWidth = view[2] - view[0];
  const unrotatedHeight = view[3] - view[1];
  const viewportHeight = (a === 0 ? unrotatedWidth : unrotatedHeight) * userUnit;
  const offsetX = Math.abs((a === 0 ? centerY - view[1] : centerX - view[0]) * userUnit);
  const offsetY = Math.abs((a === 0 ? centerX - view[0] : centerY - view[1]) * userUnit);
  const va = a * userUnit;
  const vb = b * userUnit;
  const vc = c * userUnit;
  const vd = d * userUnit;
  const ve = offsetX - va * centerX - vc * centerY;
  const vf = offsetY - vb * centerX - vd * centerY;
  const pageMatrix: DensePdfMatrix = [va, -vb, vc, -vd, ve, viewportHeight - vf];
  return { pageMatrix, pageBounds: transformBox(view, pageMatrix) };
}

function normalizeBox(box: readonly number[]): PdfBox {
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value))) {
    throw new PdfError("invalid-page-tree", "A PDF page box is invalid.");
  }
  return [
    Math.min(box[0], box[2]),
    Math.min(box[1], box[3]),
    Math.max(box[0], box[2]),
    Math.max(box[1], box[3])
  ];
}

function intersectBoxes(first: PdfBox, second: PdfBox): PdfBox | null {
  const result: PdfBox = [
    Math.max(first[0], second[0]),
    Math.max(first[1], second[1]),
    Math.min(first[2], second[2]),
    Math.min(first[3], second[3])
  ];
  return result[2] > result[0] && result[3] > result[1] ? result : null;
}

function transformBox(box: PdfBox, matrix: DensePdfMatrix): DensePdfBounds {
  const xs = [box[0], box[2], box[2], box[0]];
  const ys = [box[1], box[1], box[3], box[3]];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < 4; index += 1) {
    const x = matrix[0] * xs[index] + matrix[2] * ys[index] + matrix[4];
    const y = matrix[1] * xs[index] + matrix[3] * ys[index] + matrix[5];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.trunc(value) % 360) + 360) % 360;
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new PdfError("invalid-page-tree", `Unsupported PDF page rotation ${value}.`);
  }
  return normalized;
}
