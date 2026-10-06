// Synthetic scenes only: no browser, GPU context, PDF conversion, or server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { SceneAnnotationIndex, buildAnnotationMetadataHighlights } = await import("../src/sceneAnnotationInteraction.ts");
  const { ScenePrimitivePicker, getSceneAnnotationRuns, getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const layer = id => ({ id: `annotation:${id}`, annotationId: id, name: id, defaultVisible: true, locked: true, usedInView: false });
  const annotation = (id, index, rect, extra = {}) => ({ id, sourcePageIndex: 0, pageIndex: 0, annotationIndex: index,
    subtype: "Square", flags: 4, visibleInDefaultView: true, hasAppearance: false,
    pdfGeometry: { rect }, bounds: { minX: rect[0], minY: rect[1], maxX: rect[2], maxY: rect[3] }, ...extra });
  const scene = buildStrokeScene([
    { points: [[1010, -460], [1090, -460]], width: 1, color: "red" },
    { points: [[1010, -440], [1090, -440]], width: 1, color: "blue" },
    { points: [[1010, -460], [1090, -460]], width: 1, color: "black" }
  ]);
  scene.bounds = scene.pageBounds = { minX: 1000, minY: -500, maxX: 1100, maxY: -400 };
  scene.pageRects = Float32Array.of(1000, -500, 1100, -400);
  scene.pageTextRanges = Uint32Array.of(0, 0);
  scene.optionalContent = {
    groups: [{ id: "drawing", name: "Drawing", defaultVisible: true, locked: false, usedInView: true }, layer("appearance"), layer("clipped")],
    conditions: [{ kind: "group", groupId: "drawing" }, { kind: "group", groupId: "annotation:appearance" },
      { kind: "and", operands: [0, 1] }, { kind: "group", groupId: "annotation:clipped" }], order: [], radioGroups: []
  };
  scene.clipPaths = [{ parent: -1, fillRule: 0,
    edges: Float32Array.of(1000,-500,1050,-500, 1050,-500,1050,-400, 1050,-400,1000,-400, 1000,-400,1000,-500) }];
  scene.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 2 },
    { kind: "stroke", first: 1, count: 1, optionalContent: 3, clipIndex: 0 }, { kind: "stroke", first: 2, count: 1 }];
  scene.annotations = [
    annotation("appearance", 0, [1010,-470,1090,-450], { hasAppearance: true, optionalContent: 0 }),
    annotation("clipped", 1, [1010,-445,1090,-435], { hasAppearance: true }),
    annotation("note", 2, [1045,-465,1055,-455]),
    annotation("shx", 3, [1070,-425,1090,-410], { contents: "AutoCAD SHX Text" }),
    annotation("ink", 4, [1010,-425,1040,-405], { subtype: "Ink", inkList: [[1010,-420,1040,-420]], border: { width: 1 } }),
    annotation("polygon", 5, [1050,-425,1065,-405], { subtype: "Polygon", vertices: [1050,-425,1065,-425,1050,-405] }),
    annotation("hidden", 6, [1001,-499,1009,-491], { flags: 2 }),
    annotation("popup", 7, [1001,-499,1009,-491], { subtype: "Popup" }),
    annotation("quad", 8, [1001,-490,1009,-482], { subtype: "Highlight", quadPoints: [1001,-482,1009,-482,1001,-490,1009,-490] }),
    annotation("line", 9, [1070,-496,1090,-494], { subtype: "Line", line: [1070,-495,1090,-495] })
  ];
  const original = structuredClone(scene);
  const element = { getBoundingClientRect: () => ({ left: 75, top: 30, width: 800, height: 600 }) };
  const noop = () => {};
  const stub = () => new Proxy({ mesh: new THREE.Mesh(), group: new THREE.Group() }, { get: (target, key) => target[key] ?? noop });
  const makeObject = (data, backend) => {
    const native = new Proxy({ hasUploadedScene: () => false, getViewState: () => ({ zoom: 1, cameraCenterX: 1050, cameraCenterY: -450 }) },
      { get: (target, key) => target[key] ?? noop });
    const uv = new Float32Array(8);
    return new HeprThreePdfObject({ sourceLabel: "annotation fixture", sourceKind: "hep", scene: data }, backend, native,
      { width: 800, height: 600 }, null, { vectorLodMode: "off", textLodMode: "off", strokeCurveEnabled: true,
        textVectorOnly: true, threeColorCompositing: "linear", pageBackground: [1,1,1,1], vectorOverride: [0,0,0,0] },
      0, stub(), stub(), stub(), stub(), null, null, null, stub(), null,
      new THREE.Mesh(new THREE.PlaneGeometry(100,100), new THREE.MeshBasicMaterial()), uv, new THREE.BufferAttribute(uv, 2),
      undefined, undefined, backend === "webgpu" ? webGpu : undefined);
  };
  for (const backend of ["webgl", "webgpu"]) {
    const object = makeObject(scene, backend);
    assert.deepEqual(object.getAnnotationPrimitives("appearance"), [{ kind: "stroke", index: 0 }]);
    const refs = object.getAnnotationPrimitives("appearance"); refs[0].index = 100;
    assert.equal(object.getAnnotationPrimitives("appearance")[0].index, 0, "lookup returns detached references");
    assert.deepEqual(object.getAnnotationPrimitives("shx"), []);
    assert.throws(() => object.getAnnotationPrimitives("missing"), RangeError);
    object.getPrimitive = () => { throw new Error("public per-primitive scan must not be used"); };
    assert.equal(object.getAnnotationPrimitives("appearance").length, 1);
    object.setSelection([{ kind: "stroke", index: 0 }]);
    object.setAnnotationSelection(["appearance", "appearance"]);
    assert.equal(object.primitiveAppearance.getHighlights().count, 1, "annotation and primitive traces are deduplicated");
    const same = object.primitiveAppearance.getHighlights();
    object.setAnnotationSelection(["appearance"]);
    assert.equal(object.primitiveAppearance.getHighlights(), same, "unchanged selection reuses geometry");
    assert.throws(() => object.setAnnotationSelection(["shx", "missing"]), RangeError);
    assert.throws(() => object.setAnnotationSelection("shx"), TypeError);
    assert.equal(object.primitiveAppearance.getHighlights(), same, "invalid selection is atomic");
    object.setAnnotationHover("appearance");
    assert.equal(object.primitiveAppearance.getHighlights().count, 1, "hover does not duplicate selection");
    await object.setAnnotationVisibility(["appearance"], false);
    assert.equal(object.primitiveAppearance.getHighlights().selectionCount, 1, "annotation selection survives hiding the appearance");
    assert.deepEqual(object.primitiveAppearance.getSelection(), [], "primitive selection still drops hidden paint");
    object.setAnnotationSelection(null);
    assert.equal(object.primitiveAppearance.getHighlights().selectionCount, 0);
    object.setAnnotationHover(null);
    assert.equal(object.primitiveAppearance.getHighlights(), null);
    object.setAnnotationSelection(["ink"]);
    assert.equal(object.primitiveAppearance.getHighlights().count, 1, "metadata ink gets its path rather than a box");
    object.setAnnotationSelection(["polygon"]);
    assert.equal(object.primitiveAppearance.getHighlights().count, 3);
    object.setAnnotationSelection(["shx"]);
    assert.equal(object.primitiveAppearance.getHighlights().count, 4, "SHX falls back to a bounds trace");
    object.setSelection([{kind:"stroke",index:1}]); object.setHover({kind:"stroke",index:2}); object.setAnnotationHover("ink");
    const merged = object.primitiveAppearance.getHighlights();
    assert.equal(merged.selectionCount,5,"compiled and metadata selection precede both hover channels");
    assert.equal(merged.count,7);
    assert(merged.segments[7]>=0,"compiled trace keeps its hard clip when combined with metadata");
    assert.equal(merged.segments[8],1070,"metadata selection is ahead of the ordinary primitive hover");
    object.setAnnotationSelection(null);
    assert.deepEqual(object.primitiveAppearance.getSelection(),[{kind:"stroke",index:1}],"clearing annotation state keeps ordinary primitive selection");
    object.setSelection([]); object.setHover(null); object.setAnnotationHover(null);
    object.setAnnotationSelection(["hidden", "popup"]);
    assert.equal(object.primitiveAppearance.getHighlights(), null, "PDF flags remain respected");
    object.setAnnotationSelection(null);
    object.scale.set(1.3, .8, 1); object.rotation.set(.1, .15, .2); object.position.set(3, -5, 0);
    const parent = new THREE.Group(); parent.position.set(-4, 2, 1); parent.rotation.z = -.1; parent.add(object);
    parent.updateMatrixWorld(true);
    const cameras = [new THREE.OrthographicCamera(-100,100,75,-75,.1,1000), new THREE.PerspectiveCamera(50,4/3,.1,1000)];
    for (const camera of cameras) {
      camera.position.set(0,0,200); camera.updateMatrixWorld(true);
      const pick = async (x, y, options = {}) => {
        const client = object.sceneToClientPoint(camera, x, y, element);
        return object.pickAnnotation({ camera, element, clientX: client.x, clientY: client.y, tolerancePx: 0, ...options });
      };
      assert.equal((await pick(1050,-460,{ includeHidden: true })).annotationId, "note", "small metadata note wins over compiled paint");
      assert.equal(await pick(1020,-460), null, "default annotation picking skips hidden appearance");
      assert.equal((await pick(1020,-460,{ includeHidden: true })).annotationId, "appearance");
      assert.equal(await pick(1020,-455,{ includeHidden: true }), null, "a precise miss cannot hit broad appearance bounds");
      assert.equal((await pick(1080,-417)).annotationId, "shx");
      assert.equal((await pick(1020,-420)).annotationId, "ink");
      assert.equal(await pick(1020,-410), null, "ink empty bounding-box space is not picked");
      assert.equal((await pick(1053,-420)).annotationId, "polygon");
      assert.equal(await pick(1063,-407), null, "polygon bounds do not replace polygon geometry");
      assert.equal((await pick(1020,-440)).annotationId, "clipped");
      assert.equal(await pick(1080,-440,{ includeHidden: true }), null, "compiled hard clips still apply");
      assert.equal(await pick(1005,-495,{ includeHidden: true }), null, "includeHidden does not bypass PDF flags");
      assert.equal((await pick(1005,-486)).annotationId,"quad","PDF quad order is normalized before hit testing");
      assert.equal((await pick(1080,-495)).annotationId,"line");
      assert.equal(object.primitivePicker.index, null, "annotation picks never build the entire drawing index");
      const point = object.sceneToClientPoint(camera, 1080,-417,element);
      const near = await object.pickAnnotation({ camera,element,clientX:point.x+1,clientY:point.y,tolerancePx:4 });
      assert.equal(near.distancePx, 0);
      await object.setLayerVisibility("drawing",false);
      assert.equal(await pick(1020,-460,{ includeHidden: true }), null, "PDF layers remain hidden");
      object.setAnnotationSelection(["appearance"]);
      assert.equal(object.primitiveAppearance.getHighlights(), null);
      await object.setLayerVisibility("drawing",true);
      assert.equal(object.primitiveAppearance.getHighlights().selectionCount, 1, "selection returns when its PDF layer returns");
      object.setAnnotationSelection(null);
    }
    const common = { camera: cameras[0], element, clientX: 100, clientY: 100 };
    for (const tolerancePx of [-1, NaN, Infinity]) await assert.rejects(object.pickAnnotation({ ...common, tolerancePx }), RangeError);
    await assert.rejects(object.pickAnnotation({ ...common, includeHidden: "yes" }), TypeError);
    const abort = new AbortController(); abort.abort(new Error("cancelled annotation query"));
    await assert.rejects(object.pickAnnotation({ ...common, signal: abort.signal }), /cancelled annotation query/);
    assert.equal(await object.pickAnnotation({ ...common, clientX: 0 }), null);
    assert.equal(await object.pickAnnotation({ ...common, clientX: NaN }), null);
    object.setAnnotationSelection(["shx"]); object.setAnnotationHover("ink");
    object.clearPrimitiveInteraction();
    assert.equal(object.primitiveAppearance.getHighlights(), null);
    assert.equal(object.annotationIndex, null);
    object.dispose();
    assert.throws(() => object.setAnnotationSelection(["shx"]), /disposed/);
    await assert.rejects(object.pickAnnotation(common), /disposed/);
  }
  assert.deepEqual(scene, original, "interaction never mutates scene data");

  // Parent paint-graph conditions supply ownership; soft-mask-only paint must not become a trace.
  const graph = structuredClone(scene);
  graph.drawRuns = [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 }];
  graph.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: false, optionalContent: 1,
    children: [{ kind: "draw", runIndex: 0 }], softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: 1 }] } }] };
  assert.deepEqual(getSceneAnnotationRuns(graph).get("appearance"), [graph.drawRuns[0]]);
  const maskOnlyOwnership = structuredClone(graph);
  delete maskOnlyOwnership.paintGraph.roots[0].optionalContent;
  maskOnlyOwnership.paintGraph.roots[0].softMask.children[0].optionalContent = 1;
  assert.equal(getSceneAnnotationRuns(maskOnlyOwnership).size,0,"an annotation-owned mask does not own the page paint it masks");
  assert.equal(getScenePrimitive(maskOnlyOwnership,{kind:"stroke",index:0}).annotationId,undefined);

  // Every canonical primitive kind can be found without expanding its geometry.
  const kinds = ["stroke", "fill", "text", "raster", "gradient-fill", "gradient-stroke"];
  const allKinds = { ...createEmptyVectorScene(), optionalContent: scene.optionalContent,
    annotations: [scene.annotations[0]], drawRuns: kinds.map(kind => ({ kind, first: 0, count: 1, optionalContent: 1 })) };
  assert.deepEqual([...getSceneAnnotationRuns(allKinds).get("appearance")].map(run => run.kind), kinds);

  // Dense unrelated drawing arrays are deliberately unreadable. Cold and warm annotation picks stay local.
  const dense = structuredClone(scene);
  dense.annotations = [scene.annotations[0]];
  dense.segmentCount = 500_001;
  dense.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 2 }, { kind: "stroke", first: 1, count: 500_000 }];
  for (const name of ["endpoints", "primitiveMeta", "styles"]) dense[name] = new Proxy(dense[name], {
    get(target, key) { if (/^\d+$/.test(String(key))) assert(Number(key) < 4, "unrelated primitives must not be read"); return Reflect.get(target,key,target); }
  });
  const index = new SceneAnnotationIndex(dense), picker = new ScenePrimitivePicker(dense);
  const query = { minX: 1018, minY: -462, maxX: 1022, maxY: -458 };
  const options = { point: { x: 1020, y: -460 }, clientPoint: { x: 1020, y: -460 }, project: p => p, unproject: p => p };
  for (let i = 0; i < 2; i++) {
    const entries = await index.query(query);
    assert.equal(entries.length,1);
    assert.equal((await picker.pickRanges(options,index.appearanceRanges(entries[0],query))).annotationId,"appearance");
  }
  assert.equal(picker.index,null); index.dispose(); picker.dispose();

  const oversized = annotation("large-ink",0,[0,0,10,10],{subtype:"Ink",inkList:[Array.from({length:131_074},(_,i)=>i%10)]});
  const savedWarn = console.warn, diagnostics = [];
  console.warn = (...message) => diagnostics.push(message);
  try {
    assert.equal(buildAnnotationMetadataHighlights([oversized],[]).count,4,"oversized metadata uses bounded rectangle approximation");
    buildAnnotationMetadataHighlights([oversized],[]);
    assert.equal(diagnostics.length,1,"reduced fidelity is reported once for oversized metadata");
  } finally { console.warn = savedWarn; }

  // Spatial blocks cull most of a complex appearance on repeated queries.
  const complex = buildStrokeScene(Array.from({length:4096},(_,i)=>({points:[[i*2,0],[i*2+1,0]],width:.1,color:"red"})));
  complex.optionalContent = scene.optionalContent;
  complex.annotations = [annotation("appearance",0,[0,-1,8192,1],{hasAppearance:true})];
  complex.drawRuns = [{kind:"stroke",first:0,count:complex.segmentCount,optionalContent:1}];
  const complexIndex = new SceneAnnotationIndex(complex);
  const smallQuery = {minX:100,minY:-1,maxX:101,maxY:1};
  const [complexEntry] = await complexIndex.query(smallQuery);
  assert(complexIndex.appearanceRanges(complexEntry,smallQuery).reduce((sum,range)=>sum+range.count,0)<=128,
    "warm picking visits nearby blocks instead of every member of a complex appearance");
  complexIndex.dispose();

  // Cancelling one wait does not cancel preparation shared by another query.
  const sharedIndex = new SceneAnnotationIndex(complex), cancelWait = new AbortController();
  const cancelledWait = sharedIndex.query(smallQuery,cancelWait.signal);
  cancelWait.abort(new Error("cancelled shared wait"));
  await assert.rejects(cancelledWait,/cancelled shared wait/);
  assert.equal((await sharedIndex.query(smallQuery)).length,1);
  sharedIndex.dispose();

  // Visibility revisions and clearing during an asynchronous pick reject stale results.
  const staleObject = makeObject(scene,"webgl"), staleCamera = new THREE.OrthographicCamera(-100,100,75,-75,.1,1000);
  staleCamera.position.z=200; staleCamera.updateMatrixWorld();
  const staleClient = staleObject.sceneToClientPoint(staleCamera,1080,-417,element);
  const staleOptions = {camera:staleCamera,element,clientX:staleClient.x,clientY:staleClient.y};
  const stalePick = staleObject.pickAnnotation(staleOptions);
  const staleResult = assert.rejects(stalePick,error=>error.name==="AbortError");
  await staleObject.setLayerVisibility("drawing",false);
  await staleResult;
  const clearedPick = staleObject.pickAnnotation(staleOptions);
  const clearedResult = assert.rejects(clearedPick,error=>error.name==="AbortError");
  staleObject.clearPrimitiveInteraction();
  await clearedResult;
  staleObject.dispose();

  // Existing HEP sections preserve the mapping; no container change or source PDF conversion is needed.
  const loaded = await loadSceneFromHep(await (await buildHep(scene,{ compression: "store" })).arrayBuffer());
  assert.equal(getSceneAnnotationRuns(loaded).get("appearance")[0].first,0);
  const legacy = structuredClone(scene);
  legacy.optionalContent = { groups: [scene.optionalContent.groups[0]], conditions: [scene.optionalContent.conditions[0]], order: [], radioGroups: [] };
  legacy.drawRuns = legacy.drawRuns.map(({ optionalContent, ...run }) => run);
  const oldObject = makeObject(legacy,"webgl");
  assert.deepEqual(oldObject.getAnnotationPrimitives("appearance"),[]);
  oldObject.setAnnotationSelection(["appearance"]);
  assert.equal(oldObject.primitiveAppearance.getHighlights().count,4,"legacy ownership falls back to metadata");
  oldObject.dispose();
  console.log("Annotation interaction passed: precise/metadata picking, hidden paint, overlap, transforms, flags, clipping, dense-scene isolation and HEP compatibility.");
} finally { hooks.deregister(); }
