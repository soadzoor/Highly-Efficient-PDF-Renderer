import JSZip from "jszip";

import {
  extractPdfRasterScene,
  inferPageTextRanges,
  optimizeVectorSceneTextGlyphs,
  type Bounds,
  type PageTextIndex,
  type RasterLayer,
  type SceneTextIndex,
  type VectorScene
} from "./pdfVectorExtractor";
import { createLoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import {
  decodeByteShuffledFloat32,
  decodeChannelMajorFloat32,
  decodeXorDeltaByteShuffledFloat32,
  encodeChannelMajorFloat32,
  encodeXorDeltaByteShuffledFloat32
} from "./parsedDataEncoding";
import {
  ByteWriter,
  decodeFixed512DeltaColumnInto,
  decodeRangeUint16,
  decodeU16DeltaColumnInto,
  encodeFixed512DeltaColumn,
  encodeRangeUint16,
  encodeU16DeltaColumn,
  VarintCursor,
  zigzagDecode32,
  zigzagEncode32
} from "./parsedDataVarint";

interface ExportTextureEntry {
  name: string;
  filePath: string;
  width: number;
  height: number;
  logicalItemCount: number;
  logicalFloatCount: number;
  data: Uint8Array;
  componentType: TextureComponentType;
  layout: TextureLayout;
  quantizationMin?: number[];
  quantizationMax?: number[];
  byteShuffle?: boolean;
  predictor?: "none" | "xor-delta-u32";
  columnByteLengths?: number[];
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
type TextureComponentType =
  | "float32"
  | "uint8-normalized"
  | "uint16-normalized-range"
  | "uint16-range-delta-columns";

export interface BuildParsedDataZipOptions {
  encodeRasterImages?: boolean;
  zipCompression?: "STORE" | "DEFLATE";
  zipDeflateLevel?: number;
}

export interface LoadParsedDataZipOptions {
  onProgress?: LoadProgressCallback;
}

interface ParsedDataTextureEntry {
  name?: unknown;
  file?: unknown;
  componentType?: unknown;
  layout?: unknown;
  quantizationMin?: unknown;
  quantizationMax?: unknown;
  byteShuffle?: unknown;
  predictor?: unknown;
  logicalItemCount?: unknown;
  logicalFloatCount?: unknown;
  columnByteLengths?: unknown;
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
  pageTextRanges?: unknown;
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
}

interface ParsedDataManifest {
  formatVersion?: unknown;
  sourceFile?: unknown;
  sourcePdfFile?: unknown;
  sourcePdfUrl?: unknown;
  sourcePdfSizeBytes?: unknown;
  scene?: ParsedDataSceneEntry;
  textures?: ParsedDataTextureEntry[];
  textIndex?: unknown;
  strokeGeometry?: unknown;
  textInstances?: unknown;
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
  const sourcePdfFile = useSourcePdfFallback ? "source/source.pdf" : undefined;

  for (const entry of textureEntries) {
    const bytes = serializeTextureExportEntry(entry);
    zip.file(entry.filePath, bytes);
  }

  if (sourcePdfFile && sourcePdfBytes) {
    zip.file(sourcePdfFile, sourcePdfBytes);
  }

  const textIndexExport = buildTextIndexExport(scene);
  if (textIndexExport) {
    zip.file(TEXT_INDEX_JSON_PATH, textIndexExport.json);
    zip.file(TEXT_CHAR_MAP_PATH, textIndexExport.charMapBytes);
    if (textIndexExport.fallbackBytes) {
      zip.file(TEXT_FALLBACK_PATH, textIndexExport.fallbackBytes);
    }
  }

  const strokeGeometryExport = buildStrokeGeometryExport(scene);
  if (strokeGeometryExport) {
    zip.file(STROKE_ENDPOINTS_PATH, strokeGeometryExport.endpointsBytes);
    zip.file(STROKE_META_PATH, strokeGeometryExport.metaBytes);
  }

  const textInstancesExport = buildTextInstancesExport(scene);
  if (textInstancesExport) {
    zip.file(textInstancesExport.manifest.positionsFile, textInstancesExport.positionsBytes);
    zip.file(textInstancesExport.manifest.glyphIndexFile, textInstancesExport.glyphIndexBytes);
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
    formatVersion: PARSED_DATA_FORMAT_VERSION,
    sourceFile: label,
    sourcePdfFile,
    sourcePdfSizeBytes: useSourcePdfFallback ? sourcePdfBytes?.length ?? 0 : 0,
    generatedAt: new Date().toISOString(),
    strokeGeometry: strokeGeometryExport?.manifest,
    textInstances: textInstancesExport?.manifest,
    textIndex: textIndexExport
      ? {
        version: 2,
        file: TEXT_INDEX_JSON_PATH,
        charMapFile: TEXT_CHAR_MAP_PATH,
        fallbackFile: textIndexExport.fallbackBytes ? TEXT_FALLBACK_PATH : undefined,
        fallbackColumnByteLengths: textIndexExport.fallbackBytes ? textIndexExport.fallbackColumnByteLengths : undefined,
        pageCount: textIndexExport.pageCount,
        totalCharCount: textIndexExport.totalCharCount,
        totalFallbackCount: textIndexExport.totalFallbackCount
      }
      : undefined,
    scene: {
      bounds: scene.bounds,
      pageBounds: scene.pageBounds,
      pageRects: Array.from(scene.pageRects),
      pageTextRanges: Array.from(scene.pageTextRanges),
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
      rasterLayers: serializedRasterLayers
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

/** Only zips written with this format version (or newer) can be loaded. */
const PARSED_DATA_FORMAT_VERSION = 5;

const TEXT_INDEX_JSON_PATH = "text/text-index.json";
const TEXT_CHAR_MAP_PATH = "text/char-map.bin";
const TEXT_FALLBACK_PATH = "text/fallback-quads.d512";

interface TextIndexExportResult {
  json: string;
  charMapBytes: Uint8Array;
  fallbackBytes: Uint8Array | null;
  fallbackColumnByteLengths: number[];
  pageCount: number;
  totalCharCount: number;
  totalFallbackCount: number;
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
    fallbackBytes,
    fallbackColumnByteLengths,
    pageCount: pageEntries.length,
    totalCharCount,
    totalFallbackCount
  };
}

interface TextIndexManifestMeta {
  version?: unknown;
  file?: unknown;
  charMapFile?: unknown;
  fallbackFile?: unknown;
  fallbackColumnByteLengths?: unknown;
}

interface TextIndexPageEntry {
  text?: unknown;
  fallbackCount?: unknown;
}

async function readSceneTextIndexFromParsedData(zip: JSZip, manifest: ParsedDataManifest): Promise<SceneTextIndex | null> {
  try {
    const meta =
      typeof manifest.textIndex === "object" && manifest.textIndex
        ? (manifest.textIndex as TextIndexManifestMeta)
        : {};
    const jsonPath = typeof meta.file === "string" ? meta.file : TEXT_INDEX_JSON_PATH;
    const jsonEntry = zip.file(jsonPath);
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
    const charMapEntry = zip.file(charMapPath);
    if (!charMapEntry) {
      return null;
    }
    return await readTextIndexV2(zip, meta, pageEntries, charMapEntry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Parsed data load] Failed to read text index: ${message}`);
    return null;
  }
}

async function readTextIndexV2(
  zip: JSZip,
  meta: TextIndexManifestMeta,
  pageEntries: TextIndexPageEntry[],
  charMapEntry: JSZip.JSZipObject
): Promise<SceneTextIndex | null> {
  const charMapBytes = new Uint8Array(await charMapEntry.async("arraybuffer"));

  let totalFallbackCount = 0;
  for (const entry of pageEntries) {
    totalFallbackCount += readNonNegativeInt(entry.fallbackCount, 0);
  }

  let fallbackAll: Float32Array | null = null;
  if (totalFallbackCount > 0) {
    const fallbackPath = typeof meta.fallbackFile === "string" ? meta.fallbackFile : TEXT_FALLBACK_PATH;
    const fallbackEntry = zip.file(fallbackPath);
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
    pages.push({ text, charInstance, fallbackQuads });
  }
  cursor.expectEnd("text/char-map.bin");

  return { version: 2, pages };
}

interface StrokeGeometrySectionMeta {
  endpointsFile: string;
  metaFile: string;
  segmentCount: number;
  curveCount: number;
  quantizationMin: number[];
  quantizationMax: number[];
  ctrlQuantizationMin: number[];
  ctrlQuantizationMax: number[];
  endpointColumnByteLengths: number[];
}

interface TextInstancesSectionMeta {
  positionsFile: string;
  glyphIndexFile: string;
  glyphIndexFormat: "u16" | "u32";
  count: number;
  positionColumnByteLengths: number[];
}

function readFiniteNumberArray(value: unknown, expectedLength: number): number[] | null {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    return null;
  }
  const out: number[] = [];
  for (const item of value) {
    const parsed = Number(item);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    out.push(parsed);
  }
  return out;
}

function parseStrokeGeometrySection(value: unknown): StrokeGeometrySectionMeta | null {
  if (typeof value !== "object" || !value) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const endpointsFile = typeof raw.endpointsFile === "string" ? raw.endpointsFile : null;
  const metaFile = typeof raw.metaFile === "string" ? raw.metaFile : null;
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
    endpointColumnByteLengths.some((length) => !Number.isInteger(length) || length < 0)
  ) {
    throw new Error("Parsed data zip has an invalid strokeGeometry section.");
  }
  return {
    endpointsFile,
    metaFile,
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
  const positionColumnByteLengths = readFiniteNumberArray(raw.positionColumnByteLengths, 2);
  if (
    !positionsFile ||
    !glyphIndexFile ||
    !glyphIndexFormat ||
    !Number.isInteger(count) ||
    count < 0 ||
    !positionColumnByteLengths ||
    positionColumnByteLengths.some((length) => !Number.isInteger(length) || length < 0)
  ) {
    throw new Error("Parsed data zip has an invalid textInstances section.");
  }
  return { positionsFile, glyphIndexFile, glyphIndexFormat, count, positionColumnByteLengths };
}

/**
 * Decodes the v5 stroke section back into the interleaved `endpoints` and
 * `primitiveMeta` arrays in one pass. Start points chain against the previous
 * segment's end point in the integer domain (exact), and curve control points
 * are stored as deltas against the quantized chord midpoint.
 */
async function readStrokeGeometryFromSection(
  zip: JSZip,
  section: StrokeGeometrySectionMeta
): Promise<{ endpoints: Float32Array; primitiveMeta: Float32Array }> {
  const segmentCount = section.segmentCount;
  const endpoints = new Float32Array(segmentCount * 4);
  const primitiveMeta = new Float32Array(segmentCount * 4);
  if (segmentCount === 0) {
    return { endpoints, primitiveMeta };
  }

  const endpointsEntry = zip.file(section.endpointsFile);
  const metaEntry = zip.file(section.metaFile);
  if (!endpointsEntry || !metaEntry) {
    throw new Error("Parsed data zip is missing v5 stroke geometry files.");
  }
  const [endpointBuffer, metaBuffer] = await Promise.all([
    endpointsEntry.async("arraybuffer"),
    metaEntry.async("arraybuffer")
  ]);
  const endpointBytes = new Uint8Array(endpointBuffer);
  const metaBytes = new Uint8Array(metaBuffer);

  const columnLengths = section.endpointColumnByteLengths;
  if (columnLengths[0] + columnLengths[1] + columnLengths[2] + columnLengths[3] !== endpointBytes.length) {
    throw new Error("Parsed data zip stroke endpoint columns have a length mismatch.");
  }
  const col0End = columnLengths[0];
  const col1End = col0End + columnLengths[1];
  const col2End = col1End + columnLengths[2];
  const startX = new VarintCursor(endpointBytes, 0, col0End);
  const startY = new VarintCursor(endpointBytes, col0End, col1End);
  const endX = new VarintCursor(endpointBytes, col1End, col2End);
  const endY = new VarintCursor(endpointBytes, col2End, endpointBytes.length);

  const bitsetLength = Math.ceil(segmentCount / 8);
  const ch3Start = bitsetLength;
  const ctrlStart = bitsetLength + segmentCount * 2;
  if (metaBytes.length < ctrlStart) {
    throw new Error("Parsed data zip stroke meta stream is truncated.");
  }
  const ctrl = new VarintCursor(metaBytes, ctrlStart, metaBytes.length);

  const qMin = section.quantizationMin;
  const qMax = section.quantizationMax;
  const cMin = section.ctrlQuantizationMin;
  const cMax = section.ctrlQuantizationMax;

  let prevEndXInt = 0;
  let prevEndYInt = 0;
  let curvesSeen = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    const sx = startX.readZigzagVarint() + prevEndXInt;
    const sy = startY.readZigzagVarint() + prevEndYInt;
    const ex = endX.readZigzagVarint() + sx;
    const ey = endY.readZigzagVarint() + sy;
    prevEndXInt = ex;
    prevEndYInt = ey;

    const startXFloat = decodeRangeUint16(sx, qMin[0], qMax[0]);
    const startYFloat = decodeRangeUint16(sy, qMin[1], qMax[1]);
    const endXFloat = decodeRangeUint16(ex, qMin[2], qMax[2]);
    const endYFloat = decodeRangeUint16(ey, qMin[3], qMax[3]);
    const isQuad = (metaBytes[i >> 3] >>> (i & 7)) & 1;

    const offset = i * 4;
    endpoints[offset] = startXFloat;
    endpoints[offset + 1] = startYFloat;
    if (isQuad) {
      curvesSeen += 1;
      const predictedX = encodeRangeUint16((startXFloat + endXFloat) * 0.5, cMin[0], cMax[0]);
      const predictedY = encodeRangeUint16((startYFloat + endYFloat) * 0.5, cMin[1], cMax[1]);
      endpoints[offset + 2] = decodeRangeUint16(ctrl.readZigzagVarint() + predictedX, cMin[0], cMax[0]);
      endpoints[offset + 3] = decodeRangeUint16(ctrl.readZigzagVarint() + predictedY, cMin[1], cMax[1]);
    } else {
      endpoints[offset + 2] = endXFloat;
      endpoints[offset + 3] = endYFloat;
    }

    primitiveMeta[offset] = endXFloat;
    primitiveMeta[offset + 1] = endYFloat;
    primitiveMeta[offset + 2] = isQuad;
    const styleWord = metaBytes[ch3Start + i * 2] | (metaBytes[ch3Start + i * 2 + 1] << 8);
    primitiveMeta[offset + 3] = (styleWord & 0x0fff) / 4095 + (styleWord >>> 12) * 2;
  }

  startX.expectEnd("stroke start-x column");
  startY.expectEnd("stroke start-y column");
  endX.expectEnd("stroke end-x column");
  endY.expectEnd("stroke end-y column");
  ctrl.expectEnd("stroke control-point stream");
  if (curvesSeen !== section.curveCount) {
    throw new Error(`Parsed data zip stroke curve count mismatch (${curvesSeen} vs ${section.curveCount}).`);
  }

  return { endpoints, primitiveMeta };
}

/** Decodes the v5 text instance section back into the interleaved textInstanceB array. */
async function readTextInstancesFromSection(zip: JSZip, section: TextInstancesSectionMeta): Promise<Float32Array> {
  const count = section.count;
  const instanceB = new Float32Array(count * 4);
  if (count === 0) {
    return instanceB;
  }

  const positionsEntry = zip.file(section.positionsFile);
  const glyphIndexEntry = zip.file(section.glyphIndexFile);
  if (!positionsEntry || !glyphIndexEntry) {
    throw new Error("Parsed data zip is missing v5 text instance files.");
  }
  const [positionsBuffer, glyphIndexBuffer] = await Promise.all([
    positionsEntry.async("arraybuffer"),
    glyphIndexEntry.async("arraybuffer")
  ]);
  const positionBytes = new Uint8Array(positionsBuffer);
  const [eLength, fLength] = section.positionColumnByteLengths;
  if (eLength + fLength !== positionBytes.length) {
    throw new Error("Parsed data zip text instance position columns have a length mismatch.");
  }

  decodeFixed512DeltaColumnInto(positionBytes, 0, eLength, instanceB, count, 4, 0);
  decodeFixed512DeltaColumnInto(positionBytes, eLength, positionBytes.length, instanceB, count, 4, 1);

  if (section.glyphIndexFormat === "u32") {
    if (glyphIndexBuffer.byteLength !== count * 4) {
      throw new Error("Parsed data zip glyph index stream has a length mismatch.");
    }
    const glyphIndices = new Uint32Array(glyphIndexBuffer);
    for (let i = 0; i < count; i += 1) {
      instanceB[i * 4 + 2] = glyphIndices[i];
    }
  } else {
    if (glyphIndexBuffer.byteLength !== count * 2) {
      throw new Error("Parsed data zip glyph index stream has a length mismatch.");
    }
    const glyphIndices = new Uint16Array(glyphIndexBuffer);
    for (let i = 0; i < count; i += 1) {
      instanceB[i * 4 + 2] = glyphIndices[i];
    }
  }

  return instanceB;
}

const STROKE_ENDPOINTS_PATH = "geometry/stroke-endpoints.csq16";
const STROKE_META_PATH = "geometry/stroke-meta.bin";
const TEXT_INSTANCE_POSITIONS_PATH = "geometry/text-instance-ef.d512";
const TEXT_INSTANCE_GLYPHS_U16_PATH = "geometry/text-instance-glyphs.u16";
const TEXT_INSTANCE_GLYPHS_U32_PATH = "geometry/text-instance-glyphs.u32";

function concatByteChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

interface StrokeGeometryExport {
  endpointsBytes: Uint8Array;
  metaBytes: Uint8Array;
  manifest: StrokeGeometrySectionMeta;
}

/**
 * v5 stroke storage: uint16 range-quantized coordinates stored as chained
 * per-column zigzag-varint deltas (start chains to the previous end, end is
 * relative to its own start) plus a type bitset, a raw u16 packed style
 * column, and control-point deltas only for curve segments.
 */
function buildStrokeGeometryExport(scene: VectorScene): StrokeGeometryExport | null {
  const segmentCount = Math.max(0, Math.trunc(scene.segmentCount));
  if (segmentCount === 0) {
    return null;
  }

  const endpointsSource = scene.endpoints.subarray(0, segmentCount * 4);
  const metaSource = scene.primitiveMeta.subarray(0, segmentCount * 4);
  const packedA = encodeUint16NormalizedRange(endpointsSource);
  const packedB = encodeStrokePrimitiveBUint16(metaSource);
  const aInts = new Uint16Array(packedA.data.buffer, packedA.data.byteOffset, packedA.data.byteLength / 2);
  const bInts = new Uint16Array(packedB.data.buffer, packedB.data.byteOffset, packedB.data.byteLength / 2);

  const startXColumn = new ByteWriter(segmentCount);
  const startYColumn = new ByteWriter(segmentCount);
  const endXColumn = new ByteWriter(segmentCount);
  const endYColumn = new ByteWriter(segmentCount);
  const bitset = new Uint8Array(Math.ceil(segmentCount / 8));
  const ctrl = new ByteWriter(256);

  let prevEndXInt = 0;
  let prevEndYInt = 0;
  let curveCount = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    const offset = i * 4;
    const sx = aInts[offset];
    const sy = aInts[offset + 1];
    const ex = bInts[offset];
    const ey = bInts[offset + 1];
    startXColumn.writeZigzagVarint(sx - prevEndXInt);
    startYColumn.writeZigzagVarint(sy - prevEndYInt);
    endXColumn.writeZigzagVarint(ex - sx);
    endYColumn.writeZigzagVarint(ey - sy);
    prevEndXInt = ex;
    prevEndYInt = ey;

    if (bInts[offset + 2] >= 1) {
      bitset[i >> 3] |= 1 << (i & 7);
      curveCount += 1;
      // Predict the control point from DECODED floats so the reader's
      // prediction reproduces this value bit-exactly.
      const startXFloat = decodeRangeUint16(sx, packedA.min[0], packedA.max[0]);
      const startYFloat = decodeRangeUint16(sy, packedA.min[1], packedA.max[1]);
      const endXFloat = decodeRangeUint16(ex, packedB.min[0], packedB.max[0]);
      const endYFloat = decodeRangeUint16(ey, packedB.min[1], packedB.max[1]);
      const predictedX = encodeRangeUint16((startXFloat + endXFloat) * 0.5, packedA.min[2], packedA.max[2]);
      const predictedY = encodeRangeUint16((startYFloat + endYFloat) * 0.5, packedA.min[3], packedA.max[3]);
      ctrl.writeZigzagVarint(aInts[offset + 2] - predictedX);
      ctrl.writeZigzagVarint(aInts[offset + 3] - predictedY);
    }
  }

  const meta = new ByteWriter(bitset.length + segmentCount * 2 + ctrl.length);
  meta.writeBytes(bitset);
  for (let i = 0; i < segmentCount; i += 1) {
    meta.writeUint16(bInts[i * 4 + 3]);
  }
  meta.writeBytes(ctrl.toUint8Array());

  const columns = [
    startXColumn.toUint8Array(),
    startYColumn.toUint8Array(),
    endXColumn.toUint8Array(),
    endYColumn.toUint8Array()
  ];

  return {
    endpointsBytes: concatByteChunks(columns),
    metaBytes: meta.toUint8Array(),
    manifest: {
      endpointsFile: STROKE_ENDPOINTS_PATH,
      metaFile: STROKE_META_PATH,
      segmentCount,
      curveCount,
      quantizationMin: [packedA.min[0], packedA.min[1], packedB.min[0], packedB.min[1]],
      quantizationMax: [packedA.max[0], packedA.max[1], packedB.max[0], packedB.max[1]],
      ctrlQuantizationMin: [packedA.min[2], packedA.min[3]],
      ctrlQuantizationMax: [packedA.max[2], packedA.max[3]],
      endpointColumnByteLengths: columns.map((column) => column.length)
    }
  };
}

interface TextInstancesExport {
  positionsBytes: Uint8Array;
  glyphIndexBytes: Uint8Array;
  manifest: TextInstancesSectionMeta;
}

/**
 * v5 text instance storage: e/f as fixed-point 1/512 per-column varint deltas
 * (quantization approved: max error 1/1024 scene unit), glyph indices as a
 * raw u16/u32 column. The always-zero 4th channel is dropped.
 */
function buildTextInstancesExport(scene: VectorScene): TextInstancesExport | null {
  const count = Math.max(0, Math.trunc(scene.textInstanceCount));
  if (count === 0) {
    return null;
  }

  const source = scene.textInstanceB.subarray(0, count * 4);
  const eColumn = encodeFixed512DeltaColumn(source, count, 4, 0);
  const fColumn = encodeFixed512DeltaColumn(source, count, 4, 1);

  let maxGlyphIndex = 0;
  for (let i = 0; i < count; i += 1) {
    const glyphIndex = Math.max(0, Math.trunc(source[i * 4 + 2]));
    if (glyphIndex > maxGlyphIndex) {
      maxGlyphIndex = glyphIndex;
    }
  }
  const useU32 = maxGlyphIndex > 65535;
  let glyphIndexBytes: Uint8Array;
  if (useU32) {
    const glyphIndices = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) {
      glyphIndices[i] = Math.max(0, Math.trunc(source[i * 4 + 2]));
    }
    glyphIndexBytes = new Uint8Array(glyphIndices.buffer);
  } else {
    const glyphIndices = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) {
      glyphIndices[i] = Math.max(0, Math.trunc(source[i * 4 + 2]));
    }
    glyphIndexBytes = new Uint8Array(glyphIndices.buffer);
  }

  return {
    positionsBytes: concatByteChunks([eColumn, fColumn]),
    glyphIndexBytes,
    manifest: {
      positionsFile: TEXT_INSTANCE_POSITIONS_PATH,
      glyphIndexFile: useU32 ? TEXT_INSTANCE_GLYPHS_U32_PATH : TEXT_INSTANCE_GLYPHS_U16_PATH,
      glyphIndexFormat: useU32 ? "u32" : "u16",
      count,
      positionColumnByteLengths: [eColumn.length, fColumn.length]
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
    // Stroke endpoints/meta live in the v5 strokeGeometry section; stroke
    // bounds are derived on load either way.
    createTextureExportEntry("stroke-styles", scene.styles, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("text-instance-a", scene.textInstanceA, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    // text-instance-b lives in the v5 textInstances section.
    createTextureExportEntry("text-instance-c", scene.textInstanceC, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-a", scene.textGlyphMetaA, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-b", scene.textGlyphMetaB, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-primitives-a", scene.textGlyphSegmentsA, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount, textureLayout),
    createTextureExportEntry("text-glyph-primitives-b", scene.textGlyphSegmentsB, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount, textureLayout)
  ];
}

export async function loadSceneFromParsedDataZip(
  buffer: ArrayBuffer,
  options: LoadParsedDataZipOptions = {}
): Promise<VectorScene> {
  const progress = createLoadProgressReporter(options.onProgress);
  const zip = await progress.child(0, 0.16, { sourceType: "zip" }).withIndeterminateProgress(
    JSZip.loadAsync(buffer),
    { stage: "zip-open", sourceType: "zip" }
  );
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Parsed data zip is missing manifest.json.");
  }

  const manifestJson = await progress.child(0.16, 0.22, { sourceType: "zip" }).withIndeterminateProgress(
    manifestFile.async("string"),
    { stage: "zip-manifest", sourceType: "zip" }
  );
  let manifest: ParsedDataManifest;
  try {
    manifest = JSON.parse(manifestJson) as ParsedDataManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid manifest.json: ${message}`);
  }

  const formatVersion = readNonNegativeInt(manifest.formatVersion, 0);
  if (formatVersion < PARSED_DATA_FORMAT_VERSION) {
    throw new Error(
      `Parsed data zip format v${formatVersion} is no longer supported; re-export the zip with the current version.`
    );
  }

  const sceneMeta = typeof manifest.scene === "object" && manifest.scene ? manifest.scene : {};
  const manifestTextures = Array.isArray(manifest.textures) ? manifest.textures : [];

  const strokeGeometrySection = parseStrokeGeometrySection(manifest.strokeGeometry);
  const textInstancesSection = parseTextInstancesSection(manifest.textInstances);

  const textureByName = new Map<string, ParsedDataTextureEntry>();
  const textureReadTotal = 12;
  let textureReadCount = 0;
  const reportTextureProgress = (): void => {
    progress.report(0.22 + (textureReadCount / textureReadTotal) * 0.58, {
      stage: "zip-file",
      sourceType: "zip",
      unit: "files",
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
      reportTextureProgress();
      const entry = textureByName.get(name);
      const path = entry && typeof entry.file === "string" ? entry.file : null;
      const zipEntry = path ? zip.file(path) : null;
      if (!entry || !zipEntry) {
        if (required) {
          throw new Error(`Parsed data zip is missing required texture: ${name}.`);
        }
        return null;
      }

      const fileBuffer = await zipEntry.async("arraybuffer");
      const raw = readTexturePayloadAsFloat32(fileBuffer, entry, name);
      const logicalFloatCount = readNonNegativeInt(entry.logicalFloatCount, raw.length);
      if (logicalFloatCount > raw.length) {
        throw new Error(`Texture ${name} logical float count exceeds file length.`);
      }

      const logicalItemCount = readNonNegativeInt(entry.logicalItemCount, Math.floor(logicalFloatCount / 4));
      return {
        data: raw.slice(0, logicalFloatCount),
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
  const textGlyphPrimitiveAEntry = await readTexture("text-glyph-primitives-a", false);
  const textGlyphPrimitiveBEntry = await readTexture("text-glyph-primitives-b", false);

  const fillPathCount = readNonNegativeInt(sceneMeta.fillPathCount, fillPathMetaAEntry?.logicalItemCount ?? 0);
  const fillSegmentCount = readNonNegativeInt(sceneMeta.fillSegmentCount, fillPrimitiveAEntry?.logicalItemCount ?? 0);
  const segmentCount = strokeGeometrySection?.segmentCount ?? 0;
  const textInstanceCount = textInstancesSection?.count ?? 0;
  const textGlyphCount = readNonNegativeInt(sceneMeta.textGlyphCount, textGlyphMetaAEntry?.logicalItemCount ?? 0);
  const textGlyphSegmentCount = readNonNegativeInt(
    sceneMeta.textGlyphPrimitiveCount,
    readNonNegativeInt(sceneMeta.textGlyphSegmentCount, textGlyphPrimitiveAEntry?.logicalItemCount ?? 0)
  );

  if (segmentCount > 0 && !strokeStylesEntry) {
    throw new Error("Parsed data zip is missing the stroke-styles texture.");
  }

  const fillPathMetaA = trimTextureForItemCount(fillPathMetaAEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-a");
  const fillPathMetaB = trimTextureForItemCount(fillPathMetaBEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-b");
  const fillPathMetaC = trimTextureForItemCount(fillPathMetaCEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-c");
  const fillSegmentsA = trimTextureForItemCount(fillPrimitiveAEntry?.data ?? new Float32Array(0), fillSegmentCount, "fill-primitives-a");
  const fillSegmentsB = trimTextureForItemCount(fillPrimitiveBEntry?.data ?? new Float32Array(0), fillSegmentCount, "fill-primitives-b");

  const strokeDecodeStart = performance.now();
  const strokeGeometry = strokeGeometrySection ? await readStrokeGeometryFromSection(zip, strokeGeometrySection) : null;
  const strokeDecodeMs = performance.now() - strokeDecodeStart;
  const endpoints = strokeGeometry?.endpoints ?? new Float32Array(0);
  const styles = trimTextureForItemCount(strokeStylesEntry?.data ?? new Float32Array(0), segmentCount, "stroke-styles");
  const primitiveMeta = strokeGeometry?.primitiveMeta ?? new Float32Array(0);
  const primitiveBounds = derivePrimitiveBounds(endpoints, primitiveMeta, segmentCount);

  const textInstanceA = trimTextureForItemCount(textInstanceAEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-a");
  const textDecodeStart = performance.now();
  const textInstanceB = textInstancesSection
    ? await readTextInstancesFromSection(zip, textInstancesSection)
    : new Float32Array(0);
  if (strokeGeometrySection || textInstancesSection) {
    const textDecodeMs = performance.now() - textDecodeStart;
    console.log(
      `[Parsed data load] v5 geometry decode: strokes ${strokeDecodeMs.toFixed(0)} ms (${segmentCount.toLocaleString()} segments), text ${textDecodeMs.toFixed(0)} ms (${textInstanceCount.toLocaleString()} instances)`
    );
  }
  const textInstanceC = trimTextureForItemCount(textInstanceCEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-c");
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

  const sourceSegmentCount = readNonNegativeInt(sceneMeta.sourceSegmentCount, segmentCount);
  const mergedSegmentCount = readNonNegativeInt(sceneMeta.mergedSegmentCount, segmentCount);
  const sourceTextCount = readNonNegativeInt(sceneMeta.sourceTextCount, textInstanceCount);
  const textInPageCount = readNonNegativeInt(sceneMeta.textInPageCount, textInstanceCount);
  const textOutOfPageCount = readNonNegativeInt(sceneMeta.textOutOfPageCount, Math.max(0, sourceTextCount - textInPageCount));
  const pageCount = Math.max(1, readNonNegativeInt(sceneMeta.pageCount, 1));
  const pagesPerRow = Math.max(1, readNonNegativeInt(sceneMeta.pagesPerRow, 1));
  progress.report(0.82, { stage: "zip-file", sourceType: "zip", unit: "files" });
  let rasterLayers = await readRasterLayersFromParsedData(zip, sceneMeta);
  progress.report(0.88, { stage: "compile", sourceType: "zip" });
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
  const textIndex = await readSceneTextIndexFromParsedData(zip, manifest);
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
  const pageTextRanges = parsePageTextRanges(
    sceneMeta.pageTextRanges,
    Math.max(1, Math.floor(pageRects.length / 4)),
    textInstanceCount
  ) ?? inferPageTextRanges(pageRects, textInstanceB, textInstanceCount);
  progress.report(0.96, { stage: "compile", sourceType: "zip" });

  const scene = optimizeVectorSceneTextGlyphs({
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
  });
  progress.complete({ sourceType: "zip" });
  return scene;
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

function packTextureForZip(
  name: string,
  source: Float32Array,
  textureLayout: TextureLayout
): {
  data: Uint8Array;
  componentType: TextureComponentType;
  layout: TextureLayout;
  suffix: string;
  quantizationMin?: number[];
  quantizationMax?: number[];
  byteShuffle?: boolean;
  predictor?: "none" | "xor-delta-u32";
  columnByteLengths?: number[];
} {
  if (name === "text-instance-c") {
    return {
      data: encodeNormalizedUint8(source),
      componentType: "uint8-normalized",
      layout: "interleaved",
      suffix: ".rgba8"
    };
  }

  if (name === "text-instance-a") {
    // Glyph matrices repeat heavily along text lines; the xor-delta predictor
    // plus byte shuffle lets DEFLATE collapse them (read path pre-existing).
    return {
      data: encodeXorDeltaByteShuffledFloat32(source),
      componentType: "float32",
      layout: "interleaved",
      suffix: ".f32bs",
      byteShuffle: true,
      predictor: "xor-delta-u32"
    };
  }

  if (name === "fill-primitives-a" || name === "fill-primitives-b") {
    // Same q16 grid as before, stored as per-column zigzag-varint deltas:
    // fill outlines chain segment to segment, so deltas stay tiny.
    const packed = encodeUint16NormalizedRange(source);
    const quantized = new Uint16Array(packed.data.buffer, packed.data.byteOffset, packed.data.byteLength / 2);
    const itemCount = Math.floor(source.length / 4);
    const columns: Uint8Array[] = [];
    const columnByteLengths: number[] = [];
    let totalBytes = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const column = encodeU16DeltaColumn(quantized, itemCount, 4, channel);
      columns.push(column);
      columnByteLengths.push(column.length);
      totalBytes += column.length;
    }
    const data = new Uint8Array(totalBytes);
    let byteOffset = 0;
    for (const column of columns) {
      data.set(column, byteOffset);
      byteOffset += column.length;
    }
    return {
      data,
      componentType: "uint16-range-delta-columns",
      layout: "interleaved",
      suffix: ".q16dc",
      quantizationMin: Array.from(packed.min),
      quantizationMax: Array.from(packed.max),
      columnByteLengths
    };
  }

  if (usesRangeQuantizedUint16(name)) {
    const packed = encodeUint16NormalizedRange(source);
    return {
      data: packed.data,
      componentType: "uint16-normalized-range",
      layout: "interleaved",
      suffix: ".q16",
      quantizationMin: Array.from(packed.min),
      quantizationMax: Array.from(packed.max)
    };
  }

  const bytes = textureLayout === "channel-major"
    ? encodeChannelMajorFloat32(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  return {
    data: bytes,
    componentType: "float32",
    layout: textureLayout,
    suffix: textureLayout === "channel-major" ? ".f32cm" : ".f32"
  };
}

function usesRangeQuantizedUint16(name: string): boolean {
  return name === "text-glyph-primitives-a"
    || name === "text-glyph-primitives-b";
}

function encodeNormalizedUint8(source: Float32Array): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    const value = Number.isFinite(source[i]) ? source[i] : 0;
    out[i] = Math.round(clamp01(value) * 255);
  }
  return out;
}

function encodeUint16NormalizedRange(source: Float32Array): { data: Uint8Array; min: Float32Array; max: Float32Array } {
  const itemCount = Math.floor(source.length / 4);
  const min = new Float32Array([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
  const max = new Float32Array([Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]);

  for (let i = 0; i < itemCount; i += 1) {
    const offset = i * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const value = source[offset + channel];
      if (!Number.isFinite(value)) {
        continue;
      }
      min[channel] = Math.min(min[channel], value);
      max[channel] = Math.max(max[channel], value);
    }
  }

  for (let channel = 0; channel < 4; channel += 1) {
    if (!Number.isFinite(min[channel]) || !Number.isFinite(max[channel])) {
      min[channel] = 0;
      max[channel] = 0;
    }
  }

  const quantized = new Uint16Array(source.length);
  for (let i = 0; i < itemCount; i += 1) {
    const offset = i * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      quantized[offset + channel] = encodeRangeUint16(source[offset + channel], min[channel], max[channel]);
    }
  }

  return {
    data: new Uint8Array(quantized.buffer),
    min,
    max
  };
}

function encodeStrokePrimitiveBUint16(source: Float32Array): { data: Uint8Array; min: Float32Array; max: Float32Array } {
  const itemCount = Math.floor(source.length / 4);
  const min = new Float32Array([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0, 0]);
  const max = new Float32Array([Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, 1, 0]);

  for (let i = 0; i < itemCount; i += 1) {
    const offset = i * 4;
    const x = source[offset];
    const y = source[offset + 1];
    if (Number.isFinite(x)) {
      min[0] = Math.min(min[0], x);
      max[0] = Math.max(max[0], x);
    }
    if (Number.isFinite(y)) {
      min[1] = Math.min(min[1], y);
      max[1] = Math.max(max[1], y);
    }
  }

  for (let channel = 0; channel < 2; channel += 1) {
    if (!Number.isFinite(min[channel]) || !Number.isFinite(max[channel])) {
      min[channel] = 0;
      max[channel] = 0;
    }
  }

  const packed = new Uint16Array(source.length);
  for (let i = 0; i < itemCount; i += 1) {
    const offset = i * 4;
    packed[offset] = encodeRangeUint16(source[offset], min[0], max[0]);
    packed[offset + 1] = encodeRangeUint16(source[offset + 1], min[1], max[1]);
    packed[offset + 2] = source[offset + 2] >= 0.5 ? 1 : 0;

    const packedStyle = Number.isFinite(source[offset + 3]) ? source[offset + 3] : 0;
    const styleFlags = Math.min(15, Math.max(0, Math.floor(packedStyle / 2 + 1e-6)));
    const alpha = clamp01(packedStyle - styleFlags * 2);
    const alphaBits = Math.round(alpha * 4095);
    packed[offset + 3] = (styleFlags << 12) | alphaBits;
  }

  return {
    data: new Uint8Array(packed.buffer),
    min,
    max
  };
}

function readTexturePayloadAsFloat32(
  fileBuffer: ArrayBuffer,
  entry: ParsedDataTextureEntry,
  textureName: string
): Float32Array {
  const componentType = typeof entry.componentType === "string" ? entry.componentType : "float32";
  if (componentType === "uint8-normalized") {
    return decodeNormalizedUint8(new Uint8Array(fileBuffer));
  }
  if (componentType === "uint16-normalized-range") {
    return decodeUint16NormalizedRange(new Uint8Array(fileBuffer), entry, textureName);
  }
  if (componentType === "uint16-range-delta-columns") {
    return decodeUint16RangeDeltaColumns(new Uint8Array(fileBuffer), entry, textureName);
  }
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

function decodeNormalizedUint8(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i] / 255;
  }
  return out;
}

function decodeUint16NormalizedRange(
  bytes: Uint8Array,
  entry: ParsedDataTextureEntry,
  textureName: string
): Float32Array {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error(`Texture ${textureName} has invalid uint16 byte length (${bytes.byteLength}).`);
  }
  const min = readQuantizationVector(entry.quantizationMin, textureName, "quantizationMin");
  const max = readQuantizationVector(entry.quantizationMax, textureName, "quantizationMax");
  const quantized = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const out = new Float32Array(quantized.length);

  for (let i = 0; i < quantized.length; i += 1) {
    const channel = i & 3;
    out[i] = decodeRangeUint16(quantized[i], min[channel], max[channel]);
  }

  return out;
}

function decodeUint16RangeDeltaColumns(
  bytes: Uint8Array,
  entry: ParsedDataTextureEntry,
  textureName: string
): Float32Array {
  const min = readQuantizationVector(entry.quantizationMin, textureName, "quantizationMin");
  const max = readQuantizationVector(entry.quantizationMax, textureName, "quantizationMax");
  const itemCount = readNonNegativeInt(entry.logicalItemCount, 0);
  const lengths = readFiniteNumberArray(entry.columnByteLengths, 4);
  if (!lengths || lengths.some((length) => !Number.isInteger(length) || length < 0)) {
    throw new Error(`Texture ${textureName} has invalid columnByteLengths.`);
  }
  if (lengths[0] + lengths[1] + lengths[2] + lengths[3] !== bytes.length) {
    throw new Error(`Texture ${textureName} delta columns have a length mismatch.`);
  }

  const quantized = new Uint16Array(itemCount * 4);
  let byteOffset = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    decodeU16DeltaColumnInto(bytes, byteOffset, byteOffset + lengths[channel], quantized, itemCount, 4, channel);
    byteOffset += lengths[channel];
  }

  const out = new Float32Array(itemCount * 4);
  for (let i = 0; i < out.length; i += 1) {
    const channel = i & 3;
    out[i] = decodeRangeUint16(quantized[i], min[channel], max[channel]);
  }
  return out;
}

function readQuantizationVector(value: unknown, textureName: string, label: string): Float32Array {
  if (!Array.isArray(value) || value.length < 4) {
    throw new Error(`Texture ${textureName} is missing ${label}.`);
  }

  const out = new Float32Array(4);
  for (let i = 0; i < 4; i += 1) {
    const number = Number(value[i]);
    if (!Number.isFinite(number)) {
      throw new Error(`Texture ${textureName} has invalid ${label}[${i}].`);
    }
    out[i] = number;
  }
  return out;
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
