import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(import.meta.resolve("@paddleocr/paddleocr-js"));
const cv = require("@techstark/opencv-js");
const sdkSource = await readFile(new URL("../node_modules/@paddleocr/paddleocr-js/dist/index.mjs", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/viewerPaddleOcrWorker.ts", import.meta.url), "utf8");
const sourceToMatHost = vm.createContext({
  sourceToImageBitmap() { assert.fail("The dedicated OCR worker must use the SDK's Mat clone path, without DOM canvases."); }
});
vm.runInContext(sourceFunction(sdkSource, "sourceToMat"), sourceToMatHost);
const sessionHost = vm.createContext({ Error });
vm.runInContext(sourceFunction(sdkSource, "getProviderCandidates") + "\n" + sourceFunction(sdkSource, "createSession"), sessionHost);
const attempts = [];
const selected = await sessionHost.createSession({ InferenceSession: { async create(_model, options) {
  attempts.push(options.executionProviders[0]);
  if (options.executionProviders[0] === "webgpu") throw new Error("Operator is not supported by this GPU");
  return { release: async () => {} };
} } }, Uint8Array.of(1), sessionHost.getProviderCandidates("auto", { available: true, reason: "" }));
assert.deepEqual(attempts, ["webgpu", "wasm"], "installed SDK auto mode retries model creation on CPU when GPU operators are unavailable");
assert.equal(selected.provider, "wasm");

// The pinned OpenCV runtime is a legacy thenable that resolves to itself.
// A direct await recursively assimilates it forever even after Mat is ready.
assert.equal(cv instanceof Promise, false);
assert.equal(typeof cv.then, "function");
await new Promise(resolve => {
  if (cv.Mat) resolve();
  else cv.onRuntimeInitialized = () => resolve();
});
const decodeHost = vm.createContext({ Uint8Array,
  DET_BOX_MIN_SIZE: 3,
  getMiniBoxFromPoints() { assert.fail("An empty probability map cannot contain a text contour."); }
});
vm.runInContext(sourceFunction(sdkSource, "getDetMap") + "\n" + sourceFunction(sdkSource, "decodeDetOutput"), decodeHost);
for (const value of [0, Number.NaN]) {
  const boxes = decodeHost.decodeDetOutput({ cv, config: { postprocess: { maxCandidates: 1000 } } },
    { dims: [1, 1, 4, 4], data: new Float32Array(16).fill(value) }, { srcW: 4, srcH: 4 }, .3, .6, 2);
  assert.equal(boxes.length, 0, "installed SDK postprocessing cannot distinguish empty and nonfinite GPU maps from a genuinely blank scan");
}
const originalThen = cv.then;
cv.then = () => { throw new Error("Do not await OpenCV's self-resolving thenable."); };

// Exercise the pinned SDK's real preprocessing, polygon mapping and cropping.
// Reducing detection work must not shrink the source used to read each line.
const geometryHost = vm.createContext({ Uint8Array, Float32Array, DET_BOX_MIN_SIZE: 3,
  ClipperLib: sdkRequire("clipper-lib") });
for (const name of ["clamp", "distance2", "orderQuad", "getMiniBoxFromPoints", "polygonArea", "polygonPerimeter",
  "chooseMaxAreaPath", "unclip", "boxScoreFast", "getDetMap", "decodeDetOutput", "toBgrFloatCHWFromBgr",
  "preprocessSample\\$1", "cropByPoly"]) {
  vm.runInContext(sourceFunction(sdkSource, name), geometryHost);
}
const sourceMat = new cv.Mat(192, 320, cv.CV_8UC4);
sourceMat.data.fill(255);
for (let y = 48; y < 96; y++) for (let x = 80; x < 240; x++) {
  if (x % 8 < 4) sourceMat.data.set([0, 0, 0, 255], (y * sourceMat.cols + x) * 4);
}
const sourceSnapshot = sourceMat.data.slice();
const prepared = geometryHost.preprocessSample$1({ cv, ort: { Tensor: class {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
} }, config: { normalize: { scale: 1 / 255, mean: [0, 0, 0], std: [1, 1, 1] } } }, sourceMat,
  { limitType: "max", limitSideLen: 96, maxSideLimit: 96 });
assert.deepEqual(Array.from(prepared.tensor.dims), [1, 3, 64, 96], "only the detector tensor uses the reduced image");
const probabilities = new Float32Array(64 * 96);
for (let y = 16; y < 32; y++) for (let x = 24; x < 72; x++) probabilities[y * 96 + x] = 1;
const boxes = geometryHost.decodeDetOutput({ cv, config: { postprocess: { maxCandidates: 1000 } } },
  { dims: [1, 1, 64, 96], data: probabilities }, prepared, .3, .6, 0);
assert.equal(boxes.length, 1);
const detectorBoxes = geometryHost.decodeDetOutput({ cv, config: { postprocess: { maxCandidates: 1000 } } },
  { dims: [1, 1, 64, 96], data: probabilities }, { srcW: 96, srcH: 64 }, .3, .6, 0);
for (let point = 0; point < 4; point++) {
  assert(Math.abs(boxes[0].poly[point][0] - detectorBoxes[0].poly[point][0] * 320 / 96) <= 1,
    "detector polygons map back to source x coordinates");
  assert(Math.abs(boxes[0].poly[point][1] - detectorBoxes[0].poly[point][1] * 192 / 64) <= 1,
    "detector polygons map back to source y coordinates");
}
const lineCrop = geometryHost.cropByPoly(cv, sourceMat, boxes[0].poly);
assert(lineCrop.cols > prepared.dstW, "the recognition crop has original resolution, larger than the entire detector image");
assert.deepEqual(sourceMat.data, sourceSnapshot, "neither detection nor crop extraction modifies source pixels");
lineCrop.delete(); sourceMat.delete();

const messages = [], logs = [], requests = [], cacheWrites = [];
let listener, createOptions, predictCalls = 0, shouldFail = false, shouldFailGpu = false;
const createdBackends = [];
let nextResponse;
const nextResult = () => new Promise(resolve => { nextResponse = resolve; });
const imageBytes = Uint8Array.of(10, 20, 30, 255, 40, 50, 60, 255);
const polygon = [[0, 0], [2, 0], [2, 1], [0, 1]];
const host = vm.createContext({
  __HEPR_OCR_ORT_VERSION__: "1.31.1", cvModule: cv,
  Uint8Array, Uint8ClampedArray, Response, ReadableStream, performance, setInterval, clearInterval,
  ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
  console: { info: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  caches: { async open() { return {
    async match() { return undefined; },
    put(input) { cacheWrites.push(String(input)); return new Promise(() => {}); }
  }; } },
  async fetch(input) {
    requests.push(String(input));
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(1, 2)); controller.enqueue(Uint8Array.of(3, 4)); controller.close();
    } }), { headers: { "content-length": "4" } });
  },
  addEventListener(type, callback) { assert.equal(type, "message"); listener = callback; },
  postMessage(message) {
    messages.push(message);
    if (message.result || message.error) nextResponse(message);
  },
  PaddleOCR: { async create(options) {
    createOptions = options;
    createdBackends.push(options.ortOptions.backend);
    const resources = await Promise.all([options.fetch("https://assets.invalid/det.tar"), options.fetch("https://assets.invalid/rec.tar")]);
    await Promise.all(resources.map(response => response.arrayBuffer()));
    return {
      getInitializationSummary() { return { detProvider: options.ortOptions.backend === "auto" ? "webgpu" : "wasm",
        recProvider: options.ortOptions.backend === "auto" ? "webgpu" : "wasm" }; },
      async predict(mat, parameters) {
        predictCalls++;
        assert(mat instanceof cv.Mat, "HEPR must share the SDK's actual OpenCV module");
        assert.equal(mat.cols, 2); assert.equal(mat.rows, 1);
        assert.equal(parameters.textDetLimitType, "max");
        assert.equal(parameters.textDetLimitSideLen, 1536);
        assert.equal(parameters.textDetMaxSideLimit, 1536);
        const converted = await sourceToMatHost.sourceToMat(cv, mat);
        try {
          assert.notEqual(converted.mat, mat);
          assert.deepEqual(Array.from(converted.mat.data), Array.from(imageBytes));
        } finally { converted.dispose(); }
        if (shouldFail) throw new Error("Synthetic inference failure");
        if (shouldFailGpu && options.ortOptions.backend === "auto") throw new Error("GPU execution failed on this input shape");
        return [{ image: { width: 2, height: 1 }, items: [{ text: "Recognized", poly: polygon }],
          metrics: { detMs: 1, recMs: 2, totalMs: 3 }, runtime: { detProvider: "wasm", recProvider: "wasm" } }];
      },
      dispose() {
        if (shouldFailGpu && options.ortOptions.backend === "auto") return new Promise(() => {});
        return shouldFail ? new Promise(() => {}) : Promise.resolve();
      }
    };
  } }
});

try {
  const program = workerSource.replace(/^import[^\n]*\n/gm, "");
  vm.runInContext(stripTypeScriptTypes(program), host);
  const fullSource = host.detectorParameters({ width: 3100, height: 5001, detectorMaxSide: "source" });
  assert.equal(fullSource.textDetLimitSideLen, 5001);
  assert.equal(fullSource.textDetMaxSideLimit, 5024, "full-source detection can exceed the SDK's implicit 4000px ceiling");
  const larger = host.detectorParameters({ width: 3100, height: 5001, detectorMaxSide: 4800 });
  assert.equal(larger.textDetLimitSideLen, 4800, "callers can choose larger detector images");
  assert.equal(larger.textDetMaxSideLimit, 4800);
  assert.throws(() => host.detectorParameters({ width: 2, height: 1, detectorMaxSide: NaN }), /positive and finite/);
  assert.equal(Object.keys(host.detectorParameters({ width: 2480, height: 3505 })).length, 0,
    "healthy runtimes retain the SDK's detection defaults");
  const first = nextResult();
  listener({ data: { id: 1, width: 2, height: 1, rgba: imageBytes, detectorMaxSide: 1536 } });
  const response = await first;
  assert.equal(response.error, undefined, "the real OpenCV thenable must never be awaited");
  assert.deepEqual(JSON.parse(JSON.stringify(response.result)), { lines: [{ text: "Recognized", polygon }] });
  assert.equal(predictCalls, 1);
  assert.equal(createOptions.worker, false);
  assert.equal(createOptions.ortOptions.backend, "auto", "local recognition uses available GPU acceleration before CPU fallback");
  assert.equal(createOptions.ortOptions.numThreads, 1, "ordinary hosting does not require cross-origin isolation");
  assert.equal(createOptions.ortOptions.proxy, false, "the dedicated HEPR worker already owns execution");
  assert.match(createOptions.ortOptions.wasmPaths, /onnxruntime-web@1\.31\.1\/dist\/$/);
  assert.deepEqual(requests.sort(), ["https://assets.invalid/det.tar", "https://assets.invalid/rec.tar"]);
  assert.equal(cacheWrites.length, 2, "a pending persistent-cache write must not stall model initialization");
  assert(messages.some(message => message.progress?.stage === "initializing"));
  assert(messages.some(message => message.progress?.stage === "downloading" && message.progress.completedBytes === 8));
  assert(messages.some(message => message.progress?.stage === "recognizing" && message.progress.backend === "webgpu" && message.progress.elapsedMs >= 0));
  assert(logs.some(([message, values]) => message.includes("timings") && JSON.parse(values).totalMs === 3));
  shouldFailGpu = true;
  const cpuRetried = nextResult();
  listener({ data: { id: 2, width: 2, height: 1, rgba: imageBytes, detectorMaxSide: 1536 } });
  const retriedResponse = await cpuRetried;
  assert.equal(retriedResponse.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(retriedResponse.result)), { lines: [{ text: "Recognized", polygon }] });
  assert.deepEqual(createdBackends, ["auto", "wasm"], "GPU execution failure retries the same model and pixels on CPU exactly once");
  assert(messages.some(message => message.id === 2 && message.progress?.stage === "recognizing" && message.progress.backend === "wasm"));
  shouldFail = true;
  const failed = nextResult();
  listener({ data: { id: 3, width: 2, height: 1, rgba: imageBytes, detectorMaxSide: 1536 } });
  const failure = await failed;
  assert.match(failure.error, /Synthetic inference failure/);
  assert(logs.some(([message, error]) => message.includes("failed") && error.message === "Synthetic inference failure"),
    "the actual worker error is logged before potentially pending model cleanup");
  assert.deepEqual(createdBackends, ["auto", "wasm"], "CPU failures do not repeatedly retry inference");
  for (const scenario of ["zero-detector", "blank-both", "whitespace", "nonfinite-geometry", "invalid-cpu", "missing-gpu"]) {
    const selectedBackends = [], inferenceBackends = [];
    let respond, receive, originalParameters;
    const scenarioHost = vm.createContext({ ...host,
      addEventListener(_type, callback) { receive = callback; },
      postMessage(message) { if (message.result || message.error) respond(message); },
      PaddleOCR: { async create(options) {
        const gpu = options.ortOptions.backend === "auto";
        selectedBackends.push(options.ortOptions.backend);
        return {
          getInitializationSummary() { return { detProvider: gpu ? "webgpu" : "wasm", recProvider: gpu ? "webgpu" : "wasm" }; },
          async predict(mat, parameters) {
            inferenceBackends.push(gpu ? "webgpu" : "wasm");
            assert.deepEqual(Array.from(mat.data), Array.from(imageBytes), "GPU verification retries the same unmodified scan pixels");
            if (originalParameters === undefined) originalParameters = parameters;
            if (inferenceBackends.length === 2) assert.equal(parameters, originalParameters, "CPU verification uses identical detector parameters");
            assert.equal(parameters.textDetLimitSideLen, 1280);
            if (gpu && scenario === "missing-gpu") return [];
            const empty = (scenario === "blank-both" && inferenceBackends.length <= 2) ||
              (gpu && (scenario === "zero-detector" || scenario === "invalid-cpu"));
            return [{ image: { width: 2, height: 1 }, items: empty ? [] : [{
              text: gpu && scenario === "whitespace" ? " \n " : "Recovered text",
              poly: (gpu && scenario === "nonfinite-geometry") || (!gpu && scenario === "invalid-cpu")
                ? [[NaN, 0], [2, 0], [2, 1], [0, 1]] : polygon
            }], metrics: { detMs: 1, recMs: empty ? 0 : 2, totalMs: 3,
              detectedBoxes: empty ? 0 : 1, recognizedCount: empty ? 0 : 1 },
              runtime: { detProvider: gpu ? "webgpu" : "wasm", recProvider: gpu ? "webgpu" : "wasm" } }];
          },
          dispose() { return new Promise(() => {}); }
        };
      } }
    });
    vm.runInContext(stripTypeScriptTypes(program), scenarioHost);
    const recognize = async id => {
      const pending = new Promise(resolve => { respond = resolve; });
      receive({ data: { id, width: 2, height: 1, rgba: imageBytes, detectorMaxSide: 1280 } });
      return pending;
    };
    const checked = await recognize(1);
    if (scenario === "invalid-cpu") {
      assert.match(checked.error, /invalid output \(invalid-text-geometry\)/, "invalid CPU geometry cannot be published or cached as recognized text");
      assert.equal(checked.result, undefined);
      continue;
    }
    assert.equal(checked.error, undefined);
    assert.deepEqual(selectedBackends, ["auto", "wasm"], `${scenario}: unusable GPU output is verified once with CPU models`);
    assert.equal(checked.result.lines.length, scenario === "blank-both" ? 0 : 1);
    const following = await recognize(2);
    assert.equal(following.result.lines.length, 1, "later pages containing text still recognize successfully");
    assert.deepEqual(selectedBackends, ["auto", "wasm"], "later pages retain the working runtime");
    assert.deepEqual(inferenceBackends, scenario === "blank-both" ? ["webgpu", "wasm", "webgpu"] : ["webgpu", "wasm", "wasm"],
      "blank agreement keeps GPU acceleration available, while a verified GPU failure retains CPU");
  }

  // A large detector can fail while the same GPU still recognizes smaller line
  // tensors. Recovery must try that GPU before allocating a CPU runtime.
  const width = 128, height = 5001, sourcePixels = new Uint8Array(width * height * 4).fill(255);
  for (const scenario of ["compact-success", "execution-compact-success", "compact-fails", "compact-invalid", "compact-invalid-blank",
    "compact-throws", "blank-all", "source", "numeric", "cpu-only"]) {
    const backends = [], predictions = [], retired = [];
    let receive, respond, firstMat, firstParameters, currentJob;
    const scenarioHost = vm.createContext({ ...host,
      addEventListener(_type, callback) { receive = callback; },
      postMessage(message) { if (message.result || message.error) respond(message); },
      PaddleOCR: { async create(options) {
        const gpu = options.ortOptions.backend === "auto" && scenario !== "cpu-only";
        backends.push(options.ortOptions.backend);
        return {
          getInitializationSummary() { return { detProvider: gpu ? "webgpu" : "wasm", recProvider: gpu ? "webgpu" : "wasm" }; },
          async predict(mat, parameters) {
            const side = parameters.textDetLimitSideLen ?? "default";
            predictions.push(`${gpu ? "gpu" : "cpu"}:${side}`);
            assert.equal(mat.cols, width); assert.equal(mat.rows, height);
            assert.deepEqual(mat.data, sourcePixels, "detector recovery retains every original source pixel");
            if (predictions.length === 1) { firstMat = mat; firstParameters = parameters; }
            if (currentJob === 1) assert.equal(mat, firstMat);
            if (!gpu && currentJob === 1) assert.equal(parameters, firstParameters,
              "CPU verification compares the original failed GPU configuration");
            if (gpu && side === "default" && scenario === "execution-compact-success") throw new Error("Large GPU shape failed");
            if (gpu && side === 1536 && scenario === "compact-throws") throw new Error("GPU device lost");
            const compactWorked = side === 1536 && scenario.includes("success");
            const laterRealText = scenario === "blank-all" && predictions.length === 4;
            const empty = scenario !== "cpu-only" && !laterRealText && !compactWorked &&
              (gpu || scenario === "blank-all" || (scenario === "compact-invalid-blank" && currentJob === 1));
            const invalid = gpu && side === 1536 && scenario.startsWith("compact-invalid");
            return [{ image: { width, height }, items: empty && !invalid ? [] : [{ text: "Full-resolution line",
              poly: invalid ? [[NaN, 0], [100, 0], [100, 20], [0, 20]] : [[10, 40], [110, 40], [110, 60], [10, 60]] }],
              metrics: { detMs: 1, recMs: empty ? 0 : 2, totalMs: 3, detectedBoxes: empty && !invalid ? 0 : 1,
                recognizedCount: empty && !invalid ? 0 : 1 },
              runtime: { detProvider: gpu ? "webgpu" : "wasm", recProvider: gpu ? "webgpu" : "wasm" } }];
          },
          async dispose() { retired.push(gpu ? "gpu" : "cpu"); }
        };
      } }
    });
    vm.runInContext(stripTypeScriptTypes(program), scenarioHost);
    const recognize = async id => {
      currentJob = id;
      const pending = new Promise(resolve => { respond = resolve; });
      receive({ data: { id, width, height, rgba: sourcePixels,
        ...(scenario === "source" ? { detectorMaxSide: "source" } : scenario === "numeric" ? { detectorMaxSide: 1280 } : {}) } });
      return pending;
    };
    const first = await recognize(1);
    assert.equal(first.error, undefined, scenario);
    assert.equal(first.result.lines.length, scenario === "blank-all" || scenario === "compact-invalid-blank" ? 0 : 1, scenario);
    const second = await recognize(2);
    assert.equal(second.error, undefined, scenario);
    assert.equal(second.result.lines.length, 1, scenario);
    if (scenario.includes("success")) {
      assert.deepEqual(backends, ["auto"], "successful smaller GPU detection never initializes CPU models");
      assert.deepEqual(predictions, ["gpu:default", "gpu:1536", "gpu:1536"], "the working GPU detector policy is reused");
      assert.deepEqual(retired, []);
    } else if (scenario === "blank-all") {
      assert.deepEqual(predictions, ["gpu:default", "gpu:1536", "cpu:default", "gpu:default"],
        "a blank first page cannot disable or resize a healthy GPU for later pages");
      assert.deepEqual(retired, ["cpu"]);
    } else if (scenario === "source" || scenario === "numeric") {
      const side = scenario === "source" ? 5001 : 1280;
      assert.deepEqual(predictions, [`gpu:${side}`, `cpu:${side}`, `cpu:${side}`], "explicit detector policies are never overridden");
    } else if (scenario === "cpu-only") {
      assert.deepEqual(predictions, ["cpu:default", "cpu:default"], "CPU-only hosting retains the SDK's original quality policy");
      assert.deepEqual(backends, ["auto"]);
    } else {
      assert.deepEqual(predictions, ["gpu:default", "gpu:1536", "cpu:default", "cpu:default"],
        "failed GPU recovery still verifies and retains the original CPU configuration");
      assert.deepEqual(backends, ["auto", "wasm"]);
      assert.deepEqual(retired, ["gpu"]);
    }
  }
} finally { cv.then = originalThen; }

console.log("Viewer Paddle runtime reaches real OpenCV Mat prediction, reports download stages, and surfaces errors promptly.");
