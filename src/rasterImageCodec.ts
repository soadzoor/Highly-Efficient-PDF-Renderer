import { loadNodeCanvas } from "./nodeCanvas";

export type RasterImageEncoding = "webp" | "png";
export type DecodableRasterImageEncoding = RasterImageEncoding | "jpeg";

export interface EncodedRasterImage {
  bytes: Uint8Array;
  encoding: RasterImageEncoding;
}

export interface DecodedRasterImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RasterImageMetadata {
  width: number;
  height: number;
}

/** Shared lossy WebP quality; browser canvas uses 0..1 and Node canvas uses 0..100. */
export const RASTER_WEBP_QUALITY = 0.8;
const NODE_RASTER_WEBP_QUALITY = RASTER_WEBP_QUALITY * 100;

interface NodeRasterCanvasContext {
  putImageData: (imageData: unknown, x: number, y: number) => void;
  drawImage: (image: unknown, x: number, y: number) => void;
  getImageData: (
    x: number,
    y: number,
    width: number,
    height: number
  ) => { data: Uint8Array | Uint8ClampedArray };
}

interface NodeRasterImageCodec {
  createCanvas: (width: number, height: number) => {
    width: number;
    height: number;
    getContext: (kind: "2d") => NodeRasterCanvasContext | null;
    encode: (format: RasterImageEncoding, quality?: number) => Promise<Uint8Array>;
  };
  ImageData: new (data: Uint8ClampedArray, width: number, height: number) => {
    readonly data?: Uint8Array | Uint8ClampedArray;
  };
  loadImage?: (encoded: Uint8Array) => Promise<{ width: number; height: number }>;
}

let cachedNodeRasterImageCodec: NodeRasterImageCodec | null | undefined;
let nodeRasterImageCodecError: unknown;
let warnedAboutNodeRasterFallback = false;

/**
 * Encode straight-alpha RGBA8 as the smallest supported browser image.
 *
 * WebP and PNG are encoded serially to avoid holding two encoder pipelines and
 * their canvas working sets at once. The smallest result is returned only when
 * it also beats raw RGBA storage.
 */
export async function encodeRasterRgbaAsBestImage(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>
): Promise<EncodedRasterImage | null> {
  return pickBestRasterImage(width, height, await encodeRasterRgbaCandidates(width, height, rgba));
}

/** Both browser encodings of one image, each null when unavailable or invalid. */
export interface RasterImageCandidates {
  webp: Uint8Array | null;
  png: Uint8Array | null;
}

export async function encodeRasterRgbaCandidates(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>
): Promise<RasterImageCandidates> {
  const { webp, png } = await encodeRasterRgbaImages(width, height, rgba, ["webp", "png"],
    (encoding, encoded) => encoding !== "png" || !encoded.webp ||
      pngMayBeatWebp(width, height, rgba, encoded.webp.byteLength));
  return {
    webp: webp && rasterImageDimensionsMatch("webp", webp, width, height) ? webp : null,
    png: png && rasterImageDimensionsMatch("png", png, width, height) ? png : null
  };
}

/** Images below this size always try both encoders. */
const PNG_PROBE_MIN_TEXELS = 1 << 16;
/**
 * Megapixel images at least 1024 rows tall sample 32 bands of 16 rows; their
 * prediction stays within -5%/+30% of the real PNG, so a 1.2x margin is safe.
 */
const PNG_PROBE_LARGE_TEXELS = 1 << 20;
const PNG_PROBE_LARGE_MARGIN = 1.2;
/**
 * Those images first sample 8 bands of 8 rows, an eighth of the large probe.
 * Across photographs, scans and graphics that prediction stayed within
 * -31%/+71% of the real PNG, so only a PNG predicted at 4x the WebP skips the
 * large probe. Photographs, whose PNG is typically 5-30x larger, stop there;
 * every image whose PNG won still reached the large probe.
 */
const PNG_PROBE_COARSE_BANDS = 8;
const PNG_PROBE_COARSE_ROWS = 8;
const PNG_PROBE_COARSE_MARGIN = 4;
/**
 * Smaller images sample about an eighth of their rows in 4-32 bands. Blank
 * margins and short bands make that prediction several times less accurate,
 * so only a far larger predicted PNG skips the whole-image encode.
 */
const PNG_PROBE_SMALL_MARGIN = 2.5;
const PNG_PROBE_MAX_BANDS = 32;
const PNG_PROBE_MIN_BANDS = 4;
const PNG_PROBE_ROW_SHARE = 8;

interface PngProbeLayout {
  bands: number;
  rows: number;
  margin: number;
  /** Whether a coarse probe may rule PNG out first. */
  coarse: boolean;
}

/** Evenly spaced row bands to sample, or null when the image is too short. */
function pngProbeLayout(width: number, height: number): PngProbeLayout | null {
  if (width * height < PNG_PROBE_MIN_TEXELS) return null;
  if (width * height >= PNG_PROBE_LARGE_TEXELS && height >= PNG_PROBE_MAX_BANDS * 16 * 2) {
    return { bands: PNG_PROBE_MAX_BANDS, rows: 16, margin: PNG_PROBE_LARGE_MARGIN, coarse: true };
  }
  for (const rows of [16, 8]) {
    const bands = Math.min(PNG_PROBE_MAX_BANDS, Math.floor(height / (rows * PNG_PROBE_ROW_SHARE)));
    if (bands >= PNG_PROBE_MIN_BANDS) return { bands, rows, margin: PNG_PROBE_SMALL_MARGIN, coarse: false };
  }
  return null;
}

/**
 * Lossless PNG of a photograph or scan is slower than WebP and several times
 * larger, so it rarely wins the size comparison. Evenly spaced row bands
 * predict its size from a fraction of the image. A predicted loss beyond the
 * margin skips the whole-image encode; near or winning predictions still
 * compare both encodings exactly.
 */
async function pngMayBeatWebp(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>,
  webpBytes: number
): Promise<boolean> {
  const layout = pngProbeLayout(width, height);
  if (!layout) return true;
  if (layout.coarse) {
    const coarse = await predictPngBytes(width, height, rgba, PNG_PROBE_COARSE_BANDS, PNG_PROBE_COARSE_ROWS);
    if (coarse !== null && coarse >= webpBytes * PNG_PROBE_COARSE_MARGIN) return false;
  }
  const predicted = await predictPngBytes(width, height, rgba, layout.bands, layout.rows);
  return predicted === null || predicted < webpBytes * layout.margin;
}

/** Whole-image PNG bytes predicted from row bands, or null if they could not be encoded. */
async function predictPngBytes(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>,
  bands: number,
  rows: number
): Promise<number | null> {
  const sampleRows = bands * rows, rowBytes = width * 4;
  const sample = new Uint8Array(rowBytes * sampleRows);
  for (let band = 0; band < bands; band += 1) {
    const top = Math.floor((height - rows) * band / (bands - 1));
    sample.set(rgba.subarray(top * rowBytes, (top + rows) * rowBytes), band * rows * rowBytes);
  }
  const { png } = await encodeRasterRgbaImages(width, sampleRows, sample, ["png"]);
  return png ? png.byteLength * (height / sampleRows) : null;
}

/** The smaller candidate, or null when neither beats raw RGBA storage. */
export function pickBestRasterImage(
  width: number,
  height: number,
  { webp, png }: RasterImageCandidates
): EncodedRasterImage | null {
  const best = png && (!webp || png.byteLength < webp.byteLength)
    ? { bytes: png, encoding: "png" as const }
    : webp
      ? { bytes: webp, encoding: "webp" as const }
      : null;
  if (!best || best.bytes.byteLength >= width * height * 4) {
    return null;
  }
  return best;
}

/** Lossless PNG, or null when it would not beat raw RGBA storage. */
export async function encodeRasterRgbaAsPng(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>
): Promise<Uint8Array | null> {
  const { png } = await encodeRasterRgbaImages(width, height, rgba, ["png"]);
  return png && rasterImageDimensionsMatch("png", png, width, height) &&
    png.byteLength < width * height * 4 ? png : null;
}

/** Decode a browser image without changing its straight-alpha pixel convention. */
export async function decodeRasterImageToRgba(
  encoding: DecodableRasterImageEncoding,
  encoded: Uint8Array<ArrayBufferLike>
): Promise<DecodedRasterImage | null> {
  if (!hasRasterImageSignature(encoding, encoded)) {
    return null;
  }

  const source = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  if (typeof document === "undefined") {
    const codec = await getNodeRasterImageCodec();
    if (!codec?.loadImage) {
      // Encoding can fall back to RGBA, but reading an encoded HEP image needs
      // a decoder. Preserve the backend's actionable installation error.
      if (nodeRasterImageCodecError) throw nodeRasterImageCodecError;
      return null;
    }
    try {
      const image = await codec.loadImage(source);
      const width = Math.max(0, Math.trunc(image.width));
      const height = Math.max(0, Math.trunc(image.height));
      if (width <= 0 || height <= 0) {
        return null;
      }
      const canvas = codec.createCanvas(width, height);
      try {
        const context = canvas.getContext("2d");
        if (!context) {
          return null;
        }
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, width, height);
        return { width, height, data: new Uint8Array(imageData.data) };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    } catch {
      return null;
    }
  }

  if (typeof createImageBitmap !== "function") {
    return null;
  }
  const encodedCopy = source.slice();
  const blob = new Blob([encodedCopy], { type: rasterImageMimeType(encoding) });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
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

export function hasRasterImageSignature(
  encoding: DecodableRasterImageEncoding,
  bytes: Uint8Array<ArrayBufferLike>
): boolean {
  if (encoding === "jpeg") {
    return bytes.byteLength >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (encoding === "png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.byteLength >= signature.length &&
      signature.every((value, index) => bytes[index] === value);
  }
  return bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

/** Read dimensions from a bounded PNG/WebP/JPEG header without decoding pixels. */
export function inspectRasterImage(
  encoding: DecodableRasterImageEncoding,
  bytes: Uint8Array<ArrayBufferLike>
): RasterImageMetadata | null {
  if (!hasRasterImageSignature(encoding, bytes)) {
    return null;
  }

  if (encoding === "jpeg") {
    return inspectJpegDimensions(bytes);
  }
  if (encoding === "png") {
    if (
      bytes.byteLength < 24 ||
      readUint32BigEndian(bytes, 8) !== 13 ||
      bytes[12] !== 0x49 || bytes[13] !== 0x48 ||
      bytes[14] !== 0x44 || bytes[15] !== 0x52
    ) {
      return null;
    }
    return normalizeImageDimensions(
      readUint32BigEndian(bytes, 16),
      readUint32BigEndian(bytes, 20)
    );
  }

  if (bytes.byteLength < 20) {
    return null;
  }
  const riffByteLength = readUint32LittleEndian(bytes, 4) + 8;
  if (!Number.isSafeInteger(riffByteLength) || riffByteLength > bytes.byteLength) {
    return null;
  }

  const chunkByteLength = readUint32LittleEndian(bytes, 16);
  if (!Number.isSafeInteger(chunkByteLength) || 20 + chunkByteLength > bytes.byteLength) {
    return null;
  }
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8 ") {
    if (
      chunkByteLength < 10 ||
      bytes.byteLength < 30 ||
      bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a
    ) {
      return null;
    }
    return normalizeImageDimensions(
      readUint16LittleEndian(bytes, 26) & 0x3fff,
      readUint16LittleEndian(bytes, 28) & 0x3fff
    );
  }
  if (chunk === "VP8L") {
    if (chunkByteLength < 5 || bytes.byteLength < 25 || bytes[20] !== 0x2f) {
      return null;
    }
    const bits = readUint32LittleEndian(bytes, 21);
    if ((bits >>> 29) !== 0) {
      return null;
    }
    return normalizeImageDimensions(
      (bits & 0x3fff) + 1,
      ((bits >>> 14) & 0x3fff) + 1
    );
  }
  if (chunk === "VP8X") {
    if (chunkByteLength < 10 || bytes.byteLength < 30) {
      return null;
    }
    return normalizeImageDimensions(
      readUint24LittleEndian(bytes, 24) + 1,
      readUint24LittleEndian(bytes, 27) + 1
    );
  }
  return null;
}

function inspectJpegDimensions(
  bytes: Uint8Array<ArrayBufferLike>
): RasterImageMetadata | null {
  if (!hasRasterImageSignature("jpeg", bytes)) {
    return null;
  }

  // A valid frame header appears before scan entropy. Cap marker traversal so a
  // hostile sequence of empty standalone markers cannot consume unbounded CPU.
  const maxMarkerCount = 4_096;
  let offset = 2;
  for (let markerCount = 0; markerCount < maxMarkerCount && offset < bytes.byteLength;) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.byteLength) {
      return null;
    }

    const marker = bytes[offset];
    offset += 1;
    markerCount += 1;
    if (marker === 0x00) {
      return null;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.byteLength) {
      return null;
    }
    const segmentByteLength = readUint16BigEndian(bytes, offset);
    if (segmentByteLength < 2 || offset + segmentByteLength > bytes.byteLength) {
      return null;
    }
    if (isJpegStartOfFrameMarker(marker)) {
      if (segmentByteLength < 8) {
        return null;
      }
      return normalizeImageDimensions(
        readUint16BigEndian(bytes, offset + 5),
        readUint16BigEndian(bytes, offset + 3)
      );
    }
    offset += segmentByteLength;
  }
  return null;
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf &&
    marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export function rasterImageEncodingFromPath(path: string): DecodableRasterImageEncoding | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".webp")) {
    return "webp";
  }
  if (lower.endsWith(".png")) {
    return "png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "jpeg";
  }
  return null;
}

function rasterImageMimeType(
  encoding: DecodableRasterImageEncoding
): "image/webp" | "image/png" | "image/jpeg" {
  if (encoding === "webp") {
    return "image/webp";
  }
  return encoding === "png" ? "image/png" : "image/jpeg";
}

/** Optional per-encoder gate that sees the encodings produced so far. */
type RasterEncodingGate = (
  encoding: RasterImageEncoding,
  encoded: Readonly<RasterImageCandidates>
) => boolean | Promise<boolean>;

/** Upload pixels once; the encoders consume the same canvas serially. */
async function encodeRasterRgbaImages(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>,
  encodings: readonly RasterImageEncoding[],
  shouldEncode?: RasterEncodingGate
): Promise<RasterImageCandidates> {
  const result: RasterImageCandidates = { webp: null, png: null };
  const expectedBytes = width * height * 4;
  if (
    !Number.isSafeInteger(expectedBytes) ||
    width <= 0 ||
    height <= 0 ||
    rgba.byteLength < expectedBytes
  ) {
    return result;
  }

  if (typeof document === "undefined") {
    return encodeRasterRgbaAsNodeImages(width, height, rgba, encodings, shouldEncode);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return result;
    }

    context.putImageData(new ImageData(clampedRasterPixels(rgba, expectedBytes), width, height), 0, 0);
    for (const encoding of encodings) {
      if (shouldEncode && !(await shouldEncode(encoding, result))) continue;
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          resolve,
          rasterImageMimeType(encoding),
          encoding === "webp" ? RASTER_WEBP_QUALITY : undefined
        );
      });
      if (blob?.type === rasterImageMimeType(encoding)) {
        result[encoding] = new Uint8Array(await blob.arrayBuffer());
      }
    }
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** putImageData copies synchronously; an ordinary buffer needs no staging copy. */
function clampedRasterPixels(rgba: Uint8Array<ArrayBufferLike>, length: number): Uint8ClampedArray<ArrayBuffer> {
  return rgba.buffer instanceof ArrayBuffer
    ? new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, length)
    : new Uint8ClampedArray(rgba.subarray(0, length));
}

/** A reusable upload chunk, not a limit on image dimensions or decoded pixels. */
const NODE_RASTER_UPLOAD_BYTES = 1024 * 1024;

/**
 * Node ImageData owns a copy of its input. Reuse one small writable band rather
 * than a second full image plane while uploading into the encoding canvas.
 * Browser ImageData borrows the caller's view and keeps its single upload.
 */
function uploadNodeRasterPixels(
  codec: NodeRasterImageCodec,
  context: NodeRasterCanvasContext,
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>
): void {
  const rowBytes = width * 4;
  const rows = Math.max(1, Math.min(height, Math.floor(NODE_RASTER_UPLOAD_BYTES / rowBytes)));
  if (rows < height) {
    const band = new codec.ImageData(clampedRasterPixels(rgba, rowBytes * rows), width, rows);
    const pixels = band.data;
    // API shims may omit data, return a fresh copy, or borrow the input like a
    // browser. Only reuse a stable owned plane, so no caller pixels are changed.
    if ((pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) &&
        pixels.length === rowBytes * rows && band.data === pixels && pixels.buffer !== rgba.buffer) {
      for (let top = 0; top < height; top += rows) {
        pixels.set(rgba.subarray(top * rowBytes, Math.min(height, top + rows) * rowBytes));
        // The canvas clips any unused rows in the final partial band.
        context.putImageData(band, 0, top);
      }
      return;
    }
  }
  context.putImageData(new codec.ImageData(clampedRasterPixels(rgba, rowBytes * height), width, height), 0, 0);
}

function rasterImageDimensionsMatch(
  encoding: RasterImageEncoding,
  bytes: Uint8Array<ArrayBufferLike>,
  width: number,
  height: number
): boolean {
  const metadata = inspectRasterImage(encoding, bytes);
  return metadata?.width === width && metadata.height === height;
}

function normalizeImageDimensions(width: number, height: number): RasterImageMetadata | null {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function readUint16LittleEndian(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint16BigEndian(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint24LittleEndian(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LittleEndian(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUint32BigEndian(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

async function encodeRasterRgbaAsNodeImages(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>,
  encodings: readonly RasterImageEncoding[],
  shouldEncode?: RasterEncodingGate
): Promise<RasterImageCandidates> {
  const result: RasterImageCandidates = { webp: null, png: null };
  const codec = await getNodeRasterImageCodec();
  if (!codec) {
    if (nodeRasterImageCodecError && !warnedAboutNodeRasterFallback) {
      warnedAboutNodeRasterFallback = true;
      console.warn(
        '[HEPR] WARNING: The optional @napi-rs/canvas backend is unavailable. ' +
        "Storing raster images as raw RGBA instead of WebP/PNG can make generated HEP files much larger. " +
        'Install it with "npm install @napi-rs/canvas" and regenerate the HEP files.'
      );
    }
    return result;
  }

  const canvas = codec.createCanvas(width, height);
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      return result;
    }

    uploadNodeRasterPixels(codec, context, width, height, rgba);
    for (const encoding of encodings) {
      if (shouldEncode && !(await shouldEncode(encoding, result))) continue;
      try {
        const encoded = new Uint8Array(
          encoding === "webp"
            ? await canvas.encode(encoding, NODE_RASTER_WEBP_QUALITY)
            : await canvas.encode(encoding)
        );
        if (hasRasterImageSignature(encoding, encoded)) result[encoding] = encoded;
      } catch {
        // A backend can lack one encoder while supporting the other.
      }
    }
    return result;
  } catch {
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function getNodeRasterImageCodec(): Promise<NodeRasterImageCodec | null> {
  if (cachedNodeRasterImageCodec !== undefined) {
    return cachedNodeRasterImageCodec;
  }

  try {
    const mod = loadNodeCanvas() as { createCanvas?: unknown; ImageData?: unknown; loadImage?: unknown } | null;
    if (typeof mod?.createCanvas !== "function" || typeof mod?.ImageData !== "function") {
      cachedNodeRasterImageCodec = null;
      return null;
    }

    cachedNodeRasterImageCodec = {
      createCanvas: mod.createCanvas as NodeRasterImageCodec["createCanvas"],
      ImageData: mod.ImageData as NodeRasterImageCodec["ImageData"],
      loadImage: typeof mod.loadImage === "function"
        ? mod.loadImage as NodeRasterImageCodec["loadImage"]
        : undefined
    };
    return cachedNodeRasterImageCodec;
  } catch (cause) {
    nodeRasterImageCodecError = cause;
    cachedNodeRasterImageCodec = null;
    return null;
  }
}
