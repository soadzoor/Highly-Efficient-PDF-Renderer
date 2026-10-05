import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { packVectorClips } = await import("../src/vectorClips.ts");
  const { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } = await import("../src/fillCoverageShaders.ts");
  const shaders = [evaluateGlsl(FILL_COVERAGE_GLSL), evaluateWgsl(FILL_COVERAGE_WGSL)];
  for (const cropped of [false, true]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(cropped) });
    try {
      const direct = await session.compileVectorPage(0, { vectorFallback: "error", preserveDrawingOrder: true });
      const retained = await lowerRetainedPageToVectorScene(await session.compilePage(0), { signal: new AbortController().signal });
      for (const [label, scene] of [["direct", direct], ["retained", retained],
        ["composed pages", composeVectorScenesInGrid([direct, retained], 2)]]) {
        const clips = packVectorClips(scene.clipPaths);
        for (const run of scene.drawRuns.filter(run => run.kind === "fill")) {
          const i = run.first * 4;
          const [x0, y0, x1, y1] = [scene.fillPathMetaA[i + 2], scene.fillPathMetaA[i + 3],
            scene.fillPathMetaB[i], scene.fillPathMetaB[i + 1]];
          if (x1 - x0 < 10) {
            assert.equal(run.clipIndex, undefined, `${label}: interior fills keep their unclipped path`);
            continue;
          }
          assert(run.clipIndex >= 0, `${label}: page-sized fills carry the crop clip`);
          const header = run.clipIndex * 4, rectangle = clips[header + 1] * 4;
          assert.equal(clips[header + 2], -1, "the page guard packs as a rectangle");
          const [minX, minY, maxX, maxY] = clips.subarray(rectangle, rectangle + 4);
          const inside = (x, y) => x >= minX && y >= minY && x < maxX && y < maxY;
          for (const shader of shaders) for (const zoom of [0.1, 0.25, 0.5, 1, 2, 8]) {
            const edges = [[minX - 0.1 / zoom, (minY + maxY) / 2], [maxX + 0.1 / zoom, (minY + maxY) / 2],
              [(minX + maxX) / 2, minY - 0.1 / zoom], [(minX + maxX) / 2, maxY + 0.1 / zoom]];
            for (const [x, y] of edges) {
              const raw = fillCoverage(scene, run.first, shader, x, y, zoom);
              assert(raw > 0, "the shipped area shader reproduces an outward antialiased fringe");
              assert.equal(raw * Number(inside(x, y)), 0, `${label}: no outline outside the page at zoom ${zoom}`);
            }
            const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
            assert.equal(fillCoverage(scene, run.first, shader, x, y, zoom) * Number(inside(x, y)), 1,
              "the page background stays opaque inside the crop box");
          }
        }
        const stroke = scene.drawRuns.find(run => run.kind === "stroke");
        assert(stroke?.clipIndex >= 0, `${label}: strokes touching the page edge carry a crop clip too`);
      }
    } finally { await session.close(); }
  }
  console.log("Vector page edges: direct/retained compilation, crop boxes, composed pages, stroke guards and GLSL/WGSL AA fringes passed.");
} finally { hooks.deregister(); }

function fillCoverage(scene, path, shader, x, y, zoom) {
  const box = { x: x - 0.5 / zoom, y: y - 0.5 / zoom, z: zoom, w: zoom };
  const first = scene.fillPathMetaA[path * 4], end = first + scene.fillPathMetaA[path * 4 + 1];
  let winding = 0;
  for (let segment = first; segment < end; segment++) {
    const i = segment * 4, a = scene.fillSegmentsA, b = scene.fillSegmentsB;
    winding += shader.heprSegmentCoverage({ x: a[i], y: a[i + 1] }, { x: a[i + 2], y: a[i + 3] },
      { x: b[i], y: b[i + 1] }, b[i + 2] >= 0.5, box, 0, 1);
  }
  return shader.heprFillCoverage(winding, scene.fillPathMetaB[path * 4 + 2] >= 0.5);
}

function fixture(cropped) {
  const bounds = cropped ? [20, 30, 80, 90] : [0, 0, 100, 100];
  const [x0, y0, x1, y1] = bounds;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /CropBox [${bounds.join(" ")}] /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", `1 g ${x0} ${y0} ${x1 - x0} ${y1 - y0} re f\n` +
      `0 g ${x0 + 10} ${y0 + 10} 2 2 re f\n0 w ${x0} ${y0 + 10} m ${x0} ${y1 - 10} l S`) }
  ] });
}
