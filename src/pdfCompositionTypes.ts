import type { EditorColor, EditorMatrix, EditorTextRun } from "./editorTypes";
import type { EditorFontRegistry } from "./editorFonts";
import type { LoadProgressCallback } from "./loadProgress";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import type { PdfPathCommand } from "./pdfCompositionPath";

export type { PdfPathCommand } from "./pdfCompositionPath";
export interface PdfCompositionOptions {
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string; creator?: string; producer?: string;
    creationDate?: Date; modificationDate?: Date };
  signal?: AbortSignal;
  onProgress?: LoadProgressCallback;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  loadFontAsset?: (url: URL) => Promise<Uint8Array>;
}
export type PdfCompositionSaveOptions = Pick<PdfCompositionOptions, "signal" | "onProgress" | "onDiagnostic">;
export interface PdfCompositionRectangle { x: number; y: number; width: number; height: number }
export interface PdfCompositionPaint {
  /** Omitted/null paint is absent. Width zero explicitly requests a PDF hairline. */
  fill?: EditorColor | null;
  stroke?: EditorColor | null;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  miterLimit?: number;
  dashArray?: readonly number[];
  dashPhase?: number;
  fillRule?: "nonzero" | "evenodd";
  transform?: EditorMatrix;
}
export interface PdfCompositionTextRun extends EditorTextRun {
  /** Multiplied by the overall text opacity. */
  opacity?: number;
  backgroundOpacity?: number;
}
export interface PdfCompositionTextStyle {
  fontSize: number;
  fontId?: string;
  fontFamily?: string;
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic" | "oblique";
  color?: EditorColor;
  backgroundColor?: EditorColor | null;
  backgroundOpacity?: number;
  opacity?: number;
  underline?: boolean;
  strikethrough?: boolean;
  runs?: readonly PdfCompositionTextRun[];
  lineHeight?: number;
}
export interface PdfCompositionTextOptions extends PdfCompositionTextStyle {
  /** Baseline origin. Explicit newlines are retained; there is no automatic wrapping. */
  x: number;
  y: number;
  transform?: EditorMatrix;
}
export interface PdfCompositionTextBox extends PdfCompositionRectangle, PdfCompositionTextStyle {
  text: string;
  align?: "left" | "center" | "right";
  verticalAlignment?: "top" | "middle" | "bottom";
  transform?: EditorMatrix;
}
export interface PdfCompositionTextMetrics {
  width: number;
  height: number;
  /** Font extents in points; descent is normally negative. */
  ascent: number;
  descent: number;
}
export type PdfCompositionImageInput = { encoding: "png" | "jpeg"; bytes: Uint8Array }
  | { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
/** Immutable document-owned image identity; placements share its PDF image resource. */
export interface PdfCompositionImage { readonly id: string; readonly width: number; readonly height: number }
export interface PdfCompositionSource {
  readonly id: string;
  readonly pages: readonly { readonly width: number; readonly height: number }[];
}
export type PdfCompositionLink = { type: "url"; url: string }
  | { type: "page"; pageIndex: number; x?: number; y?: number };
export interface PdfCompositionPage {
  readonly pageIndex: number;
  /** Initial displayed dimensions; viewport cropping does not rebase drawing coordinates. */
  readonly width: number;
  readonly height: number;
  drawPath(commands: readonly PdfPathCommand[], paint: PdfCompositionPaint): void;
  /** SVG data is Y down by default; use transform to position/scale the reflected path. */
  drawSvgPath(data: string, paint: PdfCompositionPaint & { svgYAxis?: "down" | "up" }): void;
  drawRectangle(options: PdfCompositionRectangle & PdfCompositionPaint): void;
  /** x/y denote the lower-left corner of the ellipse's bounds. */
  drawEllipse(options: PdfCompositionRectangle & PdfCompositionPaint): void;
  drawText(text: string, options: PdfCompositionTextOptions): void;
  drawTextBox(options: PdfCompositionTextBox): void;
  drawImage(image: PdfCompositionImage, options: PdfCompositionRectangle & { opacity?: number; transform?: EditorMatrix }): void;
  saveState(): void;
  restoreState(): void;
  transform(matrix: EditorMatrix): void;
  clipPath(commands: readonly PdfPathCommand[], fillRule?: "nonzero" | "evenodd"): void;
  clipRectangle(rectangle: PdfCompositionRectangle): void;
  /** Independent invisible hotspot, transformed by the current graphics state. */
  addLink(rectangle: PdfCompositionRectangle, target: PdfCompositionLink): void;
  /** Update Crop/Trim/Bleed/Art boxes, keeping MediaBox and drawing coordinates fixed. */
  setViewport(rectangle: PdfCompositionRectangle): void;
}
export interface PdfDocumentComposer {
  readonly fonts: EditorFontRegistry;
  registerImage(input: PdfCompositionImageInput): Promise<PdfCompositionImage>;
  importPdf(bytes: Uint8Array, options?: { password?: string; signal?: AbortSignal }): Promise<PdfCompositionSource>;
  /** HEP callers supply the compiled scene; original PDF bytes are not present in HEP. */
  importScene(scene: VectorScene, options?: PdfCompositionSaveOptions): Promise<PdfCompositionSource>;
  addPage(size: { width: number; height: number }): PdfCompositionPage;
  addSourcePage(source: PdfCompositionSource, pageIndex: number, options?: { background?: boolean }): PdfCompositionPage;
  measureText(text: string, options: PdfCompositionTextStyle): Promise<PdfCompositionTextMetrics>;
  save(options?: PdfCompositionSaveOptions): Promise<Blob>;
  dispose(): Promise<void>;
}
