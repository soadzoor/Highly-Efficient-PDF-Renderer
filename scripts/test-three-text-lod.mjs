import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const [adapter, material, object] = await Promise.all([
  readFile(path.resolve(scriptDir, "../src/textLodLayer.ts"), "utf8"),
  readFile(path.resolve(scriptDir, "../src/threeMaterialTextLayer.ts"), "utf8"),
  readFile(path.resolve(scriptDir, "../src/threePdfObject.ts"), "utf8")
]);

assert.match(adapter, /createTextLodCombinedPayload/, "Three must upload a combined exact/coarse text payload");
assert.match(adapter, /runtime\.update\(/, "Three must reuse the shared clustered selector");
assert.match(adapter, /selection\.changed \|\| !this\.selectionApplied/, "stationary frames must skip selection uploads");
assert.doesNotMatch(adapter, /new ThreeMaterialTextLayer|new THREE\.Group|resolveTextLodBlend/, "the LOD adapter must not create a second draw layer");
const adapterConstructor = adapter.match(/private constructor\([\s\S]*?\n  static create/)?.[0] ?? "";
assert.match(
  adapterConstructor,
  /if \(mode === "auto"\) \{\s*this\.initializeAuto\(scene\)/,
  "initial Text LOD Off must leave the exact scene untouched without building coarse data"
);
assert.doesNotMatch(
  adapterConstructor.slice(0, adapterConstructor.indexOf('if (mode === "auto")')),
  /getOrBuildTextLod|createTextLodCombinedPayload/,
  "initial Text LOD Off must not build or allocate a combined payload"
);
assert.match(
  adapter,
  /setMode\([\s\S]*?mode === "auto" && !this\.runtime[\s\S]*?this\.initializeAuto\(scene\)/,
  "Off-to-Auto must lazily build the shared clustered payload"
);
assert.match(
  adapter,
  /catch \(error\) \{[\s\S]*?this\.useExactResourceFallback\("material-construction", scene\);[\s\S]*?throw error/,
  "a failed lazy build must leave the adapter compatible with the installed exact material"
);

assert.match(material, /setSelectedTextInstanceIds\(instanceIds: Uint32Array\)/, "one material must accept selected instance IDs");
assert.match(material, /this\.textInstanceIds\[i\] !== instanceIds\[i\]/, "identical selections must be detected without an upload");
assert.match(material, /this\.usingExternalSelection/, "cluster selection must bypass page-range ID rewrites");
assert.match(
  material,
  /rasterAtlasGlyphCount[\s\S]*?\{ \.\.\.scene, textGlyphCount: rasterAtlasGlyphCount \}/,
  "Three must exclude the appended solid LOD glyph from its raster atlas"
);
assert.match(
  material,
  /texture\.mipmaps = buildSingleChannelUint8MipChain\(data, width, height\);[\s\S]*?texture\.generateMipmaps = false;/,
  "Three must upload the shared deterministic glyph-atlas mip chain"
);
assert.match(
  material,
  /Math\.min\(16, Math\.max\(1, Math\.floor\(/,
  "Three glyph-atlas anisotropy must use the native WebGPU ceiling"
);
assert.match(
  material,
  /options\.maxRasterAtlasTextureSize \?\? TEXT_RASTER_ATLAS_MAX_TEXTURE_SIZE/,
  "Three must use the same glyph-atlas size ceiling as the native renderers"
);

assert.match(object, /textLodLayer\.getRenderScene\(\)/, "the Three text mesh must use the combined payload");
assert.match(object, /updateTextLodSelection/, "camera frames must update clustered selection");
assert.match(
  object,
  /const replacementScene = this\.textLodLayer\?\.setMode\(nextMode, this\.sceneData\)[\s\S]*?createThreeTextMaterialLayer\(replacementScene\)[\s\S]*?replaceThreeTextMaterialLayer\(replacementLayer\)/,
  "Off-to-Auto must safely swap the exact material for the lazily built combined material"
);
assert.match(
  object,
  /catch \(error\) \{[\s\S]*?this\.textLodLayer\.useExactResourceFallback\([\s\S]*?error instanceof RangeError[\s\S]*?if \(!\(error instanceof RangeError\)\) \{\s*throw error/,
  "a failed Off-to-Auto material construction must atomically restore exact selection before returning or throwing"
);
const hostCapacityFallback = object.match(
  /private ensureThreeTextLodResourceSupport\([\s\S]*?\n  private createThreeTextMaterialLayer/
)?.[0] ?? "";
assert.match(
  hostCapacityFallback,
  /createThreeTextMaterialLayer\([\s\S]*?replaceThreeTextMaterialLayer\(replacementLayer\);[\s\S]*?useExactResourceFallback\("resource-capacity"[\s\S]*?threeTextLodResourceFallback = true/,
  "host-capacity fallback state must commit only after the exact replacement is constructed and installed"
);
assert.match(
  object,
  /rasterAtlasGlyphCount: loadedScene\.scene\.textGlyphCount/,
  "Three must keep the coarse solid glyph analytic like the native backends"
);
assert.match(
  object,
  /renderer\.getMaxAnisotropy\?\.\(\) \?\?[\s\S]*?renderer\.capabilities\?\.getMaxAnisotropy\?\.\(\)/,
  "Three must read anisotropy from both WebGPU and WebGL renderer APIs"
);
assert.doesNotMatch(object, /TextLodBlend|resolveBlend|applyBlend|setTextLodBlend/, "Three must not cross-fade text representations");
assert.doesNotMatch(object, /textLodLayer\.group/, "Three must render text with one material object");

const transformMethod = object.match(
  /private updateMaterialLayerTransforms\([\s\S]*?\n  private updateStrokeLodVisibility/
)?.[0] ?? "";
assert.match(
  transformMethod,
  /this\.textLodLayer\?\.setLocalToClipTransform\(this\.clipFromDataMatrix\)/,
  "perspective text LOD must receive the PDF-local-to-clip transform"
);
assert.doesNotMatch(
  transformMethod,
  /!this\.strokeMaterialLayer[\s\S]*?return null/,
  "stroke-free text documents must not skip perspective transform updates"
);

console.log("Three clustered text LOD integration tests passed");
