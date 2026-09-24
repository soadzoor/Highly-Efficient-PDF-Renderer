import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  // Dense short hatching plus long double walls running from the near to the
  // far side of a tilted view. Coarse overview levels merge each wall pair into
  // one line that spans the page, so a far tile must not draw it where the
  // near side magnifies its error.
  const hatchCount = 160_000, wallPairs = 40, count = hatchCount + wallPairs * 2;
  const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .06, pageCount: 1,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, pageRects: Float32Array.of(0, 0, 1000, 1000),
    drawRuns: [{ kind: "stroke", first: 0, count }] };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(count * 4);
  const line = (index, x0, y0, x1, y1) => {
    scene.endpoints.set([x0, y0, x1, y1], index * 4);
    scene.primitiveMeta.set([x1, y1, 0, 5], index * 4);
    scene.primitiveBounds.set([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], index * 4);
    scene.styles.set([.06, 0, 0, 0], index * 4);
  };
  for (let index = 0; index < hatchCount; index++) {
    const x = index % 400 * 2.5, y = Math.floor(index / 400) * 2.5;
    line(index, x, y, x + (index % 10 === 0 ? 2 : .2), y);
  }
  for (let pair = 0; pair < wallPairs; pair++) {
    const x = 12.5 + pair * 25;
    line(hatchCount + pair * 2, x, 0, x, 1000);
    line(hatchCount + pair * 2 + 1, x + 3, 0, x + 3, 1000);
  }
  const runtime = new VectorStrokeLodRuntime(scene);
  assert(runtime.levels.some(level => level.overview), "the fixture builds overview levels");

  const viewport = { width: 1600, height: 900 };
  const camera = new THREE.PerspectiveCamera(45, viewport.width / viewport.height, 1, 1e6);
  const dataToLocal = new THREE.Matrix4().makeTranslation(-500, -500, 0);
  const localToClip = new THREE.Matrix4();
  const fitDistance = 500 / Math.tan(THREE.MathUtils.degToRad(22.5));
  // The runtime receives the host's center-plane scale, as the Three object does.
  const centerUnitsPerPixel = distance => 2 * distance * Math.tan(THREE.MathUtils.degToRad(22.5)) / viewport.height;
  const view = (polarDegrees, distance, target = new THREE.Vector3()) => {
    const polar = THREE.MathUtils.degToRad(polarDegrees);
    camera.position.set(0, -Math.sin(polar), Math.cos(polar)).multiplyScalar(distance).add(target);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.near = distance * .01; camera.far = distance * 20; camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    localToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(dataToLocal);
    runtime.setLocalToClipTransform(localToClip.elements, centerUnitsPerPixel(distance));
    runtime.update({ cameraCenterX: 500 + target.x, cameraCenterY: 500 + target.y, zoom: 1 / centerUnitsPerPixel(distance) },
      viewport, scene.bounds);
    return runtime.getRenderedSegmentCount();
  };

  // Largest pixel magnification over a drawing-plane rectangle inside the
  // frustum (with the runtime's 16 px margin), or 0 when none of it is visible.
  const magnification = (minX, minY, maxX, maxY) => {
    const m = runtime.localToClip, halfWidth = viewport.width / 2, halfHeight = viewport.height / 2;
    let polygon = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    for (const [axis, half] of [[0, halfWidth], [1, halfHeight]]) for (const sign of [1, -1]) {
      const widen = 1 + 16 / half;
      const a = m[3] * widen + sign * m[axis], b = m[7] * widen + sign * m[4 + axis], c = m[15] * widen + sign * m[12 + axis];
      const clipped = [];
      polygon.forEach(([x, y], index) => {
        const [px, py] = polygon[(index + polygon.length - 1) % polygon.length];
        const previous = a * px + b * py + c, current = a * x + b * y + c;
        if ((current >= 0) !== (previous >= 0)) {
          const t = previous / (previous - current);
          clipped.push([px + (x - px) * t, py + (y - py) * t]);
        }
        if (current >= 0) clipped.push([x, y]);
      });
      polygon = clipped;
      if (polygon.length === 0) return 0;
    }
    let largest = 0;
    for (const [x, y] of polygon) {
      const w = m[3] * x + m[7] * y + m[15], cx = m[0] * x + m[4] * y + m[12], cy = m[1] * x + m[5] * y + m[13];
      const j = [(m[0] * w - cx * m[3]) * halfWidth, (m[4] * w - cx * m[7]) * halfWidth,
        (m[1] * w - cy * m[3]) * halfHeight, (m[5] * w - cy * m[7]) * halfHeight].map(value => value / (w * w));
      const sum = j.reduce((total, value) => total + value * value, 0), det = j[0] * j[3] - j[1] * j[2];
      largest = Math.max(largest, Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2));
    }
    return largest;
  };
  const drawn = () => runtime.levels.flatMap((level, index) =>
    Array.from(level.visibleSegmentIds.subarray(0, level.visibleSegmentCount), id => ({ level, index, id })));
  const screenErrors = () => drawn().filter(({ level }) => level.tolerance > 0).map(({ level, id }) =>
    level.tolerance * magnification(level.segmentMinX[id], level.segmentMinY[id], level.segmentMaxX[id], level.segmentMaxY[id]));

  const planar = view(0, fitDistance);
  assert(planar > 0 && planar <= 82_500, `front-facing overview follows the soft budget: ${planar}`);
  const slight = view(1e-4, fitDistance);
  assert(Math.abs(slight - planar) <= planar * .1, `a barely tilted view matches the planar selection: ${planar} vs ${slight}`);

  for (const [polar, distance] of [[45, fitDistance], [70, fitDistance], [60, fitDistance / 3], [75, fitDistance / 6]]) {
    const rendered = view(polar, distance);
    const label = `tilt ${polar}° at ${Math.round(fitDistance / distance)}x`;
    assert(rendered > 0 && rendered <= 82_500, `${label}: tilted views follow the soft budget, not exact geometry: ${rendered}`);
    const stats = runtime.getStats();
    assert(stats.activeLevels.some(level => level.index > 0), `${label}: tilted views use LOD levels`);
    assert(stats.visibleTileCount <= runtime.tileGrid.columns * runtime.tileGrid.rows);
    // Every drawn primitive intersects the frustum, and every approximation
    // stays within the overview error limit wherever it is visible.
    for (const { level, id } of drawn()) {
      assert(magnification(level.segmentMinX[id], level.segmentMinY[id], level.segmentMaxX[id], level.segmentMaxY[id]) > 0,
        `${label}: primitives outside the view frustum are culled`);
    }
    const worst = Math.max(0, ...screenErrors());
    assert(worst <= 5 + 1e-6, `${label}: no LOD primitive exceeds 5 px of screen error, including long merged lines: ${worst}`);
    // The camera looks toward +y: content before the target is nearer and
    // keeps finer geometry than content beyond it.
    const near = [], far = [];
    for (const { level, id } of drawn()) {
      (level.segmentMaxY[id] < 500 ? near : level.segmentMinY[id] > 500 ? far : []).push(level.tolerance);
    }
    if (near.length && far.length) {
      const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
      assert(mean(near) < mean(far), `${label}: nearer tiles select finer levels (${mean(near)} vs ${mean(far)})`);
    }
    console.log(`${label}: ${count} → ${rendered} strokes, ${stats.visibleTileCount} visible tiles, worst LOD error ${worst.toFixed(2)} px`);
  }

  // A close tilted view shows a trapezoid of the page: tiles outside the
  // frustum drop out even though the host's plane bounds cover the whole page.
  view(45, fitDistance / 4);
  const partialTiles = runtime.getStats().visibleTileCount;
  assert(partialTiles < runtime.tileGrid.columns * runtime.tileGrid.rows * .5, `frustum culling drops hidden tiles: ${partialTiles}`);

  // Magnification beyond the overview limit restores exact geometry near the
  // camera even while the far side remains simplified.
  view(70, 40, new THREE.Vector3(0, -300, 0));
  const closeup = drawn();
  const closest = closeup.filter(({ level, id }) =>
    0.5 * magnification(level.segmentMinX[id], level.segmentMinY[id], level.segmentMaxX[id], level.segmentMaxY[id]) > 5);
  assert(closest.length > 0 && closest.every(({ index }) => index === 0), "near primitives past the overview limit stay exact");

  runtime.setForceExact(true);
  view(60, fitDistance / 3);
  assert(runtime.getStats().activeLevels.every(level => level.index === 0), "force-exact keeps primitive identity in tilted views");
  runtime.setForceExact(false);
  const invalid = [...localToClip.elements]; invalid[0] = NaN;
  runtime.setLocalToClipTransform(invalid, 1);
  assert(runtime.update({ cameraCenterX: 500, cameraCenterY: 500, zoom: 1 }, viewport, scene.bounds),
    "a nonfinite projection falls back to the scalar pixel scale");
  console.log("Perspective LOD: per-tile error limits, frustum culling, screen-area budget and long-line reach passed");
} finally { hooks.deregister(); }
