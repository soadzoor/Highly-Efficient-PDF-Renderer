import { throwIfAborted } from "../nativeTypes";
import { JBIG2_MAX_WORK, jbig2ResourceError } from "./jbig2Preflight";

export const BUNDLED_JBIG2_CODEC_ASSET = Object.freeze({
  url: new URL("../../assets/codecs/jbig2/jbig2-6.4.299.wasm?no-inline", import.meta.url),
  byteLength: 110_780,
  sha256: "7136979e1439e9676588e2273751aa39245b7679d6e87a20703a2f3f446fbdb2",
  source: "https://github.com/mozilla/pdf.js/tree/v6.4.299/external/jbig2"
});
const PAGE_BYTES = 65536;
const BATCH_SIZE = 1024;
let assetPromise: Promise<Uint8Array<ArrayBuffer>> | undefined;
const modules = new Map<number, Promise<WebAssembly.Module>>();

interface Jbig2Exports extends WebAssembly.Exports {
  i: WebAssembly.Memory;
  j(): void;
  k(length: number): number;
  m(pointer: number, length: number, width: number, height: number, globals: number, globalsLength: number): void;
}

/** PDFium uses an operation-local heap and a metered, locally vendored module.
 * The optional work bound is internal and permits direct tests of the actual
 * injected callback. Work units count function entries/loop iterations, rather
 * than the former JS decoder's algorithm-specific steps. Callbacks are batched
 * every 1024 entries; completion can leave at most 1023 entries uncharged.
 */
export async function decodePdfiumJbig2(encoded: Uint8Array, globals: Uint8Array, width: number, height: number,
  maxBytes: number, signal?: AbortSignal, maximumWork = JBIG2_MAX_WORK): Promise<Uint8Array> {
  throwIfAborted(signal);
  const outputBytes = Math.ceil(width / 8) * height;
  // Reserve caller data and the JS bridge output outside the capped WASM heap.
  const maximumPages = Math.floor(Math.min(maxBytes - encoded.length - globals.length - outputBytes - 65536,
    512 * 1024 * 1024) / PAGE_BYTES);
  const module = await withAbort(loadModule(maximumPages), signal);
  throwIfAborted(signal);
  let wasm: Jbig2Exports, samples: Uint8Array | undefined, work = 0, heapLimitHit = false;
  const checkWork = (): void => {
    throwIfAborted(signal);
    if ((work += BATCH_SIZE) > maximumWork) throw jbig2ResourceError("jbig2-work");
  };
  const heapSlice = (pointer: number, length: number): Uint8Array => {
    if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) || pointer < 0 || length < 0 ||
      pointer + length > wasm.i.buffer.byteLength) throw new Error("Invalid PDFium output buffer.");
    return new Uint8Array(wasm.i.buffer, pointer, length);
  };
  const instance = new WebAssembly.Instance(module, { a: {
    a: () => 0,
    b: (requested: number): number => {
      throwIfAborted(signal);
      requested >>>= 0;
      const pages = Math.ceil(requested / PAGE_BYTES);
      if (pages > maximumPages) { heapLimitHit = true; return 0; }
      try { wasm.i.grow(Math.max(0, pages - wasm.i.buffer.byteLength / PAGE_BYTES)); return 1; }
      catch { heapLimitHit = true; return 0; }
    },
    c: () => { throw new Error("PDFium decoder exited."); },
    d: checkWork,
    e: () => { if (heapLimitHit) throw jbig2ResourceError("jbig2-working-set"); throw new Error("PDFium decoder aborted."); },
    f: () => { throw new Error("Unexpected CCITT output in JBIG2 decoder."); },
    g: () => { throw new Error("Unexpected CCITT allocation in JBIG2 decoder."); },
    h: (pointer: number, pitch: number, paddedPitch: number, rows: number): void => {
      throwIfAborted(signal);
      if (pitch !== Math.ceil(width / 8) || paddedPitch !== Math.ceil(width / 32) * 4 || rows !== height || samples) {
        throw new Error("Invalid PDFium output dimensions.");
      }
      heapSlice(pointer, paddedPitch * rows);
      samples = new Uint8Array(outputBytes);
      for (let row = 0; row < rows; row++) {
        if ((row & 255) === 0) throwIfAborted(signal);
        samples.set(heapSlice(pointer + row * paddedPitch, pitch), row * pitch);
      }
    }
  } });
  const exports = instance.exports;
  if (!(exports.i instanceof WebAssembly.Memory) || typeof exports.j !== "function" ||
    typeof exports.k !== "function" || typeof exports.m !== "function") throw new Error("Invalid bundled PDFium ABI.");
  wasm = exports as Jbig2Exports;
  // No _free after an interrupted allocator/decoder: dropping this fresh
  // instance releases its heap and cannot mask the original limit/abort error.
  wasm.j();
  const pointer = wasm.k(encoded.length);
  const globalsPointer = globals.length ? wasm.k(globals.length) : 0;
  if (!pointer || (globals.length && !globalsPointer)) throw jbig2ResourceError("jbig2-working-set");
  heapSlice(pointer, encoded.length).set(encoded);
  if (globals.length) heapSlice(globalsPointer, globals.length).set(globals);
  wasm.m(pointer, encoded.length, width, height, globalsPointer, globals.length);
  throwIfAborted(signal);
  if (!samples) {
    if (heapLimitHit) throw jbig2ResourceError("jbig2-working-set");
    throw new Error("Unable to decode the JBIG2 image.");
  }
  return samples;
}

function loadModule(maximumPages: number): Promise<WebAssembly.Module> {
  const cached = modules.get(maximumPages);
  if (cached) return cached;
  const pending = loadAsset().then(bytes => WebAssembly.compile(capJbig2WasmMemory(bytes, maximumPages)));
  if (modules.size >= 4) modules.delete(modules.keys().next().value!);
  modules.set(maximumPages, pending);
  void pending.catch(() => { if (modules.get(maximumPages) === pending) modules.delete(maximumPages); });
  return pending;
}
function loadAsset(): Promise<Uint8Array<ArrayBuffer>> {
  if (assetPromise) return assetPromise;
  const pending = (async () => {
    const url = BUNDLED_JBIG2_CODEC_ASSET.url;
    let bytes: Uint8Array<ArrayBuffer>;
    if (url.protocol === "file:") {
      const moduleName = "node:fs/promises";
      const fs = await import(/* @vite-ignore */ moduleName) as { readFile(url: URL): Promise<Uint8Array> };
      bytes = new Uint8Array(await fs.readFile(url));
    } else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load bundled JBIG2 (${response.status}).`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.length !== BUNDLED_JBIG2_CODEC_ASSET.byteLength) throw new Error("Invalid bundled JBIG2 asset length.");
    return bytes;
  })();
  assetPromise = pending;
  void pending.catch(() => { if (assetPromise === pending) assetPromise = undefined; });
  return pending;
}

/** Tighten the pinned module's defined memory for each operation. */
export function capJbig2WasmMemory(bytes: Uint8Array, maximumPages: number): Uint8Array<ArrayBuffer> {
  let position = 8;
  const read = (): number => {
    let value = 0, shift = 0, byte: number;
    do { byte = bytes[position++]; if (byte === undefined || shift > 28) throw new Error("Invalid WASM integer.");
      value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  const encode = (value: number): number[] => {
    const result: number[] = [];
    do { const byte = value & 127; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
    return result;
  };
  while (position < bytes.length) {
    const start = position, id = bytes[position++], length = read(), end = position + length;
    if (id === 5) {
      if (read() !== 1 || read() !== 1) throw new Error("Invalid pinned JBIG2 memory section.");
      const minimum = read(), maximum = read();
      if (position !== end || !Number.isSafeInteger(maximumPages) || maximumPages < minimum || maximumPages > maximum) {
        throw jbig2ResourceError("jbig2-working-set");
      }
      const payload = [1, 1, ...encode(minimum), ...encode(maximumPages)];
      const section = [5, ...encode(payload.length), ...payload];
      const result = new Uint8Array(start + section.length + bytes.length - end);
      result.set(bytes.subarray(0, start)); result.set(section, start); result.set(bytes.subarray(end), start + section.length);
      return result;
    }
    position = end;
  }
  throw new Error("Pinned JBIG2 kernel has no memory section.");
}
async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;
  throwIfAborted(signal);
  let abort: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => { try { throwIfAborted(signal); } catch (cause) { reject(cause); } };
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort!); }
}
