/** Paper dimensions use PDF points (72 points per inch). */
export interface PdfPageDimensions { readonly width: number; readonly height: number }
export type PdfPageOrientation = "portrait" | "landscape";

const millimeters = (width: number, height: number): PdfPageDimensions => Object.freeze({ width: width * 72 / 25.4, height: height * 72 / 25.4 });
export const PDF_PAGE_SIZE_PRESETS = Object.freeze({
  A0: millimeters(841, 1189), A1: millimeters(594, 841), A2: millimeters(420, 594),
  A3: millimeters(297, 420), A4: millimeters(210, 297), A5: millimeters(148, 210), A6: millimeters(105, 148),
  Letter: Object.freeze({ width: 612, height: 792 }), Legal: Object.freeze({ width: 612, height: 1008 }),
  Tabloid: Object.freeze({ width: 792, height: 1224 }), Executive: Object.freeze({ width: 522, height: 756 })
});
export type PdfPageSizePreset = keyof typeof PDF_PAGE_SIZE_PRESETS;
export type PdfPageSize = PdfPageSizePreset | PdfPageDimensions;

/** Reject dimensions that cannot remain positive finite coordinates in a scene. */
export function validatePdfPageDimensions(width: number, height: number): PdfPageDimensions {
  if (![width, height].every(value => typeof value === "number" && Number.isFinite(value) && value > 0 &&
    Number.isFinite(Math.fround(value)) && Math.fround(value) > 0)) throw new RangeError("Page width and height must be positive finite dimensions representable in PDF points.");
  return { width, height };
}

/** Custom dimensions retain their orientation unless one is explicitly requested. */
export function resolvePdfPageSize(size: PdfPageSize = "A4", orientation?: PdfPageOrientation): PdfPageDimensions {
  if (orientation !== undefined && orientation !== "portrait" && orientation !== "landscape") throw new TypeError("Page orientation must be portrait or landscape.");
  const dimensions = typeof size === "string" ? Object.hasOwn(PDF_PAGE_SIZE_PRESETS, size) ? PDF_PAGE_SIZE_PRESETS[size] : undefined : size;
  if (!dimensions || typeof dimensions !== "object") throw new TypeError("Unknown page size. Choose a paper preset or provide width and height in points.");
  const { width, height } = validatePdfPageDimensions(dimensions.width, dimensions.height);
  return orientation === "portrait" ? { width: Math.min(width, height), height: Math.max(width, height) }
    : orientation === "landscape" ? { width: Math.max(width, height), height: Math.min(width, height) } : { width, height };
}
