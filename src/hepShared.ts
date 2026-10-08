import { validatePagePrimitiveRanges } from "./scenePageViews";
import { validateVectorDrawRuns } from "./vectorDrawOrder";
import { validateSceneOptionalContentReferences } from "./optionalContent";
import { validateSceneRetainedPages } from "./retainedPageData";
import { validateScenePaintGraph } from "./scenePaintGraph";
import { copyRasterLayer } from "./monochromeRaster";
import {
  optimizeVectorSceneTextGlyphs,
  type RasterLayer,
  type VectorScene
} from "./pdfVectorExtractor";
import {
  decodeTextGlyphSegments,
  encodeTextGlyphSegments
} from "./hepTextSections";
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
  VarintCursor
} from "./parsedDataVarint";
import type {
  TextureLayout,
  TextureComponentType,
  ParsedDataTextureEntry,
  StrokeGeometryExport
} from "./hepTypes";

/**
 * v7 retained PDF layer definitions, conditions and initially hidden content.
 * v8 moves the scene clip paths, draw runs and paint graph out of the manifest
 * into binary sections. v9 stores raster layers as a binary table with small
 * images packed into atlases, chains glyph outline points and predicts glyph
 * origins from their advances; see docs/HEP_CONTAINER.md.
 */
export const PARSED_DATA_FORMAT_VERSION = 9;
/** Packed monochrome raster sections extend the otherwise unchanged v9 scene. */
export const PARSED_DATA_MONOCHROME_FORMAT_VERSION = 10;
/** Original compressed JBIG2 streams can be decoded without the source PDF. */
export const PARSED_DATA_JBIG2_FORMAT_VERSION = 11;
/** Transposed binary run sections extend the otherwise unchanged v11 scene. */
export const PARSED_DATA_BINARY_FORMAT_VERSION = 12;
export const TEXT_INDEX_JSON_PATH = "text/text-index.json";
export const TEXT_CHAR_MAP_PATH = "text/char-map.bin";
export const TEXT_FALLBACK_PATH = "text/fallback-quads.d512";
export const TEXT_OPTIONAL_CONTENT_PATH = "text/optional-content.varint";

export function readFiniteNumberArray(value: unknown, expectedLength: number): number[] | null {
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

export function decodeStrokeGeometry(encoded: StrokeGeometryExport): {
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
} {
  const section = encoded.manifest;
  const segmentCount = section.segmentCount;
  const endpoints = new Float32Array(segmentCount * 4);
  const primitiveMeta = new Float32Array(segmentCount * 4);
  if (segmentCount === 0) {
    return { endpoints, primitiveMeta, primitiveBounds: new Float32Array(0) };
  }
  const endpointBytes = encoded.endpointsBytes;
  const metaBytes = encoded.metaBytes;

  const columnLengths = section.endpointColumnByteLengths;
  if (columnLengths[0] + columnLengths[1] + columnLengths[2] + columnLengths[3] !== endpointBytes.length) {
    throw new Error("HEP file stroke endpoint columns have a length mismatch.");
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
    throw new Error("HEP file stroke meta stream is truncated.");
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
    throw new Error(`HEP file stroke curve count mismatch (${curvesSeen} vs ${section.curveCount}).`);
  }

  const primitiveBounds = derivePrimitiveBounds(endpoints, primitiveMeta, segmentCount);
  if (section.clipBoundsFile) {
    const clipBoundsBytes = encoded.clipBoundsBytes;
    if (!clipBoundsBytes) {
      throw new Error("HEP file is missing clipped stroke bounds.");
    }
    const expectedBytes = section.clippedSegmentCount! * 4 * Float32Array.BYTES_PER_ELEMENT;
    if (clipBoundsBytes.byteLength !== expectedBytes) {
      throw new Error("HEP file clipped stroke bounds have a length mismatch.");
    }
    const clipBounds = new Float32Array(clipBoundsBytes.buffer, clipBoundsBytes.byteOffset, clipBoundsBytes.byteLength / 4);
    let clipIndex = 0;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const offset = segmentIndex * 4;
      const styleFlags = decodePackedStrokeStyleFlags(primitiveMeta[offset + 3]);
      if ((styleFlags & STROKE_STYLE_FLAG_CLIPPED) === 0) continue;
      if (clipIndex >= section.clippedSegmentCount!) {
        throw new Error("HEP file clipped stroke count does not match its style flags.");
      }
      const clipOffset = clipIndex * 4;
      const minX = clipBounds[clipOffset];
      const minY = clipBounds[clipOffset + 1];
      const maxX = clipBounds[clipOffset + 2];
      const maxY = clipBounds[clipOffset + 3];
      if (![minX, minY, maxX, maxY].every(Number.isFinite) ||
          minX > maxX || minY > maxY) {
        throw new Error("HEP file contains invalid clipped stroke bounds.");
      }
      primitiveBounds.set(clipBounds.subarray(clipOffset, clipOffset + 4), offset);
      clipIndex += 1;
    }
    if (clipIndex !== section.clippedSegmentCount) {
      throw new Error("HEP file clipped stroke count does not match its style flags.");
    }
  }

  return { endpoints, primitiveMeta, primitiveBounds };
}

const STROKE_ENDPOINTS_PATH = "geometry/stroke-endpoints.csq16";
const STROKE_META_PATH = "geometry/stroke-meta.bin";
const STROKE_CLIP_BOUNDS_PATH = "geometry/stroke-clip-bounds.f32";
const STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
const STROKE_STYLE_FLAG_OFFSET = 2;

function decodePackedStrokeStyleFlags(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.trunc(value / STROKE_STYLE_FLAG_OFFSET + 1e-6))
    : 0;
}

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

// Retain compact streams so re-encoding decoded curve/line mixtures cannot
// change their per-channel ranges and introduce drift.
export const preparedStrokeGeometry = new WeakMap<VectorScene, StrokeGeometryExport>();
export const preparedHepScenes = new WeakSet<VectorScene>();

/**
 * Apply HEP's existing vector precision after page layout and before LOD/GPU
 * preparation. Cached parser pages remain untouched. No archive is generated.
 */
export function prepareSceneForHepRendering(scene: VectorScene): VectorScene {
  validatePagePrimitiveRanges(scene);
  validateVectorDrawRuns(scene);
  validateSceneOptionalContentReferences(scene);
  validateSceneRetainedPages(scene);
  validateScenePaintGraph(scene);
  if (preparedHepScenes.has(scene)) {
    return scene;
  }
  const encodedStrokes = buildStrokeGeometryExport(scene);
  const strokes = encodedStrokes ? decodeStrokeGeometry(encodedStrokes) : {};
  const quantizeTexture = (name: string, values: Float32Array, count: number): Float32Array => {
    const packed = packTextureForZip(name, values.subarray(0, count * 4), "interleaved");
    return readTexturePayloadAsFloat32(
      packed.data.buffer.slice(packed.data.byteOffset, packed.data.byteOffset + packed.data.byteLength) as ArrayBuffer,
      { ...packed, logicalItemCount: count },
      name
    );
  };
  const quantizePositions = (values: Float32Array, count: number, channels: number): Float32Array => {
    const result = values.slice(0, count * 4);
    for (let channel = 0; channel < channels; channel += 1) {
      const bytes = encodeFixed512DeltaColumn(values, count, 4, channel);
      decodeFixed512DeltaColumnInto(bytes, 0, bytes.length, result, count, 4, channel);
    }
    return result;
  };
  const quantizeGlyphSegments = (): Pick<VectorScene, "textGlyphSegmentsA" | "textGlyphSegmentsB"> => {
    const encoded = encodeTextGlyphSegments(scene.textGlyphSegmentsA, scene.textGlyphSegmentsB, scene.textGlyphSegmentCount);
    const decoded = decodeTextGlyphSegments(encoded.bytes, encoded.meta);
    return { textGlyphSegmentsA: decoded.segmentsA, textGlyphSegmentsB: decoded.segmentsB };
  };
  const prepared = optimizeVectorSceneTextGlyphs(Object.assign(Object.defineProperties({}, Object.getOwnPropertyDescriptors(scene)), {
    ...strokes,
    ...(scene.textGlyphSegmentCount > 0 ? quantizeGlyphSegments() : {}),
    // HEP v8 rounds clip endpoints too; use the same grid after page layout.
    ...(scene.clipPaths ? { clipPaths: scene.clipPaths.map(clip => ({
      ...clip, edges: quantizePositions(clip.edges, clip.edges.length / 4, 4)
    })) } : {}),
    fillSegmentsA: quantizeTexture("fill-primitives-a", scene.fillSegmentsA, scene.fillSegmentCount),
    fillSegmentsB: quantizeTexture("fill-primitives-b", scene.fillSegmentsB, scene.fillSegmentCount),
    textInstanceB: quantizePositions(scene.textInstanceB, scene.textInstanceCount, 2),
    textInstanceC: quantizeTexture("text-instance-c", scene.textInstanceC, scene.textInstanceCount),
    textIndex: scene.textIndex ? {
      ...scene.textIndex,
      pages: scene.textIndex.pages.map((page) => ({
        ...page,
        fallbackQuads: quantizePositions(page.fallbackQuads, page.fallbackQuads.length / 4, 4)
      }))
    } : null
  }) as VectorScene);
  if (encodedStrokes) {
    preparedStrokeGeometry.set(prepared, encodedStrokes);
  }
  preparedHepScenes.add(prepared);
  return prepared;
}

/**
 * Stroke storage (retained in v7): uint16 range-quantized coordinates stored as chained
 * per-column zigzag-varint deltas (start chains to the previous end, end is
 * relative to its own start) plus a type bitset, a raw u16 packed style
 * column, and control-point deltas only for curve segments.
 */
export function buildStrokeGeometryExport(scene: VectorScene): StrokeGeometryExport | null {
  const prepared = preparedStrokeGeometry.get(scene);
  if (prepared) {
    return prepared;
  }
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
  const clippedBounds: number[] = [];

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

    const styleFlags = decodePackedStrokeStyleFlags(metaSource[offset + 3]);
    if ((styleFlags & STROKE_STYLE_FLAG_CLIPPED) !== 0) {
      if (scene.primitiveBounds.length < offset + 4) {
        throw new Error(`Clipped stroke ${i} has no clip bounds.`);
      }
      const minX = scene.primitiveBounds[offset];
      const minY = scene.primitiveBounds[offset + 1];
      const maxX = scene.primitiveBounds[offset + 2];
      const maxY = scene.primitiveBounds[offset + 3];
      if (![minX, minY, maxX, maxY].every(Number.isFinite) ||
          minX > maxX || minY > maxY) {
        throw new Error(`Clipped stroke ${i} has invalid clip bounds.`);
      }
      clippedBounds.push(minX, minY, maxX, maxY);
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
  const clippedSegmentCount = clippedBounds.length / 4;
  const clipBounds = clippedSegmentCount > 0
    ? Float32Array.from(clippedBounds)
    : null;

  return {
    endpointsBytes: concatByteChunks(columns),
    metaBytes: meta.toUint8Array(),
    ...(clipBounds ? {
      clipBoundsBytes: new Uint8Array(
        clipBounds.buffer,
        clipBounds.byteOffset,
        clipBounds.byteLength
      )
    } : {}),
    manifest: {
      endpointsFile: STROKE_ENDPOINTS_PATH,
      metaFile: STROKE_META_PATH,
      ...(clipBounds ? {
        clipBoundsFile: STROKE_CLIP_BOUNDS_PATH,
        clippedSegmentCount
      } : {}),
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

export function listSceneRasterLayers(scene: VectorScene): RasterLayer[] {
  const out: RasterLayer[] = [];
  if (Array.isArray(scene.rasterLayers)) {
    for (const layer of scene.rasterLayers) {
      const width = Math.max(0, Math.trunc(layer?.width ?? 0));
      const height = Math.max(0, Math.trunc(layer?.height ?? 0));
      if (width <= 0 || height <= 0 || (layer.monochrome
        ? layer.monochrome.data.length !== Math.ceil(width / 8) * height || layer.monochrome.colors.length !== 8
        : !(layer.data instanceof Uint8Array) || layer.data.length < width * height * 4)) {
        continue;
      }

      const matrix = layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix);
      out.push(copyRasterLayer(layer, {
        width,
        height,
        matrix,
        paintOrder: Number.isFinite(layer.paintOrder) ? layer.paintOrder : 0,
        pageIndex: Number.isFinite(layer.pageIndex) ? Math.max(0, Math.trunc(layer.pageIndex)) : 0,
        ...(layer.opacity === undefined ? {} : { opacity: layer.opacity })
      }));
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
    matrix: scene.rasterLayerMatrix,
    paintOrder: 0,
    pageIndex: 0
  });
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

export function readNonNegativeInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.trunc(number));
}

export function packTextureForZip(
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

export function readTexturePayloadAsFloat32(
  fileBuffer: ArrayBuffer,
  entry: ParsedDataTextureEntry,
  textureName: string
): Float32Array {
  const componentType = typeof entry.componentType === "string" ? entry.componentType : "float32";
  if (componentType === "uint8-normalized") {
    return decodeNormalizedUint8(new Uint8Array(fileBuffer));
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
