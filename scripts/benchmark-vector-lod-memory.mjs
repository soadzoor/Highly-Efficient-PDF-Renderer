import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Optional, server-free profiling of EXISTING HEP files. Each invocation runs
// one isolated child, capped at 90 seconds by default. Fingerprinting happens
// after memory measurements, so its scratch arrays do not inflate the result.
//
// node scripts/benchmark-vector-lod-memory.mjs file.hep --output=/tmp/before.json
// node scripts/benchmark-vector-lod-memory.mjs file.hep --compare=/tmp/before.json
// --source=/tmp/vectorStrokeLodCore.ts substitutes only the LOD implementation.
// --ordered also measures ordered draw preparation and its first overview frame.
// --ordered-source=core.ts substitutes the original ordered implementation.
// --timeout-ms=90000 controls the whole child, including parity fingerprinting.

const args = process.argv.slice(2);
const geometryFields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
const boundsFields = ["segmentMinX", "segmentMinY", "segmentMaxX", "segmentMaxY"];

const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = args.find(value => !value.startsWith("--"));
if (!input || args.includes("--help")) {
  console.log("Usage: node scripts/benchmark-vector-lod-memory.mjs existing.hep " +
    "[--source=core.ts] [--ordered] [--ordered-source=batches.ts] [--output=snapshot.json] [--compare=snapshot.json] [--timeout-ms=90000]");
  process.exit(args.includes("--help") ? 0 : 1);
}
if (!args.includes("--worker")) {
  const timeoutMs = Number(option("timeout-ms") ?? 90_000);
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, "timeout-ms must be positive");
  const child = spawn(process.execPath, ["--expose-gc", "--experimental-strip-types",
    fileURLToPath(import.meta.url), ...args, "--worker"], { stdio: "inherit" });
  const timer = setTimeout(() => {
    console.error(`LOD benchmark exceeded ${timeoutMs} ms; terminating the child.`);
    child.kill("SIGKILL");
  }, timeoutMs);
  child.once("error", error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
  child.once("exit", code => { clearTimeout(timer); process.exitCode = code ?? 1; });
} else {
  await benchmark();
}

async function benchmark() {
  const sourcePath = option("source") ?? process.env.HEPR_LOD_SOURCE;
  const coreUrl = new URL("../src/vectorStrokeLodCore.ts", import.meta.url).href;
  const orderedSourcePath = option("ordered-source");
  const orderedUrl = new URL("../src/vectorOrderedBatches.ts", import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
    },
    load(url, context, next) {
      const result = next(url, context);
      const replacement = url === coreUrl ? sourcePath : url === orderedUrl ? orderedSourcePath : undefined;
      return replacement ? { ...result, source: readFileSync(resolve(replacement), "utf8") } : result;
    }
  });
  try {
    const { loadSceneFromHep } = await import("../src/hep.ts");
    const { prebuildVectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
    const { strokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
    const OrderedBatches = args.includes("--ordered")
      ? (await import("../src/vectorOrderedBatches.ts")).VectorOrderedBatches : null;
    const bytes = readFileSync(resolve(input));
    const scene = await loadSceneFromHep(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    globalThis.gc?.();
    const loadedMemory = process.memoryUsage();
    const peak = { ...loadedMemory };
    const sample = () => {
      for (const [key, value] of Object.entries(process.memoryUsage())) peak[key] = Math.max(peak[key], value);
    };
    const started = performance.now();
    const runtime = await prebuildVectorStrokeLodRuntime(scene, "force", "webgl", {
      yieldIntervalMs: 25, onProgress: sample
    });
    sample();
    const measurement = {
      buildMs: performance.now() - started,
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
      loadedMemory,
      sampledPeakMemory: peak,
      completedMemory: process.memoryUsage()
    };
    assert(runtime, "LOD runtime was not built");
    const ordered = OrderedBatches ? measureOrderedPreparation(OrderedBatches, scene, runtime) : undefined;
    const levels = [];
    const rankMaps = [];
    const raw = [];
    for (const level of runtime.levels) {
      const result = fingerprintLevel(level, strokePaintOrigins(level.scene));
      levels.push(result.parity);
      raw.push(result.raw);
      rankMaps.push(result.ranks);
    }
    const parity = {
      hepSha256: hash(bytes),
      sourceSegmentCount: scene.segmentCount,
      drawRunsSha256: hash(JSON.stringify(scene.drawRuns)),
      clipPathsSha256: hash(JSON.stringify(scene.clipPaths)),
      tileGrid: { ...runtime.tileGrid, xEdges: hash(runtime.tileGrid.xEdges), yEdges: hash(runtime.tileGrid.yEdges) },
      levels,
      views: fingerprintViews(runtime, rankMaps, scene.bounds)
    };
    const snapshot = { version: 1, input: resolve(input), source: sourcePath ? resolve(sourcePath) : coreUrl,
      measurement, ordered, parity, raw };
    if (option("output")) writeFileSync(resolve(option("output")), `${JSON.stringify(snapshot, null, 2)}\n`);
    const comparison = option("compare");
    if (comparison) {
      const expected = JSON.parse(readFileSync(resolve(comparison), "utf8"));
      assert.equal(expected.version, snapshot.version, "Snapshot format mismatch");
      assert.deepEqual(JSON.parse(JSON.stringify(parity)), expected.parity,
        "LOD geometry, paint origins, bounds, multiplicity, tile membership, or selected views changed");
      if (ordered && expected.ordered) {
        assert.deepEqual(ordered.fingerprint, expected.ordered.fingerprint,
          "Ordered draw batches, clip codes, or final instance geometry changed");
        console.log("PASS: ordered batches, clip codes and final instance geometry.");
      }
      console.log("PASS: byte-exact geometry, paint origins, bounds, multiplicity, all levels, tile membership and sampled views.");
      console.log(`Storage order ${JSON.stringify(raw) === JSON.stringify(expected.raw) ? "also matches" : "changed (canonical paint-order output matches)"}.`);
    }
    console.log(JSON.stringify({ input: resolve(input), ...measurement, ordered,
      levels: levels.map(({ tolerance, overview, segmentCount }) => ({ tolerance, overview, segmentCount })),
      paritySnapshot: option("output") ?? null }, null, 2));
  } finally {
    hooks.deregister();
  }
}


function measureOrderedPreparation(OrderedBatches, scene, runtime) {
  assert(scene.drawRuns, "Ordered preparation requires a scene with draw runs");
  const beforeMemory = process.memoryUsage();
  const started = performance.now();
  const plan = new OrderedBatches(scene, runtime);
  const constructorMs = performance.now() - started;
  const constructedMemory = process.memoryUsage();
  const viewport = { width: 1080, height: 1920 };
  const bounds = scene.bounds;
  const zoom = Math.min(viewport.width / (bounds.maxX - bounds.minX),
    viewport.height / (bounds.maxY - bounds.minY));
  runtime.updateForLocalUnitsPerPixel(1 / zoom);
  runtime.update({ cameraCenterX: (bounds.minX + bounds.maxX) / 2,
    cameraCenterY: (bounds.minY + bounds.maxY) / 2, zoom }, viewport);
  plan.update(scene.drawRuns, 1 / zoom);
  // Native WebGL requests this view, while WebGPU uses the integer view.
  void plan.floatInstances;
  const overviewMs = performance.now() - started - constructorMs;
  const measurement = { constructorMs, overviewMs, beforeMemory, constructedMemory,
    overviewMemory: process.memoryUsage(), maxRssBytes: process.resourceUsage().maxRSS * 1024,
    visibleInstances: plan.instanceCount, visibleStrokes: runtime.getRenderedSegmentCount(),
    reachableTypedArrayBytes: retainedBufferBytes([scene, runtime, plan]) };
  const drawHash = createHash("sha256");
  // Older plans hold one combined scene; current plans read split records in place.
  const records = plan.strokeRecords ?? { count: plan.strokeScene.segmentCount,
    segments: [{ first: 0, count: plan.strokeScene.segmentCount, scene: plan.strokeScene }] };
  const record = (key, id) => {
    const segment = records.segments.findLast(candidate => id >= candidate.first);
    return segment.scene[key].subarray((id - segment.first) * 4, (id - segment.first + 1) * 4);
  };
  for (const batch of plan.batches) {
    drawHash.update(JSON.stringify(batch));
    if (batch.kind !== "stroke" && batch.kind !== "fill" && batch.kind !== "text") continue;
    for (let index = batch.first; index < batch.first + batch.count; index++) {
      const id = plan.uintInstances[index * 2];
      if (batch.kind === "stroke") {
        for (const key of geometryFields) drawHash.update(record(key, id));
        drawHash.update(plan.uintInstances.subarray(index * 2 + 1, index * 2 + 2));
      } else drawHash.update(plan.uintInstances.subarray(index * 2, index * 2 + 2));
    }
  }
  const fingerprint = { instanceCount: plan.instanceCount,
    culledSegmentCount: plan.culledSegmentCount, spanOrdered: plan.spanOrdered,
    batchSegmentsSha256: hash(JSON.stringify(plan.batchSegments)), drawSha256: drawHash.digest("hex") };
  // Restore constructor-equivalent selection state before the parity view
  // sequence, including the tile hysteresis cleared by force-exact toggles.
  runtime.setForceExact(true);
  runtime.setForceExact(false);
  runtime.resetVisible();
  return { ...measurement, fingerprint };
}

function retainedBufferBytes(roots) {
  const objects = new Set(), buffers = new Set();
  const visit = value => {
    if (value === null || typeof value !== "object" || objects.has(value)) return;
    objects.add(value);
    if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
    else if (value instanceof ArrayBuffer) buffers.add(value);
    else if (value instanceof Map || value instanceof Set) for (const item of value.values()) visit(item);
    else for (const item of Object.values(value)) visit(item);
  };
  visit(roots);
  return [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
}

function fingerprintLevel(level, origins) {
  const count = level.segmentCount;
  const fields = geometryFields.map(key => bits(level.scene[key]));
  // Store-backed levels share culling bounds per stored stroke, addressed by records.
  const bounds = boundsFields.map(key => bits(level.records
    ? Float32Array.from(level.records, id => level[key][id]) : level[key]));
  // A source origin determines the original paint and clip. Within the same
  // origin, sorting identical-style representatives removes harmless storage
  // reorderings while retaining every duplicate and every Float32 bit. Without
  // paint metadata, conservatively require the original primitive order.
  const origin = index => origins ? origins[index] : index;
  const order = Uint32Array.from({ length: count }, (_, index) => index);
  order.sort((a, b) => {
    const delta = origin(a) - origin(b);
    if (delta) return delta;
    for (const field of fields) for (let component = 0; component < 4; component++) {
      const difference = field[a * 4 + component] - field[b * 4 + component];
      if (difference) return difference;
    }
    for (const field of bounds) if (field[a] !== field[b]) return field[a] - field[b];
    return 0;
  });
  const ranks = new Uint32Array(count);
  const records = new Uint32Array(21 * 1024);
  const geometryHash = createHash("sha256");
  let used = 0;
  for (let rank = 0; rank < count; rank++) {
    const index = order[rank];
    ranks[index] = rank;
    records[used++] = origin(index);
    for (const field of fields) for (let component = 0; component < 4; component++) {
      records[used++] = field[index * 4 + component];
    }
    for (const field of bounds) records[used++] = field[index];
    if (used === records.length) { geometryHash.update(records); used = 0; }
  }
  geometryHash.update(records.subarray(0, used));
  const ids = Uint32Array.from(level.tileSegmentIds, id => ranks[id]);
  for (let tile = 0; tile < level.tileCounts.length; tile++) {
    const start = level.tileOffsets[tile];
    ids.subarray(start, start + level.tileCounts[tile]).sort();
  }
  return {
    ranks,
    parity: {
      tolerance: level.tolerance,
      overview: Boolean(level.overview),
      segmentCount: count,
      bounds: level.scene.bounds,
      maxHalfWidth: level.scene.maxHalfWidth,
      canonicalGeometrySha256: geometryHash.digest("hex"),
      tileOffsetsSha256: hash(level.tileOffsets),
      tileCountsSha256: hash(level.tileCounts),
      canonicalTileIdsSha256: hash(ids)
    },
    raw: Object.fromEntries([...geometryFields.map(key => [key, hash(level.scene[key])]),
      ["origins", origins ? hash(origins) : null], ["tileSegmentIds", hash(level.tileSegmentIds)]])
  };
}

function fingerprintViews(runtime, rankMaps, bounds) {
  const viewport = { width: 1080, height: 1920 };
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  const fitZoom = Math.min(viewport.width / width, viewport.height / height);
  const views = [];
  // Keep the sequence fixed: hysteresis is part of the behavior under test.
  for (const [zoomFactor, x, y] of [[.5, .5, .5], [1, .5, .5], [2, .5, .5],
    [4, .5, .5], [8, .25, .25], [16, .75, .75], [32, .5, .5], [1, .5, .5]]) {
    const zoom = fitZoom * zoomFactor;
    runtime.updateForLocalUnitsPerPixel(1 / zoom);
    runtime.update({ cameraCenterX: bounds.minX + width * x, cameraCenterY: bounds.minY + height * y, zoom }, viewport);
    views.push({ zoomFactor, x, y, stats: runtime.getStats(), levels: runtime.levels.map((level, index) => {
      const ids = Uint32Array.from(level.visibleSegmentIds.subarray(0, level.visibleSegmentCount), id => rankMaps[index][id]);
      ids.sort();
      return { count: ids.length, canonicalIdsSha256: hash(ids) };
    }) });
  }
  return views;
}

function bits(array) {
  return new Uint32Array(array.buffer, array.byteOffset, array.length);
}

function hash(value) {
  return createHash("sha256").update(value === undefined ? "undefined" : value).digest("hex");
}
