import "./editorUi.css";
import { openEditorSession } from "./editorSession";
import type { EditorColor, EditorMatrix, EditorObject, EditorObjectInput, EditorSession, EditorState, EditorTextObject } from "./editorTypes";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { ScenePrimitivePicker, getSceneAnnotationRuns, type PrimitivePoint } from "./scenePrimitives";
import { createEditorAppServices } from "./editorAppServices";
import { triggerBrowserDownload, formatPdfDownloadFilename } from "./downloadUtils";
import { createEditorSignatureLibrary, normalizeEditorSignature, type EditorSignature } from "./editorSignatures";
import { commitEditorText, hasPendingEditorTextChanges, normalizeEditorTextColor, readRichTextRuns, type EditorTextDraftBaseline } from "./editorRichText";
import type { EditorFont } from "./editorFonts";
import { createEditorFieldControl, createEditorFieldOptions, editorFieldDraftSignature, flushEditorFieldDrafts, hasPendingEditorFields, setEditorFieldControlValue, type EditorFieldControl } from "./editorFormControls";
import { editorBoundsClickHit, editorFieldClientGeometry, pickEditorMetadataAnnotation, transformEditorAnnotationText } from "./editorCoordinates";
import { applyEditorOpacity, editorStyledSelection, validateEditorOpacity } from "./editorProperties";
import { createEditorInteractionController } from "./editorInteraction";
import { LoadProgressReporter } from "./loadProgress";
import { createEditorPdfProtectionState, showEditorPdfPasswordDialog, type EditorPdfPasswordDialog } from "./editorPdfProtectionUi";
import { insertEditorPdfFiles, showEditorPagesDialog, type EditorPagesDialog } from "./editorPagesUi";
import type { LoadProgressCallback } from "./loadProgress";
import type { PdfDiagnostic } from "./pdf/nativeTypes";

export interface EditorUiHost {
  getCanvas(): HTMLCanvasElement;
  getScene(): VectorScene | null;
  prepareScene(signal: AbortSignal): Promise<VectorScene>;
  applyScene(scene: VectorScene, signal: AbortSignal): void | Promise<void>;
  documentChanged?(scene: VectorScene, source: { pdf?: Uint8Array; password?: string; label: string }): void | Promise<void>;
  getSource(): { pdf?: Uint8Array; password?: string; label: string };
  clientToScenePoint(x: number, y: number): PrimitivePoint | null;
  sceneToClientPoint(x: number, y: number, pageIndex?: number): PrimitivePoint | null;
  setEditing(active: boolean): void;
  onModeChange?(active: boolean): void;
}
export interface EditorUi {
  setEditing(active: boolean): Promise<void>;
  isEditing(): boolean;
  isDirty(): boolean;
  confirmDocumentChange(): boolean;
  save(kind: "pdf" | "flatten" | "hep" | "print"): Promise<void>;
  dispose(): void;
}

type Tool = "select" | "pan" | "form" | "text" | "rectangle" | "ellipse" | "line" | "arrow" | "polygon" | "polyline" | "ink" | "signature" | "image";
type PointerGesture = { id: number; start: PrimitivePoint; startClient: PrimitivePoint; last: PrimitivePoint; points: [number, number][]; bounds: Bounds | null; action: "draw" | "marquee" | "move" | "resize" | "rotate"; additive: boolean; handle?: string; freeResize?: boolean; scaleText?: boolean };
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
  const document = host.getCanvas().ownerDocument, window = document.defaultView!;
  let active = false, disposed = false, tool: Tool = "select", toolRequest = 0, frame = 0;
  let objectOpacity = 1;
  let renderRevision = 0, operation: AbortController | null = null, running = false;
  let previewFrame = 0, previewRunning = false, previewPending = false;
  let picker: ScenePrimitivePicker | null = null;
  let picking: AbortController | null = null;
  const fontFaces = new Map<string, FontFace>();
  let signature: EditorSignature | null = null, pendingImage: Omit<Extract<EditorObjectInput, { kind: "image" }>, "pageIndex" | "x" | "y" | "width" | "height"> | null = null;
  let activeText: { element: HTMLDivElement; objectId?: string; sourceAnnotationId?: string; pageIndex: number; x: number; y: number; width: number; height: number; transform: EditorMatrix; opacity?: number; lineHeight?: number; baseline: EditorTextDraftBaseline } | null = null;
  let textRequest = 0;
  let pointer: PointerGesture | null = null;
  let pendingPick: { id: number; point: PrimitivePoint; client: PrimitivePoint; lastClient: PrimitivePoint; released: boolean; canceled: boolean } | null = null;
  let polygon: { pageIndex: number; points: [number, number][] } | null = null;
  const toolbar = document.createElement("div"); toolbar.className = "hepr-editor-toolbar"; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "PDF editing tools");
  toolbar.innerHTML = `<div class="hepr-editor-tools">
    <button type="button" data-tool="select" aria-pressed="true">Select</button><button type="button" data-tool="pan">Pan</button><button type="button" data-tool="form">Fill fields</button>
    <button type="button" data-tool="text">Text</button><button type="button" data-tool="rectangle">Rectangle</button><button type="button" data-tool="ellipse">Ellipse</button>
    <button type="button" data-tool="line">Line</button><button type="button" data-tool="arrow">Arrow</button><button type="button" data-tool="polygon">Polygon</button><button type="button" data-tool="polyline">Polyline</button><button type="button" data-tool="ink">Pencil</button>
    <button type="button" data-action="signatures">Signatures</button><button type="button" data-action="image">Image</button>
    <button type="button" data-action="undo" aria-label="Undo (Ctrl/Cmd+Z)">Undo</button><button type="button" data-action="redo">Redo</button>
    <button type="button" data-action="duplicate">Duplicate</button><button type="button" data-action="delete">Delete</button><button type="button" data-action="group">Group</button><button type="button" data-action="ungroup">Ungroup</button>
  </div><div class="hepr-editor-properties">
    <label>Color <input data-prop="color" type="color" value="#111111"></label><label>Opacity <input data-prop="opacity" type="number" value="1" min="0" max="1" step="any" aria-label="Object opacity"></label><label>Width <input data-prop="stroke" type="number" value="2" min="0" step="any"></label>
    <label><input data-prop="fill-enabled" type="checkbox"> Fill</label><input data-prop="fill" type="color" value="#ffff00" aria-label="Fill color">
    <label>Font <select data-prop="font" aria-label="Font family"><option value="">Liberation Sans</option><option value="bundled:serif">Liberation Serif</option><option value="bundled:mono">Liberation Mono</option></select></label><button type="button" data-action="font">Import font</button><button type="button" data-action="local-fonts">Local fonts</button>
    <label>Size <input data-prop="font-size" type="number" value="12" min="0.1" step="any"></label>
    <button type="button" data-style="bold" aria-pressed="false"><b>B</b></button><button type="button" data-style="italic" aria-pressed="false"><i>I</i></button>
    <button type="button" data-style="underline" aria-pressed="false"><u>U</u></button><button type="button" data-style="strikethrough" aria-pressed="false"><s>S</s></button>
    <label>Align <select data-prop="align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    <button type="button" data-action="apply-text" hidden>Apply text</button><button type="button" data-action="cancel-text" hidden>Cancel text</button>
  </div><div class="hepr-editor-transform">
    <span data-selection>No selection</span><label>X <input data-transform="x" type="number" step="any"></label><label>Y <input data-transform="y" type="number" step="any"></label>
    <label>W <input data-transform="width" type="number" min="0.001" step="any"></label><label>H <input data-transform="height" type="number" min="0.001" step="any"></label><label>Rotate ° <input data-transform="rotation" type="number" step="any" value="0"></label>
    <button type="button" data-action="pages">Pages</button><button type="button" data-action="pdf-password">PDF password</button><button type="button" data-action="save-pdf">Save PDF</button><button type="button" data-action="flatten">Flattened PDF</button><button type="button" data-action="save-hep">Save HEP</button><button type="button" data-action="print">Print</button>
    <button type="button" data-action="cancel-operation" hidden>Cancel</button><span data-status role="status" aria-live="polite"></span>
  </div><div class="hepr-editor-help">Ctrl/Cmd + click toggles objects; Shift + click adds them. Drag empty space to select fully contained objects. Corner resizing keeps proportions; hold Shift to resize freely. Double-click a new textbox to edit it; resizing changes wrapping, Alt + resize scales text. Escape cancels.</div>`;
  const overlay = document.createElement("div"); overlay.className = "hepr-editor-overlay"; overlay.dataset.tool = tool;
  const graphic = document.createElementNS(SVG_NS, "svg"); graphic.classList.add("hepr-editor-graphic");
  const fields = document.createElement("div"); fields.className = "hepr-editor-fields"; fields.hidden = true;
  const fieldDrafts = new Map<EditorFieldControl, string>();
  overlay.append(graphic, fields); document.body.append(toolbar, overlay);
  const query = <T extends HTMLElement>(selector: string): T => toolbar.querySelector<T>(selector)!;
  const property = (name: string): HTMLInputElement => query(`[data-prop="${name}"]`);
  const status = query<HTMLSpanElement>("[data-status]");
  const setStatus = (text: string): void => { status.textContent = text; };
  const report = (error: unknown): void => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(message(error)); };
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
  function updateGeometry(): void {
    const canvas = host.getCanvas(), rect = canvas.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`; overlay.style.height = `${rect.height}px`;
    graphic.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    graphic.replaceChildren();
    let selection = pointer?.bounds ?? session.getSelectionBounds();
    if (selection && pointer?.bounds && ["move", "resize", "rotate"].includes(pointer.action)) {
      const candidate = dragMatrix(pointer, pointer.last);
      const [a, b, c, d, e, f] = candidate[0] * candidate[3] - candidate[1] * candidate[2] === 0 ? IDENTITY : candidate;
      const corners = [[selection.minX, selection.minY], [selection.maxX, selection.minY], [selection.maxX, selection.maxY], [selection.minX, selection.maxY]]
        .map(([x, y]) => ({ x: a * x + c * y + e, y: b * x + d * y + f }));
      selection = { minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)), maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)) };
    }
    if (selection && tool === "select" && !running && !activeText) {
      const b = sceneBoundsToClient(selection);
      if (b) {
        const x = b.minX - rect.left, y = b.minY - rect.top, width = b.maxX - b.minX, height = b.maxY - b.minY;
        svg("rect", { x, y, width, height, class: "hepr-editor-selection" });
        for (const [name, hx, hy] of [["nw", x, y], ["ne", x + width, y], ["sw", x, y + height], ["se", x + width, y + height]] as const) {
          svg("rect", { x: hx - 4, y: hy - 4, width: 8, height: 8, "data-handle": name, class: "hepr-editor-handle" });
        }
        svg("line", { x1: x + width / 2, y1: y, x2: x + width / 2, y2: y - 22, class: "hepr-editor-selection" });
        svg("circle", { cx: x + width / 2, cy: y - 22, r: 5, "data-handle": "rotate", class: "hepr-editor-handle" });
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
    for (const element of fields.querySelectorAll<HTMLElement>("[data-field-id]")) {
      const annotation = latestScene.annotations?.find(item => item.id === element.dataset.fieldId);
      const geometry = annotation && editorFieldClientGeometry(annotation, latestScene.pdfPages,
        (point, pageIndex) => host.sceneToClientPoint(point.x, point.y, pageIndex));
      const bounds = !geometry && annotation && sceneBoundsToClient(annotation.bounds, annotation.pageIndex);
      element.hidden = !geometry && !bounds;
      if (geometry) Object.assign(element.style, { left: `${geometry.origin.x - rect.left}px`, top: `${geometry.origin.y - rect.top}px`,
        width: `${geometry.width}px`, height: `${geometry.height}px`, transformOrigin: "0 0", transform: `matrix(${geometry.transform.join(",")})` });
      else if (bounds) Object.assign(element.style, { left: `${bounds.minX - rect.left}px`, top: `${bounds.minY - rect.top}px`,
        width: `${bounds.maxX - bounds.minX}px`, height: `${bounds.maxY - bounds.minY}px`, transformOrigin: "0 0", transform: "none" });
    }
    if (activeText) {
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
  function tick(): void { if (active && !disposed) { updateGeometry(); frame = window.requestAnimationFrame(tick); } }
  function updateState(state: EditorState): void {
    query<HTMLButtonElement>('[data-action="undo"]').disabled = !state.canUndo;
    query<HTMLButtonElement>('[data-action="redo"]').disabled = !state.canRedo;
    query("[data-selection]").textContent = state.selection.length ? `${state.selection.length} selected` : "No selection";
    for (const action of ["duplicate", "delete", "group", "ungroup"]) query<HTMLButtonElement>(`[data-action="${action}"]`).disabled = state.selection.length === 0;
    const bounds = session.getSelectionBounds();
    for (const [name, value] of Object.entries({ x: bounds?.minX, y: bounds?.minY, width: bounds && bounds.maxX - bounds.minX, height: bounds && bounds.maxY - bounds.minY })) {
      const input = query<HTMLInputElement>(`[data-transform="${name}"]`); input.disabled = !bounds;
      if (document.activeElement !== input) input.value = value == null ? "" : Number(value.toFixed(3)).toString();
    }
    if (!activeText && document.activeElement !== property("opacity")) {
      const styled = editorStyledSelection(session), values = styled.map(id => session.getObject(id).opacity ?? 1);
      property("opacity").disabled = tool === "select" && state.selection.length > 0 && styled.length === 0;
      if (values.length) { const common = values.every(value => value === values[0]); property("opacity").value = common ? String(values[0]) : "";
        property("opacity").placeholder = common ? "" : "Mixed"; if (common) objectOpacity = values[0]; }
    }
    if (!running) setStatus(state.previewing ? "Transform preview" : hasUnsavedChanges() ? "Unsaved changes" : "Saved");
    host.onModeChange?.(active);
  }
  const unsubscribe = session.subscribe(updateState);
  async function synchronizeDocumentSource(): Promise<void> {
    if (currentSourceScene === session.sourceScene) return;
    currentSourceScene = session.sourceScene; latestScene = currentSourceScene;
    picking?.abort(); picker?.dispose(); picker = null;
    await host.documentChanged?.(currentSourceScene, { pdf: session.sourcePdf, password: source.password, label: source.label });
    if (tool === "form") renderFields(); pagesDialog?.refresh();
  }
  async function refreshScene(externalSignal?: AbortSignal): Promise<void> {
    const revision = ++renderRevision, abort = new AbortController();
    if (!externalSignal) { operation?.abort(); operation = abort; }
    const signal = externalSignal ?? abort.signal;
    try {
      await synchronizeDocumentSource(); signal.throwIfAborted();
      const scene = await session.getScene({ signal });
      if (disposed || revision !== renderRevision) return;
      await host.applyScene(scene, signal);
      signal.throwIfAborted();
      // Field controls may already contain another field's uncommitted typing.
      // Geometry reads latestScene directly; async display refresh must retain their DOM.
      latestScene = scene;
    } catch (error) { report(error); }
    finally { if (operation === abort) operation = null; }
  }
  function commit(change: () => void): void {
    if (structuralRunning) return;
    if (pointer || pendingPick) cancelPointerGesture();
    try { change(); void refreshScene(); } catch (error) { report(error); }
  }
  function changeHistory(redo: boolean): void {
    commit(() => { if (redo) session.redo(); else session.undo(); if (tool === "form") renderFields(); });
  }
  function queuePreview(): void {
    previewPending = true;
    if (previewRunning || previewFrame) return;
    previewFrame = window.requestAnimationFrame(() => {
      previewFrame = 0; if (!pointer || !active || disposed) return;
      previewPending = false; previewRunning = true;
      void refreshScene().finally(() => { previewRunning = false; if (previewPending && pointer && active) queuePreview(); });
    });
  }
  function clearPreview(restore = false): void {
    window.cancelAnimationFrame(previewFrame); previewFrame = 0; previewPending = false;
    const wasPreviewing = session.getState().previewing; interaction.cancelTransform();
    if (restore && wasPreviewing) void refreshScene();
  }
  function updatePointerCursor(): void {
    overlay.dataset.gesture = pointer?.action ?? (pendingPick ? "pick" : "");
    overlay.dataset.resizeHandle = pointer?.action === "resize" ? pointer.handle ?? "" : "";
    overlay.dataset.busy = String(running);
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
    if (activeText) void finishText();
    else textRequest++;
    cancelPointerGesture(); polygon = null; tool = next; toolRequest++;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) button.setAttribute("aria-pressed", String(button.dataset.tool === next));
    overlay.dataset.tool = next; fields.hidden = next !== "form";
    if (next !== "select") property("opacity").disabled = false;
    if (next === "form") renderFields();
    updateGeometry();
  }
  function renderFields(): void {
    fields.replaceChildren(); fieldDrafts.clear();
    for (const annotation of latestScene.annotations ?? []) {
      const name = annotation.field?.name;
      const input = createEditorFieldControl(document, annotation, name ? session.getFieldValues().get(name) : undefined,
        value => commit(() => {
          session.setFieldValue(name!, value);
          for (const [control] of fieldDrafts) {
            const sibling = latestScene.annotations?.find(item => item.id === control.dataset.fieldId);
            if (!sibling || sibling.field?.name !== name) continue;
            setEditorFieldControlValue(control, sibling, value); fieldDrafts.set(control, editorFieldDraftSignature(control));
          }
        }));
      if (input) {
        fieldDrafts.set(input, editorFieldDraftSignature(input)); fields.append(input);
        const choices = createEditorFieldOptions(document, annotation, input); if (choices) fields.append(choices);
      }
    }
  }
  async function pick(point: PrimitivePoint, client: PrimitivePoint): Promise<string | null> {
    const objects = session.getObjects(), edits = session.getSourceEdits();
    const changed = new Set(edits.filter(edit => edit.deleted || edit.transform.some((value, index) => value !== IDENTITY[index])).map(edit => `${edit.ref.kind}:${edit.ref.index}`));
    for (let i = objects.length - 1; i >= 0; i--) {
      const object = objects[i];
      if (object.kind === "source" && !object.isClone && !object.primitives.some(ref => changed.has(`${ref.kind}:${ref.index}`))) continue;
      const bounds = session.getObjectBounds(objects[i].id);
      if (editorBoundsClickHit(bounds, point, client, p => host.sceneToClientPoint(p.x, p.y, object.pageIndex))) return objects[i].id;
    }
    const appearanceRuns = getSceneAnnotationRuns(session.sourceScene);
    const annotationId = pickEditorMetadataAnnotation(latestScene.annotations ?? [], point,
      annotation => session.getObjectBounds(`annotation:${annotation.id}`),
      annotation => appearanceRuns.get(annotation.id)?.some(run => run.count > 0) ?? false);
    if (annotationId) return `annotation:${annotationId}`;
    picker ??= new ScenePrimitivePicker(session.sourceScene);
    picking?.abort(); const controller = picking = new AbortController();
    try {
      const hit = await picker.pick({ point, clientPoint: client, isVisible: ref => !changed.has(`${ref.kind}:${ref.index}`),
        project: p => host.sceneToClientPoint(p.x, p.y), unproject: p => host.clientToScenePoint(p.x, p.y), signal: AbortSignal.any([lifetime.signal, controller.signal]) });
      return hit ? `source:${hit.primitive.kind}:${hit.primitive.index}` : null;
    } finally { if (picking === controller) picking = null; }
  }
  function dragMatrix(p: PointerGesture, point: PrimitivePoint): EditorMatrix {
    const bounds = p.bounds!;
    if (p.action === "move") return [1, 0, 0, 1, point.x - p.start.x, point.y - p.start.y];
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    if (p.action === "rotate") {
      const angle = Math.atan2(point.y - cy, point.x - cx) - Math.atan2(p.start.y - cy, p.start.x - cx), c = Math.cos(angle), s = Math.sin(angle);
      return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
    }
    const left = p.handle?.includes("w"), top = p.handle?.includes("n"), px = left ? bounds.maxX : bounds.minX, py = top ? bounds.minY : bounds.maxY;
    const dx = p.start.x - px, dy = p.start.y - py;
    if (!p.freeResize) {
      const length = Math.hypot(dx, dy);
      const scale = length === 0 ? 1 : ((point.x - px) * (dx / length) + (point.y - py) * (dy / length)) / length;
      return [scale, 0, 0, scale, px * (1 - scale), py * (1 - scale)];
    }
    const sx = Math.abs(dx) < 1e-9 ? 1 : (point.x - px) / dx, sy = Math.abs(dy) < 1e-9 ? 1 : (point.y - py) / dy;
    return [sx, 0, 0, sy, px * (1 - sx), py * (1 - sy)];
  }
  function resizeTextBox(p: PointerGesture, object: EditorTextObject, matrix: EditorMatrix): Partial<EditorTextObject> | null {
    const [a, b, c, d, e, f] = object.transform, determinant = a * d - b * c;
    if (determinant === 0) return null;
    if (!p.freeResize) {
      const scale = matrix[0], pageX = session.sourceScene.pageRects[object.pageIndex * 4], pageY = session.sourceScene.pageRects[object.pageIndex * 4 + 1];
      const worldX = pageX + a * object.x + c * object.y + e, worldY = pageY + b * object.x + d * object.y + f;
      const x = scale * worldX + matrix[4] - pageX - e, y = scale * worldY + matrix[5] - pageY - f;
      return { x: (d * x - c * y) / determinant, y: (-b * x + a * y) / determinant, width: object.width * scale, height: object.height * scale };
    }
    const dx = p.last.x - p.start.x, dy = p.last.y - p.start.y;
    const lx = (d * dx - c * dy) / determinant, ly = (-b * dx + a * dy) / determinant;
    const west = p.handle?.includes("w"), north = p.handle?.includes("n");
    const width = object.width + (west ? -lx : lx), height = object.height + (north ? ly : -ly);
    return width > 0 && height > 0 ? { x: object.x + (west ? lx : 0), y: object.y + (north ? 0 : ly), width, height } : null;
  }
  async function pointerDown(event: PointerEvent): Promise<void> {
    if (!active || running || activeText || pointer || pendingPick || tool === "pan" || tool === "form" || event.button !== 0 || (event.target as Element).closest(".hepr-editor-field")) return;
    textRequest++;
    const point = host.clientToScenePoint(event.clientX, event.clientY); if (!point || tool !== "select" && pageAt(point) < 0) return;
    event.preventDefault(); event.stopPropagation();
    const client = { x: event.clientX, y: event.clientY }, toggle = event.ctrlKey || event.metaKey, additive = toggle || event.shiftKey;
    const targetHandle = tool === "select" ? (event.target as Element).getAttribute("data-handle") : null;
    const handle = targetHandle && ["nw", "ne", "sw", "se", "rotate"].includes(targetHandle) && session.getSelectionBounds() ? targetHandle : null;
    if (tool === "polygon" || tool === "polyline") {
      polygon ??= { pageIndex: pageAt(point), points: [] };
      if (polygon.pageIndex === pageAt(point)) polygon.points.push([point.x, point.y]);
      return;
    }
    if (tool === "text") { await startText(point); return; }
    if (tool === "signature") { if (signature) placeSignature(point); return; }
    if (tool === "image") { if (pendingImage) placeImage(point); return; }
    let action: PointerGesture["action"] = "draw";
    if (tool === "select") {
      if (handle) action = handle === "rotate" ? "rotate" : "resize";
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
          const last = host.clientToScenePoint(request.lastClient.x, request.lastClient.y);
          if (last && Math.hypot(request.lastClient.x - client.x, request.lastClient.y - client.y) > 2) {
            if (id) commit(() => interaction.applyTransform([1, 0, 0, 1, last.x - point.x, last.y - point.y]));
            else interaction.selectArea({ minX: Math.min(point.x, last.x), minY: Math.min(point.y, last.y), maxX: Math.max(point.x, last.x), maxY: Math.max(point.y, last.y) }, { shiftKey: additive });
          }
          return;
        }
      }
    }
    pointer = { id: event.pointerId, start: point, startClient: client, last: point, points: [[point.x, point.y]], bounds: session.getSelectionBounds(), action, additive, handle: handle ?? undefined,
      freeResize: event.shiftKey, scaleText: event.altKey };
    updatePointerCursor();
    overlay.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event: PointerEvent): void {
    if (pendingPick?.id === event.pointerId) pendingPick.lastClient = { x: event.clientX, y: event.clientY };
    if (!pointer || event.pointerId !== pointer.id) return;
    const point = host.clientToScenePoint(event.clientX, event.clientY); if (!point) return;
    pointer.last = point; pointer.freeResize = event.shiftKey; pointer.scaleText = event.altKey;
    if (pointer.action === "draw" && tool === "ink") {
      for (const sample of event.getCoalescedEvents?.() ?? [event]) {
        const p = host.clientToScenePoint(sample.clientX, sample.clientY); if (p) pointer.points.push([p.x, p.y]);
      }
    } else if (pointer.bounds && ["move", "resize", "rotate"].includes(pointer.action)) {
      const matrix = dragMatrix(pointer, point);
      if (matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0) { interaction.previewTransform(matrix); queuePreview(); }
      else clearPreview(true);
    }
    event.preventDefault();
  }
  function resizeModifiers(event: KeyboardEvent): void {
    if (!active || running || event.isComposing || !pointer?.bounds || pointer.action !== "resize" || event.key !== "Shift" && event.key !== "Alt") return;
    pointer.freeResize = event.shiftKey; pointer.scaleText = event.altKey;
    const matrix = dragMatrix(pointer, pointer.last);
    if (matrix[0] * matrix[3] - matrix[1] * matrix[2] !== 0) { interaction.previewTransform(matrix); queuePreview(); }
    else clearPreview(true);
  }
  function pointerUp(event: PointerEvent): void {
    if (pendingPick?.id === event.pointerId) { pendingPick.released = true; pendingPick.lastClient = { x: event.clientX, y: event.clientY }; overlay.releasePointerCapture?.(event.pointerId); }
    const p = pointer; if (!p || event.pointerId !== p.id) return; pointer = null; updatePointerCursor();
    if (p.action === "resize") {
      p.last = host.clientToScenePoint(event.clientX, event.clientY) ?? p.last;
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
        if (p.action === "resize" && object?.kind === "text" && !p.scaleText && (p.freeResize || matrix[0] > 0)) {
          const patch = resizeTextBox(p, object, matrix);
          if (patch) commit(() => session.updateObject(object.id, patch));
        } else commit(() => interaction.applyTransform(matrix));
      }
    } else if (moved) {
      const pageIndex = pageAt(p.start), [x, y] = pageLocal({ x: Math.min(p.start.x, p.last.x), y: Math.min(p.start.y, p.last.y) }, pageIndex);
      let object: EditorObjectInput;
      if (tool === "ink") object = { kind: "ink", pageIndex, opacity: objectOpacity, paths: [p.points.map(([px, py]) => pageLocal({ x: px, y: py }, pageIndex))], color: property("color").value, strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null };
      else object = { kind: "shape", pageIndex, shape: tool as "rectangle" | "ellipse" | "line" | "arrow", x, y,
        width: Math.abs(p.last.x - p.start.x), height: Math.abs(p.last.y - p.start.y),
        points: tool === "line" || tool === "arrow" ? [pageLocal(p.start, pageIndex), pageLocal(p.last, pageIndex)] : undefined,
        opacity: objectOpacity, color: property("color").value, strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null };
      commit(() => { const id = session.addObject(object); session.select([id]); });
    }
  }
  function completePolygon(): void {
    if (!polygon || polygon.points.length < (tool === "polyline" ? 2 : 3)) { polygon = null; return; }
    const p = polygon; polygon = null;
    const minX = Math.min(...p.points.map(point => point[0])), minY = Math.min(...p.points.map(point => point[1]));
    const [x, y] = pageLocal({ x: minX, y: minY }, p.pageIndex);
    commit(() => { const id = session.addObject({ kind: "shape", shape: tool === "polyline" ? "polyline" : "polygon", pageIndex: p.pageIndex, opacity: objectOpacity, x, y,
      width: Math.max(...p.points.map(point => point[0])) - minX, height: Math.max(...p.points.map(point => point[1])) - minY,
      points: p.points.map(([px, py]) => pageLocal({ x: px, y: py }, p.pageIndex)), color: property("color").value,
      strokeWidth: Number(property("stroke").value), fill: property("fill-enabled").checked ? property("fill").value : null }); session.select([id]); });
  }
  async function activateFont(font: EditorFont): Promise<void> {
    if (fontFaces.has(font.id)) return;
    const face = new FontFace(font.id, font.bytes.slice().buffer, { weight: String(font.fontWeight), style: font.fontStyle });
    await face.load(); if (disposed) throw new DOMException("Editor closed.", "AbortError");
    if (fontFaces.has(font.id)) return; document.fonts.add(face); fontFaces.set(font.id, face);
  }
  async function selectedFont(id = query<HTMLSelectElement>('[data-prop="font"]').value): Promise<EditorFont> {
    return id && !id.startsWith("bundled:") ? editorServices.fonts.get(id) : editorServices.fonts.loadBundled(id === "bundled:serif" ? "Liberation Serif" : id === "bundled:mono" ? "Liberation Mono" : "Liberation Sans");
  }
  async function startText(point: PrimitivePoint, object?: EditorTextObject, sourceAnnotationId?: string): Promise<void> {
    if (structuralRunning) return;
    const request = ++textRequest;
    const pageIndex = object?.pageIndex ?? pageAt(point); if (pageIndex < 0) return;
    const selectedFontId = object?.fontId ?? query<HTMLSelectElement>('[data-prop="font"]').value;
    const font = object && !selectedFontId ? await editorServices.fonts.loadBundled(object.fontFamily) : await selectedFont(selectedFontId);
    await activateFont(font); if (disposed || !active || request !== textRequest) return;
    if (object) {
      updateFonts(); query<HTMLSelectElement>('[data-prop="font"]').value = font.id;
      property("font-size").value = String(object.fontSize); property("color").value = normalizeEditorTextColor(colorCss(object.color));
      objectOpacity = object.opacity ?? 1; property("opacity").value = String(objectOpacity); property("opacity").disabled = false;
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
    activeText = { element, objectId: sourceAnnotationId ? undefined : object?.id, sourceAnnotationId, pageIndex, x, y: object ? y : y - 50,
      width: object?.width ?? 220, height: object?.height ?? 50, transform: object?.transform ?? IDENTITY, opacity: object?.opacity ?? objectOpacity, lineHeight: object?.lineHeight,
      baseline: { html: element.innerHTML, align: element.style.textAlign, opacity: object?.opacity ?? objectOpacity } };
    overlay.append(element); query('[data-action="apply-text"]').hidden = false; query('[data-action="cancel-text"]').hidden = false;
    updateGeometry(); element.focus(); activeText.baseline.html = element.innerHTML;
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
    const height = Math.max(editing.height, element.scrollHeight);
    const object: Extract<EditorObjectInput, { kind: "text" }> = { kind: "text", pageIndex: editing.pageIndex, x: editing.x, y: editing.y + editing.height - height, width: editing.width,
      transform: editing.transform, opacity: editing.opacity, lineHeight: editing.lineHeight,
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
  async function importImage(file: File, request: number): Promise<void> {
    const bitmap = await createImageBitmap(file);
    try {
      if (disposed || !active || request !== toolRequest) return;
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Image decoding is unavailable."); context.drawImage(bitmap, 0, 0);
      pendingImage = { kind: "image", imageWidth: bitmap.width, imageHeight: bitmap.height, data: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
      setTool("image"); setStatus("Click the page to place the image.");
    } finally { bitmap.close(); }
  }
  function placeImage(point: PrimitivePoint): void {
    if (!pendingImage) return; const pageIndex = pageAt(point), [x, y] = pageLocal(point, pageIndex), image = pendingImage;
    const width = Math.min(240, (session.sourceScene.pageRects[pageIndex * 4 + 2] - session.sourceScene.pageRects[pageIndex * 4]) * 0.5), height = width * image.imageHeight / image.imageWidth;
    commit(() => { const id = session.addObject({ ...image, kind: "image", pageIndex, opacity: objectOpacity, x, y: y - height, width, height }); session.select([id]); }); setTool("select");
  }
  function placeSignature(point: PrimitivePoint): void {
    if (!signature) return; const pageIndex = pageAt(point), [x, y] = pageLocal(point, pageIndex), asset = signature;
    const width = Math.min(180, (session.sourceScene.pageRects[pageIndex * 4 + 2] - session.sourceScene.pageRects[pageIndex * 4]) * 0.4), scale = width / asset.width;
    commit(() => { const id = session.addObject({ kind: "signature", pageIndex, opacity: objectOpacity,
      paths: asset.paths.map(path => Array.from({ length: path.length / 2 }, (_, index) => [x + path[index * 2] * scale, y - path[index * 2 + 1] * scale] as [number, number])),
      color: property("color").value, strokeWidth: Number(property("stroke").value) }); session.select([id]); });
  }
  async function save(kind: "pdf" | "flatten" | "hep" | "print"): Promise<void> {
    if (structuralRunning) return;
    if ((kind === "pdf" || kind === "flatten") && passwordDialog && !passwordDialog.apply()) return;
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) return;
    if (activeText) await finishText();
    if (running) return;
    const protection = kind === "pdf" || kind === "flatten" ? pdfProtection.get() : undefined;
    const wasPreviewing = session.getState().previewing;
    cancelPointerGesture(false); running = true; updatePointerCursor();
    operation?.abort(); const abort = new AbortController(); operation = abort;
    query('[data-action="cancel-operation"]').hidden = false; setStatus(`Preparing ${kind === "hep" ? "HEP" : "PDF"}…`);
    try {
      if (wasPreviewing) await refreshScene(lifetime.signal);
      const warnings: string[] = [], onWarning = (value: string): void => { warnings.push(value); setStatus(value); };
      const progress = new LoadProgressReporter(value => setStatus(`Preparing ${kind === "hep" ? "HEP" : "PDF"}… ${Math.round(value.value * 100)}%`));
      let blob: Blob;
      if (kind === "print") {
        const { writeScenePdf } = await import("./editorPdfWriter");
        blob = await writeScenePdf(await session.getScene({ signal: abort.signal, preview: false, onProgress: progress.child(0, .4).toCallback() }),
          { signal: abort.signal, onWarning, onProgress: progress.child(.4, 1).toCallback() });
      } else blob = kind === "hep" ? await session.saveHep({ signal: abort.signal, onProgress: progress.toCallback() })
        : await session.savePdf({ signal: abort.signal, flatten: kind === "flatten", protection, onWarning, onProgress: progress.toCallback() });
      abort.signal.throwIfAborted();
      if (kind === "print") printPdfBlob(blob, document);
      else { const base = formatPdfDownloadFilename(source.label).replace(/\.pdf$/i, ""); triggerBrowserDownload(blob, `${base}${kind === "hep" ? "-edited.hep" : kind === "flatten" ? "-flattened.pdf" : "-edited.pdf"}`); }
      if (protection) pdfProtection.markSaved(protection);
      setStatus(warnings.length ? warnings.join(" ") : kind === "print" ? "Print-ready PDF opened" : hasUnsavedChanges() ? "Unsaved changes" : "Saved");
    } catch (error) { report(error); }
    finally { if (operation === abort) operation = null; running = false; updatePointerCursor(); query('[data-action="cancel-operation"]').hidden = true; }
  }
  async function runPageOperation(change: (options: { signal: AbortSignal; onProgress: LoadProgressCallback; onDiagnostic: (diagnostic: PdfDiagnostic) => void }) => Promise<void>): Promise<void> {
    if (running || structuralRunning) throw new Error("Wait for the current operation to finish.");
    flushEditorFieldDrafts(fieldDrafts);
    if (hasPendingEditorFields(fieldDrafts)) throw new Error("Check the pending form value before changing pages.");
    if (activeText) await finishText();
    if (running || structuralRunning) throw new Error("Wait for the current operation to finish.");
    structuralRunning = running = true; toolbar.inert = overlay.inert = true;
    polygon = null; textRequest++; cancelPointerGesture(false);
    operation?.abort(); const abort = new AbortController(); operation = abort;
    const signal = AbortSignal.any([lifetime.signal, abort.signal]);
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
      updatePointerCursor();
      query('[data-action="cancel-operation"]').hidden = true;
      if (!disposed) { pagesDialog?.refresh(); updateState(session.getState()); if (warnings.length) setStatus(warnings.join(" ")); }
    }
  }
  toolbar.addEventListener("pointerdown", event => { if ((event.target as Element).closest("[data-style]")) event.preventDefault(); });
  toolbar.addEventListener("click", event => {
    if (structuralRunning) return;
    const button = (event.target as Element).closest<HTMLButtonElement>("button"); if (!button) return;
    if (button.dataset.tool) { setTool(button.dataset.tool as Tool); return; }
    if (button.dataset.style) { applyTextStyle(button.dataset.style); return; }
    switch (button.dataset.action) {
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
      case "signatures": showSignatureDialog(document, value => { signature = value; setTool("signature"); setStatus("Click the page to place your signature."); }, report); break;
    }
  });
  toolbar.addEventListener("change", event => {
    if (structuralRunning) return;
    const input = event.target as HTMLInputElement;
    if (input.dataset.prop === "opacity") {
      try {
        objectOpacity = validateEditorOpacity(input.value.trim() ? Number(input.value) : NaN);
        if (activeText) activeText.opacity = objectOpacity;
        else if (editorStyledSelection(session).length) commit(() => applyEditorOpacity(session, objectOpacity));
      } catch (error) { report(error); input.value = String(objectOpacity); }
      return;
    }
    if (input.dataset.transform) {
      const bounds = session.getSelectionBounds(), value = Number(input.value); if (!bounds || !Number.isFinite(value)) return;
      const name = input.dataset.transform, cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
      if (name === "rotation") { const angle = value * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle); commit(() => interaction.applyTransform([c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy])); input.value = "0"; }
      else if (name === "x" || name === "y") commit(() => interaction.nudge(name === "x" ? value - bounds.minX : 0, name === "y" ? value - bounds.minY : 0));
      else { const old = name === "width" ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY; if (old <= 0 || value <= 0) return;
        const sx = name === "width" ? value / old : 1, sy = name === "height" ? value / old : 1;
        commit(() => interaction.applyTransform([sx, 0, 0, sy, bounds.minX * (1 - sx), bounds.minY * (1 - sy)])); }
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
  overlay.addEventListener("pointermove", pointerMove); overlay.addEventListener("pointerup", pointerUp);
  overlay.addEventListener("pointercancel", () => cancelPointerGesture());
  overlay.addEventListener("lostpointercapture", event => { if (pointer?.id === event.pointerId || pendingPick?.id === event.pointerId && !pendingPick.released) cancelPointerGesture(); });
  overlay.addEventListener("wheel", event => {
    if (activeText || (event.target as Element).closest(".hepr-editor-field")) return;
    event.preventDefault(); event.stopPropagation();
    host.getCanvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }));
  }, { passive: false });
  async function doubleClick(event: MouseEvent): Promise<void> {
    if (!active || running) return;
    if (tool === "polygon" || tool === "polyline") { completePolygon(); return; }
    if (tool !== "select" || activeText) return;
    const point = host.clientToScenePoint(event.clientX, event.clientY); if (!point) return;
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
    if (event.key === "Escape") { polygon = null; cancelPointerGesture(); cancelText(); operation?.abort(); session.select([]); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save("pdf"); return; }
    if ((event.target as Element | null)?.closest?.("dialog")) return;
    if (inputTarget(event.target)) return;
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
      if (!value) { flushEditorFieldDrafts(fieldDrafts); if (activeText) await finishText(); }
      if (!value) { toolRequest++; cancelPointerGesture(); polygon = null; textRequest++; }
      active = value; toolbar.hidden = overlay.hidden = !value; document.body.classList.toggle("hepr-editing", value);
      host.setEditing(value); host.onModeChange?.(value);
      if (value) { await refreshScene(); tick(); } else window.cancelAnimationFrame(frame);
    },
    isEditing: () => active, isDirty: hasUnsavedChanges, save, confirmDocumentChange,
    dispose() {
      if (disposed) return; disposed = true; active = false; cancelPointerGesture(false); lifetime.abort(); operation?.abort(); window.cancelAnimationFrame(frame); window.cancelAnimationFrame(previewFrame);
      passwordDialog?.close(); pagesDialog?.close(true); pdfProtection.dispose();
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

function printPdfBlob(blob: Blob, document: Document): void {
  const url = URL.createObjectURL(blob), frame = document.createElement("iframe"); frame.className = "hepr-editor-print-frame"; frame.src = url;
  frame.setAttribute("title", "Print edited PDF"); document.body.append(frame);
  const cleanup = (): void => { frame.remove(); URL.revokeObjectURL(url); };
  let downloaded = false;
  const fallback = (): void => { if (downloaded) return; downloaded = true; triggerBrowserDownload(blob, "edited-print.pdf"); cleanup(); };
  frame.addEventListener("load", () => {
    try {
      const target = frame.contentWindow;
      if (!target || typeof target.print !== "function") { fallback(); return; }
      target.addEventListener("afterprint", cleanup, { once: true }); target.focus(); target.print();
    } catch { fallback(); }
  }, { once: true });
  frame.addEventListener("error", fallback, { once: true });
  window.addEventListener("afterprint", cleanup, { once: true });
  // Keep the print document alive while the native PDF viewer owns it.
}

function showSignatureDialog(document: Document, onChoose: (signature: EditorSignature) => void, onError: (error: unknown) => void): void {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-signature-dialog";
  dialog.innerHTML = `<h2>Handwritten signatures</h2><div class="hepr-editor-signature-library"></div><label>Name <input data-signature-name value="Signature"></label>
    <canvas width="720" height="240" aria-label="Draw your signature"></canvas><p>Draw with your mouse, pen, or finger. Signatures are stored in this browser.</p>
    <div><button type="button" data-signature-action="clear">Clear drawing</button><button type="button" data-signature-action="save">Save and use</button><button type="button" data-signature-action="use">Use without saving</button><button type="button" data-signature-action="close">Close</button></div><p data-signature-status role="status"></p>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector("canvas")!, context = canvas.getContext("2d")!, paths: number[][] = [];
  let current: number[] | null = null;
  const status = dialog.querySelector<HTMLElement>("[data-signature-status]")!;
  let library: ReturnType<typeof createEditorSignatureLibrary> | undefined;
  try { library = createEditorSignatureLibrary(document.defaultView!.localStorage); } catch (error) { status.textContent = message(error); }
  function redraw(): void {
    context.clearRect(0, 0, canvas.width, canvas.height); context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
    for (const path of paths) { context.beginPath(); context.moveTo(path[0], path[1]); for (let i = 2; i < path.length; i += 2) context.lineTo(path[i], path[i + 1]); context.stroke(); }
  }
  function showLibrary(): void {
    const container = dialog.querySelector<HTMLElement>(".hepr-editor-signature-library")!; container.replaceChildren();
    try {
      for (const item of library?.list() ?? []) {
        const row = document.createElement("div"), use = document.createElement("button"), remove = document.createElement("button");
        use.type = remove.type = "button"; use.textContent = item.name; remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete ${item.name}`);
        use.addEventListener("click", () => { onChoose(item); dialog.close(); });
        remove.addEventListener("click", () => { try { library?.remove(item.id); showLibrary(); } catch (error) { status.textContent = message(error); } });
        row.append(use, remove); container.append(row);
      }
    } catch (error) { status.textContent = message(error); }
  }
  const point = (event: PointerEvent): [number, number] => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; };
  canvas.addEventListener("pointerdown", event => { event.preventDefault(); current = point(event); paths.push(current); canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", event => { if (!current) return; for (const sample of event.getCoalescedEvents?.() ?? [event]) current.push(...point(sample)); redraw(); });
  canvas.addEventListener("pointerup", event => { if (current?.length === 2) current.push(current[0] + 0.01, current[1]); current = null; canvas.releasePointerCapture(event.pointerId); redraw(); });
  canvas.addEventListener("pointercancel", () => { current = null; });
  dialog.addEventListener("click", event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-signature-action]")?.dataset.signatureAction;
    if (action === "clear") { paths.length = 0; redraw(); }
    if (action === "close") dialog.close();
    if (action === "save" || action === "use") {
      try {
        const item = normalizeEditorSignature(paths, dialog.querySelector<HTMLInputElement>("[data-signature-name]")!.value, crypto.randomUUID());
        if (action === "save") { if (!library) throw new Error("Browser signature storage is unavailable. Use without saving instead."); library.save(item); }
        onChoose(item); dialog.close();
      } catch (error) { status.textContent = message(error); onError(error); }
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); showLibrary(); dialog.showModal();
}
