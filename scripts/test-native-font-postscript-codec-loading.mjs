import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildType1Fixture } from "./lib/type1Fixture.mjs";

const selected = process.argv.find(value => value.startsWith("--codec="))?.slice(8);
if (!selected) {
  // Each missing chunk starts with an empty module/codec cache.
  for (const codec of ["jpx", "jbig2"]) {
    await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), `--codec=${codec}`], { encoding: "utf8" });
  }
  console.log("Font PostScript codec loading passed: lazy adapters, typed chunk failures, vector fallback, cancellation and retry.");
} else {
  assert(["jpx", "jbig2"].includes(selected));
  const bridgeUrl = new URL("../src/pdf/nativeFontPostScriptCodecs.ts", import.meta.url).href;
  const missingModule = selected === "jpx" ? "nativeJpxCodec" : "nativeJbig2Codec";
  const codec = selected === "jpx" ? "jpeg2000" : "jbig2";
  const chunkFailure = new TypeError(`Unable to fetch ${missingModule} chunk.`);
  const loadedAdapters = new Set();
  let unavailable = true, importAttempts = 0;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL === bridgeUrl && specifier === `./${missingModule}`) {
        importAttempts++;
        if (unavailable) throw chunkFailure;
      }
      return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
        ? `${specifier}.ts` : specifier, context);
    },
    load(url, context, next) {
      const adapter = /\/(native(?:Jpx|Jbig2)Codec)\.ts$/.exec(url)?.[1];
      if (adapter) loadedAdapters.add(adapter);
      return next(url, context);
    }
  });
  try {
    const bridge = await import(bridgeUrl);
    const { PdfError } = await import("../src/pdf/nativeTypes.ts");
    assert.equal(loadedAdapters.size, 0, "importing the synchronous bridge does not load either optional adapter");
    for (const requireCodec of [bridge.requireNativeFontPostScriptJpxCodec, bridge.requireNativeFontPostScriptJbig2Codec]) {
      assert.throws(requireCodec, error => error instanceof PdfError && error.code === "unsupported-image" &&
        error.details?.reason === "codec-not-prepared");
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(bridge.prepareNativeFontPostScriptCodecs(controller.signal),
      error => error instanceof PdfError && error.code === "aborted");
    assert.equal(importAttempts, 0, "already cancelled preparation does not request codec chunks");
    assert.equal(loadedAdapters.size, 0);

    await assert.rejects(bridge.prepareNativeFontPostScriptCodecs(), error =>
      error instanceof PdfError && error.code === "unsupported-image" && error.details?.codec === codec &&
      error.details?.reason === "codec-load-failed" && error.cause === chunkFailure);

    const { parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
    const fixture = buildType1Fixture({ clearExtra: "/FontMatrix [(.002) cvr 0 0 (.003) cvr 0 0] def" });
    const name = value => ({ kind: "name", value });
    const font = await parseNativePdfFont(new Map([
      ["Subtype", name("Type1")], ["BaseFont", name("FixtureType1")], ["FirstChar", 65], ["Widths", [600]],
      ["FontDescriptor", new Map([["Flags", 32], ["FontFile", {
        kind: "stream", dictionary: new Map([["Length1", fixture.length1], ["Length2", fixture.length2]]), bytes: fixture.bytes
      }]])]
    ]), { async resolveValue(value) { return value; }, async decodeStream(stream) { return stream.bytes; } });
    assert.equal(font.substitution, null, "unavailable image codecs do not replace a vector PostScript font");
    assert.deepEqual(font.getGlyphOutline(font.decode(Uint8Array.of(65)).glyphId).commands[0],
      { kind: "move", x: 100, y: 0 }, "the computed font matrix still applies to its original vector outline");

    unavailable = false;
    await bridge.prepareNativeFontPostScriptCodecs();
    assert.equal(typeof bridge.requireNativeFontPostScriptJpxCodec().decodeBundledJpxRawSync, "function");
    assert.equal(typeof bridge.requireNativeFontPostScriptJbig2Codec().decodeBundledJbig2Sync, "function");
    assert.deepEqual([...loadedAdapters].sort(), ["nativeJbig2Codec", "nativeJpxCodec"],
      "retry loads and registers both optional adapters");
  } finally { hooks.deregister(); }
}
