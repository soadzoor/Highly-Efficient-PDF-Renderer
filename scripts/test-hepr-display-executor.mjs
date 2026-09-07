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
  const {
    HEPR_COLOR_SPACE_KIND,
    HEPR_PAINT_KIND,
    HEPR_VIEW_TRANSFORM_FLAG,
    createEmptyHeprPageData
  } = await import("../src/heprDocumentData.ts");
  const {
    HEPR_DISPLAY_EXECUTION_CODES,
    HeprDisplayExecutionError,
    collectHeprExecutionScopes,
    executeHeprDisplayProgram
  } = await import("../src/heprDisplayExecutor.ts");

  const page = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  page.displayProgram = orderedProgram(HEPR_VIEW_TRANSFORM_FLAG.NoZoom);

  const events = [];
  const draws = [];
  const groupContexts = [];
  const programContexts = [];
  let previousDrawSettled = true;
  const stats = await executeHeprDisplayProgram(page, {
    beginCompositeGroup(context) {
      groupContexts.push(context);
      events.push(`begin-group:${context.role}:${context.groupIndex}`);
    },
    async drawRun(context) {
      assert.equal(previousDrawSettled, true, "draw callbacks must be awaited in source order");
      previousDrawSettled = false;
      events.push(`draw:${context.command.first}`);
      await Promise.resolve();
      previousDrawSettled = true;
      draws.push(context);
    },
    endCompositeGroup(context, outcome) {
      events.push(`end-group:${context.role}:${context.groupIndex}:${outcome.status}`);
    },
    beginProgram(context) {
      programContexts.push(context);
      events.push(`begin-program:${context.programIndex}`);
    },
    endProgram(context, outcome) {
      events.push(`end-program:${context.programIndex}:${outcome.status}`);
    }
  });

  assert.deepEqual(events, [
    "begin-group:root:0",
    "draw:0",
    "begin-program:0",
    "draw:1",
    "end-program:0:complete",
    "begin-group:soft-mask:2",
    "draw:2",
    "end-group:soft-mask:2:complete",
    "begin-group:invoked:1",
    "draw:3",
    "end-group:invoked:1:complete",
    "draw:5",
    "end-group:root:0:complete"
  ]);
  assert.deepEqual(draws.map(({ command }) => command.first), [0, 1, 2, 3, 5]);
  assert.deepEqual(draws.map(({ sequence }) => sequence), [0, 1, 2, 3, 4]);
  assert.deepEqual(draws[1].state.transform, [2, 0, 0, 2, 10, 10]);
  assert.equal(draws[1].state.type3PaintIndex, 0);
  assert.equal(draws[1].state.viewTransformFlags, HEPR_VIEW_TRANSFORM_FLAG.NoZoom);
  assert.equal(draws.at(-1).state.viewTransformFlags, 0, "view flags do not leak to siblings");
  assert.equal(programContexts[0].viewTransformFlags, HEPR_VIEW_TRANSFORM_FLAG.NoZoom);
  assert.equal(programContexts[0].state.viewTransformFlags, HEPR_VIEW_TRANSFORM_FLAG.NoZoom);
  assert.deepEqual(
    collectHeprExecutionScopes(draws[1].state.clips).map((scope) => scope.kind),
    ["resource", "program-bounds"]
  );
  assert.deepEqual(
    collectHeprExecutionScopes(draws[1].state.optionalContent).map(({ index }) => index),
    [0]
  );
  assert.deepEqual(
    collectHeprExecutionScopes(draws[1].state.markedContent).map(({ index }) => index),
    [0]
  );

  const invokedGroup = groupContexts.find(({ role }) => role === "invoked");
  const softMaskGroup = groupContexts.find(({ role }) => role === "soft-mask");
  assert.ok(invokedGroup);
  assert.ok(softMaskGroup);
  assert.equal(invokedGroup.isolated, true);
  assert.equal(invokedGroup.knockout, true);
  assert.equal(invokedGroup.blendMode, "Multiply");
  assert.equal(invokedGroup.alpha, 0.5);
  assert.equal(invokedGroup.alphaIsShape, true);
  assert.equal(invokedGroup.softMaskGroupIndex, 2);
  assert.equal(invokedGroup.softMaskSubtype, "Alpha");
  assert.equal(invokedGroup.softMaskTransferFunctionIndex, -1);
  assert.equal(invokedGroup.softMaskExecutionId, softMaskGroup.executionId);
  assert.equal(softMaskGroup.parentExecutionId, invokedGroup.executionId);
  assert.equal(invokedGroup.backdropPaintIndex, 0);
  assert.equal(invokedGroup.blendingColorSpaceIndex, 0);
  assert.equal(invokedGroup.clipIndex, 0);
  assert.equal(collectHeprExecutionScopes(invokedGroup.state.clips).at(-1).origin, "group");
  assert.equal(programContexts[0].program.clipToBounds, true);
  assert.deepEqual(programContexts[0].program.bounds, [0, 0, 10, 10]);

  assert.deepEqual(stats, {
    executedCommands: 8,
    drawRuns: 5,
    drawnItems: 5,
    hiddenCommands: 1,
    compositeGroupExecutions: 3,
    softMaskExecutions: 1,
    programExecutions: 1,
    maxDepth: 2
  });

  const cyclic = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  cyclic.displayProgram.programs = [{
    kind: "form",
    commands: [invokeProgram(0)],
    matrixIndex: 0,
    bounds: null,
    clipToBounds: false,
    resourceName: "cycle"
  }];
  cyclic.displayProgram.groups[0].commands = [invokeProgram(0)];
  await assert.rejects(
    executeHeprDisplayProgram(cyclic, noOpBackend()),
    (error) => error instanceof HeprDisplayExecutionError &&
      error.code === HEPR_DISPLAY_EXECUTION_CODES.ResourceCycle
  );

  const tooDeep = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  tooDeep.displayProgram.groups[0].commands = [invokeProgram(0)];
  tooDeep.displayProgram.programs = [0, 1, 2].map((index) => ({
    kind: "form",
    commands: index === 2 ? [draw(0)] : [invokeProgram(index + 1)],
    matrixIndex: 0,
    bounds: null,
    clipToBounds: false,
    resourceName: `depth-${index}`
  }));
  await assert.rejects(
    executeHeprDisplayProgram(tooDeep, noOpBackend(), {
      limits: { maxInvocationDepth: 2 }
    }),
    (error) => error instanceof HeprDisplayExecutionError &&
      error.code === HEPR_DISPLAY_EXECUTION_CODES.DepthLimit
  );

  const unknownSource = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  unknownSource.displayProgram.groups[0].commands = [{ ...draw(0), source: "widgets" }];
  await assert.rejects(
    executeHeprDisplayProgram(unknownSource, noOpBackend()),
    (error) => error instanceof HeprDisplayExecutionError &&
      error.code === HEPR_DISPLAY_EXECUTION_CODES.UnsupportedDrawSource
  );

  const unknownBlend = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  unknownBlend.displayProgram.groups[0].blendMode = "Dissolve";
  await assert.rejects(
    executeHeprDisplayProgram(unknownBlend, noOpBackend()),
    (error) => error instanceof HeprDisplayExecutionError &&
      error.code === HEPR_DISPLAY_EXECUTION_CODES.UnsupportedBlendMode
  );

  const cancelled = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  cancelled.displayProgram.groups[0].commands = [draw(0), draw(1)];
  const controller = new AbortController();
  const reason = new Error("cancel display execution");
  const cancellationEvents = [];
  await assert.rejects(
    executeHeprDisplayProgram(cancelled, {
      beginCompositeGroup() {
        cancellationEvents.push("begin");
      },
      drawRun(context) {
        cancellationEvents.push(`draw:${context.command.first}`);
        controller.abort(reason);
      },
      endCompositeGroup(_context, outcome) {
        cancellationEvents.push(`end:${outcome.status}`);
      }
    }, { signal: controller.signal }),
    (error) => error === reason
  );
  assert.deepEqual(cancellationEvents, ["begin", "draw:0", "end:aborted"]);

  const invalidReference = populatedPage(createEmptyHeprPageData(pageInfo()), {
    colorKind: HEPR_COLOR_SPACE_KIND.DeviceRgb,
    paintKind: HEPR_PAINT_KIND.SolidColor
  });
  invalidReference.displayProgram.groups[0].commands = [draw(0, { transformIndex: 99 })];
  await assert.rejects(
    executeHeprDisplayProgram(invalidReference, noOpBackend()),
    (error) => error instanceof HeprDisplayExecutionError &&
      error.code === HEPR_DISPLAY_EXECUTION_CODES.InvalidResource
  );

  console.log("ordered HEPR display executor passed");
} finally {
  hooks.deregister();
}

function pageInfo() {
  return {
    sourcePageIndex: 0,
    mediaBox: [0, 0, 100, 100],
    cropBox: [0, 0, 100, 100],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width: 100,
    height: 100
  };
}

function populatedPage(page, constants) {
  page.stores.transforms.values = new Float32Array([
    1, 0, 0, 1, 0, 0,
    1, 0, 0, 1, 10, 0,
    2, 0, 0, 2, 0, 0,
    1, 0, 0, 1, 0, 5
  ]);
  page.stores.paths.fillPathMetaA = new Float32Array(6 * 4);
  page.stores.paths.fillPathMetaB = new Float32Array(6 * 4);
  page.stores.paths.fillPathMetaC = new Float32Array(6 * 4);
  page.stores.clips = {
    parentIndices: new Int32Array([-1]),
    firstPaths: new Uint32Array([0]),
    pathCounts: new Uint32Array([0]),
    firstGlyphs: new Uint32Array([0]),
    glyphCounts: new Uint32Array([0]),
    fillRules: new Uint8Array([0]),
    transformIndices: new Uint32Array([0])
  };
  page.stores.colors = {
    spaceKinds: new Uint8Array([constants.colorKind]),
    componentCounts: new Uint8Array([3]),
    alternateSpaceIndices: new Int32Array([-1]),
    functionIndices: new Int32Array([-1]),
    parameterOffsets: new Uint32Array([0, 0]),
    parameters: new Float32Array(0),
    nameOffsets: new Uint32Array([0, 0]),
    names: [],
    profileOffsets: new Uint32Array([0, 0]),
    profiles: new Uint8Array(0),
    lookupOffsets: new Uint32Array([0, 0]),
    lookupBytes: new Uint8Array(0)
  };
  page.stores.paints = {
    kinds: new Uint8Array([constants.paintKind]),
    resourceIndices: new Uint32Array([0]),
    alphas: new Float32Array([1]),
    overprint: new Uint8Array([0]),
    overprintModes: new Uint8Array([0]),
    patternTransformIndices: new Int32Array([-1]),
    patternBasePaintIndices: new Int32Array([-1])
  };
  page.stores.optionalContent = {
    names: ["visible", "hidden"],
    defaultVisible: new Uint8Array([1, 0])
  };
  page.stores.markedContent = {
    tags: ["Span"],
    propertyNames: [null],
    mcids: new Int32Array([7]),
    parentIndices: new Int32Array([-1])
  };
  return page;
}

function orderedProgram(noZoomFlag) {
  return {
    rootGroupIndex: 0,
    groups: [
      {
        commands: [
          draw(0),
          invokeProgram(0, {
            transformIndex: 1,
            clipIndex: 0,
            optionalContentIndex: 0,
            markedContentIndex: 0,
            type3PaintIndex: 0,
            viewTransformFlags: noZoomFlag
          }),
          draw(4, { optionalContentIndex: 1 }),
          invokeGroup(1, { transformIndex: 3 }),
          draw(5)
        ],
        isolated: true,
        knockout: false,
        blendMode: "Normal",
        alpha: 1,
        alphaIsShape: false,
        softMaskGroupIndex: -1,
        softMaskSubtype: null,
        softMaskTransferFunctionIndex: -1,
        backdropPaintIndex: -1,
        blendingColorSpaceIndex: -1,
        clipIndex: -1
      },
      {
        commands: [draw(3)],
        isolated: true,
        knockout: true,
        blendMode: "Multiply",
        alpha: 0.5,
        alphaIsShape: true,
        softMaskGroupIndex: 2,
        softMaskSubtype: "Alpha",
        softMaskTransferFunctionIndex: -1,
        backdropPaintIndex: 0,
        blendingColorSpaceIndex: 0,
        clipIndex: 0
      },
      {
        commands: [draw(2)],
        isolated: false,
        knockout: false,
        blendMode: "Normal",
        alpha: 1,
        alphaIsShape: false,
        softMaskGroupIndex: -1,
        softMaskSubtype: null,
        softMaskTransferFunctionIndex: -1,
        backdropPaintIndex: -1,
        blendingColorSpaceIndex: -1,
        clipIndex: -1
      }
    ],
    programs: [{
      kind: "type3",
      commands: [draw(1, { transformIndex: 3, paintIndex: -1 })],
      matrixIndex: 2,
      bounds: [0, 0, 10, 10],
      clipToBounds: true,
      resourceName: "GlyphA"
    }]
  };
}

function commandState(overrides = {}) {
  return {
    transformIndex: 0,
    clipIndex: -1,
    optionalContentIndex: -1,
    markedContentIndex: -1,
    sourceOffset: -1,
    sourceLength: -1,
    ...overrides
  };
}

function draw(first, overrides = {}) {
  return {
    kind: "draw",
    source: "fill-paths",
    first,
    count: 1,
    paintIndex: 0,
    ...commandState(overrides)
  };
}

function invokeProgram(programIndex, overrides = {}) {
  return {
    kind: "invoke-program",
    programIndex,
    type3PaintIndex: -1,
    viewTransformFlags: 0,
    ...commandState(overrides)
  };
}

function invokeGroup(groupIndex, overrides = {}) {
  return {
    kind: "invoke-group",
    groupIndex,
    ...commandState(overrides)
  };
}

function noOpBackend() {
  return {
    drawRun() {},
    beginCompositeGroup() {},
    endCompositeGroup() {}
  };
}
