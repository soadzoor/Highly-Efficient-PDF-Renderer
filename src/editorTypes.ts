import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveRef } from "./scenePrimitives";
import type { HepEncodingOptions } from "./hepBuilder";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { LoadProgressCallback } from "./loadProgress";
import type { PdfOutputProtection } from "./pdf/pdfProtection";
import type { PdfPageCropBox } from "./editorPdfPages";
import type { OptionalContentGroup, OptionalContentOrderNode, SceneOptionalContent } from "./optionalContentData";
import type { AnnotationDestination } from "./annotationData";
export type { PdfOutputProtection } from "./pdf/pdfProtection";

/** Affine [a,b,c,d,e,f], with X right and Y up. */
export type EditorMatrix = readonly [number, number, number, number, number, number];
export interface EditorSelectionFrame {
  /** Rectangle in the frame's local axes, before transform. */
  bounds: Bounds;
  /** Frame coordinates to composed scene coordinates. Retains shear/reflection. */
  transform: EditorMatrix;
  /** Present when every selected object belongs to the same page. */
  pageIndex?: number;
}
export type EditorColor = string | number | readonly [number, number, number];
export type EditorFieldValue = string | number | boolean | null | readonly string[];
/** Links are inert descriptions. Only ordinary web/contact URIs and local destinations are authored. */
export type EditorLink = { type: "url"; url: string } | { type: "object"; objectId: string }
  | { type: "destination"; destination: AnnotationDestination };

export interface EditorObjectBase {
  id: string;
  pageIndex: number;
  /** Local page coordinates, before transform. Page origin is the displayed lower left. */
  transform: EditorMatrix;
  opacity?: number;
  /** Editing lock; independent from PDF layer visibility locks. */
  locked?: boolean;
  /** Clickable reference independent of this object's visual appearance. */
  link?: EditorLink;
  /** User PDF layer; null is unlayered. Omitted source clones retain source membership. */
  layerId?: string | null;
  /** Exact compound layer membership, indexed in getLayerEdits().catalog.conditions. */
  layerCondition?: number;
}
export interface EditorLayerCreateOptions {
  name: string;
  defaultVisible?: boolean;
  locked?: boolean;
  parentId?: string | null;
  index?: number;
}
export interface EditorLayerEdits {
  catalog: SceneOptionalContent;
  catalogChanged: boolean;
  /** An explicit layer move/order operation also requests visual restacking. */
  stackingChanged: boolean;
  /** Explicit object ordering is independent of PDF layer-list ordering. */
  objectOrderChanged?: boolean;
  /** Transient back-to-front owner identities, baked into ordinary saved paint order. */
  objectOrder?: readonly string[];
  /** Ordered removals retain retargeting dependencies across successive edits. */
  removals: readonly { id: string; targetLayerId: string | null }[];
  removedLayerIds: readonly string[];
  sourceAssignments: readonly { ref: PrimitiveRef; layerId: string | null }[];
  annotationAssignments: readonly { id: string; layerId: string | null }[];
}
export interface EditorTextObject extends EditorObjectBase {
  kind: "text";
  x: number; y: number; width: number; height: number;
  text: string;
  runs?: readonly EditorTextRun[];
  fontFamily?: string;
  fontId?: string;
  fontSize: number;
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic" | "oblique";
  underline?: boolean;
  strikethrough?: boolean;
  color?: EditorColor;
  align?: "left" | "center" | "right";
  lineHeight?: number;
}
export interface EditorTextRun {
  text: string;
  fontFamily?: string;
  fontId?: string;
  fontSize?: number;
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic" | "oblique";
  underline?: boolean;
  strikethrough?: boolean;
  color?: EditorColor;
}
/** PDF text-markup order: top-left, top-right, bottom-left, bottom-right. */
export type EditorReviewQuad = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
export interface EditorReviewMetadata {
  type: "highlight" | "underline" | "strikeout" | "comment";
  contents?: string;
  author?: string;
  quads?: readonly EditorReviewQuad[];
}
export interface EditorShapeObject extends EditorObjectBase {
  kind: "shape";
  shape: "rectangle" | "ellipse" | "line" | "arrow" | "polygon" | "polyline";
  x: number; y: number; width: number; height: number;
  points?: readonly (readonly [number, number])[];
  color?: EditorColor;
  fill?: EditorColor | null;
  /** Independent fill alpha; omission retains the legacy object-opacity fallback. */
  fillOpacity?: number;
  strokeWidth?: number;
  /** Standard review-annotation semantics; geometry remains ordinary scene paths. */
  review?: EditorReviewMetadata;
}
interface EditorInkData extends EditorObjectBase {
  paths: readonly (readonly (readonly [number, number])[])[];
  /** Maximum centerline deviation in local page units. Zero preserves captured polylines. */
  smoothing?: number;
  color?: EditorColor;
  fill?: EditorColor | null;
  /** Independent fill alpha; omission retains the legacy object-opacity fallback. */
  fillOpacity?: number;
  strokeWidth?: number;
}
export type EditorInkObject = EditorInkData & ({ kind: "ink" } | { kind: "signature" });
export interface EditorImageObject extends EditorObjectBase {
  kind: "image";
  x: number; y: number; width: number; height: number;
  imageWidth: number; imageHeight: number;
  /** Canonical RGBA pixels. Callers retain ownership; the session copies on insertion. */
  data: Uint8Array;
}
export interface EditorSourceObject extends EditorObjectBase {
  kind: "source";
  /** A new in-session copy; original source objects omit this flag. */
  isClone?: boolean;
  primitives: readonly PrimitiveRef[];
  /** Bounds in original composed scene coordinates. */
  bounds: Bounds;
  annotationId?: string;
}
/** Child transforms already include group operations; transform retains the group's selection axes. */
export interface EditorGroupObject extends EditorObjectBase { kind: "group"; children: readonly string[] }
export type EditorObject = EditorTextObject | EditorShapeObject | EditorInkObject | EditorImageObject | EditorSourceObject | EditorGroupObject;
export interface EditorSourceEdit { ref: PrimitiveRef; transform: EditorMatrix; deleted: boolean }
export interface EditorAnnotationEdit { id: string; transform: EditorMatrix; deleted: boolean; contents?: string; author?: string }
export type EditorObjectInput = EditorObject extends infer T ? T extends EditorObject
  ? Omit<T, "id" | "transform"> & { id?: string; transform?: EditorMatrix } : never : never;

export interface EditorPdfSaveOptions {
  signal?: AbortSignal;
  onProgress?: LoadProgressCallback;
  /** Compatibility output with all form/annotation appearances baked into content. */
  flatten?: boolean;
  /** Preserve source encryption by default, remove it, or set a new opening password. */
  protection?: PdfOutputProtection;
  onWarning?: (message: string) => void;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  /** Serialization alone need not mark the live document saved. @default true */
  markSaved?: boolean;
}
export interface EditorHepSaveOptions extends HepEncodingOptions {
  /** Serialization alone need not mark the live document saved. @default true */
  markSaved?: boolean;
}
export interface EditorRecoveryFont {
  id: string; family: string; fontWeight: number; fontStyle: "normal" | "italic"; bytes: Uint8Array;
}
/** Private, versioned browser draft. Never embedded in PDF or HEP files. */
export interface EditorRecoverySnapshot {
  format: "hepr-editor-recovery";
  version: 1;
  sourceScene: VectorScene;
  sourcePdf?: Uint8Array;
  sourceLabel?: string;
  fonts: readonly EditorRecoveryFont[];
  /** Runtime state is opaque and validated atomically by restoreRecovery. */
  data: unknown;
}
export interface EditorRecoveryOptions { signal?: AbortSignal }
export interface EditorPageInfo {
  /** Zero-based position in the current document. */
  index: number;
  width: number;
  height: number;
  /** Clockwise rotation in degrees, normalized to 0, 90, 180 or 270. */
  rotation: number;
}
export interface EditorPageOperationOptions {
  signal?: AbortSignal;
  onProgress?: LoadProgressCallback;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}
export interface EditorPdfInsertOptions extends EditorPageOperationOptions {
  /** Insert before this zero-based page position; defaults to the end. */
  at?: number;
  /** Source page indexes, in insertion order; defaults to every source page. */
  pages?: readonly number[];
  /** Opening password for the inserted PDF. */
  password?: string;
}
export interface EditorPageDuplicateOptions extends EditorPageOperationOptions { at?: number }
export interface EditorSessionOptions {
  sourcePdf?: Uint8Array;
  signal?: AbortSignal;
  password?: string;
  loadFontAsset?: (url: URL) => Promise<Uint8Array>;
  /** Optional metadata preparation performed only when entering the editor. */
  prepareScene?: (scene: VectorScene, signal?: AbortSignal) => Promise<VectorScene>;
  sourceLabel?: string;
  /** Text compilation uses the application's portable font registry. Returns page-local geometry. */
  compileObject?: (object: EditorObject, signal?: AbortSignal) => Promise<VectorScene>;
  savePdf?: (scene: VectorScene, session: EditorSession, options: EditorPdfSaveOptions) => Promise<Blob>;
  /** Replace field appearances in canonical scene coordinates before overlay composition. */
  compileFields?: (scene: VectorScene, values: ReadonlyMap<string, EditorFieldValue>, signal?: AbortSignal) => Promise<VectorScene>;
  /** Rebind source-specific services after a page operation, retaining shared fonts. */
  createSourceOptions?: (sourcePdf: Uint8Array, password?: string) => Promise<EditorSessionOptions>;
  /** Release source-specific services owned by this session; shared fonts remain host-owned. */
  disposeSource?: () => void;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  /** Portable authoring fonts for recovery; font programs remain outside HEP. */
  captureRecoveryFonts?: () => Promise<readonly EditorRecoveryFont[]>;
  restoreRecoveryFonts?: (fonts: readonly EditorRecoveryFont[], signal?: AbortSignal) => Promise<void>;
}
export interface EditorState {
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selection: readonly string[];
  previewing: boolean;
}
export type EditorStackingAction = "send-to-back" | "bring-to-front" | "bring-forward" | "send-backward";
export interface EditorClipboardOptions { signal?: AbortSignal }
export interface EditorDuplicateOptions extends EditorClipboardOptions { offset?: readonly [number, number] }
export interface EditorPasteOptions {
  /** Composed scene offset; defaults to successive 12/-12 steps for copy, zero for cut. */
  offset?: readonly [number, number];
}

export interface EditorSession {
  readonly sourceScene: VectorScene;
  readonly sourcePdf?: Uint8Array;
  readonly revision: number;
  getState(): EditorState;
  /** Source primitives are materialized only when explicitly requested or selected. */
  getObjects(options?: { pageIndex?: number; includeSource?: boolean }): readonly EditorObject[];
  getObject(id: string): EditorObject;
  isObjectLocked(id: string): boolean;
  /** Undoable editing locks; unlocking remains available on locked selections. */
  setObjectsLocked(ids: readonly string[], locked: boolean): void;
  getObjectLink(id: string): EditorLink | null;
  /** Set or remove a link without changing the object's appearance. Undoable. */
  setObjectLink(id: string, link: EditorLink | null): void;
  getObjectBounds(id: string): Bounds;
  getSelection(): readonly string[];
  getSelectionBounds(): Bounds | null;
  /** Committed oriented frame. Apply a gesture preview separately when drawing it. */
  getSelectionFrame(): EditorSelectionFrame | null;
  select(ids: readonly string[], options?: { additive?: boolean; toggle?: boolean }): void;
  selectPrimitives(refs: readonly PrimitiveRef[], options?: { additive?: boolean }): void;
  selectAnnotations(ids: readonly string[], options?: { additive?: boolean; toggle?: boolean }): void;
  selectArea(bounds: Bounds, options?: { additive?: boolean; intersects?: boolean; pageIndex?: number }): void;
  addObject(object: EditorObjectInput): string;
  updateObject(id: string, patch: Partial<EditorObject>): void;
  /** Matrix is a delta in composed scene coordinates, about the caller's chosen pivot. */
  transformSelection(matrix: EditorMatrix): void;
  /** Ephemeral gesture placement; does not enter undo history or saved output. */
  setPreviewTransform(matrix: EditorMatrix | null): void;
  deleteSelection(): void;
  cloneSelection(offset?: readonly [number, number]): readonly string[];
  /** Duplicate current source appearances without replacing the clipboard. */
  duplicateSelection(options?: EditorDuplicateOptions): Promise<readonly string[]>;
  /** Capture independent author models and current source appearances without changing history. */
  copySelection(options?: EditorClipboardOptions): Promise<number>;
  /** Capture successfully before deleting the selected objects as one undoable edit. */
  cutSelection(options?: EditorClipboardOptions): Promise<number>;
  canPaste(): boolean;
  /** Paste independent copies into the active layer, retaining their original pages. */
  pasteSelection(options?: EditorPasteOptions): readonly string[];
  groupSelection(): string | null;
  ungroupSelection(): void;
  setFieldValue(name: string, value: EditorFieldValue): void;
  getFieldValues(): ReadonlyMap<string, EditorFieldValue>;
  getSourceEdits(): readonly EditorSourceEdit[];
  getAnnotationEdits(): readonly EditorAnnotationEdit[];
  /** Edit inert annotation discussion metadata without replacing its appearance. */
  updateAnnotation(id: string, patch: { contents?: string; author?: string }): void;
  getLayers(): readonly OptionalContentGroup[];
  getLayerOrder(): readonly OptionalContentOrderNode[];
  createLayer(options: EditorLayerCreateOptions): string;
  updateLayer(id: string, patch: { name?: string; defaultVisible?: boolean; locked?: boolean }): void;
  moveLayer(id: string, position: { parentId?: string | null; index: number }): void;
  setLayerOrder(order: readonly OptionalContentOrderNode[]): void;
  canReorderSelection(action: EditorStackingAction): boolean;
  reorderSelection(action: EditorStackingAction): void;
  /** Remove the layer while retaining its content, optionally on another layer. */
  removeLayer(id: string, options?: { targetLayerId?: string | null }): void;
  getActiveLayer(): string | null;
  /** Creation preference; does not change document history or dirty state. */
  setActiveLayer(id: string | null): void;
  getObjectLayerIds(id: string): readonly string[];
  getObjectLayerCondition(id: string): { catalog: SceneOptionalContent; condition?: number };
  /** Copy exact annotation/authored membership, including compound and negated PDF layers. */
  copyObjectLayerMembership(sourceId: string, targetId: string): void;
  assignObjectsToLayer(ids: readonly string[], layerId: string | null): void;
  assignSelectionToLayer(layerId: string | null): void;
  getLayerObjects(id: string): readonly string[];
  selectLayerContents(id: string): void;
  getLayerEdits(): EditorLayerEdits;
  getObjectLayerEdits(id: string): EditorLayerEdits;
  getLayerRevision(): number;
  isObjectVisible(id: string): boolean;
  isPrimitiveVisible(ref: PrimitiveRef): boolean;
  isAnnotationVisible(id: string): boolean;
  getPrimitivePaintRank(ref: PrimitiveRef): number;
  getObjectPaintRank(id: string): number;
  getPages(): readonly EditorPageInfo[];
  rotatePages(indices: readonly number[], degrees: number, options?: EditorPageOperationOptions): Promise<void>;
  removePages(indices: readonly number[], options?: EditorPageOperationOptions): Promise<void>;
  insertPdf(bytes: Uint8Array, options?: EditorPdfInsertOptions): Promise<void>;
  reorderPages(order: readonly number[], options?: EditorPageOperationOptions): Promise<void>;
  duplicatePages(indices: readonly number[], options?: EditorPageDuplicateOptions): Promise<void>;
  cropPages(indices: readonly number[], box: PdfPageCropBox | null, options?: EditorPageOperationOptions): Promise<void>;
  extractPages(indices: readonly number[], options?: EditorPageOperationOptions): Promise<Blob>;
  transaction(label: string, operation: () => void): void;
  undo(): boolean;
  redo(): boolean;
  markSaved(): void;
  subscribe(listener: (state: EditorState) => void): () => void;
  getScene(options?: { signal?: AbortSignal; onProgress?: LoadProgressCallback; preview?: boolean; includeObjects?: boolean }): Promise<VectorScene>;
  savePdf(options?: EditorPdfSaveOptions): Promise<Blob>;
  saveHep(options?: EditorHepSaveOptions): Promise<Blob>;
  captureRecovery(options?: EditorRecoveryOptions): Promise<EditorRecoverySnapshot>;
  restoreRecovery(snapshot: EditorRecoverySnapshot, options?: EditorRecoveryOptions): Promise<void>;
  dispose(): void;
}
