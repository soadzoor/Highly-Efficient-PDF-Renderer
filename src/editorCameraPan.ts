export interface EditorCameraPan {
  setActive(active: boolean): void;
  cancel(): void;
  isPanning(): boolean;
  dispose(): void;
}

/** Middle-button navigation is independent of object tools and never changes the document. */
export function createEditorCameraPan(options: {
  overlay: HTMLElement;
  getCanvas(): HTMLCanvasElement;
  canPan(): boolean;
  begin(): void;
  pan(deltaX: number, deltaY: number): void;
  end(): void;
  onStateChange?(panning: boolean): void;
}): EditorCameraPan {
  const { overlay } = options, document = overlay.ownerDocument, window = document.defaultView!;
  let active = false, disposed = false, bindings: AbortController | null = null;
  let gesture: { id: number; x: number; y: number; canvas: HTMLCanvasElement; events: AbortController } | null = null;
  const owns = (target: EventTarget | null): boolean => target === options.getCanvas() || target instanceof Node && overlay.contains(target);
  function finish(): void {
    const current = gesture; if (!current) return;
    gesture = null; current.events.abort(); delete overlay.dataset.cameraPan;
    if (overlay.hasPointerCapture?.(current.id)) { try { overlay.releasePointerCapture(current.id); } catch { /* Capture may already be gone. */ } }
    options.end(); options.onStateChange?.(false);
  }
  function move(event: PointerEvent): void {
    const current = gesture; if (!current || event.pointerId !== current.id) return;
    if (!active || !options.canPan() || current.canvas !== options.getCanvas() || (event.buttons & 4) === 0) { finish(); return; }
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    current.x = event.clientX; current.y = event.clientY;
    if (dx || dy) options.pan(dx, dy);
  }
  function up(event: PointerEvent): void {
    const current = gesture; if (!current || event.pointerId !== current.id) return;
    event.preventDefault(); event.stopPropagation();
    if (active && options.canPan() && current.canvas === options.getCanvas()) {
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (dx || dy) options.pan(dx, dy);
    }
    finish();
  }
  function cancelled(event: PointerEvent): void { if (event.pointerId === gesture?.id) finish(); }
  function pointerDown(event: PointerEvent): void {
    if (gesture) {
      if (event.pointerId !== gesture.id) { event.preventDefault(); event.stopPropagation(); finish(); }
      return;
    }
    if (event.defaultPrevented || event.button !== 1 || event.isPrimary === false || !owns(event.target) || !options.canPan()) return;
    event.preventDefault(); event.stopPropagation();
    options.begin();
    const events = new AbortController(), signal = events.signal;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, canvas: options.getCanvas(), events };
    overlay.dataset.cameraPan = "true";
    options.onStateChange?.(true);
    try { overlay.setPointerCapture?.(event.pointerId); } catch { /* Window listeners still finish safely. */ }
    window.addEventListener("pointermove", move, { capture: true, passive: false, signal });
    window.addEventListener("pointerup", up, { capture: true, passive: false, signal });
    window.addEventListener("pointercancel", cancelled, { capture: true, signal });
    overlay.addEventListener("lostpointercapture", cancelled, { signal });
    window.addEventListener("blur", finish, { signal }); window.addEventListener("resize", finish, { signal });
    window.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
    }, { capture: true, signal });
    window.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); }, { capture: true, signal });
  }
  return {
    setActive(value) {
      if (disposed || active === value) return;
      active = value; bindings?.abort(); bindings = null; finish();
      if (!value) return;
      const signal = (bindings = new AbortController()).signal;
      window.addEventListener("pointerdown", pointerDown, { capture: true, passive: false, signal });
      window.addEventListener("auxclick", event => { if (event.button === 1 && owns(event.target)) event.preventDefault(); }, { capture: true, signal });
    },
    cancel: finish,
    isPanning: () => gesture !== null,
    dispose() { if (disposed) return; disposed = true; active = false; bindings?.abort(); bindings = null; finish(); }
  };
}
