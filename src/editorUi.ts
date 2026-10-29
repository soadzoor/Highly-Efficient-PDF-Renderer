import "./editorUi.css";
import "./editorContextMenu.css";
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
import { commitEditorText, hasPendingEditorTextChanges, normalizeEditorTextColor, readRichTextRuns, type EditorTextDraftBaseline } from "./editorRichText";
import type { EditorFont } from "./editorFonts";
import { editorIconButton } from "./editorToolbarIcons";
import { canEditEditorField, createEditorFieldControl, createEditorFieldOptions, editorFieldDraftSignature, flushEditorFieldDrafts, hasPendingEditorFields, setEditorFieldControlValue, styleEditorFieldControl, type EditorFieldControl } from "./editorFormControls";
import { editorBoundsClickHit, editorFieldClientGeometry, pickEditorMetadataAnnotation, transformEditorAnnotationText } from "./editorCoordinates";
import { applyEditorFillOpacity, applyEditorOpacity, editorFillSelection, editorStyledSelection, validateEditorOpacity } from "./editorProperties";
import { createEditorInteractionController } from "./editorInteraction";
import { LoadProgressReporter } from "./loadProgress";
import { createEditorPdfProtectionState, showEditorPdfPasswordDialog, type EditorPdfPasswordDialog } from "./editorPdfProtectionUi";
import { insertEditorDocumentFiles, insertEditorPdfFiles, showEditorPagesDialog, type EditorPagesDialog } from "./editorPagesUi";
import type { LoadProgressCallback } from "./loadProgress";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { editorFrameCenter, editorFrameClientGeometry, editorFrameResizeMatrix, editorFrameScaleMatrix, editorFrameSize } from "./editorSelectionGeometry";
import { printPdfBlob } from "./pdfPrint";
import { getEditorAnnotationFrameTransform, getEditorAnnotationSource } from "./editorScene";
import { droppedFileKind } from "./documentDropFiles";
import { waitForLoad } from "./loadCancellation";
import { createEditorLayerControls } from "./editorLayerControls";
import { createEditorContextMenu } from "./editorContextMenu";

export interface EditorUiHost {
  getCanvas(): HTMLCanvasElement;
  getScene(): VectorScene | null;
  prepareScene(signal: AbortSignal): Promise<VectorScene>;
  /** Acknowledge the matching draw before resolving, so selection chrome can follow the submitted scene. */
  applyScene(scene: VectorScene, signal: AbortSignal, onPresented?: () => void): void | Promise<void>;
  documentChanged?(scene: VectorScene, source: { pdf?: Uint8Array; password?: string; label: string }): void | Promise<void>;
  getSource(): { pdf?: Uint8Array; password?: string; label: string };
  clientToScenePoint(x: number, y: number, pageIndex?: number): PrimitivePoint | null;
  sceneToClientPoint(x: number, y: number, pageIndex?: number): PrimitivePoint | null;
  /** Notify synchronously after the document's draw/submission, including camera-only frames. */
  subscribeToFrames?(listener: () => void): () => void;
  /** Schedule a document frame when newly created controls need their initial placement. */
  requestFrame?(): void;
  /** Optional dock beside the canvas. Custom hosts without a dock use a dialog. */
  layerControlsContainer?: HTMLElement;
  showLayerControls?(): void;
  setEditing(active: boolean): void;
  onModeChange?(active: boolean): void;
  onStatus?(message: string): void;
  onBusyChange?(busy: boolean): void;
}
export interface EditorUi {
  setEditing(active: boolean): Promise<void>;
  isEditing(): boolean;
  isBusy?(): boolean;
  isDirty(): boolean;
  confirmDocumentChange(): boolean;
  save(kind: "pdf" | "flatten" | "hep" | "print"): Promise<void>;
  attachDocuments(files: readonly File[], signal?: AbortSignal): Promise<void>;
  dropImages(files: readonly File[], client: { x: number; y: number }, signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

type Tool = "select" | "pan" | "form" | "text" | "rectangle" | "ellipse" | "line" | "arrow" | "polygon" | "polyline" | "ink" | "signature" | "image";
type EditorImageData = Omit<Extract<EditorObjectInput, { kind: "image" }>, "pageIndex" | "x" | "y" | "width" | "height">;
type PointerGesture = { id: number; start: PrimitivePoint; startClient: PrimitivePoint; last: PrimitivePoint; points: [number, number][]; bounds: Bounds | null; frame?: EditorSelectionFrame; action: "draw" | "marquee" | "move" | "resize" | "rotate"; additive: boolean; handle?: string; freeResize?: boolean; scaleText?: boolean };
interface PresentedScene {
  sourceScene: VectorScene;
  revision: number;
  selection: ReadonlySet<string>;
  frame: EditorSelectionFrame | null;
  delta: EditorMatrix | null;
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
  try {
    const scene = await host.prepareScene(lifetime.signal);
    lifetime.signal.throwIfAborted();
    services = await createEditorAppServices({ sourcePdf: source.pdf, password: source.password });
    lifetime.signal.throwIfAborted();
    session = await openEditorSession(scene, { ...services.sessionOptions, signal: lifetime.signal, sourcePdf: source.pdf, sourceLabel: source.label });
  } catch (error) { lifetime.abort(); services?.dispose(); throw error; }
  finally { signal?.removeEventListener("abort", abortInitialization); }
  const editorServices = services;
  const interaction = createEditorInteractionController(session);
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
  let renderRevision = 0, operation: AbortController | null = null, running = false;
  let previewFrame = 0, previewRunning = false, previewPending = false;
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
  let polygon: { pageIndex: number; points: [number, number][] } | null = null;
  const toolbar = document.createElement("div"); toolbar.className = "hepr-editor-toolbar"; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "PDF editing tools");
  toolbar.innerHTML = `<div class="hepr-editor-tools">
    ${editorIconButton("tool", "select", "Select, move, resize or rotate objects")}
    ${editorIconButton("tool", "pan", "Pan the document")}
    ${editorIconButton("tool", "form", "Fill PDF form fields")}
    ${editorIconButton("tool", "text", "Add a text box")}
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
    ${editorIconButton("action", "duplicate", "Duplicate selected objects")}
    ${editorIconButton("action", "delete", "Delete selected objects")}
    ${editorIconButton("action", "group", "Group selected objects")}
    ${editorIconButton("action", "ungroup", "Ungroup selected objects")}
  </div><div class="hepr-editor-properties">
    <label>Color <input data-prop="color" type="color" value="#111111"></label><label class="hepr-editor-opacity">Color opacity <input data-prop="opacity" type="number" value="1" min="0" max="1" step="0.1" aria-label="Color opacity"><input data-opacity-slider="opacity" type="range" value="1" min="0" max="1" step="0.1" aria-label="Color opacity slider"></label><label>Width <input data-prop="stroke" type="number" value="2" min="0" step="any"></label>
    <label><input data-prop="fill-enabled" type="checkbox"> Fill</label><input data-prop="fill" type="color" value="#ffff00" aria-label="Fill color">
    <label class="hepr-editor-opacity">Fill opacity <input data-prop="fill-opacity" type="number" value="1" min="0" max="1" step="0.1" aria-label="Fill opacity"><input data-opacity-slider="fill-opacity" type="range" value="1" min="0" max="1" step="0.1" aria-label="Fill opacity slider"></label>
    <label>Font <select data-prop="font" aria-label="Font family"><option value="">Liberation Sans</option><option value="bundled:serif">Liberation Serif</option><option value="bundled:mono">Liberation Mono</option></select></label>${editorIconButton("action", "font", "Import a TTF or OTF font")}${editorIconButton("action", "local-fonts", "Choose installed fonts")}
    <label>Size <input data-prop="font-size" type="number" value="12" min="0.1" step="any"></label>
    <button type="button" data-style="bold" aria-pressed="false" title="Bold" aria-label="Bold"><b>B</b></button><button type="button" data-style="italic" aria-pressed="false" title="Italic" aria-label="Italic"><i>I</i></button>
    <button type="button" data-style="underline" aria-pressed="false" title="Underline" aria-label="Underline"><u>U</u></button><button type="button" data-style="strikethrough" aria-pressed="false" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
    <label>Align <select data-prop="align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    ${editorIconButton("action", "apply-text", "Apply text changes", "hidden")}${editorIconButton("action", "cancel-text", "Discard text changes", "hidden")}
  </div><div class="hepr-editor-transform">
    <span data-selection>No selection</span><label>X <input data-transform="x" type="number" step="any"></label><label>Y <input data-transform="y" type="number" step="any"></label>
    <label>W <input data-transform="width" type="number" min="0.001" step="any"></label><label>H <input data-transform="height" type="number" min="0.001" step="any"></label><label>Rotate ° <input data-transform="rotation" type="number" step="any" value="0"></label>
    ${editorIconButton("action", "layers", "Add, edit, reorder or remove PDF layers")}${editorIconButton("action", "pages", "Rotate, remove or insert PDF pages")}${editorIconButton("action", "pdf-password", "Keep, remove or change PDF password protection")}${editorIconButton("action", "save-pdf", "Save an editable PDF (Ctrl/Cmd+S)")}${editorIconButton("action", "flatten", "Save a flattened PDF copy")}${editorIconButton("action", "save-hep", "Save the edited document as HEP")}${editorIconButton("action", "print", "Print the edited document")}
    ${editorIconButton("action", "cancel-operation", "Cancel the current operation", "hidden")}<span data-status role="status" aria-live="polite"></span>
  </div><div class="hepr-editor-help">Ctrl/Cmd + click toggles objects; Shift + click adds them. Drag empty space to select fully contained objects. Corner resizing keeps proportions; hold Shift to resize freely. Double-click a new textbox to edit it; resizing changes wrapping, Alt + resize scales text. Escape cancels.</div>`;
  const overlay = document.createElement("div"); overlay.className = "hepr-editor-overlay"; overlay.dataset.tool = tool;
  const graphic = document.createElementNS(SVG_NS, "svg"); graphic.classList.add("hepr-editor-graphic");
  const fields = document.createElement("div"); fields.className = "hepr-editor-fields"; fields.hidden = true;
  const fieldDrafts = new Map<EditorFieldControl, string>();
  overlay.append(graphic, fields); document.body.append(toolbar, overlay);
  const query = <T extends HTMLElement>(selector: string): T => toolbar.querySelector<T>(selector)!;
  const property = (name: string): HTMLInputElement => query(`[data-prop="${name}"]`);
  const status = query<HTMLSpanElement>("[data-status]");
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
    const styled = editorStyledSelection(session), fills = editorFillSelection(session, styled);
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
        if (common) { if (name === "opacity") objectOpacity = values[0]; else fillOpacity = values[0]; }
      } else syncOpacityControls(name, name === "opacity" ? objectOpacity : fillOpacity, disabled);
    }
  }
  function opacityInput(event: Event): void {
    if (structuralRunning) return;
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
    try {
      const value = validateEditorOpacity(input.value.trim() ? Number(input.value) : NaN);
      if (name === "opacity") {
        objectOpacity = value;
        if (activeText) activeText.opacity = value;
        else if (editorStyledSelection(session).length) commit(() => applyEditorOpacity(session, value));
      } else {
        fillOpacity = value;
        if (!activeText && editorFillSelection(session).length) commit(() => applyEditorFillOpacity(session, value));
      }
      syncOpacityControls(name, value, input.disabled);
    } catch (error) { report(error); syncOpacityControls(name, name === "opacity" ? objectOpacity : fillOpacity, input.disabled); }
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
      if (structuralRunning || running) throw new Error("Wait for the current document operation to finish.");
      if (pointer || pendingPick) cancelPointerGesture();
      const revision = session.getState().revision;
      change(); if (session.getState().revision !== revision) void refreshScene();
    } });
  const contextMenu = createEditorContextMenu(document, {
    canRun: action => canOpenContextMenu() && session.canReorderSelection(action),
    run: action => { if (canOpenContextMenu()) commit(() => session.reorderSelection(action)); }, onError: report
  });
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
    const display = displayedSelection(), selection = display.frame;
    if (selection && tool === "select" && !running && !activeText) {
      const geometry = editorFrameClientGeometry(selection, point => host.sceneToClientPoint(point.x, point.y, selection.pageIndex), display.delta);
      if (geometry) {
        const corners = geometry.corners.map(point => ({ x: point.x - rect.left, y: point.y - rect.top }));
        const dx = corners[1].x - corners[0].x, dy = corners[1].y - corners[0].y;
        const handleAngle = (dx !== 0 || dy !== 0 ? Math.atan2(dy, dx)
          : Math.atan2(corners[3].y - corners[0].y, corners[3].x - corners[0].x)) * 180 / Math.PI;
        const framePoints = corners.map(point => `${point.x},${point.y}`).join(" ");
        svg("polygon", { points: framePoints, class: "hepr-editor-selection-hit", "data-selection-move": "true" });
        svg("polygon", { points: framePoints, class: "hepr-editor-selection" });
        for (const [index, name] of ["nw", "ne", "se", "sw"].entries()) {
          const point = corners[index], handle = svg("rect", { x: point.x - 4, y: point.y - 4, width: 8, height: 8,
            transform: `rotate(${handleAngle} ${point.x} ${point.y})`, "data-handle": name, class: "hepr-editor-handle" });
          handle.style.cursor = pointer ? "inherit" : geometry.cursors[index];
          if (pointer?.action === "resize" && pointer.handle === name) overlay.style.cursor = geometry.cursors[index];
        }
        svg("line", { x1: geometry.rotationBase.x - rect.left, y1: geometry.rotationBase.y - rect.top,
          x2: geometry.rotation.x - rect.left, y2: geometry.rotation.y - rect.top, class: "hepr-editor-selection" });
        svg("circle", { cx: geometry.rotation.x - rect.left, cy: geometry.rotation.y - rect.top, r: 5, "data-handle": "rotate", class: "hepr-editor-handle" });
      }
    }
    if (pointer) {
      if (pointer.action === "draw" && tool === "ink") {
        const points = pointer.points.map(([x, y]) => host.sceneToClientPoint(x, y)).filter((p): p is PrimitivePoint => p !== null);
        svg("polyline", { points: points.map(p => `${p.x - rect.left},${p.y - rect.top}`).join(" "), fill: "none", stroke: property("color").value, "stroke-width": 2 });
      } else if (pointer.action === "draw" || pointer.action === "marquee") {
        const p = host.sceneToClientPoint(pointer.last.x, pointer.last.y);
        if (p) svg("rect", { x: Math.min(pointer.startClient.x, p.x) - rect.left, y: Math.min(pointer.startClient.y, p.y) - rect.top,
          width: Math.abs(p.x - pointer.startClient.x), height: Math.abs(p.y - pointer.startClient.y), class: "hepr-editor-marquee" });
      }
    }
    if (polygon) {
      const points = polygon.points.map(([x, y]) => host.sceneToClientPoint(x, y, polygon!.pageIndex)).filter((p): p is PrimitivePoint => p !== null);
      svg("polyline", { points: points.map(p => `${p.x - rect.left},${p.y - rect.top}`).join(" "), fill: "none", stroke: property("color").value, "stroke-width": 2 });
    }
    if (tool === "signature" && signature && signatureHover && !running && !isSceneSettling()) drawSignatureGhost(rect);
    // A camera may already have its next requested pose between document draws.
    // Gesture chrome keeps its RAF, but field controls only follow a drawn pose.
    if (!host.subscribeToFrames || fromFrame) for (const element of fields.querySelectorAll<HTMLElement>("[data-field-id]")) {
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
  function updateState(state: EditorState): void {
    contextMenu.close();
    currentState = state;
    updatePointerCursor();
    query<HTMLButtonElement>('[data-action="undo"]').disabled = !state.canUndo;
    query<HTMLButtonElement>('[data-action="redo"]').disabled = !state.canRedo;
    query("[data-selection]").textContent = state.selection.length ? `${state.selection.length} selected` : "No selection";
    for (const action of ["duplicate", "delete", "group", "ungroup"]) query<HTMLButtonElement>(`[data-action="${action}"]`).disabled = state.selection.length === 0;
    const bounds = session.getSelectionBounds(), frame = session.getSelectionFrame(), size = frame && editorFrameSize(frame);
    for (const [name, value] of Object.entries({ x: bounds?.minX, y: bounds?.minY, width: size?.width, height: size?.height })) {
      const input = query<HTMLInputElement>(`[data-transform="${name}"]`); input.disabled = !bounds;
      if (document.activeElement !== input) input.value = value == null ? "" : Number(value.toFixed(3)).toString();
    }
    if (!state.previewing) updateOpacityControls(state);
    if (!running) setStatus(state.previewing ? "Transform preview" : hasUnsavedChanges() ? "Unsaved changes" : "Saved");
    host.onModeChange?.(active);
  }
  const unsubscribe = session.subscribe(updateState);
  async function synchronizeDocumentSource(): Promise<void> {
    if (currentSourceScene === session.sourceScene) return;
    pendingFieldFocus = null;
    currentSourceScene = session.sourceScene; latestScene = currentSourceScene;
    picking?.abort(); picker?.dispose(); picker = null;
    await host.documentChanged?.(currentSourceScene, { pdf: session.sourcePdf, password: source.password, label: source.label });
    if (tool === "form") renderFields(); pagesDialog?.refresh();
  }
  async function refreshScene(externalSignal?: AbortSignal, preview = false): Promise<void> {
    const revision = ++renderRevision, abort = new AbortController();
    scenePreparation?.abort(); scenePreparation = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal, ...(externalSignal ? [externalSignal] : [])]);
    try {
      await synchronizeDocumentSource(); signal.throwIfAborted();
      if (disposed || revision !== renderRevision) return;
      const state = session.getState(), snapshot: PresentedScene = { sourceScene: session.sourceScene, revision: state.revision,
        selection: new Set(state.selection), frame: session.getSelectionFrame(), delta: preview && state.previewing ? requestedPreview : null };
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
        if (tool === "form") updateFieldPaint();
        // Preserve focused field drafts; only reposition existing controls.
        if (active) updateGeometry(true);
      };
      try {
        await host.applyScene(scene, signal, publish); signal.throwIfAborted();
        // A synchronous host may finish its draw before returning.
        if (!acknowledged) publish();
      } finally {
        if (sceneApplication === application) sceneApplication = null;
        finish?.();
        if (!disposed) { updatePointerCursor(); if (active) updateGeometry(); }
      }
    } catch (error) { report(error); }
    finally { if (scenePreparation === abort) scenePreparation = null; }
  }
  function commit(change: () => void): void {
    if (structuralRunning) return;
    if (pointer || pendingPick) cancelPointerGesture();
    try { change(); void refreshScene(); } catch (error) { report(error); }
  }
  function changeHistory(redo: boolean): void {
    commit(() => { if (redo) session.redo(); else session.undo(); if (tool === "form") renderFields(); });
  }
  function runPreview(): void {
    previewFrame = 0; if (!pointer || !active || disposed) return;
    previewPending = false; previewRunning = true;
    void refreshScene(undefined, true).finally(() => {
      previewRunning = false;
      if (previewPending && pointer && active && !disposed) runPreview();
    });
  }
  function queuePreview(): void {
    previewPending = true;
    if (previewRunning || previewFrame) return;
    previewFrame = window.requestAnimationFrame(runPreview);
  }
  function clearPreview(restore = false): void {
    window.cancelAnimationFrame(previewFrame); previewFrame = 0; previewPending = false;
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
    const id = pointer?.id ?? pendingPick?.id;
    pointer = null;
    if (pendingPick) pendingPick.canceled = true; pendingPick = null;
    picking?.abort();
    if (id !== undefined && overlay.hasPointerCapture?.(id)) overlay.releasePointerCapture(id);
    clearPreview(restore); updatePointerCursor();
  }
  function setTool(next: Tool): void {
    if (structuralRunning) return;
    contextMenu.close();
    pendingFieldFocus = null;
    if (activeText) void finishText();
    else textRequest++;
    cancelPointerGesture(); polygon = null; signatureHover = null; tool = next; toolRequest++;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool], [data-action="signatures"]'))
      button.setAttribute("aria-pressed", String(button.dataset.tool === next || button.dataset.action === "signatures" && next === "signature"));
    overlay.dataset.tool = next; fields.hidden = next !== "form";
    updateOpacityControls(currentState);
    if (next === "form") renderFields();
    updateGeometry();
  }
  function renderFields(): void {
    fields.replaceChildren(); fieldDrafts.clear();
    const appearances = getSceneAnnotationRuns(latestScene);
    for (const currentAnnotation of latestScene.annotations ?? []) {
      const annotation = getEditorAnnotationSource(latestScene, currentAnnotation.id) ?? currentAnnotation;
      const name = annotation.field?.name;
      const input = createEditorFieldControl(document, annotation, name ? session.getFieldValues().get(name) : undefined,
        value => commit(() => {
          session.setFieldValue(name!, value);
          for (const [control] of fieldDrafts) {
            const sibling = latestScene.annotations?.find(item => item.id === control.dataset.fieldId);
            if (!sibling || sibling.field?.name !== name) continue;
            setEditorFieldControlValue(control, getEditorAnnotationSource(latestScene, sibling.id) ?? sibling, value); fieldDrafts.set(control, editorFieldDraftSignature(control));
          }
        }), { usePdfAppearance: currentAnnotation.hasAppearance || Boolean(appearances.get(annotation.id)?.length) });
      if (input) {
        input.hidden = Boolean(host.subscribeToFrames);
        fieldDrafts.set(input, editorFieldDraftSignature(input)); fields.append(input);
        const choices = createEditorFieldOptions(document, annotation, input); if (choices) fields.append(choices);
        if (annotation.field?.textStyle) void editorServices.fonts.resolve(annotation.field.textStyle).then(async font => {
          await activateFont(font);
          const current = latestScene.annotations?.find(item => item.id === annotation.id);
          if (input.parentElement === fields && current) styleEditorFieldControl(input, getEditorAnnotationSource(latestScene, current.id) ?? current, JSON.stringify(font.id));
        }).catch(report);
      }
    }
    if (active) host.requestFrame?.();
  }
  function updateFieldPaint(): void {
    const annotations = new Map(latestScene.annotations?.map(annotation => [annotation.id, annotation]));
    const appearances = getSceneAnnotationRuns(latestScene);
    for (const [control] of fieldDrafts) {
      const annotation = annotations.get(control.dataset.fieldId!);
      if (annotation?.hasAppearance || appearances.get(control.dataset.fieldId!)?.length) control.dataset.pdfAppearance = "true";
      else delete control.dataset.pdfAppearance;
    }
  }
  function fieldAtClientPoint(client: PrimitivePoint): string | null {
    for (const annotation of [...(latestScene.annotations ?? [])].reverse()) {
      if (!canEditEditorField(annotation) || !session.isAnnotationVisible(annotation.id)) continue;
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
    const annotationId = pickEditorMetadataAnnotation((latestScene.annotations ?? []).filter(annotation => session.isAnnotationVisible(annotation.id)), point,
      annotation => session.getObjectBounds(`annotation:${annotation.id}`),
      annotation => appearanceRuns.get(annotation.id)?.some(run => run.count > 0) ?? false);
    if (annotationId) {
      if (!reordered) return `annotation:${annotationId}`;
      candidate(`annotation:${annotationId}`);
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
    if (p.action === "move") return [1, 0, 0, 1, point.x - p.start.x, point.y - p.start.y];
    const frame = p.frame ?? { bounds: p.bounds!, transform: IDENTITY };
    if (p.action === "rotate") {
      const { x: cx, y: cy } = editorFrameCenter(frame);
      const angle = Math.atan2(point.y - cy, point.x - cx) - Math.atan2(p.start.y - cy, p.start.x - cx), c = Math.cos(angle), s = Math.sin(angle);
      return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
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
    if (!bounds || !frame || !Number.isFinite(value)) return;
    const { x: cx, y: cy } = editorFrameCenter(frame);
    if (name === "rotation") {
      const angle = value * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      commit(() => interaction.applyTransform([c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]));
    } else if (name === "x" || name === "y") {
      commit(() => interaction.nudge(name === "x" ? value - bounds.minX : 0, name === "y" ? value - bounds.minY : 0));
    } else if (name === "width" || name === "height") {
      const size = editorFrameSize(frame), old = size[name]; if (old <= 0 || value <= 0) return;
      const matrix = editorFrameScaleMatrix(frame, name === "width" ? value / old : 1, name === "height" ? value / old : 1);
      commit(() => interaction.applyTransform(matrix));
    }
  }
  async function pointerDown(event: PointerEvent): Promise<void> {
    if (!active || running || activeText || pointer || pendingPick || isSceneSettling() || tool === "pan" || tool === "form" || event.button !== 0 || (event.target as Element).closest(".hepr-editor-field")) return;
    textRequest++;
    const targetHandle = tool === "select" ? (event.target as Element).getAttribute("data-handle") : null;
    const handleFrame = targetHandle && ["nw", "ne", "sw", "se", "rotate"].includes(targetHandle) ? session.getSelectionFrame() : null;
    const moveFrame = tool === "select" && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      (event.target as Element).getAttribute("data-selection-move") === "true" ? session.getSelectionFrame() : null;
    const gestureFrame = handleFrame ?? moveFrame;
    const point = host.clientToScenePoint(event.clientX, event.clientY, gestureFrame?.pageIndex); if (!point || tool !== "select" && pageAt(point) < 0) return;
    event.preventDefault(); event.stopPropagation();
    const client = { x: event.clientX, y: event.clientY }, toggle = event.ctrlKey || event.metaKey, additive = toggle || event.shiftKey;
    const handle = handleFrame ? targetHandle : null;
    if (tool === "polygon" || tool === "polyline") {
      polygon ??= { pageIndex: pageAt(point), points: [] };
      if (polygon.pageIndex === pageAt(point)) polygon.points.push([point.x, point.y]);
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
        let id: string | null;
        try { id = await pick(point, client); }
        catch (error) { if (pendingPick === request) cancelPointerGesture(); throw error; }
        if (disposed || !active || running || tool !== "select" || request.canceled || pendingPick !== request) return;
        pendingPick = null; updatePointerCursor();
        if (id) {
          interaction.selectHit(id, event);
          if (additive) return;
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
    pointer = { id: event.pointerId, start: point, startClient: client, last: point, points: [[point.x, point.y]], bounds: session.getSelectionBounds(), frame: gestureFrame ?? session.getSelectionFrame() ?? undefined, action, additive, handle: handle ?? undefined,
      freeResize: event.shiftKey, scaleText: event.altKey };
    updatePointerCursor();
    overlay.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event: PointerEvent): void {
    if (active && tool === "signature") signatureHover = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
    if (pendingPick?.id === event.pointerId) pendingPick.lastClient = { x: event.clientX, y: event.clientY };
    if (!pointer || event.pointerId !== pointer.id) return;
    const point = host.clientToScenePoint(event.clientX, event.clientY, pointer.action !== "draw" && pointer.action !== "marquee" ? pointer.frame?.pageIndex : undefined); if (!point) return;
    pointer.last = point; pointer.freeResize = event.shiftKey; pointer.scaleText = event.altKey;
    if (pointer.action === "draw" && tool === "ink") {
      const pageIndex = pageAt(pointer.start);
      appendEditorInkSamples(pointer.points, event, sample => {
        const p = host.clientToScenePoint(sample.clientX, sample.clientY, pageIndex); return p ? [p.x, p.y] : null;
      });
    } else if (pointer.bounds && ["move", "resize", "rotate"].includes(pointer.action)) {
      const matrix = dragMatrix(pointer, point);
      if (matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0) { interaction.previewTransform(matrix); requestedPreview = matrix; queuePreview(); }
      else clearPreview(true);
    }
    event.preventDefault();
  }
  function resizeModifiers(event: KeyboardEvent): void {
    if (!active || running || event.isComposing || !pointer?.bounds || pointer.action !== "resize" || event.key !== "Shift" && event.key !== "Alt") return;
    pointer.freeResize = event.shiftKey; pointer.scaleText = event.altKey;
    const matrix = dragMatrix(pointer, pointer.last);
    if (matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0) { interaction.previewTransform(matrix); requestedPreview = matrix; queuePreview(); }
    else clearPreview(true);
  }
  function pointerUp(event: PointerEvent): void {
    if (pendingPick?.id === event.pointerId) { pendingPick.released = true; pendingPick.lastClient = { x: event.clientX, y: event.clientY }; overlay.releasePointerCapture?.(event.pointerId); }
    const p = pointer; if (!p || event.pointerId !== p.id) return; pointer = null; updatePointerCursor();
    if (p.action === "draw" && tool === "ink") {
      const pageIndex = pageAt(p.start);
      appendEditorInkSamples(p.points, event, sample => {
        const point = host.clientToScenePoint(sample.clientX, sample.clientY, pageIndex); return point ? [point.x, point.y] : null;
      });
    }
    if (p.action === "resize") {
      p.last = host.clientToScenePoint(event.clientX, event.clientY, p.frame?.pageIndex) ?? p.last;
      p.freeResize = event.shiftKey; p.scaleText = event.altKey;
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
      const pageIndex = pageAt(p.start), [x, y] = pageLocal({ x: Math.min(p.start.x, p.last.x), y: Math.min(p.start.y, p.last.y) }, pageIndex);
      if (pageIndex < 0) return;
      let object: EditorObjectInput;
      if (tool === "ink") object = { kind: "ink", pageIndex, opacity: objectOpacity, fillOpacity, paths: [p.points.map(([px, py]) => pageLocal({ x: px, y: py }, pageIndex))],
        smoothing: editorInkCaptureTolerance(p.start, point => host.sceneToClientPoint(point.x, point.y, pageIndex)),
        color: property("color").value, strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null };
      else object = { kind: "shape", pageIndex, shape: tool as "rectangle" | "ellipse" | "line" | "arrow", x, y,
        width: Math.abs(p.last.x - p.start.x), height: Math.abs(p.last.y - p.start.y),
        points: tool === "line" || tool === "arrow" ? [pageLocal(p.start, pageIndex), pageLocal(p.last, pageIndex)] : undefined,
        opacity: objectOpacity, fillOpacity, color: property("color").value, strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null };
      commit(() => { const id = session.addObject(object); session.select([id]); });
    }
  }
  function completePolygon(): void {
    if (!polygon || polygon.points.length < (tool === "polyline" ? 2 : 3)) { polygon = null; return; }
    const p = polygon; polygon = null;
    const minX = Math.min(...p.points.map(point => point[0])), minY = Math.min(...p.points.map(point => point[1]));
    const [x, y] = pageLocal({ x: minX, y: minY }, p.pageIndex);
    commit(() => { const id = session.addObject({ kind: "shape", shape: tool === "polyline" ? "polyline" : "polygon", pageIndex: p.pageIndex, opacity: objectOpacity, fillOpacity, x, y,
      width: Math.max(...p.points.map(point => point[0])) - minX, height: Math.max(...p.points.map(point => point[1])) - minY,
      points: p.points.map(([px, py]) => pageLocal({ x: px, y: py }, p.pageIndex)), color: property("color").value,
      strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null }); session.select([id]); });
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
    if (structuralRunning) return;
    const request = ++textRequest;
    const pageIndex = object?.pageIndex ?? pageAt(point); if (pageIndex < 0) return;
    const layerId = object ? null : session.getActiveLayer();
    if (!object && layerId && session.getLayers().find(layer => layer.id === layerId)?.defaultVisible === false) throw new Error("Show the active layer before creating a textbox.");
    const selectedFontId = object?.fontId ?? query<HTMLSelectElement>('[data-prop="font"]').value;
    const font = object && !selectedFontId ? await editorServices.fonts.loadBundled(object.fontFamily) : await selectedFont(selectedFontId);
    await activateFont(font); if (disposed || !active || request !== textRequest) return;
    if (object) {
      updateFonts(); query<HTMLSelectElement>('[data-prop="font"]').value = font.id;
      property("font-size").value = String(object.fontSize); property("color").value = normalizeEditorTextColor(colorCss(object.color));
      objectOpacity = object.opacity ?? 1; syncOpacityControls("opacity", objectOpacity, false);
      query<HTMLSelectElement>('[data-prop="align"]').value = object.align ?? "left";
      for (const [name, enabled] of Object.entries({ bold: object.fontWeight === "bold" || Number(object.fontWeight) >= 600,
        italic: object.fontStyle === "italic" || object.fontStyle === "oblique", underline: Boolean(object.underline), strikethrough: Boolean(object.strikethrough) })) query(`[data-style="${name}"]`).setAttribute("aria-pressed", String(enabled));
    }
    const [x, y] = object ? [object.x, object.y] : pageLocal(point, pageIndex);
    const element = document.createElement("div"); element.className = "hepr-editor-text-input"; element.contentEditable = "true";
    element.setAttribute("role", "textbox"); element.setAttribute("aria-label", "Textbox text"); element.setAttribute("aria-multiline", "true");
    element.addEventListener("paste", event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? ""); });
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
    if (disposed || !active || request !== textRequest) return;
    activeText = { element, objectId: sourceAnnotationId ? undefined : object?.id, sourceAnnotationId, layerId, pageIndex, x, y: object ? y : y - 50,
      width: object?.width ?? 220, height: object?.height ?? 50, transform: object?.transform ?? IDENTITY, opacity: object?.opacity ?? objectOpacity, lineHeight: object?.lineHeight,
      baseline: { html: element.innerHTML, align: element.style.textAlign, opacity: object?.opacity ?? objectOpacity } };
    overlay.append(element); query('[data-action="apply-text"]').hidden = false; query('[data-action="cancel-text"]').hidden = false;
    updateGeometry(); if (!element.hidden) element.focus(); activeText.baseline.html = element.innerHTML;
  }
  function cancelText(): void {
    textRequest++;
    activeText?.element.remove(); activeText = null;
    query('[data-action="apply-text"]').hidden = true; query('[data-action="cancel-text"]').hidden = true;
  }
  async function finishText(): Promise<void> {
    if (!activeText) return;
    const editing = activeText, element = editing.element;
    const request = textRequest;
    const text = element.innerText ?? element.textContent ?? "";
    if (!text) { cancelText(); if (editing.objectId || editing.sourceAnnotationId) commit(() => { commitEditorText(session, null, editing); }); return; }
    const font = await selectedFont();
    if (disposed || activeText !== editing || request !== textRequest) return;
    const runs = readRichTextRuns(element, window, editorServices.fonts.list(), font?.id, font?.family);
    const height = Math.max(editing.height, element.scrollHeight, editing.hiddenHeight ?? 0);
    const object: Extract<EditorObjectInput, { kind: "text" }> = { kind: "text", pageIndex: editing.pageIndex, x: editing.x, y: editing.y + editing.height - height, width: editing.width,
      transform: editing.transform, opacity: editing.opacity, lineHeight: editing.lineHeight,
      ...(!editing.objectId ? { layerId: editing.sourceAnnotationId ? null : editing.layerId ?? null } : {}),
      height, text, fontId: font?.id, fontFamily: font?.family,
      fontSize: Number(property("font-size").value), color: property("color").value, fontWeight: styleEnabled("bold") ? "bold" : "normal",
      fontStyle: styleEnabled("italic") ? "italic" : "normal", underline: styleEnabled("underline"), strikethrough: styleEnabled("strikethrough"),
      align: query<HTMLSelectElement>('[data-prop="align"]').value as "left" | "center" | "right", runs };
    cancelText();
    commit(() => { commitEditorText(session, object, editing); });
  }
  function applyTextStyle(name: string): void {
    const button = query(`[data-style="${name}"]`); button.setAttribute("aria-pressed", String(!styleEnabled(name)));
    if (activeText) { activeText.element.focus(); document.execCommand(name === "strikethrough" ? "strikeThrough" : name); }
    else {
      const enabled = styleEnabled(name), patch: Partial<EditorTextObject> = name === "bold" ? { fontWeight: enabled ? "bold" : "normal" } : name === "italic" ? { fontStyle: enabled ? "italic" : "normal" } : name === "underline" ? { underline: enabled } : { strikethrough: enabled };
      commit(() => session.transaction("Format text", () => {
        for (const id of session.getSelection()) { const object = session.getObject(id); if (object.kind === "text") session.updateObject(id, { ...patch, runs: object.runs?.map(run => ({ ...run, ...patch })) }); }
      }));
    }
  }
  function updateFonts(): void {
    const select = query<HTMLSelectElement>('[data-prop="font"]'), selected = select.value; select.replaceChildren();
    for (const [value, label] of [["", "Liberation Sans"], ["bundled:serif", "Liberation Serif"], ["bundled:mono", "Liberation Mono"]]) {
      const fallback = document.createElement("option"); fallback.value = value; fallback.textContent = label; select.append(fallback);
    }
    for (const font of editorServices.fonts.list()) { const option = document.createElement("option"); option.value = font.id; option.textContent = `${font.family} ${font.fontWeight >= 600 ? "Bold" : ""} ${font.fontStyle === "italic" ? "Italic" : ""}`.trim(); select.append(option); }
    select.value = selected;
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
    if (running || structuralRunning) throw new Error("Wait for the current operation to finish.");
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
    if (running || structuralRunning) throw new Error("Wait for the current operation to finish.");
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
      color: property("color").value, strokeWidth: Number(property("stroke").value) }); session.select([id]); });
  }
  async function save(kind: "pdf" | "flatten" | "hep" | "print"): Promise<void> {
    if (structuralRunning) return;
    if ((kind === "pdf" || kind === "flatten") && passwordDialog && !passwordDialog.apply()) return;
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) { setStatus("Check the pending form value before saving or printing."); return; }
    if (activeText) await finishText();
    if (running) return;
    const protection = kind === "pdf" || kind === "flatten" ? pdfProtection.get() : undefined;
    const wasPreviewing = session.getState().previewing;
    cancelPointerGesture(false); running = true; updatePointerCursor(); host.onBusyChange?.(true);
    operation?.abort(); const abort = new AbortController(); operation = abort;
    query('[data-action="cancel-operation"]').hidden = false; setStatus(`Preparing ${kind === "hep" ? "HEP" : "PDF"}…`);
    try {
      if (wasPreviewing) await refreshScene(lifetime.signal);
      let outputKind = kind;
      if (kind === "pdf" && (session.sourcePdf || session.getLayerEdits?.().stackingChanged || session.getLayerEdits?.().objectOrderChanged)) {
        const sourceScene = session.sourceScene, revision = session.getState().revision;
        const committed = await session.getScene({ signal: abort.signal, preview: false });
        const unchanged = (): boolean => sourceScene === session.sourceScene && revision === session.getState().revision;
        if (!unchanged()) throw new Error("The document changed while preparing the export. Save again.");
        const layerStacking = Boolean((session.getLayerEdits?.().stackingChanged || session.getLayerEdits?.().objectOrderChanged) &&
          ((committed.annotations?.length ?? 0) || session.getObjects({ includeSource: false }).length));
        if (layerStacking || (session.sourcePdf && findEditorPdfFormOverlaps(committed, session, { signal: abort.signal }).length)) {
          const choice = await chooseEditorPdfFormExport(document, abort.signal, { layerStacking });
          if (!choice) { setStatus("PDF export cancelled"); return; }
          if (!unchanged()) throw new Error("The document changed while choosing the PDF format. Save again.");
          outputKind = choice;
        }
      }
      const warnings: string[] = [], onWarning = (value: string): void => { warnings.push(value); setStatus(value); };
      const progress = new LoadProgressReporter(value => setStatus(`Preparing ${kind === "hep" ? "HEP" : "PDF"}… ${Math.round(value.value * 100)}%`));
      let blob: Blob;
      if (kind === "print") {
        const { writeScenePdf } = await import("./editorPdfWriter");
        blob = await writeScenePdf(await session.getScene({ signal: abort.signal, preview: false, onProgress: progress.child(0, .4).toCallback() }),
          { signal: abort.signal, onWarning, onProgress: progress.child(.4, 1).toCallback() });
      } else blob = kind === "hep" ? await session.saveHep({ signal: abort.signal, onProgress: progress.toCallback() })
        : await session.savePdf({ signal: abort.signal, flatten: outputKind === "flatten", protection, onWarning, onProgress: progress.toCallback() });
      abort.signal.throwIfAborted();
      if (kind === "print") printPdfBlob(blob, document, { filename: "edited-print.pdf", title: "Print edited PDF" });
      else { const base = formatPdfDownloadFilename(source.label).replace(/\.pdf$/i, ""); triggerBrowserDownload(blob, `${base}${kind === "hep" ? "-edited.hep" : outputKind === "flatten" ? "-flattened.pdf" : "-edited.pdf"}`); }
      if (protection) pdfProtection.markSaved(protection);
      setStatus(warnings.length ? warnings.join(" ") : kind === "print" ? "Print-ready PDF opened" : hasUnsavedChanges() ? "Unsaved changes" : "Saved");
    } catch (error) { report(error); }
    finally { if (operation === abort) operation = null; running = false; updatePointerCursor(); query('[data-action="cancel-operation"]').hidden = true; host.onBusyChange?.(false); }
  }
  async function runPageOperation(change: (options: { signal: AbortSignal; onProgress: LoadProgressCallback; onDiagnostic: (diagnostic: PdfDiagnostic) => void }) => Promise<void>, externalSignal?: AbortSignal): Promise<void> {
    lifetime.signal.throwIfAborted(); externalSignal?.throwIfAborted();
    if (running || structuralRunning) throw new Error("Wait for the current operation to finish.");
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) throw new Error("Check the pending form value before changing pages.");
    if (activeText) await finishText();
    lifetime.signal.throwIfAborted(); externalSignal?.throwIfAborted();
    if (running || structuralRunning) throw new Error("Wait for the current operation to finish.");
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
    if (structuralRunning) return;
    const button = (event.target as Element).closest<HTMLButtonElement>("button"); if (!button) return;
    if (button.dataset.tool) { setTool(button.dataset.tool as Tool); return; }
    if (button.dataset.style) { applyTextStyle(button.dataset.style); return; }
    switch (button.dataset.action) {
      case "layers":
        if (layerDialog && !layerDialog.open) layerDialog.showModal();
        host.showLayerControls?.(); layerControls.show(); break;
      case "undo": changeHistory(false); break; case "redo": changeHistory(true); break;
      case "delete": commit(() => session.deleteSelection()); break; case "duplicate": commit(() => session.cloneSelection()); break;
      case "group": commit(() => session.groupSelection()); break; case "ungroup": commit(() => session.ungroupSelection()); break;
      case "apply-text": void finishText().catch(report); break; case "cancel-text": cancelText(); break;
      case "cancel-operation": operation?.abort(); break;
      case "pages":
        if (!pagesDialog) pagesDialog = showEditorPagesDialog(document, {
          getPages: () => session.getPages(),
          rotate: (indices, degrees) => runPageOperation(options => session.rotatePages(indices, degrees, options)),
          remove: indices => runPageOperation(options => session.removePages(indices, options)),
          insert: (files, at) => runPageOperation(options => insertEditorPdfFiles(session, files, at, options)),
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
  toolbar.addEventListener("input", opacityInput);
  toolbar.addEventListener("change", event => {
    if (structuralRunning) return;
    const input = event.target as HTMLInputElement;
    if (changeOpacity(input)) return;
    if (input.dataset.transform) {
      transformProperty(input.dataset.transform, Number(input.value));
      if (input.dataset.transform === "rotation") input.value = "0";
    } else if (activeText) {
      activeText.element.focus();
      if (input.dataset.prop === "color") document.execCommand("foreColor", false, input.value);
      if (input.dataset.prop === "font") {
        void selectedFont(input.value).then(async font => { await activateFont(font); document.execCommand("fontName", false, font.id); }).catch(report);
      }
      if (input.dataset.prop === "font-size") applySelectionCss(document, "fontSize", `${Number(input.value)}px`);
      if (input.dataset.prop === "align") activeText.element.style.textAlign = input.value;
    } else {
      const selection = session.getSelection(); if (!selection.length) return;
      const patch: Partial<EditorObject> = input.dataset.prop === "color" ? { color: input.value } : input.dataset.prop === "stroke" ? { strokeWidth: Number(input.value) } :
        input.dataset.prop === "fill" || input.dataset.prop === "fill-enabled" ? { fill: property("fill-enabled").checked ? property("fill").value : null } : {};
      if (input.dataset.prop === "font-size") Object.assign(patch, { fontSize: Number(input.value) });
      if (input.dataset.prop === "align") Object.assign(patch, { align: input.value });
      if (input.dataset.prop === "font") void selectedFont(input.value).then(font => commit(() => session.transaction("Change font", () => {
        for (const id of selection) { const object = session.getObject(id); if (object.kind === "text") session.updateObject(id, { fontId: font.id, fontFamily: font.family,
          runs: object.runs?.map(run => ({ ...run, fontId: font.id, fontFamily: font.family })) }); }
      }))).catch(report);
      if (Object.keys(patch).length) commit(() => session.transaction("Change appearance", () => {
        for (const id of selection) { const object = session.getObject(id); if (object.kind !== "source") session.updateObject(id, object.kind === "text"
          ? { ...patch, runs: object.runs?.map(run => ({ ...run, ...patch } as typeof run)) } : patch); }
      }));
    }
  });
  overlay.addEventListener("pointerdown", event => { void pointerDown(event).catch(report); });
  function canOpenContextMenu(): boolean {
    return active && !disposed && !running && !structuralRunning && !activeText && !pointer && !pendingPick && tool === "select" && !isSceneSettling();
  }
  function showSelectionContextMenu(): void {
    if (!canOpenContextMenu() || !session.getSelection().length) return;
    const frame = session.getSelectionFrame(); if (!frame) return;
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
    if (!id || !canOpenContextMenu() || request !== textRequest || revision !== session.revision || sourceScene !== session.sourceScene || selectionKey !== JSON.stringify(session.getSelection())) return;
    const after = host.sceneToClientPoint(point.x, point.y);
    if (!before || !after || Math.abs(before.x - after.x) + Math.abs(before.y - after.y) > .1) return;
    if (!selection.includes(id)) session.select([id]);
    contextMenu.show({ x: event.clientX, y: event.clientY });
  }
  overlay.addEventListener("contextmenu", event => { void openContextMenu(event).catch(report); });
  overlay.addEventListener("pointermove", pointerMove); overlay.addEventListener("pointerup", pointerUp);
  overlay.addEventListener("pointerenter", pointerMove);
  overlay.addEventListener("pointerleave", () => { signatureHover = null; });
  overlay.addEventListener("pointercancel", () => { signatureHover = null; cancelPointerGesture(); });
  overlay.addEventListener("lostpointercapture", event => { if (pointer?.id === event.pointerId || pendingPick?.id === event.pointerId && !pendingPick.released) cancelPointerGesture(); });
  overlay.addEventListener("wheel", event => {
    if (activeText || (event.target as Element).closest(".hepr-editor-field")) return;
    event.preventDefault(); event.stopPropagation();
    host.getCanvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }));
  }, { passive: false });
  async function doubleClick(event: MouseEvent): Promise<void> {
    if (!active || running || isSceneSettling()) return;
    if (tool === "polygon" || tool === "polyline") { completePolygon(); return; }
    if (tool !== "select" || activeText) return;
    const fieldId = fieldAtClientPoint({ x: event.clientX, y: event.clientY });
    if (fieldId) {
      cancelPointerGesture(); setTool("form");
      pendingFieldFocus = { id: fieldId, sourceScene: session.sourceScene };
      updateGeometry(); host.requestFrame?.(); return;
    }
    const pageIndex = (event.target as Element).getAttribute("data-selection-move") === "true" ? session.getSelectionFrame()?.pageIndex : undefined;
    const point = host.clientToScenePoint(event.clientX, event.clientY, pageIndex); if (!point) return;
    cancelPointerGesture();
    const request = ++textRequest;
    const id = await pick(point, { x: event.clientX, y: event.clientY });
    if (!id || disposed || !active || running || tool !== "select" || request !== textRequest) return; const object = session.getObject(id);
    if (object.kind === "text") { await startText(point, object); return; }
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
    if (!active || event.isComposing || event.keyCode === 229) return;
    if (structuralRunning) {
      if (event.key === "Escape") operation?.abort();
      if (event.key === "Escape" || (event.ctrlKey || event.metaKey) && /^[szd]$/i.test(event.key)) event.preventDefault();
      return;
    }
    if (event.key === "Escape") { polygon = null; cancelPointerGesture(); cancelText(); operation?.abort(); if (tool === "signature") setTool("select"); session.select([]); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save("pdf"); return; }
    if ((event.target as Element | null)?.closest?.("dialog")) return;
    if (inputTarget(event.target)) return;
    if ((event.key === "ContextMenu" || event.shiftKey && event.key === "F10") && canOpenContextMenu()) { event.preventDefault(); showSelectionContextMenu(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); changeHistory(event.shiftKey); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); commit(() => session.cloneSelection()); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); commit(() => session.deleteSelection()); }
    else if (event.key === "Enter" && polygon) { event.preventDefault(); completePolygon(); }
    else if (/^Arrow/.test(event.key) && session.getSelection().length) { event.preventDefault(); const d = event.shiftKey ? 10 : 1;
      commit(() => interaction.nudge(event.key === "ArrowLeft" ? -d : event.key === "ArrowRight" ? d : 0, event.key === "ArrowDown" ? -d : event.key === "ArrowUp" ? d : 0)); }
  }
  window.addEventListener("keydown", keydown, { signal: lifetime.signal });
  window.addEventListener("keydown", resizeModifiers, { signal: lifetime.signal });
  window.addEventListener("keyup", resizeModifiers, { signal: lifetime.signal });
  function hasUnsavedChanges(): boolean {
    return session.getState().dirty || hasPendingEditorTextChanges(activeText) || hasPendingEditorFields(fieldDrafts) ||
      pdfProtection.hasChanges() || Boolean(passwordDialog?.hasDraftChanges()) || structuralRunning;
  }
  function confirmDocumentChange(): boolean {
    return !hasUnsavedChanges() || window.confirm("Discard unsaved PDF changes and open another document?");
  }
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; }
  }
  window.addEventListener("beforeunload", beforeUnload, { signal: lifetime.signal });
  updatePointerCursor(); updateState(session.getState()); toolbar.hidden = overlay.hidden = true;
  return {
    async setEditing(value) {
      if (disposed || structuralRunning || active === value) return;
      contextMenu.close();
      if (!value) pendingFieldFocus = null;
      if (!value) { flushEditorFieldDrafts(fieldDrafts); if (activeText) await finishText(); }
      if (!value) { toolRequest++; cancelPointerGesture(); polygon = null; signatureHover = null; textRequest++; }
      active = value; toolbar.hidden = overlay.hidden = !value; document.body.classList.toggle("hepr-editing", value);
      layerControls.setActive(value); if (!value) layerDialog?.close();
      releaseFrameListener?.(); releaseFrameListener = null;
      if (value) releaseFrameListener = host.subscribeToFrames?.(() => { if (active && !disposed) updateGeometry(true); }) ?? null;
      host.setEditing(value); host.onModeChange?.(value);
      if (value) { updateGeometry(); await refreshScene(); tick(); } else window.cancelAnimationFrame(frame);
    },
    isEditing: () => active, isBusy: () => running || structuralRunning, isDirty: hasUnsavedChanges, save, attachDocuments, dropImages, confirmDocumentChange,
    dispose() {
      if (disposed) return; disposed = true; active = false; cancelPointerGesture(false); lifetime.abort(); scenePreparation?.abort(); operation?.abort(); window.cancelAnimationFrame(frame); window.cancelAnimationFrame(previewFrame);
      pendingFieldFocus = null;
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
