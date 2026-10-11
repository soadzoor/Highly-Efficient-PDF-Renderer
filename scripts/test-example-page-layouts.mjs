import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const {
  applyExamplePageLayout,
  computeExamplePageLayout,
  easeOutExpo,
  ExamplePageLayoutAnimator,
  interpolateExamplePageLayout,
  READER_PAGE_GAP
} = await import("../src/examplePageLayouts.ts");

const A4 = { width: 595, height: 842 };
const front = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(0, 1, 0);

function gridPages(count, perRow, size = () => A4) {
  return Array.from({ length: count }, (_, index) => ({
    gridPosition: new THREE.Vector3((index % perRow) * 620, -Math.floor(index / perRow) * 870, 0),
    ...size(index)
  }));
}

function normal(target) {
  return front.clone().applyQuaternion(target.quaternion);
}

function assertFinite(targets) {
  for (const { position, quaternion } of targets) {
    assert.ok([...position.toArray(), ...quaternion.toArray()].every(Number.isFinite));
    assert.ok(Math.abs(quaternion.length() - 1) < 1e-9);
  }
}

function minCenterDistance(targets) {
  let min = Infinity;
  for (let a = 0; a < targets.length; a++) {
    for (let b = a + 1; b < targets.length; b++) min = Math.min(min, targets[a].position.distanceTo(targets[b].position));
  }
  return min;
}

// Reader pages form one centered, front-facing column with exact gaps.
{
  const pages = gridPages(4, 2, index => index === 1 ? { width: 1200, height: 400 } : A4);
  const targets = computeExamplePageLayout("reader", pages);
  assertFinite(targets);
  assert.equal(targets[0].position.y + pages[0].height / 2, 0, "the first page begins at the reader's top");
  targets.forEach((target, index) => {
    assert.equal(target.position.x, 0);
    assert.equal(target.position.z, 0);
    assert.ok(target.quaternion.equals(new THREE.Quaternion()));
    if (index > 0) {
      const previousBottom = targets[index - 1].position.y - pages[index - 1].height / 2;
      const currentTop = target.position.y + pages[index].height / 2;
      assert.equal(previousBottom - currentTop, READER_PAGE_GAP);
    }
  });
  assert.deepEqual(computeExamplePageLayout("reader", []), []);
  assert.equal(computeExamplePageLayout("reader", gridPages(1, 1))[0].position.y, -A4.height / 2);
}

// Grid is the loaded layout, unrotated.
{
  const pages = gridPages(7, 3);
  const targets = computeExamplePageLayout("grid", pages);
  targets.forEach((target, index) => {
    assert.ok(target.position.equals(pages[index].gridPosition));
    assert.notEqual(target.position, pages[index].gridPosition, "targets never alias the recorded layout");
    assert.ok(target.quaternion.equals(new THREE.Quaternion()));
  });
}

// Sphere: every page sits on one radius, faces outward and stays upright;
// the first page is at the top.
for (const count of [2, 3, 12, 118, 400]) {
  const targets = computeExamplePageLayout("sphere", gridPages(count, Math.ceil(Math.sqrt(count))));
  assertFinite(targets);
  const radius = targets[0].position.length();
  for (const target of targets) {
    assert.ok(Math.abs(target.position.length() - radius) < 1e-6 * radius);
    assert.ok(normal(target).dot(target.position.clone().normalize()) > 1 - 1e-9, "pages face outward");
    assert.ok(up.clone().applyQuaternion(target.quaternion).y > 0, "pages stay upright");
  }
  assert.equal(Math.max(...targets.map(target => target.position.y)), targets[0].position.y);
  assert.ok(radius >= Math.hypot(A4.width, A4.height) / 2);
  if (count >= 12) assert.ok(minCenterDistance(targets) > A4.width, `${count} sphere pages keep their spacing`);
}

// Sphere keeps the demo's coverage: 118 A4 pages span about the same area as
// the demo's 118 cards scaled to A4.
{
  const radius = computeExamplePageLayout("sphere", gridPages(118, 11))[0].position.length();
  const demoScale = Math.sqrt((A4.width * A4.height) / (120 * 160));
  assert.ok(Math.abs(radius - 800 * demoScale) < 1e-6 * radius);
}

// Helix: the first page is at the front facing +Z, pages wind to the right and
// down, face outward horizontally and the helix is vertically centered.
for (const count of [2, 5, 118, 400]) {
  const targets = computeExamplePageLayout("helix", gridPages(count, 10));
  assertFinite(targets);
  const first = targets[0].position;
  const radius = Math.hypot(first.x, first.z);
  assert.ok(Math.abs(first.x) < 1e-9 && first.z > 0);
  assert.ok(normal(targets[0]).distanceTo(front) < 1e-9);
  assert.ok(targets[1].position.x > 0, "the second page is to the right of the first");
  assert.ok(Math.abs(first.y + targets[count - 1].position.y) < 1e-6 * radius);
  for (let index = 0; index < count; index++) {
    const { position } = targets[index];
    assert.ok(Math.abs(Math.hypot(position.x, position.z) - radius) < 1e-6 * radius);
    assert.ok(normal(targets[index]).distanceTo(new THREE.Vector3(position.x, 0, position.z).normalize()) < 1e-9);
    if (index > 0) {
      assert.ok(position.y < targets[index - 1].position.y);
      assert.ok(position.distanceTo(targets[index - 1].position) > A4.width, "neighbours do not overlap");
    }
  }
  if (count >= 118) {
    // The demo's density: about 36 cards per turn for 118 cards.
    const perTurn = targets.findIndex((target, index) => index > 0 && target.position.x >= 0 && targets[index - 1].position.x < 0);
    assert.ok(perTurn >= 0.9 * 3.3 * Math.sqrt(count) && perTurn <= 1.1 * 3.3 * Math.sqrt(count) + 1, `${perTurn} pages per turn`);
    // A page directly below its predecessor one turn earlier clears its height.
    const drop = targets[0].position.y - targets[perTurn].position.y;
    assert.ok(drop > A4.height);
  }
}

// Mixed sizes (a fold-out drawing among portrait pages) stay finite and spaced.
{
  const pages = gridPages(9, 3, index => index === 4 ? { width: 2384, height: 1684 } : A4);
  for (const layout of ["sphere", "helix"]) {
    const targets = computeExamplePageLayout(layout, pages);
    assertFinite(targets);
    assert.ok(minCenterDistance(targets) > A4.width, layout);
  }
}

// Exponential ease-out: exact ends, monotonic and front-loaded.
{
  assert.equal(easeOutExpo(0), 0);
  assert.equal(easeOutExpo(1), 1);
  assert.equal(easeOutExpo(2), 1);
  let previous = 0;
  for (let step = 1; step <= 100; step++) {
    const value = easeOutExpo(step / 100);
    assert.ok(value > previous);
    previous = value;
  }
  assert.ok(easeOutExpo(0.25) > 0.8);
}

// Animator: per-page random durations, ease-out and exact final transforms.
{
  const pages = gridPages(4, 2);
  const objects = pages.map(page => {
    const object = new THREE.Object3D();
    object.position.copy(page.gridPosition);
    return object;
  });
  const sphere = computeExamplePageLayout("sphere", pages);
  const animator = new ExamplePageLayoutAnimator();
  assert.equal(animator.update(0), false, "idle animators request no frames");

  const random = [0, 1, 0.5, 0.5, 0, 0, 1, 1];
  animator.animate(objects, sphere, 2000, () => random.shift());
  assert.equal(animator.update(1000), true, "the first update starts the clock");
  assert.ok(objects[0].position.equals(pages[0].gridPosition));
  assert.equal(animator.update(990), true, "a frame stamped before the start stays at the start");
  assert.ok(objects[0].position.equals(pages[0].gridPosition));

  assert.equal(animator.update(2000), true);
  const expected = pages[0].gridPosition.clone().lerp(sphere[0].position, easeOutExpo(0.5));
  assert.ok(objects[0].position.distanceTo(expected) < 1e-9, "position eases out over its own duration");
  const rotation = new THREE.Quaternion().slerp(sphere[0].quaternion, easeOutExpo(1000 / 4000));
  assert.ok(objects[0].quaternion.angleTo(rotation) < 1e-6, "rotation has an independent duration");

  assert.equal(animator.update(4999), true, "the slowest page is still settling");
  assert.equal(animator.update(5000), false);
  objects.forEach((object, index) => {
    assert.ok(object.position.equals(sphere[index].position));
    assert.ok(object.quaternion.equals(sphere[index].quaternion));
  });
  assert.equal(animator.update(6000), false);

  // A new layout interrupts from the current in-between transforms.
  const helix = computeExamplePageLayout("helix", pages);
  const grid = computeExamplePageLayout("grid", pages);
  animator.animate(objects, helix, 1000, () => 0);
  animator.update(0);
  animator.update(100);
  const between = objects.map(object => object.position.clone());
  animator.animate(objects, grid, 1000, () => 0);
  animator.update(100);
  objects.forEach((object, index) => assert.ok(object.position.equals(between[index])));
  animator.update(1100);
  objects.forEach((object, index) => {
    assert.ok(object.position.equals(grid[index].position));
    assert.ok(object.quaternion.equals(grid[index].quaternion));
  });

  animator.animate(objects, sphere, 1000, () => 0);
  animator.cancel();
  assert.equal(animator.update(500), false, "cancelled transitions leave pages in place");
  objects.forEach((object, index) => assert.ok(object.position.equals(grid[index].position)));

  applyExamplePageLayout(objects, helix);
  objects.forEach((object, index) => {
    assert.ok(object.position.equals(helix[index].position));
    assert.ok(object.quaternion.equals(helix[index].quaternion));
  });
}

// A warm-up step leaves the loaded layout by a sub-pixel amount.
{
  const pages = gridPages(3, 3);
  const grid = computeExamplePageLayout("grid", pages), sphere = computeExamplePageLayout("sphere", pages);
  const step = interpolateExamplePageLayout(grid, sphere, 1e-3);
  step.forEach((target, index) => {
    const distance = target.position.distanceTo(grid[index].position);
    assert.ok(distance > 0 && distance < 1e-3 * grid[index].position.distanceTo(sphere[index].position) * 1.0001);
    assert.ok(target.quaternion.angleTo(grid[index].quaternion) < 1e-3 * grid[index].quaternion.angleTo(sphere[index].quaternion) + 1e-6);
  });
  interpolateExamplePageLayout(grid, sphere, 1).forEach((target, index) =>
    assert.ok(target.position.distanceTo(sphere[index].position) < 1e-9));
}

console.log("example page layout checks passed");
