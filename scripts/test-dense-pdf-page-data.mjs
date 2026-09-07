import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [
    { compileDensePdfContent, DensePdfUnsupportedError },
    { createHeprPageDataFromDense },
    { HEPR_PATH_VERB, HEPR_STROKE_FLAG },
    { validateHeprPageData }
  ] =
    await Promise.all([
      import("../src/pdf/nativeContentCompiler.ts"),
      import("../src/densePdfPageData.ts"),
      import("../src/heprDocumentData.ts"),
      import("../src/heprDocumentDataValidation.ts")
    ]);
  const compiled = await compileDensePdfContent(
    new TextEncoder().encode("1 0 0 rg 0 0 20 10 re f 0 0 m 20 10 l S\n"),
    {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
      preservePaintOrder: true,
      enableInvisibleCull: true
    }
  );
  const page = createHeprPageDataFromDense({
    sourcePageIndex: 0,
    mediaBox: [0, 0, 100, 80],
    cropBox: [0, 0, 100, 80],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width: 100,
    height: 80
  }, compiled);
  validateHeprPageData(page);
  assert.equal(page.displayProgram.groups[0].commands.length, 2);
  assert.equal(page.displayProgram.groups[0].commands[0].source, "fill-paths");
  assert.equal(page.displayProgram.groups[0].commands[1].source, "stroke-segments");
  assert.equal(page.stores.paths.fillPathMetaA, compiled.fillPathMetaA);
  assert.equal(page.stores.strokes.endpoints, compiled.endpoints);

  const exactCompiled = await compileDensePdfContent(
    new TextEncoder().encode(`
      q 2 0 0 2 5 5 cm
      0 0 m 30 0 l 15 20 l h W* n
      1 0 0 1 3 4 cm
      /GS1 gs 2 J 1 j 4 M [3 2] 1 d 0 w
      0 0 m 5 10 10 0 15 10 c 20 20 l h B*
      Q
      1 0 0 rg 40 40 10 10 re f
    `),
    {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
      preservePaintOrder: true,
      extGStates: [{
        resourceName: "GS1",
        strokeAlpha: 0.5,
        fillAlpha: 0.5,
        strokeAdjustment: true
      }]
    }
  );
  assert.equal(exactCompiled.pagePaths.length, 2);
  assert.equal(exactCompiled.clipPaths.length, 1);
  assert.equal(exactCompiled.genericPathPaints.length, 2);
  assert.equal(exactCompiled.paintRunClipIndices[0], 0);
  assert.equal(exactCompiled.paintRunClipIndices[1], 0);
  assert.equal(exactCompiled.paintRunClipIndices[2], -1);
  const exactPage = createHeprPageDataFromDense(page.pageInfo, exactCompiled);
  validateHeprPageData(exactPage);
  const rootCommands = exactPage.displayProgram.groups[exactPage.displayProgram.rootGroupIndex].commands;
  assert.equal(rootCommands.length, 3);
  assert.equal(rootCommands[0].kind, "invoke-group");
  assert.equal(rootCommands[0].clipIndex, 0);
  assert.equal(rootCommands[1].kind, "invoke-group");
  assert.equal(rootCommands[1].clipIndex, 0);
  assert.equal(rootCommands[2].source, "fill-paths");
  assert.equal(rootCommands[2].clipIndex, -1);
  const genericCommand = exactPage.displayProgram.groups[rootCommands[0].groupIndex].commands[0];
  const genericStrokeCommand = exactPage.displayProgram.groups[rootCommands[1].groupIndex].commands[0];
  assert.equal(genericCommand.source, "paths");
  assert.equal(genericCommand.clipIndex, -1);
  assert.equal(genericCommand.fillRule, 1);
  assert.ok(genericCommand.fillPaintIndex >= 0);
  assert.equal(genericCommand.strokePaintIndex, -1);
  assert.equal(genericStrokeCommand.fillPaintIndex, -1);
  assert.ok(genericStrokeCommand.strokePaintIndex >= 0);
  assert.ok([...exactPage.stores.paths.verbs].includes(HEPR_PATH_VERB.CubicTo));
  assert.equal(exactPage.stores.strokes.lineCaps[0], 2);
  assert.equal(exactPage.stores.strokes.lineJoins[0], 1);
  assert.equal(exactPage.stores.strokes.miterLimits[0], 4);
  assert.deepEqual([...exactPage.stores.strokes.dashValues], [3, 2]);
  assert.equal(
    exactPage.stores.strokes.flags[0],
    HEPR_STROKE_FLAG.Hairline | HEPR_STROKE_FLAG.StrokeAdjust
  );
  assert.notEqual(
    exactPage.stores.clips.transformIndices[0],
    genericCommand.transformIndex,
    "clip and later draw must freeze their own CTMs"
  );

  await assert.rejects(
    compileDensePdfContent(
      new TextEncoder().encode("BT /F1 12 Tf (must not disappear) Tj ET\n"),
      {
        pageMatrix: [1, 0, 0, 1, 0, 0],
        pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
        preservePaintOrder: true
      }
    ),
    (error) => error instanceof DensePdfUnsupportedError && error.operator === "Tj"
  );
  console.log("Dense PDF to page-native data tests passed.");
} finally {
  hooks.deregister();
}
