import type { NativeGlyphPathCommand, NativeGlyphPostScriptPaint } from "./nativeFont";
import type { DensePdfExtGStateDefinition } from "./nativeContentCompiler";
import { PdfError, throwIfAborted } from "./nativeTypes";

/** Lower font-local imaging to the same retained path compiler as PDF content.
 * Paths are already in normalized glyph coordinates. A stroke's matrix is
 * installed after constructing its path, preserving the independent pen CTM.
 */
export function serializeNativeGlyphPostScriptPaints(
  paints: readonly NativeGlyphPostScriptPaint[],
  inheritedAlpha: number,
  signal?: AbortSignal
): {
  readonly bytes: Uint8Array;
  readonly extGStates: ReadonlyMap<string, DensePdfExtGStateDefinition>;
  readonly inheritsPaint: boolean;
} {
  const tokens: string[] = [];
  const extGStates = new Map<string, DensePdfExtGStateDefinition>();
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
    if (paint.color) {
      tokens.push(`${paint.color.slice(0, 3).map(number).join(" ")} ${paint.kind === "stroke" ? "RG" : "rg"}`);
      if (paint.color[3] !== 1) {
        const resourceName = `PSAlpha${extGStates.size}`;
        const alpha = inheritedAlpha * paint.color[3];
        extGStates.set(resourceName, { resourceName, fillAlpha: alpha, strokeAlpha: alpha });
        tokens.push(`/${resourceName} gs`);
      }
    } else inheritsPaint = true;
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
  return Object.freeze({ bytes: new TextEncoder().encode(tokens.join("\n")), extGStates, inheritsPaint });
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
