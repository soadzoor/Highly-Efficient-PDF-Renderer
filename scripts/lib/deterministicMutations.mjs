/** A tiny reproducible PRNG for bounded parser mutation tests. */
export class DeterministicRng {
  #state;

  constructor(seed) {
    if (!Number.isInteger(seed)) throw new TypeError("The mutation seed must be an integer.");
    this.#state = seed >>> 0 || 0x6d2b79f5;
  }

  nextUint32() {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  integer(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("The PRNG bound must be a positive safe integer.");
    }
    return this.nextUint32() % maxExclusive;
  }
}

/**
 * Apply one small mutation. Output is capped at input length + 8 bytes so a
 * fuzz case cannot turn into an accidental allocation stress test.
 */
export function mutateBytes(input, rng) {
  if (!(input instanceof Uint8Array)) throw new TypeError("Mutation input must be Uint8Array.");
  if (!(rng instanceof DeterministicRng)) throw new TypeError("Mutation requires DeterministicRng.");

  if (input.length === 0) return Uint8Array.of(rng.integer(256));
  switch (rng.integer(6)) {
    case 0: {
      const output = input.slice();
      const index = rng.integer(output.length);
      output[index] ^= 1 << rng.integer(8);
      return output;
    }
    case 1: {
      const output = input.slice();
      const start = rng.integer(output.length);
      const length = 1 + rng.integer(Math.min(4, output.length - start));
      for (let index = 0; index < length; index += 1) {
        output[start + index] = rng.integer(256);
      }
      return output;
    }
    case 2: {
      const start = rng.integer(input.length);
      const length = 1 + rng.integer(Math.min(8, input.length - start));
      const output = new Uint8Array(input.length - length);
      output.set(input.subarray(0, start));
      output.set(input.subarray(start + length), start);
      return output;
    }
    case 3: {
      const insertionLength = 1 + rng.integer(8);
      const insertionOffset = rng.integer(input.length + 1);
      const output = new Uint8Array(input.length + insertionLength);
      output.set(input.subarray(0, insertionOffset));
      for (let index = 0; index < insertionLength; index += 1) {
        output[insertionOffset + index] = rng.integer(256);
      }
      output.set(input.subarray(insertionOffset), insertionOffset + insertionLength);
      return output;
    }
    case 4:
      return input.slice(0, rng.integer(input.length));
    default: {
      const start = rng.integer(input.length);
      const length = 1 + rng.integer(Math.min(8, input.length - start));
      const insertionOffset = rng.integer(input.length + 1);
      const output = new Uint8Array(input.length + length);
      output.set(input.subarray(0, insertionOffset));
      output.set(input.subarray(start, start + length), insertionOffset);
      output.set(input.subarray(insertionOffset), insertionOffset + length);
      return output;
    }
  }
}

/** A stable compact fingerprint; this is not intended for security. */
export function fingerprintBytes(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${hash.toString(16).padStart(8, "0")}`;
}

/** Fail a test instead of letting an asynchronous fuzz case wait forever. */
export async function withTimeout(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${milliseconds} ms.`)),
      milliseconds
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
