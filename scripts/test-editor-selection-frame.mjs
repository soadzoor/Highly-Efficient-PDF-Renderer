import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { composeOverlappingVectorScenes } = await import("../src/pdfVectorExtractor.ts");
  const { multiplyEditorMatrices: multiply, editorTransformBounds, editorPoint } = await import("../src/editorScene.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const identity = [1, 0, 0, 1, 0, 0];
  const angle = Math.PI / 5, rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 13, -7];
  const affine = [-1.4, .2, .45, .8, 27, 9];
  const close = (actual, expected, label) => {
    assert(actual && expected, label);
    for (const key of Object.keys(expected)) assert(Math.abs(actual[key] - expected[key]) < 1e-7, `${label}: ${key}: ${actual[key]} != ${expected[key]}`);
  };
  const closeFrame = (actual, expected, label) => { close(actual.bounds, expected.bounds, label + " bounds"); close(actual.transform, expected.transform, label + " transform"); assert.equal(actual.pageIndex, expected.pageIndex, label + " page"); };
  const base = buildStrokeScene([{ points: [[10, 20], [60, 20]], width: 2 }, { points: [[10, 70], [60, 70]], width: 2 }]);
  base.pageRects = Float32Array.of(0, 0, 100, 100); base.pageBounds = base.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const imageData = Uint8Array.of(255, 0, 0, 255);
  const authored = await openEditorSession(base);
  try {
    assert.equal(authored.getSelectionFrame(), null);
    for (const input of [
      { kind: "text", x: 5, y: 6, width: 30, height: 12, text: "Frame", fontSize: 8 },
      { kind: "image", x: 5, y: 6, width: 30, height: 12, imageWidth: 1, imageHeight: 1, data: imageData },
      { kind: "shape", shape: "arrow", x: 5, y: 6, width: 30, height: 12, strokeWidth: 3 },
      { kind: "ink", paths: [[[5, 6], [35, 18]]], strokeWidth: 2 },
      { kind: "signature", paths: [[[5, 6], [20, 18], [35, 6]]], strokeWidth: 2 }
    ]) {
      const id = authored.addObject({ ...input, pageIndex: 0, transform: rotation });
      const before = authored.getSelectionFrame(); close(before.transform, rotation, `${input.kind} uses its original axes`);
      close(editorTransformBounds(before.bounds, before.transform), authored.getObjectBounds(id), `${input.kind} frame encloses painted bounds`);
      authored.transformSelection(affine); const moved = authored.getSelectionFrame();
      close(moved.transform, multiply(affine, rotation), `${input.kind} retains shear and reflection`);
      authored.select([]); authored.select([id]); closeFrame(authored.getSelectionFrame(), moved, `${input.kind} reselection`);
      authored.setPreviewTransform(rotation); closeFrame(authored.getSelectionFrame(), moved, "previews never alter committed frames"); authored.setPreviewTransform(null);
      authored.undo(); closeFrame(authored.getSelectionFrame(), before, `${input.kind} undo`);
      authored.redo(); closeFrame(authored.getSelectionFrame(), moved, `${input.kind} redo`);
      moved.bounds.minX = -999; moved.transform[0] = -999;
      assert.notEqual(authored.getSelectionFrame().bounds.minX, -999, "returned bounds are detached");
      assert.notEqual(authored.getSelectionFrame().transform[0], -999, "returned transforms are detached");
    }
    const originalClone = globalThis.structuredClone; let copiedImages = 0;
    try {
      globalThis.structuredClone = value => { if (value?.kind === "image") copiedImages++; return originalClone(value); };
      const image = authored.getObjects().find(object => object.kind === "image"); authored.select([image.id]); copiedImages = 0;
      for (let index = 0; index < 5; index++) authored.getSelectionFrame();
      assert.equal(copiedImages, 0, "frame queries never clone RGBA author models");
    } finally { globalThis.structuredClone = originalClone; }
  } finally { authored.dispose(); }

  const groupSession = await openEditorSession(base);
  try {
    const first = groupSession.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 4, y: 6, width: 12, height: 9, transform: rotation });
    const second = groupSession.addObject({ kind: "shape", pageIndex: 0, shape: "ellipse", x: 40, y: 20, width: 16, height: 11, transform: affine });
    groupSession.select([first, second]); const multi = groupSession.getSelectionFrame();
    groupSession.transformSelection(rotation); const turnedMulti = groupSession.getSelectionFrame();
    close(turnedMulti.transform, multiply(rotation, multi.transform), "heterogeneous multi-selection retains the applied basis");
    groupSession.select([second, first]); closeFrame(groupSession.getSelectionFrame(), turnedMulti, "reordering selected IDs preserves the active basis");
    groupSession.undo(); closeFrame(groupSession.getSelectionFrame(), multi, "multi-selection undo restores its basis"); groupSession.redo();
    const group = groupSession.groupSelection(), groupFrame = groupSession.getSelectionFrame();
    closeFrame(groupFrame, turnedMulti, "grouping preserves an oriented multi-selection");
    const childBefore = groupSession.getObject(first).transform;
    groupSession.transformSelection(affine); const turnedGroup = groupSession.getSelectionFrame();
    close(turnedGroup.transform, multiply(affine, groupFrame.transform), "group axes follow the group delta");
    close(groupSession.getObject(first).transform, multiply(affine, childBefore), "group geometry moves once rather than applying the group basis twice");
    groupSession.select([]); groupSession.select([group]); closeFrame(groupSession.getSelectionFrame(), turnedGroup, "group reselection keeps orientation independently of child initial angles");
    groupSession.undo(); closeFrame(groupSession.getSelectionFrame(), groupFrame, "group undo"); groupSession.redo();
    groupSession.ungroupSelection(); closeFrame(groupSession.getSelectionFrame(), turnedGroup, "ungrouping retains the frame of the active children");
    groupSession.cloneSelection([7, 11]); const cloned = groupSession.getSelectionFrame();
    close(cloned.transform, multiply([1, 0, 0, 1, 7, 11], turnedGroup.transform), "duplicated selection retains its orientation");
  } finally { groupSession.dispose(); }

  const source = await openEditorSession(base);
  try {
    source.selectPrimitives([{ kind: "stroke", index: 0 }]); const original = source.getSelectionFrame();
    source.transformSelection(rotation); const turned = source.getSelectionFrame(); close(turned.transform, rotation, "source primitive records its cumulative edit basis");
    source.select([]); source.selectPrimitives([{ kind: "stroke", index: 0 }]); closeFrame(source.getSelectionFrame(), turned, "source reselection");
    source.undo(); closeFrame(source.getSelectionFrame(), original, "source undo"); source.redo();
    source.cloneSelection([9, 3]); close(source.getSelectionFrame().transform, multiply([1, 0, 0, 1, 9, 3], rotation), "source clone frame");
  } finally { source.dispose(); }
  const annotationScene = structuredClone(base);
  annotationScene.optionalContent = { groups: [{ id: "annotation:a", name: "Annotation", defaultVisible: true, locked: true, usedInView: false, annotationId: "a" }],
    conditions: [{ kind: "group", groupId: "annotation:a" }], order: [], radioGroups: [] };
  annotationScene.drawRuns = [{ kind: "stroke", first: 0, count: 2, optionalContent: 0 }];
  annotationScene.annotations = [{ id: "a", sourcePageIndex: 0, annotationIndex: 0, subtype: "Ink", pdfGeometry: { rect: [0, 0, 60, 70] },
    bounds: { minX: 10, minY: 20, maxX: 60, maxY: 70 }, flags: 0, visibleInDefaultView: true, hasAppearance: true, pageIndex: 0 },
  { id: "empty", sourcePageIndex: 0, annotationIndex: 1, subtype: "Widget", pdfGeometry: { rect: [3, 4, 13, 14] },
    bounds: { minX: 3, minY: 4, maxX: 13, maxY: 14 }, flags: 0, visibleInDefaultView: true, hasAppearance: false, pageIndex: 0 }];
  const annotations = await openEditorSession(annotationScene);
  try {
    annotations.selectPrimitives([{ kind: "stroke", index: 0 }]); annotations.transformSelection(rotation);
    assert.equal(annotations.getSourceEdits().length, 2); close(annotations.getSelectionFrame().transform, rotation, "multi-primitive annotation shares its edit basis");
    annotations.selectAnnotations(["empty"]); const empty = annotations.getSelectionFrame(); annotations.transformSelection(affine);
    close(annotations.getSelectionFrame().transform, affine, "metadata-only annotations retain affine orientation");
    annotations.undo(); closeFrame(annotations.getSelectionFrame(), empty, "blank field frame undo");
  } finally { annotations.dispose(); }

  const mixedScene = structuredClone(base);
  mixedScene.drawRuns = [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 }];
  const mixed = await openEditorSession(mixedScene);
  try {
    mixed.selectPrimitives([{ kind: "stroke", index: 0 }]); mixed.transformSelection(rotation);
    mixed.selectPrimitives([{ kind: "stroke", index: 1 }]); mixed.transformSelection(affine);
    // Materialize a compositing unit over an existing per-member edit history.
    mixedScene.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: true, blendMode: "Normal",
      children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }] };
    mixed.selectPrimitives([{ kind: "stroke", index: 0 }]); const before = mixed.getSelectionFrame();
    close(before.transform, rotation, "mixed source unit uses its first surviving member basis");
    mixed.transformSelection(rotation); const after = mixed.getSelectionFrame();
    closeFrame(after, { ...before, transform: multiply(rotation, before.transform) }, "mixed source unit retains orientation after a shared transform");
    mixed.select([]); mixed.selectPrimitives([{ kind: "stroke", index: 0 }]); closeFrame(mixed.getSelectionFrame(), after, "mixed source reselection");
    mixed.undo(); closeFrame(mixed.getSelectionFrame(), before, "mixed source undo");
  } finally { mixed.dispose(); }

  const other = structuredClone(base); other.pageRects = Float32Array.of(150, 0, 250, 100);
  other.bounds = other.pageBounds = { minX: 150, minY: 0, maxX: 250, maxY: 100 };
  const twoPages = await openEditorSession(composeOverlappingVectorScenes([base, other]));
  try {
    const first = twoPages.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 4, y: 6, width: 12, height: 9 });
    const second = twoPages.addObject({ kind: "shape", pageIndex: 1, shape: "rectangle", x: 4, y: 6, width: 12, height: 9, transform: rotation });
    close(twoPages.getSelectionFrame().transform, multiply([1, 0, 0, 1, 150, 0], rotation), "page origin composes before the authored transform");
    assert.equal(twoPages.getSelectionFrame().pageIndex, 1);
    twoPages.select([first, second]); assert.equal(twoPages.getSelectionFrame().pageIndex, undefined, "cross-page frames do not claim a single projection page");
    twoPages.transformSelection(rotation); assert.equal(twoPages.getSelectionFrame().pageIndex, undefined);
    const frame = twoPages.getSelectionFrame(), point = editorPoint(frame.transform, frame.bounds.minX, frame.bounds.minY);
    assert(point.every(Number.isFinite));
  } finally { twoPages.dispose(); }

  let release, announce, snapshotFrame;
  const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => announce = resolve);
  const exporting = await openEditorSession(base, { savePdf: async (_scene, owner) => {
    snapshotFrame = owner.getSelectionFrame(); announce(); await gate;
    closeFrame(owner.getSelectionFrame(), snapshotFrame, "read-only PDF snapshots pin their frame");
    assert.throws(() => owner.transformSelection(rotation), /read-only/); return new Blob(["pdf"]);
  } });
  try {
    exporting.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 4, y: 6, width: 12, height: 9, transform: rotation });
    const save = exporting.savePdf(); await started; exporting.transformSelection(affine); release(); await save;
    assert(exporting.getState().dirty); assert.notDeepEqual(exporting.getSelectionFrame().transform, snapshotFrame.transform);
    const hep = await exporting.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false }), loaded = await loadSceneFromHep(await hep.arrayBuffer());
    assert(!("selectionFrame" in loaded)); assert(!("selectionBasis" in loaded), "HEP stores baked rendering data without selection metadata");
  } finally { release(); exporting.dispose(); }
  console.log("Editor selection frames: authored/source/group orientation, committed reselection, affine history, page ownership, pinned exports and compact HEP passed.");
} finally { hooks.deregister(); }
