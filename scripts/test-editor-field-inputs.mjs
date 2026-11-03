import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
class Element extends EventTarget {
  children = []; dataset = {}; style = {}; attributes = new Map(); hidden = false; value = ""; checked = false;
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
  setAttribute(name, value) { this.attributes.set(name, value); if (name === "aria-label") this.ownerDocument.controls.set(value, this); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter(option => option.selected); }
  getContext() { return null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  focus() { this.ownerDocument.activeElement = this; }
}
const makeDocument = () => {
  const document = { controls: new Map(), createElement(tag) { return new Element(tag, document); }, createTextNode(text) { return { textContent: text }; } };
  document.body = new Element("body", document); return document;
};
try {
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const { NativePdfAnnotationMetadataRegistry } = await import("../src/pdf/nativeAnnotations.ts");
  const { createNativeOptionalContentRegistry } = await import("../src/pdf/nativeOptionalContent.ts");
  const { validateAnnotations } = await import("../src/annotationData.ts");
  const { createEditorFieldControl } = await import("../src/editorFormControls.ts");
  const { showEditorFieldDialog, parseEditorFieldOptions } = await import("../src/editorFieldUi.ts");
  const kinds = ["text", "number", "date", "email", "tel", "url", "FutureInput"];
  const source = await NativePdfDocument.open({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 11 0 R] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv 4 0 R >> >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Annots [5 0 R 6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 11 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...kinds.map((type, index) => `<< /Type /Annot /Subtype /Widget /P 3 0 R /Rect [10 ${20 + index * 30} 200 ${40 + index * 30}] /FT /Tx /T (Field${index}) /Ff 2 /F 4 /HEPRInputType /${type} /V () >>`)
  ].map((body, index) => ({ number: index + 1, body })) }) });
  try {
    const forms = new NativePdfFormAppearanceRegistry(source), optional = createNativeOptionalContentRegistry(source);
    const ordinary = await new NativePdfAnnotationMetadataRegistry(source, forms, optional, () => {}).getPageAnnotations(0);
    assert(ordinary.every(annotation => annotation.field.inputType === undefined), "viewing keeps editor-only typing discovery lazy");
    const annotations = await new NativePdfAnnotationMetadataRegistry(source, forms, optional, () => {}, true).getPageAnnotations(0);
    assert.deepEqual(annotations.map(annotation => annotation.field.inputType), [...kinds.slice(0, -1), undefined]);
    validateAnnotations(annotations, { sourcePageIndex: 0, conditionCount: 0 });
    const invalid = structuredClone(annotations); invalid[0].field.inputType = "script";
    assert.throws(() => validateAnnotations(invalid, { sourcePageIndex: 0, conditionCount: 0 }), /Invalid/);
    const document = makeDocument(), values = [];
    for (let index = 0; index < 6; index++) {
      const control = createEditorFieldControl(document, { ...annotations[index], pageIndex: 0 }, undefined, value => values.push(value));
      assert.equal(control.type, kinds[index]); assert(control.required);
      assert.equal(control.getAttribute("aria-label"), `Field${index}`);
      if (control.type === "number") { assert.equal(control.step, "any"); assert.equal(control.inputMode, "decimal"); control.value = "-12.5"; }
      else if (control.type === "date") control.value = "2026-11-02";
      else control.value = "Text";
      control.dispatchEvent(new Event("change")); assert.equal(values.at(-1), control.value);
    }
    const readOnly = { ...annotations[0], field: { ...annotations[0].field, flags: 1 }, pageIndex: 0 };
    assert.equal(createEditorFieldControl(document, readOnly, "", () => {}), null);
    const multiline = createEditorFieldControl(document, { ...annotations[0], pageIndex: 0, field: { ...annotations[0].field, flags: 4096, maxLength: 20 } }, "a\nb", () => {});
    assert.equal(multiline.tagName, "TEXTAREA"); assert.equal(multiline.maxLength, 20); assert.equal(multiline.value, "a\nb");
    const button = createEditorFieldControl(document, { ...annotations[0], pageIndex: 0, field: { ...annotations[0].field,
      type: "Btn", flags: 0, textStyle: { fontFamily: "Liberation Sans", fontSize: 12, fontWeight: 400, fontStyle: "normal", color: [1, 0, 0], ascent: .8, descent: -.2 } } }, true, () => {});
    assert.match(decodeURIComponent(button.style.backgroundImage), /stroke="rgb\(255,0,0\)"/, "colored authored button previews retain the field color");
  } finally { await source.close(); }

  assert.deepEqual(parseEditorFieldOptions("one | First\ntwo\n\nthree | Third | extra"), [
    { value: "one", label: "First" }, { value: "two", label: "two" }, { value: "three", label: "Third | extra" }
  ]);
  assert.throws(() => parseEditorFieldOptions("one\none"), /different/);
  {
    const document = makeDocument(), applied = []; let closed = 0;
    const dialog = showEditorFieldDialog(document, { name: "Amount", fieldType: "number", value: "12.5", defaultValue: "0" }, value => applied.push(value), () => closed++);
    const control = name => document.controls.get(name);
    assert.equal(control("Current value").type, "number"); assert.equal(control("Current value").step, "any");
    assert.equal(dialog.hasDraftChanges(), false); control("Current value").value = "24.75";
    assert(dialog.hasDraftChanges()); assert(dialog.apply());
    assert.equal(applied[0].fieldType, "number"); assert.equal(applied[0].value, "24.75"); assert.equal(applied[0].defaultValue, "0");
    assert.equal(applied[0].kind, "field"); assert.equal(applied[0].x, undefined); assert.equal(closed, 1);
    dialog.close(); assert.equal(closed, 1); assert.equal(document.body.children.length, 0);
  }
  {
    const document = makeDocument(), applied = [];
    const dialog = showEditorFieldDialog(document, { id: "field:existing", name: "Notes", fieldType: "text", multiline: true, value: "First\nSecond" }, value => applied.push(value), () => {});
    const current = document.controls.get("Current value (one selected value per line for lists)");
    assert.equal(current.parentElement.hidden, false); assert.equal(current.value, "First\nSecond");
    assert(dialog.apply()); assert.equal(applied[0].value, "First\nSecond"); assert.equal(applied[0].multiline, true);
  }
  {
    const document = makeDocument(), applied = [];
    const dialog = showEditorFieldDialog(document, { name: "Choice", fieldType: "radio", onValue: "A", value: "B", defaultValue: "B" }, value => applied.push(value), () => {});
    assert(dialog.apply()); assert.equal(applied[0].value, "B", "editing an unselected radio preserves its group's selected value");
    assert.equal(applied[0].defaultValue, "B");
  }
  {
    const document = makeDocument(), applied = [], dialog = showEditorFieldDialog(document, { name: "Choice", fieldType: "dropdown" }, value => applied.push(value), () => {});
    assert.equal(dialog.apply(), false); assert.equal(applied.length, 0); assert.equal(document.body.children.length, 1, "invalid settings keep the dialog available for correction");
    document.controls.get("Options (one per line; value | label)").value = "one | First\ntwo | Second";
    document.controls.get("Current value").value = "two"; assert(dialog.apply());
    assert.equal(applied[0].options[1].label, "Second"); assert.equal(applied[0].value, "two");
  }
  console.log("Authored form input metadata, native typed controls and shared field properties dialog passed.");
} finally { hooks.deregister(); }
