import type { NativeFontPostScriptValue as Value } from "./nativeFontPostScript";
import type { PdfValue } from "./nativeCos";
import { PdfError, throwIfAborted } from "./nativeTypes";
import type { NativeFontPostScriptColorSpace } from "./nativeFontPostScriptColor";

interface ShadingOptions {
  readonly read: (value: Value) => void;
  readonly data: (value: Value) => Uint8Array;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly notice?: (code: string, message: string) => void;
  readonly colorModel?: (value: Value) => NativeFontPostScriptColorSpace;
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
  let components = family === "DeviceGray" ? 1 : family === "DeviceRGB" ? 3 : family === "DeviceCMYK" ? 4 : 0;
  if (typeof type !== "number" || !Number.isInteger(type) || type < 1 || type > 7) throw error("Invalid PostScript shading type.", "rangecheck");
  let colorSpace: PdfValue | undefined;
  if (!components) {
    if (!space || !options.colorModel || !["CIEBasedA", "CIEBasedABC", "CIEBasedDEF", "CIEBasedDEFG", "Separation", "DeviceN"].includes(name(Array.isArray(space) ? space[0] : space) ?? "")) throw error("Unsupported PostScript shading color space.", "rangecheck");
    const model = options.colorModel(space); components = model.components;
    if (model.range.some((value, index) => value !== index % 2)) throw error("Nonunit PostScript shading color ranges require an explicit fallback.", "rangecheck");
    colorSpace = sampledColorSpace(model, options);
  }
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
  const data = value.get("DataSource"), arrayMesh = type >= 4 && Array.isArray(data);
  const definition = colorSpace || arrayMesh ? new Map([...value].filter(([key]) =>
    !(colorSpace && key === "ColorSpace") && !(arrayMesh && key === "DataSource"))) : value;
  const converted = convert(definition);
  const dictionary = converted && typeof converted === "object" && "kind" in converted && converted.kind === "stream"
    ? converted.dictionary : converted as Map<string, PdfValue>;
  if (colorSpace) dictionary.set("ColorSpace", colorSpace);
  if (type >= 4 && Array.isArray(data)) {
    options.read(data);
    const mesh = numericMesh(data, type, value.has("Function") ? 1 : components, options);
    dictionary.set("BitsPerCoordinate", 32); dictionary.set("BitsPerComponent", 16);
    if (type !== 5) dictionary.set("BitsPerFlag", 8);
    dictionary.set("Decode", mesh.decode);
    options.notice?.("font.postscript-mesh-quantized", "Numeric PostScript meshes retain vector topology with 32-bit coordinates and 16-bit color/function samples; quantization may slightly change colors.");
    return { kind: "stream", dictionary, bytes: mesh.bytes };
  }
  return converted;
}

/** A diagnosed display approximation for PS procedures that PDF color spaces
 * cannot embed directly. Sample the source decoding and the active CRD together
 * so nonlinear conversion still happens after the shading function. */
function sampledColorSpace(model: NativeFontPostScriptColorSpace, options: ShadingOptions): PdfValue {
  if (model.components > 4) throw error("Sampling PostScript shading transforms with more than four inputs is not implemented.", "rangecheck");
  const size = model.components === 1 ? 257 : model.components === 4 ? 9 : 17;
  const first = model.convert(Array(model.components).fill(0));
  const cmyk = first.deviceSpace === "DeviceCMYK", channels = cmyk ? 4 : 3;
  const byteLength = size ** model.components * channels * 2;
  if (!Number.isSafeInteger(byteLength) || byteLength > (options.maxBytes ?? Number.MAX_SAFE_INTEGER)) throw new PdfError("resource-limit", "PostScript shading color samples exceed the configured byte allowance.");
  const bytes = new Uint8Array(byteLength), view = new DataView(bytes.buffer), inputs = Array(model.components).fill(0);
  for (let index = 0; index < size ** model.components; index++) {
    throwIfAborted(options.signal);
    let address = index;
    for (let component = 0; component < model.components; component++) { inputs[component] = address % size / (size - 1); address = Math.floor(address / size); }
    const color = index === 0 ? first : model.convert(inputs);
    if (color.rgba[3] !== 1 || (cmyk && color.deviceSpace !== "DeviceCMYK")) throw error("Transparent or changing-device PostScript shading colors require a fallback.", "rangecheck");
    const values = cmyk ? color.deviceValues! : color.rgba;
    for (let channel = 0; channel < channels; channel++) {
      if (!Number.isFinite(values[channel])) throw error("Nonfinite PostScript shading color sample.", "undefinedresult");
      view.setUint16((index * channels + channel) * 2, Math.round(Math.max(0, Math.min(1, values[channel])) * 65535));
    }
  }
  options.notice?.("font.postscript-shading-color-sampled", "PostScript CIE/spot shading transforms and the active color-rendering dictionary use a sampled color function; sharp or highly nonlinear color transitions may differ.");
  const range = Array.from({ length: channels * 2 }, (_, index) => index % 2);
  return [{ kind: "name", value: "DeviceN" }, Array.from({ length: model.components }, (_, index) => ({ kind: "name", value: `PSComponent${index}` })),
    { kind: "name", value: cmyk ? "DeviceCMYK" : "DeviceRGB" }, { kind: "stream", bytes, dictionary: new Map<string, PdfValue>([
      ["FunctionType", 0], ["Domain", [...model.range]], ["Range", range], ["Size", Array(model.components).fill(size)], ["BitsPerSample", 16]
    ]) }];
}

/** Array meshes contain real coordinates/components, not encoded integers
 * (PLRM 4.9.3). PDF meshes require integers; use 32 bits for coordinates
 * and the PDF maximum of 16 bits for components, retaining vector
 * patch/triangle topology instead of rasterizing the shading. */
function numericMesh(data: readonly Value[], type: number, components: number, options: ShadingOptions): {
  bytes: Uint8Array; decode: number[];
} {
  const ranges = Array.from({ length: 2 + components }, () => [Infinity, -Infinity]);
  let byteLength = 0;
  const walk = (visit: (value: number, channel: number) => void, flag: (value: number) => void): void => {
    let cursor = 0, first = true;
    const number = (): number => {
      const value = data[cursor++];
      if (typeof value !== "number" || !Number.isFinite(value)) throw error("A numeric PostScript mesh is truncated or has nonnumeric samples.", "rangecheck");
      return value;
    };
    while (cursor < data.length) {
      throwIfAborted(options.signal);
      const edge = type === 5 ? 0 : number();
      if (!Number.isInteger(edge) || edge < 0 || edge > (type === 4 ? 2 : 3) || (first && edge !== 0)) throw error("Invalid numeric PostScript mesh edge flag.", "rangecheck");
      if (type !== 5) flag(edge);
      const points = type <= 5 ? 1 : (type === 6 ? 12 : 16) - (edge === 0 ? 0 : 4);
      for (let point = 0; point < points; point++) { visit(number(), 0); visit(number(), 1); }
      const colors = type <= 5 ? 1 : edge === 0 ? 4 : 2;
      for (let color = 0; color < colors; color++) for (let component = 0; component < components; component++) visit(number(), 2 + component);
      first = false;
    }
  };
  walk((value, channel) => {
    ranges[channel][0] = Math.min(ranges[channel][0], value); ranges[channel][1] = Math.max(ranges[channel][1], value);
    byteLength += channel < 2 ? 4 : 2;
  }, () => { byteLength++; });
  if (!Number.isSafeInteger(byteLength) || byteLength > (options.maxBytes ?? Number.MAX_SAFE_INTEGER)) {
    throw new PdfError("resource-limit", "Numeric PostScript mesh exceeds the configured byte allowance.", { details: { reason: "font-postscript-string-byte-limit" } });
  }
  if (!byteLength || ranges.some(([low, high]) => !Number.isFinite(high - low))) throw error("Invalid numeric PostScript mesh coordinate range.", "rangecheck");
  const bytes = new Uint8Array(byteLength), view = new DataView(bytes.buffer);
  let offset = 0;
  walk((value, channel) => {
    const [low, high] = ranges[channel];
    const encoded = high === low ? 0 : Math.round((value - low) / (high - low) * (channel < 2 ? 0xffffffff : 0xffff));
    if (channel < 2) { view.setUint32(offset, encoded); offset += 4; }
    else { view.setUint16(offset, encoded); offset += 2; }
  }, value => { bytes[offset++] = value; });
  return { bytes, decode: ranges.flat() };
}
function name(value: Value | undefined): string | null {
  return value && typeof value === "object" && "kind" in value && value.kind === "name" ? value.value : null;
}
function error(message: string, postScriptError: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", operator: "shfill", postScriptError } });
}
