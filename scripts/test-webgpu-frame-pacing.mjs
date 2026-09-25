import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const globals = Object.fromEntries(["requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, globalThis[key]]));

try {
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  let callbacks = new Map(), nextHandle = 1;
  globalThis.requestAnimationFrame = callback => { callbacks.set(nextHandle, callback); return nextHandle++; };
  globalThis.cancelAnimationFrame = handle => { callbacks.delete(handle); };
  const runAnimationFrame = timestamp => {
    const pending = [...callbacks.values()];
    callbacks = new Map();
    for (const callback of pending) callback(timestamp);
    return pending.length;
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));

  const create = ({ workDone = true } = {}) => {
    const gpu = [];
    const renderer = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), {
      rafHandle: 0, externalFrameDriver: false, externalFramePending: false, isDisposed: false,
      gpuFrameInFlight: false, framePendingOnGpu: false,
      gpuDevice: { queue: workDone ? {
        onSubmittedWorkDone: () => new Promise((resolve, reject) => { gpu.push({ resolve, reject }); })
      } : {} }
    });
    const frames = [];
    renderer.render = function (timestamp) {
      frames.push(timestamp);
      // A damped camera keeps requesting frames from inside render.
      if (this.animating) this.requestFrame();
      if (this.throwOnRender) throw new Error("render failed");
    };
    return { renderer, frames, gpu };
  };

  {
    const { renderer, frames, gpu } = create();
    renderer.animating = true;
    renderer.requestFrame();
    assert.equal(callbacks.size, 1, "an idle GPU schedules the next animation frame immediately");
    assert.equal(runAnimationFrame(16), 1);
    assert.deepEqual(frames, [16]);
    assert.equal(gpu.length, 1, "every animation frame waits for its submitted GPU work");
    assert.equal(callbacks.size, 0, "an animation continued during render waits for that frame's GPU work");
    renderer.requestFrame();
    renderer.requestFrame();
    assert.equal(callbacks.size, 0, "input while the GPU is busy does not queue further frames");
    assert.equal(runAnimationFrame(33), 0);
    assert.deepEqual(frames, [16], "no frame starts while the previous one is still on the GPU");

    gpu.shift().resolve();
    await settle();
    assert.equal(callbacks.size, 1, "finishing the GPU work schedules exactly one pending frame");
    renderer.animating = false;
    runAnimationFrame(50);
    assert.deepEqual(frames, [16, 50], "the next frame renders the latest state once");
    gpu.shift().resolve();
    await settle();
    assert.equal(callbacks.size, 0, "a finished frame with nothing requested leaves the loop idle");
    renderer.requestFrame();
    assert.equal(callbacks.size, 1, "a later request after the GPU is idle is immediate");
    runAnimationFrame(66);
    assert.equal(gpu.length, 1);

    renderer.requestFrame();
    gpu.shift().reject(new Error("device lost"));
    await settle();
    assert.equal(callbacks.size, 1, "a rejected completion still releases the frame loop");
    runAnimationFrame(83);

    renderer.throwOnRender = true;
    renderer.requestFrame();
    gpu.shift().resolve();
    await settle();
    assert.throws(() => runAnimationFrame(100), /render failed/);
    assert.equal(gpu.length, 1, "a failed render still waits for the work it may have submitted");
    renderer.throwOnRender = false;
    renderer.requestFrame();
    gpu.shift().resolve();
    await settle();
    assert.equal(callbacks.size, 1, "the loop recovers after a failed render");
    runAnimationFrame(116);

    renderer.requestFrame();
    renderer.isDisposed = true;
    gpu.shift().resolve();
    await settle();
    assert.equal(callbacks.size, 0, "a disposed renderer schedules nothing when its GPU work finishes");
  }

  {
    const { renderer, gpu } = create();
    renderer.requestFrame();
    runAnimationFrame(16);
    renderer.requestFrame();
    renderer.setExternalFrameDriver(true);
    assert.equal(renderer.externalFramePending, true);
    renderer.externalFramePending = false;
    gpu.shift().resolve();
    await settle();
    assert.equal(callbacks.size, 0, "an external frame driver owns pacing once the GPU finishes");
    assert.equal(renderer.externalFramePending, true, "the pending request passes to the external driver");
  }

  {
    const { renderer, frames } = create({ workDone: false });
    renderer.animating = true;
    renderer.requestFrame();
    runAnimationFrame(16);
    await settle();
    assert.equal(callbacks.size, 1, "without completion tracking the loop keeps its previous behavior");
    renderer.animating = false;
    runAnimationFrame(33);
    assert.deepEqual(frames, [16, 33]);
  }

  console.log("Native WebGPU frame pacing: one frame in flight, coalesced requests, failures and handoff passed");
} finally {
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  hooks.deregister();
}
