import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { waitForLoad } from "../src/loadCancellation.ts";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const editor = sourceFunction(source, "ensureNativeEditor");
const methodsStart = editor.indexOf("        documentChanged("), methodsEnd = editor.indexOf("        clientToScenePoint:", methodsStart);
assert(methodsStart >= 0 && methodsEnd > methodsStart, "native editor host methods are available");
const placementStart = editor.indexOf("const sourcePlacementMatches = "), placementEnd = editor.indexOf(";\n", placementStart);
assert(placementStart >= 0 && placementEnd > placementStart, "native editor placement predicate is available");
const visibilityStart = source.indexOf("const layerVisibility = createLayerVisibilityController({");
const visibilityEnd = source.indexOf("\n});", visibilityStart);
assert(visibilityStart >= 0 && visibilityEnd > visibilityStart, "native optional-content callbacks are available");
const setup = stripTypeScriptTypes(`${source.slice(visibilityStart, visibilityEnd + 4)}
${sourceFunction(source, "applyTextSearchScene")}
const sourcePlacementMatches = ${editor.slice(placementStart + "const sourcePlacementMatches = ".length, placementEnd)};
globalThis.host = {${editor.slice(methodsStart, methodsEnd)}};`);
const noop = () => {};

function fixture() {
  const calls = [], state = { eligible: true }, initial = { id: "committed", pagesPerRow: 2 }, view = {};
  let visibility;
  const record = name => (...args) => calls.push([name, ...args]);
  const context = vm.createContext({ AbortController, Uint8Array, waitForLoad,
    readerThumbnailScene: initial, lastParsedScene: initial, lastCanonicalScene: initial,
    nativeLayout: "reader", editSourceLayout: "reader", canonicalPagesPerRow: 2,
    editSourceScene: initial, initialEditScene: initial, originalLayout: "reader",
    pendingEditorSource: null, originalSource: {}, originalPassword: undefined, originalDownload: null,
    lastLoadedSource: null, lastLoadedPdfPassword: null, lastDownloadablePdf: null,
    documentPageScenes: [initial], activePdfPageLoader: null, parsedPdfPageCache: null,
    editorSceneApplicationActive: false, updateBackendSelectDisabledState: noop,
    synchronizeNativeTextRecognition: record("recognition-sync"),
    backendSwitcher: { runWhenIdle: callback => Promise.resolve(callback()) },
    renderer: { getViewState: () => view, setViewState: noop,
      updateEditorPreviewScene(scene) { calls.push(["preview", scene]); return state.eligible; },
      setScene: record("upload") },
    colorPreview: { beforeSceneChange: noop, bind: noop },
    readerViewport: { invalidateThumbnails: record("thumbnails") },
    ScenePageViews: class { constructor(scene) { this.pages = scene.pages ?? [scene]; this.pageCount = this.pages.length; }
      extract(index) { return { scene: this.pages[index] }; } },
    composeVectorScenesInGrid: pages => ({ id: "grid", pages }),
    composeVectorScenesInColumn: pages => ({ id: "column", pages }),
    createLayerVisibilityController(options) {
      visibility = options;
      return { sceneChanged() { calls.push(["layers"]); options.onChange({ revision: 0 }); } };
    },
    pdfLayerControls: { refresh: noop, setProgress: noop },
    annotationControls: { sceneChanged: noop }, drawingSelection: { sceneChanged: noop, onFrame: noop },
    annotationInteraction: null, annotationOverlay: { sceneChanged: noop, onFrame: noop },
    textSelection: { clearSelection: noop },
    textSearchController: { setScene: record("search"), refreshVisibility: record("visibility") },
    textSearchWidget: { setAvailability: record("availability") }
  });
  vm.runInContext(setup, context);
  return { context, calls, state, initial, visibility,
    apply: (scene, options) => context.host.applyScene(scene, new AbortController().signal, undefined, options),
    thumbnails: () => calls.filter(call => call[0] === "thumbnails") };
}

for (const affectedPages of [undefined, [], [1, 3]]) {
  const f = fixture(), next = { id: "edit", textIndex: { pages: [{ text: "Edited" }] } };
  f.context.applyTextSearchScene(next, affectedPages);
  assert.equal(f.context.readerThumbnailScene, next, "a committed scene becomes the thumbnail source");
  assert.equal(f.calls.filter(call => call[0] === "layers").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "visibility").length, 1, "revision-zero installation still updates document visibility");
  assert.equal(f.thumbnails().length, 1, "revision-zero publication does not add a global refresh to the committed page refresh");
  assert.equal(f.thumbnails()[0][1], affectedPages, "the exact affected-page set reaches Reader invalidation");
  assert.equal(f.calls.find(call => call[0] === "search")[1], next);
  assert.equal(f.calls.find(call => call[0] === "availability")[1], "ready");
  assert.equal(f.calls.find(call => call[0] === "recognition-sync")[1], true, "committed publication refreshes recognition against the current page placement");
  f.visibility.onChange({ revision: 1 });
  assert.equal(f.thumbnails().length, 2, "an actual viewer layer toggle refreshes thumbnails");
  assert.equal(f.thumbnails()[1][1], undefined, "viewer layer visibility remains a global appearance change");
}

for (const path of ["local", "upload", "placement"]) {
  const f = fixture(), pose = { id: `preview-${path}`, pagesPerRow: 2 }, affectedPages = [];
  if (path === "upload") f.state.eligible = false;
  if (path === "placement") f.context.editSourceLayout = "grid";
  await f.apply(pose, { preview: true, affectedPages });
  assert.equal(f.context.readerThumbnailScene, f.initial, `${path} preview retains the committed thumbnail source`);
  assert.notEqual(f.context.lastParsedScene, f.initial, "the rendered document still follows the preview");
  assert.equal(f.thumbnails().length, 0, `${path} preview does not invalidate Reader thumbnails`);
  assert.equal(f.calls.filter(call => call[0] === "upload").length, path === "local" ? 0 : 1);
  assert.equal(f.calls.filter(call => call[0] === "search").length, 1, "preview search geometry follows its rendered scene");
  assert.equal(f.calls.some(call => call[0] === "layers"), false, "previews do not republish optional-content scene installation");
  const next = { id: "commit", pagesPerRow: 2 }, committedPages = [2];
  await f.apply(next, { preview: false, affectedPages: committedPages });
  assert.equal(f.context.readerThumbnailScene, f.context.lastParsedScene, "a final commit replaces the stable thumbnail source");
  assert.equal(f.thumbnails().length, 1);
  assert.equal(f.thumbnails()[0][1], committedPages, "committing after a preview refreshes only the affected pages");
}

console.log("Native Reader thumbnails: committed page invalidation, revision-zero layer initialization, viewer visibility refresh and stable thumbnail sources across local/full-upload/placement previews passed.");
