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
  ImageData: new (data: Uint8ClampedArray, width: number, height: number) => unknown;
  loadImage?: (encoded: Uint8Array) => Promise<{ width: number; height: number }>;
}

let cachedNodeRasterImageCodec: NodeRasterImageCodec | null | undefined;

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
  const webp = await encodeRasterRgbaAsImage(width, height, rgba, "webp");
  const validWebp = webp && rasterImageDimensionsMatch("webp", webp, width, height)
    ? webp
    : null;
  const png = await encodeRasterRgbaAsImage(width, height, rgba, "png");
  const validPng = png && rasterImageDimensionsMatch("png", png, width, height)
    ? png
    : null;
  const best = validPng && (!validWebp || validPng.byteLength < validWebp.byteLength)
    ? { bytes: validPng, encoding: "png" as const }
    : validWebp
      ? { bytes: validWebp, encoding: "webp" as const }
      : null;
  if (!best || best.bytes.byteLength >= width * height * 4) {
    return null;
  }
  return best;
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

async function encodeRasterRgbaAsImage(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>,
  encoding: RasterImageEncoding
): Promise<Uint8Array | null> {
  const expectedBytes = width * height * 4;
  if (
    !Number.isSafeInteger(expectedBytes) ||
    width <= 0 ||
    height <= 0 ||
    rgba.byteLength < expectedBytes
  ) {
    return null;
  }

  if (typeof document === "undefined") {
    return encodeRasterRgbaAsNodeImage(width, height, rgba, encoding);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return null;
    }

    const clamped = new Uint8ClampedArray(expectedBytes);
    clamped.set(rgba.subarray(0, expectedBytes));
    context.putImageData(new ImageData(clamped, width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        resolve,
        rasterImageMimeType(encoding),
        encoding === "webp" ? RASTER_WEBP_QUALITY : undefined
      );
    });
    if (!blob || blob.type !== rasterImageMimeType(encoding)) {
      return null;
    }
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
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

async function encodeRasterRgbaAsNodeImage(
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBufferLike>,
  encoding: RasterImageEncoding
): Promise<Uint8Array | null> {
  const codec = await getNodeRasterImageCodec();
  if (!codec) {
    return null;
  }

  const expectedBytes = width * height * 4;
  const canvas = codec.createCanvas(width, height);
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    const clamped = new Uint8ClampedArray(expectedBytes);
    clamped.set(rgba.subarray(0, expectedBytes));
    context.putImageData(new codec.ImageData(clamped, width, height), 0, 0);
    const encoded = new Uint8Array(
      encoding === "webp"
        ? await canvas.encode(encoding, NODE_RASTER_WEBP_QUALITY)
        : await canvas.encode(encoding)
    );
    return hasRasterImageSignature(encoding, encoded) ? encoded : null;
  } catch {
    return null;
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
    const moduleName = "@napi-rs/canvas";
    const mod = await import(
      /* @vite-ignore */
      moduleName
    ) as { createCanvas?: unknown; ImageData?: unknown; loadImage?: unknown };
    if (typeof mod.createCanvas !== "function" || typeof mod.ImageData !== "function") {
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
  } catch {
    cachedNodeRasterImageCodec = null;
    return null;
  }
}
