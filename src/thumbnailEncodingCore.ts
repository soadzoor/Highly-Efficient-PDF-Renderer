import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { ThumbnailPixels } from "./thumbnailTypes";

export type ThumbnailEncodingFormat = "webp" | "png";
type DiagnosticHandler = (diagnostic: PdfDiagnostic) => void;

/** Package-relative, lazy asset: no remote codec service or runtime CDN. */
export const THUMBNAIL_WEBP_ASSET = new URL("./assets/codecs/webp/libwebp-3757b8a-simd.wasm?no-inline", import.meta.url);

/** Worker entry and offline benchmarks share the same pixel encoder. Native
 * synchronous WASM calls cannot be interrupted inline; the owner worker can. */
export async function encodeThumbnailPixelsDirect(pixels: ThumbnailPixels, format: ThumbnailEncodingFormat,
  signal?: AbortSignal, onDiagnostic?: DiagnosticHandler): Promise<Blob> {
  validateThumbnailPixels(pixels);
  throwIfThumbnailEncodingCancelled(signal);
  if (format === "webp") {
    try {
      // The WebP bitstream stores dimensions in 14 bits; this is a format
      // constraint, never a thumbnail-preparation resource allowance.
      if (pixels.width > 16383 || pixels.height > 16383) throw new RangeError("WebP dimensions exceed the format's 16383-pixel maximum.");
      const codec = await waitFor(loadWebpCodec(), signal);
      throwIfThumbnailEncodingCancelled(signal);
      const bytes = codec.encode(pixels);
      throwIfThumbnailEncodingCancelled(signal);
      return new Blob([bytes], { type: "image/webp" });
    } catch (error) {
      throwIfThumbnailEncodingCancelled(signal);
      onDiagnostic?.({ code: "thumbnail.webp-png-fallback", severity: "warning",
        message: "Lossless WebP encoding is unavailable; the thumbnail was encoded as PNG.",
        details: { reason: error instanceof Error ? error.message : String(error) } });
    }
  } else if (format !== "png") throw new TypeError("Thumbnail format must be webp or png.");
  const bytes = await encodePng(pixels, signal);
  throwIfThumbnailEncodingCancelled(signal);
  return new Blob([bytes], { type: "image/png" });
}

interface WebpExports extends WebAssembly.Exports {
  f: WebAssembly.Memory;
  g(): void;
  h(rgba: number, width: number, height: number, quality: number, lossless: number, outputSize: number): number;
  i(data: number, size: number, width: number, height: number): number;
  j(pointer: number): void;
  k(length: number): number;
  l(pointer: number): void;
}
export interface ThumbnailWebpCodec { encode(pixels: ThumbnailPixels): Uint8Array<ArrayBuffer> }

/** Small adapter for the hash-pinned Emscripten ABI. No Node-oriented glue is
 * shipped or evaluated; compilation remains async on browser main threads. */
export async function createThumbnailWebpCodec(bytes: Uint8Array<ArrayBuffer>): Promise<ThumbnailWebpCodec> {
  let exports: WebpExports;
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, { a: {
    a: () => { throw new Error("Unexpected WebP timer request."); },
    b: (requested: number) => {
      try {
        const memory = exports.f;
        const pages = Math.ceil(((requested >>> 0) - memory.buffer.byteLength) / 65536);
        if (pages > 0) memory.grow(pages);
        return 1;
      } catch { return 0; }
    },
    c: (status: number) => { throw new Error(`WebP runtime exited (${status}).`); },
    d: () => {},
    e: () => { throw new Error("WebP runtime aborted."); }
  } });
  exports = instance.exports as WebpExports;
  exports.g();
  return {
    encode(pixels) {
      validateThumbnailPixels(pixels);
      let input = 0, size = 0, output = 0;
      try {
        input = exports.k(pixels.rgba.byteLength);
        size = exports.k(4);
        if (!input || !size) throw new Error("Unable to allocate WebP encoder input.");
        new Uint8Array(exports.f.buffer).set(pixels.rgba, input);
        // quality 0 controls lossless effort, not visual quality. The pinned
        // wrapper also sets method=0, near_lossless=100 and exact=1.
        output = exports.h(input, pixels.width, pixels.height, 0, 1, size);
        const length = new DataView(exports.f.buffer).getUint32(size, true);
        if (!output || !length) throw new Error("Lossless WebP encoding failed.");
        return new Uint8Array(exports.f.buffer, output, length).slice();
      } finally {
        if (output) exports.j(output);
        if (size) exports.l(size);
        if (input) exports.l(input);
      }
    }
  };
}

let codecPromise: Promise<ThumbnailWebpCodec> | undefined;
function loadWebpCodec(): Promise<ThumbnailWebpCodec> {
  if (codecPromise) return codecPromise;
  const pending = (async () => {
    let bytes: Uint8Array<ArrayBuffer>;
    if (THUMBNAIL_WEBP_ASSET.protocol === "file:" && (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) {
      const moduleName = "node:fs/promises";
      const fs = await import(/* @vite-ignore */ moduleName) as { readFile(url: URL): Promise<Uint8Array> };
      bytes = Uint8Array.from(await fs.readFile(THUMBNAIL_WEBP_ASSET));
    } else {
      const response = await fetch(THUMBNAIL_WEBP_ASSET);
      if (!response.ok) throw new Error(`Unable to fetch the thumbnail WebP codec (${response.status}).`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.byteLength !== 565391) throw new Error("Unexpected thumbnail WebP codec length.");
    return createThumbnailWebpCodec(bytes);
  })();
  codecPromise = pending;
  void pending.catch(() => { if (codecPromise === pending) codecPromise = undefined; });
  return pending;
}

export function validateThumbnailPixels({ width, height, rgba }: ThumbnailPixels): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    !Number.isSafeInteger(width * height * 4) || rgba.byteLength !== width * height * 4) {
    throw new RangeError("Thumbnail pixels require positive integer dimensions and exactly width * height * 4 RGBA bytes.");
  }
}
export function thumbnailEncodingAbortReason(signal?: AbortSignal): unknown { return signal?.reason ?? new DOMException("Thumbnail encoding was aborted.", "AbortError"); }
export function throwIfThumbnailEncodingCancelled(signal?: AbortSignal): void { if (signal?.aborted) throw thumbnailEncodingAbortReason(signal); }
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(thumbnailEncodingAbortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

// PNG writes straight RGBA directly, avoiding a canvas upload/readback and its
// premultiplication losses. CompressionStream is native and worker-compatible.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngChunk(type: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (data.length > 0xffff_ffff) throw new RangeError("PNG chunk exceeds its format size limit.");
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) result[index + 4] = type.charCodeAt(index);
  result.set(data, 8);
  let crc = 0xffff_ffff;
  for (let index = 4; index < result.length - 4; index++) crc = crcTable[(crc ^ result[index]) & 255] ^ (crc >>> 8);
  view.setUint32(result.length - 4, (crc ^ 0xffff_ffff) >>> 0);
  return result;
}
async function encodePng(pixels: ThumbnailPixels, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (pixels.width > 0x7fff_ffff || pixels.height > 0x7fff_ffff) throw new RangeError("PNG dimensions exceed the format's signed 31-bit maximum.");
  const stride = pixels.width * 4, scanlines = new Uint8Array((stride + 1) * pixels.height);
  for (let row = 0; row < pixels.height; row++) {
    throwIfThumbnailEncodingCancelled(signal);
    scanlines.set(pixels.rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  let compressed: Uint8Array<ArrayBuffer>;
  if (typeof CompressionStream !== "undefined") {
    compressed = new Uint8Array(await waitFor(new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate"), { signal })).arrayBuffer(), signal));
  } else compressed = storedDeflate(scanlines);
  throwIfThumbnailEncodingCancelled(signal);
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, pixels.width); view.setUint32(4, pixels.height); header[8] = 8; header[9] = 6;
  const chunks = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk("IHDR", header), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function storedDeflate(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const count = Math.max(1, Math.ceil(bytes.length / 65535)), output = new Uint8Array(bytes.length + count * 5 + 6);
  output.set([0x78, 1]);
  let offset = 2, a = 1, b = 0;
  for (let block = 0; block < count; block++) {
    const start = block * 65535, size = Math.min(65535, bytes.length - start);
    output.set([block === count - 1 ? 1 : 0, size & 255, size >>> 8, (~size) & 255, ((~size) >>> 8) & 255], offset);
    offset += 5; output.set(bytes.subarray(start, start + size), offset); offset += size;
  }
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  new DataView(output.buffer).setUint32(offset, ((b << 16) | a) >>> 0);
  return output;
}
