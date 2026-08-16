import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webGl = await readFile(path.resolve(scriptDir, "../src/webGlFloorplanRenderer.ts"), "utf8");
const webGpu = await readFile(path.resolve(scriptDir, "../src/webGpuFloorplanRenderer.ts"), "utf8");

for (const [name, source] of [["WebGL", webGl], ["WebGPU", webGpu]]) {
  assert.doesNotMatch(source, /uTextLodBlend|textLodBlend/, `${name} must not cross-fade text representations`);
  assert.match(source, /setTextLodMode\(/, `${name} must expose text LOD mode control`);
  assert.match(source, /getTextLodStats\(/, `${name} must expose text LOD diagnostics`);
  assert.match(source, /setResourceFallback\("resource-capacity"\)/, `${name} must exact-fallback on GPU capacity limits`);
  assert.match(source, /textLodRuntime\?\.dispose\(\)/, `${name} must release its text LOD runtime`);
  assert.match(source, /createOrthographicLocalToClip\(/, `${name} must select LOD from the rendered projection`);
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
  /effectiveZoom,[\s\S]{0,300}viewportWidth:\s*this\.canvas\.width[\s\S]{0,200}zoom:\s*this\.zoom/,
  "WebGL minify rendering must select text LOD in final output pixels"
);
assert.doesNotMatch(
  webGl.slice(webGl.indexOf("const TEXT_VERTEX_SHADER_SOURCE"), webGl.indexOf("const TEXT_FRAGMENT_SHADER_SOURCE")),
  /LodBlend|mix\([^\n]*instanceB\.w/,
  "the exported core WebGL text vertex shader must keep its previous uniform contract"
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
