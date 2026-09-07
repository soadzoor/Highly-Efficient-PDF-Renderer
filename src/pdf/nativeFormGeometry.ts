import type { DensePdfBounds, DensePdfMatrix } from "./nativeContentCompiler";
import type {
  NativePdfAnnotationAppearance,
  NativePdfForm,
  NativePdfRectangle
} from "./nativeForms";
import { PdfError } from "./nativeTypes";

export interface NativePdfAnnotationPlacement {
  /** External transform applied before the reusable Form's own /Matrix. */
  readonly invocationMatrix: DensePdfMatrix;
  /** Axis-aligned annotation rectangle in page-native coordinates. */
  readonly pageBounds: DensePdfBounds;
}

/** Compose affine transforms using PDF's column-vector convention. */
export function multiplyNativePdfMatrices(
  outer: readonly number[],
  local: readonly number[]
): DensePdfMatrix {
  assertFiniteVector(outer, 6, "PDF affine matrix");
  assertFiniteVector(local, 6, "PDF affine matrix");
  const result: DensePdfMatrix = [
    outer[0] * local[0] + outer[2] * local[1],
    outer[1] * local[0] + outer[3] * local[1],
    outer[0] * local[2] + outer[2] * local[3],
    outer[1] * local[2] + outer[3] * local[3],
    outer[0] * local[4] + outer[2] * local[5] + outer[4],
    outer[1] * local[4] + outer[3] * local[5] + outer[5]
  ];
  if (!result.every(Number.isFinite)) {
    throw new RangeError("PDF affine matrix multiplication overflowed finite arithmetic.");
  }
  return result;
}

export function transformNativePdfRectangle(
  rectangle: NativePdfRectangle,
  matrix: readonly number[]
): DensePdfBounds {
  assertFiniteVector(rectangle, 4, "PDF rectangle");
  assertFiniteVector(matrix, 6, "PDF affine matrix");
  const [left, bottom, right, top] = rectangle;
  const corners = [
    [left, bottom],
    [right, bottom],
    [right, top],
    [left, top]
  ] as const;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    if (!Number.isFinite(transformedX) || !Number.isFinite(transformedY)) {
      throw new RangeError("PDF rectangle transformation overflowed finite arithmetic.");
    }
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

/**
 * Compute the PDF appearance mapping from a Form's transformed /BBox into the
 * annotation /Rect, then place that mapping in page-native coordinates.
 *
 * The reusable program still owns the Form /Matrix. Consequently the returned
 * invocation matrix contains only the annotation mapping and the page matrix.
 */
export function computeNativePdfAnnotationPlacement(
  annotation: Pick<NativePdfAnnotationAppearance, "pageIndex" | "annotationIndex" | "rectangle">,
  form: Pick<NativePdfForm, "bbox" | "matrix">,
  pageMatrix: DensePdfMatrix
): NativePdfAnnotationPlacement {
  let transformedBox: DensePdfBounds;
  try {
    transformedBox = transformNativePdfRectangle(form.bbox, form.matrix);
    assertFiniteVector(annotation.rectangle, 4, "annotation rectangle");
    assertFiniteVector(pageMatrix, 6, "page matrix");
  } catch (cause) {
    throw annotationGeometryError(
      annotation,
      "An annotation appearance has invalid finite geometry.",
      "annotation-appearance-invalid-geometry",
      cause
    );
  }
  const sourceWidth = transformedBox.maxX - transformedBox.minX;
  const sourceHeight = transformedBox.maxY - transformedBox.minY;
  const targetWidth = annotation.rectangle[2] - annotation.rectangle[0];
  const targetHeight = annotation.rectangle[3] - annotation.rectangle[1];
  if (
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight)
  ) {
    throw annotationGeometryError(
      annotation,
      "An annotation appearance exceeds finite geometry.",
      "annotation-appearance-geometry-overflow"
    );
  }
  if (
    !(sourceWidth > 0) || !(sourceHeight > 0) ||
    !(targetWidth > 0) || !(targetHeight > 0)
  ) {
    throw new PdfError(
      "invalid-object",
      "An annotation appearance cannot map an empty BBox or Rect.",
      {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          reason: "annotation-appearance-empty-bounds"
        }
      }
    );
  }
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const appearanceToPage: DensePdfMatrix = [
    scaleX,
    0,
    0,
    scaleY,
    annotation.rectangle[0] - transformedBox.minX * scaleX,
    annotation.rectangle[1] - transformedBox.minY * scaleY
  ];
  try {
    return Object.freeze({
      invocationMatrix: multiplyNativePdfMatrices(pageMatrix, appearanceToPage),
      pageBounds: transformNativePdfRectangle(annotation.rectangle, pageMatrix)
    });
  } catch (cause) {
    throw annotationGeometryError(
      annotation,
      "An annotation appearance placement exceeds finite geometry.",
      "annotation-appearance-geometry-overflow",
      cause
    );
  }
}

function assertFiniteVector(values: readonly number[], length: number, label: string): void {
  if (values.length !== length || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${label} must contain ${length} finite numbers.`);
  }
}

function annotationGeometryError(
  annotation: Pick<NativePdfAnnotationAppearance, "pageIndex" | "annotationIndex">,
  message: string,
  reason: string,
  cause?: unknown
): PdfError {
  return new PdfError("invalid-object", message, {
    pageIndex: annotation.pageIndex,
    cause,
    details: { annotationIndex: annotation.annotationIndex, reason }
  });
}
