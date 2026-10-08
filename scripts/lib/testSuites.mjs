import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const testTimeoutMs = 60_000;
export const suiteBudgetMs = 10 * 60_000;

// Keep the existing CI selection explicit. Discovery of a new test must not
// silently add servers, corpus work, or PDF-to-HEP conversions to npm test.
export const fastTests = [
  "test-runner",
  "document-loading",
  "public-load-cancellation",
  "pdf-source-ownership",
  "hep-container",
  "hep-float32-palette",
  "hep-api",
  "hep-lod",
  "hep-lod-repack-budget",
  "hep-lod-examples",
  "hep-annotations",
  "pdf-annotation-metadata",
  "annotation-appearances",
  "annotation-overlay",
  "annotation-links",
  "annotation-layers",
  "annotation-interaction",
  "annotation-ui-interaction",
  "structure-content",
  "hep-scene-sections",
  "hep-monochrome-raster",
  "optional-content",
  "retained-page-replay",
  "retained-page-compositor",
  "retained-vector-page",
  "retained-packed-strokes",
  "retained-single-paint-opacity",
  "retained-layer-programs",
  "pdf-optional-content-session",
  "layer-interaction",
  "pdf-compositing",
  "composite-span-batching",
  "selective-raster-reasons",
  "retained-image-soft-mask",
  "retained-stencil-seams",
  "vector-fill-bands",
  "vector-cell-index",
  "webgl-shader-precision",
  "shader-comment-compaction",
  "webgl-fill-clip-bounds",
  "subpixel-stroke-coverage",
  "fill-area-coverage",
  "projected-coverage-margin",
  "pdf-layer-controls",
  "pdf-annotation-controls",
  "raster-layer-updates",
  "raster-preparation",
  "pdf-demand-swaps",
  "monochrome-raster",
  "compact-monochrome-raster",
  "jbig2-symbol-storage",
  "webgl-monochrome-raster",
  "webgpu-monochrome-raster",
  "raster-clip-seams",
  "raster-strip-batches",
  "raster-atlas-batches",
  "raster-tiles",
  "raster-memory-budget",
  "raster-resolution",
  "pdf-page-demand",
  "pdf-page-overviews",
  "native-ocr-text",
  "three-page-demand",
  "page-loading-placeholders",
  "three-raster-storage",
  "webgl-raster-memory-budget",
  "webgpu-raster-memory-budget",
  "raster-compression",
  "pdf-raster-compression",
  "webgl-raster-compression",
  "webgpu-raster-compression",
  "webgl-raster-strip-batches",
  "webgl-raster-atlas-batches",
  "webgpu-raster-strip-batches",
  "three-raster-strip-batches",
  "three-raster-paint-order",
  "three-page-background-batching",
  "three-page-transforms",
  "three-backend-loading",
  "three-page-transform-batching",
  "scene-page-views",
  "shared-page-renderer",
  "three-vector-draw-batching",
  "three-sparse-lod-batches",
  "three-ordered-stroke-lod",
  "three-camera-stroke-lod",
  "three-stroke-culling",
  "three-vector-instance-clip",
  "three-webgpu-composite-material",
  "three-webgpu-raster-strip-material",
  "three-webgpu-text-material",
  "three-webgpu-varying-interpolation",
  "hep-repack",
  "persistent-viewer-contract",
  "pdf-compiler-boundary",
  "native-parser-boundary",
  "optional-node-canvas",
  "native-pdf-core",
  "native-encryption",
  "native-document-semantics",
  "native-source-range-edge-cases",
  "native-font-text",
  "pdf-session-ext-gstate-font",
  "native-image-codecs",
  "native-monochrome-images",
  "jbig2-codec-safety",
  "native-parser-fuzz",
  "pdf-range-transport",
  "pdf-session",
  "pdf-session-render-fallback",
  "pdf-session-hairline-text",
  "pdf-session-worker",
  "pdf-node-worker-runtime",
  "pdf-load-progress",
  "native-content-compiler",
  "parser-geometry-memory",
  "dense-resource-assembly",
  "ordered-stroke-culling",
  "stroke-coverage-order",
  "native-streamed-content",
  "pdf-to-hep-progress",
  "pdf-to-hep-workers",
  "native-glyph-hairline",
  "native-vector-page",
  "native-composite-lifetime",
  "native-composite-reuse",
  "native-resource-reuse",
  "native-text-clip-index",
  "scene-statistics",
  "stroke-scene-builder",
  "render-performance",
  "three-render-performance",
  "webgl-performance",
  "webgl-draw-calls",
  "webgl-page-background-batching",
  "webgpu-draw-calls",
  "webgpu-frame-pacing",
  "draw-call-metrics",
  "webgl-ordered-state",
  "vector-draw-order",
  "vector-clips",
  "vector-page-edges",
  "vector-clip-bands",
  "vector-draw-run-culling",
  "vector-visibility-guard",
  "vector-run-clip-elision",
  "vector-ordered-batches",
  "vector-stroke-redundancy",
  "vector-page-batching",
  "text-parser-work",
  "text-search",
  "text-selection",
  "scene-primitives",
  "scene-paint-query",
  "scene-paint-visibility",
  "primitive-appearance",
  "primitive-interaction",
  "drawing-selection-controls",
  "example-page-layouts",
  "three-primitive-interaction-controller",
  "three-primitive-interaction",
  "three-paint-compositor",
  "three-gradient-mask-fold",
  "native-primitive-interaction",
  "native-paint-compositor",
  "native-direct-rendering",
  "text-lod-core",
  "lod-worker",
  "text-lod-foreshortening",
  "native-ordered-text-lod",
  "three-ordered-text-lod",
  "ordered-gradient-paint",
  "gradient-sampling",
  "vector-paint-coverage",
  "vector-shading-mesh",
  "deferred-renderer-api",
  "room-overlay-page-matrix",
  "room-detector-worker",
  "room-boundary-geometry",
  "room-detector-seeds",
  "room-geometry-fallback",
  "vector-stroke-clip-lod",
  "vector-stroke-density-lod",
  "vector-overview-lod",
  "vector-lod-memory",
  "vector-lod-cache",
  "vector-lod-storage",
  "native-stroke-upload-memory",
  "vector-perspective-lod"
];

// Suites with prerequisites are opt-in. HEP package conversion deliberately
// stays outside the packaging gate invoked by build:lib.
export const explicitSuites = {
  package: ["browser-package", "bundler-package", "lod-worker-package", "raster-worker-package", "built-material-shaders"],
  browser: [
    "example-assets",
    "pdf-source-cancellation",
    "raster-texture-ownership",
    "room-detector",
    "three-instance-buffer-updates"
  ],
  conversion: [
    "hep",
    "hep-package",
    "hep-scene-parity",
    "hep-v6-native-raster-recovery",
    "pdf-to-hep-cli",
    "raster-image-hep"
  ],
  corpus: [
    "brochure-page14-compositing",
    "native-text-content-sidecar",
    "native-visual-regressions",
    "node-pdf-source"
  ]
};

const integrationPatterns = [
  /^pdf-(?:session(?:-|$)|optional-content-session$|node-worker-runtime$)/,
  /^native-(?:composite-|resource-reuse$|vector-(?:forms|differential|lazy-eligibility)$|parser-boundary$|text-clip-index$|jpeg-codec$)/,
  /^(?:bundled-standard-fonts|hepr-canvas2d-renderer|optional-node-canvas|room-overlay-page-matrix|public-load-cancellation|scene-statistics|retained-vector-page|retained-layer-programs)$/
];

export function primarySuite(name) {
  for (const [suite, names] of Object.entries(explicitSuites)) {
    if (names.includes(name)) return suite;
  }
  return integrationPatterns.some(pattern => pattern.test(name)) ? "integration" : "unit";
}

export async function discoverTests() {
  const entries = await readdir(new URL("../", import.meta.url), { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /^test-.+\.mjs$/.test(entry.name) && entry.name !== "test-fast.mjs")
    .map(entry => entry.name.slice(5, -4))
    .sort();
}

export function selectSuite(suite, available) {
  let names;
  if (suite === "fast") names = fastTests;
  else if (Object.hasOwn(explicitSuites, suite)) names = explicitSuites[suite];
  else if (suite === "unit" || suite === "integration") names = available.filter(name => primarySuite(name) === suite);
  else throw new Error(`Unknown test suite "${suite}". Choose fast, unit, integration, package, browser, conversion, or corpus.`);

  const missing = names.filter(name => !available.includes(name));
  if (missing.length) throw new Error(`Missing tests in ${suite}: ${missing.join(", ")}`);
  if (!names.length) throw new Error(`No tests selected for ${suite}.`);
  return names.map(name => `scripts/test-${name}.mjs`);
}
