import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

class RecordingBlob extends Blob {
  async arrayBuffer() {
    this.lastRead = await super.arrayBuffer();
    return this.lastRead;
  }
}

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
const originalStructuredClone = globalThis.structuredClone;
const transfers = [];
globalThis.structuredClone = (value, options) => {
  if (value instanceof Uint8Array && options?.transfer?.includes(value.buffer) &&
      value[0] === 0x25 && value[1] === 0x50 && value[2] === 0x44 && value[3] === 0x46) {
    transfers.push({ bytes: value, byteLength: value.byteLength });
  }
  return originalStructuredClone(value, options);
};
try {
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
  const pdf = vectorPdf();
  const padded = new Uint8Array(pdf.length + 12).fill(0xa5);
  padded.set(pdf, 5);
  const subarray = padded.subarray(5, 5 + pdf.length);
  const typedSource = pdf.slice(), bufferSource = pdf.slice().buffer;
  const blob = new RecordingBlob([pdf], { type: "application/pdf" });
  for (const source of [typedSource, subarray, bufferSource, blob]) {
    const before = transfers.length;
    const loaded = await loadPdfSceneFromSource(source, { segmentMerge: false, invisibleCull: false });
    assert.equal(loaded.sourceKind, "pdf");
    assert.equal(loaded.scene.segmentCount, 1);
    assert.deepEqual(loaded.sourceBytes, pdf, "retained bytes remain complete after worker parsing");
    assert.equal(loaded.sourceBytes.byteLength, pdf.byteLength);
    const parseTransfers = transfers.slice(before);
    assert.equal(parseTransfers.length, 1, "the loader transfers its disposable parse buffer once");
    assert.equal(parseTransfers[0].byteLength, pdf.byteLength);
    assert.equal(parseTransfers[0].bytes.buffer.byteLength, 0, "the parser takes ownership of its internal buffer");
    assert.notEqual(parseTransfers[0].bytes.buffer, loaded.sourceBytes.buffer);
    if (source instanceof Uint8Array) {
      assert.deepEqual(source, pdf, "caller-owned typed bytes stay attached and unchanged");
      assert.notEqual(loaded.sourceBytes.buffer, source.buffer, "retained ownership is isolated from the caller");
    } else if (source instanceof ArrayBuffer) {
      assert.deepEqual(new Uint8Array(source), pdf, "caller-owned ArrayBuffer stays attached and unchanged");
      assert.notEqual(loaded.sourceBytes.buffer, source);
    } else {
      assert.equal(loaded.sourceBytes.buffer, blob.lastRead,
        "a fresh Blob arrayBuffer becomes retained source storage without another copy");
      assert.deepEqual(new Uint8Array(await Blob.prototype.arrayBuffer.call(blob)), pdf);
    }
  }
  assert(padded.subarray(0, 5).every(value => value === 0xa5));
  assert(padded.subarray(5 + pdf.length).every(value => value === 0xa5), "subarray loading preserves its backing-buffer margins");

  const callerBuffer = pdf.slice().buffer;
  const beforeDefault = transfers.length;
  const pages = await extractPdfPageScenes(callerBuffer, { enableSegmentMerge: false, enableInvisibleCull: false });
  assert.equal(pages.length, 1); assert.equal(pages[0].segmentCount, 1);
  assert.deepEqual(new Uint8Array(callerBuffer), pdf, "default extraction preserves caller ownership");
  assert.equal(transfers.length, beforeDefault, "default extraction does not take caller-buffer ownership");

  const disposable = pdf.slice().buffer;
  await extractPdfPageScenes(disposable, {}, undefined, "transfer");
  assert.equal(disposable.byteLength, 0, "explicit internal ownership permits moving a disposable parse buffer");

  const samples = Uint8Array.of(10, 20, 30), requests = [];
  const image = imagePdf();
  const loaded = await loadPdfSceneFromSource(image, {
    imageCodecResolver(request, signal) {
      assert.equal(signal?.aborted, false);
      assert.equal(request.codec, "jpeg");
      assert.equal(request.width, 1); assert.equal(request.height, 1);
      assert.equal(request.components, 3); assert.equal(request.bitsPerComponent, 8);
      assert.deepEqual([...request.encoded], [0xff, 0xd8, 0xff, 0xd9]);
      requests.push(request);
      return { samples, width: 1, height: 1, components: 3, bitsPerComponent: 8 };
    }
  });
  assert.equal(requests.length, 1, "the loader forwards custom codec callbacks through the real Node worker");
  assert(loaded.scene.rasterLayers.some(layer => layer.width === 1 && layer.height === 1 && layer.data.length === 4 &&
    layer.data.every((value, index) => value === [10, 20, 30, 255][index])),
  "resolved image samples reach the loaded scene");
  assert.deepEqual([...samples], [10, 20, 30], "worker codec transport preserves caller-owned samples");
  assert.deepEqual(loaded.sourceBytes, image);
  assert.deepEqual(image, imagePdf(), "custom-codec parsing preserves the caller's original PDF");
  console.log("PDF source ownership: typed views, ArrayBuffer, fresh Blob storage, disposable worker transfer and loader codec forwarding passed");
} finally {
  globalThis.structuredClone = originalStructuredClone;
  hooks.deregister();
}

function vectorPdf() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0 0 m 10 10 l S") }
  ] });
}

function imagePdf() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Im 5 0 R /Alias 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Im Do /Alias Do") },
    { number: 5, body: tinyPdfStream(
      "/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode",
      Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)) }
  ] });
}
