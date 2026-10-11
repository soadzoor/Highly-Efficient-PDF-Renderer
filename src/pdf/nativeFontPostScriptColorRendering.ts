import { PdfError } from "./nativeTypes";
import type { NativeFontPostScriptValue as Value, NativeFontPostScriptProcedure as Procedure } from "./nativeFontPostScript";
import type { NativeFontPostScriptConvertedColor } from "./nativeFontPostScriptColor";

export interface NativeFontPostScriptColorRenderingOptions {
  readonly read: (value: Value) => void;
  readonly call: (procedure: Procedure, values: readonly Value[], outputs: number) => readonly number[];
  readonly notice: (code: string, message: string) => void;
}
export interface NativeFontPostScriptColorRendering {
  convert(xyz: readonly number[], sourceWhite: readonly number[], sourceBlack: readonly number[]): NativeFontPostScriptConvertedColor;
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const unitRange = [0, 1, 0, 1, 0, 1] as const;
const isProcedure = (value: Value | undefined): value is Procedure => !!value && typeof value === "object" && "kind" in value && value.kind === "procedure";

/** PLRM 7.1.2, table 7.1. Procedures are executed by the owning VM, so
 * cancellation, access checks and caller operation limits remain shared. */
export function parseNativeFontPostScriptColorRendering(value: Value, options: NativeFontPostScriptColorRenderingOptions): NativeFontPostScriptColorRendering {
  if (!(value instanceof Map)) throw error("A PostScript color rendering requires a dictionary.", "typecheck");
  options.read(value);
  if (value.get("ColorRenderingType") !== 1) throw error("Only standard PostScript ColorRenderingType 1 is available.", "rangecheck");
  const array = (value: Value | undefined): readonly Value[] => {
    if (value === undefined) throw error("A required PostScript color-rendering parameter is missing.", "undefined");
    options.read(value);
    if (Array.isArray(value)) return value;
    if (isProcedure(value)) return value.tokens;
    throw error("A PostScript color-rendering parameter requires an array.", "typecheck");
  };
  const numbers = (value: Value | undefined, fallback: readonly number[]): readonly number[] => {
    if (value === undefined) return fallback;
    const result = array(value).map(number);
    if (result.length !== fallback.length) throw error("A PostScript color-rendering parameter has the wrong length.", "rangecheck");
    return result;
  };
  const ranges = (value: Value | undefined): readonly number[] => {
    const result = numbers(value, unitRange);
    for (let i = 0; i < 3; i++) if (result[2 * i] > result[2 * i + 1]) throw error("A PostScript color-rendering range is reversed.", "rangecheck");
    return result;
  };
  const procedures = (value: Value | undefined, required = false): readonly (Procedure | undefined)[] => {
    if (value === undefined && !required) return [undefined, undefined, undefined];
    const result = array(value);
    if (result.length !== 3) throw error("A PostScript color-rendering procedure array has the wrong length.", "rangecheck");
    return result.map(item => {
      if (!isProcedure(item)) throw error("A PostScript color-rendering transform requires a procedure.", "typecheck");
      return item;
    });
  };
  const white = numbers(value.get("WhitePoint"), [NaN, NaN, NaN]), black = numbers(value.get("BlackPoint"), [0, 0, 0]);
  if (white[0] <= 0 || white[1] !== 1 || white[2] <= 0 || white.some(x => !Number.isFinite(x)) || black.some(x => x < 0)) throw error("Invalid PostScript color-rendering white or black point.", "rangecheck");
  const matrixPqr = numbers(value.get("MatrixPQR"), identity), rangePqr = ranges(value.get("RangePQR")), transformPqr = procedures(value.get("TransformPQR"), true);
  const matrixLmn = numbers(value.get("MatrixLMN"), identity), encodeLmn = procedures(value.get("EncodeLMN")), rangeLmn = ranges(value.get("RangeLMN"));
  const matrixAbc = numbers(value.get("MatrixABC"), identity), encodeAbc = procedures(value.get("EncodeABC")), rangeAbc = ranges(value.get("RangeABC"));
  const tableValue = value.get("RenderTable");
  let table: { sizes: readonly number[]; rows: readonly Uint8Array[]; channels: number; transforms: readonly Procedure[] } | undefined;
  if (tableValue !== undefined) {
    const entries = array(tableValue), sizes = entries.slice(0, 3).map(number), channels = number(entries[4]);
    if (sizes.length !== 3 || sizes.some(x => !Number.isSafeInteger(x) || x <= 1) || (channels !== 3 && channels !== 4) || entries.length !== 5 + channels || !Number.isSafeInteger(channels * sizes[1] * sizes[2])) throw error("Invalid PostScript color-rendering lookup dimensions.", "rangecheck");
    const sourceRows = array(entries[3]);
    if (sourceRows.length !== sizes[0]) throw error("The PostScript color-rendering lookup has the wrong outer dimension.", "rangecheck");
    const rows = sourceRows.map(row => {
      if (!(row instanceof Uint8Array)) throw error("A PostScript color-rendering lookup row requires a string.", "typecheck");
      options.read(row);
      if (row.length !== channels * sizes[1] * sizes[2]) throw error("A PostScript color-rendering lookup row has the wrong length.", "rangecheck");
      return row.slice();
    });
    const transforms = entries.slice(5).map(item => {
      if (!isProcedure(item)) throw error("A PostScript color-rendering table transform requires a procedure.", "typecheck");
      return item;
    });
    table = { sizes, rows, channels, transforms };
  } else if (rangeAbc.some(x => x < 0 || x > 1)) throw error("A PostScript color-rendering RangeABC without a RenderTable must lie within zero and one.", "rangecheck");
  const encode = (values: readonly number[], procedures: readonly (Procedure | undefined)[], range: readonly number[]) => clip(values.map((x, i) => procedures[i] ? options.call(procedures[i]!, [x], 1)[0] : x), range);
  return Object.freeze({ convert(xyz: readonly number[], sourceWhite: readonly number[], sourceBlack: readonly number[]): NativeFontPostScriptConvertedColor {
    let adjusted = xyz;
    if (!equal(sourceWhite, white) || !equal(sourceBlack, black)) {
      const args = [sourceWhite, sourceBlack, white, black].map(point => [...point, ...multiply(matrixPqr, point)]);
      const pqr = multiply(matrixPqr, xyz).map((x, i) => options.call(transformPqr[i]!, [...args, x], 1)[0]);
      adjusted = multiply(invert(matrixPqr), clip(pqr, rangePqr));
    }
    const lmn = encode(multiply(matrixLmn, adjusted), encodeLmn, rangeLmn);
    const abc = encode(multiply(matrixAbc, lmn), encodeAbc, rangeAbc);
    if (!table) return { rgba: [abc[0], abc[1], abc[2], 1] };
    const coordinates = abc.map((x, i) => rangeAbc[2 * i] === rangeAbc[2 * i + 1] ? 0 : (x - rangeAbc[2 * i]) / (rangeAbc[2 * i + 1] - rangeAbc[2 * i]) * (table!.sizes[i] - 1));
    const lower = coordinates.map((x, i) => Math.min(table!.sizes[i] - 2, Math.floor(x))), fractions = coordinates.map((x, i) => x - lower[i]);
    const output = Array<number>(table.channels).fill(0);
    for (let corner = 0; corner < 8; corner++) {
      const indices = lower.map((x, i) => x + ((corner >>> i) & 1));
      const weight = fractions.reduce((x, fraction, i) => x * ((corner >>> i) & 1 ? fraction : 1 - fraction), 1);
      const row = table.rows[indices[0]], offset = table.channels * (indices[1] * table.sizes[2] + indices[2]);
      for (let i = 0; i < output.length; i++) output[i] += weight * row[offset + i] / 255;
    }
    const device = output.map((x, i) => Math.max(0, Math.min(1, options.call(table!.transforms[i], [x], 1)[0])));
    if (table.channels === 3) return { rgba: [device[0], device[1], device[2], 1] };
    options.notice("font.postscript-crd-cmyk-display-approximated", "The PostScript VM preview uses unprofiled CMYK; vector paints preserve device values for the enclosing PDF's DefaultCMYK profile. Physical printer inks and screening remain unavailable.");
    return { rgba: [1 - Math.min(1, device[0] + device[3]), 1 - Math.min(1, device[1] + device[3]), 1 - Math.min(1, device[2] + device[3]), 1],
      deviceSpace: "DeviceCMYK", deviceValues: device };
  } });
}

/** A real, inspectable Type 1 CRD for this renderer's canonical sRGB device.
 * Bradford white adaptation and a linear black-to-white contrast mapping are
 * expressed as ordinary PS procedures, including when a caller copies it. */
export function createNativeFontPostScriptDefaultColorRendering(): Map<string, Value> {
  const operator = (value: string): Value => ["v", "bd", "wd", "bs", "ws"].includes(value) ?
    { kind: "name", value, literal: false } : { kind: "operator", name: value };
  const name = (value: string): Value => ({ kind: "name", value, literal: true });
  const proc = (tokens: Value[]): Procedure => ({ kind: "procedure", tokens });
  const gamma = proc([operator("dup"), .0031308, operator("le"), proc([12.92, operator("mul")]),
    proc([1, 2.4, operator("div"), operator("exp"), 1.055, operator("mul"), .055, operator("sub")]), operator("ifelse")]);
  const transforms = [3, 4, 5].map(i => proc([5, operator("dict"), operator("begin"),
    ...["v", "bd", "wd", "bs", "ws"].flatMap(key => [name(key), operator("exch"), operator("def")]),
    operator("bd"), i, operator("get"), operator("v"), operator("bs"), i, operator("get"), operator("sub"),
    operator("wd"), i, operator("get"), operator("bd"), i, operator("get"), operator("sub"), operator("mul"),
    operator("ws"), i, operator("get"), operator("bs"), i, operator("get"), operator("sub"), operator("div"), operator("add"), operator("end")]));
  return new Map<string, Value>([["ColorRenderingType", 1], ["WhitePoint", [.95047, 1, 1.08883]], ["BlackPoint", [0, 0, 0]],
    ["MatrixPQR", [.8951, -.7502, .0389, .2664, 1.7135, -.0685, -.1614, .0367, 1.0296]],
    ["RangePQR", [-Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE]],
    ["TransformPQR", transforms], ["MatrixLMN", [3.2404542, -.969266, .0556434, -1.5371385, 1.8760108, -.2040259, -.4985314, .041556, 1.0572252]],
    ["EncodeLMN", [gamma, gamma, gamma]]]);
}
function multiply(matrix: readonly number[], values: readonly number[]): number[] {
  const result = [0, 1, 2].map(i => matrix[i] * values[0] + matrix[i + 3] * values[1] + matrix[i + 6] * values[2]);
  if (result.some(x => !Number.isFinite(x))) throw error("PostScript color rendering produced a non-finite component.", "undefinedresult");
  return result;
}
function invert(m: readonly number[]): number[] {
  const [a, d, g, b, e, h, c, f, i] = m, determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (determinant === 0 || !Number.isFinite(determinant)) throw error("The PostScript color-rendering MatrixPQR is singular.", "rangecheck");
  const result = [e * i - f * h, f * g - d * i, d * h - e * g, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d].map(x => x / determinant);
  if (result.some(x => !Number.isFinite(x))) throw error("The PostScript color-rendering MatrixPQR inverse is non-finite.", "rangecheck");
  return result;
}
function clip(values: readonly number[], range: readonly number[]): number[] { return values.map((x, i) => Math.max(range[2 * i], Math.min(range[2 * i + 1], x))); }
function equal(a: readonly number[], b: readonly number[]): boolean { return a.length === b.length && a.every((x, i) => x === b[i]); }
function number(value: Value | undefined): number { if (typeof value !== "number" || !Number.isFinite(value)) throw error("A PostScript color-rendering parameter requires a finite number.", "typecheck"); return value; }
function error(message: string, postScriptError: string): PdfError { return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", operator: "setcolorrendering", postScriptError } }); }
