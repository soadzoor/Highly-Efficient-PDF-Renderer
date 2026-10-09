import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [sessionApi, validationApi, executorApi, dataApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts"),
    import("../src/heprDocumentData.ts")
  ]);
  const { openPdf } = sessionApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram, collectHeprExecutionScopes } = executorApi;
  const { HEPR_PATH_VERB, HEPR_STROKE_FLAG } = dataApi;

  const session = await openPdf({ kind: "bytes", bytes: pathFixture(), label: "paths.pdf" });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.stores.clips.parentIndices.length, 3);
    assert.deepEqual([...page.stores.clips.parentIndices], [-1, 0, -1]);
    assert.ok([...page.stores.paths.verbs].includes(HEPR_PATH_VERB.CubicTo));
    assert.equal(page.stores.strokes.lineWidths.length, 4);
    assert.equal(page.stores.strokes.lineCaps[0], 2);
    assert.equal(page.stores.strokes.lineJoins[0], 1);
    assert.equal(page.stores.strokes.miterLimits[0], 4);
    assert.equal(
      page.stores.strokes.flags[0],
      HEPR_STROKE_FLAG.Hairline | HEPR_STROKE_FLAG.StrokeAdjust
    );
    assert.deepEqual([...page.stores.strokes.dashValues.slice(0, 2)], [3, 2]);
    assert.deepEqual([...page.stores.strokes.lineCaps], [2, 0, 1, 2]);
    assert.deepEqual([...page.stores.strokes.lineJoins], [1, 0, 1, 2]);

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.equal(root.commands.at(-1).source, "fill-paths", "Q restores the page clip");
    assert.equal(root.commands.at(-1).clipIndex, -1);
    const pageGroupInvocations = root.commands.filter((command) => command.kind === "invoke-group");
    assert.equal(pageGroupInvocations.length, 2, "transparent fill and stroke composite separately");
    const [pageGroupInvocation, pageStrokeGroupInvocation] = pageGroupInvocations;
    assert.ok(pageGroupInvocation.clipIndex >= 0);
    assert.equal(pageStrokeGroupInvocation.clipIndex, pageGroupInvocation.clipIndex);
    assert.equal(page.stores.clips.parentIndices[pageGroupInvocation.clipIndex], 0);
    assert.ok(pageGroupInvocation.optionalContentIndex >= 0);
    assert.ok(pageGroupInvocation.markedContentIndex >= 0);
    const pagePath = page.displayProgram.groups[pageGroupInvocation.groupIndex].commands[0];
    const pageStrokePath = page.displayProgram.groups[pageStrokeGroupInvocation.groupIndex].commands[0];
    assert.equal(pagePath.source, "paths");
    assert.ok(pagePath.fillPaintIndex >= 0);
    assert.equal(pagePath.strokePaintIndex, -1);
    assert.equal(pagePath.strokeStyleIndex, -1);
    assert.equal(pageStrokePath.source, "paths");
    assert.equal(pageStrokePath.fillPaintIndex, -1);
    assert.ok(pageStrokePath.strokePaintIndex >= 0);
    assert.ok(pageStrokePath.strokeStyleIndex >= 0);
    assert.equal(pagePath.fillRule, 1);
    assert.equal(pagePath.clipIndex, -1, "composite invocation owns the exact source scope");
    assert.notEqual(
      page.stores.clips.transformIndices[pageGroupInvocation.clipIndex],
      pagePath.transformIndex,
      "clip and paint freeze their independently live CTMs"
    );

    const formInvocation = root.commands.find((command) => command.kind === "invoke-program");
    assert.ok(formInvocation);
    assert.equal(formInvocation.clipIndex, pageGroupInvocation.clipIndex);
    const formProgram = page.displayProgram.programs[formInvocation.programIndex];
    assert.equal(formProgram.kind, "form");
    const formGroupInvocation = formProgram.commands.find((command) => command.kind === "invoke-group");
    assert.ok(formGroupInvocation?.clipIndex >= 0);
    const formPath = flattenCommands(page, formProgram.commands)
      .find((command) => command.kind === "draw" && command.source === "paths");
    assert.ok(formPath);
    assert.equal(formPath.clipIndex, -1);
    assert.equal(page.stores.clips.parentIndices[formGroupInvocation.clipIndex], -1);

    const executionOrder = [];
    let nestedClipDepth = 0;
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        executionOrder.push(execution.command.source);
        if (execution.command === formPath) {
          nestedClipDepth = collectHeprExecutionScopes(execution.state.clips).length;
        }
      }
    });
    assert.deepEqual(
      executionOrder,
      ["paths", "paths", "paths", "paths", "paths", "fill-paths"]
    );
    assert.ok(nestedClipDepth >= 3, "caller clip, Form BBox, and Form-local clip compose");

  } finally {
    await session.close();
  }

  const vectorClipSession = await openPdf({
    kind: "bytes",
    bytes: vectorClipCompatibilityFixture(),
    label: "vector-irregular-clip.pdf"
  });
  try {
    const scene = await vectorClipSession.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 1, "the exactly clipped fill stays vector");
    assert.equal(scene.rasterLayers.length, 0, "no raster fallback layer");
    assert.equal(scene.drawRuns?.length, 1);
    assert.equal(scene.clipPaths[scene.drawRuns[0].clipIndex].fillRule, 1, "W* keeps even-odd clipping");
    assert.ok(isFillPaintedAt(scene, 40, 20));
    assert.ok(isFillPaintedAt(scene, 40, 55));
    assert.equal(isFillPaintedAt(scene, 12, 55), false, "the irregular clip excludes its AABB-only corner");
    assert.equal(isFillPaintedAt(scene, 68, 55), false);
  } finally {
    await vectorClipSession.close();
  }

  const largePathSession = await openPdf({
    kind: "bytes", bytes: largeVectorPathFixture(), label: "large-vector-path.pdf"
  });
  try {
    const scene = await largePathSession.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 2, "both paints stay vector with a large path and clip");
    assert.ok(scene.fillSegmentCount > 65_536, "analytic fill retains more than the former segment ceiling");
    assert.equal(scene.rasterLayers.length, 0, "path complexity does not request raster fallback");
    const clippedRun = scene.drawRuns.find(run => (run.clipIndex ?? -1) >= 0);
    assert.ok(clippedRun, "the first fill retains its exact clip");
    const clip = scene.clipPaths[clippedRun.clipIndex];
    assert.equal(clip.fillRule, 1, "large even-odd clips preserve their winding rule");
    assert.ok(clip.edges.length / 4 > 65_536, "large clipping geometry remains complete");
  } finally {
    await largePathSession.close();
  }

  for (const [limits, reason] of [
    [{ maxPathsPerPage: 1 }, undefined],
    [{ maxClipsPerPage: 2 }, "clips"],
    [{ maxPathVerbsPerPage: 3 }, undefined],
    [{ maxPathCoordinatesPerPage: 4 }, undefined],
    [{ maxStrokeStylesPerPage: 3 }, "stroke-styles"],
    [{ maxDashValuesPerPage: 1 }, undefined]
  ]) {
    const limited = await openPdf({ kind: "bytes", bytes: pathFixture() });
    try {
      await assert.rejects(
        limited.compilePage(0, { optimization: "none", limits }),
        (error) => error?.code === "resource-limit" &&
          (reason === undefined || error?.details?.reason === reason)
      );
    } finally {
      await limited.close();
    }
  }

  const malformed = await openPdf({ kind: "bytes", bytes: allZeroDashFixture() });
  try {
    await assert.rejects(
      malformed.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "invalid-object" && /dash array/.test(error.message)
    );
  } finally {
    await malformed.close();
  }

  console.log("PDF session generic path/stroke/clip integration tests passed");
} finally {
  hooks.deregister();
}

function flattenCommands(page, commands, seen = new Set()) {
  const output = [];
  for (const command of commands) {
    if (command.kind !== "invoke-group") {
      output.push(command);
      continue;
    }
    if (seen.has(command.groupIndex)) continue;
    seen.add(command.groupIndex);
    output.push(...flattenCommands(page, page.displayProgram.groups[command.groupIndex].commands, seen));
    seen.delete(command.groupIndex);
  }
  return output;
}

/** Whether any clipped fill draw run covers a page-space point. */
function isFillPaintedAt(scene, x, y) {
  return scene.drawRuns.some((run) => {
    if (run.kind !== "fill") return false;
    for (let index = run.clipIndex ?? -1; index >= 0; index = scene.clipPaths[index].parent) {
      const clip = scene.clipPaths[index];
      if (!edgesContainPoint(clip.edges, clip.fillRule, x, y)) return false;
    }
    for (let path = run.first; path < run.first + run.count; path += 1) {
      const first = scene.fillPathMetaA[path * 4];
      const count = scene.fillPathMetaA[path * 4 + 1];
      const edges = scene.fillSegmentsA.subarray(first * 4, (first + count) * 4);
      if (edgesContainPoint(edges, scene.fillPathMetaC[path * 4], x, y)) return true;
    }
    return false;
  });
}

/** Directed [x0, y0, x1, y1] line edges; fill rule 1 is even-odd, 0 is nonzero. */
function edgesContainPoint(edges, fillRule, x, y) {
  let winding = 0;
  let crossings = 0;
  for (let offset = 0; offset < edges.length; offset += 4) {
    const [x0, y0, x1, y1] = edges.subarray(offset, offset + 4);
    if ((y0 <= y) === (y1 <= y)) continue;
    const crossingX = x0 + (y - y0) * (x1 - x0) / (y1 - y0);
    if (crossingX <= x) continue;
    crossings += 1;
    winding += y1 > y0 ? 1 : -1;
  }
  return fillRule === 1 ? crossings % 2 === 1 : winding !== 0;
}

function pathFixture() {
  const pageContent = `
    /OC /Visible BDC /Span << /MCID 7 >> BDC
    q 2 0 0 2 5 5 cm
    0 0 m 30 0 l 15 20 l h W* n
    2 2 20 12 re W n
    1 0 0 1 3 4 cm
    /Style gs 2 J 1 j 4 M [3 2] 1 d 0 w
    0 0 m 5 10 10 0 15 10 c 20 0 25 10 v 35 20 40 10 y h
    45 0 m 55 0 l 50 10 l h B*
    /Fm Do
    Q EMC EMC
    0 J 0 j 10 M [] 0 d 2 w 60 0 m 63 8 67 8 70 0 c S
    1 J 1 j 5 M 3 w 60 20 m 63 28 67 28 70 20 c S
    1 0 0 rg 70 70 10 10 re f
  `;
  const formContent = `
    0 0 m 10 0 l 5 10 l h W n
    2 J 2 j 3 M [1 2 3] -1 d 1 w
    0 0 m 3 8 7 8 10 0 c 10 10 l S
  `;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /BaseState /ON >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /Visible 7 0 R >> /ExtGState << /Style 6 0 R >> /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", pageContent) },
    {
      number: 5,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>",
        formContent
      )
    },
    { number: 6, body: "<< /Type /ExtGState /CA 0.5 /ca 0.5 /SA true >>" },
    { number: 7, body: "<< /Type /OCG /Name (Visible paths) >>" }
  ] });
}

function allZeroDashFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "[0 0] 0 d 0 0 m 10 10 l S") }
  ] });
}

function vectorClipCompatibilityFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /Contents 4 0 R >>"
    },
    {
      number: 4,
      body: tinyPdfStream(
        "",
        "q 10 10 m 70 10 l 40 60 l h W* n 10 10 60 50 re f Q"
      )
    }
  ] });
}

function largeVectorPathFixture() {
  const segments = 70_000;
  const commands = ["0 0 m"];
  for (let index = 1; index <= segments; index += 1) commands.push(`${index} ${index % 2} l`);
  const path = commands.join("\n");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${segments + 1} 4] /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", `q\n${path}\nW* n\n0 0 ${segments} 3 re f\nQ\n${path}\nf*`) }
  ] });
}
