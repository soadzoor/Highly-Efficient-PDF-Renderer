import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const warn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(" "));
const MIB = 1024 * 1024, budget = 5 * MIB;
const storageBudget = Math.floor((budget - 4 * MIB) * .98);

try {
  const { PdfRasterCompressor } = await import("../src/pdfRasterCompression.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { copyRasterLayer } = await import("../src/monochromeRaster.ts");
  const { estimateCompressedRasterBytes } = await import("../src/rasterCompression.ts");
  const { throwIfAborted } = await import("../src/pdf/nativeTypes.ts");
  const page = (...layers) => Object.assign(createEmptyVectorScene(), {
    pageCount: 1, pageRects: Float32Array.of(0, 0, 100, 100), pageTextRanges: Uint32Array.of(0, 0),
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, rasterLayers: layers
  });
  const makeEncoder = (capabilities = { bc7: true, astc4x4: true }, onEncode) => ({
    capabilities, calls: [], releases: 0, disposals: 0,
    encode(pixels, width, height, format, maxWorkspaceBytes, signal) {
      this.calls.push({ pixels, width, height, format, maxWorkspaceBytes, signal });
      throwIfAborted(signal);
      const result = onEncode?.(this.calls.at(-1));
      return result ?? new Uint8Array(estimateCompressedRasterBytes(width, height, format)).fill(this.calls.length);
    },
    releaseWorkspace() { this.releases++; },
    dispose() { this.disposals++; }
  });

  for (const [capabilities, format] of [
    [{ bc7: true, astc4x4: true }, "bc7"], [{ bc7: false, astc4x4: true }, "astc-4x4"]
  ]) {
    const encoder = makeEncoder(capabilities), diagnostics = [];
    let releasedContext = 0;
    const compressor = new PdfRasterCompressor(encoder, 512, diagnostic => diagnostics.push(diagnostic),
      budget, () => releasedContext++);
    const layer = colorScan(256, 257), scene = page(layer), canonical = layer.data, preserved = canonical.slice();
    await compressor.preparePage(scene, 4, 7);
    assert.equal(layer.gpuCompression.format, format);
    assert.equal(layer.compressionHint, "scan");
    assert(layer.gpuCompression.tiles.length > 0);
    assert.equal(encoder.calls.length, layer.gpuCompression.plan.tiles.length);
    for (const [index, call] of encoder.calls.entries()) {
      assert.equal(call.format, format);
      assert.equal(call.maxWorkspaceBytes, 4 * MIB);
      assert.equal(call.pixels.length, call.width * call.height * 4);
      assert.notEqual(call.pixels, canonical, "parser derivatives never use the writable canonical buffer as scratch");
      assert.equal(layer.gpuCompression.tiles[index].byteLength,
        estimateCompressedRasterBytes(call.width, call.height, format));
    }
    assert.equal(layer.data, canonical);
    assert.deepEqual(canonical, preserved);
    assert(retainedBytes(layer) <= Math.floor(storageBudget / 4));
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-compression").length, 1);
    assert.equal(diagnostics.find(diagnostic => diagnostic.code === "raster.scan-compression").pageIndex, 7);
    assert.equal(encoder.releases, 1, "page preparation releases GPU scratch before the next page compiles");
    await compressor.preparePage(scene, 4, 7);
    assert.equal(encoder.calls.length, 1, "already-prepared pages do not allocate duplicate blocks");
    compressor.dispose(); compressor.dispose();
    assert.equal(encoder.disposals, 1);
    assert.equal(releasedContext, 1);
    await compressor.preparePage(page(colorScan(64, 64)), 4, 8);
    assert.equal(encoder.calls.length, 1, "disposed preparation cannot resume background GPU work");
  }

  {
    const diagnostics = [], compressor = new PdfRasterCompressor(null, 512,
      diagnostic => diagnostics.push(diagnostic), budget);
    const layer = packedScan(256, 257), canonical = layer.monochrome.data, preserved = canonical.slice();
    await compressor.preparePage(page(layer), 4, 2);
    assert(layer.gpuPreparation, "packed TIKA-style scans prepare GPU atlases without optional compression extensions");
    assert.equal(layer.gpuCompression, undefined, "packed scan preparation retains its lossless representation");
    assert(layer.gpuPreparation.coverageAtlases.length > 0);
    assert(layer.gpuPreparation.compactAtlases.some(Boolean), "the fixture prepares an actual compact GPU atlas");
    assert.equal(layer.monochrome.data, canonical);
    assert.deepEqual(canonical, preserved);
    assert(retainedBytes(layer) <= Math.floor(storageBudget / 4));
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-monochrome-preparation").length, 1);
    const copied = copyRasterLayer(layer, { pageIndex: 3 });
    assert.equal(copied.gpuPreparation, layer.gpuPreparation);
    assert.equal(typeof Object.getOwnPropertyDescriptor(copied, "data").get, "function");
    assert.throws(() => copied.data, /packed scan RGBA/);
    const color = colorScan(64, 64), encoder = makeEncoder(), colorCompressor = new PdfRasterCompressor(encoder, 512,
      undefined, budget);
    await colorCompressor.preparePage(page(color), 4, 0);
    const grid = composeVectorScenesInGrid([page(layer), page(color)], 2);
    assert.equal(grid.rasterLayers[0].gpuPreparation, layer.gpuPreparation);
    assert.equal(grid.rasterLayers[1].gpuCompression, color.gpuCompression);
    assert.equal(grid.rasterLayers[1].compressionHint, "scan");
    assert.deepEqual(grid.rasterLayers.map(raster => raster.pageIndex), [0, 1]);
    assert.notDeepEqual(grid.rasterLayers[1].matrix, color.matrix, "layout changes placements while retaining prepared pixels");
    assert.deepEqual(canonical, preserved);
    colorCompressor.dispose(); compressor.dispose();
  }

  {
    const encoder = makeEncoder(), diagnostics = [], count = 8;
    const compressor = new PdfRasterCompressor(encoder, 512, diagnostic => diagnostics.push(diagnostic), budget);
    const layers = Array.from({ length: count }, (_, index) => index % 2 ? packedScan(512, 512) : colorScan(512, 512));
    let retained = 0;
    for (const [index, layer] of layers.entries()) {
      await compressor.preparePage(page(layer), count, index);
      assert(layer.gpuCompression || layer.gpuPreparation, "every selected synthetic scanned page receives a display derivative");
      const bytes = retainedBytes(layer);
      assert(bytes <= Math.floor(storageBudget / count), "each page shares the document allowance");
      retained += bytes;
      assert(retained <= storageBudget, "sequential parsing cannot accumulate an unbounded derivative cache");
    }
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-compression").length, 1);
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-monochrome-preparation").length, 1);
    assert.equal(encoder.releases, count);
    compressor.dispose();
  }

  {
    const encoder = makeEncoder(), compressor = new PdfRasterCompressor(encoder, 512, undefined, budget);
    const binary = colorScan(64, 64);
    for (let offset = 0; offset < binary.data.length; offset += 4) {
      const value = offset % 8 ? 0 : 255;
      binary.data.set([value, value, value, 255], offset);
    }
    const alpha = colorScan(64, 64); alpha.data[alpha.data.length - 1] = 254;
    const embedded = colorScan(64, 64); embedded.matrix = Float32Array.of(20, 0, 0, -20, 0, 20);
    const singular = colorScan(64, 64); singular.matrix = Float32Array.of(100, 0, 100, 0, 0, 0);
    const protectedLayers = [binary, alpha, embedded, singular, colorScan(32, 32),
      Object.assign(colorScan(64, 64), { exactPixels: true }), Object.assign(colorScan(64, 64), { containsText: true }),
      Object.assign(colorScan(64, 64), { imageMask: true })];
    for (const layer of protectedLayers) {
      await compressor.preparePage(page(layer), 4, 0);
      assert.equal(layer.gpuCompression, undefined);
      assert.equal(layer.gpuPreparation, undefined);
      assert.equal(layer.compressionHint, undefined, "protected pixels cannot be opted into compression by later renderer classification");
    }
    for (const count of ["segmentCount", "fillPathCount", "textInstanceCount", "gradientFillPathCount", "gradientStrokeRunCount"]) {
      const layer = colorScan(64, 64);
      await compressor.preparePage(Object.assign(page(layer), { [count]: 1 }), 4, 0);
      assert.equal(layer.gpuCompression, undefined, "ordinary vector/text pages skip scan preparation");
      assert.equal(layer.compressionHint, undefined);
    }
    assert.equal(encoder.calls.length, 0);
    compressor.dispose();
  }

  for (const encoder of [null, makeEncoder({ bc7: false, astc4x4: false })]) {
    const diagnostics = [], compressor = new PdfRasterCompressor(encoder, 512, diagnostic => diagnostics.push(diagnostic), budget);
    for (let index = 0; index < 2; index++) {
      const layer = colorScan(64, 64), preserved = layer.data.slice();
      await compressor.preparePage(page(layer), 4, index);
      assert.equal(layer.gpuCompression, undefined);
      assert.deepEqual(layer.data, preserved);
    }
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-compression-unavailable").length, 1,
      "unsupported devices retain canonical fallback and report one actionable diagnostic");
    assert.equal(encoder?.calls.length ?? 0, 0);
    compressor.dispose();
  }

  {
    const diagnostics = [], encoder = makeEncoder(undefined, () => { throw new Error("synthetic GPU encode failure"); });
    const compressor = new PdfRasterCompressor(encoder, 512, diagnostic => diagnostics.push(diagnostic), budget);
    const layer = colorScan(64, 64), canonical = layer.data.slice();
    await compressor.preparePage(page(layer), 4, 9);
    assert.equal(layer.gpuCompression, undefined);
    assert.deepEqual(layer.data, canonical);
    assert.equal(encoder.disposals, 1, "failed encoder resources are released immediately");
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-compression-failed").length, 1);
    await compressor.preparePage(page(colorScan(64, 64)), 4, 10);
    assert.equal(encoder.calls.length, 1, "a failed encoder is not retried on every remaining page");
    compressor.dispose(); assert.equal(encoder.disposals, 1);
  }

  {
    const encoder = makeEncoder(undefined, () => new Uint8Array(MIB));
    const compressor = new PdfRasterCompressor(encoder, 512, undefined, budget), layer = colorScan(64, 64);
    await compressor.preparePage(page(layer), 8, 0);
    assert.equal(layer.gpuCompression, undefined, "unexpected oversized output cannot exceed the page allowance");
    compressor.dispose();
  }

  for (const phase of ["before", "pixels", "packed-pixels", "encode"]) {
    const abort = new AbortController(), diagnostics = [];
    const encoder = makeEncoder(undefined, () => {
      if (phase === "encode") { abort.abort(); throwIfAborted(abort.signal); }
    });
    const compressor = new PdfRasterCompressor(encoder, 512, diagnostic => diagnostics.push(diagnostic), budget);
    const layer = phase === "packed-pixels" ? packedScan(512, 512) : colorScan(512, 512);
    const canonical = (layer.monochrome?.data ?? layer.data).slice();
    const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
    let timer;
    try {
      if (phase === "before") abort.abort();
      if (phase === "pixels" || phase === "packed-pixels") {
        let time = 0;
        Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => time += 5 } });
        timer = setTimeout(() => abort.abort(), 0);
      }
      await assert.rejects(compressor.preparePage(page(layer), 8, 0, abort.signal), error => error.code === "aborted");
      assert.equal(layer.gpuCompression, undefined);
      assert.equal(layer.gpuPreparation, undefined);
      assert.deepEqual(layer.monochrome?.data ?? layer.data, canonical);
      assert.equal(encoder.calls.length, phase === "encode" ? 1 : 0,
        "cancelling pixel preparation stops before GPU encoding is submitted");
      assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "raster.scan-compression-failed").length, 0,
        "user cancellation is not reported as a hardware failure");
    } finally {
      clearTimeout(timer);
      if (performanceDescriptor) Object.defineProperty(globalThis, "performance", performanceDescriptor);
      compressor.dispose();
    }
  }

  {
    const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
    const width = 64, height = 64, packed = packedScan(width, height).monochrome.data;
    const bytes = scanPdf(width, height, packed);
    const original = bytes.slice(), diagnostics = [];
    const options = Object.freeze({ compressScans: true, pageLoading: "auto",
      onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    const loaded = await loadPdfSceneFromSource(bytes, options, undefined, true);
    assert.equal(loaded.pageDemand, undefined, "scan preparation selects complete parsing even when the viewer requests automatic demand loading");
    assert.equal(loaded.scene.pageCount, 1);
    assert.equal(loaded.scene.rasterLayers.length, 1);
    const layer = loaded.scene.rasterLayers[0];
    assert.deepEqual([layer.width, layer.height], [width, height]);
    assert.deepEqual(layer.monochrome.data, packed, "the real native worker keeps canonical one-bit samples");
    assert(layer.gpuPreparation, "the high-level option reaches sequential parse-time GPU atlas preparation");
    assert.equal(layer.gpuPreparation.coverageAtlases.length, 1);
    assert.deepEqual(layer.gpuPreparation.monochromeTiles[0].data, packed);
    assert.equal(typeof Object.getOwnPropertyDescriptor(layer, "data").get, "function", "real loading preserves the lazy RGBA compatibility field");
    assert.equal(layer.gpuCompression, undefined);
    assert(diagnostics.some(diagnostic => diagnostic.code === "raster.scan-monochrome-preparation"));
    const conflicts = diagnostics.filter(diagnostic => diagnostic.code.startsWith("options.compress-scans-"));
    assert.equal(conflicts.length, 1, "the public loader reports the streaming conflict once, without duplicate extractor warnings");
    assert.equal(conflicts[0].code, "options.compress-scans-streaming-conflict");
    assert.equal(conflicts[0].severity, "warning");
    assert.equal(warnings.filter(message => message.includes(conflicts[0].message)).length, 1);
    assert.notEqual(loaded.sourceOptions, options, "resolved PDF viewing options use a separate object");
    assert.equal(loaded.sourceOptions.compressScans, true);
    assert.equal(loaded.sourceOptions.pageLoading, "eager");
    assert.equal(options.pageLoading, "auto", "conflict resolution preserves the caller's options");
    assert.deepEqual(loaded.sourceBytes, original);
    assert.deepEqual(bytes, original, "the caller's PDF bytes remain attached and unchanged");

    for (const pageLoading of ["all", "eager"]) {
      const compatible = [];
      const loaded = await loadPdfSceneFromSource(bytes, { compressScans: true, pageLoading,
        onDiagnostic: diagnostic => compatible.push(diagnostic) }, undefined, true);
      assert.equal(loaded.pageDemand, undefined);
      assert(loaded.scene.rasterLayers[0].gpuPreparation);
      assert.equal(compatible.filter(diagnostic => diagnostic.code.startsWith("options.compress-scans-")).length, 0,
        `${pageLoading} is compatible with scan preparation`);
    }

    const manyPages = scanPdf(width, height, packed, 17);
    for (const compressScans of [false, true]) {
      const diagnostics = [];
      const options = Object.freeze({ compressScans, ocrTextOnly: true, pageLoading: "auto",
        onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
      const loaded = await loadPdfSceneFromSource(manyPages, options, undefined, true);
      try {
        assert(loaded.pageDemand, "OCR mode keeps automatic page streaming when scan preparation is disabled or conflicting");
        assert.equal(loaded.pageDemand.pageCount, 17);
        assert.equal(loaded.pageDemand.previewCount, 0, "streaming starts with metadata instead of decoding every page");
        assert.equal(loaded.sourceOptions.compressScans, false);
        assert.equal(loaded.sourceOptions.pageLoading, "auto");
        const conflicts = diagnostics.filter(diagnostic => diagnostic.code.startsWith("options.compress-scans-"));
        assert.equal(conflicts.length, compressScans ? 1 : 0,
          "OCR wins first, so all three options emit only the relevant OCR conflict warning");
        if (compressScans) {
          assert.equal(conflicts[0].code, "options.compress-scans-ocr-conflict");
          assert.equal(conflicts[0].severity, "warning");
          assert.equal(warnings.filter(message => message.includes(conflicts[0].message)).length, 1);
        }
        assert.equal(options.compressScans, compressScans, "OCR resolution leaves the requested options unchanged");
      } finally { await loaded.pageDemand?.close(); }
    }

    const { extractPdfPageScenes, extractPdfRasterPageScenes } = await import("../src/pdfVectorExtractor.ts");
    for (const extract of [extractPdfPageScenes, extractPdfRasterPageScenes]) {
      const diagnostics = [], start = warnings.length;
      const options = Object.freeze({ compressScans: true, ocrTextOnly: true,
        onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
      const pages = await extract(bytes.slice().buffer, options);
      assert.equal(pages.length, 1);
      assert.equal(pages[0].rasterLayers.length, 0, "direct extractors honor OCR rather than decoding or preparing scans");
      const conflicts = diagnostics.filter(diagnostic => diagnostic.code.startsWith("options.compress-scans-"));
      assert.equal(conflicts.length, 1, "direct extraction reports the OCR conflict once");
      assert.equal(conflicts[0].code, "options.compress-scans-ocr-conflict");
      assert.equal(conflicts[0].severity, "warning");
      assert.equal(warnings.slice(start).filter(message => message.includes(conflicts[0].message)).length, 1);
      assert.equal(options.compressScans, true);
    }

    const beforeFallback = warnings.length;
    await extractPdfPageScenes(bytes.slice().buffer, { compressScans: true, ocrTextOnly: true });
    assert.equal(warnings.slice(beforeFallback).filter(message => /compressScans/.test(message) && /ocrTextOnly/.test(message)).length, 1,
      "public API conflicts warn through console.warn even without an onDiagnostic callback");
  }

  console.log("Parse-time scan preparation: BC7/ASTC blocks, lazy-safe compact monochrome atlases, shared page budgets, fallback, cancellation and composition passed.");
} finally {
  console.warn = warn;
  hooks.deregister();
}

function colorScan(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = [32, 128, 240][(x + y) % 3];
    data.set([value, value + 3, value + 7, 255], (y * width + x) * 4);
  }
  return { width, height, data, matrix: Float32Array.of(100, 0, 0, -100, 0, 100), pageIndex: 0, paintOrder: 0 };
}

function packedScan(width, height) {
  const stride = Math.ceil(width / 8), data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    data[y * stride + x] = y % 32 < 4 && x % 8 < 4 ? 0xa5 : 0;
  }
  return { width, height, monochrome: { data, colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) },
    get data() { throw new Error("packed scan RGBA must remain lazy"); },
    matrix: Float32Array.of(100, 0, 0, -100, 0, 100), pageIndex: 0, paintOrder: 0 };
}

function scanPdf(width, height, packed, pageCount = 1) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 3);
  const contents = pageCount + 3, image = pageCount + 4;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map(page => `${page} 0 R`).join(" ")}] >>` },
    ...pages.map(number => ({ number,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im ${image} 0 R >> >> /Contents ${contents} 0 R >>` })),
    { number: contents, body: tinyPdfStream("", `q ${width} 0 0 ${height} 0 0 cm /Im Do Q`) },
    { number: image, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1`, packed) }
  ] });
}

function retainedBytes(layer) {
  if (layer.gpuCompression) return layer.gpuCompression.tiles.reduce((sum, tile) => sum + tile.byteLength, 0);
  const prepared = layer.gpuPreparation, buffers = new Set();
  const retain = data => { if (data) buffers.add(data.buffer); };
  prepared.pixels.forEach(retain);
  prepared.coverageAtlases?.forEach(atlas => retain(atlas.data));
  prepared.compactAtlases?.forEach(atlas => retain(atlas?.data));
  prepared.monochromeTiles?.forEach(bits => { retain(bits.data); retain(bits.colors); });
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}
