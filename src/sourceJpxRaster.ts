/** Original oversized JPEG 2000 samples, bound to their canonical RGBA pixels. */
export interface SourceJpxRaster {
  readonly width: number;
  readonly height: number;
  readonly components: 1 | 3;
  readonly encoded: Uint8Array;
  readonly rgbaHash: readonly [number, number];
  readonly encodedHash: readonly [number, number];
}

const bundledResolvers = new WeakSet<object>();
/** Internal identity brand: a caller-supplied resolver cannot promise the same decode. */
export function registerBundledJpxResolver<T extends object>(resolver: T): T {
  bundledResolvers.add(resolver);
  return resolver;
}
export function isBundledJpxResolver(resolver: unknown): boolean {
  return typeof resolver === "function" && bundledResolvers.has(resolver);
}

const LITTLE_ENDIAN = new Uint32Array(Uint8Array.of(1, 0, 0, 0).buffer)[0] === 1;
const INITIAL_A = 0x811c9dc5, INITIAL_B = 0x9e3779b9;
const mixA = (hash: number, word: number): number => Math.imul(hash ^ word, 0x01000193);
const mixB = (hash: number, word: number): number => Math.imul(hash ^ (word >>> 16 | word << 16), 0x85ebca6b);

/**
 * Dimensions-bound, two-lane mutation fingerprint, not a cryptographic digest.
 * Words always mean little-endian RGBA, even on unaligned or big-endian hosts.
 * The ordinary aligned path borrows the pixels without a full-image copy.
 */
export function hashSourceJpxRgba(data: Uint8Array, width: number, height: number,
  signal?: AbortSignal): readonly [number, number] {
  signal?.throwIfAborted();
  const bytes = width * height * 4;
  if (!(data instanceof Uint8Array) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || !Number.isSafeInteger(bytes) || data.length < bytes) {
    throw new RangeError("Invalid source JPEG 2000 RGBA dimensions or pixels.");
  }
  let a = INITIAL_A, b = INITIAL_B;
  for (const value of [width >>> 0, Math.floor(width / 0x100000000), height >>> 0, Math.floor(height / 0x100000000)]) {
    a = mixA(a, value); b = mixB(b, value);
  }
  const count = bytes / 4;
  const words = LITTLE_ENDIAN && (data.byteOffset & 3) === 0 ? new Uint32Array(data.buffer, data.byteOffset, count) : undefined;
  const view = words ? undefined : new DataView(data.buffer, data.byteOffset, bytes);
  for (let index = 0; index < count; index++) {
    if ((index & 0xffff) === 0) signal?.throwIfAborted();
    const word = words ? words[index] : view!.getUint32(index * 4, true);
    a = mixA(a, word); b = mixB(b, word);
  }
  signal?.throwIfAborted();
  return [a >>> 0, b >>> 0];
}

/** Fingerprint original codec bytes so public edits use ordinary re-encoding. */
export function hashSourceJpxEncoded(data: Uint8Array, signal?: AbortSignal): readonly [number, number] {
  signal?.throwIfAborted();
  if (!(data instanceof Uint8Array)) throw new TypeError("Invalid source JPEG 2000 encoded bytes.");
  let a = mixA(INITIAL_A, data.length), b = mixB(INITIAL_B, data.length);
  for (let index = 0; index < data.length; index++) {
    if ((index & 0xffff) === 0) signal?.throwIfAborted();
    a = mixA(a, data[index]); b = mixB(b, data[index]);
  }
  signal?.throwIfAborted();
  return [a >>> 0, b >>> 0];
}

/** Metadata only; consumers also verify codec headers and both fingerprints. */
export function isSourceJpxRaster(value: unknown): value is SourceJpxRaster {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<SourceJpxRaster>;
  const validLane = (lane: unknown): boolean => typeof lane === "number" && Number.isInteger(lane) && lane >= 0 && lane <= 0xffffffff;
  const validHash = (hash: unknown): boolean => Array.isArray(hash) && hash.length === 2 && validLane(hash[0]) && validLane(hash[1]);
  return Number.isSafeInteger(source.width) && Number.isSafeInteger(source.height) &&
    source.width! > 0 && source.height! > 0 && source.width! <= 0xffffffff && source.height! <= 0xffffffff &&
    Number.isSafeInteger(source.width! * source.height! * 4) &&
    (source.components === 1 || source.components === 3) && source.encoded instanceof Uint8Array && source.encoded.length > 0 &&
    validHash(source.rgbaHash) && validHash(source.encodedHash);
}
