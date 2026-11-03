import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { bakeEditorSourceScene, transformWholeEditorScene } = await import("../src/editorScene.ts");
  const { getPrimitiveClipChain } = await import("../src/scenePrimitives.ts");
  const scene = buildStrokeScene([{ points: [[5, 5], [30, 30]], width: 1 }, { points: [[15, 15], [20, 20]], width: 1 }]);
  scene.pageRects = Float32Array.of(0, 0, 100, 100);
  scene.clipPaths = [{ parent: -1, fillRule: 0, edges: Float32Array.of(0, 0, 100, 0, 100, 0, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0) }];
  scene.drawRuns = [{ kind: "stroke", first: 0, count: 1, clipIndex: 0 }, { kind: "stroke", first: 1, count: 1, clipIndex: 0 }];
  const group = (bounds, children) => ({ kind: "group", bounds, children, alpha: 1, isolated: true, knockout: false, blendMode: "Normal" });
  scene.paintGraph = { roots: [{ ...group({ minX: 0, minY: 0, maxX: 40, maxY: 40 }, [{ kind: "draw", runIndex: 0 }]),
    softMask: { subtype: "Alpha", children: [group({ minX: 10, minY: 10, maxX: 25, maxY: 25 }, [{ kind: "draw", runIndex: 1 }])] } }] };
  const matrix = [1, 0, 0, 1, 200, 50], original = structuredClone(scene.paintGraph);
  const partial = bakeEditorSourceScene(scene, [0, 1].map(index => ({ ref: { kind: "stroke", index }, transform: matrix, deleted: false })));
  assert.deepEqual([...partial.clipPaths[getPrimitiveClipChain(partial, { kind: "stroke", index: 0 }).clipIndex].edges], [...scene.clipPaths[0].edges], "object edits keep the page viewport fixed");
  const moved = transformWholeEditorScene(scene, matrix), clip = moved.clipPaths[getPrimitiveClipChain(moved, { kind: "stroke", index: 0 }).clipIndex];
  assert.deepEqual([...clip.edges.slice(0, 4)], [200, 50, 300, 50], "whole-scene placement moves its viewport with the page");
  assert.deepEqual(moved.paintGraph.roots[0].bounds, { minX: 200, minY: 50, maxX: 240, maxY: 90 });
  assert.deepEqual(moved.paintGraph.roots[0].softMask.children[0].bounds, { minX: 210, minY: 60, maxX: 225, maxY: 75 }, "nested mask surfaces share the transformed pose");
  assert.deepEqual(scene.paintGraph, original, "whole-scene placement does not mutate original compositing bounds");
  console.log("Whole-scene transforms move page clips, transparency bounds and mask bounds while object edits keep the viewport fixed.");
} finally { hooks.deregister(); }
