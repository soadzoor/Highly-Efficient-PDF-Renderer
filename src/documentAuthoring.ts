import { normalizePrimitiveColor, type PrimitiveColorInput } from "./colorInput";
import type { PdfDiagnostic } from "./pdf/nativeTypes";

export interface PageNumberingSettings {
  enabled: boolean;
  skipFirstPage: boolean;
  startNumber: number;
  format: "number" | "page" | "page-of-total";
  position: "header" | "footer";
  align: "left" | "center" | "right";
  /** Insets from the displayed page edges, in PDF points. */
  marginX: number;
  marginY: number;
  fontFamily: "Liberation Sans" | "Liberation Serif" | "Liberation Mono";
  fontSize: number;
  color: PrimitiveColorInput;
}

/** Optional portable authoring hints; all visible content remains ordinary PDF paint. */
export interface DocumentAuthoringData {
  version: 1;
  id: string;
  pageNumbering: PageNumberingSettings;
  title?: string;
  /** The original source was created locally, so recovery needs no external file. */
  created?: true;
}

export const DEFAULT_PAGE_NUMBERING: Readonly<PageNumberingSettings> = Object.freeze({
  enabled: false, skipFirstPage: false, startNumber: 1, format: "number", position: "footer", align: "center",
  marginX: 72 / 25.4 * 10, marginY: 72 / 25.4 * 10, fontFamily: "Liberation Sans", fontSize: 10, color: "#000000"
});

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function normalizePageNumbering(settings: Partial<PageNumberingSettings> = {}): PageNumberingSettings {
  if (!record(settings)) throw new TypeError("Page numbering settings must be an object.");
  const result = { ...DEFAULT_PAGE_NUMBERING, ...settings };
  if (typeof result.enabled !== "boolean" || typeof result.skipFirstPage !== "boolean" ||
      !Number.isSafeInteger(result.startNumber) || result.startNumber < 1 ||
      !["number", "page", "page-of-total"].includes(result.format) || !["header", "footer"].includes(result.position) ||
      !["left", "center", "right"].includes(result.align) ||
      !["Liberation Sans", "Liberation Serif", "Liberation Mono"].includes(result.fontFamily)) throw new TypeError("Invalid page numbering settings.");
  for (const value of [result.marginX, result.marginY, result.fontSize]) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)) || value < 0) throw new RangeError("Page numbering dimensions must be finite and nonnegative.");
  }
  if (result.fontSize <= 0) throw new RangeError("Page number font size must be positive.");
  normalizePrimitiveColor(result.color);
  if (Array.isArray(result.color)) result.color = [...result.color] as [number, number, number];
  return result;
}

export function validateDocumentAuthoring(value: unknown): asserts value is DocumentAuthoringData {
  if (!record(value) || value.version !== 1 || typeof value.id !== "string" || !value.id.trim() ||
      value.title !== undefined && typeof value.title !== "string" || value.created !== undefined && value.created !== true ||
      !record(value.pageNumbering)) throw new TypeError("Invalid document authoring metadata.");
  normalizePageNumbering(value.pageNumbering);
}

/** Malformed optional hints never prevent the document's visible content from opening. */
export function parseDocumentAuthoring(value: unknown, onDiagnostic?: (diagnostic: PdfDiagnostic) => void): DocumentAuthoringData | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    validateDocumentAuthoring(value);
    return { version: 1, id: value.id, pageNumbering: normalizePageNumbering(value.pageNumbering),
      ...(value.title === undefined ? {} : { title: value.title }), ...(value.created ? { created: true } : {}) };
  } catch {
    onDiagnostic?.({ code: "authoring.invalid-metadata", severity: "warning", message: "Invalid optional document authoring metadata was ignored; the document remains visible." });
    return undefined;
  }
}

export function createDocumentAuthoring(pageNumbering: Partial<PageNumberingSettings> = {}, title?: string): DocumentAuthoringData {
  if (title !== undefined && typeof title !== "string") throw new TypeError("Document title must be text.");
  return { version: 1, id: crypto.randomUUID(), pageNumbering: normalizePageNumbering(pageNumbering), created: true,
    ...(title === undefined ? {} : { title }) };
}
