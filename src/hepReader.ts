import { readHepLod } from "./hepLod";
import { validatePagePrimitiveRanges } from "./scenePageViews";
import { readHepAnnotations } from "./hepAnnotations";
import { readHepStructure } from "./hepStructure";
import { validateVectorDrawRuns } from "./vectorDrawOrder";
import {
  validateSceneOptionalContent,
  validateSceneOptionalContentReferences
} from "./optionalContent";
import { validateSceneRetainedPages } from "./retainedPageData";
import { decodeHeprPageData } from "./heprPageEncoding";
import type { HeprPageData } from "./heprDocumentData";
import { validateScenePaintGraph } from "./scenePaintGraph";
import {
  SCENE_CLIP_PATHS_PATH,
  SCENE_DRAW_RUNS_PATH,
  SCENE_PAINT_GRAPH_PATH,
  decodeSceneClipPaths,
  decodeSceneDrawRuns,
  decodeScenePaintGraph
} from "./hepSceneSections";
import {
  readHepGradientMesh,
  validateGradientMesh
} from "./hepGradientMesh";
import {
  HepArchive,
  type HepArchiveEntry
} from "./hepContainer";
import { waitForLoad } from "./loadCancellation";
import {
  GRADIENT_LUT_WIDTH,
  inferPageTextRanges,
  optimizeVectorSceneTextGlyphs,
  type Bounds,
  type PageTextIndex,
  type RasterLayer,
  type SceneTextIndex,
  type VectorScene
} from "./pdfVectorExtractor";
import { createLoadProgressReporter } from "./loadProgress";
import {
  decodeRasterImageToRgba,
  inspectRasterImage,
  rasterImageEncodingFromPath
} from "./rasterImageCodec";
import { decodeHepMonochromeRaster, hepMonochromeRasterByteLength } from "./hepMonochromeRaster";
import { decodeHepBinaryRaster, HEP_BINARY_RASTER_HEADER_BYTES, hepBinaryRasterByteLengthLimit } from "./hepBinaryRaster";
import {
  decodeHepJbig2Raster, inspectHepJbig2Raster, HEP_JBIG2_RASTER_HEADER_BYTES,
  HEP_JBIG2_NO_GLOBALS, HEP_JBIG2_MAX_DECODE_BYTES, hepJbig2GlobalsFile
} from "./hepJbig2Raster";
import { createMonochromeRasterLayer } from "./monochromeRaster";
import {
  SCENE_RASTER_LAYERS_PATH,
  copyRasterRect,
  decodeRasterLayerTable,
  rasterAtlasFile,
  rasterLayerFile,
  type RasterLayerTable
} from "./hepRasterLayers";
import {
  TEXT_GLYPH_SEGMENTS_PATH,
  decodeTextGlyphSegments,
  decodeTextInstancePositionsInto,
  type TextGlyphSegmentsMeta
} from "./hepTextSections";
import {
  decodeFixed512DeltaColumnInto,
  VarintCursor,
  zigzagDecode32
} from "./parsedDataVarint";
import {
  PARSED_DATA_FORMAT_VERSION,
  PARSED_DATA_MONOCHROME_FORMAT_VERSION,
  PARSED_DATA_JBIG2_FORMAT_VERSION,
  PARSED_DATA_BINARY_FORMAT_VERSION,
  readTexturePayloadAsFloat32,
  readNonNegativeInt,
  preparedStrokeGeometry,
  preparedHepScenes,
  readFiniteNumberArray,
  decodeStrokeGeometry,
  TEXT_INDEX_JSON_PATH,
  TEXT_CHAR_MAP_PATH,
  TEXT_FALLBACK_PATH,
  TEXT_OPTIONAL_CONTENT_PATH
} from "./hepShared";
import type {
  LoadHepOptions,
  ParsedDataTextureEntry,
  ParsedDataSceneEntry,
  ParsedDataManifest,
  ParsedDataGradientLutEntry,
  TextIndexManifestMeta,
  TextIndexPageEntry,
  StrokeGeometrySectionMeta,
  TextInstancesSectionMeta,
  StrokeGeometryExport,
  NativeGradientResources
} from "./hepTypes";

async function readSceneTextIndexFromParsedData(archive: HepArchive, manifest: ParsedDataManifest): Promise<SceneTextIndex | null> {
  try {
    const meta =
      typeof manifest.textIndex === "object" && manifest.textIndex
        ? (manifest.textIndex as TextIndexManifestMeta)
        : {};
    const jsonPath = typeof meta.file === "string" ? meta.file : TEXT_INDEX_JSON_PATH;
    const jsonEntry = archive.file(jsonPath);
    if (!jsonEntry) {
      return null;
    }

    const jsonText = await jsonEntry.async("string");
    const parsed = JSON.parse(jsonText) as { pages?: TextIndexPageEntry[] };
    const pageEntries = Array.isArray(parsed.pages) ? parsed.pages : [];
    if (pageEntries.length === 0) {
      return null;
    }

    const charMapPath = typeof meta.charMapFile === "string" ? meta.charMapFile : TEXT_CHAR_MAP_PATH;
    const charMapEntry = archive.file(charMapPath);
    if (!charMapEntry) {
      return null;
    }
    return await readTextIndexV2(archive, meta, pageEntries, charMapEntry);
  } catch (error) {
    if (manifest.textIndex && typeof manifest.textIndex === "object" &&
        "optionalContentFile" in manifest.textIndex) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Parsed data load] Failed to read text index: ${message}`);
    return null;
  }
}

async function readTextIndexV2(
  archive: HepArchive,
  meta: TextIndexManifestMeta,
  pageEntries: TextIndexPageEntry[],
  charMapEntry: HepArchiveEntry
): Promise<SceneTextIndex | null> {
  const charMapBytes = new Uint8Array(await charMapEntry.async("arraybuffer"));
  let optionalCursor: VarintCursor | undefined;
  if (meta.optionalContentFile !== undefined) {
    if (typeof meta.optionalContentFile !== "string" || !meta.optionalContentFile) throw new Error("Invalid text optional-content section.");
    const entry = archive.file(meta.optionalContentFile);
    if (!entry) throw new Error("Missing text optional-content section.");
    optionalCursor = new VarintCursor(new Uint8Array(await entry.async("arraybuffer")));
  }

  let totalFallbackCount = 0;
  for (const entry of pageEntries) {
    totalFallbackCount += readNonNegativeInt(entry.fallbackCount, 0);
  }

  let fallbackAll: Float32Array | null = null;
  if (totalFallbackCount > 0) {
    const fallbackPath = typeof meta.fallbackFile === "string" ? meta.fallbackFile : TEXT_FALLBACK_PATH;
    const fallbackEntry = archive.file(fallbackPath);
    const lengths = Array.isArray(meta.fallbackColumnByteLengths) ? meta.fallbackColumnByteLengths.map(Number) : null;
    if (!fallbackEntry || !lengths || lengths.length !== 4 || lengths.some((value) => !Number.isFinite(value) || value < 0)) {
      console.warn("[Parsed data load] Text index fallback quads are missing or invalid; ignoring text index.");
      return null;
    }
    const fallbackBytes = new Uint8Array(await fallbackEntry.async("arraybuffer"));
    if (lengths.reduce((sum, value) => sum + value, 0) !== fallbackBytes.length) {
      console.warn("[Parsed data load] Text index fallback quads have a length mismatch; ignoring text index.");
      return null;
    }
    fallbackAll = new Float32Array(totalFallbackCount * 4);
    let byteOffset = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      decodeFixed512DeltaColumnInto(
        fallbackBytes,
        byteOffset,
        byteOffset + lengths[channel],
        fallbackAll,
        totalFallbackCount,
        4,
        channel
      );
      byteOffset += lengths[channel];
    }
  }

  const cursor = new VarintCursor(charMapBytes);
  let prevInstance = -1;
  let fallbackOffset = 0;
  const pages: PageTextIndex[] = [];
  for (const entry of pageEntries) {
    const text = typeof entry.text === "string" ? entry.text : "";
    const charInstance = new Int32Array(text.length);
    let pageFallbackCount = 0;
    for (let i = 0; i < text.length; i += 1) {
      const token = cursor.readVarUint32();
      if (token === 0) {
        charInstance[i] = -1;
      } else if (token === 1) {
        charInstance[i] = -2 - pageFallbackCount;
        pageFallbackCount += 1;
      } else {
        prevInstance = prevInstance + 1 + zigzagDecode32(token - 2);
        charInstance[i] = prevInstance;
      }
    }

    const declaredFallbackCount = readNonNegativeInt(entry.fallbackCount, pageFallbackCount);
    if (declaredFallbackCount !== pageFallbackCount || (pageFallbackCount > 0 && !fallbackAll)) {
      console.warn("[Parsed data load] Text index char map is inconsistent; ignoring text index.");
      return null;
    }
    const fallbackQuads = fallbackAll
      ? fallbackAll.slice(fallbackOffset * 4, (fallbackOffset + pageFallbackCount) * 4)
      : new Float32Array(0);
    fallbackOffset += pageFallbackCount;
    const optionalContent = optionalCursor ? new Int32Array(text.length) : undefined;
    if (optionalContent) for (let index = 0; index < text.length; index++) {
      const condition = optionalCursor!.readVarUint32() - 1;
      if (condition > 0x7fffffff) throw new Error("Invalid text optional-content reference.");
      optionalContent[index] = condition;
    }
    pages.push({ text, charInstance, fallbackQuads, ...(optionalContent ? { optionalContent } : {}) });
  }
  cursor.expectEnd("text/char-map.bin");
  optionalCursor?.expectEnd(TEXT_OPTIONAL_CONTENT_PATH);

  return { version: 2, pages };
}

function parseStrokeGeometrySection(value: unknown): StrokeGeometrySectionMeta | null {
  if (typeof value !== "object" || !value) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const endpointsFile = typeof raw.endpointsFile === "string" ? raw.endpointsFile : null;
  const metaFile = typeof raw.metaFile === "string" ? raw.metaFile : null;
  const clipBoundsFile = typeof raw.clipBoundsFile === "string"
    ? raw.clipBoundsFile
    : undefined;
  const clippedSegmentCount = raw.clippedSegmentCount === undefined
    ? undefined
    : Number(raw.clippedSegmentCount);
  const segmentCount = Number(raw.segmentCount);
  const curveCount = Number(raw.curveCount);
  const quantizationMin = readFiniteNumberArray(raw.quantizationMin, 4);
  const quantizationMax = readFiniteNumberArray(raw.quantizationMax, 4);
  const ctrlQuantizationMin = readFiniteNumberArray(raw.ctrlQuantizationMin, 2);
  const ctrlQuantizationMax = readFiniteNumberArray(raw.ctrlQuantizationMax, 2);
  const endpointColumnByteLengths = readFiniteNumberArray(raw.endpointColumnByteLengths, 4);
  if (
    !endpointsFile ||
    !metaFile ||
    !Number.isInteger(segmentCount) ||
    segmentCount < 0 ||
    !Number.isInteger(curveCount) ||
    curveCount < 0 ||
    !quantizationMin ||
    !quantizationMax ||
    !ctrlQuantizationMin ||
    !ctrlQuantizationMax ||
    !endpointColumnByteLengths ||
    endpointColumnByteLengths.some((length) => !Number.isInteger(length) || length < 0) ||
    ((clipBoundsFile === undefined) !== (clippedSegmentCount === undefined)) ||
    (clippedSegmentCount !== undefined &&
      (!Number.isInteger(clippedSegmentCount) ||
       clippedSegmentCount <= 0 || clippedSegmentCount > segmentCount))
  ) {
    throw new Error("HEP file has an invalid strokeGeometry section.");
  }
  return {
    endpointsFile,
    metaFile,
    ...(clipBoundsFile === undefined ? {} : { clipBoundsFile, clippedSegmentCount }),
    segmentCount,
    curveCount,
    quantizationMin,
    quantizationMax,
    ctrlQuantizationMin,
    ctrlQuantizationMax,
    endpointColumnByteLengths
  };
}

function parseTextInstancesSection(value: unknown): TextInstancesSectionMeta | null {
  if (typeof value !== "object" || !value) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const positionsFile = typeof raw.positionsFile === "string" ? raw.positionsFile : null;
  const glyphIndexFile = typeof raw.glyphIndexFile === "string" ? raw.glyphIndexFile : null;
  const glyphIndexFormat = raw.glyphIndexFormat === "u32" ? "u32" : raw.glyphIndexFormat === "u16" ? "u16" : null;
  const count = Number(raw.count);
  const positionColumnByteLengths = readFiniteNumberArray(raw.positionColumnByteLengths, 3);
  const clipRectsFile = typeof raw.clipRectsFile === "string" ? raw.clipRectsFile : undefined;
  const clipReferencesFile = typeof raw.clipReferencesFile === "string"
    ? raw.clipReferencesFile
    : undefined;
  const clipRectCount = raw.clipRectCount === undefined ? undefined : Number(raw.clipRectCount);
  if (
    !positionsFile ||
    !glyphIndexFile ||
    !glyphIndexFormat ||
    !Number.isInteger(count) ||
    count < 0 ||
    !positionColumnByteLengths ||
    positionColumnByteLengths.some((length) => !Number.isInteger(length) || length < 0)
    || ((clipRectsFile === undefined) !== (clipReferencesFile === undefined))
    || ((clipRectsFile === undefined) !== (clipRectCount === undefined))
    || (clipRectCount !== undefined && (!Number.isInteger(clipRectCount) || clipRectCount < 0))
  ) {
    throw new Error("HEP file has an invalid textInstances section.");
  }
  return {
    positionsFile, glyphIndexFile, glyphIndexFormat, count, positionColumnByteLengths,
    ...(clipRectsFile === undefined ? {} : { clipRectsFile, clipReferencesFile, clipRectCount })
  };
}

function parseTextGlyphSegmentsSection(value: unknown): TextGlyphSegmentsMeta | null {
  if (value === undefined) {
    return null;
  }
  const raw = typeof value === "object" && value ? value as Record<string, unknown> : {};
  const segmentCount = raw.segmentCount;
  const quantizationMin = readFiniteNumberArray(raw.quantizationMin, 2);
  const quantizationMax = readFiniteNumberArray(raw.quantizationMax, 2);
  if (
    raw.file !== TEXT_GLYPH_SEGMENTS_PATH ||
    typeof segmentCount !== "number" ||
    !Number.isSafeInteger(segmentCount) ||
    segmentCount < 0 ||
    !quantizationMin ||
    !quantizationMax
  ) {
    throw new Error("HEP file has an invalid textGlyphSegments section.");
  }
  return { file: TEXT_GLYPH_SEGMENTS_PATH, segmentCount, quantizationMin, quantizationMax };
}

/**
 * Decodes the v5 stroke section back into the interleaved `endpoints` and
 * `primitiveMeta` arrays in one pass. Start points chain against the previous
 * segment's end point in the integer domain (exact), and curve control points
 * are stored as deltas against the quantized chord midpoint.
 */
async function readStrokeGeometryFromSection(
  archive: HepArchive,
  section: StrokeGeometrySectionMeta
): Promise<ReturnType<typeof decodeStrokeGeometry> & { encoded: StrokeGeometryExport }> {
  const endpointsEntry = archive.file(section.endpointsFile);
  const metaEntry = archive.file(section.metaFile);
  if (!endpointsEntry || !metaEntry) {
    throw new Error("HEP file is missing v5 stroke geometry files.");
  }
  const [endpointsBytes, metaBytes] = await Promise.all([
    endpointsEntry.async("uint8array"),
    metaEntry.async("uint8array")
  ]);
  let clipBoundsBytes: Uint8Array | undefined;
  if (section.clipBoundsFile) {
    const entry = archive.file(section.clipBoundsFile);
    if (!entry) {
      throw new Error("HEP file is missing clipped stroke bounds.");
    }
    // The sparse float32 clip payload needs an aligned backing buffer.
    clipBoundsBytes = new Uint8Array(await entry.async("arraybuffer"));
  }
  const encoded = { endpointsBytes, metaBytes, clipBoundsBytes, manifest: section };
  return { ...decodeStrokeGeometry(encoded), encoded };
}

/**
 * Decodes the text instance section back into the interleaved textInstanceB
 * array. Origins are predicted from the glyph indices and the decoded
 * `text-instance-a` matrices, so both are read first.
 */
async function readTextInstancesFromSection(
  archive: HepArchive,
  section: TextInstancesSectionMeta,
  instanceA: Float32Array
): Promise<Float32Array> {
  const count = section.count;
  const instanceB = new Float32Array(count * 4);
  if (count === 0) {
    return instanceB;
  }

  const positionsEntry = archive.file(section.positionsFile);
  const glyphIndexEntry = archive.file(section.glyphIndexFile);
  if (!positionsEntry || !glyphIndexEntry) {
    throw new Error("HEP file is missing text instance files.");
  }
  const [positionsBuffer, glyphIndexBuffer] = await Promise.all([
    positionsEntry.async("arraybuffer"),
    glyphIndexEntry.async("arraybuffer")
  ]);
  const bytesPerGlyph = section.glyphIndexFormat === "u32" ? 4 : 2;
  if (glyphIndexBuffer.byteLength !== count * bytesPerGlyph) {
    throw new Error("HEP file glyph index stream has a length mismatch.");
  }
  const glyphIndices = bytesPerGlyph === 4 ? new Uint32Array(glyphIndexBuffer) : new Uint16Array(glyphIndexBuffer);
  for (let i = 0; i < count; i += 1) {
    instanceB[i * 4 + 2] = glyphIndices[i];
  }
  if (instanceA.length < count * 4) {
    throw new Error("HEP file text instance matrices are missing or incomplete.");
  }
  decodeTextInstancePositionsInto(
    new Uint8Array(positionsBuffer),
    section.positionColumnByteLengths,
    instanceA,
    glyphIndices,
    instanceB,
    count
  );

  return instanceB;
}

export async function loadSceneFromHep(
  buffer: ArrayBuffer,
  options: LoadHepOptions = {}
): Promise<VectorScene> {
  options.signal?.throwIfAborted();
  return waitForLoad(loadSceneFromHepInternal(buffer, options), options.signal);
}

async function loadSceneFromHepInternal(
  buffer: ArrayBuffer,
  options: LoadHepOptions
): Promise<VectorScene> {
  const signal = options.signal;
  const progress = createLoadProgressReporter(options.onProgress ? (event) => {
    if (!signal?.aborted) options.onProgress?.(event);
  } : undefined);
  const archive = await progress.child(0, 0.16, { sourceType: "hep" }).withIndeterminateProgress(
    () => HepArchive.loadAsync(buffer, { signal }).catch((error: unknown) => {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to open HEP file: ${message}. ` +
        "A HEP file must be exported by HEPR; renaming or compressing a PDF does not create one.",
        { cause: error }
      );
    }),
    { stage: "hep-open", sourceType: "hep" }
  );
  signal?.throwIfAborted();
  const manifestFile = archive.file("manifest.json");
  if (!manifestFile) {
    throw new Error(
      "This is not a valid HEP file: manifest.json is missing. " +
      "Compressing a PDF into a ZIP does not create a HEP file; load the PDF directly or export it from HEPR."
    );
  }
  const manifestByteLength = readHepEntryUncompressedSize(manifestFile);
  if (manifestByteLength === null) {
    throw new Error("Parsed data manifest size is invalid.");
  }

  const manifestJson = await progress.child(0.16, 0.22, { sourceType: "hep" }).withIndeterminateProgress(
    () => manifestFile.async("string"),
    { stage: "hep-manifest", sourceType: "hep" }
  );
  signal?.throwIfAborted();
  let manifest: ParsedDataManifest;
  try {
    manifest = JSON.parse(manifestJson) as ParsedDataManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid manifest.json: ${message}`);
  }

  if (manifest.formatVersion !== PARSED_DATA_FORMAT_VERSION &&
      manifest.formatVersion !== PARSED_DATA_MONOCHROME_FORMAT_VERSION &&
      manifest.formatVersion !== PARSED_DATA_JBIG2_FORMAT_VERSION &&
      manifest.formatVersion !== PARSED_DATA_BINARY_FORMAT_VERSION) {
    throw new Error(
      `HEP format v${String(manifest.formatVersion)} is not supported; expected v${PARSED_DATA_FORMAT_VERSION}–v${PARSED_DATA_BINARY_FORMAT_VERSION}. Re-export the HEP file with the current version.`
    );
  }

  if (manifest.sourcePdfByteLength !== undefined &&
      (!Number.isSafeInteger(manifest.sourcePdfByteLength) || Number(manifest.sourcePdfByteLength) <= 0)) {
    throw new Error("Invalid HEP sourcePdfByteLength; expected a positive safe integer.");
  }

  const sceneMeta = typeof manifest.scene === "object" && manifest.scene ? manifest.scene : {};
  const manifestTextures = Array.isArray(manifest.textures) ? manifest.textures : [];

  const strokeGeometrySection = parseStrokeGeometrySection(manifest.strokeGeometry);
  const textInstancesSection = parseTextInstancesSection(manifest.textInstances);
  const textGlyphSegmentsSection = parseTextGlyphSegmentsSection(manifest.textGlyphSegments);

  const textureByName = new Map<string, ParsedDataTextureEntry>();
  const textureReadTotal = 27;
  let textureReadCount = 0;
  const reportTextureProgress = (): void => {
    progress.report(0.22 + (textureReadCount / textureReadTotal) * 0.58, {
      stage: "hep-section",
      sourceType: "hep",
      unit: "sections",
      processed: textureReadCount,
      total: textureReadTotal
    });
  };
  for (const entry of manifestTextures) {
    const name = typeof entry.name === "string" ? entry.name : null;
    if (!name) {
      continue;
    }
    textureByName.set(name, entry);
  }

  const readTexture = async (
    name: string,
    required: boolean
  ): Promise<{ data: Float32Array; logicalItemCount: number } | null> => {
    try {
      signal?.throwIfAborted();
      reportTextureProgress();
      const entry = textureByName.get(name);
      const path = entry && typeof entry.file === "string" ? entry.file : null;
      const archiveEntry = path ? archive.file(path) : null;
      if (!entry || !archiveEntry) {
        if (required) {
          throw new Error(`HEP file is missing required texture: ${name}.`);
        }
        return null;
      }

      const fileBuffer = await archiveEntry.async("arraybuffer");
      signal?.throwIfAborted();
      const raw = readTexturePayloadAsFloat32(fileBuffer, entry, name);
      const logicalFloatCount = readNonNegativeInt(entry.logicalFloatCount, raw.length);
      if (logicalFloatCount > raw.length) {
        throw new Error(`Texture ${name} logical float count exceeds file length.`);
      }

      const logicalItemCount = readNonNegativeInt(entry.logicalItemCount, Math.floor(logicalFloatCount / 4));
      return {
        data: raw.length === logicalFloatCount ? raw : raw.slice(0, logicalFloatCount),
        logicalItemCount
      };
    } finally {
      textureReadCount += 1;
      reportTextureProgress();
    }
  };

  const fillPathMetaAEntry = await readTexture("fill-path-meta-a", false);
  const fillPathMetaBEntry = await readTexture("fill-path-meta-b", false);
  const fillPathMetaCEntry = await readTexture("fill-path-meta-c", false);
  const fillPrimitiveAEntry = await readTexture("fill-primitives-a", false);
  const fillPrimitiveBEntry = await readTexture("fill-primitives-b", false);
  const strokeStylesEntry = await readTexture("stroke-styles", false);
  const textInstanceAEntry = await readTexture("text-instance-a", false);
  const textInstanceCEntry = await readTexture("text-instance-c", false);
  const textGlyphMetaAEntry = await readTexture("text-glyph-meta-a", false);
  const textGlyphMetaBEntry = await readTexture("text-glyph-meta-b", false);
  const gradientMetaAEntry = await readTexture("gradient-meta-a", false);
  const gradientMetaBEntry = await readTexture("gradient-meta-b", false);
  const gradientMetaCEntry = await readTexture("gradient-meta-c", false);
  const gradientMetaDEntry = await readTexture("gradient-meta-d", false);
  const gradientMetaEEntry = await readTexture("gradient-meta-e", false);
  const gradientFillPathMetaAEntry = await readTexture("gradient-fill-path-meta-a", false);
  const gradientFillPathMetaBEntry = await readTexture("gradient-fill-path-meta-b", false);
  const gradientFillPathMetaCEntry = await readTexture("gradient-fill-path-meta-c", false);
  const gradientFillPaintMetaEntry = await readTexture("gradient-fill-paint-meta", false);
  const gradientFillPrimitiveAEntry = await readTexture("gradient-fill-primitives-a", false);
  const gradientFillPrimitiveBEntry = await readTexture("gradient-fill-primitives-b", false);
  const gradientStrokeRunMetaAEntry = await readTexture("gradient-stroke-run-meta-a", false);
  const gradientStrokeRunMetaBEntry = await readTexture("gradient-stroke-run-meta-b", false);
  const gradientStrokeEndpointsEntry = await readTexture("gradient-stroke-endpoints", false);
  const gradientStrokePrimitiveMetaEntry = await readTexture("gradient-stroke-primitive-meta", false);
  const gradientStrokePrimitiveBoundsEntry = await readTexture("gradient-stroke-primitive-bounds", false);
  const gradientStrokeStylesEntry = await readTexture("gradient-stroke-styles", false);

  const fillPathCount = readNonNegativeInt(sceneMeta.fillPathCount, fillPathMetaAEntry?.logicalItemCount ?? 0);
  const fillSegmentCount = readNonNegativeInt(sceneMeta.fillSegmentCount, fillPrimitiveAEntry?.logicalItemCount ?? 0);
  const segmentCount = strokeGeometrySection?.segmentCount ?? 0;
  const textInstanceCount = textInstancesSection?.count ?? 0;
  const textGlyphCount = readNonNegativeInt(sceneMeta.textGlyphCount, textGlyphMetaAEntry?.logicalItemCount ?? 0);
  const textGlyphSegmentCount = textGlyphSegmentsSection?.segmentCount ?? 0;
  if (readNonNegativeInt(sceneMeta.textGlyphPrimitiveCount, textGlyphSegmentCount) !== textGlyphSegmentCount) {
    throw new Error("HEP scene glyph segment count does not match its textGlyphSegments section.");
  }
  const gradientCount = readNonNegativeInt(sceneMeta.gradientCount, gradientMetaAEntry?.logicalItemCount ?? 0);
  const gradientFillPathCount = readNonNegativeInt(
    sceneMeta.gradientFillPathCount,
    gradientFillPathMetaAEntry?.logicalItemCount ?? 0
  );
  const gradientFillSegmentCount = readNonNegativeInt(
    sceneMeta.gradientFillSegmentCount,
    gradientFillPrimitiveAEntry?.logicalItemCount ?? 0
  );
  const gradientStrokeRunCount = readNonNegativeInt(
    sceneMeta.gradientStrokeRunCount,
    gradientStrokeRunMetaAEntry?.logicalItemCount ?? 0
  );
  const gradientStrokeSegmentCount = readNonNegativeInt(
    sceneMeta.gradientStrokeSegmentCount,
    gradientStrokeEndpointsEntry?.logicalItemCount ?? 0
  );
  for (const [label, entry, expectedCount] of [
    ["gradient-meta-a", gradientMetaAEntry, gradientCount],
    ["gradient-meta-b", gradientMetaBEntry, gradientCount],
    ["gradient-meta-c", gradientMetaCEntry, gradientCount],
    ["gradient-meta-d", gradientMetaDEntry, gradientCount],
    ["gradient-meta-e", gradientMetaEEntry, gradientCount],
    ["gradient-fill-path-meta-a", gradientFillPathMetaAEntry, gradientFillPathCount],
    ["gradient-fill-path-meta-b", gradientFillPathMetaBEntry, gradientFillPathCount],
    ["gradient-fill-path-meta-c", gradientFillPathMetaCEntry, gradientFillPathCount],
    ["gradient-fill-paint-meta", gradientFillPaintMetaEntry, gradientFillPathCount],
    ["gradient-fill-primitives-a", gradientFillPrimitiveAEntry, gradientFillSegmentCount],
    ["gradient-fill-primitives-b", gradientFillPrimitiveBEntry, gradientFillSegmentCount],
    ["gradient-stroke-run-meta-a", gradientStrokeRunMetaAEntry, gradientStrokeRunCount],
    ["gradient-stroke-run-meta-b", gradientStrokeRunMetaBEntry, gradientStrokeRunCount],
    ["gradient-stroke-endpoints", gradientStrokeEndpointsEntry, gradientStrokeSegmentCount],
    ["gradient-stroke-primitive-meta", gradientStrokePrimitiveMetaEntry, gradientStrokeSegmentCount],
    ["gradient-stroke-primitive-bounds", gradientStrokePrimitiveBoundsEntry, gradientStrokeSegmentCount],
    ["gradient-stroke-styles", gradientStrokeStylesEntry, gradientStrokeSegmentCount]
  ] as const) {
    if (expectedCount > 0 && !entry) {
      throw new Error(`HEP file is missing required texture: ${label}.`);
    }
    if (entry && entry.logicalItemCount !== expectedCount) {
      throw new Error(
        `Texture ${label} item count does not match scene metadata (${entry.logicalItemCount} != ${expectedCount}).`
      );
    }
  }

  if (segmentCount > 0 && !strokeStylesEntry) {
    throw new Error("HEP file is missing the stroke-styles texture.");
  }

  const fillPathMetaA = trimTextureForItemCount(fillPathMetaAEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-a");
  const fillPathMetaB = trimTextureForItemCount(fillPathMetaBEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-b");
  const fillPathMetaC = trimTextureForItemCount(fillPathMetaCEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-c");
  const fillSegmentsA = trimTextureForItemCount(fillPrimitiveAEntry?.data ?? new Float32Array(0), fillSegmentCount, "fill-primitives-a");
  const fillSegmentsB = trimTextureForItemCount(fillPrimitiveBEntry?.data ?? new Float32Array(0), fillSegmentCount, "fill-primitives-b");
  const gradientMetaA = trimTextureForItemCount(gradientMetaAEntry?.data ?? new Float32Array(0), gradientCount, "gradient-meta-a");
  const gradientMetaB = trimTextureForItemCount(gradientMetaBEntry?.data ?? new Float32Array(0), gradientCount, "gradient-meta-b");
  const gradientMetaC = trimTextureForItemCount(gradientMetaCEntry?.data ?? new Float32Array(0), gradientCount, "gradient-meta-c");
  const gradientMetaD = trimTextureForItemCount(gradientMetaDEntry?.data ?? new Float32Array(0), gradientCount, "gradient-meta-d");
  const gradientMetaE = trimTextureForItemCount(gradientMetaEEntry?.data ?? new Float32Array(0), gradientCount, "gradient-meta-e");
  const gradientFillPathMetaA = trimTextureForItemCount(gradientFillPathMetaAEntry?.data ?? new Float32Array(0), gradientFillPathCount, "gradient-fill-path-meta-a");
  const gradientFillPathMetaB = trimTextureForItemCount(gradientFillPathMetaBEntry?.data ?? new Float32Array(0), gradientFillPathCount, "gradient-fill-path-meta-b");
  const gradientFillPathMetaC = trimTextureForItemCount(gradientFillPathMetaCEntry?.data ?? new Float32Array(0), gradientFillPathCount, "gradient-fill-path-meta-c");
  const gradientFillPaintMeta = trimTextureForItemCount(gradientFillPaintMetaEntry?.data ?? new Float32Array(0), gradientFillPathCount, "gradient-fill-paint-meta");
  const gradientFillSegmentsA = trimTextureForItemCount(gradientFillPrimitiveAEntry?.data ?? new Float32Array(0), gradientFillSegmentCount, "gradient-fill-primitives-a");
  const gradientFillSegmentsB = trimTextureForItemCount(gradientFillPrimitiveBEntry?.data ?? new Float32Array(0), gradientFillSegmentCount, "gradient-fill-primitives-b");
  const gradientStrokeRunMetaA = trimTextureForItemCount(gradientStrokeRunMetaAEntry?.data ?? new Float32Array(0), gradientStrokeRunCount, "gradient-stroke-run-meta-a");
  const gradientStrokeRunMetaB = trimTextureForItemCount(gradientStrokeRunMetaBEntry?.data ?? new Float32Array(0), gradientStrokeRunCount, "gradient-stroke-run-meta-b");
  const gradientStrokeEndpoints = trimTextureForItemCount(gradientStrokeEndpointsEntry?.data ?? new Float32Array(0), gradientStrokeSegmentCount, "gradient-stroke-endpoints");
  const gradientStrokePrimitiveMeta = trimTextureForItemCount(gradientStrokePrimitiveMetaEntry?.data ?? new Float32Array(0), gradientStrokeSegmentCount, "gradient-stroke-primitive-meta");
  const gradientStrokePrimitiveBounds = trimTextureForItemCount(gradientStrokePrimitiveBoundsEntry?.data ?? new Float32Array(0), gradientStrokeSegmentCount, "gradient-stroke-primitive-bounds");
  const gradientStrokeStyles = trimTextureForItemCount(gradientStrokeStylesEntry?.data ?? new Float32Array(0), gradientStrokeSegmentCount, "gradient-stroke-styles");
  const gradientLut = await readGradientLutFromParsedData(archive, manifest.gradientLut, gradientCount);
  const gradientMesh = await readHepGradientMesh(archive, manifest.gradientMesh, gradientCount, signal);
  validateGradientMesh({ gradientCount, gradientMetaA, ...gradientMesh });
  const nativeGradientResources: NativeGradientResources = {
    gradientCount,
    gradientMetaA,
    gradientMetaB,
    gradientMetaC,
    gradientMetaD,
    gradientMetaE,
    gradientLut,
    gradientFillPathCount,
    gradientFillSegmentCount,
    gradientFillPathMetaA,
    gradientFillPathMetaB,
    gradientFillPathMetaC,
    gradientFillPaintMeta,
    gradientFillSegmentsA,
    gradientFillSegmentsB,
    gradientStrokeRunCount,
    gradientStrokeSegmentCount,
    gradientStrokeRunMetaA,
    gradientStrokeRunMetaB,
    gradientStrokeEndpoints,
    gradientStrokePrimitiveMeta,
    gradientStrokePrimitiveBounds,
    gradientStrokeStyles
  };

  const strokeDecodeStart = performance.now();
  const strokeGeometry = strokeGeometrySection ? await readStrokeGeometryFromSection(archive, strokeGeometrySection) : null;
  const strokeDecodeMs = performance.now() - strokeDecodeStart;
  const endpoints = strokeGeometry?.endpoints ?? new Float32Array(0);
  const styles = trimTextureForItemCount(strokeStylesEntry?.data ?? new Float32Array(0), segmentCount, "stroke-styles");
  const primitiveMeta = strokeGeometry?.primitiveMeta ?? new Float32Array(0);
  const primitiveBounds = strokeGeometry?.primitiveBounds ?? new Float32Array(0);

  const textInstanceA = trimTextureForItemCount(textInstanceAEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-a");
  const textDecodeStart = performance.now();
  const textInstanceB = textInstancesSection
    ? await readTextInstancesFromSection(archive, textInstancesSection, textInstanceA)
    : new Float32Array(0);
  let textClipRects: Float32Array | undefined;
  if (textInstancesSection?.clipRectsFile && textInstancesSection.clipReferencesFile) {
    const rectEntry = archive.file(textInstancesSection.clipRectsFile);
    const refEntry = archive.file(textInstancesSection.clipReferencesFile);
    if (!rectEntry || !refEntry) throw new Error("HEP file is missing text clip files.");
    const [rectBuffer, refBuffer] = await Promise.all([
      rectEntry.async("arraybuffer"),
      refEntry.async("arraybuffer")
    ]);
    if (rectBuffer.byteLength !== textInstancesSection.clipRectCount! * 16 ||
        refBuffer.byteLength !== textInstanceCount * 4) {
      throw new Error("HEP file text clip data has a length mismatch.");
    }
    textClipRects = new Float32Array(rectBuffer);
    const references = new Uint32Array(refBuffer);
    for (let index = 0; index < references.length; index += 1) {
      if (references[index] > textInstancesSection.clipRectCount!) {
        throw new Error("HEP file text clip reference is out of range.");
      }
      textInstanceB[index * 4 + 3] = references[index];
    }
  }
  if (strokeGeometrySection || textInstancesSection) {
    const textDecodeMs = performance.now() - textDecodeStart;
    console.log(
      `[Parsed data load] geometry decode: strokes ${strokeDecodeMs.toFixed(0)} ms (${segmentCount.toLocaleString()} segments), text ${textDecodeMs.toFixed(0)} ms (${textInstanceCount.toLocaleString()} instances)`
    );
  }
  const textInstanceC = trimTextureForItemCount(textInstanceCEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-c");
  const textGlyphMetaA = trimTextureForItemCount(textGlyphMetaAEntry?.data ?? new Float32Array(0), textGlyphCount, "text-glyph-meta-a");
  const textGlyphMetaB = trimTextureForItemCount(textGlyphMetaBEntry?.data ?? new Float32Array(0), textGlyphCount, "text-glyph-meta-b");
  const { segmentsA: textGlyphSegmentsA, segmentsB: textGlyphSegmentsB } = textGlyphSegmentsSection
    ? decodeTextGlyphSegments(
      await readSceneSectionBytes(archive, textGlyphSegmentsSection.file, signal),
      textGlyphSegmentsSection
    )
    : { segmentsA: new Float32Array(0), segmentsB: new Float32Array(0) };

  const sourceSegmentCount = readNonNegativeInt(sceneMeta.sourceSegmentCount, segmentCount);
  const mergedSegmentCount = readNonNegativeInt(sceneMeta.mergedSegmentCount, segmentCount);
  const sourceTextCount = readNonNegativeInt(sceneMeta.sourceTextCount, textInstanceCount);
  const textInPageCount = readNonNegativeInt(sceneMeta.textInPageCount, textInstanceCount);
  const textOutOfPageCount = readNonNegativeInt(sceneMeta.textOutOfPageCount, Math.max(0, sourceTextCount - textInPageCount));
  const pageCount = Math.max(1, readNonNegativeInt(sceneMeta.pageCount, 1));
  const pagesPerRow = Math.max(1, readNonNegativeInt(sceneMeta.pagesPerRow, 1));
  validateNativeGradientResources(nativeGradientResources, pageCount);
  progress.report(0.82, { stage: "hep-section", sourceType: "hep", unit: "sections" });
  signal?.throwIfAborted();
  const rasterLayers = await readRasterLayersFromParsedData(archive, sceneMeta, manifest.formatVersion, signal);
  signal?.throwIfAborted();
  for (const layer of rasterLayers) {
    if (layer.pageIndex >= pageCount) {
      throw new Error(`Raster layer references invalid page ${layer.pageIndex}.`);
    }
  }
  progress.report(0.88, { stage: "compile", sourceType: "hep" });
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const textIndex = await readSceneTextIndexFromParsedData(archive, manifest);
  signal?.throwIfAborted();
  const maxHalfWidth =
    readFiniteNumber(sceneMeta.maxHalfWidth, Number.NaN) ||
    computeMaxHalfWidth(styles, segmentCount);

  const parsedBounds = parseBounds(sceneMeta.bounds);
  const parsedPageBounds = parseBounds(sceneMeta.pageBounds);
  const fallbackBounds =
    mergeBounds(
      mergeBounds(
        boundsFromPrimitiveBounds(primitiveBounds, segmentCount),
        boundsFromFillPathMeta(fillPathMetaA, fillPathMetaB, fillPathCount)
      ),
      mergeBounds(
        boundsFromPrimitiveBounds(gradientStrokePrimitiveBounds, gradientStrokeSegmentCount),
        boundsFromFillPathMeta(gradientFillPathMetaA, gradientFillPathMetaB, gradientFillPathCount)
      )
    ) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const bounds = parsedBounds ?? fallbackBounds;
  const pageBounds = parsedPageBounds ?? bounds;
  const pageRects = parsePageRects(sceneMeta.pageRects, pageBounds);
  const pageTextRanges = parsePageTextRanges(
    sceneMeta.pageTextRanges,
    Math.max(1, Math.floor(pageRects.length / 4)),
    textInstanceCount
  ) ?? inferPageTextRanges(pageRects, textInstanceB, textInstanceCount);
  progress.report(0.96, { stage: "compile", sourceType: "hep" });

  const scene = optimizeVectorSceneTextGlyphs({
    ...gradientMesh,
    pageRects,
    pageTextRanges,
    textIndex,
    fillPathCount,
    fillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    gradientCount,
    gradientMetaA,
    gradientMetaB,
    gradientMetaC,
    gradientMetaD,
    gradientMetaE,
    gradientLut,
    gradientFillPathCount,
    gradientFillSegmentCount,
    gradientFillPathMetaA,
    gradientFillPathMetaB,
    gradientFillPathMetaC,
    gradientFillPaintMeta,
    gradientFillSegmentsA,
    gradientFillSegmentsB,
    gradientStrokeRunCount,
    gradientStrokeSegmentCount,
    gradientStrokeRunMetaA,
    gradientStrokeRunMetaB,
    gradientStrokeEndpoints,
    gradientStrokePrimitiveMeta,
    gradientStrokePrimitiveBounds,
    gradientStrokeStyles,
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
    ...(textClipRects ? { textClipRects } : {}),
    textGlyphMetaA,
    textGlyphMetaB,
    textGlyphSegmentsA,
    textGlyphSegmentsB,
    rasterLayers,
    rasterLayerWidth: primaryRasterLayer?.width ?? 0,
    rasterLayerHeight: primaryRasterLayer?.height ?? 0,
    rasterLayerData: primaryRasterLayer?.monochrome ? new Uint8Array(0) : primaryRasterLayer?.data ?? new Uint8Array(0),
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
    ...(typeof sceneMeta.imageLayerSegmentCount === "number" &&
        Number.isSafeInteger(sceneMeta.imageLayerSegmentCount) && sceneMeta.imageLayerSegmentCount >= 0 &&
        [sceneMeta.discardedTransparentCount, sceneMeta.discardedDegenerateCount,
          sceneMeta.discardedDuplicateCount, sceneMeta.discardedContainedCount].every(
          (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      ? { imageLayerSegmentCount: sceneMeta.imageLayerSegmentCount } : {}),
    pathCount: readNonNegativeInt(sceneMeta.pathCount, 0),
    discardedTransparentCount: readNonNegativeInt(sceneMeta.discardedTransparentCount, 0),
    discardedDegenerateCount: readNonNegativeInt(sceneMeta.discardedDegenerateCount, 0),
    discardedDuplicateCount: readNonNegativeInt(sceneMeta.discardedDuplicateCount, 0),
    discardedContainedCount: readNonNegativeInt(sceneMeta.discardedContainedCount, 0)
  });
  if (primaryRasterLayer?.monochrome) {
    Object.defineProperty(scene, "rasterLayerData", {
      enumerable: true,
      configurable: true,
      get: () => primaryRasterLayer.data
    });
  }
  if (sceneMeta.pagePrimitiveRanges !== undefined) {
    const ranges = sceneMeta.pagePrimitiveRanges;
    if (!Array.isArray(ranges) || ranges.length !== scene.pageRects.length / 4 * 12 ||
        !ranges.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff))
      throw new RangeError("Invalid page primitive ranges.");
    scene.pagePrimitiveRanges = Uint32Array.from(ranges);
    validatePagePrimitiveRanges(scene);
  }
  if (sceneMeta.clipPaths !== undefined) {
    const meta = readSceneSectionDescriptor(sceneMeta.clipPaths, SCENE_CLIP_PATHS_PATH, "clip paths");
    const count = readSceneSectionCount(meta, "count", "clip paths");
    const edgeCount = readSceneSectionCount(meta, "edgeCount", "clip paths");
    scene.clipPaths = decodeSceneClipPaths(await readSceneSectionBytes(archive, SCENE_CLIP_PATHS_PATH, signal));
    if (scene.clipPaths.length !== count ||
        scene.clipPaths.reduce((total, clip) => total + clip.edges.length / 4, 0) !== edgeCount) {
      throw new Error("Scene clip paths do not match their manifest entry.");
    }
  }
  if (sceneMeta.drawRuns !== undefined) {
    const meta = readSceneSectionDescriptor(sceneMeta.drawRuns, SCENE_DRAW_RUNS_PATH, "draw runs");
    const count = readSceneSectionCount(meta, "count", "draw runs");
    scene.drawRuns = decodeSceneDrawRuns(await readSceneSectionBytes(archive, SCENE_DRAW_RUNS_PATH, signal));
    if (scene.drawRuns.length !== count) throw new Error("Scene draw runs do not match their manifest entry.");
  }
  if (sceneMeta.optionalContent !== undefined) {
    validateSceneOptionalContent(sceneMeta.optionalContent);
    scene.optionalContent = sceneMeta.optionalContent;
  }
  if (sceneMeta.retainedPages !== undefined) {
    if (!Array.isArray(sceneMeta.retainedPages)) throw new Error("Invalid retained page resources.");
    const retained = new Map<string, HeprPageData>();
    scene.retainedPages = [];
    for (const resource of sceneMeta.retainedPages) {
      signal?.throwIfAborted();
      if (!resource || typeof resource.file !== "string" || !resource.file ||
          !Array.isArray(resource.matrix) || resource.matrix.length !== 6 ||
          !resource.matrix.every((value: unknown) => typeof value === "number" && Number.isFinite(value)) ||
          !Array.isArray(resource.optionalContentConditions) || !resource.optionalContentConditions.every((value: unknown) =>
            typeof value === "number" && Number.isSafeInteger(value) && value >= -1 && value <= 0x7fffffff)) {
        throw new Error("Invalid retained page resource metadata.");
      }
      let page = retained.get(resource.file);
      if (!page) {
        const entry = archive.file(resource.file);
        if (!entry) throw new Error("Missing retained page resource.");
        page = decodeHeprPageData(await entry.async("uint8array"), signal);
        retained.set(resource.file, page);
      }
      scene.retainedPages.push({ page, matrix: Float32Array.from(resource.matrix),
        optionalContentConditions: Int32Array.from(resource.optionalContentConditions) });
    }
  }
  if (sceneMeta.paintGraph !== undefined) {
    const meta = readSceneSectionDescriptor(sceneMeta.paintGraph, SCENE_PAINT_GRAPH_PATH, "paint graph");
    const rootCount = readSceneSectionCount(meta, "rootCount", "paint graph");
    scene.paintGraph = decodeScenePaintGraph(await readSceneSectionBytes(archive, SCENE_PAINT_GRAPH_PATH, signal));
    if (scene.paintGraph.roots.length !== rootCount) {
      throw new Error("Scene paint graph does not match its manifest entry.");
    }
  }
  validateVectorDrawRuns(scene);
  validateSceneOptionalContentReferences(scene);
  validateSceneRetainedPages(scene);
  validateScenePaintGraph(scene);
  if (strokeGeometry) {
    preparedStrokeGeometry.set(scene, strokeGeometry.encoded);
  }
  scene.annotations = await readHepAnnotations(archive, sceneMeta.annotations, scene, signal);
  await readHepStructure(archive, sceneMeta.structure, scene, signal);
  preparedHepScenes.add(scene);
  if (manifest.sourcePdfByteLength !== undefined) scene.sourcePdfByteLength = Number(manifest.sourcePdfByteLength);
  await readHepLod(archive, scene, manifest.lod, signal);
  progress.complete({ sourceType: "hep" });
  return scene;
}

async function readGradientLutFromParsedData(
  archive: HepArchive,
  rawEntry: unknown,
  gradientCount: number
): Promise<Uint8Array> {
  const expectedByteLength = gradientCount * GRADIENT_LUT_WIDTH * 4;
  if (expectedByteLength === 0) {
    return new Uint8Array(0);
  }
  if (!rawEntry || typeof rawEntry !== "object") {
    throw new Error("HEP file is missing its gradient LUT metadata.");
  }
  const entry = rawEntry as ParsedDataGradientLutEntry;
  const width = readNonNegativeInt(entry.width, 0);
  const height = readNonNegativeInt(entry.height, 0);
  const byteLength = readNonNegativeInt(entry.byteLength, 0);
  const file = typeof entry.file === "string" ? entry.file : "";
  if (width !== GRADIENT_LUT_WIDTH || height !== gradientCount || byteLength !== expectedByteLength) {
    throw new Error("Parsed data gradient LUT dimensions do not match the scene metadata.");
  }
  const archiveEntry = file ? archive.file(file) : null;
  if (!archiveEntry) {
    throw new Error("HEP file is missing its gradient LUT payload.");
  }
  const bytes = new Uint8Array(await archiveEntry.async("arraybuffer"));
  if (bytes.length !== expectedByteLength) {
    throw new Error(
      `Gradient LUT byte length is invalid (${bytes.length} != ${expectedByteLength}).`
    );
  }
  return bytes;
}

function validateNativeGradientResources(resources: NativeGradientResources, pageCount: number): void {
  const {
    gradientCount,
    gradientMetaA,
    gradientMetaB,
    gradientMetaC,
    gradientMetaD,
    gradientMetaE,
    gradientLut,
    gradientFillPathCount,
    gradientFillSegmentCount,
    gradientFillPathMetaA,
    gradientFillPaintMeta,
    gradientStrokeRunCount,
    gradientStrokeSegmentCount,
    gradientStrokeRunMetaA,
    gradientStrokeRunMetaB
  } = resources;

  for (const [label, values] of [
    ["gradient metadata A", resources.gradientMetaA],
    ["gradient metadata B", resources.gradientMetaB],
    ["gradient metadata C", resources.gradientMetaC],
    ["gradient metadata D", resources.gradientMetaD],
    ["gradient metadata E", resources.gradientMetaE],
    ["gradient fill metadata A", resources.gradientFillPathMetaA],
    ["gradient fill metadata B", resources.gradientFillPathMetaB],
    ["gradient fill metadata C", resources.gradientFillPathMetaC],
    ["gradient fill paint metadata", resources.gradientFillPaintMeta],
    ["gradient fill primitives A", resources.gradientFillSegmentsA],
    ["gradient fill primitives B", resources.gradientFillSegmentsB],
    ["gradient stroke run metadata A", resources.gradientStrokeRunMetaA],
    ["gradient stroke run metadata B", resources.gradientStrokeRunMetaB],
    ["gradient stroke endpoints", resources.gradientStrokeEndpoints],
    ["gradient stroke primitive metadata", resources.gradientStrokePrimitiveMeta],
    ["gradient stroke primitive bounds", resources.gradientStrokePrimitiveBounds],
    ["gradient stroke styles", resources.gradientStrokeStyles]
  ] as const) {
    if (!values.every(Number.isFinite)) {
      throw new Error(`Parsed data ${label} contains non-finite values.`);
    }
  }

  if (gradientLut.length !== gradientCount * GRADIENT_LUT_WIDTH * 4) {
    throw new Error("Gradient LUT length does not match gradientCount.");
  }
  for (let i = 0; i < gradientCount; i += 1) {
    const offset = i * 4;
    const kind = gradientMetaA[offset];
    const hasBBox = gradientMetaA[offset + 1];
    if ((kind !== 0 && kind !== 1 && kind !== 2) || (hasBBox !== 0 && hasBBox !== 1)) {
      throw new Error(`Gradient ${i} has an invalid kind or bounding-box flag.`);
    }
    const extensionFlags = gradientMetaA[offset + 2];
    const background = gradientMetaA[offset + 3];
    if (!Number.isInteger(extensionFlags) || extensionFlags < 0 || extensionFlags > 3 ||
        !Number.isInteger(background) || background < 0 || background > 0x1000000) {
      throw new Error(`Gradient ${i} has invalid extension or background metadata.`);
    }
    const values = [
      ...gradientMetaB.subarray(offset, offset + 4),
      ...gradientMetaC.subarray(offset, offset + 4),
      ...gradientMetaD.subarray(offset, offset + 4)
    ];
    if (!values.every(Number.isFinite)) {
      throw new Error(`Gradient ${i} contains non-finite metadata.`);
    }
    const det = gradientMetaB[offset] * gradientMetaB[offset + 3] -
      gradientMetaB[offset + 1] * gradientMetaB[offset + 2];
    if (Math.abs(det) <= 1e-12) {
      throw new Error(`Gradient ${i} has a singular scene-to-gradient transform.`);
    }
    const dx = gradientMetaD[offset] - gradientMetaC[offset + 2];
    const dy = gradientMetaD[offset + 1] - gradientMetaC[offset + 3];
    if (kind === 0 && dx * dx + dy * dy <= 1e-18) {
      throw new Error(`Axial gradient ${i} has a degenerate axis.`);
    }
    if (kind === 1) {
      const radius0 = gradientMetaD[offset + 2];
      const radius1 = gradientMetaD[offset + 3];
      if (radius0 < 0 || radius1 < 0) {
        throw new Error(`Radial gradient ${i} has a negative radius.`);
      }
      const centerDistance = Math.hypot(dx, dy);
      if (centerDistance <= 1e-9 && Math.abs(radius1 - radius0) <= 1e-9) {
        throw new Error(`Radial gradient ${i} has identical start and end circles.`);
      }
    }
    if (hasBBox === 1) {
      const bbox = gradientMetaE.subarray(offset, offset + 4);
      if (!bbox.every(Number.isFinite) || bbox[2] < bbox[0] || bbox[3] < bbox[1]) {
        throw new Error(`Gradient ${i} has an invalid bounding box.`);
      }
    }
  }

  const validateGradientRef = (value: number, label: string): void => {
    if (!Number.isInteger(value) || value < -1 || value >= gradientCount) {
      throw new Error(`${label} references invalid gradient ${value}.`);
    }
  };
  for (let i = 0; i < gradientFillPathCount; i += 1) {
    const offset = i * 4;
    const segmentStart = gradientFillPathMetaA[offset];
    const segmentCount = gradientFillPathMetaA[offset + 1];
    if (
      !Number.isInteger(segmentStart) || !Number.isInteger(segmentCount) ||
      segmentStart < 0 || segmentCount <= 0 || segmentStart + segmentCount > gradientFillSegmentCount
    ) {
      throw new Error(`Gradient fill ${i} has an invalid primitive range.`);
    }
    validateGradientRef(gradientFillPaintMeta[offset], `Gradient fill ${i}`);
    validateGradientRef(gradientFillPaintMeta[offset + 1], `Gradient fill mask ${i}`);
    if (
      !Number.isFinite(gradientFillPaintMeta[offset + 2]) || gradientFillPaintMeta[offset + 2] < 0 ||
      !Number.isInteger(gradientFillPaintMeta[offset + 3]) ||
      gradientFillPaintMeta[offset + 3] < 0 || gradientFillPaintMeta[offset + 3] >= pageCount
    ) {
      throw new Error(`Gradient fill ${i} has invalid paint metadata.`);
    }
  }
  for (let i = 0; i < gradientStrokeRunCount; i += 1) {
    const offset = i * 4;
    const segmentStart = gradientStrokeRunMetaA[offset];
    const segmentCount = gradientStrokeRunMetaA[offset + 1];
    if (
      !Number.isInteger(segmentStart) || !Number.isInteger(segmentCount) ||
      segmentStart < 0 || segmentCount <= 0 || segmentStart + segmentCount > gradientStrokeSegmentCount
    ) {
      throw new Error(`Gradient stroke run ${i} has an invalid segment range.`);
    }
    validateGradientRef(gradientStrokeRunMetaA[offset + 2], `Gradient stroke run ${i}`);
    validateGradientRef(gradientStrokeRunMetaA[offset + 3], `Gradient stroke mask ${i}`);
    if (
      !Number.isFinite(gradientStrokeRunMetaB[offset]) || gradientStrokeRunMetaB[offset] < 0 ||
      !Number.isInteger(gradientStrokeRunMetaB[offset + 1]) ||
      gradientStrokeRunMetaB[offset + 1] < 0 || gradientStrokeRunMetaB[offset + 1] >= pageCount
    ) {
      throw new Error(`Gradient stroke run ${i} has invalid paint metadata.`);
    }
  }
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

function parsePageTextRanges(value: unknown, pageCount: number, textInstanceCount: number): Uint32Array | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedPageCount = Math.max(1, pageCount | 0);
  if (value.length < normalizedPageCount * 2) {
    return null;
  }

  const maxTextInstanceCount = Math.max(0, textInstanceCount | 0);
  const out = new Uint32Array(normalizedPageCount * 2);
  let previousStart = 0;
  for (let pageIndex = 0; pageIndex < normalizedPageCount; pageIndex += 1) {
    const offset = pageIndex * 2;
    const start = readNonNegativeInt(value[offset], previousStart);
    const count = readNonNegativeInt(value[offset + 1], 0);
    const clampedStart = Math.min(Math.max(start, previousStart), maxTextInstanceCount);
    const clampedCount = Math.min(count, Math.max(0, maxTextInstanceCount - clampedStart));
    out[offset] = clampedStart;
    out[offset + 1] = clampedCount;
    previousStart = clampedStart + clampedCount;
  }

  return out;
}

/** A layer record is at most ~70 bytes; this bounds the table before inflating it. */
const MAX_RASTER_RECORD_BYTES = 80;

async function readRasterLayersFromParsedData(
  archive: HepArchive,
  sceneMeta: ParsedDataSceneEntry,
  formatVersion: number,
  signal?: AbortSignal
): Promise<RasterLayer[]> {
  if (sceneMeta.rasterLayers === undefined) {
    return [];
  }
  const meta = readSceneSectionDescriptor(sceneMeta.rasterLayers, SCENE_RASTER_LAYERS_PATH, "raster layers");
  const count = readSceneSectionCount(meta, "count", "raster layers");
  const atlasCount = readSceneSectionCount(meta, "atlasCount", "raster layers");
  const tableEntry = archive.file(SCENE_RASTER_LAYERS_PATH);
  const tableByteLength = tableEntry ? readHepEntryUncompressedSize(tableEntry) : null;
  if (tableByteLength === null || tableByteLength > (count + atlasCount + 1) * MAX_RASTER_RECORD_BYTES) {
    throw new Error("Scene raster layer table is missing or larger than its records allow.");
  }
  const table = decodeRasterLayerTable(await readSceneSectionBytes(archive, SCENE_RASTER_LAYERS_PATH, signal), {
    maxLayers: count,
    maxAtlases: atlasCount,
    maxDimension: 0x7fffffff
  });
  if (table.layers.length !== count || table.atlases.length !== atlasCount) {
    throw new Error("Scene raster layers do not match their manifest entry.");
  }
  if (formatVersion < PARSED_DATA_MONOCHROME_FORMAT_VERSION && table.layers.some(layer => layer.storage === "mono")) {
    throw new Error("Packed monochrome raster layers require HEP scene format v10.");
  }
  if (formatVersion < PARSED_DATA_JBIG2_FORMAT_VERSION && table.layers.some(layer => layer.storage === "jbig2")) {
    throw new Error("Original JBIG2 raster layers require HEP scene format v11.");
  }
  if (formatVersion < PARSED_DATA_BINARY_FORMAT_VERSION && table.layers.some(layer => layer.storage === "binary")) {
    throw new Error("Transposed binary raster layers require HEP scene format v12.");
  }
  validateRasterLayerPayloads(archive, table);

  // Decode an atlas when its first cell is needed and release it after its last.
  const lastCellIndex = new Map<number, number>();
  table.layers.forEach((layer, index) => {
    if (layer.cell) lastCellIndex.set(layer.cell.atlas, index);
  });
  const atlasPixels = new Map<number, Uint8Array>();
  // Decode shared legacy JBIG2 globals once across layers.
  const jbig2Globals = new Map<number, Uint8Array>();
  const layers: RasterLayer[] = [];
  for (let i = 0; i < table.layers.length; i += 1) {
    signal?.throwIfAborted();
    const record = table.layers[i];
    const base = {
      width: record.width,
      height: record.height,
      matrix: record.matrix,
      paintOrder: record.paintOrder,
      pageIndex: record.pageIndex,
      ...(record.opacity === undefined ? {} : { opacity: record.opacity })
    };
    if (record.storage === "mono") {
      const bytes = await archive.file(rasterLayerFile(i, "mono"))!.async("uint8array");
      signal?.throwIfAborted();
      layers.push(createMonochromeRasterLayer(base, decodeHepMonochromeRaster(bytes, record.width, record.height)));
      continue;
    }
    if (record.storage === "binary") {
      const bytes = await archive.file(rasterLayerFile(i, "binary"))!.async("uint8array");
      signal?.throwIfAborted();
      layers.push(createMonochromeRasterLayer(base, decodeHepBinaryRaster(bytes, record.width, record.height, signal)));
      continue;
    }
    if (record.storage === "jbig2") {
      const bytes = await archive.file(rasterLayerFile(i, "jbig2"))!.async("uint8array");
      signal?.throwIfAborted();
      const stored = inspectHepJbig2Raster(bytes, record.width, record.height, HEP_JBIG2_MAX_DECODE_BYTES);
      let globals: Uint8Array = new Uint8Array(0);
      if (stored.globalsIndex !== HEP_JBIG2_NO_GLOBALS) {
        const globalsPath = hepJbig2GlobalsFile(stored.globalsIndex);
        const globalsEntry = archive.file(globalsPath);
        if (!globalsEntry || readHepEntryUncompressedSize(globalsEntry) !== stored.globalsLength) {
          throw new Error(`JBIG2 globals section ${globalsPath} is missing or does not match its metadata.`);
        }
        const cached = jbig2Globals.get(stored.globalsIndex);
        if (cached) globals = cached;
        else {
          globals = await globalsEntry.async("uint8array");
          signal?.throwIfAborted();
          jbig2Globals.set(stored.globalsIndex, globals);
        }
      }
      const monochrome = await decodeHepJbig2Raster(bytes, globals, record.width, record.height,
        HEP_JBIG2_MAX_DECODE_BYTES, signal);
      signal?.throwIfAborted();
      layers.push(createMonochromeRasterLayer(base, monochrome));
      continue;
    }
    let data: Uint8Array;
    if (record.storage === "atlas") {
      const cell = record.cell!;
      const atlas = table.atlases[cell.atlas];
      let pixels = atlasPixels.get(cell.atlas);
      if (!pixels) {
        pixels = await readRasterImageSection(archive, rasterAtlasFile(cell.atlas, atlas.encoding), atlas.width, atlas.height);
        signal?.throwIfAborted();
        atlasPixels.set(cell.atlas, pixels);
      }
      data = new Uint8Array(record.width * record.height * 4);
      copyRasterRect(pixels, atlas.width, cell.x, cell.y, data, record.width, 0, 0, record.width, record.height);
      if (lastCellIndex.get(cell.atlas) === i) atlasPixels.delete(cell.atlas);
    } else {
      data = await readRasterImageSection(archive, rasterLayerFile(i, record.storage), record.width, record.height);
      signal?.throwIfAborted();
    }
    layers.push({ ...base, data });
  }

  return layers;
}

/** Straight-alpha RGBA8 of one raw, PNG or WebP section with known dimensions. */
async function readRasterImageSection(
  archive: HepArchive,
  path: string,
  width: number,
  height: number
): Promise<Uint8Array> {
  const archiveEntry = archive.file(path);
  if (!archiveEntry) {
    throw new Error(`HEP file is missing raster section ${path}.`);
  }

  const bytes = new Uint8Array(await archiveEntry.async("arraybuffer"));
  const expectedLength = width * height * 4;
  const imageEncoding = rasterImageEncodingFromPath(path);
  if (!imageEncoding) {
    if (bytes.byteLength !== expectedLength) {
      throw new Error(
        `Raster section ${path} size does not match its metadata (${bytes.byteLength} !== ${expectedLength}).`
      );
    }
    return bytes;
  }

  const metadata = inspectRasterImage(imageEncoding, bytes);
  if (!metadata || metadata.width !== width || metadata.height !== height) {
    throw new Error(`Raster image ${path} header dimensions do not match its metadata.`);
  }
  const decodedImage = await decodeRasterImageToRgba(imageEncoding, bytes);
  if (!decodedImage) {
    throw new Error(
      `Unable to decode raster image ${path}; the image is invalid or no compatible image decoder is available.`
    );
  }
  if (decodedImage.width !== width || decodedImage.height !== height ||
      decodedImage.data.byteLength !== expectedLength) {
    throw new Error(`Raster image ${path} dimensions do not match its metadata.`);
  }
  return decodedImage.data;
}

/**
 * Validate declared raster dimensions and section sizes before decoding.
 * Actual image allocations are governed by the device and its codec.
 */
function validateRasterLayerPayloads(archive: HepArchive, table: RasterLayerTable): void {
  const addTexels = (texels: number, label: string, decodedBytes = texels * 4): void => {
    if (!Number.isSafeInteger(texels) || !Number.isSafeInteger(decodedBytes)) {
      throw new Error(`${label} decoded byte length is not a safe integer.`);
    }
  };
  const addSection = (path: string, rawBytes: number | null, label: string): number => {
    const archiveEntry = archive.file(path);
    if (!archiveEntry) {
      throw new Error(`HEP file is missing ${label.toLowerCase()}: ${path}.`);
    }
    const byteLength = readHepEntryUncompressedSize(archiveEntry);
    if (byteLength === null) {
      throw new Error(`${label} HEP section size is invalid.`);
    }
    if (rawBytes !== null && rasterImageEncodingFromPath(path) === null && byteLength !== rawBytes) {
      throw new Error(`${label} raw byte length does not match its metadata.`);
    }
    return byteLength;
  };
  table.atlases.forEach((atlas, index) => {
    const texels = atlas.width * atlas.height;
    addTexels(texels, `Raster atlas ${index}`);
    addSection(rasterAtlasFile(index, atlas.encoding), texels * 4, `Raster atlas ${index}`);
  });
  table.layers.forEach((layer, index) => {
    const texels = layer.width * layer.height;
    const monochrome = layer.storage === "mono" || layer.storage === "binary" || layer.storage === "jbig2";
    const decodedBytes = monochrome ? hepMonochromeRasterByteLength(layer.width, layer.height) : texels * 4;
    addTexels(texels, `Raster layer ${index}`, decodedBytes);
    if (layer.storage !== "atlas") {
      const encodedMono = layer.storage === "binary" || layer.storage === "jbig2";
      const byteLength = addSection(rasterLayerFile(index, layer.storage), encodedMono ? null : decodedBytes, `Raster layer ${index}`);
      if (layer.storage === "binary" && (byteLength < HEP_BINARY_RASTER_HEADER_BYTES + 2 ||
          byteLength > hepBinaryRasterByteLengthLimit(layer.width, layer.height))) {
        throw new Error(`Raster layer ${index} binary section size does not match its dimensions.`);
      }
      if (layer.storage === "jbig2") {
        if (byteLength <= HEP_JBIG2_RASTER_HEADER_BYTES ||
            byteLength > HEP_JBIG2_MAX_DECODE_BYTES ||
            decodedBytes - 8 + byteLength - HEP_JBIG2_RASTER_HEADER_BYTES > HEP_JBIG2_MAX_DECODE_BYTES) {
          throw new Error(`Raster layer ${index} JBIG2 section exceeds the decode byte budget.`);
        }
      }
    }
  });
  for (const path of Object.keys(archive.files)) {
    if (!/^raster\/jbig2-globals-\d+\.bin$/.test(path)) continue;
    const byteLength = addSection(path, null, "JBIG2 globals");
    if (byteLength === 0 || byteLength > HEP_JBIG2_MAX_DECODE_BYTES) {
      throw new Error("JBIG2 globals section exceeds the decode byte budget.");
    }
  }
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

/**
 * A v8 scene structure lives in its own section and the manifest only points at
 * it, with the counts a reader checks the decoded section against.
 */
function readSceneSectionDescriptor(
  value: unknown,
  expectedFile: string,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid scene ${label} entry.`);
  }
  const descriptor = value as Record<string, unknown>;
  if (descriptor.file !== expectedFile) {
    throw new Error(`Scene ${label} entry does not name ${expectedFile}.`);
  }
  return descriptor;
}

function readSceneSectionCount(
  descriptor: Record<string, unknown>,
  key: string,
  label: string
): number {
  const count = descriptor[key];
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid scene ${label} ${key}.`);
  }
  return count;
}

async function readSceneSectionBytes(
  archive: HepArchive,
  file: string,
  signal: AbortSignal | undefined
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const entry = archive.file(file);
  if (!entry) throw new Error(`Missing scene section ${file}.`);
  const bytes = await entry.async("uint8array");
  signal?.throwIfAborted();
  return bytes;
}

function readHepEntryUncompressedSize(entry: unknown): number | null {
  const value = (entry as { uncompressedSize?: unknown }).uncompressedSize;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
