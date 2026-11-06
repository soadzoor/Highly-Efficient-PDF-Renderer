import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { resolveEditorPasteTarget } = await import("../src/editorPastePlacement.ts");
  const rects = Float32Array.of(0, 0, 100, 200, 0, 220, 100, 420);
  const viewport = { left: 10, top: 20, width: 200, height: 200 };
  let zoom = 1, panY = 0;
  const project = (x, y) => ({ x: 10 + x * zoom, y: 20 + y * zoom + panY });
  const unproject = (x, y) => ({ x: (x - 10) / zoom, y: (y - 20 - panY) / zoom });
  const resolve = client => resolveEditorPasteTarget(rects, viewport, project, unproject, client);
  assert.deepEqual(resolve({ x: 40, y: 80 }), { pageIndex: 0, center: [30, 60] });
  zoom = 2; panY = -440;
  assert.deepEqual(resolve({ x: 70, y: 100 }), { pageIndex: 1, center: [30, 260] }, "cursor coordinates use the current camera and page");
  assert.deepEqual(resolve(null), { pageIndex: 1, center: [50, 320] }, "toolbar paste uses the most visible page's center");
  assert.deepEqual(resolve({ x: 0, y: 0 }), resolve(null), "cursor outside the canvas does not reuse a former page hit");
  zoom = 1; panY = -110;
  const tieRects = Float32Array.of(0, 0, 100, 300, 0, 320, 100, 420);
  panY = -210;
  assert.deepEqual(resolveEditorPasteTarget(tieRects, viewport, project, unproject, null), { pageIndex: 1, center: [50, 370] }, "equal visible areas choose the closer page center");
  panY = -110;
  assert.deepEqual(resolve({ x: 60, y: 120 }), resolve(null), "a cursor in a page gap uses the visible-page fallback");
  assert.equal(resolveEditorPasteTarget(new Float32Array(), viewport, project, unproject, null), undefined);
  assert.deepEqual(resolveEditorPasteTarget(rects, viewport, () => null, () => null, null), { pageIndex: 0, center: [50, 100] });
  console.log("Editor paste placement: camera-aware cursor, cross-page target, gap/outside fallback and visibility tie-break passed.");
} finally { hooks.deregister(); }
