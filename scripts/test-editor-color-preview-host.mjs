import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorColorPreviewHost, groupEditorColorPreviewUpdates } = await import("../src/editorColorPreviewHost.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { composeVectorScenesInColumn } = await import("../src/pdfVectorExtractor.ts");
  const fixture = () => buildStrokeScene([
    { points: [[10, 10], [30, 10]], width: 1, color: "black" },
    { points: [[110, 10], [130, 10]], width: 1, color: "red" },
    { points: [[10, 30], [30, 30]], width: 1, color: "blue" }
  ]);
  const update = (index, color = [0, 1, 0], kind = "stroke") => ({ ref: { kind, index }, color });
  const calls = [], target = { name: "WebGL" }; let current = target, scene = fixture(), supported = true;
  const host = createEditorColorPreviewHost({ getTarget: () => current, getScene: () => scene,
    canApply: () => supported, apply: (owner, updates) => calls.push({ owner, updates: structuredClone(updates) }) });
  assert.equal(host.previewColors([update(0)]), false, "no preview enters an unacknowledged scene");
  host.bind(scene, scene); assert.equal(host.previewColors([update(0), update(2)]), true);
  assert.equal(host.hasPreview(), true); assert.equal(calls.length, 1);
  host.previewColors([update(0), update(2)]); assert.equal(calls.length, 1, "unchanged samples do not reupload texels");
  host.previewColors([update(2, [1, 1, 0])]);
  assert.deepEqual(calls.at(-1).updates, [update(0, null), update(2, [1, 1, 0])], "removed preview members restore their own original colors");
  const count = calls.length;
  assert.equal(host.previewColors([update(0), update(99)]), false); assert.equal(calls.length, count, "invalid batches never partially update the renderer");
  supported = false; assert.equal(host.previewColors([update(0)]), false); supported = true;
  assert.equal(host.previewColors(null), true); assert.deepEqual(calls.at(-1).updates, [update(2, null)]);
  assert.equal(host.hasPreview(), false);

  // Backend replacement owns fresh GPU resources, even for the same scene.
  host.previewColors([update(1)]); const old = current; current = { name: "WebGPU" };
  const replaced = calls.length; host.previewColors(null);
  assert.equal(calls.length, replaced, "stale clears cannot alter the replacement backend or touch a disposed one");
  host.previewColors([update(1)]); assert.equal(calls.at(-1).owner, current); assert.notEqual(current, old);
  assert.deepEqual(calls.at(-1).updates, [update(1)], "the complete next sample replays on new GPU resources");

  // Keep the preview visible while a replacement is being prepared, then
  // clear and install synchronously so the original color cannot flash.
  const before = calls.length, next = fixture();
  assert(host.hasPreview()); assert.equal(calls.length, before);
  host.beforeSceneChange(); assert.deepEqual(calls.at(-1).updates, [update(1, null)]);
  scene = next; assert.equal(host.previewColors([update(0)]), false);
  host.bind(next, next); host.previewColors([update(0)]);
  const beforeSourceSwitch = calls.length; scene = fixture(); host.previewColors(null);
  assert.equal(calls.length, beforeSourceSwitch, "an old source's clear cannot restore its indices into a new document");
  assert.equal(host.previewColors([update(0)]), false);

  // Recomposition can change primitive indices: page 0 contains canonical
  // strokes 0,2; page 1 contains canonical stroke 1.
  const canonical = fixture(); canonical.pageCount = 2;
  canonical.pageRects = Float32Array.of(0, 0, 100, 100, 100, 0, 200, 100);
  canonical.pageBounds = canonical.bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
  const partition = new ScenePageViews(canonical), views = [partition.extract(0), partition.extract(1)];
  assert.deepEqual([...views[0].primitives.stroke], [0, 2]); assert.deepEqual([...views[1].primitives.stroke], [1]);
  scene = composeVectorScenesInColumn(views.map(view => view.scene));
  host.bind(canonical, scene, views); host.previewColors([update(1, [0, .5, 1]), update(2, [1, .5, 0])]);
  assert.deepEqual(calls.at(-1).updates, [update(2, [0, .5, 1]), update(1, [1, .5, 0])], "Reader/Grid remaps only the selected canonical paint");
  host.previewColors(null); assert.deepEqual(calls.at(-1).updates, [update(2, null), update(1, null)]);
  host.bind(canonical, scene); assert.equal(host.previewColors([update(1)]), false, "unproved scene remapping uses the normal fallback");

  // Three receives color groups, retaining independent restoration and all
  // supported vector kinds, including intrinsically painted gradients.
  assert.deepEqual(groupEditorColorPreviewUpdates([
    update(0), update(1), update(0, [1, 0, 0], "gradient-fill"), update(2, null), update(3, null)
  ]), [
    { refs: [{ kind: "stroke", index: 0 }, { kind: "stroke", index: 1 }], color: [0, 1, 0] },
    { refs: [{ kind: "gradient-fill", index: 0 }], color: [1, 0, 0] },
    { refs: [{ kind: "stroke", index: 2 }, { kind: "stroke", index: 3 }], color: null }
  ]);
  const input = [update(0)]; scene = fixture(); host.bind(scene, scene); host.previewColors(input); input[0].color[1] = 0;
  host.previewColors([update(0)]); assert.equal(calls.at(-1).updates[0].color[1], 1, "host snapshots do not retain mutable caller RGB arrays");

  const [nativeSource, threeSource] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"), readFile(new URL("../src/three-example.ts", import.meta.url), "utf8")
  ]);
  for (const source of [nativeSource, threeSource]) {
    assert(source.includes('await import("./editorColorPreviewHost")'), "preview bridge loads with Edit, not the View startup path");
    assert(source.includes("previewColors: updates => colorPreview.previewColors(updates)"));
    assert(source.includes("onPresented: () => { colorPreview.bind("), "binding waits for the acknowledged publication");
  }
  assert(nativeSource.indexOf("colorPreview.beforeSceneChange();") < nativeSource.indexOf("renderer.setScene(displayedScene"));
  assert(threeSource.indexOf("colorPreview.beforeSceneChange();", threeSource.indexOf("const layout = await preparePageLayoutReplacement(next")) < threeSource.indexOf("replacePdfObject(next, { fitCamera: false"));
  console.log("Editor color preview hosts: stable GPU overrides, batching, backend/source replacement, owned restoration and Reader/Grid mapping passed.");
} finally { hooks.deregister(); }
