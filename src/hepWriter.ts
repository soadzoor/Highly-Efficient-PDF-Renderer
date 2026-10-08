import { writeHepLod } from "./hepLod";
import { validatePagePrimitiveRanges } from "./scenePageViews";
import { writeHepAnnotations } from "./hepAnnotations";
import { writeHepStructure } from "./hepStructure";
import { validateVectorDrawRuns } from "./vectorDrawOrder";
import { validateSceneOptionalContentReferences } from "./optionalContent";
import { validateSceneRetainedPages } from "./retainedPageData";
import { encodeHeprPageData } from "./heprPageEncoding";
import type { HeprPageData } from "./heprDocumentData";
import { validateScenePaintGraph } from "./scenePaintGraph";
import {
  SCENE_CLIP_PATHS_PATH,
  SCENE_DRAW_RUNS_PATH,
  SCENE_PAINT_GRAPH_PATH,
  encodeSceneClipPaths,
  encodeSceneDrawRuns,
  encodeScenePaintGraph
} from "./hepSceneSections";
import { writeHepGradientMesh } from "./hepGradientMesh";
import { HepArchive } from "./hepContainer";
import { assertHepSizeBelowPdf, omitHepLodForSizeBudget, validateSourcePdfByteLength } from "./hepSizePolicy";
import {
  GRADIENT_LUT_WIDTH,
  type RasterLayer,
  type VectorScene
} from "./pdfVectorExtractor";
import {
  encodeRasterRgbaAsPng,
  encodeRasterRgbaCandidates,
  pickBestRasterImage
} from "./rasterImageCodec";
import { encodeHepMonochromeRaster } from "./hepMonochromeRaster";
import {
  IdenticalRasterFinder,
  SCENE_RASTER_LAYERS_PATH,
  copyRasterRect,
  encodeRasterLayerTable,
  isRasterAtlasCandidate,
  packRasterAtlases,
  rasterAtlasFile,
  rasterLayerFile,
  type RasterAtlasRecord,
  type RasterLayerRecord
} from "./hepRasterLayers";
import {
  TEXT_GLYPH_SEGMENTS_PATH,
  TEXT_INSTANCE_POSITIONS_PATH,
  encodeTextGlyphSegments,
  encodeTextInstancePositions,
  type TextGlyphSegmentsMeta
} from "./hepTextSections";
import {
  ByteWriter,
  encodeFixed512DeltaColumn,
  zigzagEncode32
} from "./parsedDataVarint";
import {
  prepareSceneForHepRendering,
  PARSED_DATA_FORMAT_VERSION,
  PARSED_DATA_MONOCHROME_FORMAT_VERSION,
  TEXT_INDEX_JSON_PATH,
  TEXT_CHAR_MAP_PATH,
  TEXT_FALLBACK_PATH,
  TEXT_OPTIONAL_CONTENT_PATH,
  buildStrokeGeometryExport,
  packTextureForZip
} from "./hepShared";
import type {
  ExportTextureEntry,
  SceneTextureStats,
  TextureLayout,
  BuildHepBlobOptions,
  HepBuildProgress,
  HepBlobResult,
  TextIndexExportResult,
  TextInstancesExport
} from "./hepTypes";

const GRADIENT_LUT_PATH = "textures/gradient-lut.rgba";

export async function buildHepBlobForLayout(
  scene: VectorScene,
  sceneStats: SceneTextureStats,
  label: string,
  textureLayout: TextureLayout,
  sceneRasterLayers: RasterLayer[],
  options: BuildHepBlobOptions = {}
): Promise<HepBlobResult> {
  throwIfBuildAborted(options.signal);
  validateSourcePdfByteLength(options.sourcePdfByteLength);
  validateSourcePdfByteLength(scene.sourcePdfByteLength);
  const sourcePdfByteLength = options.sourcePdfByteLength === undefined ? scene.sourcePdfByteLength
    : scene.sourcePdfByteLength === undefined ? options.sourcePdfByteLength
    : Math.min(options.sourcePdfByteLength, scene.sourcePdfByteLength);
  if (options.withVectorLod || options.withTextLod) scene = prepareSceneForHepRendering(scene);
  validatePagePrimitiveRanges(scene);
  validateVectorDrawRuns(scene);
  validateSceneOptionalContentReferences(scene);
  validateSceneRetainedPages(scene);
  validateScenePaintGraph(scene);
  throwIfBuildAborted(options.signal);
  const encodeRasterImages = options.encodeRasterImages ?? true;
  const compression = options.compression ?? "DEFLATE";
  const totalRasterTexels = encodeRasterImages
    ? countRasterTexelsToEncode(sceneRasterLayers)
    : 0;
  const hepBuildStart = totalRasterTexels > 0 ? 0.4 : 0;
  const lodBuildEnd = options.withVectorLod || options.withTextLod ? 0.6 : 0;
  const reportBuildProgress = (value: number, progress: HepBuildProgress): void => {
    options.onBuildProgress?.(lodBuildEnd + value * (1 - lodBuildEnd), progress);
  };
  const archive = new HepArchive();
  const lod = await writeHepLod(archive, scene, { ...options,
    onProgress: (value, stage) => options.onBuildProgress?.(value * lodBuildEnd, { stage }) });
  reportBuildProgress(
    0,
    totalRasterTexels > 0
      ? {
          stage: "raster-encode",
          unit: "texels",
          processed: 0,
          total: totalRasterTexels
        }
      : { stage: "hep-build" }
  );
  const annotations = writeHepAnnotations(archive, scene);
  const structure = writeHepStructure(archive, scene);
  const gradientMesh = writeHepGradientMesh(archive, scene);
  const retainedFiles = new Map<HeprPageData, string>();
  const retainedPages = scene.retainedPages?.map(resource => {
    let file = retainedFiles.get(resource.page);
    if (!file) {
      file = `retained/page-${retainedFiles.size}.bin`;
      archive.file(file, encodeHeprPageData(resource.page, options.signal));
      retainedFiles.set(resource.page, file);
    }
    return { file, optionalContentConditions: Array.from(resource.optionalContentConditions), matrix: Array.from(resource.matrix) };
  });
  const textureEntries = buildTextureExportEntries(scene, sceneStats, textureLayout);
  const rasterLayers = sceneRasterLayers;

  for (const entry of textureEntries) {
    throwIfBuildAborted(options.signal);
    const bytes = serializeTextureExportEntry(entry);
    archive.file(entry.filePath, bytes);
  }

  const gradientLutByteLength = scene.gradientCount * GRADIENT_LUT_WIDTH * 4;
  if (scene.gradientLut.length < gradientLutByteLength) {
    throw new Error(
      `Gradient LUT has insufficient data (${scene.gradientLut.length} < ${gradientLutByteLength}).`
    );
  }
  if (gradientLutByteLength > 0) {
    archive.file(
      GRADIENT_LUT_PATH,
      scene.gradientLut.subarray(0, gradientLutByteLength)
    );
  }


  const textIndexExport = buildTextIndexExport(scene);
  if (textIndexExport) {
    archive.file(TEXT_INDEX_JSON_PATH, textIndexExport.json);
    archive.file(TEXT_CHAR_MAP_PATH, textIndexExport.charMapBytes);
    if (textIndexExport.optionalContentBytes) archive.file(TEXT_OPTIONAL_CONTENT_PATH, textIndexExport.optionalContentBytes);
    if (textIndexExport.fallbackBytes) {
      archive.file(TEXT_FALLBACK_PATH, textIndexExport.fallbackBytes);
    }
  }

  const strokeGeometryExport = buildStrokeGeometryExport(scene);
  if (strokeGeometryExport) {
    archive.file(strokeGeometryExport.manifest.endpointsFile, strokeGeometryExport.endpointsBytes);
    archive.file(strokeGeometryExport.manifest.metaFile, strokeGeometryExport.metaBytes);
    if (strokeGeometryExport.clipBoundsBytes) {
      archive.file(strokeGeometryExport.manifest.clipBoundsFile!, strokeGeometryExport.clipBoundsBytes);
    }
  }

  // Scene structure sections. Their manifest entries are descriptors only, so a
  // clip-heavy page no longer prints tens of thousands of coordinates as JSON.
  let clipPathsManifest: { file: string; count: number; edgeCount: number } | undefined;
  if (scene.clipPaths) {
    throwIfBuildAborted(options.signal);
    archive.file(SCENE_CLIP_PATHS_PATH, encodeSceneClipPaths(scene.clipPaths));
    clipPathsManifest = { file: SCENE_CLIP_PATHS_PATH, count: scene.clipPaths.length,
      edgeCount: scene.clipPaths.reduce((total, clip) => total + clip.edges.length / 4, 0) };
  }
  let drawRunsManifest: { file: string; count: number } | undefined;
  if (scene.drawRuns) {
    throwIfBuildAborted(options.signal);
    archive.file(SCENE_DRAW_RUNS_PATH, encodeSceneDrawRuns(scene.drawRuns));
    drawRunsManifest = { file: SCENE_DRAW_RUNS_PATH, count: scene.drawRuns.length };
  }
  let paintGraphManifest: { file: string; rootCount: number } | undefined;
  if (scene.paintGraph) {
    throwIfBuildAborted(options.signal);
    archive.file(SCENE_PAINT_GRAPH_PATH, encodeScenePaintGraph(scene.paintGraph));
    paintGraphManifest = { file: SCENE_PAINT_GRAPH_PATH, rootCount: scene.paintGraph.roots.length };
  }

  const textInstancesExport = buildTextInstancesExport(scene);
  if (textInstancesExport) {
    archive.file(textInstancesExport.manifest.positionsFile, textInstancesExport.positionsBytes);
    archive.file(textInstancesExport.manifest.glyphIndexFile, textInstancesExport.glyphIndexBytes);
    if (textInstancesExport.clipReferenceBytes && textInstancesExport.clipRectBytes) {
      archive.file(TEXT_INSTANCE_CLIP_REFS_PATH, textInstancesExport.clipReferenceBytes);
      archive.file(TEXT_CLIP_RECTS_PATH, textInstancesExport.clipRectBytes);
    }
  }

  let textGlyphSegmentsManifest: TextGlyphSegmentsMeta | undefined;
  if (scene.textGlyphSegmentCount > 0) {
    throwIfBuildAborted(options.signal);
    const glyphSegments = encodeTextGlyphSegments(
      scene.textGlyphSegmentsA, scene.textGlyphSegmentsB, scene.textGlyphSegmentCount
    );
    archive.file(TEXT_GLYPH_SEGMENTS_PATH, glyphSegments.bytes);
    textGlyphSegmentsManifest = glyphSegments.meta;
  }

  const rasterLayersManifest = await writeHepRasterLayers(archive, rasterLayers, {
    encodeRasterImages,
    signal: options.signal,
    onTexelsEncoded: (processed) => reportBuildProgress(
      totalRasterTexels > 0 ? 0.4 * (processed / totalRasterTexels) : 0,
      { stage: "raster-encode", unit: "texels", processed, total: totalRasterTexels }
    )
  });
  throwIfBuildAborted(options.signal);
  reportBuildProgress(hepBuildStart, { stage: "hep-build" });

  const manifest = {
    formatVersion: rasterLayers.some(layer => layer.monochrome)
      ? PARSED_DATA_MONOCHROME_FORMAT_VERSION : PARSED_DATA_FORMAT_VERSION,
    sourceFile: label,
    sourcePdfByteLength,
    generatedAt: new Date().toISOString(),
    strokeGeometry: strokeGeometryExport?.manifest,
    textInstances: textInstancesExport?.manifest,
    textGlyphSegments: textGlyphSegmentsManifest,
    gradientLut: gradientLutByteLength > 0
      ? {
        file: GRADIENT_LUT_PATH,
        width: GRADIENT_LUT_WIDTH,
        height: scene.gradientCount,
        byteLength: gradientLutByteLength
      }
      : undefined,
    gradientMesh,
    textIndex: textIndexExport
      ? {
        version: 2,
        file: TEXT_INDEX_JSON_PATH,
        charMapFile: TEXT_CHAR_MAP_PATH,
        optionalContentFile: textIndexExport.optionalContentBytes ? TEXT_OPTIONAL_CONTENT_PATH : undefined,
        fallbackFile: textIndexExport.fallbackBytes ? TEXT_FALLBACK_PATH : undefined,
        fallbackColumnByteLengths: textIndexExport.fallbackBytes ? textIndexExport.fallbackColumnByteLengths : undefined,
        pageCount: textIndexExport.pageCount,
        totalCharCount: textIndexExport.totalCharCount,
        totalFallbackCount: textIndexExport.totalFallbackCount
      }
      : undefined,
    scene: {
      annotations,
      structure,
      bounds: scene.bounds,
      pageBounds: scene.pageBounds,
      pageRects: Array.from(scene.pageRects),
      pageTextRanges: Array.from(scene.pageTextRanges),
      pagePrimitiveRanges: scene.pagePrimitiveRanges ? Array.from(scene.pagePrimitiveRanges) : undefined,
      pageCount: scene.pageCount,
      pagesPerRow: scene.pagesPerRow,
      maxHalfWidth: scene.maxHalfWidth,
      drawRuns: drawRunsManifest,
      optionalContent: scene.optionalContent,
      retainedPages,
      paintGraph: paintGraphManifest,
      clipPaths: clipPathsManifest,
      imageLayerSegmentCount: scene.imageLayerSegmentCount,
      discardedTransparentCount: scene.discardedTransparentCount,
      discardedDegenerateCount: scene.discardedDegenerateCount,
      discardedDuplicateCount: scene.discardedDuplicateCount,
      discardedContainedCount: scene.discardedContainedCount,
      imagePaintOpCount: scene.imagePaintOpCount,
      pathCount: scene.pathCount,
      sourceSegmentCount: scene.sourceSegmentCount,
      mergedSegmentCount: scene.mergedSegmentCount,
      segmentCount: scene.segmentCount,
      fillPathCount: scene.fillPathCount,
      fillSegmentCount: scene.fillSegmentCount,
      gradientCount: scene.gradientCount,
      gradientFillPathCount: scene.gradientFillPathCount,
      gradientFillSegmentCount: scene.gradientFillSegmentCount,
      gradientStrokeRunCount: scene.gradientStrokeRunCount,
      gradientStrokeSegmentCount: scene.gradientStrokeSegmentCount,
      textInstanceCount: scene.textInstanceCount,
      textGlyphCount: scene.textGlyphCount,
      textGlyphPrimitiveCount: scene.textGlyphSegmentCount,
      rasterLayers: rasterLayersManifest
    },
    textures: textureEntries.map((entry) => ({
      name: entry.name,
      file: entry.filePath,
      width: entry.width,
      height: entry.height,
      channels: 4,
      componentType: entry.componentType,
      layout: entry.layout,
      quantizationMin: entry.quantizationMin,
      quantizationMax: entry.quantizationMax,
      byteShuffle: entry.byteShuffle === true,
      predictor: entry.predictor ?? "none",
      columnByteLengths: entry.columnByteLengths,
      logicalItemCount: entry.logicalItemCount,
      logicalFloatCount: entry.logicalFloatCount,
      byteLength: entry.data.byteLength,
      paddedFloatCount: entry.logicalFloatCount
    }))
  };

  throwIfBuildAborted(options.signal);
  const outputManifest = { ...manifest, ...(lod ? { lod } : {}) };
  archive.file("manifest.json", JSON.stringify(outputManifest));
  // Reserve progress for a possible second serialization after removing caches.
  const finalBuildEnd = sourcePdfByteLength === undefined ? 1 : 0.99;
  const firstBuildEnd = sourcePdfByteLength !== undefined && lod
    ? hepBuildStart + (1 - hepBuildStart) * 0.8
    : finalBuildEnd;
  const onHepProgress = (metadata: { percent: number }): void => {
    reportBuildProgress(
      hepBuildStart + (firstBuildEnd - hepBuildStart) * (metadata.percent / 100),
      { stage: "hep-build" }
    );
  };
  let hepBlob = await archive.generateAsync({
    type: "blob",
    compression,
    signal: options.signal
  }, onHepProgress);
  throwIfBuildAborted(options.signal);
  if (sourcePdfByteLength !== undefined && omitHepLodForSizeBudget(archive, outputManifest, hepBlob.size, sourcePdfByteLength)) {
    throwIfBuildAborted(options.signal);
    hepBlob = await archive.generateAsync({ type: "blob", compression, signal: options.signal }, metadata => {
      reportBuildProgress(firstBuildEnd + (finalBuildEnd - firstBuildEnd) * (metadata.percent / 100), { stage: "hep-build" });
    });
    throwIfBuildAborted(options.signal);
  }
  assertHepSizeBelowPdf(hepBlob.size, sourcePdfByteLength, label);
  reportBuildProgress(1, { stage: "hep-build" });
  throwIfBuildAborted(options.signal);

  return {
    blob: hepBlob,
    byteLength: hepBlob.size,
    textureCount: textureEntries.length + (gradientLutByteLength > 0 ? 1 : 0),
    rasterLayerCount: rasterLayers.length,
    layout: textureLayout
  };
}

function countRasterTexelsToEncode(rasterLayers: readonly RasterLayer[]): number {
  let total = 0;
  for (let i = 0; i < rasterLayers.length; i += 1) {
    const layer = rasterLayers[i];
    const texels = layer.width * layer.height;
    if (
      !Number.isSafeInteger(layer.width) ||
      !Number.isSafeInteger(layer.height) ||
      layer.width <= 0 ||
      layer.height <= 0 ||
      !Number.isSafeInteger(texels)
    ) {
      throw new Error(`Raster layer ${i} has invalid dimensions.`);
    }
    total += texels;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Raster layers contain too many texels to encode safely.");
    }
  }
  return total;
}

function throwIfBuildAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/**
 * A small layer keeps its own lossy WebP section only when that, with the
 * section's own index record and image header, needs at most 1/N of the bytes
 * of its lossless form, as photographs do. Thin strips and icons join an atlas
 * even when WebP looks smaller: that lead is mostly per-image overhead the
 * atlas does not pay.
 */
const RASTER_ATLAS_LOSSY_ADVANTAGE = 2;
const RASTER_SECTION_OVERHEAD_BYTES = 64;

/**
 * Write the raster layer table: every layer keeps its own record, and the
 * pixels of small lossless layers share PNG atlases instead of paying for a
 * section, a PNG header and a JSON record each. A repeated image is encoded
 * once, and small repeats share one atlas cell. Monochrome layers keep their
 * canonical packed rows and palette, without materializing RGBA or image codecs.
 * See `hepRasterLayers`.
 */
async function writeHepRasterLayers(
  archive: HepArchive,
  layers: readonly RasterLayer[],
  options: {
    encodeRasterImages: boolean;
    signal?: AbortSignal;
    onTexelsEncoded: (processed: number) => void;
  }
): Promise<{ file: string; count: number; atlasCount: number } | undefined> {
  if (layers.length === 0) {
    return undefined;
  }
  const records: RasterLayerRecord[] = [];
  const pixels: Uint8Array[] = [];
  const encoded: Array<{ storage: "png" | "webp"; bytes: Uint8Array } | null> = [];
  const identical = new IdenticalRasterFinder();
  /** The first earlier layer with identical pixels, or -1. */
  const originals: number[] = [];
  const joinsAtlas: boolean[] = [];
  const atlasMembers: number[] = [];
  let encodedTexels = 0;
  let lastYield = performance.now();
  for (let i = 0; i < layers.length; i += 1) {
    throwIfBuildAborted(options.signal);
    const layer = layers[i];
    const expectedBytes = layer.width * layer.height * 4;
    if (
      !Number.isSafeInteger(layer.width) ||
      !Number.isSafeInteger(layer.height) ||
      !Number.isSafeInteger(expectedBytes) ||
      layer.width <= 0 ||
      layer.height <= 0
    ) {
      throw new Error(`Raster layer ${i} has invalid dimensions.`);
    }
    if (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) {
      throw new Error(`Raster layer ${i} has invalid opacity.`);
    }
    if (layer.matrix.length !== 6 || !layer.matrix.every(Number.isFinite)) {
      throw new Error(`Raster layer ${i} has an invalid transform matrix.`);
    }
    const record: RasterLayerRecord = {
      width: layer.width,
      height: layer.height,
      matrix: layer.matrix,
      paintOrder: Number.isFinite(layer.paintOrder) ? Math.max(0, Math.trunc(layer.paintOrder)) : 0,
      pageIndex: Number.isFinite(layer.pageIndex) ? Math.max(0, Math.trunc(layer.pageIndex)) : 0,
      ...(layer.opacity === undefined ? {} : { opacity: layer.opacity }),
      storage: "rgba"
    };
    if (layer.monochrome) {
      archive.file(rasterLayerFile(i, "mono"), encodeHepMonochromeRaster(layer.monochrome, layer.width, layer.height, options.signal));
      record.storage = "mono";
      records.push(record);
      pixels.push(new Uint8Array(0));
      encoded.push(null);
      originals.push(-1);
      joinsAtlas.push(false);
      if (options.encodeRasterImages) {
        encodedTexels += layer.width * layer.height;
        options.onTexelsEncoded(encodedTexels);
      }
      // Packed copies have no image-encoder await to let progress repaint or cancellation run.
      if (performance.now() - lastYield >= 8) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        throwIfBuildAborted(options.signal);
        lastYield = performance.now();
      }
      continue;
    }
    if (!(layer.data instanceof Uint8Array) || layer.data.byteLength < expectedBytes) {
      throw new Error(`Raster layer ${i} has insufficient RGBA data.`);
    }
    const rgba = layer.data.subarray(0, expectedBytes);
    const original = identical.findOrAdd(i, layer.width, layer.height, rgba);
    let best: { storage: "png" | "webp"; bytes: Uint8Array } | null = null;
    let lossyWins = false;
    if (original >= 0) {
      // A repeated image reuses the first copy's encoding and atlas cell.
      best = encoded[original];
    } else if (options.encodeRasterImages) {
      const candidates = await encodeRasterRgbaCandidates(layer.width, layer.height, rgba);
      throwIfBuildAborted(options.signal);
      const image = pickBestRasterImage(layer.width, layer.height, candidates);
      best = image ? { storage: image.encoding, bytes: image.bytes } : null;
      const losslessBytes = Math.min(candidates.png?.byteLength ?? expectedBytes, expectedBytes);
      lossyWins = best?.storage === "webp" &&
        (best.bytes.byteLength + RASTER_SECTION_OVERHEAD_BYTES) * RASTER_ATLAS_LOSSY_ADVANTAGE <= losslessBytes;
    }
    if (options.encodeRasterImages) {
      encodedTexels += layer.width * layer.height;
      options.onTexelsEncoded(encodedTexels);
    }
    pixels.push(rgba);
    encoded.push(best);
    originals.push(original);
    joinsAtlas.push(original >= 0 ? joinsAtlas[original] : isRasterAtlasCandidate(layer.width, layer.height) && !lossyWins);
    record.storage = best?.storage ?? "rgba";
    records.push(record);
    if (joinsAtlas[i]) {
      atlasMembers.push(i);
    }
  }

  // A lone small layer gains nothing from an atlas of its own.
  const atlases: RasterAtlasRecord[] = [];
  if (atlasMembers.length >= 2) {
    // Only first copies get cells; repeats point at their original's cell.
    const packedMembers = atlasMembers.filter(index => originals[index] < 0);
    const packed = packRasterAtlases(packedMembers.map(index => records[index]));
    const atlasPixels = packed.atlases.map(({ width, height }) => new Uint8Array(width * height * 4));
    packedMembers.forEach((layerIndex, member) => {
      const cell = packed.cells[member];
      const record = records[layerIndex];
      copyRasterRect(
        pixels[layerIndex], record.width, 0, 0,
        atlasPixels[cell.atlas], packed.atlases[cell.atlas].width, cell.x, cell.y,
        record.width, record.height
      );
      record.storage = "atlas";
      record.cell = cell;
    });
    for (const layerIndex of atlasMembers) {
      const original = originals[layerIndex];
      if (original >= 0) {
        records[layerIndex].storage = "atlas";
        records[layerIndex].cell = { ...records[original].cell! };
      }
    }
    for (let index = 0; index < atlasPixels.length; index += 1) {
      throwIfBuildAborted(options.signal);
      const { width, height } = packed.atlases[index];
      // Lossless only: lossy blocks would bleed between unrelated cells.
      const png = options.encodeRasterImages ? await encodeRasterRgbaAsPng(width, height, atlasPixels[index]) : null;
      throwIfBuildAborted(options.signal);
      if (png) {
        archive.file(rasterAtlasFile(index, "png"), png, { compression: "STORE" });
      } else {
        archive.file(rasterAtlasFile(index, "rgba"), atlasPixels[index]);
      }
      atlases.push({ encoding: png ? "png" : "rgba", width, height });
    }
  }

  records.forEach((record, index) => {
    if (record.storage === "atlas" || record.storage === "mono") return;
    const image = encoded[index];
    if (image) {
      // WebP and PNG already carry entropy compression; deflating them again
      // wastes export time and normally cannot recover meaningful bytes.
      archive.file(rasterLayerFile(index, image.storage), image.bytes, { compression: "STORE" });
    } else {
      archive.file(rasterLayerFile(index, "rgba"), pixels[index]);
    }
  });
  archive.file(SCENE_RASTER_LAYERS_PATH, encodeRasterLayerTable({ atlases, layers: records }));
  return { file: SCENE_RASTER_LAYERS_PATH, count: records.length, atlasCount: atlases.length };
}

function buildTextIndexExport(scene: VectorScene): TextIndexExportResult | null {
  const pages = scene.textIndex?.pages;
  if (!pages || pages.length === 0) {
    return null;
  }

  const pageEntries: Array<{ text: string; charCount: number; fallbackCount: number }> = [];
  let totalCharCount = 0;
  let totalFallbackCount = 0;
  for (const page of pages) {
    const valid = page.charInstance.length === page.text.length;
    const text = valid ? page.text : "";
    const fallbackCount = valid ? Math.floor(page.fallbackQuads.length / 4) : 0;
    pageEntries.push({ text, charCount: text.length, fallbackCount });
    totalCharCount += text.length;
    totalFallbackCount += fallbackCount;
  }

  if (totalCharCount === 0) {
    return null;
  }

  // One varint token per code unit: 0 = separator, 1 = next fallback slot,
  // t >= 2 = instance = prevInstance + 1 + zigzag(t - 2). Instances are
  // monotone in char order, so the dominant token is 2 (expected +1 step).
  const charMap = new ByteWriter(totalCharCount + 16);
  let prevInstance = -1;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (pageEntries[pageIndex].charCount === 0) {
      continue;
    }
    const refs = pages[pageIndex].charInstance;
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      if (ref === -1) {
        charMap.writeByte(0);
      } else if (ref <= -2) {
        charMap.writeByte(1);
      } else {
        charMap.writeVarUint32(zigzagEncode32(ref - prevInstance - 1) + 2);
        prevInstance = ref;
      }
    }
  }

  let fallbackBytes: Uint8Array | null = null;
  const optionalContent = pages.some(page => page.optionalContent !== undefined)
    ? new ByteWriter(totalCharCount + 16) : null;
  if (optionalContent) for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const associations = pages[pageIndex].optionalContent;
    for (let index = 0; index < pageEntries[pageIndex].charCount; index++) optionalContent.writeVarUint32((associations?.[index] ?? -1) + 1);
  }
  const fallbackColumnByteLengths: number[] = [];
  if (totalFallbackCount > 0) {
    const quads = new Float32Array(totalFallbackCount * 4);
    let quadOffset = 0;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const fallbackCount = pageEntries[pageIndex].fallbackCount;
      if (fallbackCount === 0) {
        continue;
      }
      quads.set(pages[pageIndex].fallbackQuads.subarray(0, fallbackCount * 4), quadOffset);
      quadOffset += fallbackCount * 4;
    }
    const columns: Uint8Array[] = [];
    let totalBytes = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const column = encodeFixed512DeltaColumn(quads, totalFallbackCount, 4, channel);
      columns.push(column);
      fallbackColumnByteLengths.push(column.length);
      totalBytes += column.length;
    }
    fallbackBytes = new Uint8Array(totalBytes);
    let byteOffset = 0;
    for (const column of columns) {
      fallbackBytes.set(column, byteOffset);
      byteOffset += column.length;
    }
  }

  return {
    json: JSON.stringify({ version: 2, pages: pageEntries }),
    charMapBytes: charMap.toUint8Array(),
    optionalContentBytes: optionalContent?.toUint8Array() ?? null,
    fallbackBytes,
    fallbackColumnByteLengths,
    pageCount: pageEntries.length,
    totalCharCount,
    totalFallbackCount
  };
}

const TEXT_INSTANCE_GLYPHS_U16_PATH = "geometry/text-instance-glyphs.u16";
const TEXT_INSTANCE_GLYPHS_U32_PATH = "geometry/text-instance-glyphs.u32";
const TEXT_INSTANCE_CLIP_REFS_PATH = "geometry/text-instance-clips.u32";
const TEXT_CLIP_RECTS_PATH = "geometry/text-clip-rects.f32";

/**
 * Text instance storage: e/f on the fixed-point 1/512 grid (quantization
 * approved: max error 1/1024 scene unit) with advance-predicted e steps (v9,
 * see `hepTextSections`), glyph indices as a raw u16/u32 column. The 4th
 * channel is stored only as the optional clip references.
 */
function buildTextInstancesExport(scene: VectorScene): TextInstancesExport | null {
  const count = Math.max(0, Math.trunc(scene.textInstanceCount));
  if (count === 0) {
    return null;
  }
  if (scene.textInstanceA.length < count * 4 || scene.textInstanceB.length < count * 4) {
    throw new Error("Text instance data is incomplete.");
  }

  const source = scene.textInstanceB.subarray(0, count * 4);
  const clipRects = scene.textClipRects;
  const clipRectCount = Math.floor((clipRects?.length ?? 0) / 4);
  if ((clipRects?.length ?? 0) % 4 !== 0 || clipRects?.some((value) => !Number.isFinite(value))) {
    throw new Error("Text clip rectangles are invalid.");
  }
  for (let index = 0; index < clipRectCount; index += 1) {
    const offset = index * 4;
    if (clipRects![offset] >= clipRects![offset + 2] ||
        clipRects![offset + 1] >= clipRects![offset + 3]) {
      throw new Error("Text clip rectangle is empty or reversed.");
    }
  }
  for (let index = 0; index < count; index += 1) {
    const reference = source[index * 4 + 3];
    if (!Number.isInteger(reference) || reference < 0 || reference > clipRectCount) {
      throw new Error("Text clip reference is out of range.");
    }
  }
  let maxGlyphIndex = 0;
  for (let i = 0; i < count; i += 1) {
    const glyphIndex = Math.max(0, Math.trunc(source[i * 4 + 2]));
    if (glyphIndex > maxGlyphIndex) {
      maxGlyphIndex = glyphIndex;
    }
  }
  const useU32 = maxGlyphIndex > 65535;
  const glyphIndices = useU32 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i += 1) {
    glyphIndices[i] = Math.max(0, Math.trunc(source[i * 4 + 2]));
  }
  // The reader predicts positions from the glyph indices and matrices it has
  // already decoded, so the writer predicts from exactly the stored values.
  const positions = encodeTextInstancePositions(scene.textInstanceA, source, glyphIndices, count);

  return {
    positionsBytes: positions.bytes,
    glyphIndexBytes: new Uint8Array(glyphIndices.buffer),
    ...(clipRects && clipRects.length > 0 ? {
      clipReferenceBytes: new Uint8Array(Uint32Array.from(
        { length: count },
        (_, index) => Math.max(0, Math.trunc(source[index * 4 + 3]))
      ).buffer),
      clipRectBytes: new Uint8Array(
        clipRects.buffer,
        clipRects.byteOffset,
        clipRects.byteLength
      )
    } : {}),
    manifest: {
      positionsFile: TEXT_INSTANCE_POSITIONS_PATH,
      glyphIndexFile: useU32 ? TEXT_INSTANCE_GLYPHS_U32_PATH : TEXT_INSTANCE_GLYPHS_U16_PATH,
      glyphIndexFormat: useU32 ? "u32" : "u16",
      count,
      positionColumnByteLengths: positions.columnByteLengths,
      ...(clipRects && clipRects.length > 0 ? {
        clipRectsFile: TEXT_CLIP_RECTS_PATH,
        clipReferencesFile: TEXT_INSTANCE_CLIP_REFS_PATH,
        clipRectCount
      } : {})
    }
  };
}

function buildTextureExportEntries(scene: VectorScene, sceneStats: SceneTextureStats, textureLayout: TextureLayout): ExportTextureEntry[] {
  return [
    createTextureExportEntry("fill-path-meta-a", scene.fillPathMetaA, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-path-meta-b", scene.fillPathMetaB, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-path-meta-c", scene.fillPathMetaC, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-primitives-a", scene.fillSegmentsA, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount, textureLayout),
    createTextureExportEntry("fill-primitives-b", scene.fillSegmentsB, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount, textureLayout),
    // Stroke endpoints/meta live in the v5 strokeGeometry section. Ordinary
    // bounds are derived on load; sparse semantic clip bounds live alongside
    // that section only when clipped strokes exist.
    createTextureExportEntry("stroke-styles", scene.styles, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("text-instance-a", scene.textInstanceA, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    // text-instance-b lives in the v5 textInstances section.
    createTextureExportEntry("text-instance-c", scene.textInstanceC, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-a", scene.textGlyphMetaA, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-b", scene.textGlyphMetaB, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    // Glyph outlines live in the v9 textGlyphSegments section.
    createTextureExportEntry("gradient-meta-a", scene.gradientMetaA, sceneStats.gradientTextureWidth, sceneStats.gradientTextureHeight, scene.gradientCount, textureLayout),
    createTextureExportEntry("gradient-meta-b", scene.gradientMetaB, sceneStats.gradientTextureWidth, sceneStats.gradientTextureHeight, scene.gradientCount, textureLayout),
    createTextureExportEntry("gradient-meta-c", scene.gradientMetaC, sceneStats.gradientTextureWidth, sceneStats.gradientTextureHeight, scene.gradientCount, textureLayout),
    createTextureExportEntry("gradient-meta-d", scene.gradientMetaD, sceneStats.gradientTextureWidth, sceneStats.gradientTextureHeight, scene.gradientCount, textureLayout),
    createTextureExportEntry("gradient-meta-e", scene.gradientMetaE, sceneStats.gradientTextureWidth, sceneStats.gradientTextureHeight, scene.gradientCount, textureLayout),
    createTextureExportEntry("gradient-fill-path-meta-a", scene.gradientFillPathMetaA, sceneStats.gradientFillPathTextureWidth, sceneStats.gradientFillPathTextureHeight, scene.gradientFillPathCount, textureLayout),
    createTextureExportEntry("gradient-fill-path-meta-b", scene.gradientFillPathMetaB, sceneStats.gradientFillPathTextureWidth, sceneStats.gradientFillPathTextureHeight, scene.gradientFillPathCount, textureLayout),
    createTextureExportEntry("gradient-fill-path-meta-c", scene.gradientFillPathMetaC, sceneStats.gradientFillPathTextureWidth, sceneStats.gradientFillPathTextureHeight, scene.gradientFillPathCount, textureLayout),
    createTextureExportEntry("gradient-fill-paint-meta", scene.gradientFillPaintMeta, sceneStats.gradientFillPathTextureWidth, sceneStats.gradientFillPathTextureHeight, scene.gradientFillPathCount, textureLayout),
    createTextureExportEntry("gradient-fill-primitives-a", scene.gradientFillSegmentsA, sceneStats.gradientFillSegmentTextureWidth, sceneStats.gradientFillSegmentTextureHeight, scene.gradientFillSegmentCount, textureLayout),
    createTextureExportEntry("gradient-fill-primitives-b", scene.gradientFillSegmentsB, sceneStats.gradientFillSegmentTextureWidth, sceneStats.gradientFillSegmentTextureHeight, scene.gradientFillSegmentCount, textureLayout),
    createTextureExportEntry("gradient-stroke-run-meta-a", scene.gradientStrokeRunMetaA, sceneStats.gradientStrokeRunTextureWidth, sceneStats.gradientStrokeRunTextureHeight, scene.gradientStrokeRunCount, textureLayout),
    createTextureExportEntry("gradient-stroke-run-meta-b", scene.gradientStrokeRunMetaB, sceneStats.gradientStrokeRunTextureWidth, sceneStats.gradientStrokeRunTextureHeight, scene.gradientStrokeRunCount, textureLayout),
    createTextureExportEntry("gradient-stroke-endpoints", scene.gradientStrokeEndpoints, sceneStats.gradientStrokeSegmentTextureWidth, sceneStats.gradientStrokeSegmentTextureHeight, scene.gradientStrokeSegmentCount, textureLayout),
    createTextureExportEntry("gradient-stroke-primitive-meta", scene.gradientStrokePrimitiveMeta, sceneStats.gradientStrokeSegmentTextureWidth, sceneStats.gradientStrokeSegmentTextureHeight, scene.gradientStrokeSegmentCount, textureLayout),
    createTextureExportEntry("gradient-stroke-primitive-bounds", scene.gradientStrokePrimitiveBounds, sceneStats.gradientStrokeSegmentTextureWidth, sceneStats.gradientStrokeSegmentTextureHeight, scene.gradientStrokeSegmentCount, textureLayout),
    createTextureExportEntry("gradient-stroke-styles", scene.gradientStrokeStyles, sceneStats.gradientStrokeSegmentTextureWidth, sceneStats.gradientStrokeSegmentTextureHeight, scene.gradientStrokeSegmentCount, textureLayout)
  ];
}

function createTextureExportEntry(
  name: string,
  source: Float32Array,
  width: number,
  height: number,
  logicalItemCount: number,
  textureLayout: TextureLayout
): ExportTextureEntry {
  const logicalFloatCount = logicalItemCount * 4;
  if (source.length < logicalFloatCount) {
    throw new Error(`Texture ${name} has insufficient data (${source.length} < ${logicalFloatCount}).`);
  }
  const logicalSource = source.subarray(0, logicalFloatCount);
  const packed = packTextureForZip(name, logicalSource, textureLayout);

  return {
    name,
    filePath: `textures/${name}${packed.suffix}`,
    width,
    height,
    logicalItemCount,
    logicalFloatCount,
    data: packed.data,
    componentType: packed.componentType,
    layout: packed.layout,
    quantizationMin: packed.quantizationMin,
    quantizationMax: packed.quantizationMax,
    byteShuffle: packed.byteShuffle,
    predictor: packed.predictor,
    columnByteLengths: packed.columnByteLengths
  };
}

function serializeTextureExportEntry(entry: ExportTextureEntry): Uint8Array {
  return entry.data;
}
