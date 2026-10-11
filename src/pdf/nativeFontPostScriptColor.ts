import { PdfError } from "./nativeTypes";
import type { NativeFontPostScriptValue as Value, NativeFontPostScriptProcedure as Procedure } from "./nativeFontPostScript";
import { xyzToSrgb } from "./nativeColor";

type DeviceSpace = "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
export interface NativeFontPostScriptConvertedColor {
  readonly rgba: readonly [number, number, number, number];
  readonly deviceSpace?: DeviceSpace;
  readonly deviceValues?: readonly number[];
  readonly deviceCmyk?: readonly [number, number, number, number];
}
export interface NativeFontPostScriptColorSpace {
  readonly name: string;
  readonly components: number;
  readonly initial: readonly number[];
  normalize(values: readonly number[]): readonly number[];
  convert(values: readonly number[]): NativeFontPostScriptConvertedColor;
}
interface ColorOptions {
  readonly read: (value: Value) => void;
  readonly call: (procedure: Procedure, values: readonly number[], outputs: number) => readonly number[];
  readonly notice: (code: string, message: string) => void;
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const unitRange = (count: number): number[] => Array.from({ length: count * 2 }, (_, index) => index % 2);
const nameOf = (value: Value | undefined): string | null => value && typeof value === "object" && "kind" in value && value.kind === "name" ? value.value : null;
const isProcedure = (value: Value | undefined): value is Procedure => !!value && typeof value === "object" && "kind" in value && value.kind === "procedure";

/** PLRM 4.8: source-space decoding is independent of the display's sRGB
 * rendering. Procedures execute in the owning glyph VM, including its access,
 * cancellation and operation-budget checks. No glyph IDs or colors are guessed.
 */
export function parseNativeFontPostScriptColorSpace(value: Value, options: ColorOptions): NativeFontPostScriptColorSpace {
  const active = new Set<object>();
  const array = (value: Value | undefined): readonly Value[] => {
    if (value === undefined) throw error("A PostScript color-space array is missing.", "typecheck");
    options.read(value);
    if (Array.isArray(value)) return value;
    if (isProcedure(value)) return value.tokens;
    throw error("A PostScript color-space parameter requires an array.", "typecheck");
  };
  const numbers = (value: Value | undefined, fallback: readonly number[], count = fallback.length): readonly number[] => {
    if (value === undefined) return fallback;
    const result = array(value).map(number);
    if (result.length !== count) throw error("A PostScript color-space parameter has the wrong length.", "rangecheck");
    return Object.freeze(result);
  };
  const ranges = (value: Value | undefined, count: number): readonly number[] => {
    const result = numbers(value, unitRange(count));
    for (let i = 0; i < count; i++) if (result[2 * i] > result[2 * i + 1]) throw error("A PostScript color range is reversed.", "rangecheck");
    return result;
  };
  const procedure = (value: Value | undefined): Procedure | undefined => {
    if (value === undefined) return undefined;
    if (!isProcedure(value)) throw error("A PostScript color transform requires a procedure.", "typecheck");
    return value;
  };
  const decoders = (value: Value | undefined, count: number): readonly (Procedure | undefined)[] => {
    if (value === undefined) return Array(count).fill(undefined);
    const result = array(value).map(procedure);
    if (result.length !== count) throw error("A PostScript color decoder array has the wrong length.", "rangecheck");
    return result;
  };
  const decode = (values: readonly number[], procedures: readonly (Procedure | undefined)[]) => values.map((value, index) =>
    procedures[index] ? options.call(procedures[index]!, [value], 1)[0] : value);
  const model = (name: string, range: readonly number[], convert: (values: readonly number[]) => NativeFontPostScriptConvertedColor,
    initial = Array(range.length / 2).fill(0), round = false): NativeFontPostScriptColorSpace => {
    const normalize = (values: readonly number[]) => {
      if (values.length * 2 !== range.length) throw error("The PostScript color has the wrong component count.", "rangecheck");
      return Object.freeze(values.map((value, index) => {
        const clipped = Math.max(range[index * 2], Math.min(range[index * 2 + 1], number(value)));
        return round ? Math.round(clipped) : clipped;
      }));
    };
    return Object.freeze({ name, components: range.length / 2, initial: normalize(initial), normalize,
      convert: (values: readonly number[]) => convert(normalize(values)) });
  };
  const rejectFamily = (value: Value, forbidden: readonly string[], message: string): void => {
    const entries = nameOf(value) ? [value] : array(value);
    if (forbidden.includes(nameOf(entries[0]) ?? "")) throw error(message, "rangecheck");
  };
  const parse = (value: Value): NativeFontPostScriptColorSpace => {
    if (value && typeof value === "object") {
      if (active.has(value)) throw error("A PostScript color space refers to itself.", "rangecheck");
      active.add(value);
    }
    try {
      const entries = nameOf(value) ? [value] : array(value), name = nameOf(entries[0]);
      if (!name) throw error("A PostScript color space requires a family name.", "typecheck");
      if (["DeviceGray", "DeviceRGB", "DeviceCMYK"].includes(name)) {
        if (entries.length !== 1) throw error("A device color space has unexpected parameters.", "rangecheck");
        const count = name === "DeviceGray" ? 1 : name === "DeviceRGB" ? 3 : 4;
        return model(name, unitRange(count), values => {
          const rgb = count === 1 ? [values[0], values[0], values[0]] : count === 3 ? values :
            values.slice(0, 3).map(component => 1 - Math.min(1, component + values[3]));
          return { rgba: [rgb[0], rgb[1], rgb[2], 1], deviceSpace: name as DeviceSpace, deviceValues: values };
        }, count === 4 ? [0, 0, 0, 1] : undefined);
      }
      if (name === "Indexed") {
        if (entries.length !== 4) throw error("An Indexed color space requires four elements.", "rangecheck");
        // Check the family before descending: invalid nested Indexed arrays
        // can be arbitrarily deep without reaching a usable base space.
        rejectFamily(entries[1], ["Indexed", "Pattern"], "An Indexed base cannot be Pattern or another Indexed color space.");
        const base = parse(entries[1]), high = number(entries[2]), lookup = entries[3];
        if (base.name === "Indexed" || !Number.isInteger(high) || high < 0 || high > 4095) throw error("Invalid PostScript Indexed color space.", "rangecheck");
        if (lookup instanceof Uint8Array) {
          options.read(lookup);
          if (lookup.length !== base.components * (high + 1)) throw error("The PostScript Indexed palette has the wrong length.", "rangecheck");
          const bytes = lookup.slice();
          return model(name, [0, high], values => base.convert(Array.from(bytes.subarray(values[0] * base.components, (values[0] + 1) * base.components), value => value / 255)), undefined, true);
        }
        const transform = procedure(lookup)!;
        return model(name, [0, high], values => base.convert(options.call(transform, values, base.components)), undefined, true);
      }
      if (name === "Separation" || name === "DeviceN") {
        if (entries.length !== 4) throw error("A PostScript spot-color space requires four elements.", "rangecheck");
        const colorants = name === "Separation" ? [entries[1]] : array(entries[1]);
        const names = colorants.map(value => nameOf(value) ?? (value instanceof Uint8Array ? (options.read(value), new TextDecoder("latin1").decode(value)) : null));
        if (!names.length || names.some(name => name === null) || (name === "DeviceN" && names.some(name => name === "All" || name === "None"))) throw error("Invalid PostScript colorant names.", "rangecheck");
        rejectFamily(entries[2], ["Indexed", "Pattern", "Separation", "DeviceN"], "A spot-color alternate must be a device or CIE color space.");
        const base = parse(entries[2]), transform = procedure(entries[3])!;
        if (["Indexed", "Separation", "DeviceN"].includes(base.name)) throw error("A spot-color alternate must be a device or CIE color space.", "rangecheck");
        if (name === "Separation" && names[0] === "None") return model(name, [0, 1], () => ({ rgba: [0, 0, 0, 0], deviceSpace: "DeviceGray", deviceValues: [0], deviceCmyk: [0, 0, 0, 0] }), [1]);
        if (name === "Separation" && names[0] === "All") return model(name, [0, 1], values => ({ rgba: [1 - values[0], 1 - values[0], 1 - values[0], 1], deviceCmyk: [0, 0, 0, 0] }), [1]);
        return model(name, unitRange(names.length), values => base.convert(options.call(transform, values, base.components)), Array(names.length).fill(1));
      }
      if (["CIEBasedA", "CIEBasedABC", "CIEBasedDEF", "CIEBasedDEFG"].includes(name)) {
        if (entries.length !== 2 || !(entries[1] instanceof Map)) throw error("A PostScript CIE color space requires a parameter dictionary.", "typecheck");
        const dictionary = entries[1]; options.read(dictionary);
        const white = numbers(dictionary.get("WhitePoint"), [], 3), black = numbers(dictionary.get("BlackPoint"), [0, 0, 0]);
        if (white.length !== 3 || white[0] <= 0 || white[1] !== 1 || white[2] <= 0 || black.some(value => value < 0)) throw error("Invalid PostScript CIE white or black point.", "rangecheck");
        const scalar = name === "CIEBasedA", abcRange = ranges(dictionary.get(scalar ? "RangeA" : "RangeABC"), scalar ? 1 : 3);
        const abcDecode = scalar ? [procedure(dictionary.get("DecodeA"))] : decoders(dictionary.get("DecodeABC"), 3);
        const abcMatrix = numbers(dictionary.get(scalar ? "MatrixA" : "MatrixABC"), scalar ? [1, 1, 1] : identity);
        const lmnRange = ranges(dictionary.get("RangeLMN"), 3), lmnDecode = decoders(dictionary.get("DecodeLMN"), 3), lmnMatrix = numbers(dictionary.get("MatrixLMN"), identity);
        const clip = (values: readonly number[], range: readonly number[]) => values.map((value, index) => Math.max(range[index * 2], Math.min(range[index * 2 + 1], value)));
        const abcToRgb = (values: readonly number[]): NativeFontPostScriptConvertedColor => {
          const decoded = decode(clip(values, abcRange), abcDecode), lmn = scalar ? abcMatrix.map(value => value * decoded[0]) : multiply(abcMatrix, decoded);
          const xyz = multiply(lmnMatrix, decode(clip(lmn, lmnRange), lmnDecode));
          return { rgba: [...xyzToSrgb(xyz, white), 1] };
        };
        options.notice("font.postscript-cie-rendering-approximated", "PostScript CIE colors use the canonical sRGB display conversion; printer color-rendering dictionaries and device gamut mapping are not executed.");
        if (black.some(value => value !== 0)) options.notice("font.postscript-cie-blackpoint-approximated", "PostScript CIE source black-point compensation is unavailable in the canonical sRGB conversion.");
        if (scalar || name === "CIEBasedABC") return model(name, abcRange, abcToRgb);
        const count = name === "CIEBasedDEF" ? 3 : 4, suffix = count === 3 ? "DEF" : "DEFG", intermediate = count === 3 ? "HIJ" : "HIJK";
        const range = ranges(dictionary.get("Range" + suffix), count), procedures = decoders(dictionary.get("Decode" + suffix), count), inputRange = ranges(dictionary.get("Range" + intermediate), count);
        const table = array(dictionary.get("Table"));
        if (table.length !== count + 1) throw error("A PostScript CIE lookup table has the wrong length.", "rangecheck");
        const sizes = table.slice(0, count).map(number);
        if (sizes.some(value => !Number.isSafeInteger(value) || value <= 1) || !Number.isSafeInteger(sizes.reduce((a, b) => a * b, 3))) throw error("Invalid PostScript CIE lookup dimensions.", "rangecheck");
        const outer = array(table[count]), rows: Uint8Array[] = [];
        if (outer.length !== sizes[0]) throw error("Invalid PostScript CIE lookup outer dimension.", "rangecheck");
        const rowLength = 3 * sizes[count - 2] * sizes[count - 1];
        for (const entry of outer) {
          const strings = count === 3 ? [entry] : array(entry);
          if (count === 4 && strings.length !== sizes[1]) throw error("Invalid PostScript CIE lookup inner dimension.", "rangecheck");
          for (const string of strings) {
            if (!(string instanceof Uint8Array)) throw error("A PostScript CIE lookup row requires a string.", "typecheck");
            options.read(string);
            if (string.length !== rowLength) throw error("A PostScript CIE lookup row has the wrong length.", "rangecheck");
            rows.push(string.slice());
          }
        }
        return model(name, range, values => {
          const coordinates = clip(decode(values, procedures), inputRange).map((value, index) => {
            const low = inputRange[2 * index], high = inputRange[2 * index + 1];
            return high === low ? 0 : (value - low) / (high - low) * (sizes[index] - 1);
          });
          const lower = coordinates.map((value, index) => Math.min(sizes[index] - 2, Math.floor(value))), fractions = coordinates.map((value, index) => value - lower[index]);
          const output = [0, 0, 0];
          for (let corner = 0; corner < 2 ** count; corner++) {
            const indices = lower.map((value, index) => value + ((corner >>> index) & 1));
            const weight = fractions.reduce((value, fraction, index) => value * ((corner >>> index) & 1 ? fraction : 1 - fraction), 1);
            const row = rows[count === 3 ? indices[0] : indices[0] * sizes[1] + indices[1]], offset = 3 * (indices[count - 2] * sizes[count - 1] + indices[count - 1]);
            for (let component = 0; component < 3; component++) output[component] += weight * row[offset + component] / 255;
          }
          return abcToRgb(output.map((value, index) => abcRange[2 * index] + value * (abcRange[2 * index + 1] - abcRange[2 * index])));
        });
      }
      throw error(`PostScript color space ${name} is unavailable.`, "undefined");
    } finally { if (value && typeof value === "object") active.delete(value); }
  };
  return parse(value);
}
function multiply(matrix: readonly number[], values: readonly number[]): readonly number[] {
  return [0, 1, 2].map(row => matrix[row] * values[0] + matrix[row + 3] * values[1] + matrix[row + 6] * values[2]);
}
function number(value: Value): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw error("A PostScript color-space parameter requires a finite number.", "typecheck");
  return value;
}
function error(message: string, postScriptError: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", operator: "setcolorspace", postScriptError } });
}
