import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const previous = Object.fromEntries(["requestAnimationFrame", "cancelAnimationFrame", "performance"]
  .map(key => [key, globalThis[key]]));
let now = 0, nextHandle = 1;
let callbacks = new Map();
const settle = () => new Promise(resolve => setImmediate(resolve));
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = callback => { callbacks.set(nextHandle, callback); return nextHandle++; };
globalThis.cancelAnimationFrame = handle => callbacks.delete(handle);
const tick = async () => {
  now += 4;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(now);
  await settle();
};
const runToCompletion = async promise => {
  let complete = false;
  promise.then(() => { complete = true; }, () => { complete = true; });
  for (let index = 0; index < 100 && !complete; index++) await tick();
  assert(complete, "warm-up must finish without leaving an idle render loop running");
  return promise;
};

try {
  const { warmViewerRendering } = await import("../src/viewerRenderWarmup.ts");
  const { waitForLoad, yieldForLoad } = await import("../src/loadCancellation.ts");
  const nativeSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const threeSource = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
  class WebGlFloorplanRenderer {
    serial = 0;
    requests = 0;
    pending = false;
    blocked = false;
    getPresentedFrameSerial() { return this.serial; }
    requestFrame() {
      this.requests++;
      assert.equal(this.pending, false, "warm-up does not bypass native pacing with another pending frame");
      this.pending = true;
      if (!this.blocked) requestAnimationFrame(() => { this.serial++; this.pending = false; });
    }
    renderExternalFrame() { assert.fail("warm-up must preserve native frame pacing"); }
  }
  class WebGpuFloorplanRenderer extends WebGlFloorplanRenderer {}
  for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
    now = 0; callbacks.clear();
    const target = new Renderer();
    const host = vm.createContext({ warmViewerRendering, yieldForLoad, AbortController,
      WebGlFloorplanRenderer, webGpuRendererClass: WebGpuFloorplanRenderer, renderer: target });
    vm.runInContext(sourceFunction(nativeSource, "warmNativeRenderer"), host);
    await runToCompletion(host.warmNativeRenderer(target, new AbortController().signal));
    assert.equal(target.requests, 12);
    assert.equal(target.serial, 12, "native warm-up awaits presented frames instead of counting requests");
    assert.equal(callbacks.size, 0);

    now = 0;
    target.blocked = true;
    const controller = new AbortController();
    const reason = new Error("new native document");
    const warming = host.warmNativeRenderer(target, controller.signal);
    await tick(); await tick(); await tick();
    assert.equal(target.requests, 13, "a slow native frame does not cause further submissions");
    controller.abort(reason);
    await assert.rejects(warming, error => error === reason);
    assert.equal(callbacks.size, 0, "cancelled serial polling stops requesting RAF callbacks");
  }

  now = 0; callbacks.clear();
  const nativeHost = vm.createContext({ warmViewerRendering, yieldForLoad,
    WebGlFloorplanRenderer, webGpuRendererClass: WebGpuFloorplanRenderer, renderer: {} });
  vm.runInContext(sourceFunction(nativeSource, "warmNativeRenderer"), nativeHost);
  await nativeHost.warmNativeRenderer(nativeHost.renderer, new AbortController().signal);
  assert.equal(callbacks.size, 0, "other native renderer types are left to their own load lifecycle");

  for (const gpu of [false, true]) {
    now = 0; callbacks.clear();
    let frames = 0, queueWaits = 0, pending = false;
    const target = gpu ? { backend: { device: { queue: { onSubmittedWorkDone: async () => {
      assert.equal(frames, 12, "GPU completion is awaited after all warm frames are submitted");
      queueWaits++;
    } } } } } : {};
    const host = vm.createContext({ warmViewerRendering, waitForLoad, renderer: target, loadToken: 1,
      pendingRenderedFrameResolvers: [], requestRender: () => {
        assert.equal(pending, false);
        pending = true;
        requestAnimationFrame(() => { pending = false; frames++; host.resolveRenderedFrameWaiters(); });
      } });
    for (const name of ["waitForNextRenderedFrame", "resolveRenderedFrameWaiters", "warmThreeRenderer"])
      vm.runInContext(sourceFunction(threeSource, name), host);
    await runToCompletion(host.warmThreeRenderer(1, new AbortController().signal));
    assert.equal(frames, 12);
    assert.equal(queueWaits, gpu ? 1 : 0);
    assert.equal(host.pendingRenderedFrameResolvers.length, 0);
    assert.equal(callbacks.size, 0);

    const beforeStaleWarm = frames;
    await runToCompletion(host.warmThreeRenderer(0, new AbortController().signal));
    assert.equal(frames, beforeStaleWarm, "stale load tokens do not render a replacement document");
    assert.equal(queueWaits, gpu ? 1 : 0, "stale warming cannot wait on a replaced GPU queue");

    const controller = new AbortController();
    const reason = new Error("new Three document");
    const warming = host.warmThreeRenderer(1, controller.signal);
    await tick();
    assert.equal(host.pendingRenderedFrameResolvers.length, 1);
    controller.abort(reason);
    await assert.rejects(warming, error => error === reason);
    // The already requested renderer frame can still finish; its old waiter
    // then drains without resuming the cancelled warm-up.
    await tick();
    assert.equal(frames, beforeStaleWarm + 1);
    assert.equal(queueWaits, gpu ? 1 : 0);
    assert.equal(host.pendingRenderedFrameResolvers.length, 0);
    assert.equal(callbacks.size, 0);
  }
  console.log("Native/Three load warm-up integration: presented-frame pacing, cancellation, backend completion and stale tokens passed");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  hooks.deregister();
}
