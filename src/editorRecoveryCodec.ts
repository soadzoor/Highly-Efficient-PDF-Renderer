import type { EditorRecoverySnapshot } from "./editorTypes";

export interface EditorRecoveryEnvelope {
  version: 1;
  encrypted: boolean;
  payload: Uint8Array;
  salt?: Uint8Array;
  iv?: Uint8Array;
  iterations?: number;
}
type Encoded = null | string | number | boolean | { ref: number } | { scalar: "undefined" | "NaN" | "Infinity" | "-Infinity" | "-0" | "bigint"; value?: string };
type Node = { kind: string; entries?: unknown; start?: number; length?: number; buffer?: Encoded; offset?: number };
const encoder = new TextEncoder(), decoder = new TextDecoder();
const types = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array };

/** Recovery-only binary graph: retains typed arrays, maps and shared buffers. */
export function encodeEditorRecoveryGraph(value: unknown): Uint8Array {
  const nodes: Node[] = [], seen = new Map<object, number>(), chunks: Uint8Array[] = []; let bytes = 0;
  const buffers = new Map<number, { buffer: ArrayBufferLike; direct: boolean; ranges: { offset: number; length: number }[]; base?: number }>();
  const encode = (input: unknown, range?: { offset: number; length: number }): Encoded => {
    if (input === undefined) return { scalar: "undefined" };
    if (typeof input === "bigint") return { scalar: "bigint", value: String(input) };
    if (typeof input === "number") return Number.isFinite(input) && !Object.is(input, -0) ? input
      : { scalar: Number.isNaN(input) ? "NaN" : input === Infinity ? "Infinity" : input === -Infinity ? "-Infinity" : "-0" };
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input !== "object") throw new TypeError("Recovery data must not contain executable values.");
    const existing = seen.get(input);
    if (existing !== undefined) {
      const buffer = buffers.get(existing); if (buffer) { if (range) buffer.ranges.push(range); else buffer.direct = true; }
      return { ref: existing };
    }
    const index = nodes.length, node: Node = { kind: "object" }; nodes.push(node); seen.set(input, index);
    if (input instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer) {
      node.kind = "buffer"; buffers.set(index, { buffer: input, direct: !range, ranges: range ? [range] : [] });
    } else if (ArrayBuffer.isView(input)) {
      node.kind = input instanceof DataView ? "DataView" : input.constructor.name;
      if (node.kind !== "DataView" && !Object.hasOwn(types, node.kind)) throw new TypeError(`Unsupported recovery array ${node.kind}.`);
      node.buffer = encode(input.buffer, { offset: input.byteOffset, length: input.byteLength }); node.offset = input.byteOffset;
      node.length = input instanceof DataView ? input.byteLength : (input as unknown as { length: number }).length;
    } else if (Array.isArray(input)) { node.kind = "array"; node.entries = Array.from(input, item => encode(item)); }
    else if (input instanceof Map) { node.kind = "map"; node.entries = [...input].map(([key, item]) => [encode(key), encode(item)]); }
    else if (input instanceof Set) { node.kind = "set"; node.entries = [...input].map(item => encode(item)); }
    else if (input instanceof Date) { node.kind = "date"; node.entries = input.toISOString(); }
    else {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Recovery data contains an unsupported resource object.");
      node.entries = Object.entries(input).map(([key, item]) => [key, encode(item)]);
    }
    return { ref: index };
  };
  const root = encode(value);
  for (const [index, buffer] of buffers) {
    let first = Infinity, last = 0;
    for (const range of buffer.ranges) { first = Math.min(first, range.offset); last = Math.max(last, range.offset + range.length); }
    const base = buffer.direct ? 0 : Math.floor(first / 8) * 8, end = buffer.direct ? buffer.buffer.byteLength : last;
    const chunk = new Uint8Array(end - base); buffer.base = base;
    // A pooled typed-array backing store can contain unrelated files or memory.
    // Persist only referenced ranges; gaps are zero rather than copied blindly.
    if (buffer.direct) chunk.set(new Uint8Array(buffer.buffer));
    else for (const range of buffer.ranges) chunk.set(new Uint8Array(buffer.buffer, range.offset, range.length), range.offset - base);
    nodes[index].start = bytes; nodes[index].length = chunk.length; chunks.push(chunk); bytes += chunk.length;
  }
  for (const node of nodes) if (node.buffer && typeof node.buffer === "object" && "ref" in node.buffer) node.offset! -= buffers.get(node.buffer.ref)?.base ?? 0;
  const metadata = encoder.encode(JSON.stringify({ root, nodes }));
  const result = new Uint8Array(8 + metadata.length + bytes); result.set([72, 69, 80, 82]);
  new DataView(result.buffer).setUint32(4, metadata.length, true); result.set(metadata, 8);
  let offset = 8 + metadata.length; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function decodeEditorRecoveryGraph(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes[0] !== 72 || bytes[1] !== 69 || bytes[2] !== 80 || bytes[3] !== 82) throw new TypeError("Invalid recovery data.");
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (metadataLength > bytes.length - 8) throw new RangeError("Truncated recovery metadata.");
  const graph = JSON.parse(decoder.decode(bytes.subarray(8, 8 + metadataLength))) as { root: Encoded; nodes: Node[] };
  if (!Array.isArray(graph.nodes)) throw new TypeError("Invalid recovery graph.");
  const base = 8 + metadataLength, objects: unknown[] = new Array(graph.nodes.length), visiting = new Set<number>();
  const number = (input: unknown): number => { if (!Number.isSafeInteger(input) || (input as number) < 0) throw new RangeError("Invalid recovery range."); return input as number; };
  const decode = (input: Encoded): unknown => {
    if (!input || typeof input !== "object") return input;
    if ("scalar" in input) {
      switch (input.scalar) { case "undefined": return undefined; case "NaN": return NaN; case "Infinity": return Infinity; case "-Infinity": return -Infinity; case "-0": return -0; case "bigint": return BigInt(input.value!); }
      throw new TypeError("Unknown recovery scalar.");
    }
    const index = number(input.ref), node = graph.nodes[index]; if (!node) throw new RangeError("Unknown recovery resource.");
    if (Object.hasOwn(objects, index)) return objects[index];
    if (visiting.has(index)) throw new TypeError("Invalid cyclic recovery buffer."); visiting.add(index);
    if (node.kind === "buffer") {
      const start = number(node.start), length = number(node.length);
      if (start + length > bytes.length - base) throw new RangeError("Truncated recovery resource.");
      objects[index] = bytes.slice(base + start, base + start + length).buffer;
    } else if (node.kind === "DataView" || Object.hasOwn(types, node.kind)) {
      const buffer = decode(node.buffer!) as ArrayBuffer; if (!(buffer instanceof ArrayBuffer)) throw new TypeError("Invalid recovery buffer.");
      const offset = number(node.offset), length = number(node.length);
      objects[index] = node.kind === "DataView" ? new DataView(buffer, offset, length) : new types[node.kind as keyof typeof types](buffer, offset, length);
    } else if (node.kind === "date") objects[index] = new Date(String(node.entries));
    else {
      if (!Array.isArray(node.entries)) throw new TypeError("Invalid recovery collection.");
      if (node.kind === "array") { const result: unknown[] = []; objects[index] = result; for (const item of node.entries) result.push(decode(item)); }
      else if (node.kind === "map") { const result = new Map(); objects[index] = result; for (const [key, item] of node.entries) result.set(decode(key), decode(item)); }
      else if (node.kind === "set") { const result = new Set(); objects[index] = result; for (const item of node.entries) result.add(decode(item)); }
      else if (node.kind === "object") {
        const result: Record<string, unknown> = {}; objects[index] = result;
        for (const [key, item] of node.entries) { if (typeof key !== "string") throw new TypeError("Invalid recovery property."); Object.defineProperty(result, key, { value: decode(item), writable: true, enumerable: true, configurable: true }); }
      } else throw new TypeError("Unknown recovery resource type.");
    }
    visiting.delete(index); return objects[index];
  };
  return decode(graph.root);
}

/** Passwords and keys never enter the durable envelope. */
export function createEditorRecoveryCodec(options: { password?: string; protected?: boolean; crypto?: Crypto } = {}) {
  const crypto = options.crypto ?? globalThis.crypto, password = options.password;
  const encrypted = options.protected || password !== undefined;
  const keys = new Map<string, Promise<CryptoKey>>(); let writeSalt: Uint8Array | undefined;
  const key = (salt: Uint8Array, iterations: number): Promise<CryptoKey> => {
    if (password === undefined) throw new Error("Reopen this protected PDF with its password to recover its edits.");
    const token = `${iterations}/${Array.from(salt).join(",")}`; let result = keys.get(token);
    if (!result) {
      result = crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]).then(material =>
        crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as Uint8Array<ArrayBuffer>, iterations, hash: "SHA-256" }, material,
          { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
      keys.set(token, result);
    }
    return result;
  };
  return {
    async encode(snapshot: EditorRecoverySnapshot, draft?: unknown, signal?: AbortSignal): Promise<EditorRecoveryEnvelope> {
      signal?.throwIfAborted(); const payload = encodeEditorRecoveryGraph({ snapshot, draft }); signal?.throwIfAborted();
      if (!encrypted) return { version: 1, encrypted: false, payload };
      if (!crypto?.subtle) throw new Error("Protected document recovery requires browser encryption support.");
      const salt = writeSalt ??= crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iterations = 600000;
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode("HEPR recovery 1") }, await key(salt, iterations), payload as Uint8Array<ArrayBuffer>);
      signal?.throwIfAborted(); return { version: 1, encrypted: true, salt, iv, iterations, payload: new Uint8Array(cipher) };
    },
    async decode(envelope: EditorRecoveryEnvelope, signal?: AbortSignal): Promise<{ snapshot: EditorRecoverySnapshot; draft?: unknown }> {
      signal?.throwIfAborted(); if (envelope.version !== 1 || !(envelope.payload instanceof Uint8Array)) throw new TypeError("Unsupported recovery envelope.");
      let payload = envelope.payload;
      if (envelope.encrypted) {
        if (!(envelope.salt instanceof Uint8Array) || envelope.salt.length < 16 || !(envelope.iv instanceof Uint8Array) || envelope.iv.length !== 12 ||
            envelope.iterations !== 600000) throw new TypeError("Invalid protected recovery envelope.");
        try { payload = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: envelope.iv as Uint8Array<ArrayBuffer>, additionalData: encoder.encode("HEPR recovery 1") },
          await key(envelope.salt, envelope.iterations!), envelope.payload as Uint8Array<ArrayBuffer>)); }
        catch (error) { if (password === undefined) throw error; throw new Error("Recovery could not be unlocked. Check the PDF password or discard the damaged recovery draft."); }
      } else if (encrypted) throw new Error("Refusing an unencrypted recovery draft for a protected document.");
      signal?.throwIfAborted(); const value = decodeEditorRecoveryGraph(payload) as { snapshot: EditorRecoverySnapshot; draft?: unknown };
      if (value?.snapshot?.format !== "hepr-editor-recovery" || value.snapshot.version !== 1) throw new TypeError("Unsupported editor recovery draft.");
      return value;
    }
  };
}
