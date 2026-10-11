import type { NativeImageCodecRequest, NativeImageCodecResult } from "./nativeImage";
import { PdfError, throwIfAborted } from "./nativeTypes";
import { registerNativeFontPostScriptJpxCodec } from "./nativeFontPostScriptCodecs";
import OpenJPEG from "./codecs/openJpegKernel";

export const BUNDLED_JPX_CODEC_ASSET = Object.freeze({
  url: new URL("../assets/codecs/jpeg2000/openjpeg-6.4.299.wasm?no-inline", import.meta.url),
  byteLength: 251_130,
  sha256: "c51682fe7bd76da51cb60dbfab57c7abc3d157f7e3434953f55245748fe9ed8b",
  source: "https://github.com/mozilla/pdf.js/tree/v6.4.299/external/openjpeg"
});

interface JpxKernel {
  _malloc(length: number): number;
  _free(pointer: number): void;
  writeArrayToMemory(bytes: Uint8Array, pointer: number): void;
  _jp2_decode(pointer: number, length: number, components: number, indexed: boolean, opacity: boolean, reduction: number): number;
  imageData: Uint8ClampedArray | null;
  errorMessages?: string;
}
let assetPromise: Promise<Uint8Array<ArrayBuffer>> | undefined;
const modules = new Map<number, Promise<WebAssembly.Module>>();
const preparedModules = new Map<number, WebAssembly.Module>();
let preparedAsset: Uint8Array<ArrayBuffer> | undefined;
const WASM_PAGE_BYTES = 64 * 1024;

/** Prepare only the shared asset/module; decoding heaps remain operation-local. */
export async function prepareBundledJpxCodec(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  try { await loadModule(65536); }
  catch (cause) {
    throwIfAborted(signal);
    if (cause instanceof PdfError) throw cause;
    throw codecError("Unable to prepare the bundled JPEG 2000 codec.", "codec-load-failed", cause);
  }
  throwIfAborted(signal);
  registerNativeFontPostScriptJpxCodec({ readJpxProperties, decodeBundledJpxRawSync });
}

/** Focused OpenJPEG kernel, loaded only for JPEG 2000 images. */
export async function decodeBundledJpx(request: Readonly<NativeImageCodecRequest>, maxBytes: number,
  signal?: AbortSignal): Promise<NativeImageCodecResult> {
  const { pages, outputBytes } = validateRequest(request, maxBytes, signal);
  const module = await loadModule(pages);
  return decodeWithModule(module, request, outputBytes, signal);
}

export function decodeBundledJpxSync(request: Readonly<NativeImageCodecRequest>, maxBytes: number,
  signal?: AbortSignal): NativeImageCodecResult {
  const { pages, outputBytes } = validateRequest(request, maxBytes, signal);
  if (!preparedAsset) throw codecError("The JPEG 2000 codec must be prepared before synchronous font decoding.", "codec-not-prepared");
  let module = preparedModules.get(pages);
  if (!module) {
    module = new WebAssembly.Module(capWasmMemory(preparedAsset, pages));
    cachePreparedModule(pages, module);
  }
  return decodeWithModule(module, request, outputBytes, signal);
}

/** The PostScript filter exposes packed source samples, including signed and
 * high precision data. Indexed mode bypasses the wrapper's eight-bit scaling
 * and JP2 channel remapping; the caller handles the channel definitions. The
 * plane views are valid only during consume, before OpenJPEG frees its image. */
export function decodeBundledJpxRawSync(encoded: Uint8Array,
  consume: (planes: readonly Int32Array[]) => Uint8Array, signal?: AbortSignal): Uint8Array {
  throwIfAborted(signal);
  const metadata = readJpxProperties(encoded);
  if (metadata.components > 4) throw codecError("The bundled raw JPX bridge supports at most four codestream components.", "unsupported-jpx-font-layout");
  if (!preparedAsset) throw codecError("The JPEG 2000 codec must be prepared before synchronous font decoding.", "codec-not-prepared");
  let module = preparedModules.get(65536);
  if (!module) { module = new WebAssembly.Module(capWasmMemory(preparedAsset, 65536)); cachePreparedModule(65536, module); }
  let output: Uint8Array | undefined;
  try {
    const kernel = OpenJPEG({ compiledModule: module, warn: (_message: string) => {},
      copyRawPixels(heap: Int32Array, pointers: readonly number[], pixelCount: number) {
        throwIfAborted(signal);
        if (pixelCount !== metadata.samples[0].width * metadata.samples[0].height || pointers.length !== metadata.components) {
          throw codecError("JPX decoded planes disagree with the codestream header.", "invalid-jpx-data");
        }
        const planes = pointers.map((pointer, component) => {
          const start = (pointer >>> 0) / 4;
          const count = metadata.samples[component].width * metadata.samples[component].height;
          if (!Number.isInteger(start) || !Number.isSafeInteger(count) || start + count > heap.length) throw codecError("Invalid JPX component plane.", "invalid-jpx-data");
          return heap.subarray(start, start + count);
        });
        output = consume(planes);
      }
    }) as unknown as JpxKernel;
    const pointer = kernel._malloc(encoded.length) >>> 0;
    if (!pointer) throw new PdfError("resource-limit", "JPEG 2000 input allocation failed.");
    try {
      kernel.writeArrayToMemory(encoded, pointer);
      const failed = kernel._jp2_decode(pointer, encoded.length, metadata.components === 2 ? 0 : metadata.components,
        true, metadata.components === 2, 0);
      throwIfAborted(signal);
      if (failed || !output) throw codecError(kernel.errorMessages ?? "Unable to decode raw JPEG 2000 samples.", "invalid-jpx-data");
      return output;
    } finally { kernel._free(pointer); }
  } catch (cause) {
    throwIfAborted(signal);
    if (cause instanceof PdfError) throw cause;
    throw codecError("Unable to decode raw JPEG 2000 samples.", "invalid-jpx-data", cause);
  }
}

function validateRequest(request: Readonly<NativeImageCodecRequest>, maxBytes: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  const metadata = readJpxProperties(request.encoded);
  if (metadata.width !== request.width || metadata.height !== request.height) {
    throw codecError("JPEG 2000 dimensions disagree with the PDF image.", "dimension-mismatch");
  }
  if (!Number.isSafeInteger(request.components) || request.components < 1 || request.components > 4 ||
      metadata.components !== request.components || request.imageMask ||
      (request.components === 2 && request.decodeParameters.SMaskInData !== 1) ||
      (request.indexedColorSpace && !metadata.singleUnsignedByte) ||
      (request.bitsPerComponent !== 0 && request.bitsPerComponent !== 8)) {
    throw codecError("Unsupported JPEG 2000 component count or sample precision.", "unsupported-jpx-layout");
  }
  // OpenJPEG keeps 32-bit component/coefficient planes and emits an 8-bit copy.
  // Include encoded data and padding before creating the kernel, and additionally
  // cap its defined memory for this operation (including malicious codestreams).
  const outputBytes = request.width * request.height * request.components;
  const estimate = outputBytes * 16 + request.encoded.length + 17 * 1024 * 1024;
  if (!Number.isSafeInteger(estimate) || estimate > maxBytes) {
    throw new PdfError("resource-limit", "JPEG 2000 decoding exceeds the configured stream limit.", {
      details: { codec: "jpeg2000", reason: "jpx-working-set", bytes: estimate, limit: maxBytes }
    });
  }
  // Reserve JS output (including the Gray+alpha bridge) outside the WASM heap.
  const jsBytes = request.encoded.length + outputBytes * (request.components === 2 ? 3 : 1) + 1024 * 1024;
  return { outputBytes, pages: Math.min(65536, Math.floor((maxBytes - jsBytes) / WASM_PAGE_BYTES)) };
}

function decodeWithModule(module: WebAssembly.Module, request: Readonly<NativeImageCodecRequest>,
  outputBytes: number, signal?: AbortSignal): NativeImageCodecResult {
  throwIfAborted(signal);
  try {
    const kernel = OpenJPEG({ compiledModule: module, warn: (_message: string) => {} }) as unknown as JpxKernel;
    throwIfAborted(signal);
    const pointer = kernel._malloc(request.encoded.length) >>> 0;
    if (!pointer) throw new PdfError("resource-limit", "JPEG 2000 input allocation failed.");
    try {
      kernel.writeArrayToMemory(request.encoded, pointer);
      // The upstream raw-copy bridge has 1/3/4-component outputs. Its Gray+alpha
      // path emits RGBA, which we repack into the PDF's two-component layout.
      const grayAlpha = request.components === 2;
      const failed = kernel._jp2_decode(pointer, request.encoded.length, grayAlpha ? 0 : request.components,
        request.indexedColorSpace === true, request.decodeParameters.SMaskInData === 1, 0);
      throwIfAborted(signal);
      if (failed || !kernel.imageData || kernel.imageData.length !== (grayAlpha ? outputBytes * 2 : outputBytes)) {
        throw codecError(kernel.errorMessages ?? "Unable to decode the JPEG 2000 image.", "invalid-jpx-data");
      }
      let samples = new Uint8Array(kernel.imageData.buffer, kernel.imageData.byteOffset, kernel.imageData.byteLength);
      if (grayAlpha) {
        const packed = new Uint8Array(outputBytes);
        for (let pixel = 0; pixel < outputBytes / 2; pixel++) {
          packed[pixel * 2] = samples[pixel * 4]; packed[pixel * 2 + 1] = samples[pixel * 4 + 3];
        }
        samples = packed;
      }
      kernel.imageData = null;
      return { samples, width: request.width, height: request.height, components: request.components, bitsPerComponent: 8 };
    } finally { kernel._free(pointer); }
  } catch (cause) {
    throwIfAborted(signal);
    if (cause instanceof PdfError) throw cause;
    throw codecError("Unable to decode the JPEG 2000 image.", "invalid-jpx-data", cause);
  }
}

/** Read the mandatory SIZ marker before allowing any decoder allocations. */
export function readJpxProperties(bytes: Uint8Array): { width: number; height: number; components: number; singleUnsignedByte: boolean; unsignedBytes: boolean;
  samples: readonly { precision: number; signed: boolean; dx: number; dy: number; width: number; height: number }[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = 0, end = bytes.length;
  if (bytes[0] !== 0xff || bytes[1] !== 0x4f) {
    let found = false;
    while (start + 8 <= bytes.length) {
      let length = view.getUint32(start), header = 8;
      const type = view.getUint32(start + 4);
      if (length === 1) {
        if (start + 16 > bytes.length) break;
        const large = view.getBigUint64(start + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
        length = Number(large); header = 16;
      } else if (length === 0) length = bytes.length - start;
      if (length < header || start + length > bytes.length) break;
      if (type === 0x6a703263) { end = start + length; start += header; found = true; break; }
      start += length;
    }
    if (!found) throw codecError("JPEG 2000 data has no codestream.", "invalid-jpx-header");
  }
  if (start + 42 > end || view.getUint16(start) !== 0xff4f || view.getUint16(start + 2) !== 0xff51) {
    throw codecError("JPEG 2000 data has no valid SIZ marker.", "invalid-jpx-header");
  }
  const components = view.getUint16(start + 40);
  const length = view.getUint16(start + 4);
  const width = view.getUint32(start + 8) - view.getUint32(start + 16);
  const height = view.getUint32(start + 12) - view.getUint32(start + 20);
  if (width <= 0 || height <= 0 || components < 1 ||
      length !== 38 + components * 3 || start + 4 + length > end) {
    throw codecError("Invalid JPEG 2000 dimensions or SIZ length.", "invalid-jpx-header");
  }
  const samples = Array.from({ length: components }, (_, i) => {
    const dx = bytes[start + 43 + i * 3], dy = bytes[start + 44 + i * 3];
    return { precision: (bytes[start + 42 + i * 3] & 127) + 1, signed: (bytes[start + 42 + i * 3] & 128) !== 0, dx, dy,
      width: Math.ceil(view.getUint32(start + 8) / dx) - Math.ceil(view.getUint32(start + 16) / dx),
      height: Math.ceil(view.getUint32(start + 12) / dy) - Math.ceil(view.getUint32(start + 20) / dy) };
  });
  if (samples.some(sample => !sample.dx || !sample.dy || sample.width <= 0 || sample.height <= 0)) throw codecError("Invalid JPEG 2000 sampling grid.", "invalid-jpx-header");
  return { width, height, components, samples, singleUnsignedByte: components === 1 && bytes[start + 42] === 7,
    unsignedBytes: samples.every(sample => sample.precision === 8 && !sample.signed) };
}

function loadModule(maximumPages: number): Promise<WebAssembly.Module> {
  const ready = preparedModules.get(maximumPages);
  if (ready) return Promise.resolve(ready);
  const cached = modules.get(maximumPages);
  if (cached) return cached;
  const pending = loadAsset().then(bytes => WebAssembly.compile(capWasmMemory(bytes, maximumPages))).then(module => {
    cachePreparedModule(maximumPages, module); return module;
  });
  if (modules.size >= 4) modules.delete(modules.keys().next().value!);
  modules.set(maximumPages, pending);
  void pending.catch(() => { if (modules.get(maximumPages) === pending) modules.delete(maximumPages); });
  return pending;
}

function cachePreparedModule(pages: number, module: WebAssembly.Module): void {
  if (preparedModules.size >= 4) preparedModules.delete(preparedModules.keys().next().value!);
  preparedModules.set(pages, module);
}

function loadAsset(): Promise<Uint8Array<ArrayBuffer>> {
  if (assetPromise) return assetPromise;
  const pending = (async () => {
    const url = BUNDLED_JPX_CODEC_ASSET.url;
    let bytes: Uint8Array<ArrayBuffer>;
    if (url.protocol === "file:") {
      const moduleName = "node:fs/promises";
      const fs = await import(/* @vite-ignore */ moduleName) as { readFile(url: URL): Promise<Uint8Array> };
      bytes = new Uint8Array(await fs.readFile(url));
    } else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load OpenJPEG (${response.status}).`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.length !== BUNDLED_JPX_CODEC_ASSET.byteLength) throw new Error("Invalid bundled OpenJPEG asset length.");
    preparedAsset = bytes;
    return bytes;
  })();
  assetPromise = pending;
  void pending.catch(() => { if (assetPromise === pending) assetPromise = undefined; });
  return pending;
}

/** Set the operation's memory ceiling within the kernel's unsigned 32-bit ABI. */
function capWasmMemory(bytes: Uint8Array, maximumPages: number): Uint8Array<ArrayBuffer> {
  let cursor = 8;
  const read = (): number => {
    let value = 0, shift = 0, byte: number;
    do {
      byte = bytes[cursor++];
      if (byte === undefined || shift > 28) throw new Error("Invalid WASM integer.");
      value += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    return value;
  };
  const encode = (value: number): number[] => {
    const result: number[] = [];
    do { const byte = value & 127; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
    return result;
  };
  while (cursor < bytes.length) {
    const start = cursor, id = bytes[cursor++], length = read(), end = cursor + length;
    if (id === 5) {
      if (read() !== 1 || read() !== 1) throw new Error("Invalid pinned WASM memory section.");
      const minimum = read(); read();
      if (cursor !== end || maximumPages < minimum || maximumPages > 65536) {
        throw new PdfError("resource-limit", "OpenJPEG's initial memory exceeds the configured stream limit.");
      }
      const payload = [1, 1, ...encode(minimum), ...encode(maximumPages)];
      const section = [5, ...encode(payload.length), ...payload];
      const output = new Uint8Array(start + section.length + bytes.length - end);
      output.set(bytes.subarray(0, start)); output.set(section, start); output.set(bytes.subarray(end), start + section.length);
      return output;
    }
    cursor = end;
  }
  throw new Error("Pinned OpenJPEG kernel has no memory section.");
}

function codecError(message: string, reason: string, cause?: unknown): PdfError {
  return new PdfError("unsupported-image", message, { cause, details: { codec: "jpeg2000", reason } });
}
