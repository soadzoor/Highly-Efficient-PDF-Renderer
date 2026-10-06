import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const hooks = fileURLToPath(new URL("./lib/builtPackageTestHooks.mjs", import.meta.url));
const cases = [
  ["three-webgpu-composite-material", ["threePaintCompositor.js", "threeWebGpuPaintCompositorMaterials.js"]],
  ["three-page-transform-batching", ["threeMaterialGradientLayer.js", "threeWebGpuGradientMaterial.js", "nativeWebGlCoreShaders.js"]],
  ["three-webgpu-raster-strip-material", ["threeWebGpuRasterStripMaterial.js", "nativeRasterStripWebGpuShader.js"]],
  ["three-webgpu-text-material", ["threeWebGpuTextMaterial.js"]]
];

for (const [, modules] of cases) {
  for (const name of modules) await access(new URL(`../dist/bundler/${name}`, import.meta.url));
}
const core = await import("../dist/bundler/coreShaders.js");
for (const name of ["CORE_STROKE_VERTEX_SHADER_SOURCE", "CORE_STROKE_FRAGMENT_SHADER_SOURCE",
  "CORE_FILL_VERTEX_SHADER_SOURCE", "CORE_FILL_FRAGMENT_SHADER_SOURCE", "CORE_TEXT_VERTEX_SHADER_SOURCE",
  "CORE_TEXT_FRAGMENT_SHADER_SOURCE"]) {
  assert.equal(typeof core[name], "string", `${name} must be present in the built package.`);
  assert.doesNotMatch(core[name], /\/\/|\/\*/, `${name} must exercise emitted comment compaction.`);
}

for (const [name, modules] of cases) {
  const test = fileURLToPath(new URL(`./test-${name}.mjs`, import.meta.url));
  try {
    const { stdout, stderr } = await run(process.execPath,
      ["--experimental-strip-types", "--import", hooks, test], {
        cwd: root, timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HEPR_BUILT_EXPECTED_MODULES: modules.join(",") }
      });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    throw new Error(`Built package shader regression failed: ${name}\n${error.stdout ?? ""}${error.stderr ?? ""}`, { cause: error });
  }
}
console.log("Built material shaders passed: compacted GLSL, real WebGPU NodeBuilder output, gradients, page transforms, raster strips, and text.");
