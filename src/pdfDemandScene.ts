import { composeOverlappingVectorScenes, type RasterLayer, type VectorScene } from "./pdfVectorExtractor";
import { copyRasterLayer } from "./monochromeRaster";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } from "./scenePageViews";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";

const transparent = Uint8Array.of(0, 0, 0, 0);

function alternative(scene: VectorScene, detail: boolean): VectorScene {
  const result = Object.defineProperties({}, Object.getOwnPropertyDescriptors(scene)) as VectorScene;
  result.drawRuns = (scene.drawRuns ?? defaultVectorDrawRuns(scene)).map(run => ({ ...run,
    pdfRepresentation: { pageIndex: 0, detail } }));
  // Flat graphs preserve page/run boundaries during document composition.
  result.paintGraph = scene.paintGraph ?? { roots: result.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })) };
  return result;
}

/** Reserve an empty scan slot. This is metadata, never a low-resolution page raster. */
export function createOcrDemandScene(overview: VectorScene): VectorScene {
  const result = alternative(overview, false);
  result.rasterLayers = [...overview.rasterLayers, { pageDemandSlot: true, width: 1, height: 1, data: transparent,
    opacity: 0, matrix: Float32Array.of(overview.pageRects[2] - overview.pageRects[0], 0, 0,
      overview.pageRects[3] - overview.pageRects[1], overview.pageRects[0], overview.pageRects[1]), pageIndex: 0, paintOrder: 0 }];
  result.drawRuns!.push({ kind: "raster", first: overview.rasterLayers.length, count: 1, pdfRepresentation: { pageIndex: 0, detail: true } });
  result.paintGraph = { roots: [...result.paintGraph!.roots, { kind: "draw", runIndex: result.drawRuns!.length - 1 }] };
  result.pagePrimitiveRanges = Uint32Array.from(PAGE_PRIMITIVE_KINDS.flatMap(kind => [0, scenePrimitiveCounts(result)[kind]]));
  return result;
}

/** Most scans need only new pixels. Additional vector paints/clips are installed once, then retained. */
export function needsOcrDetailGeometry(detail: VectorScene): boolean {
  return detail.rasterLayers.length !== 1 || detail.segmentCount > 0 || detail.fillPathCount > 0 ||
    detail.textInstanceCount > 0 || detail.gradientFillPathCount > 0 || detail.gradientStrokeRunCount > 0 ||
    !!detail.clipPaths?.length || !!detail.optionalContent;
}

export function createOcrDetailDemandScene(overview: VectorScene, detail: VectorScene): VectorScene | null {
  // Effects and retained replay islands use the compatibility path rather than losing their paint semantics.
  if (sceneRequiresPaintCompositing(detail) || detail.retainedPages?.length) return null;
  const detailGeometry = alternative(detail, true);
  detailGeometry.rasterLayers = detail.rasterLayers.map(layer => ({ pageDemandSlot: true,
    width: 1, height: 1, data: transparent, opacity: 0, matrix: layer.matrix,
    paintOrder: layer.paintOrder, pageIndex: 0 }));
  const scene = composeOverlappingVectorScenes([alternative(overview, false), detailGeometry]);
  scene.pageCount = scene.pagesPerRow = 1;
  scene.pageRects = overview.pageRects;
  scene.pageTextRanges = Uint32Array.of(0, scene.textInstanceCount);
  scene.pagePrimitiveRanges = Uint32Array.from(PAGE_PRIMITIVE_KINDS.flatMap(kind => [0, scenePrimitiveCounts(scene)[kind]]));
  scene.textIndex = overview.textIndex;
  scene.textContent = overview.textContent;
  scene.pdfPages = overview.pdfPages;
  scene.annotations = scene.annotations?.map(annotation => ({ ...annotation, pageIndex: 0 }));
  scene.bounds = scene.pageBounds = overview.pageBounds;
  for (const layer of scene.rasterLayers) layer.pageIndex = 0;
  for (const run of scene.drawRuns ?? []) if (run.pdfRepresentation) run.pdfRepresentation.pageIndex = 0;
  for (let i = 3; i < scene.gradientFillPaintMeta.length; i += 4) scene.gradientFillPaintMeta[i] = 0;
  for (let i = 1; i < scene.gradientStrokeRunMetaB.length; i += 4) scene.gradientStrokeRunMetaB[i] = 0;
  return scene;
}

export function placeDemandRaster(layer: RasterLayer, scene: VectorScene, page: VectorScene, index: number): RasterLayer {
  const matrix = layer.matrix.slice();
  matrix[4] += scene.pageRects[index * 4] - page.pageRects[0];
  matrix[5] += scene.pageRects[index * 4 + 1] - page.pageRects[1];
  return copyRasterLayer(layer, { matrix, pageIndex: index, pageDemandSlot: true });
}
