import "./editorUi.css";
import "./editorContextMenu.css";
import "./editorPagesUi.css";
import "./editorReviewUi.css";
import "./editorRecoveryUi.css";
import "./editorLinkUi.css";
import "./toolbarIcons.css";
import { openEditorSession } from "./editorSession";
import type { EditorColor, EditorMatrix, EditorObject, EditorObjectInput, EditorSelectionFrame, EditorSession, EditorState, EditorTextObject } from "./editorTypes";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { ScenePrimitivePicker, getSceneAnnotationRuns, type PrimitivePoint } from "./scenePrimitives";
import { createEditorAppServices } from "./editorAppServices";
import { triggerBrowserDownload, formatPdfDownloadFilename } from "./downloadUtils";
import type { EditorSignature } from "./editorSignatures";
import { showSignatureDialog } from "./editorSignatureUi";
import { editorSignaturePlacement } from "./editorSignaturePlacement";
import { findEditorPdfFormOverlaps } from "./editorPdfFormOverlap";
import { chooseEditorPdfFormExport } from "./editorPdfFormExportUi";
import { appendEditorInkSamples, editorInkCaptureTolerance } from "./editorInkCapture";
import { createEditorInkPreviewCache, editorInkPreviewTransform } from "./editorInkPreview";
import { createEditorShapePreviewCache } from "./editorShapePreview";
import { createEditorPendingDrawings, type EditorPendingDrawingFrame } from "./editorPendingDrawings";
import { commitEditorText, hasPendingEditorTextChanges, normalizeEditorTextColor, readRichTextRuns, type EditorTextDraftBaseline } from "./editorRichText";
import type { EditorFont } from "./editorFonts";
import { editorIconButton } from "./editorToolbarIcons";
import { canEditEditorField, createEditorFieldControl, createEditorFieldOptions, editorFieldDraftSignature, flushEditorFieldDrafts, hasPendingEditorFields, setEditorFieldControlValue, styleEditorFieldControl, updateEditorFieldControlAppearance, type EditorFieldControl } from "./editorFormControls";
import { createEditorFieldActivation } from "./editorFieldActivation";
import { editorBoundsClickHit, editorFieldClientGeometry, pickEditorMetadataAnnotation, transformEditorAnnotationText } from "./editorCoordinates";
import { applyEditorFillOpacity, applyEditorOpacity, applyEditorPropertyPatch, editorFillSelection, editorPropertySelection, editorStyledSelection, validateEditorOpacity } from "./editorProperties";
import { createEditorPropertyControls } from "./editorPropertyControls";
import { createEditorCameraPan } from "./editorCameraPan";
import { createEditorInteractionController } from "./editorInteraction";
import { LoadProgressReporter } from "./loadProgress";
import { createEditorPdfProtectionState, showEditorPdfPasswordDialog, type EditorPdfPasswordDialog } from "./editorPdfProtectionUi";
import { insertEditorDocumentFiles, insertEditorPdfFiles, showEditorPagesDialog, type EditorPagesDialog } from "./editorPagesUi";
import type { LoadProgressCallback } from "./loadProgress";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { editorFrameCenter, editorFrameClientGeometry, editorFrameResizeMatrix, editorFrameRotation, editorFrameRotationDragMatrix, editorFrameRotationMatrix, editorFrameScaleMatrix, editorFrameSize } from "./editorSelectionGeometry";
import { printPdfBlob } from "./pdfPrint";
import { getEditorAnnotationFrameTransform, getEditorAnnotationSource } from "./editorScene";
import { droppedFileKind } from "./documentDropFiles";
import { waitForLoad, yieldAfterPaint } from "./loadCancellation";
import type { EditorSetupProgress } from "./editorSetupLoading";
import { createEditorLayerControls } from "./editorLayerControls";
import { createEditorContextMenu, type EditorObjectMenuAction } from "./editorContextMenu";
import { alignEditorSelection, distributeEditorSelection, createEditorAlignmentSnap, type EditorAlignment, type EditorAlignmentGuide } from "./editorLayout";
import { createEditorReviewController, isEditorReviewTool, type EditorReviewTool } from "./editorReviewUi";
import { createEditorRecovery, editorRecoveryDocumentKey, type EditorRecoveryController } from "./editorRecovery";
import { showEditorRecoveryDialog } from "./editorRecoveryUi";
import { createEditorLinkController } from "./editorLinkUi";
import { editorLinkSelectionOwner } from "./editorLinks";

export interface EditorUiHost {
  getCanvas(): HTMLCanvasElement;
  getScene(): VectorScene | null;
  prepareScene(signal: AbortSignal, onProgress?: LoadProgressCallback): Promise<VectorScene>;
  /** Acknowledge the matching draw before resolving, so selection chrome can follow the submitted scene. */
  applyScene(scene: VectorScene, signal: AbortSignal, onPresented?: () => void, options?: { preview?: boolean }): void | Promise<void>;
  documentChanged?(scene: VectorScene, source: { pdf?: Uint8Array; password?: string; label: string }): void | Promise<void>;
  getSource(): { bytes?: Uint8Array; pdf?: Uint8Array; password?: string; label: string };
  clientToScenePoint(x: number, y: number, pageIndex?: number): PrimitivePoint | null;
  sceneToClientPoint(x: number, y: number, pageIndex?: number): PrimitivePoint | null;
  /** Notify synchronously after the document's draw/submission, including camera-only frames. */
  subscribeToFrames?(listener: () => void): () => void;
  /** Schedule a document frame when newly created controls need their initial placement. */
  requestFrame?(): void;
  /** Camera-only navigation uses CSS pixel drag displacement and never enters document history. */
  beginCameraPan?(): void;
  panCameraByPixels?(deltaX: number, deltaY: number): void;
  endCameraPan?(): void;
  /** Optional dock beside the canvas. Custom hosts without a dock use a dialog. */
  layerControlsContainer?: HTMLElement;
  showLayerControls?(): void;
  setEditing(active: boolean): void;
  onModeChange?(active: boolean): void;
  onStatus?(message: string): void;
  onBusyChange?(busy: boolean): void;
  onSetupProgress?(progress: EditorSetupProgress): void;
}
export interface EditorUi {
  setEditing(active: boolean, signal?: AbortSignal): Promise<void>;
  isEditing(): boolean;
  isBusy?(): boolean;
  isDirty(): boolean;
  confirmDocumentChange(): boolean;
  save(kind: "pdf" | "flatten" | "hep" | "print"): Promise<void>;
  attachDocuments(files: readonly File[], signal?: AbortSignal): Promise<void>;
  dropImages(files: readonly File[], client: { x: number; y: number }, signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

type Tool = "select" | "pan" | "form" | "text" | "rectangle" | "ellipse" | "line" | "arrow" | "polygon" | "polyline" | "ink" | "signature" | "image" | EditorReviewTool;
type EditorImageData = Omit<Extract<EditorObjectInput, { kind: "image" }>, "pageIndex" | "x" | "y" | "width" | "height">;
type EditorInkInput = Extract<EditorObjectInput, { kind: "ink" }>;
type EditorShapeInput = Extract<EditorObjectInput, { kind: "shape" }>;
type EditorDrawingInput = Extract<EditorObjectInput, { kind: "shape" | "ink" | "signature" }>;
type EditorDrawingCache = ReturnType<typeof createEditorInkPreviewCache> | ReturnType<typeof createEditorShapePreviewCache>;
type PointerGesture = { id: number; start: PrimitivePoint; startClient: PrimitivePoint; last: PrimitivePoint; points: [number, number][]; bounds: Bounds | null; frame?: EditorSelectionFrame; action: "draw" | "marquee" | "move" | "resize" | "rotate"; additive: boolean; dragging?: boolean; handle?: string; freeResize?: boolean; scaleText?: boolean; freeRotation?: boolean; ink?: EditorInkInput; shape?: EditorShapeInput };
interface PresentedScene {
  sourceScene: VectorScene;
  revision: number;
  selection: ReadonlySet<string>;
  frame: EditorSelectionFrame | null;
  delta: EditorMatrix | null;
  drawings?: EditorPendingDrawingFrame;
  guides?: readonly EditorAlignmentGuide[];
}
const IDENTITY: EditorMatrix = [1, 0, 0, 1, 0, 0];
const SVG_NS = "http://www.w3.org/2000/svg";
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const inputTarget = (target: EventTarget | null): boolean => target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const colorCss = (color: EditorColor | undefined): string => typeof color === "string" ? color :
  Array.isArray(color) ? `rgb(${color.map(c => Math.round(c * 255)).join(",")})` : "#111111";

/** Loaded only after the user explicitly enters Edit mode. */
export async function createEditorUi(host: EditorUiHost, signal?: AbortSignal): Promise<EditorUi> {
  const source = host.getSource(), lifetime = new AbortController();
  signal?.throwIfAborted();
  const abortInitialization = (): void => lifetime.abort();
  signal?.addEventListener("abort", abortInitialization, { once: true });
  let services: Awaited<ReturnType<typeof createEditorAppServices>> | undefined;
  let session: EditorSession;
  let initializedSession: EditorSession | undefined;
  try {
    host.onSetupProgress?.({ stage: "document" });
    if (host.onSetupProgress) await yieldAfterPaint(lifetime.signal);
    const scene = await host.prepareScene(lifetime.signal, host.onSetupProgress
      ? progress => { if (!lifetime.signal.aborted) host.onSetupProgress?.({ stage: "document", value: progress.value }); } : undefined);
    lifetime.signal.throwIfAborted();
    host.onSetupProgress?.({ stage: "fields" });
    if (host.onSetupProgress) await yieldAfterPaint(lifetime.signal);
    services = await createEditorAppServices({ sourcePdf: source.pdf, password: source.password,
      onPrepareProgress: host.onSetupProgress ? value => { if (!lifetime.signal.aborted) host.onSetupProgress?.({ stage: "fields", value }); } : undefined });
    lifetime.signal.throwIfAborted();
    session = await openEditorSession(scene, { ...services.sessionOptions, signal: lifetime.signal, sourcePdf: source.pdf, sourceLabel: source.label });
    initializedSession = session;
    host.onSetupProgress?.({ stage: "session" });
    if (host.onSetupProgress) await yieldAfterPaint(lifetime.signal);
  } catch (error) { lifetime.abort(); initializedSession?.dispose(); services?.dispose(); throw error; }
  finally { signal?.removeEventListener("abort", abortInitialization); }
  const editorServices = services;
  const interaction = createEditorInteractionController(session);
  const fieldActivation = createEditorFieldActivation();
  const pdfProtection = createEditorPdfProtectionState();
  let passwordDialog: EditorPdfPasswordDialog | null = null;
  let pagesDialog: EditorPagesDialog | null = null, structuralRunning = false;
  let currentSourceScene = session.sourceScene;
  let latestScene = session.sourceScene;
  let currentState = session.getState(), presented: PresentedScene | null = null;
  let pendingFieldFocus: { id: string; sourceScene: VectorScene } | null = null;
  let requestedPreview: EditorMatrix | null = null;
  let scenePreparation: AbortController | null = null, sceneApplication: Promise<void> | null = null;
  const document = host.getCanvas().ownerDocument, window = document.defaultView!;
  let active = false, disposed = false, tool: Tool = "select", toolRequest = 0, frame = 0;
  let releaseFrameListener: (() => void) | null = null;
  let objectOpacity = 1, fillOpacity = 1;
  let opacityControlSelection = "";
  let rotationDraft: { selection: readonly string[]; sourceScene: VectorScene } | null = null;
  let renderRevision = 0, operation: AbortController | null = null, running = false;
  let savePreparing = false;
  let clipboardRunning = false;
  let recovery: EditorRecoveryController | undefined, recoveryKey = "", recoveryOffered = false;
  let recoveryDialog: { close(): void } | null = null, recoveryNotice = "", exportedRevision = -1;
  let recoveryRunning = false;
  let discardRecovery = false;
  let alignmentSnap: ReturnType<typeof createEditorAlignmentSnap> = null;
  let requestedGuides: readonly EditorAlignmentGuide[] = [];
  let drawingDefaults: { color: string; opacity: number } | null = null;
  const reviewDefaults = new Map<string, { color: string; opacity: number }>();
  let previewGeneration = 0, previewQueued = false, previewRunning = false, previewPending = false;
  let picker: ScenePrimitivePicker | null = null;
  let picking: AbortController | null = null;
  const fontFaces = new Map<string, FontFace>();
  const fontFaceLoads = new Map<string, Promise<void>>();
  let signature: EditorSignature | null = null, pendingImage: EditorImageData | null = null;
  let signatureHover: PrimitivePoint | null = null;
  let activeText: { element: HTMLDivElement; objectId?: string; sourceAnnotationId?: string; layerId?: string | null; hiddenHeight?: number; pageIndex: number; x: number; y: number; width: number; height: number; transform: EditorMatrix; opacity?: number; lineHeight?: number; baseline: EditorTextDraftBaseline } | null = null;
  let draftLayerRevision = -1;
  let draftLayers = new Map<string, boolean>();
  let textRequest = 0;
  let pointer: PointerGesture | null = null;
  let pendingPick: { id: number; point: PrimitivePoint; client: PrimitivePoint; lastClient: PrimitivePoint; released: boolean; canceled: boolean } | null = null;
  let polygon: { pageIndex: number; points: [number, number][]; object: EditorShapeInput; preview: EditorShapeInput; previousPointCount?: number } | null = null;
  const toolbar = document.createElement("div"); toolbar.className = "hepr-editor-toolbar"; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "PDF editing tools");
  toolbar.innerHTML = `<div class="hepr-editor-tools">
    ${editorIconButton("tool", "select", "Select, move, resize or rotate objects")}
    ${editorIconButton("tool", "pan", "Pan the document")}
    ${editorIconButton("tool", "form", "Fill PDF form fields")}
    ${editorIconButton("tool", "text", "Add a text box")}
    ${editorIconButton("tool", "highlight", "Highlight selected text")}
    ${editorIconButton("tool", "underline-text", "Underline selected text")}
    ${editorIconButton("tool", "strikeout-text", "Strike out selected text")}
    ${editorIconButton("tool", "comment", "Add a comment")}
    ${editorIconButton("action", "edit-comment", "Edit the selected review comment")}
    ${editorIconButton("action", "link", "Add or edit a link to a URL or another object (Ctrl/Cmd+K)")}
    ${editorIconButton("action", "remove-link", "Remove links from selected objects")}
    ${editorIconButton("tool", "rectangle", "Draw a rectangle")}
    ${editorIconButton("tool", "ellipse", "Draw an ellipse")}
    ${editorIconButton("tool", "line", "Draw a line")}
    ${editorIconButton("tool", "arrow", "Draw an arrow")}
    ${editorIconButton("tool", "polygon", "Draw a polygon (double-click to finish)")}
    ${editorIconButton("tool", "polyline", "Draw a polyline (double-click to finish)")}
    ${editorIconButton("tool", "ink", "Draw with the pencil")}
    ${editorIconButton("action", "signatures", "Create or reuse a handwritten signature", 'aria-pressed="false"')}
    ${editorIconButton("action", "image", "Import an image (PNG, JPEG or WebP)")}
    ${editorIconButton("action", "undo", "Undo (Ctrl/Cmd+Z)")}
    ${editorIconButton("action", "redo", "Redo (Ctrl/Cmd+Shift+Z)")}
    ${editorIconButton("action", "copy", "Copy selected objects (Ctrl/Cmd+C)")}
    ${editorIconButton("action", "cut", "Cut selected objects (Ctrl/Cmd+X)")}
    ${editorIconButton("action", "paste", "Paste into the active layer (Ctrl/Cmd+V); Ctrl/Cmd+Shift+V pastes in place")}
    ${editorIconButton("action", "duplicate", "Duplicate selected objects")}
    ${editorIconButton("action", "delete", "Delete selected objects")}
    ${editorIconButton("action", "group", "Group selected objects")}
    ${editorIconButton("action", "ungroup", "Ungroup selected objects")}
    ${editorIconButton("action", "lock", "Lock selected objects against editing")}
    ${editorIconButton("action", "unlock", "Unlock selected objects")}
  </div><div class="hepr-editor-properties">
    <label>Color <input data-prop="color" type="color" value="#111111"></label><label class="hepr-editor-opacity">Color opacity <input data-prop="opacity" type="number" value="1" min="0" max="1" step="0.1" aria-label="Color opacity"><input data-opacity-slider="opacity" type="range" value="1" min="0" max="1" step="0.1" aria-label="Color opacity slider"></label><label>Width <input data-prop="stroke" type="number" value="2" min="0" step="any"></label>
    <label><input data-prop="fill-enabled" type="checkbox"> Fill</label><input data-prop="fill" type="color" value="#ffff00" aria-label="Fill color">
    <label class="hepr-editor-opacity">Fill opacity <input data-prop="fill-opacity" type="number" value="1" min="0" max="1" step="0.1" aria-label="Fill opacity"><input data-opacity-slider="fill-opacity" type="range" value="1" min="0" max="1" step="0.1" aria-label="Fill opacity slider"></label>
    <label>Font <select data-prop="font" aria-label="Font family"><option value="">Liberation Sans</option><option value="bundled:serif">Liberation Serif</option><option value="bundled:mono">Liberation Mono</option></select></label>${editorIconButton("action", "font", "Import a TTF or OTF font")}${editorIconButton("action", "local-fonts", "Choose installed fonts")}
    <label>Size <input data-prop="font-size" type="number" value="12" min="0.1" step="any"></label>
    <button type="button" data-style="bold" aria-pressed="false" title="Bold" aria-label="Bold"><b>B</b></button><button type="button" data-style="italic" aria-pressed="false" title="Italic" aria-label="Italic"><i>I</i></button>
    <button type="button" data-style="underline" aria-pressed="false" title="Underline" aria-label="Underline"><u>U</u></button><button type="button" data-style="strikethrough" aria-pressed="false" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
    <label>Align <select data-prop="align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    ${editorIconButton("action", "apply-text", "Apply text changes", "hidden")}${editorIconButton("action", "cancel-text", "Discard text changes", "hidden")}<span data-properties-note class="hepr-editor-property-note" role="status"></span>
  </div><div class="hepr-editor-transform">
    <span data-selection>No selection</span><label>X <input data-transform="x" type="number" step="any"></label><label>Y <input data-transform="y" type="number" step="any"></label>
    <label>W <input data-transform="width" type="number" min="0.001" step="any"></label><label>H <input data-transform="height" type="number" min="0.001" step="any"></label><label>Rotate ° <input data-transform="rotation" type="number" step="any" title="Selection angle in degrees. Drag rotation snaps within 5° of multiples of 45°, including 0°. Hold Alt/Option to disable snapping."></label>
    <label>Relative to <select data-layout-reference><option value="selection">Selection</option><option value="page">Page</option></select></label>
    ${(["left", "center", "right", "top", "middle", "bottom"] as const).map(value => editorIconButton("action", `align-${value}`, `Align ${value}`)).join("")}
    ${editorIconButton("action", "distribute-horizontal", "Distribute horizontal gaps")}${editorIconButton("action", "distribute-vertical", "Distribute vertical gaps")}
    ${editorIconButton("action", "guides", "Snap movement to page and object alignment guides; hold Alt/Option to bypass", 'aria-pressed="true"')}
    ${editorIconButton("action", "layers", "Add, edit, reorder or remove PDF layers")}${editorIconButton("action", "pages", "Organize, crop or extract PDF pages")}${editorIconButton("action", "pdf-password", "Keep, remove or change PDF password protection")}${editorIconButton("action", "save-pdf", "Download an editable PDF (Ctrl/Cmd+S)")}${editorIconButton("action", "flatten", "Download a flattened PDF copy")}${editorIconButton("action", "save-hep", "Download the edited document as HEP")}${editorIconButton("action", "print", "Print the edited document")}${editorIconButton("action", "recovery", "Manage local recovery drafts")}
    ${editorIconButton("action", "cancel-operation", "Cancel the current operation", "hidden")}<span data-status role="status" aria-live="polite"></span><span data-recovery-status role="status" aria-live="polite"></span>
  </div><div class="hepr-editor-help">Ctrl/Cmd + click toggles objects; Shift + click adds them. Drag empty space to select fully contained objects. Corner resizing keeps proportions; hold Shift to resize freely. Rotation snaps within 5° of multiples of 45°, including 0°; hold Alt/Option to disable snapping. Double-click a new textbox to edit it; resizing changes wrapping, Alt + resize scales text. Escape cancels.</div>`;
  const overlay = document.createElement("div"); overlay.className = "hepr-editor-overlay"; overlay.dataset.tool = tool;
  const graphic = document.createElementNS(SVG_NS, "svg"); graphic.classList.add("hepr-editor-graphic");
  const fields = document.createElement("div"); fields.className = "hepr-editor-fields"; fields.hidden = true;
  const fieldDrafts = new Map<EditorFieldControl, string>();
  const pendingDrawings = createEditorPendingDrawings(session), inkPreview = createEditorInkPreviewCache(), shapePreview = createEditorShapePreviewCache();
  let fieldPaintCache: { scene: VectorScene; annotations: Map<string, NonNullable<VectorScene["annotations"]>[number]>;
    appearances: ReturnType<typeof getSceneAnnotationRuns> } | null = null;
  overlay.append(graphic, fields); document.body.append(toolbar, overlay);
  const query = <T extends HTMLElement>(selector: string): T => toolbar.querySelector<T>(selector)!;
  const property = (name: string): HTMLInputElement => query(`[data-prop="${name}"]`);
  const status = query<HTMLSpanElement>("[data-status]");
  const appearanceControls = createEditorPropertyControls({ session, control: name => property(name),
    style: name => query<HTMLButtonElement>(`[data-style="${name}"]`), focused: () => document.activeElement,
    note: query("[data-properties-note]") });
  function updateAppearanceControls(): void {
    appearanceControls.refresh(activeText ? "draft" : tool === "select" && session.getSelection().length ? "selection" : "defaults");
  }
  function setStatus(text: string): void {
    status.textContent = text; if (!active) host.onStatus?.(text);
  }
  function opacitySlider(name: "opacity" | "fill-opacity"): HTMLInputElement {
    return query(`[data-opacity-slider="${name}"]`);
  }
  function syncOpacityControls(name: "opacity" | "fill-opacity", value: number | null, disabled: boolean): void {
    const number = property(name), slider = opacitySlider(name);
    number.disabled = slider.disabled = disabled; number.value = value === null ? "" : String(value);
    number.placeholder = value === null ? "Mixed" : "";
    slider.value = String(value ?? .5);
    if (value === null) slider.setAttribute("aria-valuetext", "Mixed values; adjust to set all selected objects");
    else slider.removeAttribute("aria-valuetext");
  }
  function updateOpacityControls(state: EditorState): void {
    const selectionKey = JSON.stringify(state.selection), selectionChanged = selectionKey !== opacityControlSelection;
    opacityControlSelection = selectionKey;
    const styled = tool === "select" && !activeText ? editorStyledSelection(session) : [], fills = editorFillSelection(session, styled);
    for (const name of ["opacity", "fill-opacity"] as const) {
      if (!selectionChanged && (document.activeElement === property(name) || document.activeElement === opacitySlider(name))) continue;
      const ids = name === "opacity" ? styled : fills;
      const values = ids.map(id => {
        const object = session.getObject(id);
        return name === "fill-opacity" && (object.kind === "shape" || object.kind === "ink" || object.kind === "signature")
          ? object.fillOpacity ?? object.opacity ?? 1 : object.opacity ?? 1;
      });
      const disabled = tool === "select" && state.selection.length > 0 && ids.length === 0;
      if (name === "opacity" && activeText) syncOpacityControls(name, activeText.opacity ?? objectOpacity, false);
      else if (values.length) {
        const common = values.every(value => value === values[0]); syncOpacityControls(name, common ? values[0] : null, disabled);
      } else syncOpacityControls(name, name === "opacity" ? objectOpacity : fillOpacity, disabled);
    }
  }
  function opacityInput(event: Event): void {
    if (structuralRunning || running || savePreparing) return;
    const input = event.target as HTMLInputElement, name = input.dataset.opacitySlider ?? input.dataset.prop;
    if (name !== "opacity" && name !== "fill-opacity") return;
    const value = input.value.trim() ? Number(input.value) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    if (input.dataset.opacitySlider) { property(name).value = input.value; property(name).placeholder = ""; }
    else opacitySlider(name).value = input.value;
    opacitySlider(name).removeAttribute("aria-valuetext");
  }
  function changeOpacity(input: HTMLInputElement): boolean {
    const name = input.dataset.opacitySlider ?? input.dataset.prop;
    if (name !== "opacity" && name !== "fill-opacity") return false;
    if (structuralRunning || running || savePreparing) return true;
    try {
      const value = validateEditorOpacity(input.value.trim() ? Number(input.value) : NaN);
      const selectionMode = tool === "select" && session.getSelection().length > 0 && !activeText;
      if (name === "opacity") {
        if (activeText) { activeText.opacity = value; recovery?.draftChanged(); }
        else if (selectionMode) { if (editorStyledSelection(session).length) commit(() => applyEditorOpacity(session, value)); }
        else objectOpacity = value;
      } else {
        if (selectionMode) { if (editorFillSelection(session).length) commit(() => applyEditorFillOpacity(session, value)); }
        else fillOpacity = value;
      }
      syncOpacityControls(name, value, input.disabled);
    } catch (error) { report(error); syncOpacityControls(name, name === "opacity" ? activeText?.opacity ?? objectOpacity : fillOpacity, input.disabled); }
    return true;
  }
  const report = (error: unknown): void => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(message(error)); };
  const layerDialog = host.layerControlsContainer ? null : document.createElement("dialog");
  if (layerDialog) {
    layerDialog.className = "hepr-editor-layer-dialog"; layerDialog.setAttribute("aria-label", "Edit PDF layers");
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Close";
    close.addEventListener("click", () => layerDialog.close(), { signal: lifetime.signal });
    layerDialog.append(close); document.body.append(layerDialog);
  }
  const layerControls = createEditorLayerControls({ container: host.layerControlsContainer ?? layerDialog!, session, onError: report,
    change(change) {
      if (structuralRunning || running || savePreparing) throw new Error("Wait for the current document operation to finish.");
      if (pointer || pendingPick) cancelPointerGesture();
      const revision = session.getState().revision;
      change(); if (session.getState().revision !== revision) void refreshScene();
    } });
  const contextMenu = createEditorContextMenu(document, {
    canRun: action => canOpenContextMenu() && session.canReorderSelection(action),
    run: action => { if (canOpenContextMenu()) commit(() => session.reorderSelection(action)); },
    objects: {
      canRun: canUseClipboard, run: runClipboard
    }, extra: [
      { action: "lock", label: "Lock", canRun: () => canOpenContextMenu() && session.getSelection().some(id => !session.isObjectLocked(id)), run: () => commit(() => session.setObjectsLocked(session.getSelection(), true)) },
      { action: "unlock", label: "Unlock", canRun: () => canOpenContextMenu() && selectionLocked(), run: () => commit(() => session.setObjectsLocked(session.getSelection(), false)) },
      { action: "edit-comment", label: "Edit comment", canRun: () => canOpenContextMenu() && canEditComment(), run: () => review.editSelection() },
      { action: "link", label: "Add or edit link", canRun: () => canOpenContextMenu() && links.canEditSelection(), run: () => openLinkEditor() },
      { action: "remove-link", label: "Remove link", canRun: () => canOpenContextMenu() && links.canRemoveSelection(), run: () => { links.removeSelection(); } }
    ], onError: report
  });
  const cameraPan = createEditorCameraPan({ overlay, getCanvas: host.getCanvas,
    canPan: () => active && !disposed && !running && !savePreparing && !structuralRunning && Boolean(host.panCameraByPixels),
    begin() { contextMenu.close(); cancelPointerGesture(); signatureHover = null; updatePolygonPreview(); host.beginCameraPan?.(); },
    pan: (dx, dy) => host.panCameraByPixels?.(dx, dy), end: () => host.endCameraPan?.(),
    onStateChange: () => host.onBusyChange?.(running || savePreparing || structuralRunning || cameraPan.isPanning() || links.isBusy())
  });
  const review = createEditorReviewController({ overlay, session, getScene: () => latestScene,
    canEdit: () => active && !disposed && !running && !structuralRunning && !activeText && !pointer && !pendingPick && !cameraPan.isPanning() && !links.isOpen() && !isSceneSettling(),
    toScene: (x, y) => host.clientToScenePoint(x, y), toClient: (x, y) => host.sceneToClientPoint(x, y),
    style: () => ({ color: property("color").value, opacity: objectOpacity }),
    change(change) { change(); void refreshScene(); }, added: ids => { for (const id of ids) pendingDrawings.add(id); }, onError: report,
    onDraftChange: () => recovery?.draftChanged()
  });
  const links = createEditorLinkController({ document, session,
    canEdit: () => active && !disposed && !running && !structuralRunning && !recoveryRunning && !activeText && !pointer && !pendingPick && !cameraPan.isPanning() && !isSceneSettling(),
    change(change) { change(); void refreshScene(); }, onError: report, onStatus: setStatus,
    onDraftChange() { recovery?.draftChanged(); updateLinkButtons(); }, onPickingChange: linkPickingChanged
  });
  function linkPickingChanged(picking: boolean): void {
    if (picking) { contextMenu.close(); cancelPointerGesture(); polygon = null; signatureHover = null; setTool("select", true); }
    else if (pendingPick) cancelPointerGesture();
    overlay.dataset.linkPicking = String(picking); updateLinkButtons();
    host.onBusyChange?.(running || savePreparing || structuralRunning || recoveryRunning || cameraPan.isPanning() || picking);
  }
  function updateLinkButtons(): void {
    query<HTMLButtonElement>('[data-action="link"]').disabled = links.isOpen() || !links.canEditSelection();
    query<HTMLButtonElement>('[data-action="remove-link"]').disabled = links.isOpen() || !links.canRemoveSelection();
  }
  function openLinkEditor(): void {
    if (links.isOpen()) return;
    if (tool !== "select") setTool("select");
    if (links.editSelection()) updateLinkButtons();
  }
  function selectionLocked(): boolean { return session.getSelection().some(id => session.isObjectLocked(id)); }
  function canEditComment(): boolean {
    const selection = session.getSelection(); if (selection.length !== 1 || selectionLocked()) return false;
    const object = session.getObject(selection[0]);
    return object.kind === "shape" && Boolean(object.review) || object.kind === "source" && Boolean(object.annotationId && latestScene.annotations?.some(annotation =>
      annotation.id === object.annotationId && ["Text", "Highlight", "Underline", "StrikeOut"].includes(annotation.subtype)));
  }
  const styleEnabled = (name: string): boolean => query(`[data-style="${name}"]`).getAttribute("aria-pressed") === "true";
  function pageAt(point: PrimitivePoint): number {
    const rects = session.sourceScene.pageRects;
    for (let i = 0; i < rects.length; i += 4) if (point.x >= rects[i] && point.x <= rects[i + 2] && point.y >= rects[i + 1] && point.y <= rects[i + 3]) return i / 4;
    return -1;
  }
  const pageLocal = (point: PrimitivePoint, index: number): [number, number] => [point.x - session.sourceScene.pageRects[index * 4], point.y - session.sourceScene.pageRects[index * 4 + 1]];
  function sceneBoundsToClient(bounds: Bounds, pageIndex?: number): Bounds | null {
    const points = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]
      .map(([x, y]) => host.sceneToClientPoint(x, y, pageIndex));
    if (points.some(point => !point)) return null;
    const p = points as PrimitivePoint[];
    return { minX: Math.min(...p.map(point => point.x)), minY: Math.min(...p.map(point => point.y)), maxX: Math.max(...p.map(point => point.x)), maxY: Math.max(...p.map(point => point.y)) };
  }
  function svg(tag: string, attributes: Record<string, string | number>): SVGElement {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    graphic.append(element); return element;
  }
  function displayedSelection(): { frame: EditorSelectionFrame | null; delta?: EditorMatrix } {
    const display = presented;
    if (!display) return { frame: session.getSelectionFrame() };
    if (display.sourceScene !== session.sourceScene) return { frame: null };
    if (display.revision === currentState.revision && !display.delta) return { frame: session.getSelectionFrame() };
    if (currentState.selection.length !== display.selection.size || currentState.selection.some(id => !display.selection.has(id))) return { frame: null };
    return { frame: display.frame, delta: display.delta ?? undefined };
  }
  function isSceneSettling(): boolean {
    return !pointer && (sceneApplication !== null || presented !== null &&
      (presented.sourceScene !== session.sourceScene || presented.revision !== currentState.revision || presented.delta !== null));
  }
  function updateGeometry(fromFrame = false): void {
    const canvas = host.getCanvas(), rect = canvas.getBoundingClientRect();
    const toolbarInset = rect.width <= 700 ? 2 : 8;
    const toolbarLeft = `${rect.left + toolbarInset}px`, toolbarWidth = `${Math.max(0, rect.width - toolbarInset * 2)}px`;
    if (toolbar.style.left !== toolbarLeft) toolbar.style.left = toolbarLeft;
    if (toolbar.style.right !== "auto") toolbar.style.right = "auto";
    if (toolbar.style.width !== toolbarWidth) toolbar.style.width = toolbarWidth;
    overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`; overlay.style.height = `${rect.height}px`;
    graphic.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    graphic.replaceChildren();
    review.updateOverlay();
    const reviewPreview = review.preview();
    if (reviewPreview) for (let i = 0; i + 3 < reviewPreview.length; i += 4) {
      const b = sceneBoundsToClient({ minX: reviewPreview[i], minY: reviewPreview[i + 1], maxX: reviewPreview[i + 2], maxY: reviewPreview[i + 3] });
      if (b) svg("rect", { x: b.minX - rect.left, y: b.minY - rect.top, width: b.maxX - b.minX, height: b.maxY - b.minY, class: "hepr-editor-review-selection" });
    }
    const display = displayedSelection(), selection = display.frame;
    updateRotationValue(selection, display.delta);
    if (selection && tool === "select" && !running && !activeText) {
      const geometry = editorFrameClientGeometry(selection, point => host.sceneToClientPoint(point.x, point.y, selection.pageIndex), display.delta);
      if (geometry) {
        const corners = geometry.corners.map(point => ({ x: point.x - rect.left, y: point.y - rect.top }));
        const dx = corners[1].x - corners[0].x, dy = corners[1].y - corners[0].y;
        const handleAngle = (dx !== 0 || dy !== 0 ? Math.atan2(dy, dx)
          : Math.atan2(corners[3].y - corners[0].y, corners[3].x - corners[0].x)) * 180 / Math.PI;
        const framePoints = corners.map(point => `${point.x},${point.y}`).join(" ");
        const locked = selectionLocked();
        if (!locked) svg("polygon", { points: framePoints, class: "hepr-editor-selection-hit", "data-selection-move": "true" });
        svg("polygon", { points: framePoints, class: "hepr-editor-selection" });
        for (const [index, name] of (locked ? [] : ["nw", "ne", "se", "sw"]).entries()) {
          const point = corners[index], handle = svg("rect", { x: point.x - 4, y: point.y - 4, width: 8, height: 8,
            transform: `rotate(${handleAngle} ${point.x} ${point.y})`, "data-handle": name, class: "hepr-editor-handle" });
          handle.style.cursor = pointer ? "inherit" : geometry.cursors[index];
          if (pointer?.action === "resize" && pointer.handle === name) overlay.style.cursor = geometry.cursors[index];
        }
        if (!locked) svg("line", { x1: geometry.rotationBase.x - rect.left, y1: geometry.rotationBase.y - rect.top,
          x2: geometry.rotation.x - rect.left, y2: geometry.rotation.y - rect.top, class: "hepr-editor-selection" });
        if (!locked) svg("circle", { cx: geometry.rotation.x - rect.left, cy: geometry.rotation.y - rect.top, r: 5, "data-handle": "rotate", class: "hepr-editor-handle" });
      }
    }
    if (pointer?.action === "move" && presented?.sourceScene === session.sourceScene) for (const guide of presented.guides ?? []) {
      const a = host.sceneToClientPoint(guide.axis === "x" ? guide.value : guide.start, guide.axis === "x" ? guide.start : guide.value, pointer.frame?.pageIndex);
      const b = host.sceneToClientPoint(guide.axis === "x" ? guide.value : guide.end, guide.axis === "x" ? guide.end : guide.value, pointer.frame?.pageIndex);
      if (a && b) svg("line", { x1: a.x - rect.left, y1: a.y - rect.top, x2: b.x - rect.left, y2: b.y - rect.top, class: "hepr-editor-alignment-guide" });
    }
    for (const entry of pendingDrawings.visible()) drawDrawingPreview(entry.object, entry.geometry, rect);
    if (pointer) {
      if (pointer.action === "draw" && tool === "ink") {
        if (pointer.ink) drawDrawingPreview(pointer.ink, inkPreview, rect);
      } else if (pointer.action === "draw" && pointer.shape) {
        drawDrawingPreview(pointer.shape, shapePreview, rect);
      } else if (pointer.action === "marquee") {
        const p = host.sceneToClientPoint(pointer.last.x, pointer.last.y);
        if (p) svg("rect", { x: Math.min(pointer.startClient.x, p.x) - rect.left, y: Math.min(pointer.startClient.y, p.y) - rect.top,
          width: Math.abs(p.x - pointer.startClient.x), height: Math.abs(p.y - pointer.startClient.y), class: "hepr-editor-marquee" });
      }
    }
    if (polygon) drawDrawingPreview(polygon.preview, shapePreview, rect);
    if (tool === "signature" && signature && signatureHover && !running && (!presented || presented.sourceScene === session.sourceScene)) drawSignatureGhost(rect);
    // A camera may already have its next requested pose between document draws.
    // Gesture chrome keeps its RAF, but field controls only follow a drawn pose.
    if (tool === "form" && !fields.hidden && (!host.subscribeToFrames || fromFrame)) for (const element of fields.querySelectorAll<HTMLElement>("[data-field-id]")) {
      const annotation = latestScene.annotations?.find(item => item.id === element.dataset.fieldId);
      const source = annotation && (getEditorAnnotationSource(latestScene, annotation.id) ?? annotation);
      const sourcePresented = !presented || presented.sourceScene === session.sourceScene;
      const geometry = sourcePresented && source && editorFieldClientGeometry(source, latestScene.pdfPages,
        (point, pageIndex) => host.sceneToClientPoint(point.x, point.y, pageIndex), getEditorAnnotationFrameTransform(latestScene, source.id));
      const bounds = sourcePresented && !geometry && annotation && sceneBoundsToClient(annotation.bounds, annotation.pageIndex);
      element.hidden = (!geometry && !bounds) || !session.isAnnotationVisible(element.dataset.fieldId!);
      if (geometry) Object.assign(element.style, { left: `${geometry.origin.x - rect.left}px`, top: `${geometry.origin.y - rect.top}px`,
        width: `${geometry.width}px`, height: `${geometry.height}px`, transformOrigin: "0 0", transform: `matrix(${geometry.transform.join(",")})` });
      else if (bounds) Object.assign(element.style, { left: `${bounds.minX - rect.left}px`, top: `${bounds.minY - rect.top}px`,
        width: `${bounds.maxX - bounds.minX}px`, height: `${bounds.maxY - bounds.minY}px`, transformOrigin: "0 0", transform: "none" });
    }
    focusPendingField();
    if (activeText && updateTextVisibility()) {
      const [pageX, pageY] = [session.sourceScene.pageRects[activeText.pageIndex * 4], session.sourceScene.pageRects[activeText.pageIndex * 4 + 1]];
      const [a, b, c, d, e, f] = activeText.transform;
      const project = (x: number, y: number) => host.sceneToClientPoint(pageX + a * x + c * y + e, pageY + b * x + d * y + f, activeText!.pageIndex);
      const origin = project(activeText.x, activeText.y + activeText.height), alongX = project(activeText.x + 1, activeText.y + activeText.height), alongY = project(activeText.x, activeText.y + activeText.height - 1);
      if (origin && alongX && alongY) {
        Object.assign(activeText.element.style, { left: `${origin.x - rect.left}px`, top: `${origin.y - rect.top}px`, width: `${activeText.width}px`, minHeight: `${activeText.height}px`,
          transform: `matrix(${alongX.x - origin.x},${alongX.y - origin.y},${alongY.x - origin.x},${alongY.y - origin.y},0,0)` });
      }
    }
  }
  function updateTextVisibility(): boolean {
    if (!activeText) return false;
    let visible: boolean;
    if (activeText.objectId) {
      try { visible = session.isObjectVisible(activeText.objectId); }
      catch (error) { if (!(error instanceof RangeError)) throw error; cancelText(); return false; }
    }
    else if (activeText.sourceAnnotationId) visible = session.isAnnotationVisible(activeText.sourceAnnotationId);
    else {
      const revision = session.getLayerRevision();
      if (revision !== draftLayerRevision) {
        draftLayerRevision = revision; draftLayers = new Map(session.getLayers().map(layer => [layer.id, layer.defaultVisible]));
        for (const removal of session.getLayerEdits().removals) if (activeText.layerId === removal.id) activeText.layerId = removal.targetLayerId;
        if (activeText.layerId && !draftLayers.has(activeText.layerId)) activeText.layerId = null;
      }
      visible = !activeText.layerId || draftLayers.get(activeText.layerId) !== false;
    }
    if (!visible && !activeText.element.hidden) activeText.hiddenHeight = Math.max(activeText.height, activeText.element.scrollHeight);
    if (visible) activeText.hiddenHeight = undefined;
    activeText.element.hidden = !visible;
    return visible;
  }
  function tick(): void { if (active && !disposed) { updateGeometry(); frame = window.requestAnimationFrame(tick); } }
  function signaturePlacementAt(point: PrimitivePoint) {
    if (!signature) return null;
    const pageIndex = pageAt(point); if (pageIndex < 0) return null;
    const page = session.sourceScene.pageRects, width = Math.min(180, (page[pageIndex * 4 + 2] - page[pageIndex * 4]) * .4);
    return { ...editorSignaturePlacement(signature, pageLocal(point, pageIndex), width), pageIndex };
  }
  function drawSignatureGhost(rect: DOMRect): void {
    if (!signatureHover || signatureHover.x < rect.left || signatureHover.y < rect.top || signatureHover.x > rect.right || signatureHover.y > rect.bottom) return;
    const point = host.clientToScenePoint(signatureHover.x, signatureHover.y), placement = point && signaturePlacementAt(point);
    if (!placement) return;
    const { transform: [a, , , d, e, f], pageIndex, scale } = placement;
    const pages = session.sourceScene.pageRects, pageX = pages[pageIndex * 4], pageY = pages[pageIndex * 4 + 1];
    const project = (x: number, y: number) => host.sceneToClientPoint(pageX + e + a * x, pageY + f + d * y, pageIndex);
    const origin = project(0, 0), x = project(1, 0), y = project(0, 1);
    if (!origin || !x || !y) return;
    svg("path", { d: placement.path, fill: "none", stroke: property("color").value,
      "stroke-width": Number(property("stroke").value) / scale, "stroke-linecap": "round", "stroke-linejoin": "round",
      opacity: objectOpacity * .45, class: "hepr-editor-signature-ghost", "aria-hidden": "true",
      transform: `matrix(${x.x - origin.x} ${x.y - origin.y} ${y.x - origin.x} ${y.y - origin.y} ${origin.x - rect.left} ${origin.y - rect.top})` });
  }
  function drawDrawingPreview(object: EditorDrawingInput, geometry: EditorDrawingCache, rect: DOMRect): void {
    const pages = session.sourceScene.pageRects, offset = object.pageIndex * 4;
    const matrix = editorInkPreviewTransform(object.transform ?? IDENTITY, [pages[offset], pages[offset + 1]],
      (x, y) => host.sceneToClientPoint(x, y, object.pageIndex), { x: rect.left, y: rect.top });
    if (!matrix) return;
    const hairline = 1 / (window.devicePixelRatio || 1), preview = object.kind === "shape"
      ? (geometry as ReturnType<typeof createEditorShapePreviewCache>).get(object, hairline)
      : (geometry as ReturnType<typeof createEditorInkPreviewCache>).get(object, hairline);
    for (const path of preview.paths) svg("path", { ...path,
      transform: `matrix(${matrix.join(",")})`, "pointer-events": "none", "aria-hidden": "true",
      class: object.kind === "shape" ? "hepr-editor-shape-preview" : "hepr-editor-ink-preview" });
  }
  function updateRotationValue(selection: EditorSelectionFrame | null, delta?: EditorMatrix, force = false): void {
    const input = query<HTMLInputElement>('[data-transform="rotation"]');
    input.disabled = !selection || activeText !== null || selectionLocked();
    if (rotationDraft && (force || !selection || document.activeElement !== input || pointer !== null ||
        rotationDraft.sourceScene !== session.sourceScene || rotationDraft.selection.length !== currentState.selection.length ||
        rotationDraft.selection.some((id, index) => id !== currentState.selection[index]))) rotationDraft = null;
    if (!rotationDraft) {
      const value = selection ? Number(editorFrameRotation(selection, delta).toFixed(3)).toString() : "";
      if (input.value !== value) input.value = value;
    }
  }
  function updateState(state: EditorState): void {
    contextMenu.close();
    const previous = currentState;
    currentState = state;
    if (state.previewing && currentSourceScene === session.sourceScene && state.revision === previous.revision &&
        state.dirty === previous.dirty && state.canUndo === previous.canUndo && state.canRedo === previous.canRedo &&
        state.selection.length === previous.selection.length && state.selection.every((id, index) => id === previous.selection[index])) {
      updatePointerCursor();
      if (!running && !previous.previewing) setStatus("Transform preview");
      return;
    }
    pendingDrawings.reconcile();
    updatePointerCursor();
    query<HTMLButtonElement>('[data-action="undo"]').disabled = !state.canUndo;
    query<HTMLButtonElement>('[data-action="redo"]').disabled = !state.canRedo;
    query("[data-selection]").textContent = state.selection.length ? `${state.selection.length} selected` : "No selection";
    for (const action of ["duplicate", "delete", "group", "ungroup", "copy", "cut", "lock", "unlock"]) query<HTMLButtonElement>(`[data-action="${action}"]`).disabled = !state.selection.length || action !== "copy" && action !== "unlock" && selectionLocked();
    query<HTMLButtonElement>('[data-action="lock"]').disabled = !state.selection.some(id => !session.isObjectLocked(id));
    query<HTMLButtonElement>('[data-action="unlock"]').disabled = !selectionLocked();
    query<HTMLButtonElement>('[data-action="edit-comment"]').disabled = !canEditComment();
    updateLinkButtons();
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-action^="align-"], [data-action^="distribute-"]')) button.disabled = !state.selection.length || selectionLocked();
    updateClipboardButtons();
    if (tool === "form") for (const control of fieldDrafts.keys()) control.disabled = session.isObjectLocked(`annotation:${control.dataset.fieldId}`);
    const bounds = session.getSelectionBounds(), frame = session.getSelectionFrame(), size = frame && editorFrameSize(frame);
    for (const [name, value] of Object.entries({ x: bounds?.minX, y: bounds?.minY, width: size?.width, height: size?.height })) {
      const input = query<HTMLInputElement>(`[data-transform="${name}"]`); input.disabled = !bounds || selectionLocked();
      if (document.activeElement !== input) input.value = value == null ? "" : Number(value.toFixed(3)).toString();
    }
    if (!state.previewing) updateRotationValue(frame);
    if (!state.previewing) updateOpacityControls(state);
    if (!state.previewing) updateAppearanceControls();
    if (!running) setStatus(state.previewing ? "Transform preview" : hasUnsavedChanges() ? exportedRevision === state.revision ? "Exported; local changes kept" : "Unsaved changes" : "No unsaved changes");
    host.onModeChange?.(active);
  }
  const unsubscribe = session.subscribe(updateState);
  async function synchronizeDocumentSource(): Promise<void> {
    if (currentSourceScene === session.sourceScene) return;
    pendingFieldFocus = null; polygon = null;
    currentSourceScene = session.sourceScene; latestScene = currentSourceScene;
    picking?.abort(); picker?.dispose(); picker = null;
    await host.documentChanged?.(currentSourceScene, { pdf: session.sourcePdf, password: source.password, label: source.label });
    if (tool === "form") renderFields(); pagesDialog?.refresh();
  }
  async function refreshScene(externalSignal?: AbortSignal, preview = false, propagateError = false): Promise<void> {
    const revision = ++renderRevision, abort = new AbortController();
    scenePreparation?.abort(); scenePreparation = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal, ...(externalSignal ? [externalSignal] : [])]);
    try {
      await synchronizeDocumentSource(); signal.throwIfAborted();
      if (disposed || revision !== renderRevision) return;
      const state = session.getState(), snapshot: PresentedScene = { sourceScene: session.sourceScene, revision: state.revision,
        selection: new Set(state.selection), frame: session.getSelectionFrame(), delta: preview && state.previewing ? requestedPreview : null,
        drawings: pendingDrawings.capture(), guides: preview ? requestedGuides : [] };
      const scene = await session.getScene({ signal, preview });
      if (disposed || revision !== renderRevision) return;
      // Preparing a newer pose can supersede older preparation. Once host
      // publication starts, finish its matching draw before applying another.
      while (sceneApplication) {
        await sceneApplication; signal.throwIfAborted();
        if (disposed || revision !== renderRevision) return;
      }
      if (scenePreparation === abort) scenePreparation = null;
      let finish: (() => void) | undefined;
      const application = new Promise<void>(resolve => { finish = resolve; }); sceneApplication = application;
      let acknowledged = false;
      const publish = (): void => {
        if (acknowledged || disposed || signal.aborted || sceneApplication !== application) return;
        acknowledged = true; latestScene = scene; presented = snapshot; updatePointerCursor();
        pendingDrawings.acknowledge(snapshot.drawings);
        if (tool === "form") updateFieldPaint();
        // Preserve focused field drafts; only reposition existing controls.
        if (active) updateGeometry(true);
      };
      try {
        await host.applyScene(scene, signal, publish, { preview }); signal.throwIfAborted();
        // A synchronous host may finish its draw before returning.
        if (!acknowledged) publish();
      } finally {
        if (sceneApplication === application) sceneApplication = null;
        finish?.();
        if (!disposed) { updatePointerCursor(); if (!preview) updateLinkButtons(); if (active) updateGeometry(); }
      }
    } catch (error) { if (propagateError) throw error; report(error); }
    finally { if (scenePreparation === abort) scenePreparation = null; }
  }
  function commit(change: () => void, finishingSaveDraft = false): void {
    if (disposed || structuralRunning || running || savePreparing && !finishingSaveDraft) return;
    if (pointer || pendingPick) cancelPointerGesture();
    try { change(); void refreshScene(); } catch (error) { report(error); }
  }
  function changeHistory(redo: boolean): void {
    commit(() => { if (redo) session.redo(); else session.undo(); if (tool === "form") renderFields(); });
  }
  function updateClipboardButtons(): void {
    const unavailable = running || savePreparing || structuralRunning || activeText !== null;
    for (const action of ["copy", "cut", "duplicate"]) query<HTMLButtonElement>(`[data-action="${action}"]`).disabled = unavailable || !session.getSelection().length || action !== "copy" && selectionLocked();
    query<HTMLButtonElement>('[data-action="paste"]').disabled = unavailable || !session.canPaste();
  }
  function canUseClipboard(action: EditorObjectMenuAction): boolean {
    return active && !disposed && !running && !savePreparing && !structuralRunning && !activeText && !pointer && !pendingPick && !polygon && !isSceneSettling() &&
      !cameraPan.isPanning() && !links.isOpen() &&
      (action === "paste" ? session.canPaste() : session.getSelection().length > 0 && (action === "copy" || !selectionLocked()));
  }
  async function runClipboard(action: EditorObjectMenuAction, inPlace = false): Promise<void> {
    if (!canUseClipboard(action)) return;
    contextMenu.close();
    if (action === "paste") {
      if (tool !== "select") setTool("select");
      commit(() => {
        const ids = session.pasteSelection(inPlace ? { offset: [0, 0] } : undefined);
        if (ids.length) {
          const layer = session.getLayers().find(item => item.id === session.getActiveLayer());
          const hidden = ids.some(id => !session.isObjectVisible(id));
          setStatus(`Pasted ${ids.length} ${ids.length === 1 ? "object" : "objects"} into ${layer?.name ?? "Unlayered"}.${hidden ? " Some objects are hidden by their layer." : ""}`);
        }
      });
      return;
    }
    cancelPointerGesture(false); textRequest++;
    const abort = new AbortController(); operation = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal]);
    clipboardRunning = running = true; updatePointerCursor(); updateClipboardButtons(); host.onBusyChange?.(true);
    query('[data-action="cancel-operation"]').hidden = false;
    setStatus(action === "duplicate" ? "Duplicating objects…" : action === "cut" ? "Cutting objects…" : "Copying objects…");
    let copied = 0, failed = false;
    try {
      copied = action === "duplicate" ? (await session.duplicateSelection({ signal })).length
        : action === "cut" ? await session.cutSelection({ signal }) : await session.copySelection({ signal });
      signal.throwIfAborted();
      if (action !== "copy" && copied) await refreshScene(signal, false, true);
    } catch (error) { failed = true; report(error); }
    finally {
      if (operation === abort) operation = null;
      clipboardRunning = running = false; host.onBusyChange?.(false);
      if (!disposed) {
        updatePointerCursor(); updateClipboardButtons(); query('[data-action="cancel-operation"]').hidden = true;
        if (signal.aborted) setStatus("Clipboard operation cancelled.");
        else if (!failed && copied) setStatus(action === "duplicate" ? `Duplicated ${copied} ${copied === 1 ? "object" : "objects"}.`
          : `${copied} ${copied === 1 ? "object" : "objects"} ${action === "cut" ? "cut" : "copied"}. Select a layer and paste.`);
      }
    }
  }
  function runPreview(): void {
    previewQueued = false; if (!pointer || !active || disposed) return;
    previewPending = false; previewRunning = true;
    void refreshScene(undefined, true).finally(() => {
      previewRunning = false;
      if (previewPending && pointer && active && !disposed) runPreview();
    });
  }
  function queuePreview(): void {
    previewPending = true;
    if (previewRunning || previewQueued) return;
    previewQueued = true;
    const generation = ++previewGeneration;
    queueMicrotask(() => {
      if (generation !== previewGeneration) return;
      previewQueued = false; runPreview();
    });
  }
  function clearPreview(restore = false): void {
    previewGeneration++; previewQueued = false; previewPending = false;
    requestedPreview = null;
    const wasPreviewing = session.getState().previewing; interaction.cancelTransform();
    if (restore && wasPreviewing) void refreshScene();
  }
  function updatePointerCursor(): void {
    overlay.dataset.gesture = pointer?.action ?? (pendingPick ? "pick" : "");
    overlay.dataset.resizeHandle = pointer?.action === "resize" ? pointer.handle ?? "" : "";
    overlay.dataset.busy = String(running);
    overlay.dataset.settling = String(isSceneSettling());
    if (pointer?.action !== "resize") overlay.style.cursor = "";
  }
  function cancelPointerGesture(restore = true): void {
    fieldActivation.reset();
    cameraPan.cancel();
    review.cancelGesture();
    alignmentSnap = null; requestedGuides = [];
    const id = pointer?.id ?? pendingPick?.id;
    pointer = null;
    if (pendingPick) pendingPick.canceled = true; pendingPick = null;
    picking?.abort();
    if (id !== undefined && overlay.hasPointerCapture?.(id)) overlay.releasePointerCapture(id);
    clearPreview(restore); updatePointerCursor();
  }
  function setTool(next: Tool, preserveLinkPick = false): void {
    if (structuralRunning || running || savePreparing) return;
    if (next !== tool && !preserveLinkPick && links.isPicking()) links.cancelPick();
    contextMenu.close();
    pendingFieldFocus = null;
    if (activeText) {
      const request = ++toolRequest;
      void finishText().then(() => { if (!disposed && request === toolRequest) setTool(next); }).catch(report); return;
    }
    textRequest++;
    // Restore creation controls before applying the next tool's own defaults.
    appearanceControls.refresh("defaults");
    if (isEditorReviewTool(tool)) reviewDefaults.set(tool, { color: property("color").value, opacity: objectOpacity });
    if (!isEditorReviewTool(tool) && isEditorReviewTool(next)) drawingDefaults = { color: property("color").value, opacity: objectOpacity };
    if (isEditorReviewTool(next)) {
      const style = reviewDefaults.get(next) ?? { color: next === "highlight" || next === "comment" ? "#ffdc00" : "#e12727", opacity: next === "highlight" ? .35 : 1 };
      property("color").value = style.color; objectOpacity = style.opacity;
    } else if (isEditorReviewTool(tool) && drawingDefaults) { property("color").value = drawingDefaults.color; objectOpacity = drawingDefaults.opacity; drawingDefaults = null; }
    cancelPointerGesture(); polygon = null; signatureHover = null; tool = next; toolRequest++;
    review.setTool(isEditorReviewTool(next) ? next : null);
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool], [data-action="signatures"]'))
      button.setAttribute("aria-pressed", String(button.dataset.tool === next || button.dataset.action === "signatures" && next === "signature"));
    overlay.dataset.tool = next; fields.hidden = next !== "form";
    updateOpacityControls(currentState);
    updateAppearanceControls();
    if (next === "form") renderFields();
    updateLinkButtons();
    updateGeometry();
  }
  function renderFields(): void {
    fields.replaceChildren(); fieldDrafts.clear();
    const appearances = getSceneAnnotationRuns(latestScene);
    const values = session.getFieldValues(), sourceAnnotations = new Map(session.sourceScene.annotations?.map(annotation => [annotation.id, annotation]));
    for (const currentAnnotation of latestScene.annotations ?? []) {
      const annotation = getEditorAnnotationSource(latestScene, currentAnnotation.id) ?? currentAnnotation;
      const name = annotation.field?.name;
      // Canonical placements retain old field metadata for geometry. Values
      // come from the current session, including its source fallback after Undo.
      const sourceField = sourceAnnotations.get(currentAnnotation.id)?.field ?? currentAnnotation.field;
      const value = name && values.has(name) ? values.get(name) : sourceField?.value;
      const input = createEditorFieldControl(document, annotation, value ?? null,
        value => commit(() => {
          session.setFieldValue(name!, value);
          for (const [control] of fieldDrafts) {
            const sibling = latestScene.annotations?.find(item => item.id === control.dataset.fieldId);
            if (!sibling || sibling.field?.name !== name) continue;
            setEditorFieldControlValue(control, getEditorAnnotationSource(latestScene, sibling.id) ?? sibling, value); fieldDrafts.set(control, editorFieldDraftSignature(control));
          }
          updateFieldPaint();
        }), { usePdfAppearance: currentAnnotation.hasAppearance || Boolean(appearances.get(annotation.id)?.length) });
      if (input) {
        input.disabled = session.isObjectLocked(`annotation:${annotation.id}`);
        input.hidden = Boolean(host.subscribeToFrames);
        input.addEventListener("input", () => { updateFieldPaint(input); recovery?.draftChanged(); });
        fieldDrafts.set(input, editorFieldDraftSignature(input)); fields.append(input);
        const choices = createEditorFieldOptions(document, annotation, input); if (choices) fields.append(choices);
        if (annotation.field?.textStyle) void editorServices.fonts.resolve(annotation.field.textStyle).then(async font => {
          await activateFont(font);
          const current = latestScene.annotations?.find(item => item.id === annotation.id);
          if (input.parentElement === fields && current) styleEditorFieldControl(input, getEditorAnnotationSource(latestScene, current.id) ?? current, JSON.stringify(font.id));
        }).catch(report);
      }
    }
    updateFieldPaint();
    if (active) host.requestFrame?.();
  }
  function updateFieldPaint(changedControl?: EditorFieldControl): void {
    if (!fieldPaintCache || fieldPaintCache.scene !== latestScene) fieldPaintCache = { scene: latestScene,
      annotations: new Map(latestScene.annotations?.map(annotation => [annotation.id, annotation])), appearances: getSceneAnnotationRuns(latestScene) };
    for (const control of changedControl ? [changedControl] : fieldDrafts.keys()) {
      const annotation = fieldPaintCache.annotations.get(control.dataset.fieldId!);
      updateEditorFieldControlAppearance(control, annotation, Boolean(annotation?.hasAppearance || fieldPaintCache.appearances.get(control.dataset.fieldId!)?.length));
    }
  }
  function fieldAtClientPoint(client: PrimitivePoint): string | null {
    for (const annotation of [...(latestScene.annotations ?? [])].reverse()) {
      if (!canEditEditorField(annotation) || !session.isAnnotationVisible(annotation.id) || session.isObjectLocked(`annotation:${annotation.id}`)) continue;
      const source = getEditorAnnotationSource(latestScene, annotation.id) ?? annotation;
      const geometry = editorFieldClientGeometry(source, latestScene.pdfPages,
        (point, pageIndex) => host.sceneToClientPoint(point.x, point.y, pageIndex), getEditorAnnotationFrameTransform(latestScene, annotation.id));
      if (geometry) {
        const [a, b, c, d] = geometry.transform, determinant = a * d - b * c;
        const x = client.x - geometry.origin.x, y = client.y - geometry.origin.y;
        const localX = (d * x - c * y) / determinant, localY = (a * y - b * x) / determinant;
        if (localX >= 0 && localX <= geometry.width && localY >= 0 && localY <= geometry.height) return annotation.id;
      } else {
        const bounds = sceneBoundsToClient(annotation.bounds, annotation.pageIndex);
        if (bounds && client.x >= bounds.minX && client.x <= bounds.maxX && client.y >= bounds.minY && client.y <= bounds.maxY) return annotation.id;
      }
    }
    return null;
  }
  function focusPendingField(): void {
    const pending = pendingFieldFocus; if (!pending) return;
    if (!active || disposed || tool !== "form" || pending.sourceScene !== session.sourceScene) { pendingFieldFocus = null; return; }
    const control = [...fieldDrafts.keys()].find(input => input.dataset.fieldId === pending.id);
    if (!control) { pendingFieldFocus = null; return; }
    if (fields.hidden || control.hidden) return;
    pendingFieldFocus = null; control.focus({ preventScroll: true });
  }
  function canActivateField(): boolean {
    return active && !disposed && !running && !savePreparing && !structuralRunning && !recoveryRunning &&
      tool === "select" && !activeText && !links.isOpen() && !cameraPan.isPanning() &&
      (!presented || presented.sourceScene === session.sourceScene && presented.revision === session.revision);
  }
  function activateField(id: string): void {
    setTool("form");
    pendingFieldFocus = { id, sourceScene: session.sourceScene };
    updateGeometry(); host.requestFrame?.();
  }
  async function pick(point: PrimitivePoint, client: PrimitivePoint): Promise<string | null> {
    const objects = session.getObjects(), edits = session.getSourceEdits();
    const layerEdits = session.getLayerEdits(), reordered = layerEdits.stackingChanged || layerEdits.objectOrderChanged;
    const candidates: { id: string; rank: number }[] = [];
    const candidate = (id: string, rank = session.getObjectPaintRank(id)): void => { candidates.push({ id, rank }); };
    const changed = new Set(edits.filter(edit => edit.deleted || edit.transform.some((value, index) => value !== IDENTITY[index])).map(edit => `${edit.ref.kind}:${edit.ref.index}`));
    for (let i = objects.length - 1; i >= 0; i--) {
      const object = objects[i];
      if (!session.isObjectVisible(object.id)) continue;
      if (object.kind === "source" && !object.isClone && !object.primitives.some(ref => changed.has(`${ref.kind}:${ref.index}`))) continue;
      const bounds = session.getObjectBounds(objects[i].id);
      if (editorBoundsClickHit(bounds, point, client, p => host.sceneToClientPoint(p.x, p.y, object.pageIndex))) {
        if (!reordered) return object.id;
        candidate(object.id);
      }
    }
    const appearanceRuns = getSceneAnnotationRuns(session.sourceScene);
    const metadataOwners = new Map<string, string>();
    const metadata = (latestScene.annotations ?? []).filter(annotation => {
      const owner = annotation.subtype === "Link" ? editorLinkSelectionOwner(session, annotation) : `annotation:${annotation.id}`;
      if (!owner || (annotation.subtype === "Link" ? !session.isObjectVisible(owner) : !session.isAnnotationVisible(annotation.id))) return false;
      metadataOwners.set(annotation.id, owner); return true;
    });
    const annotationId = pickEditorMetadataAnnotation(metadata, point,
      annotation => session.getObjectBounds(metadataOwners.get(annotation.id)!),
      annotation => appearanceRuns.get(annotation.id)?.some(run => run.count > 0) ?? false);
    if (annotationId) {
      const owner = metadataOwners.get(annotationId)!;
      if (!reordered) return owner;
      candidate(owner);
    }
    picker ??= new ScenePrimitivePicker(session.sourceScene);
    picking?.abort(); const controller = picking = new AbortController();
    try {
      const hit = await picker.pick({ point, clientPoint: client, isVisible: ref => !changed.has(`${ref.kind}:${ref.index}`) && session.isPrimitiveVisible(ref),
        resolvePaintRank: reordered ? ref => session.getPrimitivePaintRank(ref) : undefined,
        project: p => host.sceneToClientPoint(p.x, p.y), unproject: p => host.clientToScenePoint(p.x, p.y), signal: AbortSignal.any([lifetime.signal, controller.signal]) });
      if (hit) {
        const id = `source:${hit.primitive.kind}:${hit.primitive.index}`;
        if (!reordered) return id;
        candidate(id, session.getPrimitivePaintRank(hit.primitive));
      }
      return candidates.reduce<{ id: string; rank: number } | null>((best, item) => !best || item.rank > best.rank ? item : best, null)?.id ?? null;
    } finally { if (picking === controller) picking = null; }
  }
  function dragMatrix(p: PointerGesture, point: PrimitivePoint): EditorMatrix {
    if (p.action === "move") {
      const matrix: EditorMatrix = [1, 0, 0, 1, point.x - p.start.x, point.y - p.start.y];
      const projected = host.sceneToClientPoint(p.start.x, p.start.y, p.frame?.pageIndex);
      const pixel = projected && host.clientToScenePoint(projected.x + 6, projected.y + 6, p.frame?.pageIndex);
      const tolerance = pixel ? Math.max(Math.abs(pixel.x - p.start.x), Math.abs(pixel.y - p.start.y)) : 0;
      const snapped = alignmentSnap?.snap(matrix, tolerance, p.freeRotation || query('[data-action="guides"]').getAttribute("aria-pressed") !== "true");
      requestedGuides = snapped?.guides ?? []; return snapped?.matrix ?? matrix;
    }
    const frame = p.frame ?? { bounds: p.bounds!, transform: IDENTITY };
    if (p.action === "rotate") {
      return editorFrameRotationDragMatrix(frame, p.start, point, p.freeRotation);
    }
    return editorFrameResizeMatrix(frame, p.start, point, p.handle ?? "se", p.freeResize);
  }
  function resizeTextBox(p: PointerGesture, object: EditorTextObject, matrix: EditorMatrix): Partial<EditorTextObject> | null {
    const [a, b, c, d, e, f] = object.transform, determinant = a * d - b * c;
    if (determinant === 0) return null;
    const pageX = session.sourceScene.pageRects[object.pageIndex * 4], pageY = session.sourceScene.pageRects[object.pageIndex * 4 + 1];
    const worldX = pageX + a * object.x + c * object.y + e, worldY = pageY + b * object.x + d * object.y + f;
    const x = matrix[0] * worldX + matrix[2] * worldY + matrix[4] - pageX - e;
    const y = matrix[1] * worldX + matrix[3] * worldY + matrix[5] - pageY - f;
    const sx = (d * (matrix[0] * a + matrix[2] * b) - c * (matrix[1] * a + matrix[3] * b)) / determinant;
    const sy = (-b * (matrix[0] * c + matrix[2] * d) + a * (matrix[1] * c + matrix[3] * d)) / determinant;
    const width = object.width * sx, height = object.height * sy;
    return width > 0 && height > 0 ? { x: (d * x - c * y) / determinant, y: (-b * x + a * y) / determinant, width, height } : null;
  }
  function transformProperty(name: string, value: number): void {
    const bounds = session.getSelectionBounds(), frame = session.getSelectionFrame();
    if (!bounds || !frame || !Number.isFinite(value) || selectionLocked()) return;
    if (name === "rotation") {
      commit(() => interaction.applyTransform(editorFrameRotationMatrix(frame, value)));
    } else if (name === "x" || name === "y") {
      commit(() => interaction.nudge(name === "x" ? value - bounds.minX : 0, name === "y" ? value - bounds.minY : 0));
    } else if (name === "width" || name === "height") {
      const size = editorFrameSize(frame), old = size[name]; if (old <= 0 || value <= 0) return;
      const matrix = editorFrameScaleMatrix(frame, name === "width" ? value / old : 1, name === "height" ? value / old : 1);
      commit(() => interaction.applyTransform(matrix));
    }
  }
  function changeTransform(input: HTMLInputElement): void {
    if (running || savePreparing || structuralRunning) return;
    if (input.value.trim() !== "") transformProperty(input.dataset.transform!, Number(input.value));
    if (input.dataset.transform === "rotation") {
      updateRotationValue(session.getSelectionFrame(), undefined, true);
      // Retain the accepted value while this numeric edit still owns focus,
      // including frames drawn before the committed scene is ready.
      if (document.activeElement === input) rotationDraft = { selection: currentState.selection, sourceScene: session.sourceScene };
    }
  }
  function createShapeDraft(shape: EditorShapeInput["shape"], pageIndex: number): EditorShapeInput {
    const strokeWidth = Number(property("stroke").value);
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || !Number.isFinite(Math.fround(strokeWidth)) || strokeWidth > 0 && Math.fround(strokeWidth / 2) === 0)
      throw new RangeError("Stroke width must be a nonnegative float32-representable number.");
    return { kind: "shape", shape, pageIndex, x: 0, y: 0, width: 0, height: 0, opacity: objectOpacity, fillOpacity,
      color: property("color").value, strokeWidth, fill: property("fill-enabled").checked ? property("fill").value : null };
  }
  function updateShapeGesture(p: PointerGesture, point: PrimitivePoint): void {
    const shape = p.shape; if (!shape) return;
    const start = pageLocal(p.start, shape.pageIndex), end = pageLocal(point, shape.pageIndex);
    Object.assign(shape, { x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]),
      width: Math.abs(end[0] - start[0]), height: Math.abs(end[1] - start[1]) });
    if (shape.shape === "line" || shape.shape === "arrow") shape.points = [start, end];
  }
  function updatePolygonPreview(hover: readonly [number, number] | null = null): void {
    if (!polygon) return;
    const last = polygon.points[polygon.points.length - 1], points = hover && (!last || hover[0] !== last[0] || hover[1] !== last[1])
      ? [...polygon.points, hover] : polygon.points;
    if (!points.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    polygon.preview = { ...polygon.object, points, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  async function pointerDown(event: PointerEvent): Promise<void> {
    const fieldId = canActivateField() && !pointer && !(event.target as Element).getAttribute("data-handle")
      ? fieldAtClientPoint({ x: event.clientX, y: event.clientY }) : null;
    fieldActivation.pointerDown(event, fieldId ? { id: fieldId, sourceScene: session.sourceScene, revision: session.revision } : null);
    if (links.isPicking()) { await pickLinkTarget(event); return; }
    if (!active || running || savePreparing || activeText || pointer || pendingPick ||
        isSceneSettling() && (!["ink", "rectangle", "ellipse", "line", "arrow", "polygon", "polyline", "signature"].includes(tool) || !presented || presented.sourceScene !== session.sourceScene) ||
        tool === "pan" || tool === "form" || isEditorReviewTool(tool) || event.button !== 0 || (event.target as Element).closest(".hepr-editor-field")) return;
    textRequest++;
    const targetHandle = tool === "select" ? (event.target as Element).getAttribute("data-handle") : null;
    const handleFrame = targetHandle && ["nw", "ne", "sw", "se", "rotate"].includes(targetHandle) ? session.getSelectionFrame() : null;
    const moveFrame = tool === "select" && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      (event.target as Element).getAttribute("data-selection-move") === "true" ? session.getSelectionFrame() : null;
    const gestureFrame = handleFrame ?? moveFrame;
    if (gestureFrame && selectionLocked()) return;
    if (polygon) polygon.previousPointCount = undefined;
    const point = host.clientToScenePoint(event.clientX, event.clientY, gestureFrame?.pageIndex ?? polygon?.pageIndex); if (!point || tool !== "select" && pageAt(point) < 0) return;
    event.preventDefault(); event.stopPropagation();
    const client = { x: event.clientX, y: event.clientY }, toggle = event.ctrlKey || event.metaKey, additive = toggle || event.shiftKey;
    const handle = handleFrame ? targetHandle : null;
    if (tool === "polygon" || tool === "polyline") {
      if (!polygon) {
        const pageIndex = pageAt(point), object = createShapeDraft(tool, pageIndex);
        polygon = { pageIndex, points: [], object, preview: object };
      }
      if (polygon.pageIndex === pageAt(point)) {
        const local = pageLocal(point, polygon.pageIndex), last = polygon.points[polygon.points.length - 1];
        polygon.previousPointCount = polygon.points.length;
        // Double-click completion produces two presses at the final vertex.
        if (!last || last[0] !== local[0] || last[1] !== local[1]) polygon.points.push(local);
        updatePolygonPreview();
      }
      return;
    }
    if (tool === "text") { await startText(point); return; }
    if (tool === "signature") { signatureHover = event.pointerType === "touch" ? null : client; if (signature) placeSignature(point); return; }
    if (tool === "image") { if (pendingImage) placeImage(point); return; }
    let action: PointerGesture["action"] = "draw";
    if (tool === "select") {
      if (handle) action = handle === "rotate" ? "rotate" : "resize";
      else if (moveFrame) action = "move";
      else {
        const request = { id: event.pointerId, point, client, lastClient: client, released: false, canceled: false };
        pendingPick = request;
        updatePointerCursor();
        overlay.setPointerCapture?.(event.pointerId);
        const sourceScene = session.sourceScene, revision = session.revision;
        const projection = host.sceneToClientPoint(point.x, point.y);
        let id: string | null;
        try { id = await pick(point, client); }
        catch (error) { if (pendingPick === request) cancelPointerGesture(); throw error; }
        if (disposed || !active || running || savePreparing || tool !== "select" || request.canceled || pendingPick !== request) return;
        const currentProjection = host.sceneToClientPoint(point.x, point.y);
        if (sourceScene !== session.sourceScene || revision !== session.revision || projection && (!currentProjection ||
            Math.abs(currentProjection.x - projection.x) + Math.abs(currentProjection.y - projection.y) > .1)) { cancelPointerGesture(); return; }
        pendingPick = null; updatePointerCursor();
        if (id) {
          interaction.selectHit(id, event);
          if (additive) return;
          if (selectionLocked()) return;
          action = "move";
        } else { interaction.selectHit(null, event); action = "marquee"; }
        if (request.released) {
          const last = host.clientToScenePoint(request.lastClient.x, request.lastClient.y, id ? session.getSelectionFrame()?.pageIndex : undefined);
          if (last && Math.hypot(request.lastClient.x - client.x, request.lastClient.y - client.y) > 2) {
            if (id) commit(() => interaction.applyTransform([1, 0, 0, 1, last.x - point.x, last.y - point.y]));
            else interaction.selectArea({ minX: Math.min(point.x, last.x), minY: Math.min(point.y, last.y), maxX: Math.max(point.x, last.x), maxY: Math.max(point.y, last.y) }, { shiftKey: additive });
          }
          return;
        }
      }
    }
    const drawingShape = ["rectangle", "ellipse", "line", "arrow"].includes(tool);
    const pageIndex = tool === "ink" || drawingShape ? pageAt(point) : -1, points: [number, number][] = tool === "ink" ? [pageLocal(point, pageIndex)] : [[point.x, point.y]];
    const ink: EditorInkInput | undefined = tool === "ink" ? { kind: "ink", pageIndex, paths: [points], opacity: objectOpacity, fillOpacity,
      smoothing: editorInkCaptureTolerance(point, p => host.sceneToClientPoint(p.x, p.y, pageIndex)),
      color: property("color").value, strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null } : undefined;
    if (ink && (!Number.isFinite(ink.strokeWidth) || ink.strokeWidth! < 0)) throw new RangeError("Stroke width must be a finite number at least 0.");
    const shape = drawingShape ? createShapeDraft(tool as EditorShapeInput["shape"], pageIndex) : undefined;
    pointer = { id: event.pointerId, start: point, startClient: client, last: point, points, ink, shape, bounds: session.getSelectionBounds(), frame: gestureFrame ?? session.getSelectionFrame() ?? undefined, action, additive, handle: handle ?? undefined,
      freeResize: event.shiftKey, scaleText: event.altKey, freeRotation: event.altKey };
    alignmentSnap = action === "move" ? createEditorAlignmentSnap(session) : null;
    updateShapeGesture(pointer, point);
    updatePointerCursor();
    overlay.setPointerCapture?.(event.pointerId);
  }
  async function pickLinkTarget(event: PointerEvent): Promise<void> {
    if (!active || disposed || running || savePreparing || structuralRunning || activeText || pointer || pendingPick || event.button !== 0 || cameraPan.isPanning() || isSceneSettling()) return;
    const point = host.clientToScenePoint(event.clientX, event.clientY); if (!point) return;
    event.preventDefault(); event.stopPropagation();
    const client = { x: event.clientX, y: event.clientY }, requestId = ++textRequest;
    const request = { id: event.pointerId, point, client, lastClient: client, released: false, canceled: false };
    const sourceScene = session.sourceScene, revision = session.revision, selected = JSON.stringify(session.getSelection());
    const projection = host.sceneToClientPoint(point.x, point.y);
    pendingPick = request; overlay.setPointerCapture?.(event.pointerId); updatePointerCursor();
    try {
      const id = await pick(point, client), currentProjection = host.sceneToClientPoint(point.x, point.y);
      if (!links.isPicking() || disposed || !active || running || savePreparing || structuralRunning || request.canceled || pendingPick !== request || requestId !== textRequest ||
          sourceScene !== session.sourceScene || revision !== session.revision || selected !== JSON.stringify(session.getSelection()) || !projection || !currentProjection ||
          Math.abs(projection.x - currentProjection.x) + Math.abs(projection.y - currentProjection.y) > .1) return;
      pendingPick = null;
      if (id) links.pickTarget(id);
      else setStatus("No object was found. Click the destination object, or press Escape to return to link settings.");
    } finally {
      if (pendingPick === request) pendingPick = null;
      if (overlay.hasPointerCapture?.(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
      updatePointerCursor(); updateLinkButtons();
    }
  }
  function pointerMove(event: PointerEvent): void {
    fieldActivation.pointerMove(event);
    if (active && tool === "signature") signatureHover = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
    if (active && polygon && (tool === "polygon" || tool === "polyline")) {
      const point = host.clientToScenePoint(event.clientX, event.clientY, polygon.pageIndex);
      updatePolygonPreview(point && pageAt(point) === polygon.pageIndex ? pageLocal(point, polygon.pageIndex) : null);
    }
    if (pendingPick?.id === event.pointerId) pendingPick.lastClient = { x: event.clientX, y: event.clientY };
    if (!pointer || event.pointerId !== pointer.id) return;
    const point = host.clientToScenePoint(event.clientX, event.clientY, pointer.ink?.pageIndex ?? pointer.shape?.pageIndex ?? (pointer.action !== "draw" && pointer.action !== "marquee" ? pointer.frame?.pageIndex : undefined)); if (!point) return;
    pointer.last = point; pointer.freeResize = event.shiftKey; pointer.scaleText = event.altKey; pointer.freeRotation = event.altKey;
    if (pointer.action === "draw" && tool === "ink") {
      const pageIndex = pointer.ink!.pageIndex;
      appendEditorInkSamples(pointer.points, event, sample => {
        const p = host.clientToScenePoint(sample.clientX, sample.clientY, pageIndex); return p ? pageLocal(p, pageIndex) : null;
      });
    } else if (pointer.action === "draw" && pointer.shape) updateShapeGesture(pointer, point);
    else if (pointer.bounds && ["move", "resize", "rotate"].includes(pointer.action)) {
      // Click jitter must not start an asynchronous scene preview/restoration.
      if (!pointer.dragging && Math.hypot(event.clientX - pointer.startClient.x, event.clientY - pointer.startClient.y) <= 2) return;
      pointer.dragging = true;
      const matrix = dragMatrix(pointer, point);
      if (matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0) { interaction.previewTransform(matrix); requestedPreview = matrix; queuePreview(); }
      else clearPreview(true);
    }
    event.preventDefault();
  }
  function transformModifiers(event: KeyboardEvent): void {
    if (!active || running || event.isComposing || !pointer?.bounds || !pointer.dragging ||
        !(pointer.action === "resize" && (event.key === "Shift" || event.key === "Alt") || (pointer.action === "rotate" || pointer.action === "move") && event.key === "Alt")) return;
    pointer.freeResize = event.shiftKey; pointer.scaleText = event.altKey; pointer.freeRotation = event.altKey;
    const matrix = dragMatrix(pointer, pointer.last);
    if (matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0) { interaction.previewTransform(matrix); requestedPreview = matrix; queuePreview(); }
    else clearPreview(true);
  }
  function pointerUp(event: PointerEvent): void {
    const field = fieldActivation.pointerUp(event);
    if (field && canActivateField() && field.sourceScene === session.sourceScene && field.revision === session.revision &&
        fieldAtClientPoint({ x: event.clientX, y: event.clientY }) === field.id) {
      event.preventDefault(); event.stopPropagation(); activateField(field.id); return;
    }
    if (pendingPick?.id === event.pointerId) { pendingPick.released = true; pendingPick.lastClient = { x: event.clientX, y: event.clientY }; overlay.releasePointerCapture?.(event.pointerId); }
    const p = pointer; if (!p || event.pointerId !== p.id) return; pointer = null; updatePointerCursor();
    try {
      if (p.action === "draw" && tool === "ink") {
        const pageIndex = p.ink!.pageIndex;
        appendEditorInkSamples(p.points, event, sample => {
          const point = host.clientToScenePoint(sample.clientX, sample.clientY, pageIndex); return point ? pageLocal(point, pageIndex) : null;
        });
      }
      if (p.action === "draw" && p.shape) {
        p.last = host.clientToScenePoint(event.clientX, event.clientY, p.shape.pageIndex) ?? p.last;
        updateShapeGesture(p, p.last);
      }
      if (p.action === "resize" || p.action === "rotate" || p.action === "move") {
        p.last = host.clientToScenePoint(event.clientX, event.clientY, p.frame?.pageIndex) ?? p.last;
        p.freeResize = event.shiftKey; p.scaleText = event.altKey; p.freeRotation = event.altKey;
      }
      clearPreview(true);
      overlay.releasePointerCapture?.(event.pointerId);
      const moved = Math.hypot(event.clientX - p.startClient.x, event.clientY - p.startClient.y) > 2;
      if (p.action === "marquee") {
        interaction.selectArea({ minX: Math.min(p.start.x, p.last.x), minY: Math.min(p.start.y, p.last.y), maxX: Math.max(p.start.x, p.last.x), maxY: Math.max(p.start.y, p.last.y) }, { shiftKey: p.additive });
      } else if (p.action !== "draw") {
        if (moved && p.bounds) {
          const selection = session.getSelection(), object = selection.length === 1 ? session.getObject(selection[0]) : null;
          const matrix = dragMatrix(p, p.last);
          if (matrix[0] * matrix[3] - matrix[1] * matrix[2] === 0) return;
          if (p.action === "resize" && object?.kind === "text" && !p.scaleText) {
            const patch = resizeTextBox(p, object, matrix);
            if (patch) commit(() => session.updateObject(object.id, patch));
            else commit(() => interaction.applyTransform(matrix));
          } else commit(() => interaction.applyTransform(matrix));
        }
      } else if (moved || tool === "ink") {
        const object = p.ink ?? p.shape; if (!object) return;
        commit(() => { const id = session.addObject(object); pendingDrawings.add(id); session.select([id]); });
      }
    } finally { alignmentSnap = null; requestedGuides = []; }
  }
  function completePolygon(doubleClick = false): void {
    // A double-click's second press finishes the first press's endpoint, even
    // when slight pointer drift would otherwise add a tiny extra segment.
    if (doubleClick && polygon?.previousPointCount !== undefined) polygon.points.length = polygon.previousPointCount;
    if (!polygon || new Set(polygon.points.map(point => `${point[0]},${point[1]}`)).size < (polygon.object.shape === "polyline" ? 2 : 3)) { polygon = null; return; }
    updatePolygonPreview(); const object = polygon.preview; polygon = null;
    commit(() => { const id = session.addObject(object); pendingDrawings.add(id); session.select([id]); });
  }
  async function activateFont(font: EditorFont): Promise<void> {
    if (fontFaces.has(font.id)) return;
    let pending = fontFaceLoads.get(font.id);
    if (!pending) {
      pending = (async () => {
        const face = new FontFace(font.id, font.bytes.slice().buffer, { weight: String(font.fontWeight), style: font.fontStyle });
        await face.load(); if (disposed) throw new DOMException("Editor closed.", "AbortError");
        document.fonts.add(face); fontFaces.set(font.id, face);
      })();
      fontFaceLoads.set(font.id, pending);
    }
    try { await pending; } finally { if (fontFaceLoads.get(font.id) === pending) fontFaceLoads.delete(font.id); }
  }
  async function selectedFont(id = query<HTMLSelectElement>('[data-prop="font"]').value): Promise<EditorFont> {
    return id && !id.startsWith("bundled:") ? editorServices.fonts.get(id) : editorServices.fonts.loadBundled(id === "bundled:serif" ? "Liberation Serif" : id === "bundled:mono" ? "Liberation Mono" : "Liberation Sans");
  }
  async function startText(point: PrimitivePoint, object?: EditorTextObject, sourceAnnotationId?: string): Promise<void> {
    if (structuralRunning || running || savePreparing) return;
    const request = ++textRequest;
    const pageIndex = object?.pageIndex ?? pageAt(point); if (pageIndex < 0) return;
    const layerId = object ? null : session.getActiveLayer();
    if (!object && layerId && session.getLayers().find(layer => layer.id === layerId)?.defaultVisible === false) throw new Error("Show the active layer before creating a textbox.");
    const font = object ? await editorServices.fonts.resolve(object) : await selectedFont();
    await activateFont(font); if (disposed || !active || running || savePreparing || request !== textRequest) return;
    if (object) {
      updateFonts(); query<HTMLSelectElement>('[data-prop="font"]').value = font.id;
      property("font-size").value = String(object.fontSize); property("color").value = normalizeEditorTextColor(colorCss(object.color));
      syncOpacityControls("opacity", object.opacity ?? 1, false);
      query<HTMLSelectElement>('[data-prop="align"]').value = object.align ?? "left";
      for (const [name, enabled] of Object.entries({ bold: object.fontWeight === "bold" || Number(object.fontWeight) >= 600,
        italic: object.fontStyle === "italic" || object.fontStyle === "oblique", underline: Boolean(object.underline), strikethrough: Boolean(object.strikethrough) })) query(`[data-style="${name}"]`).setAttribute("aria-pressed", String(enabled));
    }
    const [x, y] = object ? [object.x, object.y] : pageLocal(point, pageIndex);
    const element = document.createElement("div"); element.className = "hepr-editor-text-input"; element.contentEditable = "true";
    element.setAttribute("role", "textbox"); element.setAttribute("aria-label", "Textbox text"); element.setAttribute("aria-multiline", "true");
    element.addEventListener("paste", event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? ""); });
    element.addEventListener("input", () => recovery?.draftChanged());
    Object.assign(element.style, { fontFamily: `"${font.id}"`, fontSize: `${object?.fontSize ?? Number(property("font-size").value)}px`,
      color: object ? colorCss(object.color) : property("color").value, fontWeight: object?.fontWeight ?? (styleEnabled("bold") ? "bold" : "normal"),
      fontStyle: object?.fontStyle ?? (styleEnabled("italic") ? "italic" : "normal"), whiteSpace: "pre-wrap", textAlign: object?.align ?? query<HTMLSelectElement>('[data-prop="align"]').value,
      lineHeight: String(object?.lineHeight ?? 1.2),
      textDecorationLine: [(object?.underline ?? styleEnabled("underline")) && "underline", (object?.strikethrough ?? styleEnabled("strikethrough")) && "line-through"].filter(Boolean).join(" ") });
    if (object?.runs?.length) {
      for (const run of object.runs) {
        const face = await editorServices.fonts.resolve(run); await activateFont(face);
        const span = document.createElement("span"); span.textContent = run.text;
        Object.assign(span.style, { fontFamily: `"${face.id}"`, fontSize: `${run.fontSize ?? object.fontSize}px`,
          fontWeight: String(run.fontWeight ?? object.fontWeight ?? "normal"), fontStyle: run.fontStyle ?? "normal", color: colorCss(run.color ?? object.color),
          textDecorationLine: [run.underline && "underline", run.strikethrough && "line-through"].filter(Boolean).join(" ") }); element.append(span);
      }
    } else element.textContent = object?.text ?? "";
    if (disposed || !active || running || savePreparing || request !== textRequest) return;
    activeText = { element, objectId: sourceAnnotationId ? undefined : object?.id, sourceAnnotationId, layerId, pageIndex, x, y: object ? y : y - 50,
      width: object?.width ?? 220, height: object?.height ?? 50, transform: object?.transform ?? IDENTITY, opacity: object?.opacity ?? objectOpacity, lineHeight: object?.lineHeight,
      baseline: { html: element.innerHTML, align: element.style.textAlign, opacity: object?.opacity ?? objectOpacity } };
    overlay.append(element); query('[data-action="apply-text"]').hidden = false; query('[data-action="cancel-text"]').hidden = false;
    updateClipboardButtons();
    updateAppearanceControls();
    updateGeometry(); if (!element.hidden) element.focus(); activeText.baseline.html = element.innerHTML;
  }
  function cancelText(): void {
    const hadDraft = activeText !== null;
    textRequest++;
    activeText?.element.remove(); activeText = null;
    query('[data-action="apply-text"]').hidden = true; query('[data-action="cancel-text"]').hidden = true;
    updateClipboardButtons();
    updateAppearanceControls();
    if (hadDraft) recovery?.draftChanged();
  }
  async function finishText(signal?: AbortSignal, finishingSaveDraft = false): Promise<void> {
    if (!activeText) return;
    signal?.throwIfAborted();
    const editing = activeText, element = editing.element;
    const request = textRequest;
    const text = element.innerText ?? element.textContent ?? "";
    if (!text) {
      if (editing.objectId || editing.sourceAnnotationId) commit(() => { commitEditorText(session, null, editing); cancelText(); }, finishingSaveDraft);
      else cancelText();
      return;
    }
    const object = await readTextDraft();
    signal?.throwIfAborted();
    if (!object || disposed || activeText !== editing || request !== textRequest) return;
    commit(() => { commitEditorText(session, object, editing); cancelText(); }, finishingSaveDraft);
  }
  async function readTextDraft(): Promise<Extract<EditorObjectInput, { kind: "text" }> | null> {
    const editing = activeText; if (!editing) return null;
    const font = await selectedFont(), element = editing.element;
    const text = element.innerText ?? element.textContent ?? "";
    const runs = readRichTextRuns(element, window, editorServices.fonts.list(), font?.id, font?.family);
    const height = Math.max(editing.height, element.scrollHeight, editing.hiddenHeight ?? 0);
    return { kind: "text", pageIndex: editing.pageIndex, x: editing.x, y: editing.y + editing.height - height, width: editing.width,
      transform: editing.transform, opacity: editing.opacity, lineHeight: editing.lineHeight,
      ...(!editing.objectId ? { layerId: editing.sourceAnnotationId ? null : editing.layerId ?? null } : {}),
      height, text, fontId: font?.id, fontFamily: font?.family,
      fontSize: Number(property("font-size").value), color: property("color").value, fontWeight: styleEnabled("bold") ? "bold" : "normal",
      fontStyle: styleEnabled("italic") ? "italic" : "normal", underline: styleEnabled("underline"), strikethrough: styleEnabled("strikethrough"),
      align: query<HTMLSelectElement>('[data-prop="align"]').value as "left" | "center" | "right", runs };
  }
  function applyTextStyle(name: string): void {
    if (structuralRunning || running || savePreparing) return;
    const button = query(`[data-style="${name}"]`); button.setAttribute("aria-pressed", String(!styleEnabled(name)));
    if (activeText) { activeText.element.focus(); document.execCommand(name === "strikethrough" ? "strikeThrough" : name); recovery?.draftChanged(); }
    else if (tool === "select") {
      const enabled = styleEnabled(name), patch: Partial<EditorTextObject> = name === "bold" ? { fontWeight: enabled ? "bold" : "normal" } : name === "italic" ? { fontStyle: enabled ? "italic" : "normal" } : name === "underline" ? { underline: enabled } : { strikethrough: enabled };
      if (editorPropertySelection(session, "fontStyle").length) commit(() => { applyEditorPropertyPatch(session, patch); });
    }
  }
  function updateFonts(): void {
    const select = query<HTMLSelectElement>('[data-prop="font"]'), selected = select.value; select.replaceChildren();
    for (const [value, label] of [["", "Liberation Sans"], ["bundled:serif", "Liberation Serif"], ["bundled:mono", "Liberation Mono"]]) {
      const fallback = document.createElement("option"); fallback.value = value; fallback.textContent = label; select.append(fallback);
    }
    for (const font of editorServices.fonts.list()) { const option = document.createElement("option"); option.value = font.id; option.textContent = `${font.family} ${font.fontWeight >= 600 ? "Bold" : ""} ${font.fontStyle === "italic" ? "Italic" : ""}`.trim(); select.append(option); }
    select.value = selected;
    updateAppearanceControls();
  }
  function chooseFile(accept: string, onFile: (file: File) => Promise<void>): void {
    const input = document.createElement("input"); input.type = "file"; input.accept = accept;
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void onFile(file).catch(report); }); input.click();
  }
  async function decodeImage(file: File, isCurrent: () => boolean, signal?: AbortSignal): Promise<EditorImageData | null> {
    signal?.throwIfAborted();
    const pending = createImageBitmap(file);
    let bitmap: ImageBitmap;
    try { bitmap = await waitForLoad(pending, signal); }
    catch (error) { void pending.then(value => value.close(), () => {}); throw error; }
    try {
      signal?.throwIfAborted(); if (!isCurrent()) return null;
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Image decoding is unavailable."); context.drawImage(bitmap, 0, 0);
      return { kind: "image", imageWidth: bitmap.width, imageHeight: bitmap.height, data: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
    } finally { bitmap.close(); }
  }
  async function importImage(file: File, request: number): Promise<void> {
    const image = await decodeImage(file, () => !disposed && active && request === toolRequest);
    if (!image || disposed || !active || request !== toolRequest) return;
    pendingImage = image; setTool("image"); setStatus("Click the page to place the image.");
  }
  async function dropImages(files: readonly File[], client: { x: number; y: number }, externalSignal?: AbortSignal): Promise<void> {
    lifetime.signal.throwIfAborted(); externalSignal?.throwIfAborted();
    if (!active) throw new Error("Switch to Edit mode before dropping images.");
    if (running || savePreparing || structuralRunning) throw new Error("Wait for the current operation to finish.");
    if (links.isOpen()) throw new Error("Apply or cancel the pending link before dropping images.");
    if (!files.length) return;
    if (files.some(file => droppedFileKind(file) !== "image")) throw new TypeError("Drop PNG, JPEG or WebP images.");
    const canvas = host.getCanvas(), rect = canvas.getBoundingClientRect();
    if (!Number.isFinite(client.x) || !Number.isFinite(client.y) || client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom)
      throw new Error("Drop images onto a document page.");
    const sourceScene = session.sourceScene, point = host.clientToScenePoint(client.x, client.y), pageIndex = point ? pageAt(point) : -1;
    if (!point || pageIndex < 0) throw new Error("Drop images onto a document page.");
    const [x, y] = pageLocal(point, pageIndex), previousRequest = toolRequest;
    const initialSignal = externalSignal ? AbortSignal.any([lifetime.signal, externalSignal]) : lifetime.signal;
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) throw new Error("Check the pending form value before adding images.");
    if (activeText) await waitForLoad(finishText(), initialSignal);
    initialSignal.throwIfAborted();
    if (activeText) throw new Error("Finish the active textbox before adding images.");
    if (!active || sourceScene !== session.sourceScene || previousRequest !== toolRequest) throw new DOMException("The image drop was superseded.", "AbortError");
    if (running || savePreparing || structuralRunning) throw new Error("Wait for the current operation to finish.");
    pendingImage = null; setTool("select");
    const request = toolRequest, opacity = objectOpacity, ids: string[] = [];
    let expectedRevision = session.revision;
    running = true; updatePointerCursor(); host.onBusyChange?.(true);
    operation?.abort(); const abort = new AbortController(); operation = abort;
    const signal = AbortSignal.any([initialSignal, abort.signal]);
    query('[data-action="cancel-operation"]').hidden = false;
    const isCurrent = (): boolean => !disposed && active && request === toolRequest && sourceScene === session.sourceScene && expectedRevision === session.revision;
    try {
      for (let index = 0; index < files.length; index++) {
        signal.throwIfAborted(); if (!isCurrent()) throw new DOMException("The image drop was superseded.", "AbortError");
        setStatus(`Adding image ${index + 1} of ${files.length}…`);
        const image = await decodeImage(files[index], isCurrent, signal);
        signal.throwIfAborted(); if (!image || !isCurrent()) throw new DOMException("The image drop was superseded.", "AbortError");
        const width = Math.min(240, (sourceScene.pageRects[pageIndex * 4 + 2] - sourceScene.pageRects[pageIndex * 4]) * .5);
        const height = width * image.imageHeight / image.imageWidth;
        cancelPointerGesture(false);
        ids.push(session.addObject({ ...image, kind: "image", pageIndex, opacity, x, y: y - height, width, height }));
        session.select(ids); expectedRevision = session.revision; void refreshScene();
      }
      setStatus(`${ids.length} ${ids.length === 1 ? "image" : "images"} added.`);
    } catch (error) {
      if (!disposed && (signal.aborted || error instanceof DOMException && error.name === "AbortError")) {
        const retained = sourceScene === session.sourceScene && expectedRevision === session.revision ? ids.length : 0;
        setStatus(retained ? `Image import cancelled; ${retained} ${retained === 1 ? "image remains" : "images remain"} added.` : "Image import cancelled.");
      }
      throw error;
    } finally {
      if (!disposed && ids.length) await refreshScene(lifetime.signal);
      if (operation === abort) operation = null;
      running = false;
      if (!disposed) { updatePointerCursor(); query('[data-action="cancel-operation"]').hidden = true; host.onBusyChange?.(false); }
    }
  }
  function placeImage(point: PrimitivePoint): void {
    if (!pendingImage) return; const pageIndex = pageAt(point), [x, y] = pageLocal(point, pageIndex), image = pendingImage;
    const width = Math.min(240, (session.sourceScene.pageRects[pageIndex * 4 + 2] - session.sourceScene.pageRects[pageIndex * 4]) * 0.5), height = width * image.imageHeight / image.imageWidth;
    commit(() => { const id = session.addObject({ ...image, kind: "image", pageIndex, opacity: objectOpacity, x, y: y - height, width, height }); session.select([id]); }); setTool("select");
  }
  function placeSignature(point: PrimitivePoint): void {
    if (!signature) return;
    const placement = signaturePlacementAt(point); if (!placement) return;
    const { pageIndex, transform: [a, , , d, e, f], scale } = placement, asset = signature;
    commit(() => { const id = session.addObject({ kind: "signature", pageIndex, opacity: objectOpacity, fillOpacity,
      paths: asset.paths.map(path => Array.from({ length: path.length / 2 }, (_, index) => [e + path[index * 2] * a, f + path[index * 2 + 1] * d] as [number, number])),
      ...(asset.smoothing !== undefined ? { smoothing: asset.smoothing * Math.abs(scale) } : {}),
      color: property("color").value, strokeWidth: Number(property("stroke").value) }); pendingDrawings.add(id); session.select([id]); });
  }
  async function save(kind: "pdf" | "flatten" | "hep" | "print"): Promise<void> {
    if (disposed || running || savePreparing || structuralRunning || recoveryRunning || recoveryDialog) return;
    if (links.isOpen()) { setStatus("Apply or cancel the pending link before saving or printing."); return; }
    if ((kind === "pdf" || kind === "flatten") && passwordDialog && !passwordDialog.apply()) return;
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) { setStatus("Check the pending form value before saving or printing."); return; }
    operation?.abort(); const abort = new AbortController(); operation = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal]), previousInert = Boolean(overlay.inert);
    savePreparing = true; overlay.inert = true; host.onBusyChange?.(true);
    query('[data-action="cancel-operation"]').hidden = false;
    try {
      if (activeText) await waitForLoad(finishText(signal, true), signal);
      signal.throwIfAborted();
      if (activeText) { setStatus("Check the active textbox before saving or printing."); return; }
      if (!review.flushDraft()) return;
      if (!links.flushDraft()) return;
      const protection = kind === "pdf" || kind === "flatten" ? pdfProtection.get() : undefined;
      const wasPreviewing = session.getState().previewing;
      cancelPointerGesture(false); running = true; savePreparing = false; updatePointerCursor(); updateClipboardButtons();
      setStatus(`Preparing ${kind === "hep" ? "HEP" : "PDF"}…`);
      if (wasPreviewing) await refreshScene(signal);
      const sourceScene = session.sourceScene, revision = session.getState().revision;
      const unchanged = (): boolean => sourceScene === session.sourceScene && revision === session.getState().revision;
      let outputKind = kind;
      if (kind === "pdf" && (session.sourcePdf || session.getLayerEdits?.().stackingChanged || session.getLayerEdits?.().objectOrderChanged)) {
        const committed = await session.getScene({ signal, preview: false });
        if (!unchanged()) throw new Error("The document changed while preparing the export. Save again.");
        const layerStacking = Boolean((session.getLayerEdits?.().stackingChanged || session.getLayerEdits?.().objectOrderChanged) &&
          ((committed.annotations?.length ?? 0) || session.getObjects({ includeSource: false }).length));
        if (layerStacking || (session.sourcePdf && findEditorPdfFormOverlaps(committed, session, { signal }).length)) {
          const choice = await chooseEditorPdfFormExport(document, signal, { layerStacking });
          if (!choice) { setStatus("PDF export cancelled"); return; }
          if (!unchanged()) throw new Error("The document changed while choosing the PDF format. Save again.");
          outputKind = choice;
        }
      }
      const warnings: string[] = [], onWarning = (value: string): void => {
        if (!value || warnings.includes(value)) return;
        warnings.push(value); setStatus(value);
      };
      const onDiagnostic = (diagnostic: PdfDiagnostic): void => { if (diagnostic.severity !== "info" && diagnostic.message) onWarning(diagnostic.message); };
      const progress = new LoadProgressReporter(value => setStatus(`Preparing ${kind === "hep" ? "HEP" : "PDF"}… ${Math.round(value.value * 100)}%`));
      let blob: Blob;
      if (kind === "print") {
        const { writeScenePdf } = await import("./editorPdfWriter");
        blob = await writeScenePdf(await session.getScene({ signal, preview: false, onProgress: progress.child(0, .4).toCallback() }),
          { signal, onWarning, onProgress: progress.child(.4, 1).toCallback() });
      } else blob = kind === "hep" ? await session.saveHep({ signal, markSaved: false, onProgress: progress.toCallback() })
        : await session.savePdf({ signal, markSaved: false, flatten: outputKind === "flatten", protection, onWarning, onDiagnostic, onProgress: progress.toCallback() });
      signal.throwIfAborted();
      if (!unchanged()) throw new Error("The document changed while preparing the export. Save again.");
      if (kind === "print") printPdfBlob(blob, document, { filename: "edited-print.pdf", title: "Print edited PDF" });
      else { const base = formatPdfDownloadFilename(source.label).replace(/\.pdf$/i, ""); triggerBrowserDownload(blob, `${base}${kind === "hep" ? "-edited.hep" : outputKind === "flatten" ? "-flattened.pdf" : "-edited.pdf"}`); }
      if (kind !== "print") { exportedRevision = session.revision; await recovery?.flush(); }
      setStatus([kind === "print" ? "Print-ready PDF opened" : "Download started; local edits and recovery draft kept.", ...warnings].join(" "));
    } catch (error) { report(error); }
    finally {
      if (operation === abort) operation = null;
      running = savePreparing = false; overlay.inert = previousInert || structuralRunning || recoveryRunning;
      host.onBusyChange?.(false);
      if (!disposed) { updatePointerCursor(); updateClipboardButtons(); query('[data-action="cancel-operation"]').hidden = true; }
    }
  }
  async function runPageOperation(change: (options: { signal: AbortSignal; onProgress: LoadProgressCallback; onDiagnostic: (diagnostic: PdfDiagnostic) => void }) => Promise<void>, externalSignal?: AbortSignal): Promise<void> {
    lifetime.signal.throwIfAborted(); externalSignal?.throwIfAborted();
    if (running || savePreparing || structuralRunning) throw new Error("Wait for the current operation to finish.");
    if (links.isOpen()) throw new Error("Apply or cancel the pending link before changing pages.");
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) throw new Error("Check the pending form value before changing pages.");
    if (activeText) await finishText();
    if (!review.flushDraft()) throw new Error("Apply or cancel the pending comment before changing pages.");
    if (!links.flushDraft()) throw new Error("Apply or cancel the pending link before changing pages.");
    lifetime.signal.throwIfAborted(); externalSignal?.throwIfAborted();
    if (running || savePreparing || structuralRunning) throw new Error("Wait for the current operation to finish.");
    structuralRunning = running = true; toolbar.inert = overlay.inert = true;
    host.onBusyChange?.(true);
    polygon = null; textRequest++; cancelPointerGesture(false);
    operation?.abort(); const abort = new AbortController(); operation = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal, ...(externalSignal ? [externalSignal] : [])]);
    query('[data-action="cancel-operation"]').hidden = false;
    const warnings: string[] = []; pagesDialog?.setWarnings(warnings);
    const onDiagnostic = (diagnostic: PdfDiagnostic): void => {
      if (diagnostic.severity === "info" || !diagnostic.message || warnings.includes(diagnostic.message)) return;
      warnings.push(diagnostic.message); pagesDialog?.setWarnings(warnings);
    };
    const progress = new LoadProgressReporter(value => {
      const text = `Updating pages… ${Math.round(value.value * 100)}%`; setStatus([text, ...warnings].join(" ")); pagesDialog?.setStatus(text);
    });
    try { await change({ signal, onProgress: progress.toCallback(), onDiagnostic }); signal.throwIfAborted(); }
    finally {
      // A cancelled later import can leave earlier completed imports committed.
      // Refresh with the editor lifetime so those pages still become visible.
      if (!disposed) await refreshScene(lifetime.signal);
      if (operation === abort) operation = null;
      structuralRunning = running = false; toolbar.inert = overlay.inert = false;
      host.onBusyChange?.(false);
      updatePointerCursor();
      query('[data-action="cancel-operation"]').hidden = true;
      if (!disposed) { pagesDialog?.refresh(); updateState(session.getState()); if (warnings.length) setStatus(warnings.join(" ")); }
    }
  }
  async function attachDocuments(files: readonly File[], signal?: AbortSignal): Promise<void> {
    lifetime.signal.throwIfAborted(); signal?.throwIfAborted(); if (!files.length) return;
    const before = session.getPages().length, warnings: string[] = [];
    try {
      await runPageOperation(options => insertEditorDocumentFiles(session, files, session.getPages().length, { ...options,
        onDiagnostic(diagnostic) { options.onDiagnostic(diagnostic); if (diagnostic.severity !== "info" && !warnings.includes(diagnostic.message)) warnings.push(diagnostic.message); }
      }), signal);
      const added = session.getPages().length - before;
      setStatus([`${added} ${added === 1 ? "page" : "pages"} attached.`, ...warnings].join(" "));
    } catch (error) {
      if (!disposed && (signal?.aborted || error instanceof DOMException && error.name === "AbortError")) {
        const added = session.getPages().length - before;
        setStatus(added ? `Attachment cancelled; ${added} ${added === 1 ? "page remains" : "pages remain"} attached.` : "Attachment cancelled.");
      }
      throw error;
    }
  }
  toolbar.addEventListener("pointerdown", event => { if ((event.target as Element).closest("[data-style]")) event.preventDefault(); });
  toolbar.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button"); if (!button) return;
    if (running || savePreparing || structuralRunning) { if (button.dataset.action === "cancel-operation") operation?.abort(); return; }
    if (links.isOpen() && !button.dataset.tool) { setStatus("Apply or cancel the pending link before using another editing command."); return; }
    if (button.dataset.tool) { setTool(button.dataset.tool as Tool); return; }
    if (button.dataset.style) { applyTextStyle(button.dataset.style); return; }
    if (button.dataset.action?.startsWith("align-")) {
      commit(() => alignEditorSelection(session, button.dataset.action!.slice(6) as EditorAlignment, query<HTMLSelectElement>("[data-layout-reference]").value as "selection" | "page")); return;
    }
    if (button.dataset.action?.startsWith("distribute-")) {
      commit(() => distributeEditorSelection(session, button.dataset.action === "distribute-horizontal" ? "horizontal" : "vertical")); return;
    }
    switch (button.dataset.action) {
      case "layers":
        if (layerDialog && !layerDialog.open) layerDialog.showModal();
        host.showLayerControls?.(); layerControls.show(); break;
      case "undo": changeHistory(false); break; case "redo": changeHistory(true); break;
      case "copy": case "cut": case "paste": case "duplicate": void runClipboard(button.dataset.action); break;
      case "delete": commit(() => session.deleteSelection()); break;
      case "group": commit(() => session.groupSelection()); break; case "ungroup": commit(() => session.ungroupSelection()); break;
      case "lock": commit(() => session.setObjectsLocked(session.getSelection(), true)); break;
      case "unlock": commit(() => session.setObjectsLocked(session.getSelection(), false)); break;
      case "edit-comment": try { review.editSelection(); } catch (error) { report(error); } break;
      case "link": openLinkEditor(); break;
      case "remove-link": links.removeSelection(); break;
      case "guides": button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true")); break;
      case "recovery": void openRecovery(); break;
      case "apply-text": void finishText().catch(report); break; case "cancel-text": cancelText(); break;
      case "cancel-operation": operation?.abort(); break;
      case "pages":
        if (!pagesDialog) pagesDialog = showEditorPagesDialog(document, {
          getPages: () => session.getPages(),
          rotate: (indices, degrees) => runPageOperation(options => session.rotatePages(indices, degrees, options)),
          remove: indices => runPageOperation(options => session.removePages(indices, options)),
          insert: (files, at) => runPageOperation(options => insertEditorPdfFiles(session, files, at, options)),
          reorder: order => runPageOperation(options => session.reorderPages(order, options)),
          duplicate: (indices, at) => runPageOperation(options => session.duplicatePages(indices, { ...options, at })),
          crop: (indices, box) => runPageOperation(options => session.cropPages(indices, box, options)),
          extract: indices => runPageOperation(async options => {
            const blob = await session.extractPages(indices, options); options.signal.throwIfAborted();
            triggerBrowserDownload(blob, `${formatPdfDownloadFilename(source.label).replace(/\.pdf$/i, "")}-pages.pdf`);
          }),
          cancel: () => operation?.abort(), onError: report, onClose: () => { pagesDialog = null; }
        });
        break;
      case "pdf-password":
        if (!passwordDialog) passwordDialog = showEditorPdfPasswordDialog(document, pdfProtection.get(), value => {
          pdfProtection.set(value); updateState(session.getState());
        }, () => { passwordDialog = null; if (!disposed) updateState(session.getState()); });
        break;
      case "save-pdf": void save("pdf"); break; case "flatten": void save("flatten"); break; case "save-hep": void save("hep"); break; case "print": void save("print"); break;
      case "font": chooseFile(".ttf,.otf,font/ttf,font/otf", async file => { const font = await editorServices.fonts.register(new Uint8Array(await file.arrayBuffer())); await activateFont(font); updateFonts(); query<HTMLSelectElement>('[data-prop="font"]').value = font.id; }); break;
      case "local-fonts": void editorServices.fonts.requestLocalFonts().then(updateFonts).catch(report); break;
      case "image": {
        const request = ++toolRequest;
        chooseFile("image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp", file => importImage(file, request)); break;
      }
      case "signatures": signatureHover = null; showSignatureDialog(document, value => { signature = value; setTool("signature"); setStatus("Click to place the signature centered on the cursor. Escape returns to Select."); }, report); break;
    }
  });
  function toolbarInput(event: Event): void {
    if (running || savePreparing || structuralRunning) return;
    const input = event.target as HTMLInputElement;
    if (input.dataset.transform === "rotation") rotationDraft = { selection: currentState.selection, sourceScene: session.sourceScene };
    else opacityInput(event);
  }
  toolbar.addEventListener("input", toolbarInput);
  function preventBusyInput(event: InputEvent): void {
    if (running || savePreparing || structuralRunning) event.preventDefault();
  }
  toolbar.addEventListener("beforeinput", preventBusyInput);
  overlay.addEventListener("beforeinput", preventBusyInput);
  function changeAppearance(input: HTMLInputElement): void {
    if (running || savePreparing || structuralRunning) return;
    if (activeText) {
      activeText.element.focus();
      if (input.dataset.prop === "color") document.execCommand("foreColor", false, input.value);
      if (input.dataset.prop === "font") {
        const editing = activeText;
        void selectedFont(input.value).then(async font => { await activateFont(font);
          if (disposed || running || savePreparing || structuralRunning || activeText !== editing) return;
          document.execCommand("fontName", false, font.id); recovery?.draftChanged(); }).catch(report);
      }
      if (input.dataset.prop === "font-size") applySelectionCss(document, "fontSize", `${Number(input.value)}px`);
      if (input.dataset.prop === "align") activeText.element.style.textAlign = input.value;
      recovery?.draftChanged();
    } else if (tool === "select") {
      const selection = session.getSelection(); if (!selection.length || input.value === "__mixed__") return;
      const patch: Partial<EditorObject> = input.dataset.prop === "color" ? { color: input.value } : input.dataset.prop === "stroke" ? { strokeWidth: Number(input.value) } :
        input.dataset.prop === "fill" || input.dataset.prop === "fill-enabled" ? { fill: property("fill-enabled").checked ? property("fill").value : null } : {};
      if (input.dataset.prop === "font-size") Object.assign(patch, { fontSize: Number(input.value) });
      if (input.dataset.prop === "align") Object.assign(patch, { align: input.value });
      if (input.dataset.prop === "font" && editorPropertySelection(session, "fontId", selection).length)
        void selectedFont(input.value).then(font => commit(() => { applyEditorPropertyPatch(session, { fontId: font.id, fontFamily: font.family }, selection); })).catch(report);
      const propertyName = input.dataset.prop === "stroke" ? "strokeWidth" : input.dataset.prop === "font-size" ? "fontSize"
        : input.dataset.prop === "fill-enabled" ? "fill" : input.dataset.prop;
      if (Object.keys(patch).length && ["color", "strokeWidth", "fill", "fontSize", "align"].includes(propertyName ?? "") &&
          editorPropertySelection(session, propertyName as "color" | "strokeWidth" | "fill" | "fontSize" | "align", selection).length)
        commit(() => { applyEditorPropertyPatch(session, patch, selection); });
    }
  }
  toolbar.addEventListener("change", event => {
    if (running || savePreparing || structuralRunning) return;
    const input = event.target as HTMLInputElement;
    if (changeOpacity(input)) return;
    if (input.dataset.transform) changeTransform(input);
    else changeAppearance(input);
  });
  overlay.addEventListener("pointerdown", event => { void pointerDown(event).catch(report); });
  function canOpenContextMenu(): boolean {
    return active && !disposed && !running && !structuralRunning && !activeText && !pointer && !pendingPick && tool === "select" && !isSceneSettling() && !cameraPan.isPanning() && !links.isOpen();
  }
  function showSelectionContextMenu(): void {
    if (!canOpenContextMenu()) return;
    const frame = session.getSelection().length ? session.getSelectionFrame() : null;
    if (!frame) {
      if (canUseClipboard("paste")) {
        const rect = host.getCanvas().getBoundingClientRect();
        contextMenu.show({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
      return;
    }
    const center = editorFrameCenter(frame), point = host.sceneToClientPoint(center.x, center.y, frame.pageIndex);
    if (point) contextMenu.show(point);
  }
  async function openContextMenu(event: MouseEvent): Promise<void> {
    if (!canOpenContextMenu() || (event.target as Element).closest(".hepr-editor-field,.hepr-editor-text-input")) return;
    event.preventDefault(); event.stopPropagation(); contextMenu.close();
    const request = ++textRequest, target = event.target as Element, selection = session.getSelection();
    if (selection.length && (target.getAttribute("data-selection-move") === "true" || target.getAttribute("data-handle"))) {
      contextMenu.show({ x: event.clientX, y: event.clientY }); return;
    }
    const point = host.clientToScenePoint(event.clientX, event.clientY); if (!point) return;
    const revision = session.revision, sourceScene = session.sourceScene, selectionKey = JSON.stringify(selection);
    const before = host.sceneToClientPoint(point.x, point.y);
    const id = await pick(point, { x: event.clientX, y: event.clientY });
    if (!canOpenContextMenu() || request !== textRequest || revision !== session.revision || sourceScene !== session.sourceScene || selectionKey !== JSON.stringify(session.getSelection())) return;
    const after = host.sceneToClientPoint(point.x, point.y);
    if (!before || !after || Math.abs(before.x - after.x) + Math.abs(before.y - after.y) > .1) return;
    if (!id) {
      if (canUseClipboard("paste")) { session.select([]); contextMenu.show({ x: event.clientX, y: event.clientY }); }
      return;
    }
    if (!selection.includes(id)) session.select([id]);
    contextMenu.show({ x: event.clientX, y: event.clientY });
  }
  overlay.addEventListener("contextmenu", event => { void openContextMenu(event).catch(report); });
  overlay.addEventListener("pointermove", pointerMove); overlay.addEventListener("pointerup", pointerUp);
  overlay.addEventListener("pointerenter", pointerMove);
  overlay.addEventListener("pointerleave", () => { signatureHover = null; updatePolygonPreview(); });
  overlay.addEventListener("pointercancel", () => { signatureHover = null; cancelPointerGesture(); });
  overlay.addEventListener("lostpointercapture", event => { if (pointer?.id === event.pointerId || pendingPick?.id === event.pointerId && !pendingPick.released) cancelPointerGesture(); });
  function forwardWheel(event: WheelEvent): void {
    if (activeText || (event.target as Element).closest(".hepr-editor-field")) return;
    fieldActivation.reset();
    event.preventDefault(); event.stopPropagation();
    if (pendingPick || pointer && pointer.action !== "draw") cancelPointerGesture();
    host.getCanvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }));
  }
  overlay.addEventListener("wheel", forwardWheel, { passive: false });
  window.addEventListener("blur", () => fieldActivation.reset(), { signal: lifetime.signal });
  async function doubleClick(event: MouseEvent): Promise<void> {
    if (!active || running || links.isOpen()) return;
    if (tool === "polygon" || tool === "polyline") { completePolygon(true); return; }
    if (tool !== "select" || activeText) return;
    // Field hit testing needs no primitive pick or completed preview restoration.
    const fieldId = canActivateField() && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
      !(event.target as Element).getAttribute("data-handle") ? fieldAtClientPoint({ x: event.clientX, y: event.clientY }) : null;
    if (fieldId) {
      // Real click pairs are handled on pointer release, including drag rejection.
      // Retain native-only activation from accessibility/programmatic events.
      if (event.detail === 0) activateField(fieldId);
      return;
    }
    if (isSceneSettling()) return;
    const pageIndex = (event.target as Element).getAttribute("data-selection-move") === "true" ? session.getSelectionFrame()?.pageIndex : undefined;
    const point = host.clientToScenePoint(event.clientX, event.clientY, pageIndex); if (!point) return;
    cancelPointerGesture();
    const request = ++textRequest;
    const id = await pick(point, { x: event.clientX, y: event.clientY });
    if (!id || disposed || !active || running || tool !== "select" || request !== textRequest) return; const object = session.getObject(id);
    if (session.isObjectLocked(id)) return;
    if (object.kind === "text") { await startText(point, object); return; }
    if (object.kind === "shape" && object.review || object.kind === "source" && object.annotationId && latestScene.annotations?.some(annotation =>
        annotation.id === object.annotationId && ["Text", "Highlight", "Underline", "StrikeOut"].includes(annotation.subtype))) {
      session.select([id]); review.editSelection(); return;
    }
    if (object.kind !== "source" || !object.annotationId) return;
    const annotation = session.sourceScene.annotations?.find(item => item.id === object.annotationId);
    if (annotation?.subtype !== "FreeText") return;
    const revision = session.revision;
    const restored = await editorServices.readTextAnnotation(annotation.id, session.sourceScene, lifetime.signal, { pdf: session.sourcePdf, password: source.password });
    if (!restored || disposed || !active || request !== textRequest || revision !== session.revision) return;
    const delta = session.getAnnotationEdits().find(edit => edit.id === annotation.id)?.transform;
    const offset = annotation.pageIndex * 4;
    if (delta) restored.transform = transformEditorAnnotationText(restored.transform, delta, session.sourceScene.pageRects[offset], session.sourceScene.pageRects[offset + 1]);
    restored.pageIndex = annotation.pageIndex; await startText(point, restored, annotation.id);
  }
  overlay.addEventListener("dblclick", event => { void doubleClick(event).catch(report); });
  function keydown(event: KeyboardEvent): void {
    if (!active || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (recoveryDialog) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
      return;
    }
    if (links.isOpen()) {
      if ((event.ctrlKey || event.metaKey) && /^[szdcxvy]$/i.test(event.key) && !inputTarget(event.target)) event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
      return;
    }
    if (structuralRunning || running || savePreparing) {
      if (event.key === "Escape") operation?.abort();
      if (event.key === "Escape" || (event.ctrlKey || event.metaKey) && /^[szdcxvy]$/i.test(event.key) ||
          inputTarget(event.target) && !["Tab", "Shift", "Control", "Meta", "Alt"].includes(event.key)) event.preventDefault();
      return;
    }
    if (event.key === "Escape") { polygon = null; cancelPointerGesture(); cancelText(); operation?.abort(); if (tool === "signature") setTool("select"); session.select([]); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save("pdf"); return; }
    const dialog = (event.target as Element | null)?.closest?.("dialog");
    if (dialog && dialog !== layerDialog) return;
    if (inputTarget(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") { event.preventDefault(); openLinkEditor(); return; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && /^[cxv]$/i.test(event.key)) {
      const action = event.key.toLowerCase() === "c" ? "copy" : event.key.toLowerCase() === "x" ? "cut" : "paste";
      if (action !== "paste" && document.getSelection()?.isCollapsed === false) return;
      if (canUseClipboard(action)) { event.preventDefault(); void runClipboard(action, action === "paste" && event.shiftKey); }
      return;
    }
    if ((event.key === "ContextMenu" || event.shiftKey && event.key === "F10") && canOpenContextMenu()) { event.preventDefault(); showSelectionContextMenu(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); changeHistory(event.shiftKey); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); void runClipboard("duplicate"); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); commit(() => session.deleteSelection()); }
    else if (event.key === "Enter" && polygon) { event.preventDefault(); completePolygon(); }
    else if (/^Arrow/.test(event.key) && session.getSelection().length && !selectionLocked()) { event.preventDefault(); const d = event.shiftKey ? 10 : 1;
      commit(() => interaction.nudge(event.key === "ArrowLeft" ? -d : event.key === "ArrowRight" ? d : 0, event.key === "ArrowDown" ? -d : event.key === "ArrowUp" ? d : 0)); }
  }
  window.addEventListener("keydown", keydown, { signal: lifetime.signal });
  window.addEventListener("keydown", transformModifiers, { signal: lifetime.signal });
  window.addEventListener("keyup", transformModifiers, { signal: lifetime.signal });
  function hasUnsavedChanges(): boolean {
    return session.getState().dirty || hasPendingEditorTextChanges(activeText) || hasPendingEditorFields(fieldDrafts) ||
      pdfProtection.hasChanges() || Boolean(passwordDialog?.hasDraftChanges()) || review.hasDraftChanges() || links.hasDraftChanges() || structuralRunning;
  }
  async function initializeRecovery(): Promise<void> {
    try {
      recoveryKey = await editorRecoveryDocumentKey({ bytes: source.bytes ?? source.pdf, scene: currentSourceScene }, lifetime.signal);
      const protectedSource = await editorServices.isSourceProtected(lifetime.signal);
      if (disposed) return;
      recovery = createEditorRecovery({ session, key: recoveryKey, label: source.label, password: source.password,
        protected: protectedSource,
        isInteracting: () => Boolean(pointer || pendingPick || cameraPan.isPanning() || review.isSelecting() || links.isPicking() || structuralRunning || running || savePreparing),
        getDraft: async () => { const editing = activeText; return { text: editing ? { object: await readTextDraft(), objectId: editing.objectId,
          sourceAnnotationId: editing.sourceAnnotationId, layerId: editing.layerId } : null,
          fields: [...fieldDrafts].filter(([control, baseline]) => editorFieldDraftSignature(control) !== baseline)
            .map(([control]) => ({ id: control.dataset.fieldId, signature: editorFieldDraftSignature(control) })),
          comment: review.getDraft(), link: links.getDraft() }; },
        async applyDraft(value) {
          cancelPointerGesture(false); cancelText();
          await refreshScene(lifetime.signal, false, true); updateFonts();
          if (!value || typeof value !== "object") return;
          const draft = value as { text?: { object?: EditorTextObject; objectId?: string; sourceAnnotationId?: string; layerId?: string | null }; fields?: { id: string; signature: string }[]; comment?: unknown; link?: unknown };
          if (draft.fields?.length) {
            setTool("form"); renderFields();
            for (const item of draft.fields) {
              const control = [...fieldDrafts.keys()].find(control => control.dataset.fieldId === item.id); if (!control || control.disabled) continue;
              if (control.tagName === "SELECT" && (control as HTMLSelectElement).multiple) {
                const values = JSON.parse(item.signature) as string[];
                for (const option of (control as HTMLSelectElement).options) option.selected = values.includes(option.value);
              } else if (control.tagName === "INPUT" && /^(checkbox|radio)$/.test((control as HTMLInputElement).type)) (control as HTMLInputElement).checked = Boolean(JSON.parse(item.signature)[0]);
              else control.value = item.signature;
              updateFieldPaint(control);
            }
          }
          if (draft.text?.object) {
            setTool("select"); const object = draft.text.object;
            await startText({ x: 0, y: 0 }, { ...object, id: draft.text.objectId ?? "recovered-text-draft" }, draft.text.sourceAnnotationId);
            if (activeText) { activeText.objectId = draft.text.objectId; activeText.layerId = draft.text.layerId; activeText.baseline.html = ""; }
          }
          if (draft.comment) review.restoreDraft(draft.comment);
          if (draft.link) { setTool("select"); links.restoreDraft(draft.link); }
          updateState(session.getState());
        },
        onStatus(value) {
          recoveryNotice = value.state === "saved" ? "Local recovery saved" : value.state === "saving" ? "Saving recovery…" : `Recovery unavailable: ${value.message}`;
          if (!disposed && !recoveryOffered) query("[data-recovery-status]").textContent = recoveryNotice;
        }, onError: report
      });
      recoveryOffered = Boolean(await recovery.probe());
      if (!disposed && recoveryOffered) query("[data-recovery-status]").textContent = "An older recovery draft is available; choose Restore or Discard to resume recovery.";
    } catch (error) { if (!disposed) { query("[data-recovery-status]").textContent = "Local recovery unavailable"; report(error); } }
  }
  async function openRecovery(): Promise<void> {
    await recoveryReady;
    if (disposed || !active || !recovery || recoveryDialog || running || savePreparing || structuralRunning) return;
    const offered = recoveryOffered ? await recovery.probe() : undefined;
    if (disposed || !active || recoveryDialog || running || savePreparing || structuralRunning) return;
    recoveryDialog = showEditorRecoveryDialog(document, { controller: recovery, currentKey: recoveryKey, offered,
      onRestored() { recoveryOffered = false; setStatus("Recovered edits. The original file is unchanged."); }, onError: report,
      onBusyChange(value) {
        recoveryRunning = value;
        if (disposed) return;
        toolbar.inert = overlay.inert = value || structuralRunning;
        host.onBusyChange?.(running || structuralRunning || value || cameraPan.isPanning());
      },
      onClose() {
        recoveryDialog = null;
        if (!disposed) void recovery?.probe().then(record => {
          if (disposed) return;
          recoveryOffered = recovery?.hasPendingDecision() ?? false;
          query("[data-recovery-status]").textContent = recoveryOffered ? "Recovery paused until the older draft is restored or discarded." : recoveryNotice;
        });
      }
    });
  }
  function confirmDocumentChange(): boolean {
    if (recoveryRunning) { setStatus("Wait for recovery to finish before opening another document."); return false; }
    const confirmed = !hasUnsavedChanges() || window.confirm("Discard unsaved PDF changes and open another document?");
    if (confirmed && hasUnsavedChanges()) discardRecovery = true;
    return confirmed;
  }
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; }
  }
  window.addEventListener("beforeunload", beforeUnload, { signal: lifetime.signal });
  updatePointerCursor(); updateState(session.getState()); toolbar.hidden = overlay.hidden = true;
  const recoveryReady = initializeRecovery();
  return {
    async setEditing(value, externalSignal) {
      if (disposed || structuralRunning || savePreparing || running && !clipboardRunning || recoveryRunning || active === value) return;
      const signal = AbortSignal.any([lifetime.signal, ...(externalSignal ? [externalSignal] : [])]);
      signal.throwIfAborted();
      contextMenu.close();
      if (!value) recoveryDialog?.close();
      if (!value && clipboardRunning) operation?.abort();
      if (!value) pendingFieldFocus = null;
      if (!value) { flushEditorFieldDrafts(fieldDrafts); if (activeText) await finishText(); if (!review.flushDraft() || !links.flushDraft()) return; await recovery?.flush(); }
      if (!value) { toolRequest++; cancelPointerGesture(); polygon = null; signatureHover = null; textRequest++; }
      // Read mode needs the current committed frame, including metadata-only links.
      if (!value) while (pendingDrawings.capture() || presented !== null && (presented.sourceScene !== session.sourceScene ||
          presented.revision !== session.revision || presented.delta !== null)) {
        await refreshScene(signal, false, true); signal.throwIfAborted();
        if (disposed) return;
        cancelPointerGesture();
      }
      try {
        active = value; toolbar.hidden = overlay.hidden = !value; document.body.classList.toggle("hepr-editing", value);
        cameraPan.setActive(value);
        review.setActive(value);
        links.setActive(value); updateLinkButtons();
        layerControls.setActive(value); if (!value) layerDialog?.close();
        releaseFrameListener?.(); releaseFrameListener = null;
        if (value) releaseFrameListener = host.subscribeToFrames?.(() => { if (active && !disposed) updateGeometry(true); }) ?? null;
        host.setEditing(value); host.onModeChange?.(value);
        if (value) {
          host.onSetupProgress?.({ stage: "display" });
          if (host.onSetupProgress) await yieldAfterPaint(signal);
          signal.throwIfAborted();
          updateGeometry(); await refreshScene(signal, false, true); signal.throwIfAborted(); tick();
          await recoveryReady; signal.throwIfAborted(); if (recoveryOffered) void openRecovery();
        } else window.cancelAnimationFrame(frame);
      } catch (error) {
        if (value && !disposed) {
          active = false; toolbar.hidden = overlay.hidden = true; document.body.classList.remove("hepr-editing");
          cameraPan.setActive(false);
          review.setActive(false);
          links.setActive(false);
          layerControls.setActive(false); releaseFrameListener?.(); releaseFrameListener = null;
          window.cancelAnimationFrame(frame); host.setEditing(false); host.onModeChange?.(false);
        }
        throw error;
      }
    },
    isEditing: () => active, isBusy: () => running || savePreparing || structuralRunning || recoveryRunning || cameraPan.isPanning() || links.isBusy(), isDirty: hasUnsavedChanges, save, attachDocuments, dropImages, confirmDocumentChange,
    dispose() {
      if (disposed) return; disposed = true; active = false; cancelPointerGesture(false); lifetime.abort(); scenePreparation?.abort(); operation?.abort(); window.cancelAnimationFrame(frame);
      cameraPan.dispose();
      review.dispose(); links.dispose(); recoveryDialog?.close();
      if (discardRecovery && recovery) { const controller = recovery; void controller.discard().finally(() => controller.dispose()).catch(() => {}); }
      else recovery?.dispose();
      pendingFieldFocus = null;
      pendingDrawings.clear();
      releaseFrameListener?.(); releaseFrameListener = null;
      passwordDialog?.close(); pagesDialog?.close(true); pdfProtection.dispose();
      contextMenu.dispose();
      layerControls.dispose(); layerDialog?.remove();
      unsubscribe(); picker?.dispose(); interaction.dispose(); session.dispose(); editorServices.dispose(); toolbar.remove(); overlay.remove();
      for (const face of fontFaces.values()) document.fonts.delete(face); fontFaces.clear();
      document.body.classList.remove("hepr-editing"); host.setEditing(false); host.onModeChange?.(false);
    }
  };
}

function applySelectionCss(document: Document, property: string, value: string): void {
  const selection = document.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0), span = document.createElement("span");
  (span.style as unknown as Record<string, string>)[property] = value;
  span.append(range.extractContents()); range.insertNode(span); range.selectNodeContents(span); selection.removeAllRanges(); selection.addRange(range);
}
