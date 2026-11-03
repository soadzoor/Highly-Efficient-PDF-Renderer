import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });

try {
  const { insertEditorDocumentFiles, insertEditorPdfFiles } = await import("../src/editorPagesUi.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { openPdf } = await import("../src/pdfSession.ts");

  async function page(width, height, color) {
    const scene = await compileEditorObjectGeometry({ id: color, kind: "shape", shape: "rectangle", pageIndex: 0,
      transform: [1, 0, 0, 1, 0, 0], x: 5, y: 6, width: 20, height: 10, fill: color, color, strokeWidth: 0 });
    scene.pageRects = Float32Array.of(0, 0, width, height);
    scene.pageBounds = scene.bounds = { minX: 0, minY: 0, maxX: width, maxY: height };
    return scene;
  }
  const hep = await buildHep(composeVectorScenesInGrid([await page(80, 50, "red"), await page(30, 90, "blue")], 2),
    { compression: "store", withVectorLod: false, withTextLod: false, encodeRasterImages: false });
  const first = new File([pdfFixture(11, 13)], "first.pdf", { type: "application/pdf" });
  const middle = new File([hep], "middle.hep", { type: "application/x-hep" });
  const last = new File([pdfFixture(17, 19)], "last.pdf", { type: "application/pdf" });
  const imports = [], diagnostics = [], progress = []; let count = 3;
  const session = { getPages: () => Array.from({ length: count }), async insertPdf(bytes, options) {
    options.signal.throwIfAborted();
    const document = await NativePdfDocument.open({ kind: "bytes", bytes }, { password: options.password, signal: options.signal });
    try {
      imports.push({ at: options.at, dimensions: document.pages.map(page => [page.mediaBox[2] - page.mediaBox[0], page.mediaBox[3] - page.mediaBox[1]]), bytes });
      count += document.pages.length;
    } finally { await document.close(); }
    options.onDiagnostic?.({ code: "pages.import-fixture", severity: "warning", message: "Imported sample." });
    options.onProgress?.({ value: .3, stage: "compile", sourceType: "pdf" });
    options.onProgress?.({ value: 1, stage: "complete", sourceType: "pdf" });
  } };
  await insertEditorDocumentFiles(session, [first, middle, last], 1, { signal: new AbortController().signal,
    onDiagnostic: event => diagnostics.push(event), onProgress: event => progress.push(event) });
  assert.deepEqual(imports.map(item => item.at), [1, 2, 4], "mixed imports retain drop order and advance by every inserted page");
  assert.deepEqual(imports.map(item => item.dimensions), [[[11, 13]], [[80, 50], [30, 90]], [[17, 19]]],
    "HEP conversion retains all pages and their native dimensions");
  assert.equal(count, 7);
  assert.deepEqual(diagnostics.filter(event => event.code === "pages.import-fixture").map(event => event.message),
    ["first.pdf: Imported sample.", "middle.hep: Imported sample.", "last.pdf: Imported sample."], "diagnostics retain original filenames after HEP conversion");
  assert(progress.some(event => event.sourceType === "hep"), "HEP decoding contributes progress");
  assert.equal(progress.at(-1).value, 1);
  for (let index = 1; index < progress.length; index++) assert(progress[index].value >= progress[index - 1].value,
    `conversion and per-file insertion progress stay monotonic: ${progress[index - 1].value} -> ${progress[index].value}`);
  const parser = await openPdf({ kind: "bytes", bytes: imports[1].bytes });
  try {
    assert.equal(parser.info.pageCount, 2);
    for (let index = 0; index < 2; index++) {
      const converted = await parser.compileVectorPage(index, { optimization: "none" });
      assert(converted.fillPathCount > 0, "HEP paint remains vector geometry in the attached PDF");
      assert.equal(converted.rasterLayers.length, 0, "ordinary vector HEP pages are not rasterized during attachment");
    }
  } finally { await parser.close(); }

  const attempts = [], prompts = [], locked = new File([Uint8Array.of(1)], "locked.pdf"), plain = new File([Uint8Array.of(2)], "plain.pdf");
  let passwordCount = 2;
  const passwordSession = { getPages: () => Array.from({ length: passwordCount }), async insertPdf(bytes, options) {
    attempts.push({ bytes, password: options.password, at: options.at });
    if (bytes[0] === 1 && options.password !== "right") throw Object.assign(new Error("Password required"),
      { code: "encrypted", details: { reason: options.password ? "password-incorrect" : "password-required" } });
    passwordCount++;
  } };
  await insertEditorDocumentFiles(passwordSession, [locked, plain], 2, { signal: new AbortController().signal,
    requestPassword: async prompt => { prompts.push(prompt); return prompts.length === 1 ? "wrong" : "right"; } });
  assert.deepEqual(attempts.map(item => [item.at, item.password]), [[2, undefined], [2, "wrong"], [2, "right"], [3, undefined]]);
  assert(attempts.slice(0, 3).every(item => item.bytes === attempts[0].bytes), "password retries reuse the same imported PDF bytes");
  assert.deepEqual(prompts.map(prompt => [prompt.label, prompt.retry]), [["locked.pdf", false], ["locked.pdf", true]]);
  passwordCount = 2;
  await assert.rejects(insertEditorDocumentFiles(passwordSession, [plain, locked], 0, { signal: new AbortController().signal,
    requestPassword: async () => null }), { name: "AbortError" });
  assert.equal(passwordCount, 3, "cancelling a later locked file retains earlier completed insertions");
  passwordCount = 2;
  await assert.rejects(insertEditorDocumentFiles(passwordSession, [plain, new File(["invalid HEP"], "invalid.hep")], 0,
    { signal: new AbortController().signal }), /HEP|archive|container/i);
  assert.equal(passwordCount, 3, "a malformed later HEP preserves earlier completed PDF insertions");

  let legacyHepInserted = 0;
  await insertEditorDocumentFiles({ getPages: () => [], async insertPdf(bytes) {
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-"); legacyHepInserted++;
  } }, [new File([hep], "legacy.zip", { type: "application/zip" })], 0, { signal: new AbortController().signal });
  assert.equal(legacyHepInserted, 1, "the accepted legacy ZIP filename routes through HEP conversion");

  let insertions = 0, reads = 0;
  const noInsert = { getPages: () => [], async insertPdf() { insertions++; } };
  const unread = { name: "unread.pdf", type: "application/pdf", async arrayBuffer() { reads++; return new ArrayBuffer(0); } };
  await assert.rejects(insertEditorDocumentFiles(noInsert, [unread], 0, { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(reads, 0); assert.equal(insertions, 0, "pre-cancelled attachment performs no file work");
  let finishRead, announceRead;
  const readStarted = new Promise(resolve => { announceRead = resolve; });
  const delayed = { ...unread, async arrayBuffer() { announceRead(); return new Promise(resolve => { finishRead = resolve; }); } };
  const canceledRead = new AbortController(), pendingRead = insertEditorDocumentFiles(noInsert, [delayed], 0, { signal: canceledRead.signal });
  await readStarted; canceledRead.abort(); finishRead(pdfFixture(11, 13).buffer);
  await assert.rejects(pendingRead, { name: "AbortError" }); assert.equal(insertions, 0, "cancellation while reading cannot publish a stale insertion");
  const canceledHep = new AbortController(); let hepProgress = false;
  await assert.rejects(insertEditorDocumentFiles(noInsert, [middle], 0, { signal: canceledHep.signal,
    onProgress(event) { if (event.sourceType === "hep") { hepProgress = true; canceledHep.abort(); } } }), { name: "AbortError" });
  assert(hepProgress); assert.equal(insertions, 0, "cancelling HEP decoding leaves the active document unchanged");
  await assert.rejects(insertEditorDocumentFiles(noInsert, [unread, new File(["image"], "picture.png", { type: "image/png" })], 0,
    { signal: new AbortController().signal }), /PDF|HEP|supported/i);
  assert.equal(insertions, 0, "the document attachment API rejects image files before PDF insertion");
  assert.equal(reads, 0, "unsupported batches are rejected before reading otherwise supported files");
  await insertEditorDocumentFiles(noInsert, [], 0, { signal: new AbortController().signal });
  assert.equal(insertions, 0, "an empty attachment list has no side effects");

  let legacyInserted = 0;
  await insertEditorPdfFiles({ getPages: () => [], async insertPdf(bytes) { assert.deepEqual(bytes, Uint8Array.of(2)); legacyInserted++; } },
    [plain], 0, { signal: new AbortController().signal });
  assert.equal(legacyInserted, 1, "the existing PDF page-dialog import API retains its behavior");
  console.log("Editor document imports: mixed PDF/HEP ordering, vector conversion, progress, diagnostics, password retries and cancellation passed.");
} finally { hooks.deregister(); }

function pdfFixture(width, height) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << >> >>` },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 1 1 3 4 re f") }
  ] });
}
