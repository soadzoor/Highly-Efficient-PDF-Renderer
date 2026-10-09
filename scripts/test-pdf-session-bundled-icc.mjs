import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const loadedEngines = new Set();
const scenario = process.argv[2];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const engine = /nativeIcc(Lcms|Qcms)\.ts$/.exec(url)?.[1];
    if (engine) {
      loadedEngines.add(engine.toLowerCase());
      if (scenario === "load-failure" || scenario === `${engine.toLowerCase()}-unavailable`) {
        throw new Error("Simulated unavailable engine chunk");
      }
      if (scenario === `${engine.toLowerCase()}-wasm-unavailable`) {
        const result = nextLoad(url, context);
        const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
        return { ...result, source: source.replace(`${engine.toLowerCase()}.wasm?`, `${engine.toLowerCase()}.missing.wasm?`) };
      }
      if (engine === "Qcms" && ["resource-limit", "aborted", "unexpected-error"].includes(scenario)) {
        return { format: "module", shortCircuit: true, source: `
          import { PdfError } from './nativeTypes.ts';
          export async function resolveQcmsTransform() {
            throw ${scenario === "unexpected-error" ? 'new Error("Unexpected adapter error")'
              : `new PdfError(${JSON.stringify(scenario)}, "Simulated fatal engine error")`};
          }` };
      }
    }
    return nextLoad(url, context);
  }
});

const { openPdf } = await import("../src/pdfSession.ts");
const { openPdfInNodeWorker } = await import("../src/pdf/workerClient.ts");
const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
const { HEPR_COLOR_SPACE_KIND, collectHeprTransferables } = await import("../src/heprDocumentData.ts");
const { configureWasm32Memory } = await import("../src/pdf/nativeWasmMemory.ts");
const smallWasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 1, 1, 1, 128, 32);
const widenedWasm = configureWasm32Memory(smallWasm);
assert.deepEqual([...widenedWasm.slice(8)], [5, 6, 1, 1, 1, 128, 128, 4], "ICC heaps use WASM32 capacity without allocating it");
new WebAssembly.Module(widenedWasm);
assert.throws(() => configureWasm32Memory(smallWasm, 65537), /WASM32/);
const profiles = Object.fromEntries(await Promise.all(
  ["srgb", "linear-rgb", "linear-gray", "synthetic-cmyk", "lab"].map(async name =>
    [name, new Uint8Array(await readFile(new URL(`./fixtures/icc/${name}.icc`, import.meta.url)))])
));

try {
  if (scenario) {
    await testIsolatedScenario(scenario);
  } else {
    for (const name of ["default", "lcms", "qcms", "alternate", "none", "custom", "metadata", "hep",
      "qcms-unavailable", "lcms-unavailable", "qcms-wasm-unavailable", "lcms-wasm-unavailable",
      "load-failure", "resource-limit", "aborted",
      "unexpected-error", "malformed-header"]) {
      const child = spawnSync(process.execPath,
        ["--experimental-strip-types", fileURLToPath(import.meta.url), name], { encoding: "utf8", timeout: 20000 });
      assert.equal(child.status, 0, `${name}: ${child.stderr}\n${child.stdout}`);
    }
    await testAssets();
    await testModuleLoading();
    for (const engine of ["lcms", "qcms"]) {
      await testRealColors(engine);
      await testRangesAndImages(engine);
      await testRetainedRendering(engine);
      await testWorker(engine);
      await testLimitsAndCancellation(engine);
    }
    await testLab();
    await testPerProfileFallback();
    await testRetainedValidation();
    await assert.rejects(compile({}, { iccEngine: "unknown" }), /iccEngine/);
    await assert.rejects(compile({ gradient: true }, { iccEngine: "none" }),
      e => e.code === "unsupported-color");
    console.log("Bundled ICC engines, lazy loading, retained colors, worker and failure tests passed.");
  }
} finally {
  hooks.deregister();
}

async function compile(spec = {}, options = {}, opener = openPdf) {
  const diagnostics = [];
  const session = await opener({ kind: "bytes", bytes: fixture(spec) }, {
    ...options, onDiagnostic: diagnostic => diagnostics.push(diagnostic)
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    return { page, diagnostics };
  } finally { await session.close(); }
}

function fixture({ profile = "linear-rgb", range = "", values = "0.5 0.5 0.5", image = false,
  gradient = false, composite = false, noIcc = false, invalidProfile = false, malformedHeader = false,
  mixedProfiles = false } = {}) {
  const components = profile === "linear-gray" ? 1 : profile === "synthetic-cmyk" ? 4 : 3;
  const alternate = profile === "lab" ? "[/Lab << /WhitePoint [0.9642 1 0.8249] /Range [-128 127 -128 127] >>]"
    : components === 1 ? "/DeviceGray" : components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
  const profileBytes = invalidProfile ? profiles[profile].slice(0, 128) : profiles[profile].slice();
  if (invalidProfile) new DataView(profileBytes.buffer, profileBytes.byteOffset).setUint32(0, 128, false);
  if (malformedHeader) profileBytes[36] = 0; // Invalid acsp signature must not invoke either engine.
  const paint = image ? "20 0 0 20 0 0 cm /Im Do" : gradient ? "/Sh sh"
    : mixedProfiles ? `/ICC cs ${values} sc 0 0 10 20 re f /ICC_RGB cs 0.5 0.5 0.5 sc 10 0 10 20 re f /ICC cs ${values} sc 0 0 5 5 re f`
    : noIcc ? "0.5 g 0 0 20 20 re f" : `/ICC cs ${values} sc 0 0 20 20 re f`;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ColorSpace << /ICC [/ICCBased 5 0 R] /ICC_RGB [/ICCBased 9 0 R] >> /XObject << /Im 6 0 R /Fm 8 0 R >> /Shading << /Sh 7 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", composite ? "/Fm Do" : paint) },
    { number: 5, body: tinyPdfStream(`/N ${components} /Alternate ${alternate} ${range ? `/Range [${range}]` : ""}`, profileBytes) },
    { number: 6, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /ICC /BitsPerComponent 8`,
      Uint8Array.from(values.split(" ").map(Number))) },
    { number: 7, body: "<< /ShadingType 2 /ColorSpace /ICC /Coords [0 0 20 0] /Extend [true true] /Function << /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >> >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Group << /S /Transparency /I true >> /Resources << /Shading << /Sh 7 0 R >> /ColorSpace << /ICC [/ICCBased 5 0 R] >> >>", paint) },
    { number: 9, body: tinyPdfStream("/N 3 /Alternate /DeviceRGB", profiles["linear-rgb"]) }
  ] });
}

function paintRgb(page) {
  const command = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands[0];
  const index = page.stores.paints.resourceIndices[command.paintIndex];
  return [...page.stores.colors.parameters.subarray(page.stores.colors.parameterOffsets[index], page.stores.colors.parameterOffsets[index + 1])]
    .map(value => value * 255);
}

function near(actual, expected, tolerance = 2) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance,
    `color ${actual} differs from ${expected} by more than ${tolerance}`));
}

async function testIsolatedScenario(name) {
  assert.equal(loadedEngines.size, 0, "importing parser and renderer must load no engines");
  if (name === "metadata") {
    const session = await openPdf({ kind: "bytes", bytes: fixture() });
    try { assert.equal(session.info.pageCount, 1); } finally { await session.close(); }
    for (const iccEngine of [undefined, "qcms", "lcms", "alternate", "none"]) {
      const { diagnostics } = await compile({ noIcc: true }, { iccEngine });
      assert(!diagnostics.some(d => d.code.startsWith("icc-")));
    }
    assert.equal(loadedEngines.size, 0);
    return;
  }
  if (name === "hep") {
    const { buildHep } = await import("../src/hepBuilder.ts");
    const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
    const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
    // Synthetic empty scene only; never a PDF-to-HEP conversion.
    const blob = await buildHep(composeVectorScenesInGrid([], 1));
    await loadPdfSceneFromSource(blob, { iccEngine: "qcms" });
    assert.equal(loadedEngines.size, 0);
    return;
  }
  if (name === "custom") {
    const { IccEngineError } = await import("../src/pdf/nativeIccWasm.ts");
    for (const iccEngine of [undefined, "qcms", "lcms", "alternate", "none"]) {
      const { page, diagnostics } = await compile({}, { iccEngine, iccTransformResolver: request => ({
        samples: new Uint8Array(request.sampleCount * 3).fill(77), sampleCount: request.sampleCount,
        outputComponents: 3, bitsPerComponent: 8
      }) });
      near(paintRgb(page), [77, 77, 77]);
      assert(!diagnostics.some(d => d.code.startsWith("icc-")));
      await assert.rejects(compile({}, { iccEngine, iccTransformResolver() {
        throw new IccEngineError("profile-unsupported");
      } }), e => e.code === "unsupported-color");
    }
    assert.equal(loadedEngines.size, 0);
    return;
  }
  if (["resource-limit", "aborted", "unexpected-error", "malformed-header"].includes(name)) {
    await assert.rejects(compile({ malformedHeader: name === "malformed-header" }),
      e => name === "unexpected-error" ? /Unexpected adapter error/.test(e.message)
        : e.code === (name === "malformed-header" ? "unsupported-color" : name));
    assert.deepEqual([...loadedEngines], name === "malformed-header" ? [] : ["qcms"]);
    return;
  }
  if (name.endsWith("-unavailable")) {
    const selected = name.split("-")[0];
    const effective = selected === "qcms" ? "lcms" : "qcms";
    const { page, diagnostics } = await compile({}, { iccEngine: selected });
    near(paintRgb(page), [188, 188, 188]);
    assertFallback(diagnostics, selected, effective, [{ engine: selected, reason: "engine-load-failed" }]);
    assert.deepEqual([...loadedEngines], [selected, effective]);
    const image = await compile({ image: true, values: "128 128 128" }, { iccEngine: selected });
    near([...image.page.stores.images.data], [188, 188, 188, 255]);
    assertFallback(image.diagnostics, selected, effective, [{ engine: selected, reason: "engine-load-failed" }]);
    for (const composite of [false, true]) {
      const gradient = await compile({ gradient: true, composite }, { iccEngine: selected });
      const imported = [...loadedEngines];
      near(await render(gradient.page), [192, 192, 192, 255], 4);
      assert.deepEqual([...loadedEngines], imported, "retained rendering must not load another engine");
      assertFallback(gradient.diagnostics, selected, effective, [{ engine: selected, reason: "engine-load-failed" }]);
    }
    if (selected === "lcms") {
      const lab = await compile({ profile: "lab", values: "50 0 0", range: "0 100 -128 127 -128 127" });
      near(paintRgb(lab.page), [119, 119, 119], 3);
      assertFallback(lab.diagnostics, "qcms", "alternate", [
        { engine: "qcms", reason: "profile-unsupported" }, { engine: "lcms", reason: "engine-load-failed" }
      ]);
    }
    return;
  }
  if (name === "load-failure") {
    for (const selected of ["qcms", "lcms"]) {
      const { page, diagnostics } = await compile({}, { iccEngine: selected });
      near(paintRgb(page), [127.5, 127.5, 127.5]);
      assertFallback(diagnostics, selected, "alternate", [selected, selected === "qcms" ? "lcms" : "qcms"]
        .map(engine => ({ engine, reason: "engine-load-failed" })));
    }
    assert.deepEqual([...loadedEngines], ["qcms", "lcms"]);
    return;
  }
  if (name === "none") {
    for (const spec of [{}, { image: true }, { gradient: true }]) {
      await assert.rejects(compile(spec, { iccEngine: "none" }), e => e.code === "unsupported-color");
    }
    assert.equal(loadedEngines.size, 0);
    return;
  }
  const { page, diagnostics } = await compile({}, name === "default" ? {} : { iccEngine: name });
  near(paintRgb(page), name === "alternate" ? [127.5, 127.5, 127.5] : [188, 188, 188]);
  assert.deepEqual([...loadedEngines], name === "alternate" ? [] : [name === "default" ? "qcms" : name]);
  if (name === "alternate") assertFallback(diagnostics, "alternate", "alternate", []);
  else assert(!diagnostics.some(d => d.code.startsWith("icc-")));
}

function assertFallback(diagnostics, engine, effectiveEngine, failures) {
  const warnings = diagnostics.filter(d => d.code.startsWith("icc-"));
  assert.equal(warnings.length, 1, "report one warning per affected color space");
  const warning = warnings[0];
  assert.equal(warning.severity, "warning");
  assert.equal(warning.pageIndex, 0);
  assert.equal(warning.code, effectiveEngine === "alternate" ? "icc-alternate-used" : "icc-engine-fallback");
  assert.equal(warning.details.engine, engine);
  assert.equal(warning.details.effectiveEngine, effectiveEngine);
  for (const engineName of ["qcms", "lcms"]) {
    assert.equal(warning.details[`${engineName}FailureReason`], failures.find(f => f.engine === engineName)?.reason ?? null);
  }
  assert.equal(warning.message.includes("colors may differ"), effectiveEngine === "alternate");
}

async function testRealColors(iccEngine) {
  const cases = [
    [{}, [188, 188, 188]],
    [{ profile: "linear-gray", values: "0.5" }, [188, 188, 188]],
    [{ profile: "srgb", values: "1 0 0" }, [255, 0, 0]],
    [{ profile: "synthetic-cmyk", values: "0 0 0 0" }, [255, 255, 255]],
    [{ profile: "synthetic-cmyk", values: "0 1 1 0" }, [255, 0, 0]],
    [{ profile: "synthetic-cmyk", values: "0.5 0.5 0.5 0.5" }, [64, 64, 64]]
  ];
  for (const [spec, expected] of cases) {
    const { page, diagnostics } = await compile(spec, { iccEngine });
    // qcms's Lab-PCS LUT path loses a few codes near saturated CMYK colors.
    near(paintRgb(page), expected, spec.profile === "synthetic-cmyk" ? 8 : 3);
    assert(!diagnostics.some(d => d.code.startsWith("icc-")), "supported profiles use the selected engine");
  }
  const { diagnostics } = await compile({ invalidProfile: true }, { iccEngine });
  assert.equal(diagnostics.filter(d => d.code === "icc-alternate-used").length, 1);
  assert.equal(diagnostics.find(d => d.code === "icc-alternate-used").details.reason, "profile-unsupported");
  assertFallback(diagnostics, iccEngine, "alternate", [iccEngine, iccEngine === "qcms" ? "lcms" : "qcms"]
    .map(engine => ({ engine, reason: "profile-unsupported" })));
}

async function testRangesAndImages(iccEngine) {
  const { page } = await compile({ range: "0.2 0.8 0.5 0.5 0 1", values: "0 0.1 0.5" }, { iccEngine });
  near(paintRgb(page), [124, 188, 188], 2);
  const image = await compile({ image: true, values: "128 128 128" }, { iccEngine });
  near([...image.page.stores.images.data], [188, 188, 188, 255]);
}

async function render(page) {
  const result = await renderHeprPageToCanvas2d(page, { surfaceFactory(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  } });
  return [...result.surface.context.getImageData(10, 10, 1, 1).data];
}

async function testRetainedRendering(iccEngine) {
  for (const composite of [false, true]) {
    const { page } = await compile({ gradient: true, composite }, { iccEngine });
    const colors = page.stores.colors;
    const index = colors.spaceKinds.indexOf(HEPR_COLOR_SPACE_KIND.IccBased);
    assert.equal(colors.iccModes[index], 3);
    assert(collectHeprTransferables(page).includes(colors.iccTransformSamples.buffer));
    const cloned = structuredClone(page, { transfer: collectHeprTransferables(page) });
    validateHeprPageData(cloned);
    near(await render(cloned), [192, 192, 192, 255], 4);
  }
  const fallback = await compile({ gradient: true }, { iccEngine: "alternate" });
  near(await render(fallback.page), [134, 134, 134, 255], 3);
  assert.equal(fallback.diagnostics.filter(d => d.code === "icc-alternate-used").length, 1);
}

async function testLab() {
  const spec = { profile: "lab", values: "50 0 0", range: "0 100 -128 127 -128 127" };
  const lcms = await compile(spec, { iccEngine: "lcms" });
  near(paintRgb(lcms.page), [119, 119, 119], 3);
  assert.equal(lcms.diagnostics.filter(d => d.code === "icc-alternate-used").length, 0);
  const qcms = await compile(spec, { iccEngine: "qcms" });
  near(paintRgb(qcms.page), [119, 119, 119], 3);
  assertFallback(qcms.diagnostics, "qcms", "lcms", [{ engine: "qcms", reason: "profile-unsupported" }]);
  const index = qcms.page.stores.colors.spaceKinds.indexOf(HEPR_COLOR_SPACE_KIND.IccBased);
  assert.equal(qcms.page.stores.colors.iccModes[index], 4);
}

async function testPerProfileFallback() {
  const diagnostics = [];
  const session = await openPdf({ kind: "bytes", bytes: fixture({ profile: "lab", values: "50 0 0",
    range: "0 100 -128 127 -128 127", mixedProfiles: true }) }, {
    onDiagnostic: diagnostic => diagnostics.push(diagnostic)
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    assert(page.stores.colors.iccModes.includes(3), "RGB profile retains a device transform");
    assert(page.stores.colors.iccModes.includes(4), "Lab profile retains its fallback engine transform");
    await session.compileVectorPage(0, { optimization: "none" });
    for (const entries of [diagnostics, session.getDiagnostics()]) {
      assertFallback(entries, "qcms", "lcms", [{ engine: "qcms", reason: "profile-unsupported" }]);
    }
  } finally { await session.close(); }
}

async function testWorker(iccEngine) {
  const code = `import { registerHooks } from 'node:module';
    registerHooks({resolve(s,c,n){return n(c.parentURL?.includes('/src/')&&/^\\.\\.?\\//.test(s)&&!s.endsWith('.ts')?s+'.ts':s,c)}});
    await import(${JSON.stringify(new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url).href)});`;
  const opener = (source, options) => openPdfInNodeWorker(source, { ...options,
    workerUrl: new URL(`data:text/javascript,${encodeURIComponent(code)}`) });
  const { page } = await compile({ gradient: true }, { iccEngine }, opener);
  near(await render(page), [192, 192, 192, 255], 4);
  if (iccEngine === "qcms") {
    const fallback = await compile({ profile: "lab", values: "50 0 0", range: "0 100 -128 127 -128 127" },
      { iccEngine }, opener);
    near(paintRgb(fallback.page), [119, 119, 119], 3);
    assertFallback(fallback.diagnostics, "qcms", "lcms", [{ engine: "qcms", reason: "profile-unsupported" }]);
  }
}

async function testLimitsAndCancellation(iccEngine) {
  await assert.rejects(compile({}, { iccEngine, limits: { maxIccTransformBytes: 1 } }), e => e.code === "resource-limit");
  const session = await openPdf({ kind: "bytes", bytes: fixture({ profile: "synthetic-cmyk", values: "0 0 0 0" }) }, { iccEngine });
  const controller = new AbortController();
  try {
    const pending = session.compilePage(0, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(pending, e => e.code === "aborted" || e.name === "AbortError");
  } finally { await session.close(); }
  // Fresh instances must not overwrite each other's output across async batches.
  const pages = await Promise.all([compile({}, { iccEngine }), compile({ values: "1 0 0" }, { iccEngine })]);
  near(paintRgb(pages[0].page), [188, 188, 188]);
  near(paintRgb(pages[1].page), [255, 0, 0], 3);
}

async function testRetainedValidation() {
  const { page } = await compile();
  const index = page.stores.colors.spaceKinds.indexOf(HEPR_COLOR_SPACE_KIND.IccBased);
  for (const mutate of [
    colors => { colors.iccModes[index] = 9; },
    colors => { colors.iccTransformSamples = colors.iccTransformSamples.subarray(1); },
    colors => { colors.iccModes[index] = 1; },
    colors => { colors.parameterOffsets[index + 1] -= 1; }
  ]) {
    const bad = structuredClone(page);
    mutate(bad.stores.colors);
    assert.throws(() => validateHeprPageData(bad));
  }
}

async function testAssets() {
  const manifest = JSON.parse(await readFile(new URL("../src/assets/color/icc/manifest.json", import.meta.url), "utf8"));
  for (const [name, entry] of Object.entries(manifest)) {
    const bytes = await readFile(new URL(`../src/assets/color/icc/${name}.wasm`, import.meta.url));
    assert.equal(bytes.length, entry.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert(WebAssembly.validate(bytes));
    const module = await WebAssembly.compile(bytes);
    const imports = {};
    for (const item of WebAssembly.Module.imports(module)) {
      assert.equal(item.kind, "function");
      (imports[item.module] ??= {})[item.name] = () => 0;
    }
    // Instantiation without calling the engine is enough to inspect the actual
    // memory cap. The rejected grow allocates no extra memory.
    const instance = new WebAssembly.Instance(module, imports);
    const memory = instance.exports.memory;
    assert.throws(() => memory.grow(4097 - memory.buffer.byteLength / 65536), RangeError);
  }
}

async function testModuleLoading() {
  const { createIccModuleLoader } = await import("../src/pdf/nativeIccWasm.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const originalFetch = globalThis.fetch;
  const minimalModule = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  let requests = 0, finish;
  const loader = createIccModuleLoader(new URL("https://icc.invalid/test.wasm"), minimalModule.length);
  try {
    globalThis.fetch = async () => { requests += 1; throw new Error("network unavailable"); };
    await assert.rejects(loader(), e => e.details.reason === "engine-load-failed");
    for (const failure of [new RangeError("allocation failed"), new PdfError("resource-limit", "limit"),
      new PdfError("aborted", "cancelled")]) {
      globalThis.fetch = async () => { throw failure; };
      await assert.rejects(loader(), e => e.code === (failure instanceof RangeError ? "resource-limit" : failure.code));
    }
    globalThis.fetch = () => { requests += 1; return new Promise(resolve => { finish = resolve; }); };
    const controller = new AbortController();
    const cancelled = loader(controller.signal), shared = loader();
    controller.abort();
    await assert.rejects(cancelled, e => e.code === "aborted");
    finish(new Response(minimalModule));
    assert(await shared instanceof WebAssembly.Module);
    assert.strictEqual(await loader(), await shared);
    assert.equal(requests, 2, "failed load retries; concurrent and subsequent requests share compiled code");
  } finally { globalThis.fetch = originalFetch; }
}
