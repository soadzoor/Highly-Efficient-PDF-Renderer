import { HEPR_GRADIENT_KIND, type HeprPageData, type PdfMatrix } from "./heprDocumentData";
import { createEmptyVectorScene } from "./emptyVectorScene";
import type { Bounds } from "./pdfVectorExtractor";
import type { GradientSceneData } from "./orderedGradientPaint";
import { buildNativeVectorGradients, type NativeVectorGradientSource } from "./pdf/nativeVectorGradients";
import { buildHeprVectorShadingMesh, createRetainedShadingEvaluator, readRetainedShading,
  type VectorShadingOptions } from "./vectorShadingMesh";
import { PdfError } from "./pdf/nativeTypes";

/** A self-contained shading paint, ready to append to a scene's canonical gradient arrays. */
export async function buildHeprVectorGradient(page: HeprPageData, gradientIndex: number, matrix: PdfMatrix,
  clipBounds: Bounds, alpha: number, options: VectorShadingOptions & { paintBackground?: boolean } = {}): Promise<GradientSceneData> {
  const description = readRetainedShading(page, gradientIndex), { evaluate, colors } = createRetainedShadingEvaluator(page, options.signal);
  let data: GradientSceneData;
  if (description.kind === HEPR_GRADIENT_KIND.Axial || description.kind === HEPR_GRADIENT_KIND.Radial) {
    const radial = description.kind === HEPR_GRADIENT_KIND.Radial, coordinateCount = radial ? 6 : 4;
    const registry: NativeVectorGradientSource = { size: 1,
      describe: () => ({ shadingType: radial ? 3 : 2, kind: radial ? "radial" : "axial", colorSpaceIndex: description.colorSpaceIndex,
        functionIndex: description.functions.length === 1 ? description.functions[0] : -1, functionIndices: description.functions,
        meshIndex: -1, coordinates: Array.from(description.coordinates.subarray(0, coordinateCount)),
        domain: Array.from(description.coordinates.subarray(coordinateCount)), matrix: null, boundingBox: description.bbox,
        background: description.background, extend: [!!(description.flags & 1), !!(description.flags & 2)], antiAlias: !!(description.flags & 4) }),
      functions: { evaluate: (index, inputs) => evaluate([index], inputs) },
      colors: { convertToSrgb: (index, inputs) => colors.convert(index, inputs, "retained-gradient") } };
    data = buildNativeVectorGradients([{ gradientIndex: 0, transform: [...matrix], clipBounds, alpha, paintOrder: 0 }], registry, 1, options.signal);
  } else {
    const mesh = await buildHeprVectorShadingMesh(page, gradientIndex, options);
    const [a, b, c, d, e, f] = matrix, det = a * d - b * c;
    if (!Number.isFinite(det) || det === 0) throw new PdfError("unsupported-content", "A shading has a singular paint transform.");
    const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = clipBounds;
    data = { ...createEmptyVectorScene(), gradientCount: 1,
      gradientMetaA: Float32Array.of(2, description.bbox ? 1 : 0, 0, 0),
      gradientMetaB: Float32Array.of(d / det, -b / det, -c / det, a / det),
      gradientMetaC: Float32Array.of((c * f - d * e) / det, (b * e - a * f) / det, 0, 0),
      gradientMetaD: new Float32Array(4), gradientMetaE: Float32Array.from(description.bbox ?? [0, 0, 0, 0]),
      gradientLut: new Uint8Array(1024 * 4), gradientMeshRanges: Uint32Array.of(0, mesh.indices.length),
      gradientMeshPositions: mesh.positions, gradientMeshColors: mesh.colors, gradientMeshIndices: mesh.indices,
      gradientFillPathCount: 1, gradientFillSegmentCount: 4,
      gradientFillPathMetaA: Float32Array.of(0, 4, x0, y0), gradientFillPathMetaB: Float32Array.of(x1, y1, 0, 0),
      gradientFillPathMetaC: Float32Array.of(0, 0, 0, alpha), gradientFillPaintMeta: Float32Array.of(0, -1, 0, 0),
      gradientFillSegmentsA: Float32Array.of(x0,y0,x1,y0, x1,y0,x1,y1, x1,y1,x0,y1, x0,y1,x0,y0),
      gradientFillSegmentsB: Float32Array.of(x1,y0,0,0, x1,y1,0,0, x0,y1,0,0, x0,y0,0,0)
    };
  }
  if (options.paintBackground && description.background) {
    const rgb = colors.convert(description.colorSpaceIndex, description.background, "shading-background");
    data.gradientMetaA[3] = 1 + Math.round(rgb[0] * 255) * 65536 + Math.round(rgb[1] * 255) * 256 + Math.round(rgb[2] * 255);
  }
  return data;
}
