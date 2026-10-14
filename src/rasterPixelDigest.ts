interface NodeRasterHash {
  update(bytes: Uint8Array<ArrayBufferLike>): void;
  digest(encoding: "hex"): string;
}

interface NodeRasterHashProcess {
  readonly versions?: { readonly node?: string };
  getBuiltinModule?: (id: "crypto") => { createHash?: (algorithm: "sha256") => NodeRasterHash } | undefined;
}

/** Work chunks keep updates cancellable; they do not limit image size. */
const HASH_CHUNK_BYTES = 1024 * 1024;

function createNodeRasterHash(): NodeRasterHash | undefined {
  const nodeProcess = (globalThis as { readonly process?: NodeRasterHashProcess }).process;
  if (!nodeProcess?.versions?.node || typeof nodeProcess.getBuiltinModule !== "function") return undefined;
  try {
    return nodeProcess.getBuiltinModule("crypto")?.createHash?.("sha256");
  } catch {
    // Capability shims and older hosts retain the ordinary WebCrypto route.
    return undefined;
  }
}

/**
 * Dimensions and exact SHA-256 of raster pixels or a retained image section.
 * Node updates borrow their input instead of WebCrypto's full input snapshot.
 * Browsers keep WebCrypto; insecure origins without it do not deduplicate.
 */
export async function rasterPixelDigest(bytes: Uint8Array<ArrayBufferLike>, width: number, height: number,
  signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  const hash = createNodeRasterHash();
  if (hash) {
    let lastYield = performance.now();
    for (let offset = 0; offset < bytes.length; offset += HASH_CHUNK_BYTES) {
      signal?.throwIfAborted();
      hash.update(bytes.subarray(offset, Math.min(bytes.length, offset + HASH_CHUNK_BYTES)));
      if (performance.now() - lastYield >= 8) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        lastYield = performance.now();
      }
    }
    const digest = hash.digest("hex");
    signal?.throwIfAborted();
    return `${width}x${height}:${digest}`;
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const view = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  const digest = new Uint8Array(await subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>));
  signal?.throwIfAborted();
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `${width}x${height}:${hex}`;
}
