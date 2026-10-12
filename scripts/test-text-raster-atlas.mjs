import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

try {
  const { buildTextRasterAtlas } = await import("../src/textRasterAtlas.ts");
  const glyphCount = 16;
  const scene = {
    textGlyphCount: glyphCount, textGlyphSegmentCount: glyphCount * 4,
    textGlyphMetaA: new Float32Array(glyphCount * 4), textGlyphMetaB: new Float32Array(glyphCount * 4),
    textGlyphSegmentsA: new Float32Array(glyphCount * 16), textGlyphSegmentsB: new Float32Array(glyphCount * 16)
  };
  for (let glyph = 0; glyph < glyphCount; glyph++) {
    scene.textGlyphMetaA.set([glyph * 4, 4, 0, 0], glyph * 4);
    scene.textGlyphMetaB.set([1, 1, 0, 0], glyph * 4);
    scene.textGlyphSegmentsA.set([0,0,0,0, 1,0,1,0, 1,1,1,1, 0,1,0,1], glyph * 16);
    scene.textGlyphSegmentsB.set([1,0,0,0, 1,1,0,0, 0,1,0,0, 0,0,0,0], glyph * 16);
  }
  let canvases = 0, unavailable = true;
  delete globalThis.document;
  assert.equal(buildTextRasterAtlas(scene, 4096), null, "without a DOM, rendering keeps its vector fallback");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(tag) {
      assert.equal(tag, "canvas");
      canvases++;
      return unavailable ? { getContext: () => null } : createCanvas(1, 1);
    }
  } });
  assert.equal(buildTextRasterAtlas(scene, 4096), null, "an unavailable context returns the existing fallback");
  unavailable = false;
  const atlas = buildTextRasterAtlas(scene, 4096);
  assert(atlas && atlas.alpha.some(alpha => alpha > 0), "a later context can build visible glyph masks");
  assert(atlas.alpha.some(alpha => alpha === 0), "atlas padding stays transparent");
  const initialCanvases = canvases;
  assert.equal(buildTextRasterAtlas(scene, 4096), atlas, "a repeated build reuses its successful atlas");
  assert.equal(buildTextRasterAtlas({ ...scene,
    pageBounds: { minX: 1000, minY: 2000, maxX: 3000, maxY: 4000 },
    textInstanceA: Float32Array.of(2,0,0,3), textInstanceB: Float32Array.of(4,5,0,0),
    textInstanceC: Float32Array.of(1,0,0,.5)
  }, 4096), atlas, "extracted pages reuse glyph masks despite different text transforms, colors, and page bounds");
  assert.equal(buildTextRasterAtlas(scene, 8192), atlas, "device limits above the common ceiling share the atlas");
  assert.equal(buildTextRasterAtlas(scene, 4096.9), atlas, "equivalent normalized limits reuse the same atlas");
  assert.equal(canvases, initialCanvases, "cache hits skip canvas creation, glyph rasterization, and pixel readback");

  const limited = buildTextRasterAtlas(scene, 256);
  assert(limited && limited.width <= 256 && limited.height <= 256, "a smaller device limit builds a compatible atlas");
  assert.notEqual(limited, atlas, "different size limits cannot reuse an incompatible atlas");
  assert.notEqual(limited.glyphUvRects[2], atlas.glyphUvRects[2], "a smaller atlas retains its own quality and UV mapping");
  assert.equal(buildTextRasterAtlas(scene, 128), limited, "limits below the existing minimum normalize consistently");
  const prefix = buildTextRasterAtlas({ ...scene, textGlyphCount: 1 }, 4096);
  assert(prefix && prefix.glyphUvRects.length === 4, "a glyph prefix has its own UV table");
  assert.notEqual(prefix, atlas, "glyph count is part of the shared-store cache key");
  assert.equal(buildTextRasterAtlas({ ...scene, textGlyphCount: 0 }, 4096), null, "empty stores retain their fallback");

  const changedMetaA = { ...scene, textGlyphMetaA: scene.textGlyphMetaA.slice() };
  changedMetaA.textGlyphMetaA[1] = 0;
  const withoutFirstGlyph = buildTextRasterAtlas(changedMetaA, 4096);
  assert(withoutFirstGlyph);
  assert.deepEqual([...withoutFirstGlyph.glyphUvRects.subarray(0, 4)], [0,0,0,0], "changed glyph segment metadata replaces the cached masks");
  const changedMetaB = { ...scene, textGlyphMetaB: scene.textGlyphMetaB.slice() };
  changedMetaB.textGlyphMetaB[0] = 2;
  const wideGlyph = buildTextRasterAtlas(changedMetaB, 4096);
  assert(wideGlyph);
  assert.notEqual(wideGlyph.glyphUvRects[3], atlas.glyphUvRects[3], "changed glyph bounds update its raster aspect ratio");
  for (const field of ["textGlyphSegmentsA", "textGlyphSegmentsB"]) {
    const changed = { ...scene, [field]: scene[field].slice() };
    changed[field][4] = .5;
    const result = buildTextRasterAtlas(changed, 4096);
    assert(result && result !== atlas, `${field} identity changes invalidate shared masks`);
    assert(result.alpha.length !== atlas.alpha.length || result.alpha.some((alpha, index) => alpha !== atlas.alpha[index]),
      `${field} outline changes appear in the rasterized pixels`);
    assert.equal(buildTextRasterAtlas(changed, 4096), result, `${field} replacement is itself reusable`);
  }
  const emptyGlyphs = { ...scene, textGlyphMetaA: new Float32Array(scene.textGlyphMetaA.length) };
  assert.equal(buildTextRasterAtlas(emptyGlyphs, 4096), null, "unrenderable stores do not reuse another store's atlas");
  delete globalThis.document;
  assert.equal(buildTextRasterAtlas(scene, 4096), null, "a cached atlas preserves the no-DOM fallback contract");
  console.log("Text raster atlas: shared immutable glyph masks, page transforms/colors, normalized device limits, store replacement, and unavailable-context retries passed.");
} finally {
  hooks.deregister();
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else delete globalThis.document;
}
