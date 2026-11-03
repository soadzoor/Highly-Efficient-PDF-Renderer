import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createDefaultOptionalContentSnapshot } = await import("../src/optionalContent.ts");
  const { resolveAnnotationView } = await import("../src/viewerLinkNavigation.ts");
  const { ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");
  const { SceneAnnotationIndex, isAnnotationInteractionVisible, pickSceneAnnotationInteraction } = await import("../src/sceneAnnotationInteraction.ts");
  const group = id => ({ id, name: id, defaultVisible: id === "A", locked: false, usedInView: true });
  const fixture = (kind, layered) => {
    const scene = buildStrokeScene([
      { points: [[10, 10], [25, 25]], width: 1 },
      { points: [[30, 10], [45, 25]], width: 1 },
      { points: [[70, 70], [85, 85]], width: 1 }
    ]);
    scene.pageRects = Float32Array.of(0, 0, 100, 100);
    scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    scene.drawRuns = [0, 1, 2].map(first => ({ kind: "stroke", first, count: 1 }));
    if (layered) {
      scene.optionalContent = { groups: [group("A"), group("B")],
        conditions: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" },
          { kind: "not", operand: 1 }, { kind: "and", operands: [0, 2] }],
        order: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }], radioGroups: [] };
      scene.drawRuns[0].optionalContent = 3; // A AND NOT B, not just its layer dependencies.
      scene.drawRuns[1].optionalContent = 1;
    }
    if (kind === "source-group" || kind === "ancestor-group") scene.paintGraph = { roots: [
      { kind: "group", alpha: .8, isolated: true, knockout: false, blendMode: "Normal",
        ...(kind === "ancestor-group" && layered ? { optionalContent: 2 } : {}),
        children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] },
      { kind: "draw", runIndex: 2 }
    ] };
    return scene;
  };
  const hotspot = (scene, id) => scene.annotations?.find(annotation => annotation.name === `editor-link:${encodeURIComponent(id)}`);
  const view = { centerX: 50, centerY: 50, zoom: 1 }, viewport = { width: 800, height: 600 };
  const assertLink = async (editor, owner, expectedVisible, options) => {
    const scene = await editor.getScene(options), annotation = hotspot(scene, owner);
    assert(annotation, `${owner}: the compiled scene retains a standard Link annotation`);
    assert.equal(annotation.subtype, "Link"); assert.equal(annotation.hasAppearance, false);
    assert.equal(annotation.destination.fit, "FitR");
    const snapshot = createDefaultOptionalContentSnapshot(scene);
    assert.equal(isAnnotationInteractionVisible(annotation, snapshot), expectedVisible, `${owner}: hotspot follows the owner's current visibility`);
    assert.equal(editor.isObjectVisible(owner), expectedVisible);
    const destination = resolveAnnotationView(scene, annotation, view, viewport);
    assert(destination && Object.values(destination).every(Number.isFinite), `${owner}: Read mode resolves the current object destination`);
    const target = annotation.destination.parameters;
    assert.equal(destination.centerX, (target[0] + target[2]) / 2);
    assert.equal(destination.centerY, (target[1] + target[3]) / 2);
    return { scene, annotation, destination };
  };

  for (const kind of ["primitive", "source-group", "ancestor-group", "temporary-group"]) for (const layered of [false, true]) {
    const editor = createEditorSession(fixture(kind, layered));
    try {
      editor.selectPrimitives([{ kind: "stroke", index: 2 }]); const target = editor.getSelection()[0];
      editor.selectPrimitives(kind === "temporary-group" ? [{ kind: "stroke", index: 0 }, { kind: "stroke", index: 1 }] : [{ kind: "stroke", index: 0 }]);
      const owner = kind === "temporary-group" ? editor.groupSelection() : editor.getSelection()[0];
      assert(owner); assert(!["source-group", "ancestor-group"].includes(kind) || owner.startsWith("source-group:"));
      editor.setObjectLink(owner, { type: "object", objectId: target });
      const current = await assertLink(editor, owner, true);
      const repeated = await assertLink(editor, owner, true);
      assert.equal(repeated.scene, current.scene, "link-only edits remain reusable through the committed scene cache");

      // Native and Three readers use this same metadata/geometry picking path.
      const index = new SceneAnnotationIndex(current.scene), picker = new ScenePrimitivePicker(current.scene);
      try {
        const b = current.annotation.bounds, point = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        const hit = await pickSceneAnnotationInteraction(current.scene, index, picker,
          { point, clientPoint: point, project: p => p, unproject: p => p }, createDefaultOptionalContentSnapshot(current.scene), true, new Set(), () => {});
        assert.equal(hit?.annotationId, current.annotation.id, "Read mode can click the freshly compiled hotspot");
      } finally { index.dispose(); picker.dispose(); }

      editor.select([target]); editor.setPreviewTransform([1, 0, 0, 1, 4, 6]);
      const preview = await assertLink(editor, owner, true, { preview: true });
      assert.equal(preview.destination.centerX, current.destination.centerX + 4);
      assert.equal(preview.destination.centerY, current.destination.centerY + 6);
      editor.setPreviewTransform(null);
      const committed = await assertLink(editor, owner, true, { preview: false });
      assert.deepEqual(committed.destination, current.destination, "leaving a gesture keeps the committed target instead of stale preview metadata");
      editor.transformSelection([1, 0, 0, 1, 2, 3]);
      const moved = await assertLink(editor, owner, true);
      assert.equal(moved.destination.centerX, current.destination.centerX + 2);
      assert.equal(moved.destination.centerY, current.destination.centerY + 3);

      if (layered) {
        for (const [a, b] of [[false, false], [false, true], [true, true], [true, false]]) {
          editor.updateLayer("A", { defaultVisible: a }); editor.updateLayer("B", { defaultVisible: b });
          await assertLink(editor, owner, kind === "primitive" || kind === "ancestor-group" ? a && !b : a || b);
        }
        editor.assignObjectsToLayer([owner], "B");
        await assertLink(editor, owner, false);
        editor.updateLayer("B", { defaultVisible: true }); await assertLink(editor, owner, true);
        editor.assignObjectsToLayer([owner], null); editor.updateLayer("A", { defaultVisible: false }); editor.updateLayer("B", { defaultVisible: false });
        await assertLink(editor, owner, true);
      }

      editor.setObjectLink(owner, { type: "url", url: "https://example.test/reference" });
      const external = hotspot(await editor.getScene(), owner);
      assert.deepEqual(external.action, { type: "URI", uri: "https://example.test/reference" }, "source owners also compile ordinary URL links");
      editor.undo(); await assertLink(editor, owner, true);
      console.log(`${kind}, ${layered ? "layered" : "unlayered"}: compiled hotspot, picking, destinations, preview/cache, visibility and reassignment passed.`);
    } finally { editor.dispose(); }
  }
} finally { hooks.deregister(); }
