import { createEditorSignatureLibrary, normalizeEditorSignature, type EditorSignature } from "./editorSignatures";
import { appendEditorInkSamples } from "./editorInkCapture";
import { fitEditorInkPaths, editorInkBounds, editorInkPathData, type EditorInkSegment } from "./editorInkGeometry";

const SVG_NS = "http://www.w3.org/2000/svg";
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The library and placed copy derive the same vector from the unmodified template. */
export function createEditorSignaturePreview(document: Document, signature: EditorSignature): SVGSVGElement {
  const paths = signature.paths.map(path => Array.from({ length: path.length / 2 }, (_, index) => [path[index * 2], path[index * 2 + 1]] as [number, number]));
  const curves = fitEditorInkPaths(paths, signature.smoothing ?? 0), bounds = editorInkBounds(curves)!;
  const padding = Math.max(2, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * .025);
  const width = Math.max(1, bounds.maxX - bounds.minX), height = Math.max(1, bounds.maxY - bounds.minY);
  const svg = document.createElementNS(SVG_NS, "svg"), path = document.createElementNS(SVG_NS, "path");
  svg.setAttribute("viewBox", `${(bounds.minX + bounds.maxX - width) / 2 - padding} ${(bounds.minY + bounds.maxY - height) / 2 - padding} ${width + padding * 2} ${height + padding * 2}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("hepr-editor-signature-preview");
  path.setAttribute("d", editorInkPathData(curves)); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(path); return svg;
}

export function showSignatureDialog(document: Document, onChoose: (signature: EditorSignature) => void, onError: (error: unknown) => void): void {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-signature-dialog";
  dialog.innerHTML = `<h2>Handwritten signatures</h2><div class="hepr-editor-signature-library"></div><label>Name <input data-signature-name value="Signature"></label>
    <canvas width="720" height="240" aria-label="Draw your signature"></canvas><label class="hepr-editor-signature-smoothing"><input type="checkbox" data-signature-smooth checked> Smooth strokes</label>
    <p>Draw with your mouse, pen, or finger. Signatures are stored in this browser.</p>
    <div><button type="button" data-signature-action="clear">Clear drawing</button><button type="button" data-signature-action="save">Save and use</button><button type="button" data-signature-action="use">Use without saving</button><button type="button" data-signature-action="close">Close</button></div><p data-signature-status role="status"></p>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector("canvas")!, context = canvas.getContext("2d")!, paths: [number, number][][] = [];
  const smooth = dialog.querySelector<HTMLInputElement>("[data-signature-smooth]")!;
  smooth.title = "Gently smooth handwriting while keeping its shape";
  const completed = new Map<readonly [number, number][], { tolerance: number; curves: EditorInkSegment[][] }>();
  let current: [number, number][] | null = null, pointerId: number | null = null;
  const status = dialog.querySelector<HTMLElement>("[data-signature-status]")!;
  let library: ReturnType<typeof createEditorSignatureLibrary> | undefined;
  try { library = createEditorSignatureLibrary(document.defaultView!.localStorage); } catch (error) { status.textContent = message(error); }
  const tolerance = (): number => smooth.checked ? .35 * canvas.width / Math.max(1, canvas.getBoundingClientRect().width) : 0;
  function redraw(): void {
    context.clearRect(0, 0, canvas.width, canvas.height); context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
    context.strokeStyle = context.fillStyle = "#111";
    const error = tolerance();
    for (const points of paths) {
      if (!points.length) continue;
      context.beginPath(); context.moveTo(points[0][0], points[0][1]);
      if (points === current) {
        for (let index = 1; index < points.length; index++) context.lineTo(points[index][0], points[index][1]);
      } else {
        let fitted = completed.get(points);
        if (!fitted || fitted.tolerance !== error) { fitted = { tolerance: error, curves: fitEditorInkPaths([points], error) }; completed.set(points, fitted); }
        for (const segment of fitted.curves[0] ?? []) {
          if (segment.control) context.quadraticCurveTo(...segment.control, ...segment.end);
          else context.lineTo(...segment.end);
        }
      }
      if (points.length === 1 || points.every(point => point[0] === points[0][0] && point[1] === points[0][1])) {
        context.arc(points[0][0], points[0][1], 1.5, 0, Math.PI * 2); context.fill();
      } else context.stroke();
    }
  }
  function showLibrary(): void {
    const container = dialog.querySelector<HTMLElement>(".hepr-editor-signature-library")!; container.replaceChildren();
    try {
      const items = library?.list() ?? [];
      if (!items.length) { const empty = document.createElement("p"); empty.className = "hepr-editor-signature-empty"; empty.textContent = "No saved signatures yet. Draw one below."; container.append(empty); }
      for (const item of items) {
        const row = document.createElement("div"), use = document.createElement("button"), remove = document.createElement("button"), name = document.createElement("span");
        row.className = "hepr-editor-signature-card"; use.className = "hepr-editor-signature-use"; remove.className = "hepr-editor-signature-remove";
        use.type = remove.type = "button"; name.textContent = item.name; use.title = `Use ${item.name}`; use.setAttribute("aria-label", `Use signature ${item.name}`);
        use.append(createEditorSignaturePreview(document, item), name); remove.textContent = "Delete"; remove.title = `Delete ${item.name}`; remove.setAttribute("aria-label", `Delete ${item.name}`);
        use.addEventListener("click", () => { onChoose(item); dialog.close(); });
        remove.addEventListener("click", () => { try { library?.remove(item.id); showLibrary(); } catch (error) { status.textContent = message(error); } });
        row.append(use, remove); container.append(row);
      }
    } catch (error) { status.textContent = message(error); }
  }
  const point = (event: PointerEvent): [number, number] => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; };
  canvas.addEventListener("pointerdown", event => {
    if (current || event.button !== 0) return; event.preventDefault(); current = [point(event)]; paths.push(current); pointerId = event.pointerId; canvas.setPointerCapture(pointerId); redraw();
  });
  canvas.addEventListener("pointermove", event => { if (!current || event.pointerId !== pointerId) return; appendEditorInkSamples(current, event, point); redraw(); });
  canvas.addEventListener("pointerup", event => {
    if (!current || event.pointerId !== pointerId) return; appendEditorInkSamples(current, event, point); current = null; pointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); redraw();
  });
  const cancelStroke = (event: PointerEvent): void => { if (current && event.pointerId === pointerId) { paths.splice(paths.indexOf(current), 1); current = null; pointerId = null; redraw(); } };
  canvas.addEventListener("pointercancel", cancelStroke); canvas.addEventListener("lostpointercapture", cancelStroke);
  smooth.addEventListener("change", () => { completed.clear(); redraw(); });
  dialog.addEventListener("click", event => {
    const action = (event.target as Element).closest<HTMLElement>("[data-signature-action]")?.dataset.signatureAction;
    if (action === "clear") { current = null; pointerId = null; paths.length = 0; completed.clear(); redraw(); }
    if (action === "close") dialog.close();
    if (action === "save" || action === "use") {
      try {
        const captured = paths.map(path => path.length === 1 ? [...path, path[0]].flat() : path.flat());
        const item = normalizeEditorSignature(captured, dialog.querySelector<HTMLInputElement>("[data-signature-name]")!.value, crypto.randomUUID(), tolerance());
        if (action === "save") { if (!library) throw new Error("Browser signature storage is unavailable. Use without saving instead."); library.save(item); }
        onChoose(item); dialog.close();
      } catch (error) { status.textContent = message(error); onError(error); }
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); showLibrary(); dialog.showModal();
}
