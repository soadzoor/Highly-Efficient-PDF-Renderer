import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isNativeTextHeavyStrokeFreeScene,
  NATIVE_VECTOR_MINIFY_ENABLED
} from "../src/nativeRenderPolicy.ts";
import { buildSingleChannelUint8MipChain } from "../src/singleChannelMipChain.ts";
import { TEXT_RASTER_ATLAS_MAX_TEXTURE_SIZE } from "../src/textRasterAtlas.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webGl = await readFile(path.resolve(scriptDir, "../src/webGlFloorplanRenderer.ts"), "utf8");
const webGpu = await readFile(path.resolve(scriptDir, "../src/webGpuFloorplanRenderer.ts"), "utf8");

assert.equal(
  TEXT_RASTER_ATLAS_MAX_TEXTURE_SIZE,
  4096,
  "all renderers must share the same glyph-atlas size and quality ceiling"
);

const mipSource = new Uint8Array([
  0, 4, 8, 12,
  16, 20, 24, 28,
  32, 36, 40, 44,
  48, 52, 56, 60
]);
const mipChain = buildSingleChannelUint8MipChain(mipSource, 4, 4);
assert.equal(mipChain.length, 3, "the shared mip builder must include every level through 1x1");
assert.equal(mipChain[0].data, mipSource, "level zero must retain the exact atlas bytes");
assert.deepEqual([...mipChain[1].data], [10, 18, 42, 50], "2x2 mip filtering must use rounded box averages");
assert.deepEqual([...mipChain[2].data], [30], "the deterministic mip chain must converge to the rounded mean");
assert.deepEqual(
  [...buildSingleChannelUint8MipChain(new Uint8Array([0, 0, 0, 2]), 2, 2)[1].data],
  [1],
  "half-way byte averages must round up identically on every backend"
);

assert.equal(NATIVE_VECTOR_MINIFY_ENABLED, false, "native vector minification must remain dormant for output parity");
assert.equal(
  isNativeTextHeavyStrokeFreeScene(100_001, 0),
  true,
  "stroke-free books above the threshold must qualify for the pan cache"
);
assert.equal(
  isNativeTextHeavyStrokeFreeScene(100_000, 0),
  false,
  "the text-heavy predicate must retain its strict threshold boundary"
);
assert.equal(
  isNativeTextHeavyStrokeFreeScene(100_001, 1),
  false,
  "any stroke content must exclude the text-heavy special case"
);

for (const [name, source] of [["WebGL", webGl], ["WebGPU", webGpu]]) {
  assert.doesNotMatch(source, /uTextLodBlend|textLodBlend/, `${name} must not cross-fade text representations`);
  assert.match(source, /setTextLodMode\(/, `${name} must expose text LOD mode control`);
  assert.match(source, /getTextLodStats\(/, `${name} must expose text LOD diagnostics`);
  assert.match(source, /setResourceFallback\("resource-capacity"\)/, `${name} must exact-fallback on GPU capacity limits`);
  assert.match(source, /textLodRuntime\?\.dispose\(\)/, `${name} must release its text LOD runtime`);
  assert.match(source, /createOrthographicLocalToClip\(/, `${name} must select LOD from the rendered projection`);
  assert.match(
    source,
    /isNativeTextHeavyStrokeFreeScene\(this\.textInstanceCount, this\.segmentCount\)/,
    `${name} must use the shared text-heavy render policy`
  );
  assert.match(
    source,
    /if \(!NATIVE_VECTOR_MINIFY_ENABLED\) \{\s*return false;/,
    `${name} must keep its legacy vector-minify path behind the shared parity policy`
  );
  assert.match(
    source.slice(source.indexOf("private shouldUseVectorMinifyPath()")),
    /if \(this\.isTextHeavyStrokeFreeScene\(\)\) \{\s*return false;/,
    `${name} must retain the shared text-heavy minify exclusion if the parity gate is re-enabled`
  );
  assert.match(
    source,
    /Math\.floor\(this\.canvas\.clientWidth \* devicePixelRatio\)/,
    `${name} must match Three's fractional-DPR backing-width rounding`
  );
  assert.match(
    source,
    /Math\.floor\(this\.canvas\.clientHeight \* devicePixelRatio\)/,
    `${name} must match Three's fractional-DPR backing-height rounding`
  );
}

assert.match(webGl, /selectedTextInstanceIdBuffer/, "WebGL must upload source-ordered selected IDs");
assert.match(
  webGl,
  /this\.allTextInstanceIds = new Float32Array\(this\.textInstanceCount\)/,
  "WebGL exact-range IDs must not allocate the optional coarse suffix outside fallback handling"
);
assert.match(
  webGl,
  /drawArraysInstanced\(gl\.TRIANGLE_STRIP,\s*0,\s*4,\s*this\.selectedTextInstanceCount\)/,
  "WebGL must draw one selected text representation"
);
assert.match(webGl, /EXT_texture_filter_anisotropic/, "WebGL must use supported glyph-atlas anisotropy");
assert.match(
  webGl,
  /TEXTURE_MAX_ANISOTROPY_EXT, Math\.min\(16, supported\)/,
  "WebGL glyph-atlas anisotropy must use the same ceiling as WebGPU"
);
assert.match(webGl, /powerPreference:\s*"high-performance"/, "WebGL must request the same GPU preference as the other backends");
assert.match(
  webGl,
  /effectiveZoom,[\s\S]{0,300}viewportWidth:\s*this\.canvas\.width[\s\S]{0,200}zoom:\s*this\.zoom/,
  "WebGL minify rendering must select text LOD in final output pixels"
);
assert.doesNotMatch(
  webGl.slice(webGl.indexOf("const TEXT_VERTEX_SHADER_SOURCE"), webGl.indexOf("const TEXT_FRAGMENT_SHADER_SOURCE")),
  /LodBlend|mix\([^\n]*instanceB\.w/,
  "the exported core WebGL text vertex shader must keep its previous uniform contract"
);
const webGlTextShader = webGl.slice(
  webGl.indexOf("const TEXT_FRAGMENT_SHADER_SOURCE"),
  webGl.indexOf("const BLIT_VERTEX_SHADER_SOURCE")
);
assert.match(
  webGlTextShader,
  /vec2 dncDx = dFdx\(nc\);[\s\S]*?vec2 mipBiasedUvDx = dncDx \* texel \* 0\.420448/,
  "WebGL must apply the shared negative mip bias to explicit gradients"
);
assert.equal(
  webGlTextShader.match(/textureGrad\(/g)?.length,
  5,
  "WebGL must use the same five explicit-gradient atlas taps as WebGPU"
);
assert.match(
  webGl,
  /const atlasMipChain = buildSingleChannelUint8MipChain\([\s\S]*?gl\.texImage2D\([\s\S]*?mipLevel[\s\S]*?level\.data/,
  "WebGL must explicitly upload every deterministic glyph-atlas mip"
);
const webGlTextUpload = webGl.slice(
  webGl.indexOf("private uploadTextData("),
  webGl.indexOf("private buildSegmentBounds(")
);
assert.doesNotMatch(
  webGlTextUpload,
  /generateMipmap/,
  "WebGL must not replace the explicit glyph-atlas mip bytes with driver-generated levels"
);

const webGpuTextShader = webGpu.slice(
  webGpu.indexOf("const TEXT_SHADER_SOURCE"),
  webGpu.indexOf("const RASTER_SHADER_SOURCE")
);
const webGpuRasterBranch = webGpuTextShader.indexOf("uCamera.textVectorOnly < 0.5");
const webGpuFirstAtlasTap = webGpuTextShader.indexOf("textureSampleGrad(");

assert.match(webGpu, /uTextInstanceIds\s*:\s*TextInstanceIdBuffer/, "WebGPU must bind selected instance IDs");
assert.match(
  webGpu,
  /if \(uCamera\.pad0 >= 0\.5\) \{\s*selectedInstanceIndex = uTextInstanceIds\.values\[instanceIndex\]/,
  "WebGPU must read ID indirection only on the LOD path"
);
assert.match(webGpu, /pass\.draw\(4,\s*textDrawCount,\s*0,\s*0\)/, "WebGPU must submit one selected text draw");
assert.match(webGpu, /maxAnisotropy:\s*16/, "WebGPU must enable glyph-atlas anisotropy");
assert.match(
  webGpu,
  /const mipChain = buildSingleChannelUint8MipChain\(source, width, height\)/,
  "WebGPU must upload the shared deterministic glyph-atlas mip chain"
);
assert.match(
  webGpu,
  /this\.segmentCount < PAN_CACHE_MIN_SEGMENTS && !this\.isTextHeavyStrokeFreeScene\(\)/,
  "WebGPU must mirror WebGL's text-heavy pan-cache eligibility"
);
assert.match(
  webGpuTextShader,
  /let dncDx = dpdx\(nc\);[\s\S]*?let mipBiasedUvDx = dncDx \* texel \* 0\.420448/,
  "WebGPU must evaluate derivatives before applying the previous mip bias to explicit gradients"
);
assert.ok(
  webGpuRasterBranch >= 0 && webGpuFirstAtlasTap > webGpuRasterBranch,
  "WebGPU glyph-atlas taps must be inside the minified-raster branch"
);
assert.equal(
  webGpuTextShader.match(/textureSampleGrad\(/g)?.length,
  5,
  "WebGPU must retain the five-tap raster coverage filter"
);
assert.doesNotMatch(webGpuTextShader, /textureSampleBias\(/, "WebGPU must not use unconditional implicit-gradient taps");
assert.match(
  webGpu,
  /effectiveZoom,[\s\S]{0,120}true,[\s\S]{0,200}viewportWidth:\s*this\.canvas\.width[\s\S]{0,200}zoom:\s*this\.zoom/,
  "WebGPU minify rendering must select text LOD in final output pixels"
);
assert.doesNotMatch(
  webGl + webGpu,
  /createTextLodCombinedPayload/,
  "native uploads must append into padded arrays without duplicating the combined scene"
);

console.log("Native clustered text LOD integration tests passed");
