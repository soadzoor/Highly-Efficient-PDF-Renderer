import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const upstreamSha256 = "164cd9583a3e4d081f767d3b41ff0a730443dc7535fcc5caff83561463384b79";
const leb = value => {
  const result = [];
  do { const byte = value & 127; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
  return Uint8Array.from(result);
};
const join = arrays => {
  const output = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0;
  for (const bytes of arrays) { output.set(bytes, offset); offset += bytes.length; }
  return output;
};

/** Reproduce HEPR's exact, fastest-lossless configuration from the pinned binary.
 * Only the wrapper's WebPConfig stores change; codec code and exports are intact.
 * The corresponding source changes are included in webp_wasm.c.
 */
export function prepareWebpRuntime(bytes) {
  if (createHash("sha256").update(bytes).digest("hex") !== upstreamSha256) throw Error("Unexpected upstream WebP WASM hash.");
  let offset = 8, patched = false;
  const read = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  const sections = [bytes.subarray(0, 8)];
  while (offset < bytes.length) {
    const id = bytes[offset++], length = read(), start = offset, end = start + length;
    let payload = bytes.subarray(start, end);
    if (id === 10) {
      const count = read(), bodies = [leb(count)];
      for (let index = 0; index < count; index++) {
        const bodyLength = read(), bodyStart = offset, bodyEnd = offset + bodyLength;
        let body = bytes.subarray(bodyStart, bodyEnd);
        if (index === 264) { // Export h = function 269, after five imported functions.
          const needle = Uint8Array.from([0x41, 0, 0x20, 6, 0x10, 0x82, 1]);
          const position = body.findIndex((_, at) => needle.every((byte, i) => body[at + i] === byte));
          if (position !== 64) throw Error("Unexpected pinned WebP wrapper/config layout.");
          // Config pointer local 6: method offset 8, near_lossless 92, exact 96.
          const stores = Uint8Array.from([0x20, 6, 0x41, 0, 0x36, 2, 8,
            0x20, 6, 0x41, 0xe4, 0, 0x36, 2, 92,
            0x20, 6, 0x41, 1, 0x36, 2, 96]);
          body = join([body.subarray(0, position), stores, body.subarray(position)]);
          patched = true;
        }
        bodies.push(leb(body.length), body);
        offset = bodyEnd;
      }
      payload = join(bodies);
    }
    sections.push(Uint8Array.of(id), leb(payload.length), payload);
    offset = end;
  }
  const output = join(sections);
  if (!patched || !WebAssembly.validate(output)) throw Error("Failed to prepare the WebP runtime.");
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(process.argv[3], prepareWebpRuntime(await readFile(process.argv[2])));
}
