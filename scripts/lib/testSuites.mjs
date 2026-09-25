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
  "hep-container",
  "hep-api",
  "hep-scene-sections",
  "optional-content",
  "retained-page-replay",
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
  "vector-fill-bands",
  "webgl-shader-precision",
  "subpixel-stroke-coverage",
  "fill-area-coverage",
  "pdf-layer-controls",
  "raster-layer-updates",
  "raster-strip-batches",
  "webgl-raster-strip-batches",
  "webgpu-raster-strip-batches",
  "three-raster-strip-batches",
  "three-raster-paint-order",
  "three-vector-draw-batching",
  "three-ordered-stroke-lod",
  "three-camera-stroke-lod",
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
  "native-document-semantics",
  "native-source-range-edge-cases",
  "native-font-text",
  "native-parser-fuzz",
  "pdf-range-transport",
  "pdf-session",
  "pdf-session-render-fallback",
  "pdf-session-hairline-text",
  "pdf-session-worker",
  "pdf-node-worker-runtime",
  "native-content-compiler",
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
  "webgpu-draw-calls",
  "draw-call-metrics",
  "webgl-ordered-state",
  "vector-draw-order",
  "vector-clips",
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
  "three-primitive-interaction-controller",
  "three-primitive-interaction",
  "three-paint-compositor",
  "native-primitive-interaction",
  "native-paint-compositor",
  "native-ordered-pan-cache",
  "native-pan-cache",
  "text-lod-core",
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
  "vector-perspective-lod"
];

// Suites with prerequisites are opt-in. HEP package conversion deliberately
// stays outside the packaging gate invoked by build:lib.
export const explicitSuites = {
  package: ["dense-pdf-package", "browser-package", "bundler-package"],
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
    "dense-pdf-fast-worker",
    "native-dense-pdf-document",
    "native-text-content-sidecar",
    "native-visual-regressions",
    "node-pdf-source"
  ]
};

const integrationPatterns = [
  /^pdf-(?:session(?:-|$)|optional-content-session$|node-worker-runtime$|to-hep-node-dense-worker$)/,
  /^native-(?:composite-|resource-reuse$|vector-(?:forms|differential|lazy-eligibility)$|parser-boundary$|dense-dependency-boundary$|dense-text-extractor$|retained-text-compiler$|text-clip-index$|jpeg-codec$)/,
  /^dense-pdf-(?:document|integration)$/,
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
