import "./readerViewport.css";
import { WebGlFloorplanRenderer } from "./webGlFloorplanRenderer";
import type { RendererApi } from "./rendererTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { RetainedPageReplay } from "./retainedPageReplay";
import { createDefaultOptionalContentSnapshot } from "./optionalContent";
import type { ThumbnailPixels } from "./thumbnailTypes";
import {
  READER_ACTUAL_SIZE_ZOOM, READER_MARGIN, readerCaptureAnchor, readerContentMetrics,
  readerFitZoom, readerPageAtPoint, readerRestoreAnchor, readerScrollFromView,
  readerViewFromScroll, readerZoomAt, type ReaderCameraView, type ReaderMetrics, type ReaderView
} from "./readerGeometry";

export type { ReaderView } from "./readerGeometry";
export interface ReaderViewportSnapshot {
  view: ReaderCameraView;
  fit: "width" | "page" | null;
  sidebarOpen: boolean;
  pageIndex?: number;
}
export interface ReaderViewportOptions {
  getCanvas(): HTMLCanvasElement;
  layouts: readonly { value: string; label: string }[];
  onLayoutChange(layout: string): void | Promise<void>;
  onViewChange(view: ReaderView): void;
  getPagePreviewScene?(pageIndex: number, options: { maximumDimension: number; signal?: AbortSignal }): Promise<VectorScene>;
  getPageThumbnail?(pageIndex: number, options: { maxDimension: number; signal?: AbortSignal }): Promise<ThumbnailPixels>;
  releaseThumbnails?(): void;
  configureThumbnailRenderer?(renderer: RendererApi, scene: VectorScene): void;
  onFind(): void;
  onSettings(): void;
}

// Bound only the DOM representation to retain browser layout/scroll precision.
// Document dimensions and camera zoom remain independent of this coordinate window.
const READER_SCROLL_SURFACE_SIZE = 1_000_000;

/** Shared DOM navigation; the host remains responsible for rendering its GPU canvas. */
export function createReaderViewport(options: ReaderViewportOptions) {
  const document = options.getCanvas().ownerDocument, window = document.defaultView!;
  const lifetime = new AbortController();
  const shell = document.createElement("div");
  shell.className = "reader-shell";
  shell.innerHTML = `<div id="reader-toolbar" class="reader-toolbar" role="toolbar" aria-label="Document controls">
    <div class="reader-primary-controls"></div>
    <label class="reader-layout-label">Layout <select class="reader-layout" aria-label="Page layout"></select></label>
    <div class="reader-reading-controls">
      <button type="button" data-reader="thumbnails" aria-label="Toggle page thumbnails" aria-expanded="false">▤</button>
      <button type="button" data-reader="previous" aria-label="Previous page">‹</button>
      <input class="reader-page-number" type="number" min="1" value="1" aria-label="Page number" />
      <span class="reader-page-count">/ 0</span>
      <button type="button" data-reader="next" aria-label="Next page">›</button>
      <button type="button" data-reader="zoom-out" aria-label="Zoom out">−</button>
      <input class="reader-zoom" type="text" inputmode="decimal" value="100%" aria-label="Zoom percentage" />
      <button type="button" data-reader="zoom-in" aria-label="Zoom in">+</button>
      <button type="button" data-reader="fit-width">Fit Width</button>
      <button type="button" data-reader="fit-page">Fit Page</button>
    </div>
    <button type="button" data-reader="find">Find</button>
    <button type="button" data-reader="settings">Settings</button>
    <button type="button" data-reader="hide-toolbar" aria-controls="reader-toolbar" aria-expanded="true">Hide toolbar</button>
    <span class="reader-announcement" role="status" aria-live="polite"></span>
  </div><button type="button" class="reader-toolbar-restore" data-reader="show-toolbar" aria-controls="reader-toolbar" aria-expanded="false" hidden>Show toolbar</button><div class="reader-workspace">
    <aside class="reader-thumbnails" aria-label="Page thumbnails" hidden></aside>
    <div class="reader-scroll" tabindex="0" role="region" aria-label="Document pages">
      <div class="reader-surface"></div>
    </div>
  </div>`;
  const query = <T extends HTMLElement>(selector: string): T => shell.querySelector<T>(selector)!;
  const toolbar = query<HTMLDivElement>(".reader-toolbar");
  const hideToolbar = query<HTMLButtonElement>('[data-reader="hide-toolbar"]');
  const showToolbar = query<HTMLButtonElement>('[data-reader="show-toolbar"]');
  const scroller = query<HTMLDivElement>(".reader-scroll"), surface = query<HTMLDivElement>(".reader-surface");
  const sidebar = query<HTMLElement>(".reader-thumbnails");
  const layoutSelect = query<HTMLSelectElement>(".reader-layout");
  const pageInput = query<HTMLInputElement>(".reader-page-number"), zoomInput = query<HTMLInputElement>(".reader-zoom");
  const pageCount = query<HTMLSpanElement>(".reader-page-count");
  const thumbToggle = query<HTMLButtonElement>('[data-reader="thumbnails"]');
  const previousButton = query<HTMLButtonElement>('[data-reader="previous"]');
  const nextButton = query<HTMLButtonElement>('[data-reader="next"]');
  const fitWidthButton = query<HTMLButtonElement>('[data-reader="fit-width"]');
  const fitPageButton = query<HTMLButtonElement>('[data-reader="fit-page"]');
  const announcement = query<HTMLSpanElement>(".reader-announcement");
  for (const layout of options.layouts) {
    const option = document.createElement("option"); option.value = layout.value; option.textContent = layout.label;
    layoutSelect.append(option);
  }
  // Move controls rather than duplicate IDs or attach a second set of handlers.
  const primary = query<HTMLDivElement>(".reader-primary-controls");
  for (const selector of [".package-version", "#open-file", "#example-dropdown"]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) primary.append(element);
  }
  document.body.append(shell);
  document.body.classList.add("has-reader-toolbar");
  let attachedCanvas: HTMLCanvasElement | null = null;
  let canvasLifetime: AbortController | null = null;
  let identity: unknown, rects: Float32Array = new Float32Array(0), active = false, disposed = false;
  let zoom = READER_ACTUAL_SIZE_ZOOM, fit: "width" | "page" | null = "width", currentPage = 0;
  let sidebarOpen = window.innerWidth >= 800, initialView = true;
  let savedView: ReaderCameraView | null = null;
  let navigationTarget: { page: number; top: number } | null = null;
  let metrics: ReaderMetrics = readerContentMetrics(rects, zoom, 1, 1);
  let logicalScroll = { left: 0, top: 0 }, domScroll = { left: 0, top: 0 };
  let resizeFrame = 0, inertiaFrame = 0;
  let thumbnailRevision = 0, thumbnailRunning = false;
  const thumbnailWanted = new Set<number>(), thumbnailCanvases = new Map<number, HTMLCanvasElement>();
  const thumbnailFailed = new Set<number>(), thumbnailJobs = new Map<number, AbortController>();
  const rows: HTMLButtonElement[] = [], rowTops: number[] = [];
  let scratchCanvas: HTMLCanvasElement | null = null, scratchRenderer: WebGlFloorplanRenderer | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number; x: number; y: number } | null = null;
  let pinched = false;
  let lastTouchTime = 0, velocityX = 0, velocityY = 0;

  const isActive = (): boolean => active;
  function getView(): ReaderView {
    return active ? readerViewFromScroll(metrics, logicalScroll.left, logicalScroll.top)
      : { ...(savedView ?? readerViewFromScroll(metrics, 0, 0)), width: scroller.clientWidth, height: scroller.clientHeight };
  }
  function updateToolbar(): void {
    const count = rects.length / 4;
    const pageText = String(currentPage + 1), countText = String(count);
    const zoomText = `${Math.round(zoom / READER_ACTUAL_SIZE_ZOOM * 100)}%`;
    // Scroll changes the camera far more often than these controls. Replacing
    // identical text/attributes still invalidates browser style and layout.
    if (document.activeElement !== pageInput && pageInput.value !== pageText) pageInput.value = pageText;
    if (pageInput.max !== countText) pageInput.max = countText;
    if (pageCount.textContent !== `/ ${count}`) pageCount.textContent = `/ ${count}`;
    if (document.activeElement !== zoomInput && zoomInput.value !== zoomText) zoomInput.value = zoomText;
    if (previousButton.disabled !== (currentPage <= 0)) previousButton.disabled = currentPage <= 0;
    if (nextButton.disabled !== (currentPage >= count - 1)) nextButton.disabled = currentPage >= count - 1;
    if (toolbar.classList.contains("reader-has-document") !== (count > 0)) toolbar.classList.toggle("reader-has-document", count > 0);
    for (const [button, attribute, value] of [
      [thumbToggle, "aria-expanded", String(active && sidebarOpen)],
      [fitWidthButton, "aria-pressed", String(fit === "width")],
      [fitPageButton, "aria-pressed", String(fit === "page")]
    ] as const) {
      if (button.getAttribute(attribute) !== value) button.setAttribute(attribute, value);
    }
  }
  function present(): void {
    if (!active || !rects.length || disposed) return;
    const view = getView(); savedView = view;
    const maxScroll = metrics.surfaceHeight - metrics.height;
    // Explicit navigation can reach a short final page without aligning its top.
    // Retain that selection until the user actually moves the vertical scrollbar.
    const page = navigationTarget && Math.abs(logicalScroll.top - navigationTarget.top) < .5
      ? navigationTarget.page
      : maxScroll > 0 && logicalScroll.top >= maxScroll - .5 ? rects.length / 4 - 1
        : readerPageAtPoint(rects, (rects[0] + rects[2]) / 2,
          view.centerY + (view.height / 2 - READER_MARGIN) / view.zoom);
    if (navigationTarget && Math.abs(logicalScroll.top - navigationTarget.top) >= .5) navigationTarget = null;
    if (page !== currentPage) {
      rows[currentPage]?.removeAttribute("aria-current"); currentPage = page;
      rows[currentPage]?.setAttribute("aria-current", "page");
      if (sidebarOpen) {
        const row = rows[page];
        if (row && (row.offsetTop < sidebar.scrollTop || row.offsetTop + row.offsetHeight > sidebar.scrollTop + sidebar.clientHeight)) {
          sidebar.scrollTop = Math.max(0, row.offsetTop - (sidebar.clientHeight - row.offsetHeight) / 2);
        }
      }
    }
    updateToolbar(); options.onViewChange(view);
  }
  function sizeSurface(): void {
    let width = Math.max(1, scroller.clientWidth), height = Math.max(1, scroller.clientHeight);
    // A scrollbar can change the other dimension. Settle both before deriving the camera.
    for (let pass = 0; pass < 3; pass++) {
      if (fit && rects.length) zoom = readerFitZoom(rects, currentPage, width, height, fit);
      metrics = readerContentMetrics(rects, zoom, width, height);
      surface.style.width = active ? `${Math.max(width, Math.min(metrics.surfaceWidth, READER_SCROLL_SURFACE_SIZE))}px` : "100%";
      surface.style.height = active ? `${Math.max(height, Math.min(metrics.surfaceHeight, READER_SCROLL_SURFACE_SIZE))}px` : "100%";
      const nextWidth = Math.max(1, scroller.clientWidth), nextHeight = Math.max(1, scroller.clientHeight);
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth; height = nextHeight;
    }
    const canvas = options.getCanvas();
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    domScroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }
  function positionScroll(left: number, top: number): void {
    const maxLeft = Math.max(0, metrics.surfaceWidth - metrics.width), maxTop = Math.max(0, metrics.surfaceHeight - metrics.height);
    logicalScroll = { left: Math.max(0, Math.min(maxLeft, left)), top: Math.max(0, Math.min(maxTop, top)) };
    scroller.scrollLeft = maxLeft > 0 ? logicalScroll.left / maxLeft * Math.max(0, scroller.scrollWidth - scroller.clientWidth) : 0;
    scroller.scrollTop = maxTop > 0 ? logicalScroll.top / maxTop * Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    // A later scroll event must not feed rounded DOM offsets back into the camera.
    domScroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }
  function readNativeScroll(): boolean {
    if (!active) return false;
    const left = scroller.scrollLeft, top = scroller.scrollTop;
    if (left === domScroll.left && top === domScroll.top) return false;
    stopInertia();
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth), maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (left !== domScroll.left) logicalScroll.left = maxLeft > 0 ? Math.max(0, Math.min(1, left / maxLeft)) * (metrics.surfaceWidth - metrics.width) : 0;
    if (top !== domScroll.top) logicalScroll.top = maxTop > 0 ? Math.max(0, Math.min(1, top / maxTop)) * (metrics.surfaceHeight - metrics.height) : 0;
    domScroll = { left, top };
    return true;
  }
  function scrollBy(left: number, top: number): void {
    positionScroll(logicalScroll.left + left, logicalScroll.top + top);
  }
  function positionView(view: ReaderCameraView): void {
    const scroll = readerScrollFromView(metrics, view);
    positionScroll(scroll.left, scroll.top);
  }
  function resize(): void {
    if (disposed) return;
    const before = getView();
    const targetPage = navigationTarget && Math.abs(logicalScroll.top - navigationTarget.top) < .5 ? navigationTarget.page : null;
    sizeSurface();
    if (active && rects.length) {
      if (initialView) {
        const i = currentPage * 4;
        positionView({ centerX: (rects[i] + rects[i + 2]) / 2,
          centerY: rects[i + 3] - (metrics.height / 2 - READER_MARGIN) / zoom, zoom });
        initialView = false;
      } else positionView({ ...before, zoom });
      if (targetPage !== null) navigationTarget = { page: targetPage, top: logicalScroll.top };
      present();
    }
    updateThumbnails();
  }
  function stopInertia(): void { if (inertiaFrame) window.cancelAnimationFrame(inertiaFrame); inertiaFrame = 0; }
  function updateToolbarOffset(): void {
    document.documentElement.style.setProperty("--reader-toolbar-height", `${toolbar.hidden ? 16 : toolbar.getBoundingClientRect().height + 16}px`);
  }
  function setToolbarVisible(visible: boolean): void {
    cancelActiveGesture();
    toolbar.hidden = !visible;
    showToolbar.hidden = visible;
    hideToolbar.setAttribute("aria-expanded", String(visible));
    showToolbar.setAttribute("aria-expanded", String(visible));
    updateToolbarOffset(); resize();
    (visible ? hideToolbar : showToolbar).focus({ preventScroll: true });
  }
  function releaseScratch(): void {
    options.releaseThumbnails?.();
    scratchRenderer?.dispose(); scratchRenderer = null;
    if (scratchCanvas) scratchCanvas.width = scratchCanvas.height = 0;
    scratchCanvas = null;
  }
  function cancelActiveGesture(): void {
    stopInertia();
    for (const pointerId of pointers.keys()) {
      if (attachedCanvas?.hasPointerCapture(pointerId)) attachedCanvas.releasePointerCapture(pointerId);
    }
    pointers.clear(); pinch = null; pinched = false; velocityX = velocityY = 0;
  }
  function prepareZoom(nextZoom: number): void {
    stopInertia(); navigationTarget = null; fit = null; zoom = nextZoom; initialView = false;
    sizeSurface();
  }
  function setView(view: ReaderCameraView): void {
    if (!Number.isFinite(view.zoom) || view.zoom <= 0 || !Number.isFinite(view.centerX) || !Number.isFinite(view.centerY)) return;
    savedView = view; prepareZoom(view.zoom); positionView(view); present();
  }
  function zoomAt(nextZoom: number, x = metrics.width / 2, y = metrics.height / 2): void {
    setView(readerZoomAt(getView(), nextZoom, x, y));
  }
  function goToPage(index: number): void {
    if (!rects.length) return;
    stopInertia(); const targetPage = Math.max(0, Math.min(rects.length / 4 - 1, Math.trunc(index)));
    currentPage = targetPage;
    const previousFit = fit;
    sizeSurface();
    const i = currentPage * 4;
    positionView({ centerX: (rects[i] + rects[i + 2]) / 2,
      centerY: rects[i + 3] - (metrics.height / 2 - READER_MARGIN) / zoom, zoom });
    navigationTarget = { page: targetPage, top: logicalScroll.top };
    fit = previousFit; initialView = false; present();
    rows.forEach((row, page) => page === currentPage ? row.setAttribute("aria-current", "page") : row.removeAttribute("aria-current"));
    updateToolbar();
  }
  function chooseFit(mode: "width" | "page"): void {
    fit = mode; goToPage(currentPage);
  }
  function setLayout(layout: string): void {
    if (active) savedView = getView();
    const wasActive = active;
    active = layout === "reader";
    layoutSelect.value = layout;
    shell.classList.toggle("reader-active", active);
    document.body.classList.toggle("reader-active", active);
    sidebar.hidden = !active || !sidebarOpen;
    cancelActiveGesture();
    if (!active) {
      positionScroll(0, 0);
      for (const job of thumbnailJobs.values()) job.abort();
      releaseScratch();
    }
    sizeSurface();
    if (active && !wasActive && savedView && !initialView) { positionView({ ...savedView, zoom }); present(); }
    else resize();
    updateToolbar();
  }
  function invalidateThumbnails(): void {
    thumbnailRevision++;
    for (const job of thumbnailJobs.values()) job.abort();
    for (const canvas of thumbnailCanvases.values()) { canvas.remove(); canvas.width = canvas.height = 0; }
    thumbnailCanvases.clear(); thumbnailFailed.clear();
    for (const row of rows) { row.classList.remove("reader-thumbnail-failed"); row.title = ""; }
    updateThumbnails();
  }
  function setDocument(next: { identity: unknown; pageRects: Float32Array }): void {
    const same = identity === next.identity && rects.length > 0;
    const before = getView(), anchor = same ? readerCaptureAnchor(rects, before) : null;
    identity = next.identity; rects = next.pageRects;
    navigationTarget = null;
    if (!same) {
      currentPage = 0; zoom = READER_ACTUAL_SIZE_ZOOM; fit = "width";
      initialView = true; savedView = null; sidebarOpen = window.innerWidth >= 800;
      positionScroll(0, 0); sidebar.scrollTop = 0;
    }
    sidebar.hidden = !active || !sidebarOpen;
    rows.length = rowTops.length = 0; sidebar.replaceChildren();
    let top = 12;
    const fragment = document.createDocumentFragment();
    for (let page = 0; page < rects.length / 4; page++) {
      const i = page * 4, width = Math.max(.001, rects[i + 2] - rects[i]), height = Math.max(.001, rects[i + 3] - rects[i + 1]);
      const scale = Math.min(120 / width, 160 / height);
      const row = document.createElement("button"); row.type = "button"; row.className = "reader-thumbnail";
      row.setAttribute("aria-label", `Go to page ${page + 1}`); row.dataset.page = String(page);
      row.style.height = `${height * scale + 32}px`;
      row.innerHTML = `<span class="reader-thumbnail-image" style="width:${width * scale}px;height:${height * scale}px"></span><span>${page + 1}</span>`;
      if (page === currentPage) row.setAttribute("aria-current", "page");
      rowTops.push(top); top += height * scale + 44; rows.push(row); fragment.append(row);
    }
    sidebar.append(fragment); invalidateThumbnails();
    if (!same) releaseScratch();
    sizeSurface();
    if (anchor) {
      savedView = readerRestoreAnchor(rects, anchor, zoom);
      positionView(savedView); initialView = false;
    }
    resize(); updateToolbar();
  }

  async function pumpThumbnails(): Promise<void> {
    if (thumbnailRunning || disposed || !active || !sidebarOpen) return;
    thumbnailRunning = true;
    try {
      while (!disposed && active && sidebarOpen) {
        const page = [...thumbnailWanted].find(index => !thumbnailCanvases.has(index) && !thumbnailFailed.has(index));
        if (page === undefined) break;
        const revision = thumbnailRevision, controller = new AbortController();
        thumbnailJobs.set(page, controller);
        try {
          const box = rows[page].querySelector<HTMLElement>(".reader-thumbnail-image")!;
          const ratio = window.devicePixelRatio || 1;
          const width = Math.max(1, Math.round(Number.parseFloat(box.style.width) * ratio));
          const height = Math.max(1, Math.round(Number.parseFloat(box.style.height) * ratio));
          if (options.getPageThumbnail) {
            const pixels = await options.getPageThumbnail(page, { maxDimension: Math.max(width, height), signal: controller.signal });
            controller.signal.throwIfAborted();
            if (revision !== thumbnailRevision || disposed || !thumbnailWanted.has(page)) continue;
            const image = document.createElement("canvas"); image.width = pixels.width; image.height = pixels.height;
            const context = image.getContext("2d");
            if (!context) throw new Error("Page thumbnail canvas is unavailable.");
            context.putImageData(new ImageData(new Uint8ClampedArray(pixels.rgba.buffer, pixels.rgba.byteOffset, pixels.rgba.byteLength), pixels.width, pixels.height), 0, 0);
            box.append(image); thumbnailCanvases.set(page, image);
            await new Promise<void>(resolve => window.setTimeout(resolve, 0));
            continue;
          }
          if (!options.getPagePreviewScene) throw new Error("Page thumbnails are unavailable.");
          const scene = await options.getPagePreviewScene(page, { maximumDimension: Math.max(16, Math.min(4096, Math.max(width, height))), signal: controller.signal });
          if (controller.signal.aborted || revision !== thumbnailRevision || !thumbnailWanted.has(page)) continue;
          scratchCanvas ??= document.createElement("canvas");
          scratchCanvas.width = width; scratchCanvas.height = height;
          scratchRenderer ??= new WebGlFloorplanRenderer(scratchCanvas, { preserveDrawingBuffer: true });
          scratchRenderer.setExternalFrameDriver(true);
          scratchRenderer.setScene(scene);
          options.configureThumbnailRenderer?.(scratchRenderer, scene);
          const renderer = scratchRenderer, sourceCanvas = scratchCanvas;
          const replay = scene.retainedPages?.length ? new RetainedPageReplay(scene) : null;
          try {
            if (replay) {
              const visibility = renderer.getOptionalContentVisibility() ?? createDefaultOptionalContentSnapshot(scene);
              const result = await replay.prepare(visibility, { signal: controller.signal });
              controller.signal.throwIfAborted();
              if (revision !== thumbnailRevision || disposed || !thumbnailWanted.has(page)) continue;
              const staged = await renderer.prepareRasterLayerUpdatesAsync(result.layers);
              try {
                controller.signal.throwIfAborted();
                if (revision !== thumbnailRevision || disposed || !thumbnailWanted.has(page)) continue;
                staged.commit(); result.commit();
              } finally { staged.dispose(); }
            }
            renderer.fitToBounds(scene.pageBounds, 0);
            renderer.renderExternalFrame();
            const image = document.createElement("canvas"); image.width = width; image.height = height;
            const context = image.getContext("2d");
            if (!context) throw new Error("Page thumbnail canvas is unavailable.");
            context.drawImage(sourceCanvas, 0, 0);
            box.append(image); thumbnailCanvases.set(page, image);
          } finally { replay?.dispose(); }
        } catch (error) {
          if (!controller.signal.aborted && revision === thumbnailRevision) {
            thumbnailFailed.add(page); rows[page]?.classList.add("reader-thumbnail-failed");
            if (rows[page]) rows[page].title = "Preview unavailable. Select to open this page.";
            console.warn(`[HEPR] Thumbnail for page ${page + 1} could not be prepared.`, error);
          }
        } finally { if (thumbnailJobs.get(page) === controller) thumbnailJobs.delete(page); }
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
    } finally { thumbnailRunning = false; }
  }
  function updateThumbnails(): void {
    thumbnailWanted.clear();
    if (active && sidebarOpen && sidebar.clientHeight > 0) {
      const start = sidebar.scrollTop - sidebar.clientHeight, end = sidebar.scrollTop + sidebar.clientHeight * 2;
      rows.forEach((row, index) => {
        if (rowTops[index] + Number.parseFloat(row.style.height) >= start && rowTops[index] <= end) thumbnailWanted.add(index);
      });
    }
    for (const [page, job] of thumbnailJobs) if (!thumbnailWanted.has(page)) job.abort();
    for (const [page, canvas] of thumbnailCanvases) if (!thumbnailWanted.has(page)) {
      canvas.remove(); canvas.width = canvas.height = 0; thumbnailCanvases.delete(page);
    }
    void pumpThumbnails();
  }
  function beginPinch(): void {
    pinch = null;
    const [first, second] = pointers.values();
    if (!first || !second) return;
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    if (distance <= 0) return;
    const view = getView(), bounds = attachedCanvas!.getBoundingClientRect();
    pinch = { distance, zoom: view.zoom,
      x: view.centerX + ((first.x + second.x) / 2 - bounds.left - view.width / 2) / view.zoom,
      y: view.centerY - ((first.y + second.y) / 2 - bounds.top - view.height / 2) / view.zoom };
  }
  function canvasChanged(): void {
    cancelActiveGesture(); canvasLifetime?.abort();
    attachedCanvas = options.getCanvas(); surface.append(attachedCanvas);
    canvasLifetime = new AbortController();
    const signal = canvasLifetime.signal;
    attachedCanvas.addEventListener("wheel", event => {
      if (!active || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const bounds = attachedCanvas!.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? metrics.height : 1);
      zoomAt(zoom * Math.exp(-delta * .002), event.clientX - bounds.left, event.clientY - bounds.top);
    }, { passive: false, signal });
    attachedCanvas.addEventListener("pointerdown", event => {
      if (!active || event.button !== 0) return;
      stopInertia(); scroller.focus({ preventScroll: true });
      if (!pointers.size) pinched = false;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) { pinched = true; beginPinch(); }
      lastTouchTime = performance.now(); velocityX = velocityY = 0;
      attachedCanvas!.setPointerCapture(event.pointerId);
    }, { signal });
    attachedCanvas.addEventListener("pointermove", event => {
      const previous = pointers.get(event.pointerId);
      if (!active || !previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointers.values()];
      if (points.length >= 2) {
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const x = (points[0].x + points[1].x) / 2, y = (points[0].y + points[1].y) / 2;
        if (!pinch) beginPinch();
        if (pinch && distance > 0) {
          const nextZoom = pinch.zoom * distance / pinch.distance;
          if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;
          // Solve from the original document anchor, without accumulating clamped scroll offsets.
          prepareZoom(nextZoom);
          const bounds = attachedCanvas!.getBoundingClientRect();
          positionView({ centerX: pinch.x - (x - bounds.left - metrics.width / 2) / zoom,
            centerY: pinch.y + (y - bounds.top - metrics.height / 2) / zoom, zoom });
          present();
        }
        velocityX = velocityY = 0;
      } else {
        const dx = previous.x - event.clientX, dy = previous.y - event.clientY;
        const now = performance.now(), elapsed = Math.max(1, now - lastTouchTime);
        scrollBy(dx, dy);
        velocityX = dx / elapsed; velocityY = dy / elapsed; lastTouchTime = now;
        present();
      }
    }, { signal });
    const end = (event: PointerEvent): void => {
      const [first, second] = pointers.keys();
      if (!pointers.delete(event.pointerId)) return;
      if (attachedCanvas?.hasPointerCapture(event.pointerId)) attachedCanvas.releasePointerCapture(event.pointerId);
      if (pinched) {
        if (event.pointerId === first || event.pointerId === second) beginPinch();
        lastTouchTime = performance.now(); velocityX = velocityY = 0;
        // Finger-lift motion at the end of a pinch must not launch a scrolling flick.
        return;
      }
      if (event.pointerType !== "touch" || pointers.size || event.type !== "pointerup" || performance.now() - lastTouchTime > 100) return;
      let last = performance.now();
      const glide = (now: number): void => {
        inertiaFrame = 0;
        const elapsed = Math.min(32, now - last); last = now;
        const oldLeft = logicalScroll.left, oldTop = logicalScroll.top;
        scrollBy(velocityX * elapsed, velocityY * elapsed);
        const decay = Math.exp(-elapsed / 180); velocityX *= decay; velocityY *= decay;
        if (logicalScroll.left === oldLeft) velocityX = 0;
        if (logicalScroll.top === oldTop) velocityY = 0;
        present();
        if (active && Math.hypot(velocityX, velocityY) > .02) inertiaFrame = window.requestAnimationFrame(glide);
      };
      inertiaFrame = window.requestAnimationFrame(glide);
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) attachedCanvas.addEventListener(type, end, { signal });
    resize();
  }

  layoutSelect.addEventListener("change", () => {
    const next = layoutSelect.value;
    Promise.resolve(options.onLayoutChange(next)).catch(error => {
      console.warn("[HEPR] Page layout could not be changed.", error);
    });
  }, { signal: lifetime.signal });
  toolbar.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-reader]");
    if (!button) return;
    switch (button.dataset.reader) {
      case "thumbnails": sidebarOpen = !sidebarOpen; sidebar.hidden = !active || !sidebarOpen; resize();
        if (!sidebarOpen) releaseScratch(); break;
      case "previous": goToPage(currentPage - 1); break;
      case "next": goToPage(currentPage + 1); break;
      case "zoom-out": zoomAt(zoom / 1.2); break;
      case "zoom-in": zoomAt(zoom * 1.2); break;
      case "fit-width": chooseFit("width"); break;
      case "fit-page": chooseFit("page"); break;
      case "find": options.onFind(); break;
      case "settings": options.onSettings(); break;
      case "hide-toolbar": setToolbarVisible(false); break;
    }
  }, { signal: lifetime.signal });
  showToolbar.addEventListener("click", () => setToolbarVisible(true), { signal: lifetime.signal });
  sidebar.addEventListener("click", event => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".reader-thumbnail");
    if (row) goToPage(Number(row.dataset.page));
  }, { signal: lifetime.signal });
  sidebar.addEventListener("scroll", updateThumbnails, { passive: true, signal: lifetime.signal });
  scroller.addEventListener("scroll", () => {
    // The host coalesces drawing into its own animation frame. Update the
    // camera now so native scrolling does not wait through another frame, and
    // ignore readback from gestures/navigation that already presented it.
    if (readNativeScroll()) present();
  }, { passive: true, signal: lifetime.signal });
  scroller.addEventListener("wheel", event => {
    stopInertia();
    if (!active || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    if (metrics.surfaceWidth <= scroller.scrollWidth + 1 && metrics.surfaceHeight <= scroller.scrollHeight + 1) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : 1;
    const left = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
    const top = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
    scrollBy(left * (event.deltaMode === 2 ? metrics.width : unit), top * (event.deltaMode === 2 ? metrics.height : unit)); present();
  }, { passive: false, signal: lifetime.signal });
  scroller.addEventListener("keydown", event => {
    if (!active || event.target !== scroller) return;
    let top: number | undefined, left: number | undefined;
    switch (event.key) {
      case "ArrowDown": top = logicalScroll.top + 40; break;
      case "ArrowUp": top = logicalScroll.top - 40; break;
      case "ArrowLeft": left = logicalScroll.left - 40; break;
      case "ArrowRight": left = logicalScroll.left + 40; break;
      case "PageDown": case " ": top = logicalScroll.top + metrics.height * (event.shiftKey ? -.9 : .9); break;
      case "PageUp": top = logicalScroll.top - metrics.height * .9; break;
      case "Home": top = 0; break;
      case "End": top = metrics.surfaceHeight; break;
      default: return;
    }
    event.preventDefault(); stopInertia();
    positionScroll(left ?? logicalScroll.left, top ?? logicalScroll.top);
    present();
  }, { signal: lifetime.signal });
  const submitPage = (): void => {
    const page = Number(pageInput.value);
    if (Number.isFinite(page) && page >= 1) goToPage(page - 1);
    pageInput.value = String(currentPage + 1);
  };
  pageInput.addEventListener("change", submitPage, { signal: lifetime.signal });
  pageInput.addEventListener("keydown", event => { if (event.key === "Enter") { submitPage(); scroller.focus(); } }, { signal: lifetime.signal });
  const submitZoom = (): void => {
    const percentage = Number.parseFloat(zoomInput.value);
    if (Number.isFinite(percentage) && percentage > 0) zoomAt(percentage / 100 * READER_ACTUAL_SIZE_ZOOM);
    zoomInput.value = `${Math.round(zoom / READER_ACTUAL_SIZE_ZOOM * 100)}%`;
  };
  zoomInput.addEventListener("change", submitZoom, { signal: lifetime.signal });
  zoomInput.addEventListener("keydown", event => { if (event.key === "Enter") { submitZoom(); scroller.focus(); } }, { signal: lifetime.signal });
  const observer = new ResizeObserver(() => {
    updateToolbarOffset();
    if (!resizeFrame) resizeFrame = window.requestAnimationFrame(() => { resizeFrame = 0; resize(); });
  });
  observer.observe(scroller);
  observer.observe(toolbar);
  canvasChanged(); setLayout("grid"); updateToolbarOffset();
  function snapshot(): ReaderViewportSnapshot { return { view: getView(), fit, sidebarOpen, pageIndex: currentPage }; }
  function restore(state: ReaderViewportSnapshot): void {
    zoom = state.view.zoom; fit = state.fit; sidebarOpen = state.sidebarOpen; savedView = state.view; initialView = false;
    if (state.pageIndex !== undefined) currentPage = Math.max(0, Math.min(rects.length / 4 - 1, state.pageIndex));
    sidebar.hidden = !active || !sidebarOpen; sizeSurface(); positionView(state.view);
    navigationTarget = state.pageIndex === undefined ? null : { page: currentPage, top: logicalScroll.top };
    rows.forEach((row, page) => page === currentPage ? row.setAttribute("aria-current", "page") : row.removeAttribute("aria-current"));
    present(); updateThumbnails();
  }
  function dispose(): void {
    disposed = true; cancelActiveGesture(); lifetime.abort(); canvasLifetime?.abort(); observer.disconnect();
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    for (const job of thumbnailJobs.values()) job.abort();
    releaseScratch();
    for (const canvas of thumbnailCanvases.values()) { canvas.remove(); canvas.width = canvas.height = 0; }
    thumbnailCanvases.clear(); thumbnailWanted.clear(); thumbnailFailed.clear(); rows.length = rowTops.length = 0;
    announcement.textContent = "";
  }
  return { setDocument, setLayout, getView, setView, goToPage, resize, canvasChanged,
    invalidateThumbnails, snapshot, restore, dispose, isActive, cancelActiveGesture };
}
