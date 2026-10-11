import type { NativeFontPostScriptValue as Value } from "./nativeFontPostScript";
import type { PdfValue } from "./nativeCos";
import { PdfError, throwIfAborted } from "./nativeTypes";

interface ShadingOptions {
  readonly read: (value: Value) => void;
  readonly data: (value: Value) => Uint8Array;
  readonly signal?: AbortSignal;
}

/** Preserve standard function dictionaries and encoded meshes in PDF resources.
 * PLRM 4.9.3 and PDF 1.7 4.6.3 share the seven shading dictionary families.
 */
export function nativeFontPostScriptShading(value: Value, options: ShadingOptions): PdfValue {
  if (!(value instanceof Map)) throw error("PostScript shading requires a dictionary.", "typecheck");
  options.read(value);
  const type = value.get("ShadingType"), space = value.get("ColorSpace");
  if (Array.isArray(space)) options.read(space);
  const family = name(Array.isArray(space) && space.length === 1 ? space[0] : space);
  const components = family === "DeviceGray" ? 1 : family === "DeviceRGB" ? 3 : family === "DeviceCMYK" ? 4 : 0;
  if (typeof type !== "number" || !Number.isInteger(type) || type < 1 || type > 7) throw error("Invalid PostScript shading type.", "rangecheck");
  if (!components) throw error("PostScript shading currently requires a device color space.", "rangecheck");
  const active = new Set<object>();
  const convert = (source: Value): PdfValue => {
    throwIfAborted(options.signal);
    if (source === null || typeof source === "boolean" || typeof source === "number") return source;
    options.read(source);
    if (source instanceof Uint8Array) return { kind: "string", bytes: source.slice(), hex: true };
    if (name(source)) return { kind: "name", value: name(source)! };
    if (active.has(source)) throw error("A PostScript shading dictionary refers to itself.", "rangecheck");
    active.add(source);
    try {
      if (Array.isArray(source)) return source.map(convert);
      if (source instanceof Map) {
        if (source.has("FunctionType") && ![0, 2, 3].includes(source.get("FunctionType") as number)) {
          throw error("Unsupported PostScript function type.", "rangecheck");
        }
        const result = new Map<string, PdfValue>();
        for (const [key, item] of source) {
          if (key === "Function" || key === "Functions") {
            const functions = Array.isArray(item) ? item : [item];
            options.read(item);
            if (!functions.length || functions.some(fn => !(fn instanceof Map) || !fn.has("FunctionType"))) {
              throw error("PostScript shading Function requires function dictionaries.", "typecheck");
            }
          }
          if (key !== "DataSource") result.set(key, convert(item));
        }
        if (source.has("DataSource")) return { kind: "stream", dictionary: result, bytes: options.data(source.get("DataSource")!) };
        return result;
      }
      throw error("Unsupported PostScript shading parameter.", "typecheck");
    } finally { active.delete(source); }
  };
  return convert(value);
}
function name(value: Value | undefined): string | null {
  return value && typeof value === "object" && "kind" in value && value.kind === "name" ? value.value : null;
}
function error(message: string, postScriptError: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", operator: "shfill", postScriptError } });
}
