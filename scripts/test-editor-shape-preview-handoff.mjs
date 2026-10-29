import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorDrawingPreviewHarness: harness } = await import("./lib/editorDrawingPreviewHarness.mjs");
  const { editorShapePreviewGeometry } = await import("../src/editorShapePreview.ts");
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const plain = value => JSON.parse(JSON.stringify(value));
  const click = async (h, id, x, y) => { await h.context.pointerDown(h.event(id, x, y)); h.context.pointerUp(h.event(id, x, y)); };
  const key = (h, value) => h.context.keydown({ ...h.event(0, 0, 0), key: value });
  const release = async h => { await tick(); h.resolve(h.preparations.length - 1); await tick(); const index = h.applications.length - 1; h.acknowledge(index); h.finish(index); await tick(); };

  // A drag previews the actual shape (including its directed arrowhead) and
  // captured pen style, never a generic selection marquee. All four quadrants
  // retain the same page-local model on release and during delayed publication.
  for (const shape of ["rectangle", "ellipse", "line", "arrow"]) {
    for (const [endX, endY] of [[90, 120], [10, 120], [10, 20], [90, 20]]) {
      const h = harness(shape), c = h.context;
      await c.pointerDown(h.event(1, 50, 70)); c.pointerMove(h.event(1, endX, endY));
      const draft = plain(c.pointer.shape), live = plain(h.draw());
      assert.equal(h.preparations.length, 0, `${shape}: pointer movement never compiles the document`);
      assert.equal(h.applications.length, 0);
      assert.deepEqual([draft.x, draft.y, draft.width, draft.height], [Math.min(50, endX), Math.min(70, endY), Math.abs(endX - 50), Math.abs(endY - 70)]);
      if (shape === "line" || shape === "arrow") assert.deepEqual(draft.points, [[50, 70], [endX, endY]]);
      const expected = editorShapePreviewGeometry(draft, .5).paths;
      assert.equal(live.length, expected.length);
      live.forEach((path, index) => {
        for (const [name, value] of Object.entries(expected[index])) assert.equal(path[name], value);
        assert.equal(path.class, "hepr-editor-shape-preview"); assert.equal(path["pointer-events"], "none");
        assert.equal(path.transform, "matrix(2,0,0,-2,20,820)");
      });
      assert.equal(live.at(-1)["stroke-width"], 7); assert.equal(live.at(-1)["stroke-opacity"], .6);
      h.properties.stroke.value = "15"; h.properties.color.value = "red"; c.objectOpacity = .1;
      c.pointerUp(h.event(1, endX, endY)); await tick();
      const stored = [...h.objects.values()][0];
      assert.equal(stored.strokeWidth, 7); assert.equal(stored.color, "#369"); assert.equal(stored.opacity, .6);
      assert.deepEqual(plain(h.draw()), live, "releasing retains exactly the live appearance until drawing");
      h.resolve(0); await tick(); assert.deepEqual(plain(h.draw()), live, "installation is not a drawn frame");
      h.acknowledge(0); assert.equal(h.paths.length, 0); h.finish(0); await tick(); assert.deepEqual(h.errors, []);
    }
  }

  // The release event may have a newer position than the last move, or no
  // move may have been dispatched at all. Keep the gesture's original page.
  for (const shape of ["rectangle", "ellipse", "line", "arrow"]) {
    const h = harness(shape), c = h.context, planes = [];
    const unproject = c.host.clientToScenePoint;
    c.host.clientToScenePoint = (x, y, page) => { planes.push(page); return unproject(x, y); };
    await c.pointerDown(h.event(1, 60, 100)); c.pointerUp(h.event(1, 20, 30));
    const stored = [...h.objects.values()][0];
    assert.deepEqual([stored.x, stored.y, stored.width, stored.height], [20, 30, 40, 70]);
    assert.equal(planes.at(-1), 0, "release stays pinned to the starting page");
    await release(h);
    await c.pointerDown(h.event(2, 30, 40)); c.pointerMove(h.event(2, 50, 70)); c.pointerUp(h.event(2, 80, 90));
    const latest = [...h.objects.values()].at(-1);
    assert.deepEqual([latest.x, latest.y, latest.width, latest.height], [30, 40, 50, 50]);
    assert.equal(planes.at(-2), 0, "move stays pinned to the starting page"); await release(h);
  }

  for (const shape of ["polygon", "polyline"]) {
    const h = harness(shape), c = h.context;
    await click(h, 1, 20, 30); c.pointerMove(h.event(0, 70, 50));
    assert.deepEqual(plain(c.polygon.points), [[20, 30]]);
    assert.deepEqual(plain(c.polygon.preview.points), [[20, 30], [70, 50]], "hover offers a next segment without committing it");
    await click(h, 2, 70, 50); await click(h, 3, 110, 100);
    c.pointerMove(h.event(0, 150, 80));
    assert.equal(h.draw().at(-1)["stroke-width"], 7); assert.equal(h.preparations.length, 0);
    assert(h.paths[0].d.endsWith(" Z"), "optional fill previews the area below the cursor endpoint");
    if (shape === "polyline") assert(!h.paths.at(-1).d.endsWith(" Z"), "polyline stroke stays open");
    else assert(h.paths.at(-1).d.endsWith(" Z"));
    h.properties.stroke.value = "20"; h.properties.color.value = "red";
    key(h, "Enter"); assert.equal(c.polygon, null);
    const stored = [...h.objects.values()][0];
    assert.deepEqual(plain(stored.points), [[20, 30], [70, 50], [110, 100]], "Enter excludes the unclicked hover endpoint");
    assert.equal(stored.strokeWidth, 7); assert.equal(stored.color, "#369");
    await release(h); assert.equal(h.paths.length, 0);
  }

  // Real double-clicks emit two pointer-down/up pairs, whose detail may be zero.
  // The second click finishes the first endpoint; its slight drift is not ink.
  for (const drift of [0, .4]) {
    const h = harness("polygon"), c = h.context;
    await click(h, 1, 20, 30); await click(h, 2, 70, 50);
    await click(h, 3, 110, 100); await click(h, 4, 110 + drift, 100 + drift);
    await c.doubleClick(h.event(4, 110 + drift, 100 + drift));
    assert.deepEqual(plain([...h.objects.values()][0].points), [[20, 30], [70, 50], [110, 100]]);
    await release(h);
  }
  {
    const h = harness("polygon"), c = h.context;
    await click(h, 1, 20, 30); await click(h, 2, 70, 50); await click(h, 3, 299.8, 100);
    await click(h, 4, 300.2, 100); await c.doubleClick(h.event(4, 300.2, 100));
    const points = plain([...h.objects.values()][0].points);
    assert.equal(points.length, 3, "a rejected second press beyond the page cannot remove the accepted endpoint");
    assert.deepEqual(points.slice(0, 2), [[20, 30], [70, 50]]); assert(Math.abs(points[2][0] - 299.8) < 1e-6); assert.equal(points[2][1], 100);
    await release(h);
  }
  {
    const h = harness("polygon"), c = h.context;
    await click(h, 1, 20, 30); await click(h, 2, 70, 50);
    c.pointerMove(h.event(0, 350, 80));
    assert.equal(c.polygon.preview.points.length, 2, "hover in a Reader gap does not offer an unclickable vertex");
    await click(h, 3, 350, 80); assert.equal(c.polygon.points.length, 2);
    await click(h, 4, 20, 30); key(h, "Enter");
    assert.equal(h.objects.size, 0, "two distinct polygon vertices cannot create a fill");
    await click(h, 5, 20, 30); c.pointerMove(h.event(0, 70, 50)); key(h, "Escape");
    assert.equal(c.polygon, null); assert.equal(h.draw().length, 0); assert.equal(h.preparations.length, 0);
    await click(h, 6, 20, 30); c.setTool("ellipse"); assert.equal(c.polygon, null);
  }

  // Pending drawings survive drawing another object, changing tools, and slow
  // host installation. A stale frame can clear only the shapes it contains.
  {
    const h = harness("rectangle"), c = h.context;
    await c.pointerDown(h.event(1, 20, 30)); c.pointerUp(h.event(1, 70, 80)); await tick();
    h.resolve(0); await tick();
    c.setTool("arrow"); await c.pointerDown(h.event(2, 100, 120)); assert(c.pointer?.shape, "another shape starts while the preceding frame settles");
    c.pointerUp(h.event(2, 130, 160)); await tick(); h.resolve(1); await tick();
    const all = plain(h.draw()); assert.equal(all.length, 4);
    c.setTool("pan"); assert.deepEqual(plain(h.draw()), all);
    c.setTool("form"); assert.deepEqual(plain(h.draw()), all);
    h.acknowledge(0); assert.equal(h.paths.length, 2, "only the first shape's preview is acknowledged");
    assert(h.paths[0].d.startsWith("M130 160 "), "new arrowhead stays visible");
    h.finish(0); await tick(); h.acknowledge(1); assert.equal(h.paths.length, 0); h.finish(1); await tick();
    c.session.sourceScene = { pageRects: h.sourceScene.pageRects }; c.pendingDrawings.reconcile();
    c.setTool("rectangle"); await c.pointerDown(h.event(3, 20, 30)); assert.equal(c.pointer, null, "old-source screen coordinates cannot start another drawing");
  }

  // Pending signatures also use the selected opacity until their actual frame;
  // their independent placement ghost remains translucent and repeatable.
  {
    const h = harness("signature"), c = h.context;
    c.signature = { id: "sample", name: "Sample", width: 100, height: 25, paths: [[0, 0, 50, 25, 100, 10]] };
    await c.pointerDown(h.event(1, 100, 100)); await tick();
    assert.equal(h.objects.size, 1);
    const paths = h.draw(), pending = paths.filter(path => path.class === "hepr-editor-ink-preview"), ghost = paths.filter(path => path.class === "hepr-editor-signature-ghost");
    assert.equal(pending.length, 1); assert.equal(pending[0]["stroke-opacity"], .6); assert.equal(ghost.length, 1); assert.equal(ghost[0].opacity, .6 * .45);
    c.signatureHover = null; await release(h); assert.equal(h.paths.length, 0);
  }

  for (const shape of ["rectangle", "polygon"]) {
    const h = harness(shape), c = h.context;
    for (const invalid of ["-1", "NaN", "Infinity", "1e40", "1e-100"]) {
      h.properties.stroke.value = invalid; await assert.rejects(c.pointerDown(h.event(1, 20, 30)), /Stroke width/);
      assert.equal(c.pointer, null); assert.equal(c.polygon, null); assert.equal(h.draw().length, 0);
    }
  }
  const css = await readFile(new URL("../src/editorUi.css", import.meta.url), "utf8");
  assert(!/\[data-tool=(?:pan|form)\][^{]*\.hepr-editor-graphic\s*\{display:none/.test(css), "pending previews remain visible through pass-through tools");
  console.log("Shape preview UI: all drag quadrants/styles, final release, polygon hover/click/Enter/double-click, page pinning, delayed frame ownership, tool changes, signatures and validation passed.");
} finally { hooks.deregister(); }
