// Synthetic scenes only: no PDF conversion, corpus assets, or servers.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { HepArchive, hasHepSignature } from "../src/hepContainer.ts";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const builder = await import("../src/hepBuilder.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { tryReadSourcePdfBytesFromExistingHep } = await import("../src/hep.ts");
  assert.equal(builder.buildParsedDataZip, undefined, "the old builder has no compatibility alias");
  const scene = composeVectorScenesInGrid([], 1);
  for (const compression of ["store", "deflate"]) {
    const events = [];
    const blob = await builder.buildHep(scene, {
      compression, sourceLabel: "synthetic.pdf", onProgress: event => events.push(event)
    });
    assert.equal(blob.type, "application/x-hep");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert(hasHepSignature(bytes));
    assert(events.some(event => event.stage === "hep-build"));
    assert.equal(events.at(-1).value, 1);
    for (let i = 1; i < events.length; i++) assert(events[i].value >= events[i - 1].value);

    const base64 = Buffer.from(bytes).toString("base64");
    for (const source of [bytes, bytes.buffer, blob,
      new File([bytes], "synthetic.hep"), base64, `data:application/x-hep;base64,${base64}`]) {
      const loadEvents = [];
      const loaded = await loadPdfSceneFromSource(source, { onProgress: event => loadEvents.push(event) });
      assert.equal(loaded.sourceKind, "hep");
      assert.equal(loaded.scene.segmentCount, 0);
      assert.equal(loaded.scene.textInstanceCount, 0);
      assert.equal(loadEvents.at(-1).value, 1);
      assert(loadEvents.some(event => event.sourceType === "hep"));
      assert(loadEvents.every(event => !event.stage.startsWith("zip-") && event.sourceType !== "zip"));
    }
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(bytes, { headers: { "content-type": "application/x-hep" } });
      assert.equal((await loadPdfSceneFromSource("https://example.invalid/document.hep")).sourceKind, "hep");
    } finally {
      globalThis.fetch = originalFetch;
    }
    await assert.rejects(loadPdfSceneFromSource(bytes, { sourceKind: "parsed-zip" }), /sourceKind/);
  }

  for (const compression of ["store", "deflate"]) {
    for (const compressionLevel of [undefined, 0, 6, 9]) {
      await assert.rejects(builder.buildHep(scene, { compression, compressionLevel }),
        /compressionLevel is no longer supported/);
    }
  }
  await assert.rejects(builder.buildHep(scene, { compression: "gzip" }), /compression must be/);
  for (const stage of ["hep-build", "complete"]) {
    const lateController = new AbortController();
    const lateReason = new Error(`cancel at ${stage}`);
    await assert.rejects(builder.buildHep(scene, {
      compression: "store", signal: lateController.signal,
      onProgress: event => {
        if (event.stage === stage && event.value === 1) lateController.abort(lateReason);
      }
    }), error => error === lateReason);
  }
  const legacy = Uint8Array.of(0x50, 0x4b, 3, 4);
  for (const source of [legacy, Buffer.from(legacy).toString("base64"),
    `data:application/zip;base64,${Buffer.from(legacy).toString("base64")}`,
    new File([legacy], "legacy.hep"), new File([legacy], "legacy.zip")]) {
    await assert.rejects(loadPdfSceneFromSource(source), /repack-heps\.mjs/);
  }

  const fallback = new HepArchive();
  // The source is only a signature fixture, never passed to a PDF parser.
  fallback.file("source/source.pdf", "%PDF-synthetic-source");
  fallback.file("manifest.json", JSON.stringify({ formatVersion: 6, sourcePdfFile: "source/source.pdf" }));
  const fallbackBytes = await fallback.generateAsync({ type: "uint8array" });
  assert.equal(new TextDecoder().decode(await tryReadSourcePdfBytesFromExistingHep(fallbackBytes)), "%PDF-synthetic-source");
  const controller = new AbortController();
  const reason = new Error("cancel source recovery");
  controller.abort(reason);
  await assert.rejects(tryReadSourcePdfBytesFromExistingHep(fallbackBytes, controller.signal), error => error === reason);
  await assert.rejects(builder.buildHep(scene, { signal: controller.signal }), error => error === reason);
  console.log("HEP API passed: native formats, source forms, clean API break, progress, and cancellation.");
} finally {
  hooks.deregister();
}
