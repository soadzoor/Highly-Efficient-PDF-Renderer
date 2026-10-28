import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const loaded = [];
const hooks = registerHooks({ resolve(specifier, context, next) {
  loaded.push(specifier);
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { preparePrintPdf, printPdfBlob } = await import("../src/pdfPrint.ts");
  assert(!loaded.some(value => /nativeDocument|editorPdfWriter|editorSession|editorUi/.test(value)), "the iframe print helper loads without parser, writer or editor runtime");
  const pdfBlob = new Blob(["PDF"], { type: "application/pdf" });
  class Target extends EventTarget {
    counts = new Map();
    addEventListener(type, fn, options) { super.addEventListener(type, fn, options); this.counts.set(type, (this.counts.get(type) ?? 0) + 1); }
    removeEventListener(type, fn, options) { super.removeEventListener(type, fn, options); this.counts.set(type, Math.max(0, (this.counts.get(type) ?? 0) - 1)); }
  }
  function browser(target) {
    const owner = new Target(), frames = [], anchors = [], urls = [], revoked = [], timers = [], events = [];
    Object.assign(owner, { URL: { createObjectURL(blob) { const url = `blob:${urls.length}`; urls.push({ blob, url }); return url; }, revokeObjectURL(url) { revoked.push(url); } },
      setTimeout(fn) { timers.push(fn); } });
    const document = { defaultView: owner, body: { append(value) { value.appended = true; } }, createElement(tag) {
      const element = Object.assign(new Target(), { style: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, remove() { this.removed = (this.removed ?? 0) + 1; } });
      if (tag === "iframe") { element.contentWindow = target; frames.push(element); }
      else { element.click = () => events.push([element.download, element.href]); anchors.push(element); }
      return element;
    } };
    return { owner, document, frames, anchors, urls, revoked, timers, events, flush() { for (const fn of timers.splice(0)) fn(); } };
  }
  {
    let prints = 0, focused = 0;
    const target = Object.assign(new Target(), { focus() { focused++; }, print() { prints++; } }), host = browser(target);
    printPdfBlob(pdfBlob, host.document, { filename: "report.pdf", title: "Print report" });
    const frame = host.frames[0]; assert.equal(frame.appended, true); assert.match(frame.style.cssText, /position:fixed/);
    assert.match(frame.style.cssText, /left:-10000px/); assert.equal(frame.attributes.title, "Print report");
    frame.dispatchEvent(new Event("load")); assert.equal(prints, 1); assert.equal(focused, 1); assert.equal(host.revoked.length, 0, "the PDF remains alive while its print viewer owns it");
    target.dispatchEvent(new Event("afterprint")); host.owner.dispatchEvent(new Event("afterprint")); frame.dispatchEvent(new Event("error"));
    assert.equal(frame.removed, 1); assert.deepEqual(host.revoked, ["blob:0"]); assert.equal(host.anchors.length, 0);
    assert.equal(host.owner.counts.get("afterprint"), 0, "cleanup removes the owner-window listener");
    assert.equal(target.counts.get("afterprint"), 0, "cleanup removes the embedded viewer listener");
  }
  for (const reason of ["missing", "throws", "error"]) {
    const target = reason === "missing" ? null : Object.assign(new Target(), { focus() {}, print() { if (reason === "throws") throw new Error("Print unavailable"); } });
    const host = browser(target); printPdfBlob(pdfBlob, host.document, { filename: "vector-print.pdf" });
    host.frames[0].dispatchEvent(new Event(reason === "error" ? "error" : "load"));
    host.frames[0].dispatchEvent(new Event("error")); host.owner.dispatchEvent(new Event("afterprint"));
    assert.deepEqual(host.events, [["vector-print.pdf", "blob:1"]], `${reason}: unavailable printing downloads one PDF`);
    assert.equal(host.frames[0].removed, 1); assert.equal(host.anchors[0].removed, 1); host.flush();
    assert.deepEqual(host.revoked, ["blob:0", "blob:1"], "both print and fallback URLs are released exactly once");
  }
  {
    const host = browser(null); printPdfBlob(pdfBlob, host.document); host.frames[0].dispatchEvent(new Event("load"));
    assert.equal(host.events[0][0], "print.pdf"); host.flush();
    assert.throws(() => printPdfBlob(pdfBlob, { defaultView: null }), /browser window/);
  }

  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const original = fixture(), before = original.slice(), source = new Blob([original], { type: "application/pdf" });
  const open = (bytes, password) => NativePdfDocument.open({ kind: "bytes", bytes }, { password, repair: "off" });
  const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
  const inspect = async (blob, expectedPages) => {
    const document = await open(await bytes(blob));
    try {
      assert.equal(document.pages.length, expectedPages.length); assert.equal(document.getWriterState().protection, undefined);
      for (let index = 0; index < expectedPages.length; index++) {
        const sourceIndex = expectedPages[index]; assert.deepEqual(document.pages[index].mediaBox, [0, 0, 100 + sourceIndex * 10, 80]);
        const content = (await document.getDecodedPageContents(index)).map(value => Buffer.from(value).toString()).join("");
        assert.equal(content, `0 ${sourceIndex / 3} 1 rg 10 10 20 20 re f`);
        const resources = await document.resolveDictionary(document.pages[index].resources), fonts = await document.resolveDictionary(resources.get("Font"));
        const font = await document.resolveDictionary(fonts.get("F")), descriptor = await document.resolveDictionary(font.get("FontDescriptor"));
        const fontFile = await document.resolveValue(descriptor.get("FontFile2"));
        assert.deepEqual(await document.decodeStream(fontFile), buildTinySfnt(), "print preparation preserves exact embedded font programs");
      }
    } finally { await document.close(); }
  };
  const progress = [], selectedProgress = [], encryptedProgress = [];
  assert.equal(await preparePrintPdf({ sourcePdf: { label: "report", blob: source } }, { onProgress: value => progress.push(value) }), source, "plain all-page printing reuses the original PDF blob");
  assert.deepEqual(await bytes(await preparePrintPdf({ sourcePdf: { label: "report", bytes: original }, pages: "3, 1-2, 2" })), original, "all-page selections retain byte-identical source PDF");
  await inspect(await preparePrintPdf({ sourcePdf: { label: "report", bytes: original }, pages: "3, 1" }, { onProgress: value => selectedProgress.push(value) }), [0, 2]);
  const document = await open(original); let protectedBytes;
  try { protectedBytes = await new NativePdfWriter(document).save(undefined, { protection: { mode: "password", password: "secret", ownerPassword: "owner secret" } }); }
  finally { await document.close(); }
  const protectedBefore = protectedBytes.slice();
  for (const password of ["secret", "owner secret"]) await inspect(await preparePrintPdf({ sourcePdf: { label: "protected", bytes: protectedBytes }, password }), [0, 1, 2]);
  await inspect(await preparePrintPdf({ sourcePdf: { label: "protected", bytes: protectedBytes }, password: "secret", pages: "2-" }, { onProgress: value => encryptedProgress.push(value) }), [1, 2]);
  await assert.rejects(preparePrintPdf({ sourcePdf: { label: "protected", bytes: protectedBytes }, password: "wrong" }), error => error.code === "encrypted" && error.details.reason === "password-incorrect");
  for (const pages of ["0", "4", "2-1", "1,,2"]) await assert.rejects(preparePrintPdf({ sourcePdf: { label: "report", bytes: original }, pages }), RangeError);
  assert.deepEqual(original, before); assert.deepEqual(protectedBytes, protectedBefore, "ephemeral decryption never changes source bytes");
  await assert.rejects(preparePrintPdf({ sourcePdf: { label: "HTML", blob: new Blob(["<html>not a pdf</html>"], { type: "text/html" }) } }), /received HTML/);
  await assert.rejects(preparePrintPdf({}), /No PDF or scene/);
  await assert.rejects(preparePrintPdf({ sourcePdf: { label: "report", bytes: original } }, { signal: AbortSignal.abort() }), { name: "AbortError" });
  const nativeFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.cache, "no-store"); assert(options.signal);
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    };
    const controller = new AbortController(), pending = preparePrintPdf({ sourcePdf: { label: "remote", url: "https://invalid.test/report.pdf" } }, { signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { name: "AbortError" });
    globalThis.fetch = async () => new Response(original, { headers: { "content-type": "application/pdf" } });
    await inspect(await preparePrintPdf({ sourcePdf: { label: "remote", url: "https://invalid.test/report.pdf" }, pages: "2" }), [1]);
  } finally { globalThis.fetch = nativeFetch; }

  const { openPdf } = await import("../src/pdfSession.ts"), { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildHep } = await import("../src/hepBuilder.ts"), { loadSceneFromHep } = await import("../src/hepReader.ts");
  const parser = await openPdf({ kind: "bytes", bytes: original }); let scene;
  try {
    const scenes = [];
    for (let index = 0; index < 3; index++) scenes.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true, vectorFallback: "error" }));
    scene = composeVectorScenesInGrid(scenes, 2);
  } finally { await parser.close(); }
  const hep = await buildHep(scene, { withVectorLod: false, withTextLod: false, encodeRasterImages: false });
  const hepScene = await loadSceneFromHep(await hep.arrayBuffer()), sceneProgress = [];
  const rendered = await preparePrintPdf({ scene: hepScene }, { onProgress: value => sceneProgress.push(value) });
  const renderedDocument = await open(await bytes(rendered));
  try {
    assert.equal(renderedDocument.pages.length, 3);
    for (let index = 0; index < 3; index++) {
      const content = (await renderedDocument.getDecodedPageContents(index)).map(value => Buffer.from(value).toString()).join("");
      assert(content.includes("f\n"), "HEP-to-print retains vector fills"); assert(!content.includes(" Do"), "vector-only pages are not rasterized for print");
      assert.deepEqual(renderedDocument.pages[index].mediaBox, [0, 0, 100 + index * 10, 80]);
    }
  } finally { await renderedDocument.close(); }
  for (const values of [progress, selectedProgress, encryptedProgress, sceneProgress]) {
    assert.equal(values[0].value, 0); assert.equal(values.at(-1).value, 1); assert.equal(values.at(-1).stage, "complete");
    for (let index = 1; index < values.length; index++) assert(values[index].value >= values[index - 1].value, "print preparation progress is monotonic");
  }
  console.log("PDF print: owner-window iframe/fallback cleanup, lazy runtime, original/selected/encrypted PDF preservation, cancellation and vector HEP printing passed.");
} finally { hooks.deregister(); }

function fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /Resources << /Font << /F 9 0 R >> >> >>" },
    ...[0, 1, 2].map(index => ({ number: 3 + index, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${100 + index * 10} 80] /Contents ${6 + index} 0 R >>` })),
    ...[0, 1, 2].map(index => ({ number: 6 + index, body: tinyPdfStream("", `0 ${index / 3} 1 rg 10 10 20 20 re f`) })),
    { number: 9, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 10 0 R >>" },
    { number: 10, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 11 0 R >>" },
    { number: 11, body: tinyPdfStream("", buildTinySfnt()) }
  ] });
}
