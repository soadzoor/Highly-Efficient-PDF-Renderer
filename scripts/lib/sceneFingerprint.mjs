import { createHash } from "node:crypto";

/** Exact scene ABI fingerprint for local parser A/B checks; not a HEP format. */
export function sceneFingerprint(scene) {
  const hash = createHash("sha256");
  const active = new Set();
  const visit = (value) => {
    if (ArrayBuffer.isView(value)) {
      hash.update(`${value.constructor.name}:${value.byteLength}:`);
      hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    } else if (value instanceof ArrayBuffer) {
      hash.update(`ArrayBuffer:${value.byteLength}:`);
      hash.update(new Uint8Array(value));
    } else if (value !== null && typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Scene fingerprints require plain objects, arrays, or byte views.");
      }
      if (active.has(value)) throw new Error("Cyclic scene fingerprint input.");
      active.add(value);
      hash.update(Array.isArray(value) ? "[" : "{");
      for (const key of Object.keys(value).sort()) {
        hash.update(`${JSON.stringify(key)}:`);
        visit(value[key]);
      }
      hash.update(Array.isArray(value) ? "]" : "}");
      active.delete(value);
    } else if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError("Unsupported scene fingerprint value.");
    } else {
      hash.update(`${typeof value}:${String(value)};`);
    }
  };
  visit(scene);
  return hash.digest("hex");
}
