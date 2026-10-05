import type { SceneAnnotation } from "./annotationData";
import type { VectorScene } from "./pdfVectorExtractor";
import type { AnnotationHit } from "./sceneAnnotationInteraction";
import type { PrimitivePoint } from "./scenePrimitives";

export interface AnnotationInteractionAdapter {
  getCanvas(): HTMLCanvasElement;
  getScene(): VectorScene | null;
  getTarget(): unknown;
  getViewKey(): string;
  pick(point: PrimitivePoint, signal: AbortSignal): Promise<AnnotationHit | null>;
  setSelection(ids: readonly string[] | null): void;
  setHover(id: string | null): void;
  /** Native drawing selection shares its highlight slot; pause annotation uploads while it owns that slot. */
  setActive?(active: boolean): void;
  refresh?(forceReplay?: boolean): void;
  dispose?(): void;
}
export interface AnnotationInteractionOptions {
  adapter: AnnotationInteractionAdapter;
  isInteractionSuppressed?(): boolean;
  onSelectionChange?(annotation: SceneAnnotation | null, source: "list" | "canvas" | "clear", point?: PrimitivePoint): void;
  onHoverChange?(annotation: SceneAnnotation | null, point?: PrimitivePoint): void;
  onError?(error: unknown): void;
}
interface Request { point: PrimitivePoint; select: boolean }

/** Shared annotation list/canvas gestures, stale-query cancellation and renderer replay. */
export function createAnnotationInteractionController(options: AnnotationInteractionOptions) {
  const { adapter } = options;
  let canvas: HTMLCanvasElement | null = null, scene: VectorScene | null = null, target: unknown;
  let annotations = new Map<string, SceneAnnotation>();
  let selected: string | null = null, hovered: string | null = null;
  let pointer: PrimitivePoint | null = null;
  let pending: Request | null = null, active: AbortController | null = null;
  let activeRequest: Request | null = null;
  let frame: number | null = null, revision = 0, key = "";
  let interactionEnabled = true, suspended = false, disposed = false;
  const downs = new Map<number, { x: number; y: number; moved: boolean; time: number }>();
  const suppressed = (): boolean => !interactionEnabled || options.isInteractionSuppressed?.() === true;
  const viewKey = (): string => {
    const c = adapter.getCanvas(), r = c.getBoundingClientRect();
    return `${adapter.getViewKey()}:${c.width}:${c.height}:${r.left}:${r.top}:${r.width}:${r.height}`;
  };
  function cancel(): void {
    revision++; active?.abort(); pending = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function hover(id: string | null, point?: PrimitivePoint): void {
    if (id !== null && point) canvas?.setAttribute("data-hepr-annotation-hover", "");
    else canvas?.removeAttribute("data-hepr-annotation-hover");
    if (id === hovered) {
      if (point) options.onHoverChange?.(id === null ? null : annotations.get(id) ?? null, point);
      return;
    }
    adapter.setHover(id); hovered = id;
    options.onHoverChange?.(id === null ? null : annotations.get(id) ?? null, point);
  }
  function selection(id: string | null, source: "list" | "canvas" | "clear", point?: PrimitivePoint): void {
    if (id !== null && !annotations.has(id)) throw new RangeError(`Unknown annotation: ${id}`);
    if (id !== selected) adapter.setSelection(id === null ? null : [id]);
    selected = id;
    options.onSelectionChange?.(id === null ? null : annotations.get(id)!, source, point);
  }
  function schedule(request: Request): void {
    if (disposed || suppressed() || !scene || !annotations.size) return;
    // A click must finish before a newer hover can replace it.
    if (!request.select && pending?.select) return;
    if (!request.select && active && !active.signal.aborted && activeSelection) { pending = request; return; }
    revision++; active?.abort(); pending = request;
    if (frame === null && !active) frame = requestAnimationFrame(() => { frame = null; void query(); });
  }
  let activeSelection = false;
  async function query(): Promise<void> {
    if (disposed || suppressed() || active || !pending) return;
    const request = pending; pending = null;
    const token = revision, source = adapter.getScene(), owner = adapter.getTarget(), view = viewKey();
    const abort = new AbortController(); active = abort; activeRequest = request; activeSelection = request.select;
    try {
      const hit = await adapter.pick(request.point, abort.signal);
      if (disposed || abort.signal.aborted || token !== revision || suppressed() ||
          source !== adapter.getScene() || owner !== adapter.getTarget()) return;
      if (view !== viewKey()) { schedule(request); return; }
      const id = hit?.annotationId ?? null;
      if (id !== null && !annotations.has(id)) return;
      hover(pointer?.x === request.point.x && pointer?.y === request.point.y ? id : null, request.point);
      if (request.select) selection(id, "canvas", request.point);
    } catch (error) {
      if (!abort.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) options.onError?.(error);
    } finally {
      if (active === abort) { active = null; activeRequest = null; activeSelection = false; }
      if (!disposed && !suppressed() && pending && frame === null) frame = requestAnimationFrame(() => { frame = null; void query(); });
    }
  }
  function down(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    cancel();
    downs.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false, time: performance.now() });
    if (downs.size > 1) for (const d of downs.values()) d.moved = true;
    hover(null);
  }
  function move(event: PointerEvent): void {
    const point = { x: event.clientX, y: event.clientY }, d = downs.get(event.pointerId);
    if (d && Math.hypot(point.x - d.x, point.y - d.y) > 4) d.moved = true;
    pointer = event.pointerType === "touch" ? null : point;
    if (!downs.size && event.buttons === 0 && pointer) schedule({ point, select: false });
  }
  function up(event: PointerEvent): void {
    const d = downs.get(event.pointerId); downs.delete(event.pointerId);
    pointer = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
    if (d && !d.moved && !downs.size && performance.now() - d.time <= 450 &&
        Math.hypot(event.clientX - d.x, event.clientY - d.y) <= 4) {
      schedule({ point: { x: event.clientX, y: event.clientY }, select: true });
    }
  }
  function leave(): void {
    pointer = null;
    if (!pending?.select && !activeSelection) cancel();
    else if (pending && !pending.select) pending = null;
    hover(null);
  }
  function cancelled(): void { downs.clear(); cancel(); leave(); }
  function lostCapture(event: PointerEvent): void { if (downs.has(event.pointerId)) cancelled(); }
  function escape(event: KeyboardEvent): void {
    if (event.key === "Escape" && (event.target === canvas || event.target === canvas?.ownerDocument.body)) {
      cancel(); hover(null); selection(null, "clear");
    }
  }
  function detach(): void {
    if (!canvas) return;
    canvas.removeAttribute("data-hepr-annotation-hover");
    canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("pointercancel", cancelled); canvas.removeEventListener("lostpointercapture", lostCapture);
    canvas.ownerDocument.removeEventListener("keydown", escape);
    canvas = null; downs.clear();
  }
  function attach(): void {
    const next = adapter.getCanvas();
    if (next === canvas) return;
    detach(); canvas = next;
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointercancel", cancelled); canvas.addEventListener("lostpointercapture", lostCapture);
    canvas.ownerDocument.addEventListener("keydown", escape);
  }
  function sceneChanged(): void {
    if (disposed) return;
    const next = adapter.getScene(), owner = adapter.getTarget();
    const changedCanvas = adapter.getCanvas() !== canvas;
    attach();
    if (next !== scene) {
      cancel(); pointer = null; hovered = selected = null;
      canvas?.removeAttribute("data-hepr-annotation-hover");
      scene = next; annotations = new Map(next?.annotations?.filter(a => a.subtype !== "Popup" && (a.flags & (1 | 2 | 32)) === 0).map(a => [a.id, a]));
      target = owner;
      adapter.setSelection(null); adapter.setHover(null);
      options.onSelectionChange?.(null, "clear"); options.onHoverChange?.(null);
    } else if (owner !== target || changedCanvas) {
      cancel(); pointer = null; target = owner; hovered = null;
      canvas?.removeAttribute("data-hepr-annotation-hover");
      adapter.setSelection(selected === null ? null : [selected]); adapter.setHover(null);
    }
    key = viewKey();
  }
  function refresh(): void {
    sceneChanged();
    if (disposed) return;
    adapter.refresh?.(true);
    adapter.setSelection(selected === null ? null : [selected]); adapter.setHover(hovered);
  }
  sceneChanged();
  return {
    sceneChanged,
    refresh,
    select(id: string | null): void { sceneChanged(); cancel(); selection(id, id === null ? "clear" : "list"); },
    hover(id: string | null): void { sceneChanged(); cancel(); if (id !== null && !annotations.has(id)) throw new RangeError(`Unknown annotation: ${id}`); hover(id); },
    getSelection: () => selected,
    setInteractionEnabled(enabled: boolean): void {
      if (disposed || interactionEnabled === enabled) return;
      downs.clear();
      interactionEnabled = enabled; cancel(); pointer = null; hover(null);
      adapter.setActive?.(enabled);
      if (enabled) refresh();
    },
    onFrame(): void {
      if (disposed) return;
      if (scene !== adapter.getScene() || target !== adapter.getTarget() || canvas !== adapter.getCanvas()) sceneChanged();
      if (!scene || !annotations.size) return;
      const next = viewKey(), blocked = suppressed();
      if (blocked) { if (!suspended) { cancel(); hover(null); } suspended = true; key = next; return; }
      if (next !== key || suspended) {
        key = next; suspended = false;
        const click = pending?.select ? pending : activeRequest?.select && !active?.signal.aborted ? activeRequest : null;
        cancel(); hover(null); adapter.refresh?.();
        if (click) schedule(click);
        else if (pointer && !downs.size) schedule({ point: pointer, select: false });
      }
    },
    dispose(): void {
      if (disposed) return;
      cancel(); detach(); adapter.setHover(null); adapter.setSelection(null); adapter.dispose?.(); disposed = true;
    }
  };
}
export type AnnotationInteractionController = ReturnType<typeof createAnnotationInteractionController>;
