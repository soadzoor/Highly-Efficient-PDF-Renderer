import assert from "node:assert/strict";

import {
  DENSE_PDF_PAINT_RUN_FILL,
  DENSE_PDF_PAINT_RUN_PATH,
  DENSE_PDF_PAINT_RUN_STROKE,
  compileDensePdfContent
} from "../src/pdf/nativeContentCompiler.ts";

const content = new TextEncoder().encode(`
  1 0 0 rg 0 0 10 10 re f
  0 0 0 RG 0 20 m 10 20 l S
  0 30 m 10 30 l S
  0 1 0 rg 20 0 10 10 re B
`);

const ordered = await compileDensePdfContent(content, {
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  enableSegmentMerge: false,
  enableInvisibleCull: true,
  preservePaintOrder: true
});

assert.deepEqual([...ordered.paintRuns], [
  DENSE_PDF_PAINT_RUN_FILL, 0, 1,
  DENSE_PDF_PAINT_RUN_STROKE, 0, 1,
  DENSE_PDF_PAINT_RUN_STROKE, 1, 1,
  DENSE_PDF_PAINT_RUN_PATH, 0, 1
]);
assert.equal(ordered.fillPathCount, 1);
assert.equal(ordered.segmentCount, 2);
assert.equal(ordered.pagePaths.length, 1);
assert.equal(ordered.genericPathPaints.length, 1);
assert.ok(ordered.genericPathPaints[0].fill);
assert.ok(ordered.genericPathPaints[0].stroke);

const legacy = await compileDensePdfContent(content, {
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  enableSegmentMerge: false,
  enableInvisibleCull: true
});
assert.equal(legacy.paintRuns.length, 0);

const clipped = await compileDensePdfContent(
    new TextEncoder().encode("0 0 m 20 0 l 10 20 l h W n 0 0 m 20 20 l S\n"),
    {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      preservePaintOrder: true
    }
);
assert.equal(clipped.clipPaths.length, 1);
assert.equal(clipped.clipPaths[0].fillRule, 0);
assert.equal(clipped.paintRunClipIndices[0], 0);

const square = await compileDensePdfContent(
    new TextEncoder().encode("2 J 0 0 m 20 20 l S\n"),
    {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      preservePaintOrder: true
    }
);
assert.deepEqual([...square.paintRuns], [DENSE_PDF_PAINT_RUN_PATH, 0, 1]);
assert.equal(square.genericPathPaints[0].strokeStyle?.lineCap, 2);

const splitComposite = await compileDensePdfContent(
  new TextEncoder().encode("/Split gs 0 0 m 20 0 l 10 20 l h B\n"),
  {
    pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    preservePaintOrder: true,
    extGStates: [{
      resourceName: "Split",
      fillAlpha: 0.25,
      strokeAlpha: 0.75
    }]
  }
);
assert.deepEqual([...splitComposite.paintRuns], [
  DENSE_PDF_PAINT_RUN_PATH, 0, 1,
  DENSE_PDF_PAINT_RUN_PATH, 1, 1
]);
assert.ok(splitComposite.genericPathPaints[0].fill);
assert.equal(splitComposite.genericPathPaints[0].stroke, null);
assert.equal(splitComposite.genericPathPaints[1].fill, null);
assert.ok(splitComposite.genericPathPaints[1].stroke);
assert.deepEqual(
  splitComposite.paintRunCompositeStates.map((state) => state.alpha),
  [0.25, 0.75]
);

const splitSharedComposite = await compileDensePdfContent(
  new TextEncoder().encode("/Shared gs 0 0 m 20 0 l 10 20 l h B\n"),
  {
    pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    preservePaintOrder: true,
    extGStates: [{
      resourceName: "Shared",
      fillAlpha: 0.5,
      strokeAlpha: 0.5
    }]
  }
);
assert.deepEqual([...splitSharedComposite.paintRuns], [
  DENSE_PDF_PAINT_RUN_PATH, 0, 1,
  DENSE_PDF_PAINT_RUN_PATH, 1, 1
]);
assert.equal(splitSharedComposite.genericPathPaints[0].stroke, null);
assert.equal(splitSharedComposite.genericPathPaints[1].fill, null);

const closeThenCurve = await compileDensePdfContent(
  new TextEncoder().encode("0 0 m 10 0 l h 20 10 30 0 v S\n"),
  {
    pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    preservePaintOrder: true
  }
);
assert.deepEqual(
  [...closeThenCurve.pagePaths[0].data.slice(7, 14)],
  [2, 0, 0, 20, 10, 30, 0],
  "h resets the current point used by the following v curve"
);

const anisotropicStroke = await compileDensePdfContent(
  new TextEncoder().encode("2 0 0 1 0 0 cm 2 w 0 0 m 20 20 l S\n"),
  {
    pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    preservePaintOrder: true
  }
);
assert.deepEqual([...anisotropicStroke.paintRuns], [DENSE_PDF_PAINT_RUN_PATH, 0, 1]);
assert.deepEqual(anisotropicStroke.pagePaths[0].transform, [2, 0, 0, 1, 0, 0]);

console.log("Dense PDF source paint-order tests passed.");
