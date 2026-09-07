import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

try {
  assert.equal(sceneFingerprint(Uint8Array.of(1, 2)), sceneFingerprint(Uint8Array.of(9, 1, 2, 9).subarray(1, 3)));
  assert.notEqual(sceneFingerprint(Uint8Array.of(1, 2)), sceneFingerprint(Uint8Array.of(1, 3)));
  assert.throws(() => sceneFingerprint(new Map([["pixels", [1, 2]]])), /plain objects/);
  const { openPdf } = await import("../src/pdfSession.ts");
  for (const withForm of [false, true]) {
    const source = fixture(withForm);
    const snapshot = source.slice();
    const counts = { codecs: [], fonts: 0 };
    const samples = [];
    const session = await openPdf({ kind: "bytes", bytes: source }, {
      missingFontResolver() {
        counts.fonts += 1;
        return { identifier: "reuse-fixture-font", sfntBytes: buildTinySfnt() };
      },
      imageCodecResolver(request, signal) {
        signal.throwIfAborted();
        counts.codecs.push(request.components);
        const pixel = request.components === 3 ? [255, 32, 16] : [0, 255, 255, 0];
        const data = Uint8Array.from({ length: request.width * request.height * request.components },
          (_, index) => pixel[index % pixel.length]);
        samples.push({ data, snapshot: data.slice() });
        return { samples: data, width: request.width, height: request.height,
          components: request.components, bitsPerComponent: 8 };
      }
    });
    try {
      const without = await session.compileVectorPageWithTimings(0, {}, { reusePageResources: false });
      const expectedHash = sceneFingerprint(without.scene);
      const oldCodecCount = counts.codecs.length;
      const oldFontCount = counts.fonts;
      counts.codecs.length = 0;
      counts.fonts = 0;
      const reused = await session.compileVectorPageWithTimings(0);
      assert.equal(sceneFingerprint(reused.scene), expectedHash, "reuse preserves every scene field and pixel");
      assert.equal(counts.fonts, 1);
      assert.equal(oldFontCount, counts.fonts * 2, "the second pass must not prepare the font again");
      assert.deepEqual(counts.codecs, withForm ? [3, 4] : [3], "image aliases remain resource-scope local");
      assert.equal(oldCodecCount, counts.codecs.length * 2, "codec calls are no longer doubled");
      assert.equal(reused.timings.selectiveCompilation.preparedFonts, 0);
      assert.equal(reused.timings.selectiveCompilation.decodedImages, 0,
        "reused root, mask, scoped Form, and inline-image records are not decoded again");
      assert.equal(reused.timings.selectiveCompilation.resourceLoadMs, 0);
      assert.equal(without.timings.selectiveCompilation.decodedImages, reused.timings.decodedImages);

      const perOperationCalls = counts.codecs.length;
      await session.compileVectorPage(1);
      assert.equal(counts.codecs.length, perOperationCalls * 2, "resources cannot leak across source pages");
      assert.equal(sceneFingerprint(reused.scene), expectedHash, "later operations cannot mutate returned scenes");
      await assert.rejects(session.compileVectorPage(0, { limits: { maxDecodedStreamBytes: 8 } }),
        error => error?.code === "resource-limit");

      const aborted = new AbortController();
      let starts = 0;
      await assert.rejects(session.compileVectorPage(0, {
        signal: aborted.signal,
        onProgress(event) {
          if (event.stage === "content" && event.completed === 0 && ++starts === 2) aborted.abort();
        }
      }), error => error?.code === "aborted");
      assert.equal(starts, 2, "cancellation must occur after preparation, at the second pass");
      const beforeRetry = counts.codecs.length;
      assert.equal(sceneFingerprint(await session.compileVectorPage(0)), expectedHash);
      assert.equal(counts.codecs.length - beforeRetry, perOperationCalls,
        "a cancelled operation cannot retain a usable resource cache");
      const changingOptions = {
        limits: { maxDecodedStreamBytes: 1024 * 1024 },
        onProgress(event) {
          if (event.stage === "content") changingOptions.limits.maxDecodedStreamBytes = 8;
        }
      };
      assert.equal(sceneFingerprint(await session.compileVectorPage(0, changingOptions)), expectedHash,
        "the two passes use the same operation-owned limits snapshot");
      await assert.rejects(session.compileVectorPage(0, changingOptions), error => error?.code === "resource-limit",
        "the next operation must honor the newly lowered limit");
      const beforeQueued = counts.codecs.length;
      const queued = await Promise.all([session.compileVectorPage(0), session.compileVectorPage(0)]);
      for (const scene of queued) assert.equal(sceneFingerprint(scene), expectedHash);
      assert.equal(counts.codecs.length - beforeQueued, perOperationCalls * 2,
        "queued compilations own separate preparation caches");
      for (const item of samples) assert.deepEqual(item.data, item.snapshot, "caller-owned codec samples stay intact");
      assert.deepEqual(source, snapshot, "caller-owned PDF bytes stay intact");
    } finally {
      await session.close();
    }
    await assert.rejects(session.compileVectorPage(0), error => error?.code === "closed");
  }
  console.log("native operation-scoped resource reuse tests passed");
} finally {
  hooks.deregister();
}

function fixture(withForm) {
  const resources = "/Resources << /Font << /F1 7 0 R >> /ColorSpace << /Alias /DeviceRGB >> /XObject << /Im 5 0 R /Fm 8 0 R >> >>";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 9 0 R] >>" },
    ...[3, 9].map(number => ({ number, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 110 30] ${resources} /Contents 4 0 R >>` })),
    { number: 4, body: tinyPdfStream("", "q 5 5 10 10 re W n 0 20 -20 0 20 0 cm /Im Do Q " +
      (withForm ? "q 1 0 0 1 30 0 cm /Fm Do Q " : "") + "BT /F1 8 Tf 0 22 Td (A) Tj ET") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /Alias /BitsPerComponent 8 /Filter /DCTDecode /SMask 6 0 R", Uint8Array.of(255, 216, 255, 217)) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(0, 255, 128, 255)) },
    { number: 7, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << /ColorSpace << /Alias /DeviceCMYK >> /Font << /Local 7 0 R >> /XObject << /Im 5 0 R >> >>",
      "q 20 0 0 20 0 0 cm /Im Do Q q 5 0 0 5 10 10 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID " +
      String.fromCharCode(10, 20, 30) + " EI Q BT /Local 5 Tf 1 1 Td (A) Tj ET") }
  ] });
}
