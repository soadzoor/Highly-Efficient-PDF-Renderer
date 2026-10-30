import { annotationBounds, transformAnnotationPoints, type AnnotationDestination, type SceneAnnotation } from "./annotationData";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";

/** Viewer camera zoom is expressed in CSS pixels per scene unit. */
export interface LinkCameraView { centerX: number; centerY: number; zoom: number }
export interface LinkNavigationAdapter {
  getCanvas(): HTMLCanvasElement;
  getScene(): VectorScene | null;
  getView(): LinkCameraView | null;
  setView(view: LinkCameraView): void;
  getIdentity(): unknown;
  getSourceUrl?(): string | undefined;
  beforeNavigate?(): void;
}

/** Ordinary web/contact URIs only; PDF scripts, files and executable actions stay inert. */
export function resolvePdfLinkUrl(uri: string, sourceUrl?: string, uriBase?: string): string | null {
  if (!uri) return null;
  try {
    let url: URL;
    try { url = new URL(uri); }
    catch {
      const base = uriBase ? new URL(uriBase, sourceUrl).href : sourceUrl;
      url = new URL(uri, base);
    }
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function resolveAnnotationUrl(annotation: SceneAnnotation, sourceUrl?: string): string | null {
  const action = annotation.action;
  return action?.type === "URI" && action.uri ? resolvePdfLinkUrl(action.uri, sourceUrl, action.uriBase) : null;
}

function localDestination(annotation: SceneAnnotation): AnnotationDestination | undefined {
  return annotation.action ? (annotation.action.type === "GoTo" ? annotation.action.destination : undefined) : annotation.destination;
}

/** Resolve source PDF coordinates only through an explicit page mapping (never a guessed page slot). */
export function resolveAnnotationView(scene: VectorScene, annotation: SceneAnnotation, current: LinkCameraView,
  viewport: { width: number; height: number }): LinkCameraView | null {
  const destination = localDestination(annotation);
  if (destination?.sourcePageIndex === undefined || viewport.width <= 0 || viewport.height <= 0) return null;
  const page = scene.pdfPages?.find(p => p.sourcePageIndex === destination.sourcePageIndex);
  // Older annotation sections can identify a page through another annotation, but cannot place exact PDF coordinates.
  const slot = page?.pageIndex ?? scene.annotations?.find(a => a.sourcePageIndex === destination.sourcePageIndex)?.pageIndex;
  if (slot === undefined || slot < 0 || slot >= scene.pageCount) return null;
  const offset = slot * 4, rect = scene.pageRects;
  const bounds = { minX: rect[offset], minY: rect[offset + 1], maxX: rect[offset + 2], maxY: rect[offset + 3] };
  const width = Math.max(1, viewport.width - 48), height = Math.max(1, viewport.height - 48);
  const fit = (b: Bounds): LinkCameraView => ({ centerX: (b.minX + b.maxX) / 2,
    centerY: (b.minY + b.maxY) / 2, zoom: Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY)) });
  const pageView = fit(bounds);
  if (!Object.values(pageView).every(Number.isFinite) || pageView.zoom <= 0) return null;
  if (!page) return pageView;
  const parameters = destination.parameters ?? [];
  const number = (index: number): number | null => typeof parameters[index] === "number" && Number.isFinite(parameters[index]) ? parameters[index] : null;
  const [a, b, c, d, e, f] = page.pdfToScene;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const retainedX = Math.max(bounds.minX, Math.min(bounds.maxX, current.centerX));
  const retainedY = Math.max(bounds.minY, Math.min(bounds.maxY, current.centerY));
  const pdfX = (d * (retainedX - e) - c * (retainedY - f)) / determinant;
  const pdfY = (-b * (retainedX - e) + a * (retainedY - f)) / determinant;
  const point = (x: number, y: number) => transformAnnotationPoints([x, y], page.pdfToScene);
  let result: LinkCameraView;
  switch (destination.fit ?? "Fit") {
    case "Fit": case "FitB": result = pageView; break;
    case "FitR": {
      const values = [number(0), number(1), number(2), number(3)];
      if (values.some(v => v === null)) return null;
      const [x0, y0, x1, y1] = values as number[];
      if (x1 <= x0 || y1 <= y0) return null;
      result = fit(annotationBounds([x0, y0, x1, y1], page.pdfToScene));
      break;
    }
    case "XYZ": {
      const [x, y] = point(number(0) ?? pdfX, number(1) ?? pdfY);
      // From an overview, bring the destination page into readable view. Keep an existing closer zoom.
      const zoom = number(2);
      result = { centerX: x, centerY: y, zoom: zoom && zoom > 0 ? zoom * 96 / 72 : Math.max(current.zoom, pageView.zoom) };
      break;
    }
    case "FitH": case "FitBH": {
      const [x, y] = point(pdfX, number(0) ?? pdfY);
      result = { ...pageView, zoom: width / (bounds.maxX - bounds.minX) };
      if (c === 0) result.centerY = y; else result.centerX = x;
      break;
    }
    case "FitV": case "FitBV": {
      const [x, y] = point(number(0) ?? pdfX, pdfY);
      result = { ...pageView, zoom: height / (bounds.maxY - bounds.minY) };
      if (b === 0) result.centerX = x; else result.centerY = y;
      break;
    }
    default: return null;
  }
  return Object.values(result).every(Number.isFinite) && result.zoom > 0 ? result : null;
}

export function createViewerLinkNavigation(adapter: LinkNavigationAdapter) {
  const window = adapter.getCanvas().ownerDocument.defaultView!;
  const lifetime = new AbortController();
  let frame = 0, disposed = false;
  function cancel(): void { if (frame) window.cancelAnimationFrame(frame); frame = 0; }
  for (const type of ["pointerdown", "wheel"] as const) {
    window.addEventListener(type, event => { if (type === "pointerdown" || event.target === adapter.getCanvas()) cancel(); },
      { capture: true, passive: true, signal: lifetime.signal });
  }
  window.addEventListener("keydown", event => { if (event.key !== "Enter") cancel(); }, { signal: lifetime.signal });
  window.addEventListener("blur", cancel, { signal: lifetime.signal });
  function sourceUrl(): string | undefined {
    const url = adapter.getSourceUrl?.();
    if (!url) return undefined;
    try { return new URL(url, adapter.getCanvas().ownerDocument.baseURI).href; } catch { return undefined; }
  }
  return {
    getActivationLabel(annotation: SceneAnnotation): string | null {
      if (disposed) return null;
      const url = resolveAnnotationUrl(annotation, sourceUrl());
      if (url) return url.startsWith("mailto:") ? "Compose email" : url.startsWith("tel:") ? "Call number" : "Open link in new tab";
      const scene = adapter.getScene(), view = adapter.getView();
      return scene && view && resolveAnnotationView(scene, annotation, view, adapter.getCanvas().getBoundingClientRect())
        ? "Go to destination" : null;
    },
    activate(annotation: SceneAnnotation): boolean {
      if (disposed) return false;
      const url = resolveAnnotationUrl(annotation, sourceUrl());
      if (url) {
        cancel();
        // Called synchronously from the overlay's trusted pointer/keyboard event.
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      }
      const scene = adapter.getScene(), start = adapter.getView();
      if (!scene || !start || !Object.values(start).every(Number.isFinite) || start.zoom <= 0) return false;
      const viewport = adapter.getCanvas().getBoundingClientRect();
      const target = resolveAnnotationView(scene, annotation, start, viewport);
      if (!target) return false;
      cancel(); adapter.beforeNavigate?.();
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { adapter.setView(target); return true; }
      const identity = adapter.getIdentity(), started = window.performance.now();
      // Measure travel in viewport lengths at the wider endpoint view, independent of DPR
      // and scene units. An existing overview needs less additional pullback.
      const dx = target.centerX - start.centerX, dy = target.centerY - start.centerY;
      const travel = Math.hypot(dx / viewport.width, dy / viewport.height) * Math.min(start.zoom, target.zoom);
      const duration = 450 + Math.min(750, 200 * Math.log2(1 + travel));
      // Negligible for nearby links; distant flights reveal the route, up to a 32x
      // pullback. Interpolate in log zoom so zooming out and back in feels symmetric.
      const pullback = Math.min(Math.log(32), Math.log(Math.hypot(1, travel)));
      const startZoom = Math.log(start.zoom), targetZoom = Math.log(target.zoom);
      function animate(now: number): void {
        frame = 0;
        if (disposed || adapter.getScene() !== scene || adapter.getIdentity() !== identity) return;
        const progress = Math.min(1, Math.max(0, (now - started) / duration));
        if (progress === 1) { adapter.setView(target!); return; }
        // Smooth departure and ease-out arrival; pull back through the middle of travel.
        const eased = progress * progress * (3 - 2 * progress);
        const arc = 4 * eased * (1 - eased);
        adapter.setView({ centerX: start!.centerX + dx * eased,
          centerY: start!.centerY + dy * eased,
          zoom: Math.exp(startZoom + (targetZoom - startZoom) * eased - pullback * arc) });
        frame = window.requestAnimationFrame(animate);
      }
      frame = window.requestAnimationFrame(animate);
      return true;
    },
    cancel,
    dispose(): void { disposed = true; cancel(); lifetime.abort(); }
  };
}
