import assert from "node:assert/strict";
import { compileDensePdfContent as compileDense } from "../src/densePdfContentCompiler.ts";
import { compileDensePdfContent as compileNative } from "../src/pdf/nativeContentCompiler.ts";

const encoder = new TextEncoder();
const options = {
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  textOperatorSink: { applyOperator() {} },
  enableSegmentMerge: false,
  enableInvisibleCull: true
};

for (const compile of [compileDense, compileNative]) {
  const originals = {
    Float32Array: globalThis.Float32Array,
    Uint32Array: globalThis.Uint32Array,
    MessageChannel: globalThis.MessageChannel,
    setTimeout: globalThis.setTimeout
  };
  let allocatedBytes = 0;
  let openedPorts = 0;
  let closedPorts = 0;
  try {
    // Count backing allocations, including stores that GC frees during the
    // compile. A retained-heap snapshot misses the per-page allocation churn.
    for (const name of ["Float32Array", "Uint32Array"]) {
      globalThis[name] = class extends originals[name] {
        constructor(...args) {
          super(...args);
          if (!(args[0] instanceof ArrayBuffer)) allocatedBytes += this.byteLength;
        }
      };
    }
    globalThis.MessageChannel = class extends originals.MessageChannel {
      constructor() {
        super();
        for (const port of [this.port1, this.port2]) {
          openedPorts += 1;
          const close = port.close.bind(port);
          port.close = () => { closedPorts += 1; close(); };
        }
      }
    };
    globalThis.setTimeout = () => {
      throw new Error("Parser checkpoints must not accumulate nested-timer delays.");
    };

    const progress = [];
    const text = await compile(encoder.encode("BT /F1 12 Tf (Hello) Tj ET"), {
      ...options,
      onProgress: (event) => progress.push(event.phase)
    });
    assert.equal(text.textShowOpCount, 1);
    assert.equal(text.segmentCount, 0);
    assert.equal(text.fillPathCount, 0);
    assert.ok(allocatedBytes < 64 * 1024,
      `Text-only compilation allocated ${allocatedBytes} bytes of geometry buffers.`);
    assert.ok(progress.includes("finalizing"));
    assert.ok(openedPorts > 0, "compilation still yields to a host task");
    assert.equal(closedPorts, openedPorts, "checkpoints release their message ports");

    // Deferred allocation must still initialize duplicate detection correctly
    // on the first stroke and keep independent state in the next compilation.
    for (let page = 0; page < 2; page += 1) {
      const painted = await compile(encoder.encode(
        "2 w 10 10 m 90 10 l S 10 10 m 90 10 l S 20 20 10 10 re f"
      ), options);
      assert.equal(painted.segmentCount, 1);
      assert.equal(painted.discardedDuplicateCount, 1);
      assert.equal(painted.fillPathCount, 1);
    }
    assert.equal(closedPorts, openedPorts);

    const controller = new AbortController();
    await assert.rejects(compile(encoder.encode(""), {
      ...options,
      signal: controller.signal,
      onProgress: () => controller.abort(new Error("cancel at checkpoint"))
    }), /cancel at checkpoint/);
    assert.equal(closedPorts, openedPorts, "cancellation releases message ports");

    globalThis.MessageChannel = undefined;
    let timers = 0;
    globalThis.setTimeout = (...args) => {
      timers += 1;
      return originals.setTimeout(...args);
    };
    await compile(encoder.encode(""), options);
    assert.ok(timers > 0, "hosts without message ports retain the timer fallback");
  } finally {
    Object.assign(globalThis, originals);
  }
}

console.log("Text parser allocation and cooperative scheduling tests passed.");
