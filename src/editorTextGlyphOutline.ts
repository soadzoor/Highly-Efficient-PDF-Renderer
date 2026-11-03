import type { Font } from "harfbuzzjs";
import { pdfNumber as n } from "./editorPdfBytes";

/** Font-unit contours for glyphs whose cluster already owns their searchable text. */
export function editorTextGlyphOutline(font: Font, glyph: number, signal?: AbortSignal): string {
  signal?.throwIfAborted();
  const outline = font.glyphToJson(glyph), commands: string[] = [];
  signal?.throwIfAborted();
  let x = 0, y = 0, startX = 0, startY = 0;
  for (const command of outline) {
    signal?.throwIfAborted();
    const values = command.values;
    switch (command.type) {
      case "M":
        [x, y] = values; startX = x; startY = y;
        commands.push(`${n(x)} ${n(y)} m`);
        break;
      case "L":
        [x, y] = values;
        commands.push(`${n(x)} ${n(y)} l`);
        break;
      case "C":
        commands.push(`${values.map(n).join(" ")} c`);
        [x, y] = values.slice(4);
        break;
      case "Q": {
        const [cx, cy, endX, endY] = values;
        commands.push(`${[x + (cx - x) * 2 / 3, y + (cy - y) * 2 / 3,
          endX + (cx - endX) * 2 / 3, endY + (cy - endY) * 2 / 3, endX, endY].map(n).join(" ")} c`);
        x = endX; y = endY;
        break;
      }
      case "Z":
        commands.push("h"); x = startX; y = startY;
        break;
      default:
        throw new TypeError("Unsupported glyph outline command.");
    }
  }
  return commands.join("\n");
}
