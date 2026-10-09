/** Configure a bundled kernel's single defined memory without a policy cap. */
export function configureWasm32Memory(bytes: Uint8Array, maximumPages = 65536): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(maximumPages) || maximumPages < 1 || maximumPages > 65536) {
    throw new RangeError("Invalid WASM32 memory size.");
  }
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
    if (end > bytes.length) throw new Error("Truncated WASM section.");
    if (id === 5) {
      if (read() !== 1) throw new Error("Invalid bundled WASM memory count.");
      const flags = read();
      if (flags !== 0 && flags !== 1) throw new Error("Unsupported bundled WASM memory layout.");
      const minimum = read();
      if (flags === 1) read();
      if (cursor !== end || maximumPages < minimum) throw new RangeError("WASM initial memory exceeds its configured size.");
      const payload = [1, 1, ...encode(minimum), ...encode(maximumPages)];
      const section = [5, ...encode(payload.length), ...payload];
      const output = new Uint8Array(start + section.length + bytes.length - end);
      output.set(bytes.subarray(0, start)); output.set(section, start); output.set(bytes.subarray(end), start + section.length);
      return output;
    }
    cursor = end;
  }
  // Code-only modules need no memory adjustment (also used by loader probes).
  return new Uint8Array(bytes);
}
