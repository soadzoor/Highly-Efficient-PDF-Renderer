import type { NativeGlyphPathCommand, NativeGlyphPostScriptPaint, NativeGlyphPostScriptImagePaint,
  NativeGlyphPostScriptPattern } from "./nativeFont";
import type { DensePdfExtGStateDefinition } from "./nativeContentCompiler";
import type { PdfStream, PdfValue } from "./nativeCos";
import { PdfError, throwIfAborted } from "./nativeTypes";

/** Lower font-local imaging to the retained PDF path and image compiler.
 * Paths are already in normalized glyph coordinates. A stroke's matrix is
 * installed after constructing its path, preserving the independent pen CTM.
 */
export function serializeNativeGlyphPostScriptPaints(
  paints: readonly NativeGlyphPostScriptPaint[],
  inheritedAlpha: number,
  signal?: AbortSignal,
  deviceColorSpaces?: ReadonlyMap<string, PdfValue>
): {
  readonly bytes: Uint8Array;
  readonly extGStates: ReadonlyMap<string, DensePdfExtGStateDefinition>;
  readonly inheritsPaint: boolean;
  readonly images: ReadonlyMap<string, NativeGlyphPostScriptImagePaint>;
  readonly patterns: ReadonlyMap<string, PdfValue>;
} {
  const tokens: string[] = [];
  const extGStates = new Map<string, DensePdfExtGStateDefinition>();
  const images = new Map<string, NativeGlyphPostScriptImagePaint>();
  const patterns = new Map<string, PdfValue>(), patternNames = new Map<NativeGlyphPostScriptPattern, string>();
  let inheritsPaint = false;
  for (const paint of paints) {
    throwIfAborted(signal);
    // An explicitly empty clipping path is the empty region.
    if (paint.clips.some(clip => clip.commands.length === 0)) continue;
    tokens.push("q");
    for (const clip of paint.clips) {
      appendPath(tokens, clip.commands, signal);
      tokens.push(clip.fillRule === 1 ? "W* n" : "W n");
    }
    if (paint.color && (paint.kind !== "image" || paint.imageMask)) {
      tokens.push(paint.deviceColor
        ? `${paint.deviceColor.values.map(number).join(" ")} ${paint.kind === "stroke" ? "K" : "k"}`
        : `${paint.color.slice(0, 3).map(number).join(" ")} ${paint.kind === "stroke" ? "RG" : "rg"}`);
      if (paint.color[3] !== 1) {
        const resourceName = `PSAlpha${extGStates.size}`;
        const alpha = inheritedAlpha * paint.color[3];
        extGStates.set(resourceName, { resourceName, fillAlpha: alpha, strokeAlpha: alpha });
        tokens.push(`/${resourceName} gs`);
      }
    } else if (paint.kind !== "image" || paint.imageMask) inheritsPaint = true;
    if (paint.pattern && (paint.kind !== "image" || paint.imageMask)) {
      let name = patternNames.get(paint.pattern);
      if (!name) {
        name = `PSPattern${patterns.size}`; patternNames.set(paint.pattern, name);
        patterns.set(name, nativeGlyphPostScriptPatternStream(paint.pattern, signal, deviceColorSpaces));
      }
      const stroke = paint.kind === "stroke", uncolored = paint.pattern.paintType === 2;
      tokens.push(`/${uncolored ? paint.deviceColor ? "PSPatternCMYK" : "PSPatternRGB" : "PSPattern"} ${stroke ? "CS" : "cs"}`,
        `${uncolored ? (paint.deviceColor?.values ?? (paint.color ?? [0, 0, 0]).slice(0, 3)).map(number).join(" ") + " " : ""}/${name} ${stroke ? "SCN" : "scn"}`);
    }
    if (paint.kind === "image") {
      const name = `PSImage${images.size}`, [a, b, c, d, e, f] = paint.transform;
      images.set(name, paint);
      // PDF images place their first source row at v=1; metadata uses row-down
      // pixel coordinates. Translate and flip that axis exactly once.
      tokens.push(`${[a * paint.width, b * paint.width, -c * paint.height, -d * paint.height,
        c * paint.height + e, d * paint.height + f].map(number).join(" ")} cm`, `/${name} Do`, "Q");
      continue;
    }
    appendPath(tokens, paint.commands, signal);
    if (paint.kind === "fill") tokens.push(paint.fillRule === 1 ? "f*" : "f");
    else {
      const stroke = paint.stroke;
      if (!stroke || stroke.transform.length !== 6) {
        throw new PdfError("invalid-object", "A font PostScript stroke has no valid pen transform.", {
          details: { reason: "font-postscript-stroke-transform" }
        });
      }
      tokens.push(`${stroke.transform.map(number).join(" ")} cm`, `${number(stroke.width)} w`,
        `${stroke.lineCap} J`, `${stroke.lineJoin} j`, `${number(stroke.miterLimit)} M`,
        `[${stroke.dashArray.map(number).join(" ")}] ${number(stroke.dashPhase)} d`, "S");
    }
    tokens.push("Q");
  }
  return Object.freeze({ bytes: new TextEncoder().encode(tokens.join("\n")), extGStates, inheritsPaint, images, patterns });
}

/** Reuse the ordinary vector pattern compiler, including its cell cache. */
function nativeGlyphPostScriptPatternStream(pattern: NativeGlyphPostScriptPattern, signal?: AbortSignal,
  deviceColorSpaces?: ReadonlyMap<string, PdfValue>): PdfValue {
  if ("shading" in pattern) return new Map<string, PdfValue>([
    ["Type", { kind: "name", value: "Pattern" }], ["PatternType", 2], ["Matrix", [...pattern.matrix]], ["Shading", pattern.shading]
  ]);
  const content = serializeNativeGlyphPostScriptPaints(pattern.paints, 1, signal, deviceColorSpaces), resources = new Map<string, PdfValue>();
  if (content.images.size) resources.set("XObject", new Map([...content.images].map(([name, image]) => [name, nativeGlyphPostScriptImageStream(image, signal)])));
  if (content.patterns.size) resources.set("Pattern", new Map(content.patterns));
  if (content.extGStates.size) resources.set("ExtGState", new Map([...content.extGStates].map(([name, state]) => [name,
    new Map<string, PdfValue>([["ca", state.fillAlpha ?? 1], ["CA", state.strokeAlpha ?? 1]])])));
  resources.set("ColorSpace", new Map<string, PdfValue>([["PSPattern", { kind: "name", value: "Pattern" }],
    ["PSPatternRGB", [{ kind: "name", value: "Pattern" }, { kind: "name", value: "DeviceRGB" }]],
    ["PSPatternCMYK", [{ kind: "name", value: "Pattern" }, { kind: "name", value: "DeviceCMYK" }]],
    ...(deviceColorSpaces?.has("DefaultCMYK") ? [["DefaultCMYK", deviceColorSpaces.get("DefaultCMYK")!] as [string, PdfValue]] : [])]));
  return { kind: "stream", bytes: content.bytes, dictionary: new Map<string, PdfValue>([
    ["Type", { kind: "name", value: "Pattern" }], ["PatternType", 1], ["PaintType", pattern.paintType], ["TilingType", pattern.tilingType],
    ["BBox", [...pattern.bbox]], ["XStep", pattern.xStep], ["YStep", pattern.yStep], ["Matrix", [...pattern.matrix]], ["Resources", resources]
  ]) };
}

/** Image XObjects reuse native PDF decoding and retained image storage. */
export function nativeGlyphPostScriptImageStream(image: NativeGlyphPostScriptImagePaint, signal?: AbortSignal): PdfStream {
  const dictionary = new Map<string, PdfValue>([
    ["Type", { kind: "name", value: "XObject" }], ["Subtype", { kind: "name", value: "Image" }],
    ["Width", image.width], ["Height", image.height], ["Interpolate", image.interpolate]
  ]);
  const pixels = image.width * image.height;
  if (image.imageMask) {
    const rowBytes = Math.ceil(image.width / 8), bytes = new Uint8Array(rowBytes * image.height);
    for (let y = 0; y < image.height; y++) {
      throwIfAborted(signal);
      for (let x = 0; x < image.width; x++) if (image.rgba[(y * image.width + x) * 4 + 3]) {
        bytes[y * rowBytes + (x >>> 3)] |= 1 << (7 - (x & 7));
      }
    }
    dictionary.set("ImageMask", true); dictionary.set("BitsPerComponent", 1); dictionary.set("Decode", [1, 0]);
    return { kind: "stream", dictionary, bytes };
  }
  const bytes = new Uint8Array(pixels * 3), alpha = new Uint8Array(pixels); let transparent = false;
  for (let i = 0; i < pixels; i++) {
    if ((i & 65535) === 0) throwIfAborted(signal);
    bytes[i * 3] = image.rgba[i * 4]; bytes[i * 3 + 1] = image.rgba[i * 4 + 1]; bytes[i * 3 + 2] = image.rgba[i * 4 + 2];
    alpha[i] = image.rgba[i * 4 + 3]; transparent ||= alpha[i] !== 255;
  }
  dictionary.set("BitsPerComponent", 8); dictionary.set("ColorSpace", { kind: "name", value: "DeviceRGB" });
  let mask = image.softMask;
  if (mask && transparent) {
    const combined = new Uint8Array(mask.data.length);
    for (let y = 0; y < mask.height; y++) {
      throwIfAborted(signal);
      for (let x = 0; x < mask.width; x++) {
        const source = Math.min(image.height - 1, Math.floor((y + .5) * image.height / mask.height)) * image.width +
          Math.min(image.width - 1, Math.floor((x + .5) * image.width / mask.width));
        combined[y * mask.width + x] = Math.round(mask.data[y * mask.width + x] * alpha[source] / 255);
      }
    }
    mask = { ...mask, data: combined };
  }
  if (mask || transparent) dictionary.set("SMask", { kind: "stream", bytes: mask?.data ?? alpha,
    dictionary: new Map<string, PdfValue>([["Type", { kind: "name", value: "XObject" }],
      ["Subtype", { kind: "name", value: "Image" }], ["Width", mask?.width ?? image.width], ["Height", mask?.height ?? image.height],
      ["BitsPerComponent", 8], ["ColorSpace", { kind: "name", value: "DeviceGray" }], ["Interpolate", mask?.interpolate ?? image.interpolate]]) });
  return { kind: "stream", dictionary, bytes };
}

function appendPath(tokens: string[], commands: readonly NativeGlyphPathCommand[], signal?: AbortSignal): void {
  let x = 0, y = 0, startX = 0, startY = 0;
  for (const command of commands) {
    throwIfAborted(signal);
    if (command.kind === "close") { tokens.push("h"); x = startX; y = startY; continue; }
    if (command.kind === "move") {
      tokens.push(`${number(command.x)} ${number(command.y)} m`); startX = command.x; startY = command.y;
    } else if (command.kind === "line") tokens.push(`${number(command.x)} ${number(command.y)} l`);
    else if (command.kind === "cubic") tokens.push(`${number(command.control1X)} ${number(command.control1Y)} ${number(command.control2X)} ${number(command.control2Y)} ${number(command.x)} ${number(command.y)} c`);
    else tokens.push(`${number(x + (command.controlX - x) * 2 / 3)} ${number(y + (command.controlY - y) * 2 / 3)} ${number(command.x + (command.controlX - command.x) * 2 / 3)} ${number(command.y + (command.controlY - command.y) * 2 / 3)} ${number(command.x)} ${number(command.y)} c`);
    x = command.x; y = command.y;
  }
}

/** PDF numeric tokens have no exponent notation. Preserve double precision. */
function number(value: number): string {
  if (!Number.isFinite(value)) throw new PdfError("invalid-object", "A font PostScript paint contains a non-finite coordinate.");
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa, exponentText] = text.toLowerCase().split("e"), exponent = Number(exponentText);
  const negative = mantissa.startsWith("-"), unsigned = negative ? mantissa.slice(1) : mantissa;
  const dot = unsigned.indexOf("."), digits = unsigned.replace(".", "");
  const point = (dot < 0 ? unsigned.length : dot) + exponent;
  const result = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length
    ? `${digits}${"0".repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return negative ? `-${result}` : result;
}
