import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const gpu = { instances: [], copies: [] };
globalThis.__readerViewportGpu = gpu;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
      ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/readerViewport.css")) return { format: "module", shortCircuit: true, source: "export {};" };
    if (url.endsWith("/webGlFloorplanRenderer.ts")) return { format: "module", shortCircuit: true, source: `
      export class WebGlFloorplanRenderer {
        constructor(canvas) { this.canvas=canvas; this.disposed=false; globalThis.__readerViewportGpu.instances.push(this); }
        setExternalFrameDriver(value) { this.external=value; }
        setVectorLodMode() {} setTextLodMode() {}
        setScene(scene) { if(this.disposed) throw Error("renderer disposed"); this.scene=scene; this.layers=new Map(); }
        setPageBackgroundColor(...value) { this.background=value; }
        setVectorColorOverride(...value) { this.vector=value; }
        setOptionalContentVisibility(value) { this.visibility=value; }
        getOptionalContentVisibility() { return this.visibility ?? {revision:0,layers:[],conditions:new Uint8Array(0)}; }
        fitToBounds(bounds,padding) { this.bounds=bounds; this.padding=padding; }
        prepareRasterLayerUpdates(updates) { const owner=this; return { commit() { owner.layers=new Map(updates); }, dispose() {} }; }
        async prepareRasterLayerUpdatesAsync(updates) { return this.prepareRasterLayerUpdates(updates); }
        renderExternalFrame() {
          if(this.disposed) throw Error("renderer disposed");
          this.canvas.renderedFrame={tag:this.scene.tag,width:this.canvas.width,height:this.canvas.height,
            padding:this.padding,background:this.background,vector:this.vector,visibility:this.visibility,external:this.external,
            replayedPixels:(() => { const data=this.layers.get(0)?.data;
              const first=data?.findIndex((value,index) => index%4===3 && value>0);
              return first>=0 ? data.slice(first-3,first+1) : undefined; })()};
        }
        dispose() { this.disposed=true; }
      }
    ` };
    return next(url, context);
  }
});
const previousObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

class Element {
  children = []; parentElement = null;
  style = { setProperty(name, value) { this[name] = String(value); }, getPropertyValue(name) { return this[name] ?? ""; } };
  dataset = {}; attributes = new Map(); listeners = new Map();
  className = ""; hidden = false; value = ""; disabled = false; textContent = ""; title = "";
  width = 300; height = 150; captures = new Set(); _left = 0; _top = 0;
  constructor(tag, ownerDocument) { this.tagName = tag; this.ownerDocument = ownerDocument; }
  get classList() {
    const node = this;
    return { contains: name => node.className.split(/\s+/).includes(name),
      add: (...names) => { node.className = [...new Set([...node.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { node.className = node.className.split(/\s+/).filter(name => !names.includes(name)).join(" "); },
      toggle(name, force) { const add = force ?? !this.contains(name); add ? this.add(name) : this.remove(name); return add; } };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === "fragment") { this.append(...node.children.slice()); continue; }
      node.remove(); node.parentElement = this; this.children.push(node);
    }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  querySelector(selector) { return this.children.flatMap(child => [child, ...child.descendants()]).find(node => node.matches(selector)) ?? null; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const data = selector.match(/^(button)?\[data-reader(?:="([^"]+)")?\]$/);
    return !!data && (!data[1] || this.tagName === "button") && this.dataset.reader !== undefined && (!data[2] || this.dataset.reader === data[2]);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  set innerHTML(html) {
    this.replaceChildren();
    const create = (tag, className, parent = this) => { const node = this.ownerDocument.createElement(tag); node.className = className; parent.append(node); return node; };
    if (html.includes("reader-toolbar")) {
      const toolbar = create("div", "reader-toolbar");
      if (html.includes('id="reader-toolbar"')) toolbar.id = "reader-toolbar";
      create("div", "reader-primary-controls", toolbar); create("select", "reader-layout", toolbar);
      const reading = create("div", "reader-reading-controls", toolbar);
      const actions = ["thumbnails", "previous", "next", "zoom-out", "zoom-in", "fit-width", "fit-page", "find", "settings"];
      if (html.includes('data-reader="hide-toolbar"')) actions.push("hide-toolbar");
      for (const action of actions) {
        const button = create("button", "", toolbar); button.dataset.reader = action;
        button.textContent = html.match(new RegExp(`<button\\b[^>]*data-reader="${action}"[^>]*>([^<]*)</button>`))?.[1] ?? "";
        const markup = html.match(new RegExp(`<button\\b[^>]*data-reader="${action}"[^>]*>`))?.[0] ?? "";
        for (const name of ["aria-controls", "aria-expanded"]) {
          const attribute = markup.match(new RegExp(`${name}="([^"]+)"`));
          if (attribute) button.setAttribute(name, attribute[1]);
        }
      }
      create("input", "reader-page-number", reading); create("span", "reader-page-count", reading);
      create("input", "reader-zoom", reading); create("span", "reader-announcement", toolbar);
      if (html.includes('data-reader="show-toolbar"')) {
        const restore = create("button", "reader-toolbar-restore"); restore.dataset.reader = "show-toolbar";
        const markup = html.match(/<button\b[^>]*data-reader="show-toolbar"[^>]*>/)[0];
        restore.textContent = html.match(/<button\b[^>]*data-reader="show-toolbar"[^>]*>([^<]*)<\/button>/)?.[1] ?? "";
        restore.hidden = /\bhidden\b/.test(markup);
        for (const name of ["aria-controls", "aria-expanded"]) {
          const attribute = markup.match(new RegExp(`${name}="([^"]+)"`));
          if (attribute) restore.setAttribute(name, attribute[1]);
        }
      }
      const workspace = create("div", "reader-workspace");
      const sidebar = create("aside", "reader-thumbnails", workspace); sidebar.hidden = true;
      const scroller = create("div", "reader-scroll", workspace); create("div", "reader-surface", scroller);
    } else if (html.includes("reader-thumbnail-image")) {
      const image = create("span", "reader-thumbnail-image");
      const [, width, height] = html.match(/width:([^;]+);height:([^"]+)/);
      image.style.width = width; image.style.height = height; create("span", "");
    }
  }
  addEventListener(type, listener, options = {}) {
    if (options.signal?.aborted) return;
    const entry = { listener, signal: options.signal };
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(entry);
    options.signal?.addEventListener("abort", () => this.listeners.get(type)?.delete(entry), { once: true });
  }
  removeEventListener(type, listener) {
    for (const entry of this.listeners.get(type) ?? []) if (entry.listener === listener) this.listeners.get(type).delete(entry);
  }
  emit(type, values = {}) {
    const event = { type, target: this, button: 0, pointerType: "mouse", pointerId: 1,
      ctrlKey: false, metaKey: false, shiftKey: false, deltaMode: 0, deltaX: 0, deltaY: 0, ...values,
      preventDefault() { this.defaultPrevented = true; } };
    for (let node = this; node; node = node.parentElement) {
      for (const { listener } of [...node.listeners.get(type) ?? []]) listener(event);
      if (["scroll", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "keydown"].includes(type)) break;
    }
    return event;
  }
  get clientWidth() {
    if (this.classList.contains("reader-scroll")) {
      const sidebar = this.ownerDocument.querySelector(".reader-thumbnails");
      return this.ownerDocument.viewportWidth - (sidebar?.hidden ? 0 : this.ownerDocument.viewportWidth < 800 ? 152 : 180);
    }
    if (this.classList.contains("reader-thumbnails")) return this.hidden ? 0 : this.ownerDocument.viewportWidth < 800 ? 152 : 180;
    return Number.parseFloat(this.style.width) || this.width;
  }
  get clientHeight() {
    if (this.classList.contains("reader-toolbar")) return this.hidden ? 0 : 64;
    if (this.classList.contains("reader-scroll") || this.classList.contains("reader-thumbnails")) {
      return this.hidden ? 0 : this.ownerDocument.viewportHeight - (this.ownerDocument.querySelector(".reader-toolbar")?.clientHeight ?? 64);
    }
    return Number.parseFloat(this.style.height) || this.height;
  }
  get scrollWidth() {
    const width = Number.parseFloat(this.querySelector(".reader-surface")?.style.width) || this.clientWidth;
    return this.classList.contains("reader-scroll") ? Math.min(width, this.ownerDocument.browserScrollLimit) : width;
  }
  get scrollHeight() {
    if (this.classList.contains("reader-thumbnails")) return 12 + this.children.reduce((height, row) => height + row.offsetHeight + 12, 0);
    const height = Number.parseFloat(this.querySelector(".reader-surface")?.style.height) || this.clientHeight;
    return this.classList.contains("reader-scroll") ? Math.min(height, this.ownerDocument.browserScrollLimit) : height;
  }
  get scrollLeft() { return Math.max(0, Math.min(this._left, this.scrollWidth - this.clientWidth)); }
  set scrollLeft(value) { this._left = this.roundScroll(value, this.scrollWidth - this.clientWidth); }
  get scrollTop() { return Math.max(0, Math.min(this._top, this.scrollHeight - this.clientHeight)); }
  set scrollTop(value) { this._top = this.roundScroll(value, this.scrollHeight - this.clientHeight); }
  roundScroll(value, maximum) {
    const quantum = this.ownerDocument.scrollQuantum;
    const offset = Math.max(0, Math.min(Number(value) || 0, Math.max(0, maximum)));
    return quantum > 0 ? Math.min(Math.max(0, maximum), Math.round(offset / quantum) * quantum) : offset;
  }
  get offsetHeight() { return Number.parseFloat(this.style.height) || this.clientHeight; }
  get offsetTop() {
    if (!this.parentElement) return 0;
    return 12 + this.parentElement.children.slice(0, this.parentElement.children.indexOf(this)).reduce((top, row) => top + row.offsetHeight + 12, 0);
  }
  getBoundingClientRect() {
    if (this.classList.contains("reader-toolbar")) {
      return { left:0,top:0,width:this.ownerDocument.viewportWidth,height:this.clientHeight,
        right:this.ownerDocument.viewportWidth,bottom:this.clientHeight };
    }
    const scroller = this.ownerDocument.querySelector(".reader-scroll");
    const left = this.ownerDocument.viewportWidth - (scroller?.clientWidth ?? this.clientWidth);
    const top = this.ownerDocument.querySelector(".reader-toolbar")?.clientHeight ?? 64;
    const width = Number.parseFloat(this.style.width) || scroller?.clientWidth || this.clientWidth;
    const height = Number.parseFloat(this.style.height) || scroller?.clientHeight || this.clientHeight;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  focus() { this.ownerDocument.activeElement = this; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getContext(kind) {
    assert.equal(kind, "2d");
    return { drawImage: source => { assert(source.renderedFrame, "render the GPU page before copying it"); this.copiedFrame = { ...source.renderedFrame }; gpu.copies.push(this); } };
  }
}

function environment(width = 700, height = 800, { browserScrollLimit = Infinity, scrollQuantum = 0 } = {}) {
  const frames = new Map(); let serial = 0, time = performance.now();
  const window = Object.assign(new EventTarget(), { innerWidth: width, devicePixelRatio: 2, setTimeout,
    performance: { now: () => time }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  const document = Object.assign(new EventTarget(), { viewportWidth: width, viewportHeight: height, browserScrollLimit, scrollQuantum, defaultView: window, activeElement: null,
    createElement: tag => new Element(tag, document), createDocumentFragment: () => new Element("fragment", document),
    querySelector: selector => document.body.querySelector(selector) });
  document.documentElement = new Element("html", document);
  document.body = new Element("body", document);
  let canvas = document.createElement("canvas"); canvas.id = "viewport"; document.body.append(canvas);
  const views = [], requests = [];
  const env = { document, window, views, requests, frames, get canvas() { return canvas; },
    replaceCanvas() { const next = document.createElement("canvas"); next.id = "viewport"; canvas.remove(); canvas = next; return next; },
    flushFrames(timestamp = performance.now()) { time = timestamp; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(timestamp); },
    preview: (page, options) => Promise.resolve(pageScene(`page-${page}`)),
    options: { getCanvas: () => canvas, layouts: [{ value: "reader", label: "Reader" }, { value: "grid", label: "Grid" }],
      onLayoutChange() {}, onViewChange: view => views.push(view), onFind() {}, onSettings() {},
      getPagePreviewScene(page, options) { requests.push({ page, ...options }); return env.preview(page, options); },
      configureThumbnailRenderer(renderer) { renderer.setPageBackgroundColor(.2,.3,.4,1); renderer.setVectorColorOverride(.8,.7,.6,.5); }
    } };
  return env;
}
function pageScene(tag) { return { tag, pageBounds: { minX: 0, minY: 0, maxX: 600, maxY: 800 } }; }
function pageRects(count, height = 800) { return Float32Array.from(Array.from({ length: count }, (_, i) => [-300, -i * (height + 16) - height, 300, -i * (height + 16)]).flat()); }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } assert.fail("Reader asynchronous work did not settle"); }
function close(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

try {
  const { createReaderViewport } = await import("../src/readerViewport.ts");
  const { READER_ACTUAL_SIZE_ZOOM, readerContentMetrics, readerViewFromScroll } = await import("../src/readerGeometry.ts");
  const { createViewerLinkNavigation, resolveAnnotationView } = await import("../src/viewerLinkNavigation.ts");
  const { createAnnotationInteractionController } = await import("../src/annotationInteraction.ts");
  {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    const scroller = doc.querySelector(".reader-scroll"), sidebar = doc.querySelector(".reader-thumbnails");
    const button = action => doc.querySelector(`[data-reader="${action}"]`);
    reader.setDocument({ identity: "navigation", pageRects: pageRects(4) });
    assert.equal(env.requests.length, 0, "inactive layouts leave thumbnail rendering dormant");
    reader.setLayout("reader");
    let view = reader.getView();
    close(view.zoom, (700 - 48) / 600, "first page starts at fit width");
    close(view.height / 2 - (0 - view.centerY) * view.zoom, 24, "first page starts at its top with the reader margin");
    assert.equal(doc.querySelector(".reader-page-number").value, "1");
    const beforeScroll = view;
    scroller.scrollTop = 300; scroller.emit("scroll"); env.flushFrames();
    close(reader.getView().centerY, beforeScroll.centerY - 300 / beforeScroll.zoom, "native scroll controls the camera");
    assert.deepEqual(env.views.at(-1), reader.getView());
    reader.setView({ centerX: 0, centerY: -1000, zoom: 2 });
    view = reader.getView();
    const bounds = env.canvas.getBoundingClientRect(), x = 200, y = 200;
    const anchorX = view.centerX + (x - view.width / 2) / view.zoom;
    const anchorY = view.centerY - (y - view.height / 2) / view.zoom;
    const wheel = env.canvas.emit("wheel", { ctrlKey: true, deltaY: -100, clientX: bounds.left + x, clientY: bounds.top + y });
    assert(wheel.defaultPrevented);
    view = reader.getView();
    close(view.centerX + (x - view.width / 2) / view.zoom, anchorX, "zoom keeps the cursor's document X");
    close(view.centerY - (y - view.height / 2) / view.zoom, anchorY, "zoom keeps the cursor's document Y");
    const beforeSidebar = reader.getView(); button("thumbnails").emit("click");
    assert.equal(sidebar.hidden, false);
    close(reader.getView().centerX, beforeSidebar.centerX, "opening the sidebar retains the camera X");
    close(reader.getView().centerY, beforeSidebar.centerY, "opening the sidebar retains the camera Y");
    const saved = reader.snapshot();
    reader.setLayout("grid"); reader.setLayout("reader");
    close(reader.getView().centerY, saved.view.centerY, "layout round trip restores the reading position");
    reader.goToPage(3); reader.restore(saved);
    close(reader.getView().centerY, saved.view.centerY, "snapshot restore retains scroll position");
    close(reader.getView().zoom, saved.view.zoom, "snapshot restore retains zoom");
    const gestureView = reader.getView();
    env.canvas.emit("pointerdown", { pointerId: 9, clientX: 250, clientY: 250 });
    assert(env.canvas.hasPointerCapture(9)); reader.cancelActiveGesture();
    assert(!env.canvas.hasPointerCapture(9), "gesture cancellation releases pointer capture");
    env.canvas.emit("pointermove", { pointerId: 9, clientX: 300, clientY: 320 });
    assert.deepEqual(reader.getView(), gestureView, "cancelled gestures cannot move the camera");
    const oldCanvas = env.canvas; env.replaceCanvas(); reader.canvasChanged();
    assert.equal(env.canvas.parentElement.className, "reader-surface");
    const replacementView = reader.getView();
    oldCanvas.emit("wheel", { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 300 });
    assert.deepEqual(reader.getView(), replacementView, "canvas replacement removes old interaction handlers");
    env.canvas.emit("wheel", { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 300 });
    assert(reader.getView().zoom > replacementView.zoom, "replacement canvas receives zoom controls");
    reader.dispose();
  }
  for (const routing of ["native", "reader"]) {
    for (const compressed of [false, true]) {
      for (const [fit, touchMovement] of [["Fit", null], ["XYZ", null], ["Fit", 0], ["XYZ", 1]]) {
        const env = environment(700, 800, { browserScrollLimit: compressed ? 250_000 : Infinity, scrollQuantum: 1 });
        const rects = pageRects(38), scene = { pageCount: 38, pageRects: rects,
          pdfPages: Array.from({ length: 38 }, (_, pageIndex) => ({ pageIndex, sourcePageIndex: pageIndex,
            pdfToScene: [1, 0, 0, 1, -300, -pageIndex * 816 - 800] })) };
        let nativeView, interaction;
        env.canvas.width = 1400;
        const ratio = () => env.canvas.width / env.canvas.getBoundingClientRect().width;
        const recordView = env.options.onViewChange;
        env.options.onViewChange = view => {
          recordView(view);
          nativeView = { cameraCenterX: view.centerX, cameraCenterY: view.centerY, zoom: view.zoom * ratio() };
          interaction?.onFrame();
        };
        const reader = createReaderViewport(env.options);
        reader.setDocument({ identity: scene, pageRects: rects }); reader.setLayout("reader");
        reader.setView({ centerX: 17.123456, centerY: -1000.123456, zoom: compressed ? 820 * READER_ACTUAL_SIZE_ZOOM : 2 });
        const navigation = createViewerLinkNavigation({
          getCanvas: () => env.canvas, getScene: () => scene, getIdentity: () => scene,
          beforeNavigate: () => reader.cancelActiveGesture(),
          getView: () => routing === "reader" ? reader.getView()
            : { centerX: nativeView.cameraCenterX, centerY: nativeView.cameraCenterY, zoom: nativeView.zoom / ratio() },
          setView: view => {
            if (routing === "reader") reader.setView(view);
            else {
              const rendererView = { cameraCenterX: view.centerX, cameraCenterY: view.centerY, zoom: view.zoom * ratio() };
              reader.setView({ centerX: rendererView.cameraCenterX, centerY: rendererView.cameraCenterY, zoom: rendererView.zoom / ratio() });
            }
          }
        });
        const previousFrames = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
        try {
          const annotation = { id: "reader-link", subtype: "Link", flags: 0,
            action: { type: "GoTo", destination: { sourcePageIndex: 30, fit, parameters: [423, 567, null] } } };
          scene.annotations = [annotation];
          const start = reader.getView(), target = resolveAnnotationView(scene, annotation, start, env.canvas.getBoundingClientRect());
          const label = `${routing} ${compressed ? "compressed" : "normal"} ${fit} ${touchMovement === null ? "direct" : `${touchMovement}px touch`} link`;
          assert.equal(navigation.getActivationLabel(annotation), "Go to destination", `${label} is actionable`);
          if (touchMovement === null) assert(navigation.activate(annotation), `${label} starts navigation`);
          else {
            [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = [
              env.window.requestAnimationFrame.bind(env.window), env.window.cancelAnimationFrame.bind(env.window)];
            let activations = 0;
            interaction = createAnnotationInteractionController({ adapter: {
              getCanvas: () => env.canvas, getScene: () => scene, getTarget: () => scene,
              getViewKey: () => JSON.stringify(reader.getView()), setSelection() {}, setHover() {},
              async pick() { return { annotationId: annotation.id, distancePx: 0 }; }
            }, onSelectionChange: (selected, source) => {
              if (selected && source === "canvas") { assert(navigation.activate(selected)); activations++; }
            } });
            env.canvas.emit("pointerdown", { pointerType: "touch", clientX: 350, clientY: 300, buttons: 1 });
            if (touchMovement) env.canvas.emit("pointermove", { pointerType: "touch", clientX: 350, clientY: 300 + touchMovement, buttons: 1 });
            env.canvas.emit("pointerup", { pointerType: "touch", clientX: 350, clientY: 300 + touchMovement, buttons: 0 });
            for (let frame = 0; activations === 0 && frame < 100; frame++) {
              env.flushFrames(env.window.performance.now() + 16); await tick();
            }
            assert.equal(activations, 1, `${label} activates through canvas annotation selection`);
          }
          const scroller = env.document.querySelector(".reader-scroll"), started = env.window.performance.now();
          env.flushFrames(started + 200);
          assert(Math.abs(reader.getView().centerY - start.centerY) > 10, `${label} moves the camera during the flight`);
          for (let elapsed = 216; env.frames.size && elapsed <= 1500; elapsed += 16) {
            scroller.emit("scroll"); env.flushFrames(started + elapsed); await tick();
          }
          assert.equal(env.frames.size, 0, `${label} finishes its animated flight`);
          for (const key of ["centerX", "centerY", "zoom"]) close(reader.getView()[key], target[key], `${label} reaches the destination ${key}`);
          for (let event = 0; event < 3; event++) { scroller.emit("scroll"); env.flushFrames(started + 1600 + event * 16); }
          for (const key of ["centerX", "centerY", "zoom"]) close(reader.getView()[key], target[key], `${label} remains at the destination after scroll readback ${key}`);
        } finally {
          interaction?.dispose(); navigation.dispose(); reader.dispose();
          [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = previousFrames;
        }
      }
    }
  }
  {
    const env = environment(700, 800, { browserScrollLimit: 33_554_432 });
    const reader = createReaderViewport(env.options), doc = env.document, rects = pageRects(38);
    reader.setDocument({ identity: "high-zoom-browser-range", pageRects: rects }); reader.setLayout("reader");
    reader.setView({ centerX: 17.123456, centerY: -30800.123456, zoom: 800 * READER_ACTUAL_SIZE_ZOOM });
    const initial = reader.getView(), input = doc.querySelector(".reader-zoom"), scroller = doc.querySelector(".reader-scroll");
    for (const percentage of [80500, 81000, 81500, 82000, 81500, 81000, 80500, 80000]) {
      input.value = `${percentage}%`; input.emit("change");
      const view = reader.getView();
      close(view.zoom, percentage / 100 * READER_ACTUAL_SIZE_ZOOM, "Reader accepts extreme zoom percentages");
      close(view.centerX, initial.centerX, "crossing the browser scroll range keeps horizontal focus");
      close(view.centerY, initial.centerY, "crossing 80000–82000% keeps vertical focus");
      scroller.emit("scroll"); env.flushFrames();
      close(reader.getView().centerY, initial.centerY, "deferred programmatic scroll events keep extreme zoom focus");
    }
    const canvas = env.canvas, bounds = canvas.getBoundingClientRect(), x = 200, y = 270;
    const anchorX = initial.centerX + (x - initial.width / 2) / initial.zoom;
    const anchorY = initial.centerY - (y - initial.height / 2) / initial.zoom;
    const delta = -Math.log(820 / 800) / .002;
    for (const deltaY of [delta, -delta]) {
      canvas.emit("wheel", { ctrlKey: true, deltaY, clientX: bounds.left + x, clientY: bounds.top + y });
      const view = reader.getView();
      close(view.centerX + (x - view.width / 2) / view.zoom, anchorX, "extreme zoom preserves the cursor's document X");
      close(view.centerY - (y - view.height / 2) / view.zoom, anchorY, "extreme zoom preserves the cursor's document Y");
    }
    canvas.emit("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 300 });
    canvas.emit("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 450, clientY: 300 });
    const beforePinch = reader.getView(), pinchY = beforePinch.centerY - (300 - bounds.top - beforePinch.height / 2) / beforePinch.zoom;
    for (let round = 0; round < 3; round++) {
      canvas.emit("pointermove", { pointerId: 2, pointerType: "touch", clientX: 455, clientY: 300 });
      scroller.emit("scroll"); env.flushFrames();
      const expanded = reader.getView();
      close(expanded.centerY - (300 - bounds.top - expanded.height / 2) / expanded.zoom, pinchY,
        "pinching beyond 80000% retains the document anchor");
      canvas.emit("pointermove", { pointerId: 2, pointerType: "touch", clientX: 450, clientY: 300 });
      close(reader.getView().centerY, beforePinch.centerY, "repeated high zoom pinches return to the same focus");
    }
    reader.dispose();
  }
  {
    const env = environment(700, 800, { browserScrollLimit: 250_000, scrollQuantum: 1 });
    const reader = createReaderViewport(env.options), doc = env.document, rects = pageRects(38);
    reader.setDocument({ identity: "quantized-virtual-scroll", pageRects: rects }); reader.setLayout("reader");
    const scroller = doc.querySelector(".reader-scroll"), center = { centerX: 17.123456, centerY: -24000.123456, zoom: 820 * READER_ACTUAL_SIZE_ZOOM };
    const sameCamera = (actual, expected, label) => {
      for (const key of ["centerX", "centerY", "zoom"]) close(actual[key], expected[key], `${label}: ${key}`);
    };
    reader.setView(center);
    sameCamera(reader.getView(), center, "integer DOM offsets do not round the precise camera");
    for (let i = 0; i < 5; i++) {
      scroller.emit("scroll"); env.flushFrames();
      sameCamera(reader.getView(), center, "programmatic scroll readback does not feed rounding back into the camera");
    }
    const saved = reader.snapshot();
    doc.querySelector('[data-reader="hide-toolbar"]').emit("click");
    sameCamera(reader.getView(), center, "hiding the toolbar retains the exact extreme zoom view");
    doc.querySelector('[data-reader="show-toolbar"]').emit("click");
    sameCamera(reader.getView(), center, "showing the toolbar retains the exact extreme zoom view");
    doc.querySelector('[data-reader="thumbnails"]').emit("click");
    sameCamera(reader.getView(), center, "resizing for thumbnails retains the exact extreme zoom view");
    reader.setLayout("grid"); reader.setLayout("reader");
    sameCamera(reader.getView(), center, "layout round trips retain the precise camera");
    doc.querySelector(".reader-zoom").value = "100%"; doc.querySelector(".reader-zoom").emit("change");
    reader.goToPage(0); reader.restore(saved);
    sameCamera(reader.getView(), center, "snapshot restoration retains the precise camera");
    env.replaceCanvas(); reader.canvasChanged();
    sameCamera(reader.getView(), center, "canvas replacement retains the precise camera");
    scroller.emit("scroll"); env.flushFrames();
    sameCamera(reader.getView(), center, "restored programmatic scroll events do not drift");

    const metrics = readerContentMetrics(rects, center.zoom, scroller.clientWidth, scroller.clientHeight);
    assert(metrics.surfaceWidth > scroller.scrollWidth && metrics.surfaceHeight > scroller.scrollHeight,
      "the test covers compressed scroll ranges on both axes");
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    const expectedMiddle = readerViewFromScroll(metrics, 0,
      scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight) * (metrics.surfaceHeight - metrics.height));
    scroller.emit("scroll"); env.flushFrames();
    close(reader.getView().centerY, expectedMiddle.centerY, "native thumb movement maps through the measured browser range");
    close(reader.getView().centerX, center.centerX, "vertical native scrolling keeps the precise horizontal camera");
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
    scroller.emit("scroll"); env.flushFrames();
    const expectedEnd = readerViewFromScroll(metrics, metrics.surfaceWidth - metrics.width, metrics.surfaceHeight - metrics.height);
    sameCamera(reader.getView(), expectedEnd, "native scrollbar endpoints reach the full document");
    assert.equal(doc.querySelector(".reader-page-number").value, "38", "scrolling to the end selects the final page");
    scroller.scrollLeft = scroller.scrollTop = 0; scroller.emit("scroll"); env.flushFrames();
    sameCamera(reader.getView(), readerViewFromScroll(metrics, 0, 0), "native scrollbar origin reaches the start");

    reader.setView(center);
    const canvas = env.canvas;
    canvas.emit("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 350, clientY: 400 });
    canvas.emit("pointermove", { pointerId: 1, pointerType: "touch", clientX: 320, clientY: 350 });
    close(reader.getView().centerX, center.centerX + 30 / center.zoom, "touch drag uses horizontal viewport pixels under compression");
    close(reader.getView().centerY, center.centerY - 50 / center.zoom, "touch drag uses vertical viewport pixels under compression");
    reader.cancelActiveGesture();
    reader.setView(center);
    const wheel = canvas.emit("wheel", { deltaX: 30, deltaY: 120 });
    assert(wheel.defaultPrevented, "compressed wheel scrolling replaces browser pixel deltas");
    close(reader.getView().centerX, center.centerX + 30 / center.zoom, "wheel uses horizontal viewport pixels under compression");
    close(reader.getView().centerY, center.centerY - 120 / center.zoom, "wheel uses vertical viewport pixels under compression");
    const beforeLines = reader.getView();
    canvas.emit("wheel", { deltaY: 3, deltaMode: 1 });
    close(reader.getView().centerY, beforeLines.centerY - 48 / center.zoom, "compressed wheel line deltas retain normal scroll distance");
    const beforePages = reader.getView();
    canvas.emit("wheel", { deltaX: 1, deltaY: 1, deltaMode: 2 });
    close(reader.getView().centerX, beforePages.centerX + beforePages.width / center.zoom,
      "compressed wheel page deltas use the horizontal viewport width");
    close(reader.getView().centerY, beforePages.centerY - beforePages.height / center.zoom,
      "compressed wheel page deltas use the vertical viewport height");
    const beforeKeys = reader.getView();
    scroller.emit("keydown", { key: "ArrowDown" });
    scroller.emit("keydown", { key: "ArrowRight" });
    close(reader.getView().centerX, beforeKeys.centerX + 40 / center.zoom, "keyboard uses horizontal viewport pixels under compression");
    close(reader.getView().centerY, beforeKeys.centerY - 40 / center.zoom, "keyboard uses vertical viewport pixels under compression");
    const beforePage = reader.getView();
    scroller.emit("keydown", { key: "PageDown" });
    close(reader.getView().centerY, beforePage.centerY - beforePage.height * .9 / center.zoom,
      "PageDown advances one viewport under compression");
    reader.dispose();
  }
  {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity:"toolbar-visibility",pageRects:pageRects(4) }); reader.setLayout("reader");
    reader.setView({centerX:0,centerY:-1000,zoom:2});
    const toolbar = doc.querySelector(".reader-toolbar"), scroller = doc.querySelector(".reader-scroll");
    const hide = doc.querySelector('[data-reader="hide-toolbar"]'), show = doc.querySelector('[data-reader="show-toolbar"]');
    assert(hide && show, "toolbar has hide and restore controls");
    assert.equal(toolbar.id, "reader-toolbar");
    assert.equal(show.getAttribute("aria-controls"), toolbar.id);
    assert.equal(hide.getAttribute("aria-controls"), toolbar.id); assert.equal(hide.getAttribute("aria-expanded"), "true");
    assert.equal(show.hidden, true); assert.equal(show.getAttribute("aria-expanded"), "false");
    assert.equal(hide.textContent, "Hide toolbar"); assert.equal(show.textContent, "Show toolbar");
    assert.equal(scroller.clientHeight, 736);
    const original = reader.getView(), visibleSnapshot = reader.snapshot();
    hide.focus(); hide.emit("click");
    assert.equal(toolbar.hidden, true); assert.equal(show.hidden, false);
    assert.equal(doc.activeElement, show, "hiding focuses the available restore control");
    assert.equal(show.getAttribute("aria-expanded"), "false");
    assert.equal(hide.getAttribute("aria-expanded"), "false");
    assert.equal(scroller.clientHeight, 800, "hiding the whole toolbar expands the document viewport");
    assert.equal(env.canvas.getBoundingClientRect().top, 0);
    assert.equal(env.canvas.style.height, "800px");
    const hiddenView = reader.getView();
    close(hiddenView.centerX, original.centerX, "hiding retains the document's horizontal center");
    close(hiddenView.centerY, original.centerY, "hiding retains the document's vertical center");
    close(hiddenView.zoom, original.zoom, "hiding retains explicit zoom");
    assert.equal(reader.snapshot().fit, null);
    const hiddenOffset = doc.documentElement.style.getPropertyValue("--reader-toolbar-height");
    assert.equal(hiddenOffset, "16px", "floating panels follow the collapsed toolbar offset");
    reader.setLayout("grid");
    assert(toolbar.hidden && !show.hidden, "toolbar visibility persists outside Reader");
    reader.setLayout("reader");
    close(reader.getView().centerY, original.centerY, "layout round trips retain the expanded viewport's reading position");
    reader.restore(visibleSnapshot);
    assert(toolbar.hidden && !show.hidden, "backend snapshot restoration preserves the current toolbar preference");
    close(reader.getView().centerY, original.centerY, "snapshot restoration retains the reading anchor while hidden");
    const oldCanvas = env.canvas; env.replaceCanvas(); reader.canvasChanged();
    assert(toolbar.hidden && !show.hidden, "replacing the rendering canvas preserves toolbar visibility");
    assert.equal(env.canvas.style.height, "800px");
    close(reader.getView().zoom, original.zoom, "canvas replacement retains explicit zoom");
    oldCanvas.emit("wheel", {ctrlKey:true,deltaY:-100,clientX:300,clientY:300});
    close(reader.getView().zoom, original.zoom, "hidden toolbar does not retain old canvas interaction handlers");
    show.emit("click");
    assert.equal(toolbar.hidden, false); assert.equal(show.hidden, true);
    assert.equal(doc.activeElement, hide, "restoring returns focus to the hide control");
    assert.equal(show.getAttribute("aria-expanded"), "true"); assert.equal(hide.getAttribute("aria-expanded"), "true");
    assert.equal(scroller.clientHeight, 736); assert.equal(env.canvas.getBoundingClientRect().top, 64);
    assert.equal(env.canvas.style.height, "736px");
    close(reader.getView().centerY, original.centerY, "restoring retains the document's vertical center");
    close(reader.getView().zoom, original.zoom, "restoring retains explicit zoom");
    assert.equal(doc.documentElement.style.getPropertyValue("--reader-toolbar-height"), "80px");
    hide.emit("click"); reader.setDocument({identity:"replacement-with-hidden-toolbar",pageRects:pageRects(2)});
    assert(toolbar.hidden && !show.hidden, "opening another document preserves toolbar visibility");
    assert.equal(scroller.clientHeight, 800); assert.equal(env.canvas.style.height, "800px");
    show.emit("click"); assert.equal(doc.activeElement, hide);
    reader.dispose();
  }
  for (const [action, mode] of [["fit-width","width"],["fit-page","page"]]) {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({identity:`toolbar-${mode}`,pageRects:pageRects(4)}); reader.setLayout("reader");
    reader.goToPage(1); doc.querySelector(`[data-reader="${action}"]`).emit("click");
    const original = reader.getView();
    doc.querySelector('[data-reader="hide-toolbar"]').emit("click");
    const expanded = reader.getView();
    close(expanded.centerX, original.centerX, `${mode} fit retains horizontal document center when toolbar hides`);
    close(expanded.centerY, original.centerY, `${mode} fit retains vertical document center when toolbar hides`);
    close(expanded.zoom, Math.min((700-48)/600, mode === "page" ? (800-48)/800 : Infinity),
      `${mode} fit uses the expanded viewport`);
    assert.equal(reader.snapshot().fit, mode, "toolbar visibility does not change fit mode");
    assert.equal(doc.querySelector(".reader-page-number").value, "2", "toolbar resizing retains the explicitly selected page");
    doc.querySelector('[data-reader="show-toolbar"]').emit("click");
    close(reader.getView().centerY, original.centerY, `${mode} fit restores the document center`);
    close(reader.getView().zoom, original.zoom, `${mode} fit restores the toolbar-height zoom`);
    assert.equal(reader.snapshot().fit, mode); assert.equal(doc.querySelector(".reader-page-number").value, "2");
    reader.dispose();
  }
  {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity: "pointer-and-keyboard", pageRects: pageRects(4) }); reader.setLayout("reader");
    reader.setView({ centerX:0,centerY:-1000,zoom:2 });
    const scroller = doc.querySelector(".reader-scroll"), canvas = env.canvas;
    const initial = reader.getView();
    const wheel = canvas.emit("wheel", {deltaY:100,clientX:350,clientY:300});
    assert(!wheel.defaultPrevented, "ordinary wheel events remain available to the native scrollbar");
    assert.deepEqual(reader.getView(), initial, "ordinary wheel does not change zoom directly");
    const oldMidpoint = {x:350,y:300}, nextMidpoint = {x:375,y:325}, bounds = canvas.getBoundingClientRect();
    const anchorX = initial.centerX + (oldMidpoint.x - bounds.left - initial.width/2)/initial.zoom;
    const anchorY = initial.centerY - (oldMidpoint.y - bounds.top - initial.height/2)/initial.zoom;
    canvas.emit("pointerdown", {pointerId:1,pointerType:"touch",clientX:250,clientY:300});
    canvas.emit("pointerdown", {pointerId:2,pointerType:"touch",clientX:450,clientY:300});
    canvas.emit("pointermove", {pointerId:2,pointerType:"touch",clientX:500,clientY:350});
    const pinched = reader.getView();
    close(pinched.zoom, initial.zoom * Math.hypot(250,50)/200, "pinch distance sets the zoom ratio");
    close(pinched.centerX + (nextMidpoint.x-bounds.left-pinched.width/2)/pinched.zoom, anchorX,
      "pinch translation and zoom keep the original midpoint's document X");
    close(pinched.centerY - (nextMidpoint.y-bounds.top-pinched.height/2)/pinched.zoom, anchorY,
      "pinch translation and zoom keep the original midpoint's document Y");
    reader.cancelActiveGesture();
    const beforeKey = scroller.scrollTop;
    scroller.focus(); const key = scroller.emit("keydown", {key:"ArrowDown"});
    assert(key.defaultPrevented); close(scroller.scrollTop,beforeKey+40,"focused reader keyboard scrolls the document");
    const input = doc.querySelector(".reader-zoom"); input.focus();
    const beforeInputKey = scroller.scrollTop;
    const inputKey = scroller.emit("keydown", {key:"ArrowDown",target:input});
    assert(!inputKey.defaultPrevented, "keyboard events originating from inputs are not intercepted");
    assert.equal(scroller.scrollTop, beforeInputKey);
    reader.setView({centerX:0,centerY:-1000,zoom:2});
    canvas.emit("pointerdown", {pointerId:3,pointerType:"touch",clientX:350,clientY:400});
    canvas.emit("pointermove", {pointerId:3,pointerType:"touch",clientX:350,clientY:350});
    const beforeFlick = scroller.scrollTop;
    canvas.emit("pointerup", {pointerId:3,pointerType:"touch",clientX:350,clientY:350});
    assert(!canvas.hasPointerCapture(3));
    env.flushFrames(performance.now()+16);
    assert(scroller.scrollTop > beforeFlick, "a released touch flick continues scrolling in its drag direction");
    reader.cancelActiveGesture(); assert.equal(env.frames.size,0,"gesture cancellation stops pending inertial scrolling");
    reader.dispose();
  }
  for (const edge of ["top", "bottom"]) {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({identity:`pinch-${edge}-edge`,pageRects:pageRects(4)}); reader.setLayout("reader");
    reader.setView({centerX:0,centerY:edge === "top" ? 0 : -3248,zoom:2});
    const scroller = doc.querySelector(".reader-scroll"), canvas = env.canvas, bounds = canvas.getBoundingClientRect();
    const initial = reader.getView();
    assert.equal(scroller.scrollTop, edge === "top" ? 0 : scroller.scrollHeight-scroller.clientHeight);
    const anchorX = initial.centerX + (350-bounds.left-initial.width/2)/initial.zoom;
    const anchorY = initial.centerY - (300-bounds.top-initial.height/2)/initial.zoom;
    canvas.emit("pointerdown", {pointerId:1,pointerType:"touch",clientX:250,clientY:300});
    canvas.emit("pointerdown", {pointerId:2,pointerType:"touch",clientX:450,clientY:300});
    const movedY = edge === "top" ? 350 : 250;
    canvas.emit("pointermove", {pointerId:2,pointerType:"touch",clientX:500,clientY:movedY});
    const pinched = reader.getView(), midpointY = (300+movedY)/2;
    close(pinched.zoom, initial.zoom*Math.hypot(250,50)/200, `${edge} edge pinch uses the finger distance`);
    close(pinched.centerX + (375-bounds.left-pinched.width/2)/pinched.zoom, anchorX,
      `${edge} edge applies pinch translation and zoom together horizontally`);
    close(pinched.centerY - (midpointY-bounds.top-pinched.height/2)/pinched.zoom, anchorY,
      `${edge} edge applies pinch translation and zoom together vertically`);
    reader.dispose();
  }
  {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({identity:"pinch-clamped-round-trip",pageRects:pageRects(10)}); reader.setLayout("reader");
    reader.setView({centerX:80,centerY:-5000,zoom:2});
    const initial = reader.getView(), scroller = doc.querySelector(".reader-scroll"), canvas = env.canvas;
    canvas.emit("pointerdown", {pointerId:1,pointerType:"touch",clientX:250,clientY:300});
    canvas.emit("pointerdown", {pointerId:2,pointerType:"touch",clientX:450,clientY:300});
    for (let round = 0; round < 3; round++) {
      for (const [pointerId,clientX,clientY] of [[1,300,330],[2,430,280],[1,348,300],[2,352,300]]) {
        canvas.emit("pointermove", {pointerId,pointerType:"touch",clientX,clientY});
      }
      assert.equal(scroller.scrollTop, 0, "zooming far out temporarily fits the entire document");
      assert.equal(scroller.scrollLeft, 0, "zooming far out temporarily fits the document width");
      if (round === 0) {
        canvas.emit("pointerdown", {pointerId:3,pointerType:"touch",clientX:500,clientY:500});
        canvas.emit("pointermove", {pointerId:3,pointerType:"touch",clientX:520,clientY:510});
        canvas.emit("pointerup", {pointerId:3,pointerType:"touch",clientX:520,clientY:510});
      }
      for (const [pointerId,clientX,clientY] of [[2,480,320],[1,220,280],[2,450,300],[1,250,300]]) {
        canvas.emit("pointermove", {pointerId,pointerType:"touch",clientX,clientY});
      }
      const restored = reader.getView();
      close(restored.zoom, initial.zoom, "returning both fingers restores the original zoom");
      close(restored.centerX, initial.centerX, "alternating finger moves restore horizontal focus after clamping");
      close(restored.centerY, initial.centerY, "alternating finger moves restore vertical focus after clamping");
    }
    reader.cancelActiveGesture();
    const cancelledView = reader.getView();
    canvas.emit("pointermove", {pointerId:1,pointerType:"touch",clientX:200,clientY:300});
    canvas.emit("pointerup", {pointerId:2,pointerType:"touch",clientX:450,clientY:300});
    env.flushFrames(performance.now()+16);
    assert.deepEqual(reader.getView(), cancelledView, "cancelled pinches ignore subsequent pointer events");
    assert(!canvas.hasPointerCapture(1) && !canvas.hasPointerCapture(2));
    reader.dispose();
  }
  {
    const env = environment(), reader = createReaderViewport(env.options);
    reader.setDocument({identity:"pinch-coincident-fingers",pageRects:pageRects(4)}); reader.setLayout("reader");
    reader.setView({centerX:0,centerY:-1000,zoom:2});
    const canvas = env.canvas, initial = reader.getView();
    canvas.emit("pointerdown", {pointerId:1,pointerType:"touch",clientX:350,clientY:300});
    canvas.emit("pointerdown", {pointerId:2,pointerType:"touch",clientX:350,clientY:300});
    canvas.emit("pointermove", {pointerId:1,pointerType:"touch",clientX:300,clientY:300});
    assert.deepEqual(reader.getView(), initial, "coincident fingers establish a finite baseline when they separate");
    canvas.emit("pointermove", {pointerId:2,pointerType:"touch",clientX:400,clientY:300});
    const expanded = reader.getView();
    close(expanded.zoom, initial.zoom*2, "a pinch starting at zero distance can zoom after separation");
    canvas.emit("pointermove", {pointerId:1,pointerType:"touch",clientX:400,clientY:300});
    assert.deepEqual(reader.getView(), expanded, "crossing through zero finger distance preserves the last valid view");
    canvas.emit("pointermove", {pointerId:1,pointerType:"touch",clientX:300,clientY:300});
    assert.deepEqual(reader.getView(), expanded, "separating again restores the same pinch focus and zoom");
    reader.cancelActiveGesture();
    env.flushFrames(performance.now()+16);
    assert.deepEqual(reader.getView(), expanded, "cancelling a degenerate pinch leaves its valid view stable");
    assert.equal(env.frames.size, 0);
    reader.dispose();
  }
  for (const firstLift of [1,2]) {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({identity:`pinch-lift-${firstLift}`,pageRects:pageRects(10)}); reader.setLayout("reader");
    reader.setView({centerX:0,centerY:-3000,zoom:2});
    const scroller = doc.querySelector(".reader-scroll"), canvas = env.canvas;
    canvas.emit("pointerdown", {pointerId:1,pointerType:"touch",clientX:250,clientY:300});
    canvas.emit("pointerdown", {pointerId:2,pointerType:"touch",clientX:450,clientY:300});
    canvas.emit("pointermove", {pointerId:2,pointerType:"touch",clientX:500,clientY:300});
    canvas.emit("pointerup", {pointerId:firstLift,pointerType:"touch",clientX:firstLift === 1 ? 250 : 500,clientY:300});
    const remaining = firstLift === 1 ? 2 : 1, clientX = remaining === 1 ? 250 : 500;
    canvas.emit("pointermove", {pointerId:remaining,pointerType:"touch",clientX,clientY:299});
    const beforeRelease = reader.getView();
    canvas.emit("pointerup", {pointerId:remaining,pointerType:"touch",clientX,clientY:299});
    env.flushFrames(performance.now()+16);
    assert.deepEqual(reader.getView(), beforeRelease, "lifting either finger after a pinch does not launch inertial scrolling");
    assert.equal(env.frames.size, 0, "pinch release does not leave an inertial scrolling frame");
    assert(!canvas.hasPointerCapture(1) && !canvas.hasPointerCapture(2));
    const beforeFlick = scroller.scrollTop;
    canvas.emit("pointerdown", {pointerId:3,pointerType:"touch",clientX:350,clientY:400});
    canvas.emit("pointermove", {pointerId:3,pointerType:"touch",clientX:350,clientY:390});
    canvas.emit("pointerup", {pointerId:3,pointerType:"touch",clientX:350,clientY:390});
    env.flushFrames(performance.now()+16);
    assert(scroller.scrollTop > beforeFlick+10, "a new single-finger gesture still produces normal flick inertia after a pinch");
    reader.dispose();
  }
  {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity: "one-page", pageRects: pageRects(1, 400) }); reader.setLayout("reader");
    assert.equal(doc.querySelector('[data-reader="previous"]').disabled, true);
    assert.equal(doc.querySelector('[data-reader="next"]').disabled, true);
    const scroller = doc.querySelector(".reader-scroll");
    scroller.emit("keydown", { key: "PageDown" }); assert.equal(scroller.scrollTop, 0, "short documents need no vertical scrolling");
    assert(Object.values(reader.getView()).every(Number.isFinite)); reader.dispose();
  }
  {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity: "mixed-page-heights", pageRects: Float32Array.of(
      -300,-800,300,0, -300,-916,300,-816, -300,-1732,300,-932) });
    reader.setLayout("reader"); reader.goToPage(1);
    const scroller = doc.querySelector(".reader-scroll"); scroller.emit("scroll"); env.flushFrames();
    assert.equal(doc.querySelector(".reader-page-number").value, "2", "fit-width navigation keeps a short target page active after its scroll frame");
    const rows = doc.querySelector(".reader-thumbnails").children;
    assert.equal(rows[1].getAttribute("aria-current"), "page");
    assert.equal(rows[2].getAttribute("aria-current"), null, "the next tall page at viewport center does not steal the short page's readout");
    reader.dispose();
  }
  const clampedNavigation = [];
  for (const [identity, rects, target] of [
    ["short-final-page", Float32Array.of(-300,-800,300,0, -300,-916,300,-816), 1],
    ["all-pages-fit", pageRects(3,100), 1]
  ]) {
    const env = environment(), reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity, pageRects: rects }); reader.setLayout("reader"); reader.goToPage(target);
    const scroller = doc.querySelector(".reader-scroll"); scroller.emit("scroll"); env.flushFrames();
    const rows = doc.querySelector(".reader-thumbnails").children;
    clampedNavigation.push({ identity, page: doc.querySelector(".reader-page-number").value,
      active: rows.flatMap((row,index) => row.getAttribute("aria-current") === "page" ? [index] : []) });
    if (identity === "short-final-page") {
      scroller.scrollTop -= 100; scroller.emit("scroll"); env.flushFrames();
      assert.equal(doc.querySelector(".reader-page-number").value, "1", "actual scrolling clears the explicit short-page selection");
      assert.equal(rows[0].getAttribute("aria-current"), "page");
      assert.equal(rows[1].getAttribute("aria-current"), null);
    } else {
      const saved = reader.snapshot();
      reader.goToPage(0); reader.restore(saved);
      scroller.emit("scroll"); env.flushFrames();
      assert.equal(doc.querySelector(".reader-page-number").value, "2", "snapshot restore retains an explicitly selected tiny page when every page fits");
      assert.equal(rows[1].getAttribute("aria-current"), "page");
      assert.equal(rows[0].getAttribute("aria-current"), null);
    }
    reader.dispose();
  }
  assert.deepEqual(clampedNavigation, [
    { identity:"short-final-page",page:"2",active:[1] }, { identity:"all-pages-fit",page:"2",active:[1] }
  ], "explicit page navigation survives clamped or unnecessary scrolling and its RAF");
  {
    const env = environment(1000), reader = createReaderViewport(env.options), doc = env.document;
    env.preview = page => page === 0 ? Promise.reject(Error("unavailable thumbnail")) : Promise.resolve(pageScene(`book-${page}`));
    const originalWarn = console.warn; console.warn = () => {};
    try {
      reader.setDocument({ identity: "thumbnails", pageRects: pageRects(100) });
      assert.equal(env.requests.length, 0); reader.setLayout("reader");
      await until(() => env.requests.length >= 5 && gpu.copies.some(copy => copy.copiedFrame.tag === "book-4"));
      const sidebar = doc.querySelector(".reader-thumbnails"), first = sidebar.children[0];
      assert(first.classList.contains("reader-thumbnail-failed"));
      assert(env.requests.every(request => request.page < 10), "only nearby thumbnail rows request content");
      const image = sidebar.children[1].querySelector(".reader-thumbnail-image").children[0];
      assert(image, "successful neighboring pages still produce thumbnails");
      assert.deepEqual([image.width,image.height], [240,320], "thumbnail backing size follows device pixel ratio");
      assert.equal(image.copiedFrame.padding, 0, "tiny previews fill their canvas instead of using document-view padding");
      assert.equal(image.copiedFrame.external, true);
      assert.deepEqual(image.copiedFrame.background, [.2,.3,.4,1]);
      assert.deepEqual(image.copiedFrame.vector, [.8,.7,.6,.5]);
      assert.equal(gpu.instances.filter(renderer => !renderer.disposed).length, 1, "visible thumbnails reuse one scratch GPU context");
      first.emit("click"); assert.equal(doc.querySelector(".reader-page-number").value, "1", "failed previews remain navigable");
      sidebar.scrollTop = 50 * 204; sidebar.emit("scroll");
      assert.equal(image.width, 0); assert.equal(image.height, 0, "offscreen thumbnail pixels are released");
      await until(() => env.requests.some(request => request.page > 40));
    } finally { reader.dispose(); console.warn = originalWarn; }
  }
  {
    const env = environment(1000), pending = deferred(); let old = true;
    env.preview = page => old ? pending.promise : Promise.resolve(pageScene(`replacement-${page}`));
    const reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity: "old-book", pageRects: pageRects(2) }); reader.setLayout("reader");
    assert.equal(env.requests.length, 1);
    const oldRequest = env.requests[0], copiesBefore = gpu.copies.length;
    old = false; reader.setDocument({ identity: "new-book", pageRects: pageRects(2) });
    assert(oldRequest.signal.aborted, "replacing a document cancels its pending thumbnail");
    pending.resolve(pageScene("stale-old-book"));
    await until(() => gpu.copies.length > copiesBefore);
    assert(gpu.copies.slice(copiesBefore).every(copy => copy.copiedFrame.tag.startsWith("replacement-")), "stale thumbnail completions cannot attach to the new document");
    reader.dispose();
  }
  {
    const env = environment(1000), pending = deferred(); env.preview = () => pending.promise;
    const reader = createReaderViewport(env.options), doc = env.document;
    reader.setDocument({ identity: "hidden-sidebar", pageRects: pageRects(2) }); reader.setLayout("reader");
    const request = env.requests[0], copiesBefore = gpu.copies.length;
    doc.querySelector('[data-reader="thumbnails"]').emit("click"); assert(request.signal.aborted);
    pending.resolve(pageScene("hidden")); await tick(); await tick();
    assert.equal(gpu.copies.length, copiesBefore, "hiding the sidebar prevents pending work from reaching the GPU");
    reader.dispose();
  }
  {
    const env = environment(1000), reader = createReaderViewport(env.options), doc = env.document;
    const copiesBefore = gpu.copies.length;
    reader.setDocument({ identity: "scratch-first", pageRects: pageRects(1) }); reader.setLayout("reader");
    await until(() => gpu.copies.length > copiesBefore);
    const first = gpu.instances.at(-1);
    reader.setDocument({ identity: "scratch-replacement", pageRects: pageRects(1) });
    assert(first.disposed, "document replacement releases the old scratch scene and GPU resources");
    assert.equal(first.canvas.width, 0); assert.equal(first.canvas.height, 0);
    await until(() => gpu.instances.at(-1) !== first && gpu.copies.length > copiesBefore + 1);
    const second = gpu.instances.at(-1), thumbnail = gpu.copies.at(-1);
    doc.querySelector('[data-reader="thumbnails"]').emit("click");
    assert(second.disposed, "closing the sidebar releases its scratch renderer");
    assert.equal(second.canvas.width, 0); assert.equal(second.canvas.height, 0);
    assert.equal(thumbnail.width, 0); assert.equal(thumbnail.height, 0);
    reader.dispose();
  }
  {
    const { openPdf } = await import("../src/pdfSession.ts");
    const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number:1,body:"<< /Type /Catalog /Pages 2 0 R >>" },
      { number:2,body:"<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number:3,body:"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 12 10] /Resources << >> /Contents 4 0 R >>" },
      { number:4,body:tinyPdfStream("", "1 0 0 rg 1 1 4 4 re f 0 0 1 rg 7 1 4 4 re f") }
    ] }) });
    let page;
    try { page = await session.compilePage(0, { optimization: "none" }); } finally { await session.close(); }
    const commands = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands;
    commands[0].optionalContentIndex = 0; commands[1].optionalContentIndex = 1;
    page.stores.optionalContent = { names:["A","B"],defaultVisible:Uint8Array.of(1,0) };
    const scene = createEmptyVectorScene();
    scene.tag = "retained-layer-preview"; scene.pageCount = 1; scene.pageRects = Float32Array.of(0,0,12,10);
    scene.bounds = scene.pageBounds = { minX:0,minY:0,maxX:12,maxY:10 };
    scene.rasterLayers = [{ width:1,height:1,data:Uint8Array.of(255,0,0,255),matrix:Float32Array.of(12,0,0,10,0,0),pageIndex:0,paintOrder:0 }];
    scene.drawRuns = [{ kind:"raster",first:0,count:1 }];
    scene.paintGraph = { roots:[{kind:"retained",retainedPage:0,firstCommand:0,count:2,rasterIndex:0}] };
    scene.retainedPages = [{ page,optionalContentConditions:Int32Array.of(0,1),matrix:Float32Array.of(1,0,0,1,0,0) }];
    scene.optionalContent = { groups:["A","B"].map((id,i) => ({id,name:id,defaultVisible:i===0,locked:false,usedInView:true})),
      conditions:[{kind:"group",groupId:"A"},{kind:"group",groupId:"B"}],order:[],radioGroups:[] };
    const env = environment(1000); env.preview = () => Promise.resolve(scene);
    env.options.configureThumbnailRenderer = renderer => renderer.setOptionalContentVisibility({revision:1,
      layers:[{id:"A",visible:false},{id:"B",visible:true}],conditions:Uint8Array.of(0,1)});
    const reader = createReaderViewport(env.options), copiesBefore = gpu.copies.length;
    try {
      reader.setDocument({ identity:"retained-layers",pageRects:scene.pageRects }); reader.setLayout("reader");
      await until(() => gpu.copies.length > copiesBefore);
      const replayed = gpu.copies.at(-1).copiedFrame.replayedPixels;
      assert.deepEqual([...replayed.slice(0,3)], [0,0,255],
        "changed retained layer visibility is replayed and uploaded before GPU-to-2D copying");
      assert(replayed[3] > 0, "replayed blue content is visible");
      assert.deepEqual([...scene.rasterLayers[0].data], [255,0,0,255], "thumbnail replay preserves canonical document pixels");
    } finally { reader.dispose(); }
  }
  console.log("Reader viewport: bounded scroll/camera mapping, animated internal links, extreme zoom and rounded offsets, toolbar visibility, zoom anchors, sidebar/layout restore, gestures, canvas replacement, lazy thumbnails, cancellation, local failures and GPU-to-2D copies passed.");
} finally {
  globalThis.ResizeObserver = previousObserver; delete globalThis.__readerViewportGpu; hooks.deregister();
}
