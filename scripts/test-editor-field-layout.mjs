import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { layoutEditorText } = await import("../src/editorText.ts");
  const { choosePdfFormAutoFontSize } = await import("../src/pdf/formAutoFontSize.ts");
  const { editorFieldAnnotation, validateEditorFieldObject } = await import("../src/editorFormFields.ts");
  const { editorPaintRole } = await import("../src/editorPaintIdentity.ts");
  const { getPrimitiveClipChain } = await import("../src/scenePrimitives.ts");
  const { vectorClipChainBounds, validateVectorClips } = await import("../src/vectorClips.ts");
  const { transformWholeEditorScene } = await import("../src/editorScene.ts");
  const hb = await import("harfbuzzjs");
  const services = await createEditorAppServices({ loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  try {
    const font = await services.fonts.loadBundled("Liberation Sans"), face = new hb.Face(new hb.Blob(font.bytes)), extents = new hb.Font(face).hExtents();
    const ascent = extents.ascender / face.upem, descent = extents.descender / face.upem;
    const base = { kind: "field", id: "new-field", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0],
      name: "Field", fieldType: "text", x: 10, y: 20, width: 70, height: 40, fontSize: 10, fontId: font.id, value: "MMMMMMMMMMMMMMMMMMMMMMMM" };
    const text = { ...base, kind: "text", text: base.value };
    const ordinary = await layoutEditorText(text, services.fonts), explicitDefault = await layoutEditorText(text, services.fonts, undefined, {});
    assert.deepEqual(ordinary, explicitDefault, "ordinary textbox defaults remain unchanged");
    assert(ordinary.height > base.fontSize * 1.2, "textboxes retain wrapping");
    const oneLine = await layoutEditorText(text, services.fonts, undefined, { wrap: false, verticalAlignment: "middle" });
    assert.equal(new Set(oneLine.glyphs.map(glyph => glyph.y)).size, 1, "single-line fields never wrap");
    assert(oneLine.width > base.width);
    const expected = base.y + (base.height - (ascent - descent) * base.fontSize) / 2 - descent * base.fontSize;
    assert(Math.abs(oneLine.glyphs[0].y - expected) < 1e-7, "field baselines use the actual font's centered ascent/descent");
    const probe = await layoutEditorText({ ...text, fontSize: 1 }, services.fonts, undefined, { wrap: false });
    const auto = await layoutEditorText(text, services.fonts, undefined, { wrap: false, verticalAlignment: "middle", autoFontSize: true });
    const expectedSize = choosePdfFormAutoFontSize(false, size => probe.width * size <= base.width + 1e-7 && (ascent - descent) * size <= base.height + 1e-7);
    assert(auto.glyphs.every(glyph => glyph.size === expectedSize), "automatic field sizing uses shaped advances and discrete PDF choices");

    const scene = await services.sessionOptions.compileObject(base);
    assert.equal(new Set(Array.from({ length: scene.textInstanceCount }, (_, index) => scene.textInstanceB[index * 4 + 1].toFixed(4))).size, 1);
    const inset = 2, innerHeight = base.height - inset * 2;
    const expectedCompiledBaseline = base.y + inset + (innerHeight - (ascent - descent) * base.fontSize) / 2 - descent * base.fontSize;
    assert(Math.abs(scene.textInstanceB[1] - expectedCompiledBaseline) < 1e-3, "compiled field glyphs use the same centered layout");
    assert(Math.abs(scene.annotations[0].field.textStyle.ascent - ascent) < 1e-7, "native input previews receive the actual font metrics");
    assert(Math.abs(scene.annotations[0].field.textStyle.descent - descent) < 1e-7);
    assert.deepEqual(Array.from(scene.pageRects), [10, 20, 80, 60]); validateVectorClips(scene);
    const clipBounds = vectorClipChainBounds(scene.clipPaths);
    for (const run of scene.drawRuns) {
      assert(run.clipIndex >= 0, "every field paint stays clipped to its widget");
      const bounds = Array.from(clipBounds.subarray(run.clipIndex * 4, run.clipIndex * 4 + 4));
      assert(bounds[0] >= 10 && bounds[1] >= 20 && bounds[2] <= 80 && bounds[3] <= 60);
    }
    const glyphClip = getPrimitiveClipChain(scene, { kind: "text", index: 0 });
    assert(glyphClip.rect || glyphClip.clipIndex >= 0, "overlong single-line content retains its content clip");
    const moved = transformWholeEditorScene(scene, [1, 0, 0, 1, 30, 40]);
    const movedClip = moved.clipPaths[moved.drawRuns[0].clipIndex];
    assert(Math.min(...Array.from(movedClip.edges).filter((_, index) => index % 2 === 0)) >= 40, "field-owned clips follow object transforms");

    const list = await services.sessionOptions.compileObject({ ...base, fieldType: "list", width: 120, height: 60, value: "beta",
      options: [{ value: "alpha", label: "Alpha" }, { value: "beta", label: "Beta" }, { value: "gamma", label: "Gamma" }] });
    const listText = list.textIndex.pages.map(page => page.text).join(" ");
    for (const label of ["Alpha", "Beta", "Gamma"]) assert(listText.includes(label), "list appearances include unselected visible options");
    const role = editorPaintRole(list); let selected = 0, unselected = 0;
    for (let index = 0; index < list.textInstanceCount; index++) {
      const white = [0, 1, 2].every(channel => list.textInstanceC[index * 4 + channel] === 1);
      assert.equal(role({ kind: "text", index }), white ? null : "color", "selected list text and highlight colors stay independent of field text color");
      if (white) selected++; else unselected++;
    }
    assert(selected && unselected);
    assert(list.fillPathCount > scene.fillPathCount, "selected list options have a vector highlight");
    const blank = await services.sessionOptions.compileObject({ ...base, required: true, value: "" });
    assert.equal(blank.textInstanceCount, 0, "required authoring fields may start blank");
    assert(editorFieldAnnotation({ ...base, fieldType: "radio" }).field.flags & (1 << 14), "authored radio groups match native no-toggle-off behavior");
    assert.throws(() => validateEditorFieldObject({ ...base, multiSelect: true }), /Only list/);
    assert.throws(() => validateEditorFieldObject({ ...base, fieldType: "checkbox", maxLength: 2, value: false }), /maximum length/);
    assert.throws(() => validateEditorFieldObject({ ...base, onValue: "Yes" }), /Only buttons/);
  } finally { services.dispose(); }
  console.log("Authored field text layout, clipping, automatic fonts, list appearances and native control metrics passed.");
} finally { hooks.deregister(); }
