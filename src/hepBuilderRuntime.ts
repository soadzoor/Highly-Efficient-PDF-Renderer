import { loadPdfSceneFromSource, type PdfObjectSource } from "./pdfObjectGenerator";
import { buildHepBlobForLayout } from "./hepWriter";
import { listSceneRasterLayers } from "./hepShared";
import type { SceneTextureStats } from "./hepTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { createLoadProgressReporter, type PDFLoadProgress } from "./loadProgress";
import type { BuildHepFromPdfOptions, BuildHepFromSceneOptions, HepEncodingOptions } from "./hepBuilder";

export async function buildHepRuntime(
  input: PdfObjectSource | VectorScene,
  options: BuildHepFromPdfOptions | BuildHepFromSceneOptions = {}
): Promise<Blob> {
  options.signal?.throwIfAborted();
  if (isVectorScene(input)) {
    return buildHepFromScene(input, options as BuildHepFromSceneOptions);
  }
  return buildHepFromPdf(input, options as BuildHepFromPdfOptions);
}

async function buildHepFromPdf(
  source: PdfObjectSource,
  options: BuildHepFromPdfOptions
): Promise<Blob> {
  const progress = createLoadProgressReporter(options.onProgress);
  const parseProgress = progress.child(0, 0.82, { sourceType: "pdf" });
  const loaded = await loadPdfSceneFromSource(source, {
    password: options.password,
    imageCodecResolver: options.imageCodecResolver,
    iccTransformResolver: options.iccTransformResolver,
    iccEngine: options.iccEngine,
    onDiagnostic: options.onDiagnostic,
    segmentMerge: options.segmentMerge,
    invisibleCull: options.invisibleCull,
    pages: options.pages,
    maxPagesPerRow: options.maxPagesPerRow,
    annotationAppearances: options.annotationAppearances,
    sourceKind: "pdf",
    onProgress: (payload) => forwardParseProgress(parseProgress, payload)
  }, options.signal);
  options.signal?.throwIfAborted();
  const rasterLayers = listSceneRasterLayers(loaded.scene);
  const result = await buildSceneHep(
    loaded.scene,
    normalizeSourceLabel(options.sourceLabel, loaded.sourceLabel),
    rasterLayers,
    options,
    progress.child(0.82, 1, { sourceType: "pdf" })
  );
  progress.complete({ sourceType: "pdf" });
  options.signal?.throwIfAborted();
  return result;
}

async function buildHepFromScene(
  scene: VectorScene,
  options: BuildHepFromSceneOptions
): Promise<Blob> {
  const progress = createLoadProgressReporter(options.onProgress);
  options.signal?.throwIfAborted();
  const rasterLayers = listSceneRasterLayers(scene);

  const result = await buildSceneHep(
    scene,
    normalizeSourceLabel(options.sourceLabel, "document.pdf"),
    rasterLayers,
    options,
    progress.child(0, 1)
  );
  progress.complete();
  options.signal?.throwIfAborted();
  return result;
}

async function buildSceneHep(
  scene: VectorScene,
  sourceLabel: string,
  rasterLayers: ReturnType<typeof listSceneRasterLayers>,
  options: HepEncodingOptions,
  progress: ReturnType<typeof createLoadProgressReporter>
): Promise<Blob> {
  assertCurrentVectorScene(scene);
  const result = await buildHepBlobForLayout(
    scene,
    buildSceneTextureStats(scene),
    sourceLabel,
    "interleaved",
    rasterLayers,
    {
      withVectorLod: options.withVectorLod,
      vectorLodPrecision: options.vectorLodPrecision,
      withTextLod: options.withTextLod,
      encodeRasterImages: options.encodeRasterImages ?? true,
      compression: options.compression === "store" ? "STORE" : "DEFLATE",
      signal: options.signal,
      onBuildProgress: (value, buildProgress) => {
        progress.report(value, {
          stage: buildProgress.stage,
          unit: buildProgress.unit,
          processed: buildProgress.processed,
          total: buildProgress.total
        });
      }
    }
  );
  return result.blob;
}

function assertCurrentVectorScene(scene: VectorScene): void {
  const counts = [
    scene.gradientCount,
    scene.gradientFillPathCount,
    scene.gradientFillSegmentCount,
    scene.gradientStrokeRunCount,
    scene.gradientStrokeSegmentCount
  ];
  const floatResources = [
    scene.gradientMetaA,
    scene.gradientMetaB,
    scene.gradientMetaC,
    scene.gradientMetaD,
    scene.gradientMetaE,
    scene.gradientFillPathMetaA,
    scene.gradientFillPathMetaB,
    scene.gradientFillPathMetaC,
    scene.gradientFillPaintMeta,
    scene.gradientFillSegmentsA,
    scene.gradientFillSegmentsB,
    scene.gradientStrokeRunMetaA,
    scene.gradientStrokeRunMetaB,
    scene.gradientStrokeEndpoints,
    scene.gradientStrokePrimitiveMeta,
    scene.gradientStrokePrimitiveBounds,
    scene.gradientStrokeStyles
  ];
  if (
    counts.some((value) => !Number.isInteger(value) || value < 0) ||
    floatResources.some((value) => !(value instanceof Float32Array)) ||
    !(scene.gradientLut instanceof Uint8Array)
  ) {
    throw new Error(
      "VectorScene is missing the native-gradient resources required by HEP format v7."
    );
  }
}

function buildSceneTextureStats(scene: VectorScene): SceneTextureStats {
  const fillPath = chooseTextureDimensions(scene.fillPathCount);
  const fillSegment = chooseTextureDimensions(scene.fillSegmentCount);
  const stroke = chooseTextureDimensions(scene.segmentCount);
  const textInstance = chooseTextureDimensions(scene.textInstanceCount);
  const textGlyph = chooseTextureDimensions(scene.textGlyphCount);
  const textSegment = chooseTextureDimensions(scene.textGlyphSegmentCount);
  const gradient = chooseTextureDimensions(scene.gradientCount);
  const gradientFillPath = chooseTextureDimensions(scene.gradientFillPathCount);
  const gradientFillSegment = chooseTextureDimensions(scene.gradientFillSegmentCount);
  const gradientStrokeRun = chooseTextureDimensions(scene.gradientStrokeRunCount);
  const gradientStrokeSegment = chooseTextureDimensions(scene.gradientStrokeSegmentCount);
  return {
    fillPathTextureWidth: fillPath.width,
    fillPathTextureHeight: fillPath.height,
    fillSegmentTextureWidth: fillSegment.width,
    fillSegmentTextureHeight: fillSegment.height,
    textureWidth: stroke.width,
    textureHeight: stroke.height,
    textInstanceTextureWidth: textInstance.width,
    textInstanceTextureHeight: textInstance.height,
    textGlyphTextureWidth: textGlyph.width,
    textGlyphTextureHeight: textGlyph.height,
    textSegmentTextureWidth: textSegment.width,
    textSegmentTextureHeight: textSegment.height,
    gradientTextureWidth: gradient.width,
    gradientTextureHeight: gradient.height,
    gradientFillPathTextureWidth: gradientFillPath.width,
    gradientFillPathTextureHeight: gradientFillPath.height,
    gradientFillSegmentTextureWidth: gradientFillSegment.width,
    gradientFillSegmentTextureHeight: gradientFillSegment.height,
    gradientStrokeRunTextureWidth: gradientStrokeRun.width,
    gradientStrokeRunTextureHeight: gradientStrokeRun.height,
    gradientStrokeSegmentTextureWidth: gradientStrokeSegment.width,
    gradientStrokeSegmentTextureHeight: gradientStrokeSegment.height
  };
}

function chooseTextureDimensions(itemCount: number): { width: number; height: number } {
  const normalizedCount = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0;
  const safeCount = Math.max(1, normalizedCount);
  const width = Math.ceil(Math.sqrt(safeCount));
  return {
    width,
    height: Math.max(1, Math.ceil(safeCount / width))
  };
}

function forwardParseProgress(
  target: ReturnType<typeof createLoadProgressReporter>,
  payload: PDFLoadProgress
): void {
  const { value, ...metadata } = payload;
  target.report(value, {
    ...metadata,
    stage: payload.stage === "complete" ? "compile" : payload.stage
  });
}

function normalizeSourceLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}




function isVectorScene(value: PdfObjectSource | VectorScene): value is VectorScene {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<VectorScene>;
  return (
    typeof candidate.segmentCount === "number" &&
    candidate.endpoints instanceof Float32Array &&
    candidate.styles instanceof Float32Array
  );
}
