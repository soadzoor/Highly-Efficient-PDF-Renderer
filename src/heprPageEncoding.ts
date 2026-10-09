import type { HeprPageData } from "./heprDocumentData";
import { validateHeprPageData } from "./heprDocumentDataValidation";

const HEADER_BYTES = 16;
const MAX_UINT32 = 0xffffffff;
const align4 = (value: number): number => Math.ceil(value / 4) * 4;
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
type ResourceArray = Uint8Array | Uint32Array | Int32Array | Float32Array;
type ArrayKind = "u8" | "u32" | "i32" | "f32";
const constructors = { u8: Uint8Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array };
function fail(message: string): never { throw new TypeError(`Invalid retained page encoding: ${message}.`); }

/** Portable encoding for self-contained retained resources, never a source PDF. */
export function encodeHeprPageData(page: HeprPageData, signal?: AbortSignal): Uint8Array {
  signal?.throwIfAborted(); validateHeprPageData(page);
  const arrays: { array: ResourceArray; kind: ArrayKind; offset: number }[] = [];
  const knownArrays = new Map<ResourceArray, { $heprArray: ArrayKind; offset: number; length: number }>();
  const active = new Set<object>();
  let payloadBytes = 0;
  const pack = (value: unknown): unknown => {
    signal?.throwIfAborted();
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) fail("non-finite metadata"); return value; }
    if (value instanceof Uint8Array || value instanceof Uint32Array || value instanceof Int32Array || value instanceof Float32Array) {
      const known = knownArrays.get(value); if (known) return known;
      const kind: ArrayKind = value instanceof Uint8Array ? "u8" : value instanceof Uint32Array ? "u32" : value instanceof Int32Array ? "i32" : "f32";
      const reference = { $heprArray: kind, offset: payloadBytes, length: value.length };
      arrays.push({ array: value, kind, offset: payloadBytes }); knownArrays.set(value, reference);
      payloadBytes = align4(payloadBytes + value.byteLength);
      if (payloadBytes > MAX_UINT32) fail("resource length exceeds its uint32 field");
      return reference;
    }
    if (typeof value !== "object" || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) fail("unsupported metadata value");
    if (active.has(value)) fail("cyclic metadata");
    active.add(value);
    let result: unknown;
    if (Array.isArray(value)) result = value.map(item => pack(item));
    else {
      const object: Record<string, unknown> = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (key === "$heprArray") fail("reserved metadata key");
        if (item !== undefined) object[key] = pack(item);
      }
      result = object;
    }
    active.delete(value); return result;
  };
  const metadata = new TextEncoder().encode(JSON.stringify(pack(page)));
  if (metadata.length > MAX_UINT32) fail("metadata length exceeds its uint32 field");
  const payloadOffset = align4(HEADER_BYTES + metadata.length);
  const output = new Uint8Array(payloadOffset + payloadBytes), header = new DataView(output.buffer);
  output.set([0x48, 0x52, 0x50, 0]); header.setUint32(4, 1, true);
  header.setUint32(8, metadata.length, true); header.setUint32(12, payloadBytes, true);
  output.set(metadata, HEADER_BYTES);
  for (const { array, kind, offset } of arrays) {
    signal?.throwIfAborted();
    if (littleEndian || kind === "u8") output.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), payloadOffset + offset);
    else for (let index = 0; index < array.length; index++) {
      const at = payloadOffset + offset + index * 4;
      if (kind === "f32") header.setFloat32(at, array[index], true);
      else if (kind === "i32") header.setInt32(at, array[index], true);
      else header.setUint32(at, array[index], true);
    }
  }
  signal?.throwIfAborted(); return output;
}

export function decodeHeprPageData(bytes: Uint8Array, signal?: AbortSignal): HeprPageData {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER_BYTES) fail("invalid resource length");
  if (!(bytes.buffer instanceof ArrayBuffer)) bytes = new Uint8Array(bytes);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x48 || bytes[1] !== 0x52 || bytes[2] !== 0x50 || bytes[3] !== 0 || header.getUint32(4, true) !== 1) fail("unsupported resource format");
  const metadataBytes = header.getUint32(8, true), payloadBytes = header.getUint32(12, true);
  const payloadOffset = align4(HEADER_BYTES + metadataBytes);
  if (payloadOffset + payloadBytes !== bytes.length) fail("inconsistent resource sections");
  const metadata: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataBytes)));
  for (let index = HEADER_BYTES + metadataBytes; index < payloadOffset; index++) if (bytes[index]) fail("nonzero metadata padding");
  const arrays = new Map<string, ResourceArray>();
  const unpack = (value: unknown): unknown => {
    signal?.throwIfAborted();
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) fail("non-finite metadata"); return value; }
    if (typeof value !== "object") fail("invalid metadata value");
    if (Array.isArray(value)) return value.map(item => unpack(item));
    const source = value as Record<string, unknown>;
    if (Object.hasOwn(source, "$heprArray")) {
      const kind = source.$heprArray, offset = source.offset, length = source.length;
      if (Object.keys(source).length !== 3 || typeof kind !== "string" || !Object.hasOwn(constructors, kind) ||
          typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset % 4 ||
          typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) fail("invalid array reference");
      const constructor = constructors[kind as ArrayKind], width = constructor.BYTES_PER_ELEMENT;
      if (length * width > payloadBytes - offset) fail("array exceeds resource section");
      const key = `${kind}:${offset}:${length}`, known = arrays.get(key); if (known) return known;
      let result: ResourceArray;
      const absoluteOffset = bytes.byteOffset + payloadOffset + offset;
      if ((littleEndian || width === 1) && absoluteOffset % width === 0) result = new constructor(bytes.buffer as ArrayBuffer, absoluteOffset, length);
      else {
        result = new constructor(length);
        for (let index = 0; index < length; index++) {
          const at = payloadOffset + offset + index * width;
          result[index] = kind === "u8" ? header.getUint8(at) : kind === "f32" ? header.getFloat32(at, true) : kind === "i32" ? header.getInt32(at, true) : header.getUint32(at, true);
        }
      }
      arrays.set(key, result); return result;
    }
    const object: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) Object.defineProperty(object, key, {
      value: unpack(item), enumerable: true, writable: true, configurable: true
    });
    return object;
  };
  const page = unpack(metadata);
  validateHeprPageData(page); signal?.throwIfAborted(); return page;
}
