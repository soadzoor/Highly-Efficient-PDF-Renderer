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
  children = []; dataset = {}; style = {}; value = ""; selected = false; checked = false; multiple = false;
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; }
  setAttribute() {}
  append(...children) { this.children.push(...children); }
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
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { createEditorFieldAppearanceReader } = await import("../src/editorFormAppearance.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorFieldControl, styleEditorFieldControl, setEditorFieldControlValue } = await import("../src/editorFormControls.ts");
  const { editorFieldClientGeometry } = await import("../src/editorCoordinates.ts");
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
    let committed;
    const radio = createEditorFieldControl(document, named("Radio"), "Off", value => committed = value, { usePdfAppearance: true });
    assert.equal(radio.type, "radio"); assert.equal(radio.name, "hepr-field-Radio"); assert.equal(radio.dataset.pdfAppearance, "true");
    radio.checked = true; radio.dispatchEvent(new Event("change")); assert.equal(committed, "Yes");
    const css = await readFile(new URL("../src/editorUi.css", import.meta.url), "utf8");
    assert.match(css, /input\.hepr-editor-field\[data-pdf-appearance=true\]\[type=radio\]\{[^}]*appearance:none/,
      "PDF-backed radio controls leave their stored check glyph visible instead of adding a native radio dot");
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
  assert.deepEqual(bytes, original);
  console.log("Form presentation: source fonts/styles, PDFium auto sizes, transformed accessible controls, source radio checks and compact HEP passed.");
} finally { hooks.deregister(); }

function fixture() {
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
    { number: 17, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 49152 /T (Radio) /V /Off /AS /Off /Rect [100 20 114.173 34.173] /MK << /CA (4) >> /AP << /N << /Off 9 0 R /Yes 10 0 R >> >> >>" },
    { number: 18, body: text("Borderless", "0 0 500 13", "/DA (/TiRo 0 Tf 0 g)") }
  ] });
}
