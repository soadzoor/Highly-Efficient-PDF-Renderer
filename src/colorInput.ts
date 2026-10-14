import { CSS_NAMED_COLORS } from "./cssNamedColors";

/** DOM-free sRGB input shared by primitive overrides and thumbnails. */
export type PrimitiveColorInput = string | number | readonly [number, number, number];

export function normalizePrimitiveColor(input: PrimitiveColorInput): [number, number, number] {
  if (Array.isArray(input)) {
    if (input.length !== 3 || !input.every(Number.isFinite)) throw new TypeError("Invalid primitive color channels.");
    return input.map(value => Math.max(0, Math.min(1, value))) as [number, number, number];
  }
  let packed: number;
  if (typeof input === "number") packed = input;
  else if (typeof input === "string") {
    const value = input.trim().toLowerCase();
    if (/^#[\da-f]{3}$/.test(value)) packed = parseInt(value.slice(1).split("").map(c => c + c).join(""), 16);
    else if (/^#?[\da-f]{6}$/.test(value)) packed = parseInt(value.replace(/^#/, ""), 16);
    else if (Object.hasOwn(CSS_NAMED_COLORS, value)) packed = CSS_NAMED_COLORS[value];
    else throw new TypeError(`Unsupported primitive color: ${input}`);
  } else throw new TypeError("Invalid primitive color.");
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffff) throw new TypeError("Invalid primitive color number.");
  return [(packed >>> 16) / 255, ((packed >>> 8) & 255) / 255, (packed & 255) / 255];
}
