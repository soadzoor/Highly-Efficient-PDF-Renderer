import JSZip from "jszip";

import {
  extractPdfRasterScene,
  type Bounds,
  type RasterLayer,
  type VectorScene
} from "./pdfVectorExtractor";
import {
  decodeByteShuffledFloat32,
  decodeChannelMajorFloat32,
  decodeXorDeltaByteShuffledFloat32,
  encodeChannelMajorFloat32
} from "./parsedDataEncoding";

interface ExportTextureEntry {
  name: string;
  filePath: string;
  width: number;
  height: number;
  logicalItemCount: number;
  logicalFloatCount: number;
  data: Float32Array;
  layout: TextureLayout;
}

export interface SceneTextureStats {
  fillPathTextureWidth: number;
  fillPathTextureHeight: number;
  fillSegmentTextureWidth: number;
  fillSegmentTextureHeight: number;
  textureWidth: number;
  textureHeight: number;
  textInstanceTextureWidth: number;
  textInstanceTextureHeight: number;
  textGlyphTextureWidth: number;
  textGlyphTextureHeight: number;
  textSegmentTextureWidth: number;
  textSegmentTextureHeight: number;
}

export type TextureLayout = "interleaved" | "channel-major";

export interface BuildParsedDataZipOptions {
  encodeRasterImages?: boolean;
  zipCompression?: "STORE" | "DEFLATE";
  zipDeflateLevel?: number;
}

interface ParsedDataTextureEntry {
  name?: unknown;
  file?: unknown;
  componentType?: unknown;
  layout?: unknown;
  byteShuffle?: unknown;
  predictor?: unknown;
  logicalItemCount?: unknown;
  logicalFloatCount?: unknown;
}

interface ParsedDataRasterLayerEntry {
  width?: unknown;
  height?: unknown;
  matrix?: unknown;
  file?: unknown;
  encoding?: unknown;
}

interface ParsedDataSceneEntry {
  bounds?: unknown;
  pageBounds?: unknown;
  pageRects?: unknown;
  pageCount?: unknown;
  pagesPerRow?: unknown;
  maxHalfWidth?: unknown;
  operatorCount?: unknown;
  imagePaintOpCount?: unknown;
  pathCount?: unknown;
  sourceSegmentCount?: unknown;
  mergedSegmentCount?: unknown;
  segmentCount?: unknown;
  fillPathCount?: unknown;
  fillSegmentCount?: unknown;
  sourceTextCount?: unknown;
  textInstanceCount?: unknown;
  textGlyphCount?: unknown;
  textGlyphPrimitiveCount?: unknown;
  textGlyphSegmentCount?: unknown;
  textInPageCount?: unknown;
  textOutOfPageCount?: unknown;
  discardedTransparentCount?: unknown;
  discardedDegenerateCount?: unknown;
  discardedDuplicateCount?: unknown;
  discardedContainedCount?: unknown;
  rasterLayers?: unknown;
  rasterLayerWidth?: unknown;
  rasterLayerHeight?: unknown;
  rasterLayerMatrix?: unknown;
  rasterLayerFile?: unknown;
}

interface ParsedDataManifest {
  formatVersion?: unknown;
  sourceFile?: unknown;
  sourcePdfFile?: unknown;
  sourcePdfUrl?: unknown;
  sourcePdfSizeBytes?: unknown;
  scene?: ParsedDataSceneEntry;
  textures?: ParsedDataTextureEntry[];
}

export interface ParsedDataZipBlobResult {
  blob: Blob;
  byteLength: number;
  textureCount: number;
  rasterLayerCount: number;
  layout: TextureLayout;
}

interface SerializedRasterLayerEntry {
  width: number;
  height: number;
  matrix: number[];
  file: string;
  encoding: "webp" | "png" | "rgba";
}

export async function buildParsedDataZipBlobForLayout(
  scene: VectorScene,
  sceneStats: SceneTextureStats,
  label: string,
  sourcePdfBytes: Uint8Array | null,
  textureLayout: TextureLayout,
  sceneRasterLayers: RasterLayer[],
  options: BuildParsedDataZipOptions = {}
): Promise<ParsedDataZipBlobResult> {
  const encodeRasterImages = options.encodeRasterImages ?? true;
  const zipCompression = options.zipCompression ?? "DEFLATE";
  const zipDeflateLevel = options.zipDeflateLevel ?? 9;

  const zip = new JSZip();
  const textureEntries = buildTextureExportEntries(scene, sceneStats, textureLayout);
  const includeSourcePdf = !!sourcePdfBytes && sourcePdfBytes.length > 0 && scene.imagePaintOpCount > 0;
  const useSourcePdfFallback = includeSourcePdf && sceneRasterLayers.length === 0;
  const rasterLayers = useSourcePdfFallback ? [] : sceneRasterLayers;
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const sourcePdfFile = useSourcePdfFallback ? "source/source.pdf" : undefined;

  for (const entry of textureEntries) {
    const bytes = entry.layout === "channel-major"
      ? encodeChannelMajorFloat32(entry.data)
      : new Uint8Array(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    zip.file(entry.filePath, bytes);
  }

  if (sourcePdfFile && sourcePdfBytes) {
    zip.file(sourcePdfFile, sourcePdfBytes);
  }

  const serializedRasterLayers: SerializedRasterLayerEntry[] = [];
  for (let i = 0; i < rasterLayers.length; i += 1) {
    const layer = rasterLayers[i];
    const expectedBytes = layer.width * layer.height * 4;
    const rasterBytes = layer.data.subarray(0, expectedBytes);
    let filePath = `raster/layer-${i}.rgba`;
    let encoding: "webp" | "png" | "rgba" = "rgba";
    let layerBytes: Uint8Array = rasterBytes;
    if (encodeRasterImages) {
      const encodedImage = await encodeRasterLayerAsBestImage(layer.width, layer.height, rasterBytes);
      if (encodedImage) {
        filePath = `raster/layer-${i}.${encodedImage.extension}`;
        encoding = encodedImage.encoding;
        layerBytes = encodedImage.bytes;
      }
    }
    zip.file(filePath, layerBytes, { compression: "STORE" });
    serializedRasterLayers.push({
      width: layer.width,
      height: layer.height,
      matrix: Array.from(layer.matrix),
      file: filePath,
      encoding
    });
  }

  const manifest = {
    formatVersion: 3,
    sourceFile: label,
    sourcePdfFile,
    sourcePdfSizeBytes: useSourcePdfFallback ? sourcePdfBytes?.length ?? 0 : 0,
    generatedAt: new Date().toISOString(),
    scene: {
      bounds: scene.bounds,
      pageBounds: scene.pageBounds,
      pageRects: Array.from(scene.pageRects),
      pageCount: scene.pageCount,
      pagesPerRow: scene.pagesPerRow,
      maxHalfWidth: scene.maxHalfWidth,
      operatorCount: scene.operatorCount,
      imagePaintOpCount: scene.imagePaintOpCount,
      pathCount: scene.pathCount,
      sourceSegmentCount: scene.sourceSegmentCount,
      mergedSegmentCount: scene.mergedSegmentCount,
      segmentCount: scene.segmentCount,
      fillPathCount: scene.fillPathCount,
      fillSegmentCount: scene.fillSegmentCount,
      textInstanceCount: scene.textInstanceCount,
      textGlyphCount: scene.textGlyphCount,
      textGlyphPrimitiveCount: scene.textGlyphSegmentCount,
      rasterLayers: serializedRasterLayers,
      rasterLayerWidth: primaryRasterLayer?.width ?? 0,
      rasterLayerHeight: primaryRasterLayer?.height ?? 0,
      rasterLayerMatrix: primaryRasterLayer ? Array.from(primaryRasterLayer.matrix) : undefined,
      rasterLayerFile: serializedRasterLayers[0]?.file
    },
    textures: textureEntries.map((entry) => ({
      name: entry.name,
      file: entry.filePath,
      width: entry.width,
      height: entry.height,
      channels: 4,
      componentType: "float32",
      layout: entry.layout,
      byteShuffle: false,
      predictor: "none",
      logicalItemCount: entry.logicalItemCount,
      logicalFloatCount: entry.logicalFloatCount,
      paddedFloatCount: entry.data.length
    }))
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const zipGenerateOptions =
    zipCompression === "DEFLATE"
      ? {
          type: "blob" as const,
          compression: "DEFLATE" as const,
          compressionOptions: { level: zipDeflateLevel }
        }
      : {
          type: "blob" as const,
          compression: "STORE" as const
        };

  const zipBlob = await zip.generateAsync(zipGenerateOptions);

  return {
    blob: zipBlob,
    byteLength: zipBlob.size,
    textureCount: textureEntries.length,
    rasterLayerCount: rasterLayers.length,
    layout: textureLayout
  };
}

function buildTextureExportEntries(scene: VectorScene, sceneStats: SceneTextureStats, textureLayout: TextureLayout): ExportTextureEntry[] {
  return [
    createTextureExportEntry("fill-path-meta-a", scene.fillPathMetaA, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-path-meta-b", scene.fillPathMetaB, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-path-meta-c", scene.fillPathMetaC, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-primitives-a", scene.fillSegmentsA, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount, textureLayout),
    createTextureExportEntry("fill-primitives-b", scene.fillSegmentsB, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount, textureLayout),
    createTextureExportEntry("stroke-primitives-a", scene.endpoints, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("stroke-primitives-b", scene.primitiveMeta, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("stroke-styles", scene.styles, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("stroke-primitive-bounds", scene.primitiveBounds, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("text-instance-a", scene.textInstanceA, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-instance-b", scene.textInstanceB, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-instance-c", scene.textInstanceC, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-a", scene.textGlyphMetaA, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-b", scene.textGlyphMetaB, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-primitives-a", scene.textGlyphSegmentsA, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount, textureLayout),
    createTextureExportEntry("text-glyph-primitives-b", scene.textGlyphSegmentsB, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount, textureLayout)
  ];
}

export async function loadSceneFromParsedDataZip(buffer: ArrayBuffer): Promise<VectorScene> {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Parsed data zip is missing manifest.json.");
  }

  const manifestJson = await manifestFile.async("string");
  let manifest: ParsedDataManifest;
  try {
    manifest = JSON.parse(manifestJson) as ParsedDataManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid manifest.json: ${message}`);
  }

  const sceneMeta = typeof manifest.scene === "object" && manifest.scene ? manifest.scene : {};
  const manifestTextures = Array.isArray(manifest.textures) ? manifest.textures : [];

  const textureByName = new Map<string, ParsedDataTextureEntry>();
  for (const entry of manifestTextures) {
    const name = typeof entry.name === "string" ? entry.name : null;
    if (!name) {
      continue;
    }
    textureByName.set(name, entry);
  }

  const readTexture = async (
    candidateNames: string[],
    required: boolean
  ): Promise<{ data: Float32Array; logicalItemCount: number } | null> => {
    for (const candidate of candidateNames) {
      const entry = textureByName.get(candidate);
      if (!entry) {
        continue;
      }

      const inferredSuffix =
        typeof entry.layout === "string" && entry.layout === "channel-major"
          ? ".f32cm"
          : entry.byteShuffle === true
            ? ".f32bs"
            : ".f32";
      const path = typeof entry.file === "string" ? entry.file : `textures/${candidate}${inferredSuffix}`;
      const zipEntry = zip.file(path);
      if (!zipEntry) {
        continue;
      }

      const fileBuffer = await zipEntry.async("arraybuffer");
      const raw = readTexturePayloadAsFloat32(fileBuffer, entry, candidate);
      const logicalFloatCount = readNonNegativeInt(entry.logicalFloatCount, raw.length);
      if (logicalFloatCount > raw.length) {
        throw new Error(`Texture ${candidate} logical float count exceeds file length.`);
      }

      const logicalItemCount = readNonNegativeInt(entry.logicalItemCount, Math.floor(logicalFloatCount / 4));
      return {
        data: raw.slice(0, logicalFloatCount),
        logicalItemCount
      };
    }

    if (required) {
      throw new Error(`Parsed data zip is missing required texture: ${candidateNames[0]}.`);
    }

    return null;
  };

  const fillPathMetaAEntry = await readTexture(["fill-path-meta-a"], false);
  const fillPathMetaBEntry = await readTexture(["fill-path-meta-b"], false);
  const fillPathMetaCEntry = await readTexture(["fill-path-meta-c"], false);
  const fillPrimitiveAEntry = await readTexture(["fill-primitives-a", "fill-segments"], false);
  const fillPrimitiveBEntry = await readTexture(["fill-primitives-b"], false);
  const strokePrimitiveAEntry = await readTexture(["stroke-primitives-a", "stroke-endpoints"], false);
  const strokePrimitiveBEntry = await readTexture(["stroke-primitives-b"], false);
  const strokeStylesEntry = await readTexture(["stroke-styles"], false);
  const strokePrimitiveBoundsEntry = await readTexture(["stroke-primitive-bounds"], false);
  const textInstanceAEntry = await readTexture(["text-instance-a"], false);
  const textInstanceBEntry = await readTexture(["text-instance-b"], false);
  const textInstanceCEntry = await readTexture(["text-instance-c"], false);
  const textGlyphMetaAEntry = await readTexture(["text-glyph-meta-a"], false);
  const textGlyphMetaBEntry = await readTexture(["text-glyph-meta-b"], false);
  const textGlyphPrimitiveAEntry = await readTexture(["text-glyph-primitives-a"], false);
  const textGlyphPrimitiveBEntry = await readTexture(["text-glyph-primitives-b"], false);

  const fillPathCount = readNonNegativeInt(sceneMeta.fillPathCount, fillPathMetaAEntry?.logicalItemCount ?? 0);
  const fillSegmentCount = readNonNegativeInt(sceneMeta.fillSegmentCount, fillPrimitiveAEntry?.logicalItemCount ?? 0);
  const segmentCount = readNonNegativeInt(
    sceneMeta.segmentCount,
    strokeStylesEntry?.logicalItemCount ?? strokePrimitiveAEntry?.logicalItemCount ?? 0
  );
  const textInstanceCount = readNonNegativeInt(sceneMeta.textInstanceCount, textInstanceAEntry?.logicalItemCount ?? 0);
  const textGlyphCount = readNonNegativeInt(sceneMeta.textGlyphCount, textGlyphMetaAEntry?.logicalItemCount ?? 0);
  const textGlyphSegmentCount = readNonNegativeInt(
    sceneMeta.textGlyphPrimitiveCount,
    readNonNegativeInt(sceneMeta.textGlyphSegmentCount, textGlyphPrimitiveAEntry?.logicalItemCount ?? 0)
  );

  if (segmentCount > 0 && (!strokePrimitiveAEntry || !strokeStylesEntry)) {
    throw new Error("Parsed data zip is missing stroke geometry textures.");
  }

  const fillPathMetaA = trimTextureForItemCount(fillPathMetaAEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-a");
  const fillPathMetaB = trimTextureForItemCount(fillPathMetaBEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-b");
  const fillPathMetaC = trimTextureForItemCount(fillPathMetaCEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-c");
  const fillSegmentsA = trimTextureForItemCount(fillPrimitiveAEntry?.data ?? new Float32Array(0), fillSegmentCount, "fill-primitives-a");
  const fillSegmentsB = fillPrimitiveBEntry
    ? trimTextureForItemCount(fillPrimitiveBEntry.data, fillSegmentCount, "fill-primitives-b")
    : deriveLinePrimitiveB(fillSegmentsA, fillSegmentCount);

  const endpoints = trimTextureForItemCount(strokePrimitiveAEntry?.data ?? new Float32Array(0), segmentCount, "stroke-primitives-a");
  const styles = trimTextureForItemCount(strokeStylesEntry?.data ?? new Float32Array(0), segmentCount, "stroke-styles");
  const primitiveMeta = strokePrimitiveBEntry
    ? trimTextureForItemCount(strokePrimitiveBEntry.data, segmentCount, "stroke-primitives-b")
    : deriveLinePrimitiveB(endpoints, segmentCount);
  const primitiveBounds = strokePrimitiveBoundsEntry
    ? trimTextureForItemCount(strokePrimitiveBoundsEntry.data, segmentCount, "stroke-primitive-bounds")
    : derivePrimitiveBounds(endpoints, primitiveMeta, segmentCount);

  const textInstanceA = trimTextureForItemCount(textInstanceAEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-a");
  const textInstanceB = trimTextureForItemCount(textInstanceBEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-b");
  const textInstanceC = textInstanceCEntry
    ? trimTextureForItemCount(textInstanceCEntry.data, textInstanceCount, "text-instance-c")
    : deriveLegacyTextInstanceColors(textInstanceB, textInstanceCount);
  const textGlyphMetaA = trimTextureForItemCount(textGlyphMetaAEntry?.data ?? new Float32Array(0), textGlyphCount, "text-glyph-meta-a");
  const textGlyphMetaB = trimTextureForItemCount(textGlyphMetaBEntry?.data ?? new Float32Array(0), textGlyphCount, "text-glyph-meta-b");
  const textGlyphSegmentsA = trimTextureForItemCount(
    textGlyphPrimitiveAEntry?.data ?? new Float32Array(0),
    textGlyphSegmentCount,
    "text-glyph-primitives-a"
  );
  const textGlyphSegmentsB = trimTextureForItemCount(
    textGlyphPrimitiveBEntry?.data ?? new Float32Array(0),
    textGlyphSegmentCount,
    "text-glyph-primitives-b"
  );

  migrateLegacyStrokeLayout(primitiveMeta, styles, segmentCount);
  migrateLegacyFillLayout(fillPathMetaB, fillPathMetaC, fillPathCount);

  const sourceSegmentCount = readNonNegativeInt(sceneMeta.sourceSegmentCount, segmentCount);
  const mergedSegmentCount = readNonNegativeInt(sceneMeta.mergedSegmentCount, segmentCount);
  const sourceTextCount = readNonNegativeInt(sceneMeta.sourceTextCount, textInstanceCount);
  const textInPageCount = readNonNegativeInt(sceneMeta.textInPageCount, textInstanceCount);
  const textOutOfPageCount = readNonNegativeInt(sceneMeta.textOutOfPageCount, Math.max(0, sourceTextCount - textInPageCount));
  const pageCount = Math.max(1, readNonNegativeInt(sceneMeta.pageCount, 1));
  const pagesPerRow = Math.max(1, readNonNegativeInt(sceneMeta.pagesPerRow, 1));
  let rasterLayers = await readRasterLayersFromParsedData(zip, sceneMeta);
  if (rasterLayers.length === 0) {
    const sourcePdfBytes = await readSourcePdfBytesFromParsedData(zip, manifest);
    if (sourcePdfBytes) {
      try {
        const rasterScene = await extractPdfRasterScene(createParseBuffer(sourcePdfBytes), {
          maxPages: pageCount,
          maxPagesPerRow: pagesPerRow
        });
        rasterLayers = listSceneRasterLayers(rasterScene);
        if (rasterLayers.length > 0) {
          console.log(
            `[Parsed data load] Restored ${rasterLayers.length.toLocaleString()} raster layer(s) from embedded source PDF.`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Parsed data load] Failed to restore raster layers from source PDF: ${message}`);
      }
    }
  }
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const maxHalfWidth =
    readFiniteNumber(sceneMeta.maxHalfWidth, Number.NaN) ||
    computeMaxHalfWidth(styles, segmentCount);

  const parsedBounds = parseBounds(sceneMeta.bounds);
  const parsedPageBounds = parseBounds(sceneMeta.pageBounds);
  const fallbackBounds =
    mergeBounds(
      boundsFromPrimitiveBounds(primitiveBounds, segmentCount),
      boundsFromFillPathMeta(fillPathMetaA, fillPathMetaB, fillPathCount)
    ) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const bounds = parsedBounds ?? fallbackBounds;
  const pageBounds = parsedPageBounds ?? bounds;
  const pageRects = parsePageRects(sceneMeta.pageRects, pageBounds);

  return {
    pageRects,
    fillPathCount,
    fillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    segmentCount,
    sourceSegmentCount,
    mergedSegmentCount,
    sourceTextCount,
    textInstanceCount,
    textGlyphCount,
    textGlyphSegmentCount,
    textInPageCount,
    textOutOfPageCount,
    textInstanceA,
    textInstanceB,
    textInstanceC,
    textGlyphMetaA,
    textGlyphMetaB,
    textGlyphSegmentsA,
    textGlyphSegmentsB,
    rasterLayers,
    rasterLayerWidth: primaryRasterLayer?.width ?? 0,
    rasterLayerHeight: primaryRasterLayer?.height ?? 0,
    rasterLayerData: primaryRasterLayer?.data ?? new Uint8Array(0),
    rasterLayerMatrix: primaryRasterLayer?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds,
    pageBounds,
    pageCount,
    pagesPerRow,
    maxHalfWidth,
    imagePaintOpCount: readNonNegativeInt(sceneMeta.imagePaintOpCount, 0),
    operatorCount: readNonNegativeInt(sceneMeta.operatorCount, 0),
    pathCount: readNonNegativeInt(sceneMeta.pathCount, 0),
    discardedTransparentCount: readNonNegativeInt(sceneMeta.discardedTransparentCount, 0),
    discardedDegenerateCount: readNonNegativeInt(sceneMeta.discardedDegenerateCount, 0),
    discardedDuplicateCount: readNonNegativeInt(sceneMeta.discardedDuplicateCount, 0),
    discardedContainedCount: readNonNegativeInt(sceneMeta.discardedContainedCount, 0)
  };
}

export function listSceneRasterLayers(scene: VectorScene): RasterLayer[] {
  const out: RasterLayer[] = [];
  if (Array.isArray(scene.rasterLayers)) {
    for (const layer of scene.rasterLayers) {
      const width = Math.max(0, Math.trunc(layer?.width ?? 0));
      const height = Math.max(0, Math.trunc(layer?.height ?? 0));
      if (width <= 0 || height <= 0 || !(layer.data instanceof Uint8Array) || layer.data.length < width * height * 4) {
        continue;
      }

      const matrix = layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix);
      out.push({
        width,
        height,
        data: layer.data,
        matrix
      });
    }
  }

  if (out.length > 0) {
    return out;
  }

  const legacyWidth = Math.max(0, Math.trunc(scene.rasterLayerWidth));
  const legacyHeight = Math.max(0, Math.trunc(scene.rasterLayerHeight));
  if (legacyWidth <= 0 || legacyHeight <= 0 || scene.rasterLayerData.length < legacyWidth * legacyHeight * 4) {
    return out;
  }

  out.push({
    width: legacyWidth,
    height: legacyHeight,
    data: scene.rasterLayerData,
    matrix: scene.rasterLayerMatrix
  });
  return out;
}

function trimTextureForItemCount(source: Float32Array, itemCount: number, label: string): Float32Array {
  const expectedLength = itemCount * 4;
  if (expectedLength === 0) {
    return new Float32Array(0);
  }
  if (source.length < expectedLength) {
    throw new Error(`Texture ${label} has insufficient data (${source.length} < ${expectedLength}).`);
  }
  if (source.length === expectedLength) {
    return source;
  }
  return source.slice(0, expectedLength);
}

function deriveLinePrimitiveB(primitivesA: Float32Array, primitiveCount: number): Float32Array {
  const out = new Float32Array(primitiveCount * 4);
  for (let i = 0; i < primitiveCount; i += 1) {
    const offset = i * 4;
    out[offset] = primitivesA[offset + 2];
    out[offset + 1] = primitivesA[offset + 3];
    out[offset + 2] = 0;
    out[offset + 3] = 0;
  }
  return out;
}

function deriveLegacyTextInstanceColors(textInstanceB: Float32Array, textInstanceCount: number): Float32Array {
  const out = new Float32Array(textInstanceCount * 4);
  for (let i = 0; i < textInstanceCount; i += 1) {
    const offset = i * 4;
    const luma = clamp01(textInstanceB[offset + 3]);
    out[offset] = luma;
    out[offset + 1] = luma;
    out[offset + 2] = luma;
    out[offset + 3] = 1;
  }
  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function migrateLegacyStrokeLayout(primitiveMeta: Float32Array, styles: Float32Array, segmentCount: number): void {
  if (segmentCount <= 0) {
    return;
  }

  let hasPackedStyleMeta = false;
  for (let i = 0; i < segmentCount; i += 1) {
    if (Math.abs(primitiveMeta[i * 4 + 3]) > 1e-6) {
      hasPackedStyleMeta = true;
      break;
    }
  }
  if (hasPackedStyleMeta) {
    return;
  }

  for (let i = 0; i < segmentCount; i += 1) {
    const offset = i * 4;
    const luma = clamp01(styles[offset + 1]);
    const alpha = clamp01(styles[offset + 2]);
    const styleFlags = styles[offset + 3] >= 0.5 ? 1 : 0;
    styles[offset + 1] = luma;
    styles[offset + 2] = luma;
    styles[offset + 3] = luma;
    primitiveMeta[offset + 3] = alpha + styleFlags * 2;
  }
}

function migrateLegacyFillLayout(fillPathMetaB: Float32Array, fillPathMetaC: Float32Array, fillPathCount: number): void {
  if (fillPathCount <= 0) {
    return;
  }

  let hasPackedFillAlpha = false;
  for (let i = 0; i < fillPathCount; i += 1) {
    if (Math.abs(fillPathMetaC[i * 4 + 3]) > 1e-6) {
      hasPackedFillAlpha = true;
      break;
    }
  }
  if (hasPackedFillAlpha) {
    return;
  }

  for (let i = 0; i < fillPathCount; i += 1) {
    const offset = i * 4;
    const luma = clamp01(fillPathMetaB[offset + 2]);
    const alpha = clamp01(fillPathMetaB[offset + 3]);
    fillPathMetaB[offset + 2] = luma;
    fillPathMetaB[offset + 3] = luma;
    fillPathMetaC[offset + 2] = luma;
    fillPathMetaC[offset + 3] = alpha;
  }
}

function derivePrimitiveBounds(primitivesA: Float32Array, primitivesB: Float32Array, primitiveCount: number): Float32Array {
  const out = new Float32Array(primitiveCount * 4);
  for (let i = 0; i < primitiveCount; i += 1) {
    const offset = i * 4;
    const x0 = primitivesA[offset];
    const y0 = primitivesA[offset + 1];
    const x1 = primitivesA[offset + 2];
    const y1 = primitivesA[offset + 3];
    const x2 = primitivesB[offset];
    const y2 = primitivesB[offset + 1];

    out[offset] = Math.min(x0, x1, x2);
    out[offset + 1] = Math.min(y0, y1, y2);
    out[offset + 2] = Math.max(x0, x1, x2);
    out[offset + 3] = Math.max(y0, y1, y2);
  }
  return out;
}

function boundsFromPrimitiveBounds(primitiveBounds: Float32Array, primitiveCount: number): Bounds | null {
  if (primitiveCount <= 0 || primitiveBounds.length < primitiveCount * 4) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < primitiveCount; i += 1) {
    const offset = i * 4;
    minX = Math.min(minX, primitiveBounds[offset]);
    minY = Math.min(minY, primitiveBounds[offset + 1]);
    maxX = Math.max(maxX, primitiveBounds[offset + 2]);
    maxY = Math.max(maxY, primitiveBounds[offset + 3]);
  }

  return { minX, minY, maxX, maxY };
}

function boundsFromFillPathMeta(metaA: Float32Array, metaB: Float32Array, fillPathCount: number): Bounds | null {
  if (fillPathCount <= 0 || metaA.length < fillPathCount * 4 || metaB.length < fillPathCount * 4) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < fillPathCount; i += 1) {
    const offset = i * 4;
    minX = Math.min(minX, metaA[offset + 2]);
    minY = Math.min(minY, metaA[offset + 3]);
    maxX = Math.max(maxX, metaB[offset]);
    maxY = Math.max(maxY, metaB[offset + 1]);
  }

  return { minX, minY, maxX, maxY };
}

function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a && !b) {
    return null;
  }
  if (!a) {
    return b ? { ...b } : null;
  }
  if (!b) {
    return { ...a };
  }
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function parseBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybe = value as Record<string, unknown>;
  const minX = readFiniteNumber(maybe.minX, Number.NaN);
  const minY = readFiniteNumber(maybe.minY, Number.NaN);
  const maxX = readFiniteNumber(maybe.maxX, Number.NaN);
  const maxY = readFiniteNumber(maybe.maxY, Number.NaN);

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function parsePageRects(value: unknown, fallbackBounds: Bounds): Float32Array {
  if (Array.isArray(value)) {
    const quadCount = Math.floor(value.length / 4);
    if (quadCount > 0) {
      const out = new Float32Array(quadCount * 4);
      let writeOffset = 0;
      for (let i = 0; i < quadCount; i += 1) {
        const readOffset = i * 4;
        const minX = Number(value[readOffset]);
        const minY = Number(value[readOffset + 1]);
        const maxX = Number(value[readOffset + 2]);
        const maxY = Number(value[readOffset + 3]);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
          continue;
        }
        out[writeOffset] = minX;
        out[writeOffset + 1] = minY;
        out[writeOffset + 2] = maxX;
        out[writeOffset + 3] = maxY;
        writeOffset += 4;
      }
      if (writeOffset > 0) {
        return out.slice(0, writeOffset);
      }
    }
  }
  return new Float32Array([fallbackBounds.minX, fallbackBounds.minY, fallbackBounds.maxX, fallbackBounds.maxY]);
}

function parseMat2D(value: unknown): Float32Array | null {
  if (!Array.isArray(value) || value.length < 6) {
    return null;
  }

  const out = new Float32Array(6);
  for (let i = 0; i < 6; i += 1) {
    const component = Number(value[i]);
    if (!Number.isFinite(component)) {
      return null;
    }
    out[i] = component;
  }
  return out;
}

async function readSourcePdfBytesFromParsedData(zip: JSZip, manifest: ParsedDataManifest): Promise<Uint8Array | null> {
  const manifestPath = readNonEmptyString(manifest.sourcePdfFile);
  const manifestUrl = readNonEmptyString(manifest.sourcePdfUrl);
  const candidatePaths = [
    manifestPath,
    "source/source.pdf",
    "source.pdf"
  ];

  for (const candidatePath of candidatePaths) {
    if (!candidatePath) {
      continue;
    }
    const zipEntry = zip.file(candidatePath);
    if (!zipEntry) {
      continue;
    }

    const fileBuffer = await zipEntry.async("arraybuffer");
    if (fileBuffer.byteLength <= 0) {
      continue;
    }
    return new Uint8Array(fileBuffer);
  }

  if (manifestUrl) {
    try {
      const response = await fetch(resolveAppAssetUrl(manifestUrl));
      if (response.ok) {
        const fileBuffer = await response.arrayBuffer();
        if (fileBuffer.byteLength > 0) {
          return new Uint8Array(fileBuffer);
        }
      }
    } catch {
      // Best-effort fallback only.
    }
  }

  return null;
}

interface EncodedRasterImage {
  bytes: Uint8Array;
  encoding: "webp" | "png";
  extension: "webp" | "png";
}

async function encodeRasterLayerAsBestImage(width: number, height: number, rgba: Uint8Array): Promise<EncodedRasterImage | null> {
  const [webp, png] = await Promise.all([
    encodeRasterLayerAsImage(width, height, rgba, "image/webp"),
    encodeRasterLayerAsImage(width, height, rgba, "image/png")
  ]);

  if (!webp && !png) {
    return null;
  }
  if (webp && !png) {
    return { bytes: webp, encoding: "webp", extension: "webp" };
  }
  if (png && !webp) {
    return { bytes: png, encoding: "png", extension: "png" };
  }

  if (!webp || !png) {
    return null;
  }
  return webp.byteLength < png.byteLength
    ? { bytes: webp, encoding: "webp", extension: "webp" }
    : { bytes: png, encoding: "png", extension: "png" };
}

async function encodeRasterLayerAsImage(
  width: number,
  height: number,
  rgba: Uint8Array,
  mimeType: "image/png" | "image/webp"
): Promise<Uint8Array | null> {
  if (typeof document === "undefined") {
    return null;
  }

  const expectedBytes = width * height * 4;
  if (width <= 0 || height <= 0 || rgba.length < expectedBytes) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }

  const clamped = new Uint8ClampedArray(expectedBytes);
  clamped.set(rgba.subarray(0, expectedBytes));
  const imageData = new ImageData(clamped, width, height);
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType);
  });
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    return null;
  }

  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function getMimeTypeForRasterPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return null;
}

async function decodeRasterImageToRgba(path: string, encoded: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  if (typeof document === "undefined") {
    return null;
  }
  const mimeType = getMimeTypeForRasterPath(path);
  if (!mimeType) {
    return null;
  }

  const encodedCopy = new Uint8Array(encoded.length);
  encodedCopy.set(encoded);
  const blob = new Blob([encodedCopy], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width <= 0 || height <= 0) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }

    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(imageData.data);
    canvas.width = 0;
    canvas.height = 0;
    return { width, height, data: rgba };
  } finally {
    bitmap.close();
  }
}

export async function tryReadSourcePdfBytesFromExistingParsedZip(zipBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestFile = zip.file("manifest.json");
    let sourcePdfFile: string | null = null;
    if (manifestFile) {
      const manifestJson = await manifestFile.async("string");
      try {
        const manifest = JSON.parse(manifestJson) as ParsedDataManifest;
        sourcePdfFile = readNonEmptyString(manifest.sourcePdfFile);
      } catch {
        sourcePdfFile = null;
      }
    }

    const candidatePaths = [sourcePdfFile, "source/source.pdf", "source.pdf"];
    for (const candidatePath of candidatePaths) {
      if (!candidatePath) {
        continue;
      }
      const entry = zip.file(candidatePath);
      if (!entry) {
        continue;
      }
      const fileBuffer = await entry.async("arraybuffer");
      if (fileBuffer.byteLength <= 0) {
        continue;
      }
      return new Uint8Array(fileBuffer);
    }
  } catch {
    // Best-effort only.
  }

  return null;
}

async function readRasterLayersFromParsedData(zip: JSZip, sceneMeta: ParsedDataSceneEntry): Promise<RasterLayer[]> {
  const layers: RasterLayer[] = [];

  const sceneRasterLayers = Array.isArray(sceneMeta.rasterLayers)
    ? sceneMeta.rasterLayers
    : [];
  for (let i = 0; i < sceneRasterLayers.length; i += 1) {
    const entry = sceneRasterLayers[i];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const layerMeta = entry as ParsedDataRasterLayerEntry;
    const width = readNonNegativeInt(layerMeta.width, 0);
    const height = readNonNegativeInt(layerMeta.height, 0);
    const path = typeof layerMeta.file === "string" ? layerMeta.file : `raster/layer-${i}.rgba`;
    const matrix = parseMat2D(layerMeta.matrix) ?? new Float32Array([1, 0, 0, 1, 0, 0]);
    const decoded = await readRasterLayerFromZip(zip, path, width, height);
    if (!decoded || decoded.width <= 0 || decoded.height <= 0 || decoded.data.length < decoded.width * decoded.height * 4) {
      continue;
    }

    layers.push({ width: decoded.width, height: decoded.height, matrix, data: decoded.data });
  }

  if (layers.length > 0) {
    return layers;
  }

  const rasterLayerWidth = readNonNegativeInt(sceneMeta.rasterLayerWidth, 0);
  const rasterLayerHeight = readNonNegativeInt(sceneMeta.rasterLayerHeight, 0);
  const rasterLayerMatrix = parseMat2D(sceneMeta.rasterLayerMatrix) ?? new Float32Array([1, 0, 0, 1, 0, 0]);
  const defaultLegacyPath = zip.file("raster/layer-0.webp")
    ? "raster/layer-0.webp"
    : zip.file("raster/layer-0.png")
      ? "raster/layer-0.png"
      : zip.file("raster/layer-0.rgba")
        ? "raster/layer-0.rgba"
        : zip.file("raster/layer.webp")
          ? "raster/layer.webp"
          : zip.file("raster/layer.png")
            ? "raster/layer.png"
            : "raster/layer.rgba";
  const legacyLayer = await readRasterLayerFromZip(
    zip,
    typeof sceneMeta.rasterLayerFile === "string" ? sceneMeta.rasterLayerFile : defaultLegacyPath,
    rasterLayerWidth,
    rasterLayerHeight
  );
  if (
    legacyLayer &&
    legacyLayer.width > 0 &&
    legacyLayer.height > 0 &&
    legacyLayer.data.length >= legacyLayer.width * legacyLayer.height * 4
  ) {
    layers.push({
      width: legacyLayer.width,
      height: legacyLayer.height,
      data: legacyLayer.data,
      matrix: rasterLayerMatrix
    });
  }
  return layers;
}

async function readRasterLayerFromZip(
  zip: JSZip,
  path: string,
  widthHint: number,
  heightHint: number
): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const zipEntry = zip.file(path);
  if (!zipEntry) {
    return null;
  }

  const buffer = await zipEntry.async("arraybuffer");
  const bytes = new Uint8Array(buffer);

  const decodedImage = await decodeRasterImageToRgba(path, bytes);
  if (decodedImage) {
    return decodedImage;
  }

  if (widthHint <= 0 || heightHint <= 0) {
    return null;
  }

  const expectedLength = widthHint * heightHint * 4;
  if (bytes.length < expectedLength) {
    throw new Error(`Raster layer data is truncated (${bytes.length} < ${expectedLength}).`);
  }
  return {
    width: widthHint,
    height: heightHint,
    data: bytes.length === expectedLength ? bytes : bytes.slice(0, expectedLength)
  };
}

function computeMaxHalfWidth(styles: Float32Array, segmentCount: number): number {
  let maxHalfWidth = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    maxHalfWidth = Math.max(maxHalfWidth, styles[i * 4]);
  }
  return maxHalfWidth;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readNonNegativeInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.trunc(number));
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const suffix = textureLayout === "channel-major" ? ".f32cm" : ".f32";

  return {
    name,
    filePath: `textures/${name}${suffix}`,
    width,
    height,
    logicalItemCount,
    logicalFloatCount,
    data: source.subarray(0, logicalFloatCount),
    layout: textureLayout
  };
}

function readTexturePayloadAsFloat32(
  fileBuffer: ArrayBuffer,
  entry: ParsedDataTextureEntry,
  textureName: string
): Float32Array {
  const componentType = typeof entry.componentType === "string" ? entry.componentType : "float32";
  if (componentType !== "float32") {
    throw new Error(`Texture ${textureName} has unsupported componentType ${String(componentType)}.`);
  }

  const layout = typeof entry.layout === "string" ? entry.layout : "interleaved";
  if (layout !== "interleaved" && layout !== "channel-major") {
    throw new Error(`Texture ${textureName} has unsupported layout ${String(layout)}.`);
  }

  if (layout === "channel-major") {
    return decodeChannelMajorFloat32(new Uint8Array(fileBuffer));
  }

  const byteShuffle = entry.byteShuffle === true;
  const predictor = typeof entry.predictor === "string" ? entry.predictor : "none";
  if (predictor !== "none" && predictor !== "xor-delta-u32") {
    throw new Error(`Texture ${textureName} has unsupported predictor ${String(predictor)}.`);
  }

  if (byteShuffle) {
    if (predictor === "xor-delta-u32") {
      return decodeXorDeltaByteShuffledFloat32(new Uint8Array(fileBuffer));
    }
    return decodeByteShuffledFloat32(new Uint8Array(fileBuffer));
  }

  if (predictor !== "none") {
    throw new Error(`Texture ${textureName} declares predictor ${predictor} without byteShuffle.`);
  }

  if (fileBuffer.byteLength % 4 !== 0) {
    throw new Error(`Texture ${textureName} has invalid byte length (${fileBuffer.byteLength}).`);
  }

  return new Float32Array(fileBuffer);
}

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const APP_BASE_URL = new URL(import.meta.env.BASE_URL, window.location.href);

function resolveAppAssetUrl(inputPath: string): string {
  const trimmedPath = inputPath.trim();
  if (ABSOLUTE_URL_PATTERN.test(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.replace(/^\/+/, "");
  return new URL(normalizedPath, APP_BASE_URL).toString();
}

function createParseBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}
