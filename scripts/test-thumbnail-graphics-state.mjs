import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { compileDensePdfContent, DensePdfSyntaxError } = await import("../src/pdf/nativeContentCompiler.ts");
  const { densePdfPagePathCount, densePdfGenericPathPaintCount, getDensePdfPagePath, getDensePdfGenericPathPaint } =
    await import("../src/pdf/nativeRetainedResources.ts");
  const encoder = new TextEncoder();
  const pageMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);
  const pageBounds = Object.freeze({ minX: -100, minY: -100, maxX: 200, maxY: 200 });
  const changedDash = Object.freeze([2, 5, 1]);
  const changedState = Object.freeze({ resourceName: "Changed", lineDash: changedDash, dashPhase: 3,
    lineWidth: 7, lineCap: 1, lineJoin: 2, miterLimit: 4, strokeAlpha: .5, fillAlpha: .75 });
  const options = { pageMatrix, pageBounds, extGStates: [changedState], enableSegmentMerge: false, enableInvisibleCull: false };
  const callerBefore = structuredClone({ pageMatrix, pageBounds, changedState });
  const cases = [
    { name: "current path survives nested CTM saves", source:
      "0 0 m q 2 0 0 3 5 7 cm 1 1 l q 1 0 0 1 4 5 cm 2 2 l Q 3 3 l Q 20 30 l S" },
    { name: "dash, pen and color restore independently", source:
      "[4 2] 1 d 2 w .2 .3 .4 RG q [1 3 2] 2 d 5 w 1 0 0 RG " +
      "0 10 m 100 10 l S q /Changed gs 0 20 m 100 20 l S Q 0 30 m 100 30 l S Q 0 40 m 100 40 l S" },
    { name: "rectangle-hole masks survive nested clip replacement", source:
      "0 0 120 100 re 30 20 40 50 re W* n q 10 10 90 80 re 20 20 10 10 re W* n " +
      "q 2 0 0 2 7 11 cm 0 0 20 20 re W n -100 -100 300 300 re f Q " +
      "-100 -100 300 300 re f Q -100 -100 300 300 re f" },
    { name: "empty inner clips cannot poison restored paint", source:
      "0 0 100 100 re W n q 200 200 10 10 re W n 0 0 100 100 re f " +
      "q [1 2] 3 d 3 0 0 3 4 5 cm 0 0 100 100 re f Q Q 0 0 100 100 re f" },
    { name: "repeated saves and later transformations preserve earlier paint", source:
      "[3 2] 0 d 2 w " + Array.from({ length: 24 }, (_, index) =>
        `q 1 0 0 1 ${index} ${index} cm q /Changed gs 0 0 10 10 re S Q 0 0 20 20 re S Q `).join("") }
  ];
  for (const { name, source } of cases) {
    for (const output of ["geometry", "display-program", "vector-scene"]) {
      // No preview scale: the only thumbnail behavior under test is graphics
      // state sharing, independently of allowed visual approximations.
      const canonical = await compile(source, { output, thumbnail: false });
      const shared = await compile(source, { output, thumbnail: true });
      assert.deepEqual(shared, canonical, `${name}: ${output} shares values without changing semantics`);
    }
    const canonical = await compile(source, { output: "display-program", compactRetainedResources: true, thumbnail: false });
    const shared = await compile(source, { output: "display-program", compactRetainedResources: true, thumbnail: true });
    assert.deepEqual(logicalPage(shared), logicalPage(canonical), `${name}: packed retained paths and paints remain exact`);
  }

  const forms = await compile("[4 2] 1 d 2 w .2 .3 .4 RG /Form Do q 2 0 0 3 5 7 cm /Changed gs " +
    "0 0 30 30 re W n /Form Do q 1 0 0 1 9 11 cm [1 2] 5 d 9 w 1 0 0 RG " +
    "0 0 10 10 re W n /Form Do Q /Form Do Q /Form Do", {
    output: "display-program", thumbnail: true, formXObjects: new Map([["Form", 0]])
  });
  assert.equal(forms.formPaints.length, 5);
  assert.deepEqual(forms.formPaints[4], forms.formPaints[0], "outer Form invocation recovers all original state after nested saves");
  assert.deepEqual(forms.formPaints[3], forms.formPaints[1], "middle Form invocation recovers matrix, clip, dash, pen and opacity");
  assert.notDeepEqual(forms.formPaints[2], forms.formPaints[1], "nested state changes remain visible inside their own scope");
  assert.deepEqual(forms.formPaints[0].initialGraphicsState.lineDash, [4, 2]);
  assert.deepEqual(forms.formPaints[1].initialGraphicsState.lineDash, [2, 5, 1, 2, 5, 1]);
  assert.deepEqual(forms.formPaints[2].initialGraphicsState.lineDash, [1, 2]);
  assert.deepEqual(forms.formPaints[0].transform, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(forms.formPaints[1].transform, [2, 0, 0, 3, 5, 7]);
  assert.deepEqual(forms.formPaints[2].transform, [2, 0, 0, 3, 23, 40]);

  const clipped = await compile(cases[2].source, { output: "geometry", thumbnail: true });
  const lastFill = (clipped.fillPathCount - 1) * 4;
  assert.equal(clipped.fillPathMetaA[lastFill + 1], 8, "restored outer clip retains its four-sided exclusion hole");
  assert.deepEqual([...clipped.fillPathMetaA.slice(lastFill + 2, lastFill + 4)], [0, 0]);
  assert.deepEqual([...clipped.fillPathMetaB.slice(lastFill, lastFill + 2)], [120, 100]);
  const empty = await compile(cases[3].source, { output: "geometry", thumbnail: true });
  assert.equal(empty.fillPathCount, 1, "only the fill after the empty inner clip is restored paints");
  await assert.rejects(compile("Q", { output: "display-program", thumbnail: true }), DensePdfSyntaxError);
  assert.deepEqual({ pageMatrix, pageBounds, changedState }, callerBefore, "shared thumbnail snapshots never mutate caller-owned options/resources");
  console.log("Thumbnail graphics state: nested q/Q matrix/path, dash/ExtGState, clip-hole/empty-clip restoration, packed/canonical parity and Form snapshot isolation passed.");

  function compile(source, overrides) {
    return compileDensePdfContent(encoder.encode(source), { ...options, ...overrides });
  }
  function logicalPage(page) {
    const { packedRetainedResources: _packed, ...rest } = page;
    return { ...rest,
      pagePaths: Array.from({ length: densePdfPagePathCount(page) }, (_, index) => getDensePdfPagePath(page, index)),
      genericPathPaints: Array.from({ length: densePdfGenericPathPaintCount(page) }, (_, index) => getDensePdfGenericPathPaint(page, index)) };
  }
} finally { hooks.deregister(); }
