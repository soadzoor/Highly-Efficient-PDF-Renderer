import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { deferRendererSceneUpload } from "../src/deferredRendererApi.ts";

const threePdfObjectSource = await readFile(
  new URL("../src/threePdfObject.ts", import.meta.url),
  "utf8"
);
assert.match(threePdfObjectSource, /deferRendererSceneUpload\(nativeRenderer, loadedScene\.scene\)/);
assert.doesNotMatch(
  threePdfObjectSource,
  /nativeRenderer\.setScene\(/,
  "the Three adapter must not eagerly upload the duplicate native scene"
);

const scene = { marker: "initial" };
const calls = [];
const stats = { marker: "stats" };
const view = { cameraCenterX: 1, cameraCenterY: 2, zoom: 3 };

const renderer = new Proxy({
  sceneStats: null,
  setScene(nextScene) {
    calls.push(["setScene", nextScene]);
    this.sceneStats = stats;
    return stats;
  },
  getSceneStats() {
    calls.push(["getSceneStats"]);
    return this.sceneStats;
  },
  renderExternalFrame(timestamp) {
    calls.push(["renderExternalFrame", timestamp]);
  },
  setViewState(nextView) {
    calls.push(["setViewState", nextView]);
  },
  getViewState() {
    calls.push(["getViewState"]);
    return view;
  },
  setInteractionViewportProvider(provider) {
    calls.push(["setInteractionViewportProvider", provider]);
  },
  clientToScenePoint(x, y) {
    calls.push(["clientToScenePoint", x, y]);
    return { x, y };
  },
  dispose() {
    calls.push(["dispose"]);
  }
}, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }
    return () => undefined;
  }
});

const deferred = deferRendererSceneUpload(renderer, scene);
assert.equal(deferred.hasUploadedScene(), false);

deferred.setInteractionViewportProvider(() => null);
deferred.setViewState(view);
assert.deepEqual(deferred.getViewState(), view);
assert.deepEqual(deferred.clientToScenePoint(4, 5), { x: 4, y: 5 });
assert.equal(deferred.hasUploadedScene(), false, "view/interaction/hit testing must not upload the scene");

deferred.renderExternalFrame(123);
assert.equal(deferred.hasUploadedScene(), true);
assert.equal(calls.filter(([name]) => name === "setScene").length, 1);
assert.deepEqual(calls.slice(-2), [["setScene", scene], ["renderExternalFrame", 123]]);

assert.equal(deferred.getSceneStats(), stats);
assert.equal(calls.filter(([name]) => name === "setScene").length, 1, "resource queries must reuse the upload");

const replacement = { marker: "replacement" };
assert.equal(deferred.setScene(replacement), stats);
assert.deepEqual(calls.findLast(([name]) => name === "setScene"), ["setScene", replacement]);

deferred.dispose();
assert.equal(calls.at(-1)[0], "dispose");

const diagnosticCalls = [];
const diagnosticRenderer = new Proxy({
  stats: null,
  setScene(nextScene) {
    diagnosticCalls.push(["setScene", nextScene]);
    this.stats = stats;
    return stats;
  },
  getSceneStats() {
    diagnosticCalls.push(["getSceneStats"]);
    return this.stats;
  },
  dispose() {
    diagnosticCalls.push(["dispose"]);
  }
}, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }
    return () => undefined;
  }
});
const diagnosticDeferred = deferRendererSceneUpload(diagnosticRenderer, scene);
assert.equal(diagnosticDeferred.getSceneStats(), stats);
assert.deepEqual(diagnosticCalls, [["setScene", scene], ["getSceneStats"]]);
diagnosticDeferred.dispose();

const frameDriverCalls = [];
const frameDriverRenderer = new Proxy({
  setScene(nextScene) {
    frameDriverCalls.push(["setScene", nextScene]);
    return stats;
  },
  setExternalFrameDriver(enabled) {
    frameDriverCalls.push(["setExternalFrameDriver", enabled]);
  },
  dispose() {}
}, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }
    return () => undefined;
  }
});
const frameDriverDeferred = deferRendererSceneUpload(frameDriverRenderer, scene);
frameDriverDeferred.setExternalFrameDriver(true);
assert.equal(frameDriverDeferred.hasUploadedScene(), false);
frameDriverDeferred.setExternalFrameDriver(false);
assert.equal(frameDriverDeferred.hasUploadedScene(), true);
assert.deepEqual(frameDriverCalls, [
  ["setExternalFrameDriver", true],
  ["setScene", scene],
  ["setExternalFrameDriver", false]
]);
frameDriverDeferred.dispose();

const falseyFrameDriverCalls = [];
const falseyFrameDriverRenderer = new Proxy({
  setScene(nextScene) {
    falseyFrameDriverCalls.push(["setScene", nextScene]);
    return stats;
  },
  setExternalFrameDriver(enabled) {
    falseyFrameDriverCalls.push(["setExternalFrameDriver", enabled]);
  },
  dispose() {}
}, {
  get(target, property) {
    if (property in target) {
      return target[property];
    }
    return () => undefined;
  }
});
const falseyFrameDriverDeferred = deferRendererSceneUpload(falseyFrameDriverRenderer, scene);
falseyFrameDriverDeferred.setExternalFrameDriver(null);
assert.equal(falseyFrameDriverDeferred.hasUploadedScene(), true);
assert.deepEqual(falseyFrameDriverCalls, [
  ["setScene", scene],
  ["setExternalFrameDriver", null]
]);
falseyFrameDriverDeferred.dispose();

console.log("Deferred renderer scene-upload checks passed.");
