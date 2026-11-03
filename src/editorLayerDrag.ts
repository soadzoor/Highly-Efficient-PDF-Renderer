export type EditorLayerDropPosition = "before" | "after";
export interface EditorLayerDragRow { id: string; element: HTMLElement }
export interface EditorLayerDrag {
  begin(event: PointerEvent, sourceId: string): boolean;
  cancel(): void;
  dispose(): void;
}

/** Grip-only pointer gestures; ordinary touch scrolling elsewhere stays native. */
export function createEditorLayerDrag(options: {
  container: HTMLElement;
  getRows(): readonly EditorLayerDragRow[];
  canDrop(sourceId: string, targetId: string, position: EditorLayerDropPosition): boolean;
  start?(sourceId: string): void;
  preview(targetId: string | null, position?: EditorLayerDropPosition): void;
  drop(sourceId: string, targetId: string, position: EditorLayerDropPosition): void;
  end?(): void;
}): EditorLayerDrag {
  const { container } = options, document = container.ownerDocument, window = document.defaultView;
  const events: EventTarget = window ?? document;
  type Target = { id: string; position: EditorLayerDropPosition };
  interface Gesture {
    id: number; source: string; startX: number; startY: number; x: number; y: number;
    started: boolean; target: Target | null; listeners: AbortController; lastTick?: number;
  }
  let gesture: Gesture | null = null, frame: number | null = null, disposed = false;

  function viewport(): { left: number; top: number; right: number; bottom: number; height: number } {
    const box = container.getBoundingClientRect(), left = box.left + (container.clientLeft || 0), top = box.top + (container.clientTop || 0);
    const width = container.clientWidth || box.width, height = container.clientHeight || box.height;
    const visual = window?.visualViewport, viewportLeft = visual?.offsetLeft ?? 0, viewportTop = visual?.offsetTop ?? 0;
    const viewportWidth = visual?.width ?? window?.innerWidth ?? Infinity, viewportHeight = visual?.height ?? window?.innerHeight ?? Infinity;
    const clippedTop = Math.max(top, viewportTop), bottom = Math.min(top + height, viewportTop + viewportHeight);
    return { left: Math.max(left, viewportLeft), top: clippedTop, right: Math.min(left + width, viewportLeft + viewportWidth), bottom, height: bottom - clippedTop };
  }
  function inside(current: Gesture): boolean {
    const box = viewport();
    if (box.height <= 0 || box.right <= box.left || current.x < box.left || current.x > box.right || current.y < box.top || current.y > box.bottom) return false;
    // Pointer capture changes event.target. A normal hit test still catches
    // ancestor clipping or another UI panel covering this part of the list.
    if (document.elementFromPoint && container.contains) {
      const hit = document.elementFromPoint(current.x, current.y); if (!hit || !container.contains(hit)) return false;
    }
    return true;
  }
  function targetAt(current: Gesture): Target | null {
    if (!inside(current)) return null;
    const bounds = viewport();
    let closest: EditorLayerDragRow | undefined, distance = Infinity;
    for (const row of options.getRows()) {
      const box = row.element.getBoundingClientRect();
      if (box.height <= 0 || box.bottom <= bounds.top || box.top >= bounds.bottom || row.element.isConnected === false) continue;
      const gap = Math.max(box.top - current.y, current.y - box.bottom, 0);
      if (gap < distance) { closest = row; distance = gap; }
    }
    if (!closest) return null;
    const box = closest.element.getBoundingClientRect(), position = current.y < box.top + box.height / 2 ? "before" : "after";
    return options.canDrop(current.source, closest.id, position) ? { id: closest.id, position } : null;
  }
  function updateTarget(current: Gesture): void {
    if (!current.started || gesture !== current) return;
    const target = targetAt(current);
    if (target?.id === current.target?.id && target?.position === current.target?.position) return;
    current.target = target; options.preview(target?.id ?? null, target?.position);
  }
  function scrollSpeed(current: Gesture): number {
    if (!current.started || !inside(current)) return 0;
    const box = viewport(), edge = Math.min(32, box.height / 3), maximum = Math.max(0, container.scrollHeight - container.clientHeight);
    if (current.y < box.top + edge && container.scrollTop > 0) return -800 * (box.top + edge - current.y) / edge;
    if (current.y > box.bottom - edge && container.scrollTop < maximum) return 800 * (current.y - (box.bottom - edge)) / edge;
    return 0;
  }
  function scheduleScroll(): void {
    if (frame !== null || !gesture || !scrollSpeed(gesture) || !window?.requestAnimationFrame) return;
    frame = window.requestAnimationFrame(tick);
  }
  function tick(time: number): void {
    frame = null; const current = gesture; if (!current) return;
    const speed = scrollSpeed(current), elapsed = current.lastTick === undefined ? 16 : Math.max(0, Math.min(50, time - current.lastTick));
    current.lastTick = time;
    if (speed) {
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.max(0, Math.min(maximum, container.scrollTop + speed * elapsed / 1000));
      updateTarget(current); scheduleScroll();
    } else current.lastTick = undefined;
  }
  function finish(commit: boolean): void {
    const current = gesture; if (!current) return;
    // Clear before releasing capture: lostpointercapture must not cancel a
    // successful drop or interfere with a replacement gesture.
    gesture = null; current.listeners.abort();
    if (frame !== null) { window?.cancelAnimationFrame?.(frame); frame = null; }
    if (container.hasPointerCapture?.(current.id)) { try { container.releasePointerCapture(current.id); } catch { /* Capture can already be gone. */ } }
    options.preview(null); options.end?.();
    if (commit && current.started && current.target) options.drop(current.source, current.target.id, current.target.position);
  }
  function update(event: PointerEvent): Gesture | null {
    const current = gesture; if (!current || event.pointerId !== current.id) return null;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.started && Math.hypot(current.x - current.startX, current.y - current.startY) >= 4) {
      current.started = true; options.start?.(current.source);
    }
    if (gesture !== current) return null;
    updateTarget(current); return current;
  }
  function move(event: PointerEvent): void {
    if (!update(event)) return;
    event.preventDefault(); event.stopPropagation(); scheduleScroll();
  }
  function up(event: PointerEvent): void {
    if (!update(event)) return;
    event.preventDefault(); event.stopPropagation(); finish(true);
  }
  function cancelled(event: PointerEvent): void { if (event.pointerId === gesture?.id) finish(false); }
  function anotherPointer(event: PointerEvent): void {
    if (!gesture || event.pointerId === gesture.id) return;
    // Pen and touch can each be primary simultaneously. Consume the second
    // down so cancellation cannot immediately start its own grip gesture.
    event.preventDefault(); event.stopPropagation(); finish(false);
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); finish(false);
  }
  function scrolled(): void { if (gesture) { updateTarget(gesture); scheduleScroll(); } }
  return {
    begin(event, sourceId) {
      if (gesture) { if (gesture.id !== event.pointerId) finish(false); return false; }
      if (disposed || event.defaultPrevented || event.button !== 0 || event.isPrimary === false || !options.getRows().some(row => row.id === sourceId)) return false;
      const listeners = new AbortController(), signal = listeners.signal;
      gesture = { id: event.pointerId, source: sourceId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        started: false, target: null, listeners };
      events.addEventListener("pointermove", move as EventListener, { capture: true, passive: false, signal });
      events.addEventListener("pointerup", up as EventListener, { capture: true, passive: false, signal });
      events.addEventListener("pointercancel", cancelled as EventListener, { capture: true, signal });
      events.addEventListener("pointerdown", anotherPointer as EventListener, { capture: true, passive: false, signal });
      events.addEventListener("keydown", keydown as EventListener, { capture: true, signal });
      events.addEventListener("scroll", scrolled, { capture: true, signal });
      events.addEventListener("blur", () => finish(false), { signal });
      events.addEventListener("resize", () => finish(false), { signal });
      container.addEventListener("lostpointercapture", cancelled as EventListener, { signal });
      try { container.setPointerCapture?.(event.pointerId); } catch { /* Window listeners retain a safe cancellation path. */ }
      event.preventDefault(); event.stopPropagation(); return true;
    },
    cancel: () => finish(false),
    dispose() { if (disposed) return; disposed = true; finish(false); }
  };
}
