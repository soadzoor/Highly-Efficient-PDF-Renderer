import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRADIENT_FILL_WGSL,
  GRADIENT_STROKE_WGSL
} from "../src/nativeGradientWebGpuShaders.ts";
import {
  buildOrderedGradientPaintCommands,
  orderedGradientPaintNeedsDirectRendering,
  planOrderedGradientMinify
} from "../src/orderedGradientPaint.ts";

function readFunctionBody(source, functionName) {
  const signatureIndex = source.indexOf(`fn ${functionName}(`);
  assert.notEqual(signatureIndex, -1, `missing WGSL function ${functionName}`);
  const bodyStart = source.indexOf("{", signatureIndex);
  assert.notEqual(bodyStart, -1, `missing body for WGSL function ${functionName}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }
  assert.fail(`unterminated body for WGSL function ${functionName}`);
}

function assertDerivativesPrecedeDivergentControl(source, functionName) {
  const body = readFunctionBody(source, functionName);
  const derivativeOffsets = Array.from(
    body.matchAll(/\b(?:dpdx|dpdy|fwidth)\s*\(/g),
    (match) => match.index
  );
  assert.ok(derivativeOffsets.length > 0, `${functionName} must evaluate derivatives`);
  const firstDivergentOffset = body.search(
    /^[ \t]*(?:if|for|while|loop|switch|discard)\b/m
  );
  assert.notEqual(firstDivergentOffset, -1, `${functionName} must retain its guarded paint logic`);
  assert.ok(
    derivativeOffsets.every((offset) => offset < firstDivergentOffset),
    `${functionName} derivatives must run before potentially non-uniform control flow`
  );
}

const emptyFloats = new Float32Array(0);
const gradientData = {
  gradientCount: 0,
  gradientMetaA: emptyFloats,
  gradientMetaB: emptyFloats,
  gradientMetaC: emptyFloats,
  gradientMetaD: emptyFloats,
  gradientMetaE: emptyFloats,
  gradientLut: new Uint8Array(0),
  gradientFillPathCount: 1,
  gradientFillSegmentCount: 0,
  gradientFillPathMetaA: emptyFloats,
  gradientFillPathMetaB: emptyFloats,
  gradientFillPathMetaC: emptyFloats,
  gradientFillPaintMeta: new Float32Array([-1, 0, 2, 0]),
  gradientFillSegmentsA: emptyFloats,
  gradientFillSegmentsB: emptyFloats,
  gradientStrokeRunCount: 0,
  gradientStrokeSegmentCount: 0,
  gradientStrokeRunMetaA: emptyFloats,
  gradientStrokeRunMetaB: emptyFloats,
  gradientStrokeEndpoints: emptyFloats,
  gradientStrokePrimitiveMeta: emptyFloats,
  gradientStrokePrimitiveBounds: emptyFloats,
  gradientStrokeStyles: emptyFloats
};

const interleaved = buildOrderedGradientPaintCommands(
  [
    { paintOrder: 25, pageIndex: 0 },
    { paintOrder: 0, pageIndex: 0 }
  ],
  gradientData
);
assert.deepEqual(
  interleaved.map(({ kind, paintOrder, pageIndex }) => [kind, paintOrder, pageIndex]),
  [
    ["raster", 0, 0],
    ["gradient-fill", 2, 0],
    ["raster", 25, 0]
  ]
);
const interleavedNeedsSplit = orderedGradientPaintNeedsDirectRendering(interleaved);
assert.equal(interleavedNeedsSplit, true);
assert.deepEqual(
  planOrderedGradientMinify(true, interleavedNeedsSplit, true, true),
  {
    splitOrderedGradientPrefix: true,
    includeGradientPaint: false,
    hasMinifiableContent: true
  },
  "raster-gradient-raster ordering must not disable ordinary text minification"
);
assert.equal(
  planOrderedGradientMinify(true, true, false, true).hasMinifiableContent,
  false,
  "a split gradient-only scene must not allocate an empty minify pass"
);

const safeGradient = buildOrderedGradientPaintCommands(
  [{ paintOrder: 0, pageIndex: 0 }],
  gradientData
);
const safeGradientNeedsSplit = orderedGradientPaintNeedsDirectRendering(safeGradient);
assert.equal(safeGradientNeedsSplit, false);
assert.deepEqual(planOrderedGradientMinify(true, safeGradientNeedsSplit, false, true), {
  splitOrderedGradientPrefix: false,
  includeGradientPaint: true,
  hasMinifiableContent: true
});

const rasterOnAnotherPage = buildOrderedGradientPaintCommands(
  [
    { paintOrder: 0, pageIndex: 0 },
    { paintOrder: 25, pageIndex: 1 }
  ],
  gradientData
);
assert.equal(orderedGradientPaintNeedsDirectRendering(rasterOnAnotherPage), false);
assert.deepEqual(planOrderedGradientMinify(false, true, false, true), {
  splitOrderedGradientPrefix: false,
  includeGradientPaint: true,
  hasMinifiableContent: true
});

assertDerivativesPrecedeDivergentControl(GRADIENT_FILL_WGSL, "fsMain");
assertDerivativesPrecedeDivergentControl(GRADIENT_STROKE_WGSL, "fsMain");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const threeGradientSource = await readFile(
  path.resolve(scriptDir, "../src/threeWebGpuGradientMaterial.ts"),
  "utf8"
);
assertDerivativesPrecedeDivergentControl(threeGradientSource, "heprGradientFillFragment");
assertDerivativesPrecedeDivergentControl(threeGradientSource, "heprGradientStrokeFragment");

console.log("Ordered gradient paint/minify tests passed");
