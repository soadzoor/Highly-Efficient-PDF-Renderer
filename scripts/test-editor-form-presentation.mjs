import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
class Element extends EventTarget {
  children = []; dataset = {}; style = {}; storedValue = ""; selected = false; checked = false; multiple = false;
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; }
  setAttribute() {}
  append(...children) {
    for (const child of children) {
      if (this.tagName === "SELECT" && !this.multiple && child.selected) for (const option of this.children) option.selected = false;
      this.children.push(child);
    }
    if (this.tagName === "SELECT" && !this.multiple && (!this.size || this.size === 1) && !this.children.some(option => option.selected)) this.children[0].selected = true;
  }
  get value() { return this.tagName === "SELECT" ? this.selectedOptions[0]?.value ?? "" : this.storedValue; }
  set value(value) {
    if (this.tagName === "SELECT") {
      let selected = false;
      for (const option of this.children) { option.selected = !selected && option.value === value; selected ||= option.selected; }
    } else this.storedValue = value;
  }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter(option => option.selected); }
}
const measured = [], context = { font: "", measureText(text) {
  measured.push(text); return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)[1]) * .5 };
} };
const document = { createElement(tag) { return tag === "canvas" ? { getContext: () => context } : new Element(tag, document); } };
const checkAppearance = "0 0 0 RG 1.25 w 2 7 m 5 3 l 12 12 l S";

try {
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const { NativePdfAnnotationMetadataRegistry } = await import("../src/pdf/nativeAnnotations.ts");
  const { createNativeOptionalContentRegistry } = await import("../src/pdf/nativeOptionalContent.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { createEditorFieldAppearanceReader } = await import("../src/editorFormAppearance.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorFieldControl, styleEditorFieldControl, setEditorFieldControlValue, updateEditorFieldControlAppearance } = await import("../src/editorFormControls.ts");
  const { editorFieldClientGeometry } = await import("../src/editorCoordinates.ts");
  const { getEditorAnnotationFrameTransform, getEditorAnnotationSource, editorTransformBounds } = await import("../src/editorScene.ts");
  const { validateAnnotations } = await import("../src/annotationData.ts");
  const { convertDeviceCmykToSrgb } = await import("../src/pdf/deviceCmyk.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const bytes = fixture(), original = bytes.slice(), loadAsset = async url => new Uint8Array(await readFile(url));
  const source = await NativePdfDocument.open({ kind: "bytes", bytes });
  const fonts = createEditorFontRegistry({ loadAsset }), diagnostics = [], resolver = createNodeBundledStandardFontResolver();
  let missingRequests = 0;
  try {
    const widgets = await new NativePdfFormAppearanceRegistry(source).listPageAnnotations(0);
    const reader = createEditorFieldAppearanceReader(source, fonts, (...args) => { missingRequests++; return resolver(...args); }, diagnostic => diagnostics.push(diagnostic));
    const styles = new Map();
    for (const widget of widgets) styles.set(widget.widget.fullyQualifiedName, await reader.read(widget));
    assert.equal(styles.get("Fixed").fontSize, 10); assert.equal(styles.get("Auto").fontSize, 0);
    assert.equal(styles.get("Fixed").fontFamily, "Times-Roman"); assert.equal(styles.get("Fixed").fontWeight, 400);
    assert.equal(styles.get("Fixed").fontStyle, "normal"); assert.deepEqual(styles.get("Fixed").color, [0, 0, 0]);
    assert.deepEqual(styles.get("Styled"), { fontFamily: "ABCDEF+Tiny", fontSize: 9.5, fontWeight: 700, fontStyle: "italic", color: [.2, .3, .4], ascent: .7, descent: -.2, contentInset: 1 });
    assert.equal(styles.get("Auto").contentInset, 2); assert.equal(styles.get("Borderless").contentInset, 1);
    const autoWidget = widgets.find(widget => widget.widget.fullyQualifiedName === "Auto");
    for (const [borderStyle, border, rectangle, expected] of [[undefined, undefined, undefined, 2],
      [new Map([["W", 0]]), undefined, undefined, 1], [new Map([["W", 10]]), undefined, [0, 0, 2, 3], 3],
      [new Map([["W", 5], ["S", { kind: "name", value: "Unknown" }]]), undefined, undefined, 1],
      [undefined, [0, 0, 3], undefined, 4]]) {
      const dictionary = new Map(autoWidget.dictionary); dictionary.delete("BS");
      if (borderStyle) dictionary.set("BS", borderStyle); if (border) dictionary.set("Border", border);
      assert.equal((await reader.read({ ...autoWidget, dictionary, rectangle: rectangle ?? autoWidget.rectangle })).contentInset, expected);
    }
    assert.deepEqual(styles.get("Cmyk").color, convertDeviceCmykToSrgb(0, .5, .7, .2));
    assert.equal(styles.get("Radio"), undefined); assert.equal(missingRequests, 1, "all Times-Roman field styles share one font-resolution cache");
    assert(fonts.list().some(font => font.family === "ABCDEF+Tiny" && Buffer.from(font.bytes).equals(Buffer.from(buildTinySfnt()))), "embedded font programs are registered unchanged");
    assert(diagnostics.some(diagnostic => diagnostic.code === "font.missing-substituted"));
    await assert.rejects(reader.read(widgets[0], AbortSignal.abort()), error => error.code === "aborted");
    const malformed = { ...widgets[0], widget: { ...widgets[0].widget, defaultAppearance: { kind: "string", bytes: new TextEncoder().encode("/TiRo nope Tf") } } };
    assert.equal(await reader.read(malformed), undefined); assert(diagnostics.some(diagnostic => diagnostic.code === "editor.field-font-approximated"));
  } finally { fonts.dispose(); await source.close(); }

  const parser = await openPdf({ kind: "bytes", bytes }), assetLoads = [];
  let editor, plain;
  const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: async url => { assetLoads.push(url.pathname); return loadAsset(url); } });
  try {
    plain = await parser.compileVectorPage(0, { optimization: "none" });
    assert(plain.annotations.every(annotation => !annotation.field?.textStyle), "ordinary View compilation does not discover or register editor typing styles");
    assert(plain.annotations.every(annotation => !annotation.field?.buttonMark), "ordinary View compilation does not read Widget mark captions");
    editor = await openEditorSession(plain, services.sessionOptions);
    const named = name => editor.sourceScene.annotations.find(annotation => annotation.field?.name === name);
    assert.equal(named("Fixed").field.textStyle.fontSize, 10); assert.equal(named("Auto").field.textStyle.fontSize, 0);
    assert.equal(assetLoads.length, 1, "public session preparation lazily loads only the shared Times face");
    assert(services.fonts.list().some(font => font.family === named("Styled").field.textStyle.fontFamily));
    const fixed = createEditorFieldControl(document, named("Fixed"), "A", () => {});
    assert.equal(fixed.style.fontSize, "10px"); assert.equal(fixed.style.fontWeight, "400"); assert.equal(fixed.style.fontStyle, "normal");
    assert.equal(fixed.style.fontFamily, '"Times-Roman"'); assert.equal(fixed.style.textAlign, "center"); assert.equal(fixed.style.fontSynthesis, "none");
    const styled = createEditorFieldControl(document, named("Styled"), "A", () => {});
    assert.equal(styled.style.fontSize, "9.5px"); assert.equal(styled.style.fontWeight, "700"); assert.equal(styled.style.fontStyle, "italic");
    assert.equal(styled.style.color, "rgb(51,77,102)");
    const auto = createEditorFieldControl(document, named("Auto"), "A", () => {}, { usePdfAppearance: true });
    assert.equal(auto.style.fontSize, "10px", "PDFium-style sizing fits a 14.173-point single-line field at10pt");
    const defaultBorder = structuredClone(named("Auto")); delete defaultBorder.border;
    assert.equal(createEditorFieldControl(document, defaultBorder, "A", () => {}).style.fontSize, "10px", "effective source insets survive incomplete annotation border metadata");
    delete defaultBorder.field.textStyle.contentInset;
    assert.equal(createEditorFieldControl(document, defaultBorder, "A", () => {}).style.fontSize, "12px", "legacy controls without border styling use a one-point content inset");
    defaultBorder.border = { width: 1 };
    assert.equal(createEditorFieldControl(document, defaultBorder, "A", () => {}).style.fontSize, "10px", "legacy controls honor a declared visible border width");
    defaultBorder.border = { width: 0 };
    assert.equal(createEditorFieldControl(document, defaultBorder, "A", () => {}).style.fontSize, "12px", "an explicitly borderless field retains its extra content space");
    const borderless = createEditorFieldControl(document, named("Borderless"), "A", () => {});
    assert.equal(borderless.style.padding, "1px"); assert.equal(borderless.style.fontSize, "10px", "borderless 500x13-point fields use the same10pt fit as native appearances");
    assert.equal(auto.dataset.pdfAppearance, "true");
    styleEditorFieldControl(auto, named("Auto"), '"active-font-face"');
    auto.value = "A".repeat(100); auto.dispatchEvent(new Event("input"));
    assert.equal(auto.style.fontSize, "4px", "typing longer text recomputes the discrete fitting size");
    setEditorFieldControlValue(auto, named("Auto"), "A"); assert.equal(auto.style.fontSize, "10px"); assert.equal(auto.style.fontFamily, '"active-font-face"');
    const multi = createEditorFieldControl(document, named("Multi"), "A", () => {});
    assert.equal(multi.tagName, "TEXTAREA"); assert.equal(multi.style.fontSize, "12px", "multiline auto size uses PDFium's12pt upper choice");
    const password = createEditorFieldControl(document, { ...named("Auto"), field: { ...named("Auto").field, flags: 8192 } }, "Secret", () => {});
    assert.equal(password.type, "password"); assert(measured.includes("\u2022".repeat(6)), "password fitting measures concealed characters");
    const choices = createEditorFieldControl(document, { ...named("Multi"), field: { ...named("Multi").field, type: "Ch", flags: 2097152,
      alignment: 2, options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] } }, ["b"], () => {});
    assert.equal(choices.multiple, true); assert.equal(choices.style.textAlign, "right"); assert.equal(choices.selectedOptions[0].value, "b");
    for (const [scale, matrix] of [[.25, [1, 0, 0, 1, 0, 0]], [3, [0, -2, 2, 0, 0, 200]]]) {
      const geometry = editorFieldClientGeometry(named("Fixed"), [{ pageIndex: 0, pdfToScene: matrix }], point => ({ x: point.x * scale, y: -point.y * scale }));
      assert(geometry); assert.equal(fixed.style.fontSize, "10px", "font sizes stay in PDF units while the field matrix applies zoom/rotation/UserUnit");
      assert.equal(Math.hypot(...geometry.transform.slice(0, 2)), scale * Math.hypot(matrix[0], matrix[1]));
    }
    const composedAxes = editorFieldClientGeometry(named("Fixed"), [{ pageIndex: 0, pdfToScene: [0, -2, 2, 0, 30, 400] }],
      point => ({ x: 50 + point.x * 2, y: 300 - point.y * 2 }), [1.5, .4, -.25, .8, 9, -13]);
    assert(composedAxes);
    for (const [actual, expected] of [[composedAxes.origin.x, 1073.038], [composedAxes.origin.y, -600.6768],
      ...composedAxes.transform.map((value, index) => [value, [1, 3.2, -6, 1.6, 0, 0][index]])]) {
      assert(Math.abs(actual - expected) < 1e-9, "editor transforms apply after page rotation/crop/UserUnit and before host projection");
    }
    const transformedEditor = await openEditorSession(plain, services.sessionOptions);
    try {
      const originalField = transformedEditor.sourceScene.annotations.find(annotation => annotation.field?.name === "Auto");
      const angle = Math.PI / 5, c = Math.cos(angle), s = Math.sin(angle), transform = [1.8 * c, 1.8 * s, -.7 * s, .7 * c, 20, -12];
      const project = point => ({ x: 50 + point.x * 2, y: 300 - point.y * 2 });
      const expected = editorFieldClientGeometry(originalField, transformedEditor.sourceScene.pdfPages, project, transform);
      assert(expected); assert.equal(expected.width, 70); assert(Math.abs(expected.height - 14.173) < 1e-8);
      transformedEditor.selectAnnotations([originalField.id]); transformedEditor.transformSelection(transform);
      for (const value of ["A", "B", "A"]) {
        transformedEditor.setFieldValue("Auto", value);
        const scene = await transformedEditor.getScene(), current = scene.annotations.find(annotation => annotation.id === originalField.id);
        const canonical = getEditorAnnotationSource(scene, originalField.id) ?? current;
        assert.deepEqual(canonical.pdfGeometry.rect, originalField.pdfGeometry.rect, "typing retains the original PDF field rectangle");
        assert.deepEqual(current.bounds, editorTransformBounds(originalField.bounds, transform));
        const geometry = editorFieldClientGeometry(canonical, scene.pdfPages, project, getEditorAnnotationFrameTransform(scene, originalField.id));
        assert.deepEqual(geometry, expected, "rotated, nonuniformly scaled fields keep their oriented frame across typing");
        const input = createEditorFieldControl(document, canonical, value, () => {});
        assert.equal(input.style.fontSize, "10px", "auto sizing uses native dimensions while the field matrix scales its appearance");
        assert.equal(input.style.padding, "2px");
      }
    } finally { transformedEditor.dispose(); }
    let committed;
    const radio = createEditorFieldControl(document, named("Radio"), "Off", value => committed = value, { usePdfAppearance: true });
    assert.equal(radio.type, "radio"); assert.equal(radio.name, "hepr-field-Radio"); assert.equal(radio.dataset.pdfAppearance, "true");
    assert.equal(named("Radio").field.buttonMark, "check"); assert.equal(radio.dataset.buttonMark, "check", "a /CA(4) radio uses the document's checkmark without changing group semantics");
    assert.equal(radio.style.backgroundImage, "none");
    radio.checked = true; radio.dispatchEvent(new Event("change")); assert.equal(committed, "Yes");
    const radioSvg = buttonSvg(radio);
    assert.match(radioSvg, /<path d="M/); assert.match(radioSvg, /stroke="#000"/); assert.doesNotMatch(radioSvg, /ellipse/);
    const css = await readFile(new URL("../src/editorUi.css", import.meta.url), "utf8");
    assert.match(css, /input\.hepr-editor-field\[type=radio\]\{[^}]*appearance:none/,
      "checkbox/radio previews never use browser-native blue marks");
    assert.match(css, /input\.hepr-editor-field\[data-pdf-appearance=true\]:not\(\[data-pdf-pending=true\]\)\[type=radio\]\{[^}]*background-image:none!important/,
      "PDF-backed radio controls hide the temporary SVG after the matching appearance is drawn");
    editor.setFieldValue("Radio", "Yes");
    const saved = await NativePdfDocument.open({ kind: "bytes", bytes: new Uint8Array(await (await editor.savePdf()).arrayBuffer()) });
    try {
      const registry = new NativePdfFormAppearanceRegistry(saved), field = (await registry.listPageAnnotations(0)).find(annotation => annotation.widget?.fullyQualifiedName === "Radio");
      const appearance = await registry.resolveAnnotationAppearance(field);
      assert.equal(field.appearanceState, "Yes"); assert.equal(field.widget.value.value, "Yes");
      assert.equal(new TextDecoder().decode(await registry.decodeFormContent(appearance.normalAppearance.form)), checkAppearance,
        "export retains the source checkmark for a radio-semantic widget with /MK /CA(4)");
    } finally { await saved.close(); }
    const annotations = editor.sourceScene.annotations, validation = { pageCount: 1, conditionCount: editor.sourceScene.optionalContent?.conditions.length ?? 0 };
    validateAnnotations(annotations, validation);
    for (const patch of [{ fontFamily: "" }, { fontSize: -1 }, { fontSize: NaN }, { fontWeight: 0 }, { fontStyle: "oblique" },
      { color: [0, 0] }, { color: [0, 2, 0] }, { ascent: -.2, descent: .8 }, { contentInset: -1 }, { contentInset: NaN }]) {
      const invalid = structuredClone(named("Fixed")); Object.assign(invalid.field.textStyle, patch);
      assert.throws(() => validateAnnotations([invalid], validation), /annotation metadata/);
    }
    const zeroInset = structuredClone(named("Fixed")); zeroInset.field.textStyle.contentInset = 0; validateAnnotations([zeroInset], validation);
  } finally { editor?.dispose(); services.dispose(); await parser.close(); }
  const styleOnly = structuredClone(plain);
  for (const annotation of styleOnly.annotations) if (annotation.field) {
    const { type, name, flags, value } = annotation.field;
    annotation.field = { type, name, flags, value, textStyle: { fontFamily: "Times-Roman", fontSize: 10, fontWeight: 400, fontStyle: "normal", color: [0, 0, 0], ascent: .8, descent: -.2 } };
  }
  const compact = await openEditorSession(styleOnly);
  try {
    const hepBytes = new Uint8Array(await (await compact.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" })).arrayBuffer());
    const reopened = await loadSceneFromHep(hepBytes);
    assert(reopened.annotations.every(annotation => !annotation.field?.textStyle), "HEP strips typing-only style metadata even when it is the only editor metadata");
    assert.equal(Buffer.from(hepBytes).indexOf(Buffer.from(buildTinySfnt())), -1, "HEP contains no embedded source font program");
    assert.equal(Buffer.from(hepBytes).indexOf(Buffer.from(bytes)), -1, "HEP contains no source PDF");
  } finally { compact.dispose(); }
  for (const [caption, expected] of [["4", "check"], ["l", "circle"], ["8", "cross"], ["u", "diamond"], ["n", "square"], ["H", "star"], ["constructor", undefined]]) {
    const source = await NativePdfDocument.open({ kind: "bytes", bytes: fixture(caption) });
    try {
      const forms = new NativePdfFormAppearanceRegistry(source), optional = await createNativeOptionalContentRegistry(source);
      const registry = new NativePdfAnnotationMetadataRegistry(source, forms, optional, () => {}, true);
      const annotation = (await registry.getPageAnnotations(0)).find(annotation => annotation.field?.name === "Radio");
      assert.equal(annotation.field.buttonMark, expected, `editor-only caption ${caption} discovery`);
    } finally { await source.close(); }
  }
  const markOnly = structuredClone(plain);
  for (const annotation of markOnly.annotations) if (annotation.field) {
    const { type, name, flags, value } = annotation.field; annotation.field = { type, name, flags, value, buttonMark: "check" };
  }
  const marked = await openEditorSession(markOnly);
  try {
    const bytes = new Uint8Array(await (await marked.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" })).arrayBuffer());
    const reopened = await loadSceneFromHep(bytes);
    assert(reopened.annotations.every(annotation => !annotation.field?.buttonMark), "HEP strips preview-only mark hints even when no other editing metadata exists");
  } finally { marked.dispose(); }
  const seed = structuredClone(plain.annotations.find(annotation => annotation.field?.type === "Tx"));
  seed.field.value = "Old";
  const painted = value => ({ ...seed, field: { ...seed.field, value } });
  for (const value of ["New", "", null]) {
    const control = createEditorFieldControl(document, seed, value, () => {}, { usePdfAppearance: true });
    assert.equal(control.value, value ?? "", "explicit null clears rather than falling back to the source value");
    control.selectionStart = control.selectionEnd = 0;
    updateEditorFieldControlAppearance(control, seed, true);
    assert.equal(control.dataset.pdfPending, "true", "a new or cleared value must cover old presented glyphs");
    updateEditorFieldControlAppearance(control, painted(value), true);
    assert.equal(control.dataset.pdfPending, undefined, "matching presented values hand paint back to the PDF");
    assert.equal(control.value, value ?? ""); assert.equal(control.selectionStart, 0); assert.equal(control.selectionEnd, 0);
    updateEditorFieldControlAppearance(control, seed, false);
    assert.equal(control.dataset.pdfAppearance, undefined); assert.equal(control.dataset.pdfPending, undefined, "controls without PDF paint remain naturally visible");
  }
  const originalControl = createEditorFieldControl(document, seed, undefined, () => {});
  assert.equal(originalControl.value, "Old", "undefined still uses the original field value after undo removes the override");
  for (const flags of [0, 4096]) for (const value of ["First\r\nSecond", "First\rSecond", "First\nSecond"]) {
    const annotation = { ...seed, field: { ...seed.field, flags, value } };
    const nativeValue = flags & 4096 ? value.replace(/\r\n?/g, "\n") : value.replace(/[\r\n]/g, "");
    const control = createEditorFieldControl(document, annotation, nativeValue, () => {}, { usePdfAppearance: true });
    updateEditorFieldControlAppearance(control, annotation, true);
    assert.equal(control.dataset.pdfPending, undefined, "native newline sanitization does not keep unchanged PDF fields pending forever");
    control.value += " New"; updateEditorFieldControlAppearance(control, annotation, true);
    assert.equal(control.dataset.pdfPending, "true", "newline normalization still detects newly edited text");
  }
  const rapid = createEditorFieldControl(document, seed, "B", () => {}, { usePdfAppearance: true });
  updateEditorFieldControlAppearance(rapid, seed, true); assert.equal(rapid.dataset.pdfPending, "true");
  rapid.value = "C"; rapid.selectionStart = 1;
  updateEditorFieldControlAppearance(rapid, painted("B"), true); assert.equal(rapid.dataset.pdfPending, "true", "an older B draw cannot expose itself over the C draft");
  updateEditorFieldControlAppearance(rapid, painted("C"), true); assert.equal(rapid.dataset.pdfPending, undefined);
  assert.equal(rapid.value, "C"); assert.equal(rapid.selectionStart, 1, "paint handoff preserves the focused caret");
  rapid.value = "Old"; updateEditorFieldControlAppearance(rapid, seed, true);
  assert.equal(rapid.dataset.pdfPending, undefined, "returning to an already presented value needs no new appearance");
  const choice = { ...seed, field: { ...seed.field, type: "Ch", flags: 2097152,
    options: [{ value: "A", label: "Alpha" }, { value: "B", label: "Beta" }, { value: "C", label: "Gamma" }], value: ["A"] } };
  const list = createEditorFieldControl(document, choice, ["B", "A"], () => {}, { usePdfAppearance: true });
  updateEditorFieldControlAppearance(list, choice, true); assert.equal(list.dataset.pdfPending, "true");
  updateEditorFieldControlAppearance(list, { ...choice, field: { ...choice.field, value: ["B", "A", "A"] } }, true);
  assert.equal(list.dataset.pdfPending, undefined, "multiple choices compare export-value sets rather than labels, order or duplicate values");
  const emptyList = createEditorFieldControl(document, choice, null, () => {});
  assert.equal(emptyList.selectedOptions.length, 0, "null clears a list instead of reselecting source values");
  const dropdown = { ...choice, field: { ...choice.field, flags: 131072, value: "A" } };
  const select = createEditorFieldControl(document, dropdown, "B", () => {}); setEditorFieldControlValue(select, dropdown, "B");
  updateEditorFieldControlAppearance(select, dropdown, true); assert.equal(select.dataset.pdfPending, "true");
  updateEditorFieldControlAppearance(select, { ...dropdown, field: { ...dropdown.field, value: "B" } }, true); assert.equal(select.dataset.pdfPending, undefined);
  for (const options of [dropdown.field.options, []]) for (const value of ["Unavailable", "", null]) {
    const annotation = { ...dropdown, field: { ...dropdown.field, options, value } };
    const control = createEditorFieldControl(document, annotation, undefined, () => {}, { usePdfAppearance: true });
    assert.equal(control.value, ""); assert.equal(control.selectedOptions.length, 0, "unrepresented source values must not default to the first option");
    updateEditorFieldControlAppearance(control, annotation, true);
    assert.equal(control.dataset.pdfPending, undefined, "an unavailable, empty or null source choice keeps its original PDF appearance");
  }
  for (const value of ["", null]) {
    const cleared = createEditorFieldControl(document, dropdown, value, () => {});
    assert.equal(cleared.value, ""); assert.equal(cleared.selectedOptions.length, 0, "explicit empty/null choices clear the browser's first-option default");
    updateEditorFieldControlAppearance(cleared, dropdown, true); assert.equal(cleared.dataset.pdfPending, "true");
    updateEditorFieldControlAppearance(cleared, { ...dropdown, field: { ...dropdown.field, value } }, true); assert.equal(cleared.dataset.pdfPending, undefined);
  }
  const combo = { ...dropdown, field: { ...dropdown.field, flags: 262144 } };
  const editableChoice = createEditorFieldControl(document, combo, null, () => {});
  assert.equal(editableChoice.value, "");
  updateEditorFieldControlAppearance(editableChoice, combo, true); assert.equal(editableChoice.dataset.pdfPending, "true");
  for (const flags of [0, 32768]) for (const onValue of ["A", "B"]) {
    const annotation = { ...seed, field: { name: "Shared", type: "Btn", flags, onValue, value: "A" } };
    const control = createEditorFieldControl(document, annotation, "B", () => {}, { usePdfAppearance: true });
    updateEditorFieldControlAppearance(control, annotation, true);
    assert.equal(control.dataset.pdfPending, "true", "each shared widget's checked state must cover its old mark");
    updateEditorFieldControlAppearance(control, { ...annotation, field: { ...annotation.field, value: "B" } }, true);
    assert.equal(control.dataset.pdfPending, undefined); assert.equal(control.checked, onValue === "B");
    const cleared = createEditorFieldControl(document, annotation, null, () => {});
    assert.equal(cleared.checked, false, "null clears both checkbox and radio controls");
    updateEditorFieldControlAppearance(cleared, { ...annotation, field: { ...annotation.field, value: null } }, true);
    assert.equal(cleared.dataset.pdfPending, undefined);
  }
  for (const [mark, element] of [["check", "path"], ["cross", "path"], ["circle", "ellipse"], ["diamond", "path"], ["square", "rect"], ["star", "polygon"]]) {
    const annotation = { ...seed, pdfGeometry: { rect: [0, 0, 20, 16] }, border: { width: 1 },
      field: { name: "Mark", type: "Btn", flags: 0, onValue: "Yes", value: "Off", buttonMark: mark } };
    const control = createEditorFieldControl(document, annotation, "Yes", () => {}), svg = buttonSvg(control);
    assert.match(svg, new RegExp(`<${element} `)); assert.match(svg, /viewBox="0 0 20 16"/); assert.match(svg, /#000/);
    assert.equal(control.dataset.buttonMark, mark);
    if (mark === "check") {
      assert.match(svg, /stroke-width="1\.6"/, "check stroke matches native synthesis's tenth of the shorter edge");
      assert.match(svg, /M2\.88 /, "check inset matches native synthesis's 18 percent or border-plus-one rule");
    }
    setEditorFieldControlValue(control, annotation, "Off"); assert.equal(control.style.backgroundImage, "none");
    control.checked = true; control.dispatchEvent(new Event("input")); assert.equal(control.style.backgroundImage, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  for (const flags of [0, 32768]) {
    const annotation = { ...seed, field: { name: "Default mark", type: "Btn", flags, onValue: "Yes" } };
    const control = createEditorFieldControl(document, annotation, true, () => {});
    assert.equal(control.dataset.buttonMark, flags ? "circle" : "check", "buttons without caption hints use compact PDF-like default marks");
    assert.match(buttonSvg(control), flags ? /<ellipse / : /<path /);
  }
  const invalidMark = structuredClone(seed); invalidMark.field.buttonMark = "triangle";
  assert.throws(() => validateAnnotations([invalidMark], { pageCount: 1, conditionCount: plain.optionalContent?.conditions.length ?? 0 }), /annotation metadata/);
  assert.deepEqual(bytes, original);
  console.log("Form presentation: source fonts/styles, PDFium auto sizes, transformed accessible controls, source radio checks and compact HEP passed.");
} finally { hooks.deregister(); }

function buttonSvg(control) {
  const match = /^url\("data:image\/svg\+xml,(.*)"\)$/.exec(control.style.backgroundImage);
  assert(match, "checked controls expose an inline vector preview"); return decodeURIComponent(match[1]);
}

function fixture(caption = "4") {
  const text = (name, rect, extra = "") => `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /V () /Rect [${rect}] /AP << /N 9 0 R >> ${extra} >>`;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 11 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 200] /Contents 4 0 R /Annots [12 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R 18 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "1 1 1 rg 0 0 200 200 re f") },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>" },
    { number: 6, body: "<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 7 0 R >>" },
    { number: 7, body: "<< /Type /FontDescriptor /FontName /ABCDEF+Tiny /FontWeight 700 /Flags 64 /FontBBox [0 -200 1000 800] /Ascent 700 /Descent -200 /ItalicAngle -12 /FontFile2 8 0 R >>" },
    { number: 8, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "") },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 14.173 14.173] /Resources << >>", checkAppearance) },
    { number: 11, body: "<< /Fields [12 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R 18 0 R] /NeedAppearances false /DR << /Font << /TiRo 5 0 R /Emb 6 0 R >> >> /DA (/TiRo 10 Tf 0 g) >>" },
    { number: 12, body: text("Fixed", "10 170 80 184.173", "/Q 1 /BS << /W 1 >> /MK << /BC [0] >>") },
    { number: 13, body: text("Auto", "10 140 80 154.173", "/DA (/TiRo 0 Tf 0 g) /BS << /W 1 >> /MK << /BC [0] >>") },
    { number: 14, body: text("Styled", "10 110 80 130", "/DA (/Emb 9.5 Tf .2 .3 .4 rg)") },
    { number: 15, body: text("Cmyk", "10 80 80 100", "/DA (/TiRo 7 Tf 0 .5 .7 .2 k)") },
    { number: 16, body: text("Multi", "10 30 80 67.49", "/Ff 4096 /DA (/TiRo 0 Tf 0 g) /BS << /W 1 >> /MK << /BC [0] >>") },
    { number: 17, body: `<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 49152 /T (Radio) /V /Off /AS /Off /Rect [100 20 114.173 34.173] /MK << /CA (${caption}) >> /AP << /N << /Off 9 0 R /Yes 10 0 R >> >> >>` },
    { number: 18, body: text("Borderless", "0 0 500 13", "/DA (/TiRo 0 Tf 0 g)") }
  ] });
}
