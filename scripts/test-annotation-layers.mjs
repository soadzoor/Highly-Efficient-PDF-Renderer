// Synthetic scenes only; no PDF assets, conversion, browser, or server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { OptionalContentController, validateSceneOptionalContent } = await import("../src/optionalContent.ts");
  const { AnnotationLayerBuilder, annotationLayerId } = await import("../src/annotationLayers.ts");
  const { composeOptionalContent } = await import("../src/optionalContentComposition.ts");
  const { getScenePrimitive, isScenePrimitiveVisible } = await import("../src/scenePrimitives.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");

  const annotationLayer = id => ({ id: annotationLayerId(id), name: `Annotation ${id}`, defaultVisible: true, locked: true,
    usedInView: false, annotationId: id });
  const annotation = (id, annotationIndex, subtype = "Square") => ({ id, sourcePageIndex: 0, pageIndex: 0, annotationIndex, subtype,
    flags: 4, visibleInDefaultView: true, hasAppearance: subtype !== "Popup", pdfGeometry: { rect: [0, 0, 10, 10] },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
  const scene = createEmptyVectorScene();
  scene.pageCount = 1;
  scene.pageRects = Float32Array.of(0, 0, 100, 100);
  scene.pageTextRanges = Uint32Array.of(0, 0);
  scene.optionalContent = {
    groups: [{ id: "ref:1:0", name: "Walls", defaultVisible: true, locked: false, usedInView: true },
      annotationLayer("ref:5:0"), annotationLayer("ref:6:0")],
    conditions: [{ kind: "group", groupId: "ref:1:0" }, { kind: "group", groupId: "annotation:ref:5:0" },
      { kind: "and", operands: [0, 1] }, { kind: "group", groupId: "annotation:ref:6:0" }],
    order: [{ kind: "group", groupId: "ref:1:0" }],
    radioGroups: []
  };
  scene.segmentCount = 3;
  scene.endpoints = Float32Array.of(0, 0, 10, 10, 20, 20, 30, 30, 40, 40, 50, 50);
  scene.primitiveMeta = Float32Array.of(10, 10, 0, 1, 30, 30, 0, 1, 50, 50, 0, 1);
  scene.primitiveBounds = Float32Array.of(0, 0, 10, 10, 20, 20, 30, 30, 40, 40, 50, 50);
  scene.styles = Float32Array.of(0.5, 1, 0, 0, 0.5, 0, 1, 0, 0.5, 0, 0, 1);
  // A Walls-layer paint, an annotation drawn inside the Walls layer, and an unlayered annotation.
  scene.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "stroke", first: 1, count: 1, optionalContent: 2 },
    { kind: "stroke", first: 2, count: 1, optionalContent: 3 }];
  scene.annotations = [annotation("ref:5:0", 0), annotation("ref:6:0", 1), annotation("ref:7:0", 2, "Popup")];

  const controller = new OptionalContentController(scene);
  const visibleRuns = () => [0, 1, 2].map(index => isScenePrimitiveVisible(scene, { kind: "stroke", index },
    condition => controller.isVisible(condition)));
  assert.deepEqual(controller.getLayers().map(layer => layer.id), ["ref:1:0"], "annotation layers are not PDF layers");
  assert.deepEqual(controller.getOrder(), [{ kind: "group", groupId: "ref:1:0" }]);
  assert.deepEqual(controller.getGroupIds(2), ["ref:1:0"]);
  assert.deepEqual(controller.getAnnotationLayers(), [{ annotationId: "ref:5:0", visible: true }, { annotationId: "ref:6:0", visible: true }]);

  await controller.setAnnotationVisibility(["ref:5:0", "ref:7:0"], false);
  assert.deepEqual(visibleRuns(), [true, false, true], "only the hidden annotation's paint is ineligible; a popup has no layer");
  assert.deepEqual(controller.getAnnotationLayers().map(layer => layer.visible), [false, true]);
  const revision = controller.revision;
  await assert.rejects(controller.setAnnotationVisibility(["ref:5:0", "missing"], true), RangeError);
  await assert.rejects(controller.setAnnotationVisibility("ref:5:0", true), TypeError);
  await assert.rejects(controller.setAnnotationVisibility(["ref:5:0"], "yes"), TypeError);
  await assert.rejects(controller.setLayerVisibility("annotation:ref:5:0", true), /Unknown PDF layer/);
  assert.equal(controller.revision, revision, "rejected annotation changes do not commit");

  await controller.setAllLayerVisibility(false);
  assert.deepEqual(visibleRuns(), [false, false, true], "hiding every PDF layer leaves the unlayered annotation visible");
  assert.deepEqual(controller.getAnnotationLayers().map(layer => layer.visible), [false, true], "PDF layer bulk changes keep annotation state");
  await controller.resetLayerVisibility();
  assert.deepEqual(visibleRuns(), [true, false, true], "a layer reset keeps the host's annotation visibility");
  await controller.setAnnotationVisibility(["ref:5:0"], true);
  assert.deepEqual(visibleRuns(), [true, true, true]);
  controller.dispose();

  const layered = getScenePrimitive(scene, { kind: "stroke", index: 1 });
  assert.equal(layered.annotationId, "ref:5:0");
  assert.deepEqual(layered.optionalContent.layerIds, ["ref:1:0"], "annotation layers are not reported as PDF layers");
  assert.equal(getScenePrimitive(scene, { kind: "stroke", index: 0 }).annotationId, undefined);
  assert.equal(getScenePrimitive(scene, { kind: "stroke", index: 2 }).annotationId, "ref:6:0");

  // HEP stores annotation layers in its existing layer section and records the appearance mode.
  const blob = await buildHep({ ...scene, annotationAppearances: "forms" }, { compression: "store" });
  const loaded = await loadSceneFromHep(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(loaded.optionalContent.groups, scene.optionalContent.groups);
  assert.equal(loaded.annotationAppearances, "forms");
  const rendered = await loadSceneFromHep(new Uint8Array(await (await buildHep(scene, { compression: "store" })).arrayBuffer()));
  assert.equal(rendered.annotationAppearances, undefined, "render is recorded by omission");
  for (const annotationId of ["", 7]) {
    assert.throws(() => validateSceneOptionalContent({ ...scene.optionalContent,
      groups: [{ ...annotationLayer("ref:5:0"), annotationId }] }), /optional content/);
  }

  // Page-local conditions are appended; existing indexes stay valid.
  const builder = new AnnotationLayerBuilder({ groups: [], conditions: [{ kind: "constant", value: true }], order: [], radioGroups: [] },
    [{ kind: "constant", value: true }]);
  assert.equal(builder.condition(undefined, undefined), undefined);
  assert.equal(builder.condition(0, undefined), 0);
  assert.equal(builder.condition(undefined, "ref:5:0"), 1);
  assert.equal(builder.condition(0, "ref:5:0"), 2);
  assert.equal(builder.condition(0, "ref:5:0"), 2, "combinations are shared");
  assert.deepEqual(builder.build().conditions, [{ kind: "constant", value: true }, { kind: "group", groupId: "annotation:ref:5:0" },
    { kind: "and", operands: [0, 1] }]);
  assert.equal(new AnnotationLayerBuilder(undefined, []).build(), undefined, "pages without layers stay without optional content");
  {
    const id = "ref:5:0", preferred = annotationLayerId(id), occupiedFallback = `hepr-annotation:${JSON.stringify([id, 0])}`;
    const real = layerId => ({ id: layerId, name: "Real PDF layer", defaultVisible: true, locked: false, usedInView: true });
    const base = { groups: [real(preferred), real(occupiedFallback)], conditions: [{ kind: "group", groupId: preferred }, { kind: "group", groupId: occupiedFallback }],
      order: [{ kind: "group", groupId: preferred }, { kind: "group", groupId: occupiedFallback }], radioGroups: [] };
    const collision = new AnnotationLayerBuilder(base, [...base.conditions]);
    const combined = collision.condition(0, id), own = collision.condition(undefined, id), built = collision.build();
    validateSceneOptionalContent(built);
    const internal = built.groups.find(group => group.annotationId === id);
    assert.equal(internal.id, `hepr-annotation:${JSON.stringify([id, 1])}`, "real PDF ids reserve both preferred and alternate annotation gate ids");
    assert.equal(new Set(built.groups.map(group => group.id)).size, 3);
    assert.equal(base.groups.length, 2, "allocation leaves the source PDF catalog unchanged");
    const collisionScene = { ...scene, optionalContent: built, annotations: [annotation(id, 0)],
      drawRuns: scene.drawRuns.map((run, index) => ({ ...run, optionalContent: index === 0 ? 0 : index === 1 ? own : combined })) };
    const independent = new OptionalContentController(collisionScene);
    assert.deepEqual(independent.getLayers().map(group => group.id), [preferred, occupiedFallback], "prefix-shaped real PDF layers remain actual PDF layers");
    await independent.setAnnotationVisibility([id], false);
    assert.equal(independent.isVisible(0), true); assert.equal(independent.isVisible(own), false); assert.equal(independent.isVisible(combined), false);
    await independent.setAnnotationVisibility([id], true); await independent.setLayerVisibility(preferred, false);
    assert.equal(independent.isVisible(own), true); assert.equal(independent.isVisible(0), false); assert.equal(independent.isVisible(combined), false,
      "the real OCG and annotation visibility gate retain independent state");
    independent.dispose();

    const existingGroup = { ...annotationLayer(id), id: "custom-existing-gate", defaultVisible: false };
    const reusable = { groups: [real(preferred), existingGroup], conditions: [{ kind: "group", groupId: preferred }, { kind: "group", groupId: existingGroup.id },
      { kind: "and", operands: [0, 1] }], order: [{ kind: "group", groupId: preferred }], radioGroups: [] };
    const reused = new AnnotationLayerBuilder(reusable, [...reusable.conditions]);
    assert.equal(reused.condition(undefined, id), 1); assert.equal(reused.condition(1, id), 1);
    assert.equal(reused.condition(0, id), 2, "rewrapping an existing conjunction reuses its condition");
    assert.equal(reused.build().groups.length, 2); assert.equal(reused.build().conditions.length, 3);
    assert.equal(reused.build().groups.find(group => group.annotationId === id).defaultVisible, false, "explicit metadata preserves existing gate visibility");
    const missingCondition = new AnnotationLayerBuilder({ ...reusable, conditions: [{ kind: "constant", value: true }] }, [{ kind: "constant", value: true }]);
    assert.equal(missingCondition.condition(undefined, id), 1); assert.equal(missingCondition.build().groups.length, 2,
      "an existing annotation group without a condition gains one without duplicating its group");

    const aliases = ["a", "a:1"], deterministic = { groups: aliases.map(value => real(annotationLayerId(value))), conditions: [], order: [], radioGroups: [] };
    const all = new AnnotationLayerBuilder(deterministic, []); aliases.forEach(value => all.condition(undefined, value));
    const reversed = new AnnotationLayerBuilder(deterministic, []); [...aliases].reverse().forEach(value => reversed.condition(undefined, value));
    const subset = new AnnotationLayerBuilder(deterministic, []); subset.condition(undefined, aliases[1]);
    const allocated = data => new Map(data.groups.filter(group => group.annotationId !== undefined).map(group => [group.annotationId, group.id]));
    for (const [annotationId, layerId] of allocated(all.build())) assert.equal(allocated(reversed.build()).get(annotationId), layerId);
    assert.equal(allocated(subset.build()).get(aliases[1]), allocated(all.build()).get(aliases[1]), "gate ids do not depend on painting subset or order");
    validateSceneOptionalContent(all.build()); validateSceneOptionalContent(reversed.build()); validateSceneOptionalContent(subset.build());
  }
  const formerGroupLimit = 100_000;
  const full = new AnnotationLayerBuilder({ groups: Array.from({ length: formerGroupLimit },
    (_, index) => ({ id: `g${index}`, name: "", defaultVisible: true, locked: false, usedInView: true })), conditions: [], order: [], radioGroups: [] }, []);
  assert.equal(full.condition(undefined, "ref:5:0"), 0, "an annotation beyond the former ceiling retains its own layer");
  assert.equal(full.unavailableCount, 0);
  assert.equal(full.build().groups.length, formerGroupLimit + 1);

  // Composition keeps one layer per annotation id, outside the display order, within the layer ceiling.
  const page = (annotationIds, pdfGroups = [{ id: "ref:1:0", name: "Walls", defaultVisible: true, locked: false, usedInView: true }]) => ({
    groups: [...pdfGroups, ...annotationIds.map(annotationLayer)],
    conditions: [...pdfGroups.map(group => ({ kind: "group", groupId: group.id })),
      ...annotationIds.map(id => ({ kind: "group", groupId: annotationLayerId(id) }))],
    order: pdfGroups.map(group => ({ kind: "group", groupId: group.id })), radioGroups: [] });
  const composed = composeOptionalContent([page(["ref:5:0"]), undefined, page(["ref:5:0", "ref:9:0"])]);
  assert.deepEqual(composed.data.groups.map(group => group.id), ["ref:1:0", "annotation:ref:5:0", "annotation:ref:9:0"],
    "an annotation object shared by two pages has one layer");
  assert.deepEqual(composed.data.order, [{ kind: "group", groupId: "ref:1:0" }]);
  assert.deepEqual(composed.offsets, [0, 2, 2]);
  assert.equal(composed.droppedAnnotationLayers, 0);
  const crowded = Array.from({ length: formerGroupLimit - 1 },
    (_, index) => ({ id: `layer${index}`, name: "", defaultVisible: true, locked: false, usedInView: true }));
  const limited = composeOptionalContent([page(["ref:5:0", "ref:6:0"], crowded)]);
  assert.equal(limited.droppedAnnotationLayers, 0);
  assert.equal(limited.data.groups.length, formerGroupLimit + 1);
  assert.deepEqual(limited.data.conditions.at(-1), { kind: "group", groupId: "annotation:ref:6:0" },
    "composition retains annotation visibility beyond the former layer ceiling");
  validateSceneOptionalContent(limited.data);
  console.log("Annotation layers passed: separate runtime API, PDF-layer isolation, picking attribution, HEP round trips, limits and composition.");
} finally { hooks.deregister(); }
