import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const previous = Object.fromEntries(["requestAnimationFrame", "cancelAnimationFrame", "performance"]
  .map(key => [key, globalThis[key]]));
let now = 0, nextHandle = 1;
let callbacks = new Map();
const cancelled = [];
const settle = () => new Promise(resolve => setImmediate(resolve));
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = callback => { callbacks.set(nextHandle, callback); return nextHandle++; };
globalThis.cancelAnimationFrame = handle => { cancelled.push(handle); callbacks.delete(handle); };
const tick = async (elapsed = 4) => {
  now += elapsed;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(now);
  await settle();
};
const reset = () => { now = 0; callbacks.clear(); cancelled.length = 0; };

try {
  const { warmViewerRendering } = await import("../src/viewerRenderWarmup.ts");
  {
    const order = [];
    const warm = warmViewerRendering({ renderFrame: async () => { order.push("frame"); },
      waitForGpu: async () => { order.push("gpu"); } });
    for (let index = 0; index < 12; index++) {
      assert.equal(callbacks.size, 1, "warm-up yields before each frame instead of submitting a synchronous burst");
      await tick();
    }
    assert.equal(await warm, 12);
    assert.deepEqual(order, [...Array(12).fill("frame"), "gpu"],
      "GPU completion follows all frames without serializing their submissions");
    assert.equal(callbacks.size, 0, "warm-up stops instead of leaving an idle animation loop running");
  }
  reset();
  {
    let frames = 0, gpuWaits = 0;
    const warm = warmViewerRendering({ renderFrame: () => { frames++; now += 100; },
      waitForGpu: () => { gpuWaits++; } });
    await tick(0); await tick(0); await tick(0);
    assert.equal(await warm, 3, "slow synchronous frames consume the time budget");
    assert.equal(frames, 3);
    assert.equal(gpuWaits, 0, "an exhausted budget does not add a completion wait");
    assert.equal(callbacks.size, 0);
  }
  reset();
  {
    const controller = new AbortController();
    const reason = new Error("new document");
    controller.abort(reason);
    await assert.rejects(warmViewerRendering({ signal: controller.signal,
      renderFrame: () => assert.fail("an aborted warm-up cannot render") }), error => error === reason);
    assert.equal(callbacks.size, 0);
  }
  reset();
  {
    const controller = new AbortController();
    const reason = new Error("cancel loading");
    const warm = warmViewerRendering({ signal: controller.signal,
      renderFrame: () => assert.fail("cancelled animation frames cannot render") });
    controller.abort(reason);
    await assert.rejects(warm, error => error === reason);
    assert.equal(callbacks.size, 0, "cancellation removes a pending RAF");
    assert.equal(cancelled.length, 1);
  }
  reset();
  {
    const controller = new AbortController();
    const reason = new Error("renderer replaced");
    let finishRender, frames = 0;
    const warm = warmViewerRendering({ signal: controller.signal, renderFrame: () => {
      frames++;
      return new Promise(resolve => { finishRender = resolve; });
    } });
    await tick();
    controller.abort(reason);
    await assert.rejects(warm, error => error === reason);
    finishRender(); await settle();
    assert.equal(frames, 1);
    assert.equal(callbacks.size, 0, "a late render completion cannot restart a cancelled warm-up");
  }
  reset();
  {
    const failure = new Error("render failed");
    const warm = warmViewerRendering({ renderFrame: () => { throw failure; } });
    const rejected = assert.rejects(warm, error => error === failure);
    await tick();
    await rejected;
    assert.equal(callbacks.size, 0);
  }
  reset();
  {
    const controller = new AbortController();
    const reason = new Error("cancel GPU preparation");
    let finishGpu, gpuSignal;
    const warm = warmViewerRendering({ signal: controller.signal, renderFrame: () => {},
      waitForGpu: signal => {
        gpuSignal = signal;
        return new Promise(resolve => { finishGpu = resolve; });
      } });
    for (let index = 0; index < 12; index++) await tick();
    controller.abort(reason);
    await assert.rejects(warm, error => error === reason);
    assert.equal(gpuSignal.aborted, true, "the completion callback receives cancellation for its own waits");
    assert.equal(gpuSignal.reason, reason);
    finishGpu(); await settle();
    assert.equal(callbacks.size, 0);
  }
  reset();
  {
    let finishGpu;
    const warm = warmViewerRendering({ renderFrame: () => {},
      waitForGpu: () => new Promise(resolve => { finishGpu = resolve; }) });
    for (let index = 0; index < 12; index++) await tick();
    assert.equal(await warm, 12, "pending GPU work cannot hold loading open past the wall-clock limit");
    finishGpu(); await settle();
    assert.equal(callbacks.size, 0);
  }
  reset();
  {
    const warm = warmViewerRendering({ renderFrame: () => assert.fail("a suspended RAF cannot render") });
    assert.equal(await warm, 0, "an inactive tab still finishes a bounded warm-up");
    assert.equal(callbacks.size, 0);
    assert.equal(cancelled.length, 1);
  }
  console.log("Viewer render warm-up: bounded frames, wall-clock timeout, GPU completion and cancellation passed");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  hooks.deregister();
}
