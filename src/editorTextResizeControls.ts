export interface EditorTextBoxBounds { x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }
type Handle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
interface ResizeOptions {
  getBounds(): EditorTextBoxBounds;
  canResize(): boolean;
  clientToLocal(point: Point): Point | null;
  getContentSize?(fitWidth: boolean, fitHeight: boolean): { width: number; height: number } | null;
  onResizeStart?(): void;
  onResize(bounds: EditorTextBoxBounds): void;
  onMove?(bounds: EditorTextBoxBounds): void;
  onChange(canceled?: boolean): void;
}
interface Drag { id: number; handle: Handle | "move"; target: HTMLElement; start: Point; bounds: EditorTextBoxBounds; cursor: string; previousCursor: string; changed: boolean }

const finitePoint = (point: Point | null): point is Point => point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
const validBounds = (bounds: EditorTextBoxBounds): boolean =>
  [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
const sameBounds = (left: EditorTextBoxBounds, right: EditorTextBoxBounds): boolean =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;

function resizedBounds(bounds: EditorTextBoxBounds, handle: Handle, dx: number, dy: number): EditorTextBoxBounds {
  let left = bounds.x, right = left + bounds.width, bottom = bounds.y, top = bottom + bounds.height;
  if (handle.includes("e")) right = Math.max(left + 1, right + dx);
  if (handle.includes("w")) left = Math.min(right - 1, left + dx);
  if (handle.includes("n")) top = Math.max(bottom + 1, top + dy);
  if (handle.includes("s")) bottom = Math.min(top - 1, bottom + dy);
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

/** Move or resize local textbox bounds without touching rich text, fonts or transforms. */
export function createEditorTextResizeControls(document: Document, overlay: HTMLElement, options: ResizeOptions) {
  const container = document.createElement("div"), lifetime = new AbortController();
  container.className = "hepr-editor-text-resize-controls"; container.hidden = true;
  container.setAttribute("role", "group"); container.setAttribute("aria-label", options.onMove ? "Move or resize textbox" : "Resize textbox");
  const borders = options.onMove ? (["nw", "ne", "se", "sw"] as Handle[]).map(corner => {
    const border = document.createElement("div"); border.className = "hepr-editor-text-move-border";
    border.dataset.textMove = corner; border.title = "Move textbox"; border.setAttribute("aria-hidden", "true");
    border.addEventListener("pointerdown", event => pointerDown(event, "move", border), { signal: lifetime.signal });
    container.append(border); return { corner, border };
  }) : [];
  const labels: Record<Handle, string> = { n: "top edge", ne: "top right corner", e: "right edge", se: "bottom right corner",
    s: "bottom edge", sw: "bottom left corner", w: "left edge", nw: "top left corner" };
  const buttons = (Object.keys(labels) as Handle[]).map(handle => {
    const button = document.createElement("button"); button.type = "button"; button.className = "hepr-editor-text-resize-handle";
    button.dataset.textResize = handle; button.title = `Resize textbox ${labels[handle]} (double-click to fit content)`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("pointerdown", event => pointerDown(event, handle, button), { signal: lifetime.signal });
    button.addEventListener("dblclick", event => fitContent(event, handle), { signal: lifetime.signal });
    button.addEventListener("keydown", event => keydown(event, handle), { signal: lifetime.signal });
    container.append(button); return { handle, button };
  });
  overlay.append(container);
  let drag: Drag | null = null, disposed = false;
  const consume = (event: Event): void => { event.preventDefault(); event.stopPropagation(); };
  function updateDragCursor(): void {
    if (!drag) return;
    drag.cursor = drag.handle === "move" ? "move" : buttons.find(item => item.handle === drag!.handle)!.button.style.cursor || "nwse-resize";
    container.style.cursor = overlay.style.cursor = drag.cursor;
  }
  function release(current: Drag): void {
    container.style.cursor = "";
    if (overlay.style.cursor === current.cursor) overlay.style.cursor = current.previousCursor;
    if (current.target.hasPointerCapture?.(current.id)) current.target.releasePointerCapture(current.id);
  }
  function cancel(): boolean {
    const current = drag; if (!current) return false;
    drag = null; release(current);
    if (!disposed && options.canResize() && current.changed) {
      if (!sameBounds(options.getBounds(), current.bounds)) applyBounds(current, { ...current.bounds });
      options.onChange(true);
    }
    return true;
  }
  function abandon(): void {
    const current = drag; drag = null; if (current) release(current);
  }
  function pointerDown(event: PointerEvent, handle: Handle | "move", target: HTMLElement): void {
    if (event.button !== 0) return;
    consume(event);
    if (disposed || drag || !options.canResize() || event.isPrimary === false) return;
    const start = options.clientToLocal({ x: event.clientX, y: event.clientY }), bounds = options.getBounds();
    if (!finitePoint(start) || !validBounds(bounds)) return;
    drag = { id: event.pointerId, handle, target, start, bounds: { ...bounds }, cursor: "", previousCursor: overlay.style.cursor ?? "", changed: false };
    updateDragCursor();
    try { target.setPointerCapture?.(event.pointerId); } catch { abandon(); return; }
    if (handle !== "move") options.onResizeStart?.();
  }
  function applyBounds(current: Drag, bounds: EditorTextBoxBounds): void {
    if (current.handle === "move") options.onMove?.(bounds); else options.onResize(bounds);
  }
  function updateAt(event: PointerEvent): boolean {
    if (!drag) return false;
    if (!options.canResize()) { abandon(); return false; }
    const point = options.clientToLocal({ x: event.clientX, y: event.clientY });
    if (!finitePoint(point)) { cancel(); return false; }
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    const next = drag.handle === "move" ? { ...drag.bounds, x: drag.bounds.x + dx, y: drag.bounds.y + dy }
      : resizedBounds(drag.bounds, drag.handle, dx, dy);
    if (!validBounds(next)) { cancel(); return false; }
    if (!sameBounds(options.getBounds(), next)) { drag.changed = true; applyBounds(drag, next); }
    return true;
  }
  function pointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.id) return;
    consume(event); updateAt(event);
  }
  function pointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.id) return;
    consume(event);
    if (event.button !== 0) { cancel(); return; }
    if (!updateAt(event) || !drag) return;
    const current = drag; drag = null; release(current);
    if (current.changed) options.onChange();
  }
  function pointerCancel(event: PointerEvent): void {
    if (drag && event.pointerId === drag.id) { consume(event); cancel(); }
  }
  function fitContent(event: MouseEvent, handle: Handle): void {
    if (event.button !== 0) return;
    consume(event);
    if (disposed || drag || !options.canResize()) return;
    const bounds = options.getBounds(); if (!validBounds(bounds)) return;
    const fitWidth = /[ew]/.test(handle), fitHeight = /[ns]/.test(handle);
    const size = options.getContentSize?.(fitWidth, fitHeight); if (!size) return;
    const width = fitWidth ? Math.max(1, size.width) : bounds.width, height = fitHeight ? Math.max(1, size.height) : bounds.height;
    const next = { x: handle.includes("w") ? bounds.x + bounds.width - width : bounds.x,
      y: handle.includes("s") ? bounds.y + bounds.height - height : bounds.y, width, height };
    if (validBounds(next) && !sameBounds(bounds, next)) { options.onResize(next); options.onChange(); }
  }
  function keydown(event: KeyboardEvent, handle?: Handle): void {
    if (event.key === "Escape" && drag) { consume(event); cancel(); return; }
    if (!handle || drag || disposed || !options.canResize() || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const amount = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0;
    const dy = event.key === "ArrowUp" ? amount : event.key === "ArrowDown" ? -amount : 0;
    if (!(dx && /[ew]/.test(handle) || dy && /[ns]/.test(handle))) return;
    consume(event);
    const bounds = options.getBounds(); if (!validBounds(bounds)) return;
    const next = resizedBounds(bounds, handle, dx, dy);
    if (validBounds(next) && !sameBounds(bounds, next)) { options.onResize(next); options.onChange(); }
  }
  container.addEventListener("pointermove", pointerMove, { signal: lifetime.signal });
  container.addEventListener("pointerup", pointerUp, { signal: lifetime.signal });
  container.addEventListener("pointercancel", pointerCancel, { signal: lifetime.signal });
  container.addEventListener("lostpointercapture", pointerCancel, { signal: lifetime.signal });
  container.addEventListener("keydown", event => keydown(event), { signal: lifetime.signal });
  return {
    update(project: (x: number, y: number) => Point | null, offset: Point, visible: boolean): void {
      if (disposed) return;
      const bounds = options.getBounds();
      if (!visible || !options.canResize() || !validBounds(bounds)) { container.hidden = true; abandon(); return; }
      const middle = project(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      const projected = buttons.map(({ handle, button }) => ({ handle, button, point: project(bounds.x + bounds.width * (handle.includes("w") ? 0 : handle.includes("e") ? 1 : .5),
        bounds.y + bounds.height * (handle.includes("s") ? 0 : handle.includes("n") ? 1 : .5)) }));
      if (!finitePoint(middle) || !projected.every(item => finitePoint(item.point)) || !finitePoint(offset)) { container.hidden = true; abandon(); return; }
      const east = projected.find(item => item.handle === "e")!.point!, north = projected.find(item => item.handle === "n")!.point!;
      const horizontalLength = Math.hypot(east.x - middle.x, east.y - middle.y), verticalLength = Math.hypot(north.x - middle.x, north.y - middle.y);
      if (!(horizontalLength > 0 && verticalLength > 0)) { container.hidden = true; abandon(); return; }
      container.hidden = false;
      const corners = borders.map(({ corner }) => projected.find(item => item.handle === corner)!.point!);
      for (const [index, { border }] of borders.entries()) {
        const start = corners[index], end = corners[(index + 1) % corners.length];
        Object.assign(border.style, { left: `${start.x - offset.x}px`, top: `${start.y - offset.y}px`,
          width: `${Math.hypot(end.x - start.x, end.y - start.y)}px`,
          transform: `translateY(-50%) rotate(${Math.atan2(end.y - start.y, end.x - start.x)}rad)` });
      }
      for (const { handle, button, point } of projected) {
        const position = point!;
        button.style.left = `${position.x - offset.x}px`; button.style.top = `${position.y - offset.y}px`;
        const horizontal = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0, vertical = handle.includes("n") ? 1 : handle.includes("s") ? -1 : 0;
        const dx = horizontal * (east.x - middle.x) / horizontalLength + vertical * (north.x - middle.x) / verticalLength;
        const dy = horizontal * (east.y - middle.y) / horizontalLength + vertical * (north.y - middle.y) / verticalLength;
        const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 4) + 4) % 4;
        button.style.cursor = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][sector];
      }
      updateDragCursor();
    },
    cancel,
    dispose(): void { if (disposed) return; disposed = true; abandon(); lifetime.abort(); container.remove(); }
  };
}
