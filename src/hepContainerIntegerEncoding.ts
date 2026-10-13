import { align4, fail, transformBytes } from "./hepContainerShared";
import { bytePlaneVarintMaxLength, type BytePlaneVarintMode } from "./hepContainerIntegers";

// Writer-only integer codecs. Readers import only the decoder module, so the
// viewer does not ship these encoders with the container reader.

/** Modes: signed literals, signed modulo-32 deltas, unsigned modulo-32 deltas. */
export function encodeBytePlaneVarints(bytes: Uint8Array, mode: BytePlaneVarintMode): Uint8Array {
  bytePlaneVarintMaxLength(bytes.length);
  if (mode !== 0 && mode !== 1 && mode !== 2) fail("unsupported integer chunk mode.");
  const count = bytes.length / 4;
  const word = (index: number): number => (bytes[index] | bytes[count + index] << 8 |
    bytes[count * 2 + index] << 16 | bytes[count * 3 + index] << 24) >>> 0;
  const transform = (value: number, previous: number): number => {
    const residual = mode === 0 ? value : (value - previous) >>> 0;
    return mode === 2 ? residual : ((residual << 1) ^ (residual >> 31)) >>> 0;
  };
  // Measure first instead of allocating the five-byte worst case for every word.
  let length = 1, previous = 0;
  for (let index = 0; index < count; index++) {
    const value = word(index), encoded = transform(value, previous);
    length += encoded < 0x80 ? 1 : encoded < 0x4000 ? 2 : encoded < 0x200000 ? 3 : encoded < 0x10000000 ? 4 : 5;
    previous = value;
  }
  const output = new Uint8Array(length);
  output[0] = mode;
  let cursor = 1;
  previous = 0;
  for (let index = 0; index < count; index++) {
    const value = word(index);
    let encoded = transform(value, previous);
    while (encoded >= 0x80) {
      output[cursor++] = (encoded & 0x7f) | 0x80;
      encoded >>>= 7;
    }
    output[cursor++] = encoded;
    previous = value;
  }
  return output;
}

/** Return a compressed codec-3 payload only when it reduces the padded chunk. */
export async function chooseHepIntegerEncoding(
  bytes: Uint8Array,
  originalStoredLength: number,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  signal?.throwIfAborted();
  if (!bytes.length || bytes.length % 4 !== 0) return null;
  let best: Uint8Array | null = null;
  let bestLength = align4(originalStoredLength);
  for (const mode of [0, 1, 2] as const) {
    signal?.throwIfAborted();
    const encoded = encodeBytePlaneVarints(bytes, mode);
    signal?.throwIfAborted();
    const compressed = await transformBytes(encoded, true, Number.MAX_SAFE_INTEGER, signal);
    if (align4(compressed.length) < bestLength) {
      best = compressed;
      bestLength = align4(compressed.length);
    }
  }
  return best;
}

const INTEGER_SAMPLE_SLICES = 16;
const INTEGER_SAMPLE_WORDS = 8192;
/** Candidates whose sampled size is within this share of the smallest are compressed whole. */
const INTEGER_SAMPLE_MARGIN = 0.01;

/**
 * The stored chunk that plain deflate followed by chooseHepIntegerEncoding
 * would select, without compressing every candidate in full. Evenly spaced
 * word slices rank plain deflate and the three varint modes; only candidates
 * within a small margin of the best sample are compressed whole, with the
 * same preference order and padding comparison. Chunks no larger than the
 * sample compare every candidate exactly.
 */
export async function encodeHepIntegerChunk(
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<{ stored: Uint8Array; codec: 0 | 1 | 3 }> {
  signal?.throwIfAborted();
  const plain = async (): Promise<{ stored: Uint8Array; codec: 0 | 1 | 3 }> => {
    const compressed = await transformBytes(bytes, true, Number.MAX_SAFE_INTEGER, signal);
    return compressed.length < bytes.length ? { stored: compressed, codec: 1 } : { stored: bytes, codec: 0 };
  };
  if (!bytes.length || bytes.length % 4 !== 0) return plain();
  const count = bytes.length / 4;
  // Index 0 is plain deflate; 1-3 are varint modes 0-2.
  let selected = [true, true, true, true];
  if (count > INTEGER_SAMPLE_SLICES * INTEGER_SAMPLE_WORDS) {
    const sample = sampleWordPlanes(bytes, count);
    const sizes = [(await transformBytes(sample, true, Number.MAX_SAFE_INTEGER, signal)).length];
    for (const mode of [0, 1, 2] as const) {
      sizes.push((await transformBytes(encodeBytePlaneVarints(sample, mode), true, Number.MAX_SAFE_INTEGER, signal)).length);
    }
    const smallest = Math.min(...sizes);
    selected = sizes.map(size => size <= smallest * (1 + INTEGER_SAMPLE_MARGIN));
  }
  let best: { stored: Uint8Array; codec: 0 | 1 | 3 } = selected[0] ? await plain() : { stored: bytes, codec: 0 };
  let bestLength = align4(best.stored.length);
  for (const mode of [0, 1, 2] as const) {
    if (!selected[mode + 1]) continue;
    signal?.throwIfAborted();
    const compressed = await transformBytes(encodeBytePlaneVarints(bytes, mode), true, Number.MAX_SAFE_INTEGER, signal);
    if (align4(compressed.length) < bestLength) {
      best = { stored: compressed, codec: 3 };
      bestLength = align4(compressed.length);
    }
  }
  return best;
}

/** Evenly spaced runs of words, kept in the four-byte-plane wire layout. */
function sampleWordPlanes(bytes: Uint8Array, count: number): Uint8Array {
  const words = INTEGER_SAMPLE_SLICES * INTEGER_SAMPLE_WORDS;
  const sample = new Uint8Array(words * 4);
  for (let slice = 0; slice < INTEGER_SAMPLE_SLICES; slice += 1) {
    const start = Math.floor((count - INTEGER_SAMPLE_WORDS) * slice / (INTEGER_SAMPLE_SLICES - 1));
    for (let plane = 0; plane < 4; plane += 1) {
      sample.set(bytes.subarray(plane * count + start, plane * count + start + INTEGER_SAMPLE_WORDS),
        plane * words + slice * INTEGER_SAMPLE_WORDS);
    }
  }
  return sample;
}
