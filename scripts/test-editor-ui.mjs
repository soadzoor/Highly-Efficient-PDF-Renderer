import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });

class Element extends EventTarget {
  nodeType = 1; children = []; childNodes = []; attributes = new Map(); dataset = {}; style = {}; value = "";
  checked = false; selected = false; multiple = false; textContent = "";
  constructor(tagName, style = {}) { super(); this.tagName = tagName.toUpperCase(); this.computedStyle = { fontFamily: "\"font-a\"", fontSize: "12px", fontWeight: "400", fontStyle: "normal", color: "rgb(0, 0, 0)", textDecorationLine: "none", ...style }; }
  append(...children) { for (const item of children) { const previous = this.childNodes.at(-1); if (previous) previous.nextSibling = item; item.parentElement = this; this.childNodes.push(item); if (item.nodeType === 1) this.children.push(item); } }
  setAttribute(name, value) { this.attributes.set(name, value); }
  closest(selector) { if (selector.split(",").some(item => item.toUpperCase() === this.tagName)) return this; return this.parentElement?.closest(selector) ?? null; }
  get selectedOptions() { return this.children.filter(child => child.selected); }
  get options() { return this.children; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.removed = true; }
  replaceChildren(...children) { this.children = []; this.childNodes = []; this.append(...children); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tagName === selector.toUpperCase() ? [child] : []), ...child.querySelectorAll(selector)]); }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}
const text = value => ({ nodeType: 3, textContent: value });
const document = { createElement: tag => new Element(tag) };
const annotation = (type, extra = {}) => ({ id: "widget:1", subtype: "Widget", visibleInDefaultView: true,
  tooltip: "Field label", field: { name: "customer", type, flags: 0, ...extra } });

try {
  const { createEditorFieldControl, createEditorFieldOptions, setEditorFieldControlValue, editorFieldDraftSignature, hasPendingEditorFields, flushEditorFieldDrafts } = await import("../src/editorFormControls.ts");
  const { readRichTextRuns, normalizeEditorTextColor, commitEditorText, hasPendingEditorTextChanges } = await import("../src/editorRichText.ts");
  const { validateEditorOpacity, editorStyledSelection, applyEditorOpacity } = await import("../src/editorProperties.ts");
  const { LoadProgressReporter } = await import("../src/loadProgress.ts");
  const { appendEditorInkSamples, editorInkCaptureTolerance } = await import("../src/editorInkCapture.ts");
  const { createEditorPdfProtectionState, editorPdfPasswordDraft, showEditorPdfPasswordDialog } = await import("../src/editorPdfProtectionUi.ts");
  const { parseEditorPageRange, insertEditorPdfFiles, showEditorPagesDialog } = await import("../src/editorPagesUi.ts");
  assert.deepEqual(parseEditorPageRange("3, 1-2, 2", 3), [0, 1, 2]);
  for (const range of ["", "0", "4", "2-1", "1.5", "1,,2"]) assert.throws(() => parseEditorPageRange(range, 3));
  const pageModals = [], pageDocument = { createElement: tag => new Element(tag), body: { append: dialog => pageModals.push(dialog) } };
  let pageModels = Array.from({ length: 3 }, () => ({ width: 600, height: 800, rotation: 0 }));
  const pageOperations = []; let finishRotation, cancelPageOperations = 0, pageDialogClosed = 0;
  const pageDialog = showEditorPagesDialog(pageDocument, { getPages: () => pageModels,
    rotate(indices, degrees) { pageOperations.push(["rotate", indices, degrees]); return new Promise(resolve => { finishRotation = resolve; }); },
    async remove(indices) { pageOperations.push(["remove", indices]); pageModels = pageModels.filter((_, i) => !indices.includes(i)); },
    async insert(files, at) { pageOperations.push(["insert", files.map(file => file.name), at]); },
    cancel() { cancelPageOperations++; }, onError: error => assert.fail(String(error)), onClose() { pageDialogClosed++; } });
  const pageModal = pageModals[0], pageList = pageModal.children[6], pageRange = pageModal.children[2].children[0];
  assert.equal(pageList.children.length, 3); assert.equal(pageList.children[0].children[0].checked, true);
  pageRange.value = "2-3"; pageModal.children[3].click(); assert.equal(pageList.children[1].children[0].checked, true);
  pageModal.children[7].children[1].click(); assert.deepEqual(pageOperations[0], ["rotate", [1, 2], 90]);
  assert.equal(pageDialog.isBusy(), true); assert.equal(pageModal.children[7].children[0].disabled, true, "page mutation controls are blocked during structural work");
  pageModal.children[10].click(); assert.equal(cancelPageOperations, 1, "page dialog exposes the active operation's cancellation");
  pageDialog.setWarnings(["Imported document bookmarks were not merged."]); pageDialog.setStatus("Updating pages… 75%");
  finishRotation(); await new Promise(resolve => setImmediate(resolve)); assert.equal(pageDialog.isBusy(), false);
  assert.equal(pageModal.children[9].textContent, "Pages updated. Imported document bookmarks were not merged.", "actual page-operation warnings survive progress and success status updates");
  pageModal.children[4].click(); assert.equal(pageModal.children[7].children[3].disabled, true, "removing every page is unavailable");
  pageRange.value = "2"; pageModal.children[3].click(); pageModal.children[7].children[3].click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(pageList.children.length, 2, "page lists refresh after removal");
  pageModels = Array.from({ length: 4 }, () => ({ width: 800, height: 600 })); pageDialog.refresh();
  assert.equal(pageList.children.length, 4, "page lists can refresh after undo or redo");
  const insertion = pageModal.children[8], insertionPosition = insertion.children[0], insertionPage = insertion.children[1], insertionFiles = insertion.children[3];
  assert.equal(insertionPage.disabled, true); insertionPosition.value = "before"; insertionPosition.dispatchEvent(new Event("change"));
  insertionPage.value = "2"; insertionFiles.files = [new File(["first"], "first.pdf"), new File(["second"], "second.pdf")];
  insertionFiles.dispatchEvent(new Event("change")); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pageOperations.at(-1), ["insert", ["first.pdf", "second.pdf"], 1]); assert.equal(insertionFiles.multiple, true);
  insertionPosition.value = "after"; insertionPage.value = "3"; insertionFiles.dispatchEvent(new Event("change")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(pageOperations.at(-1)[2], 3); insertionPosition.value = "end"; insertionFiles.dispatchEvent(new Event("change")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(pageOperations.at(-1)[2], 4, "insertion positions are converted from visible page numbers to zero-based boundaries");
  pageDialog.close(); assert.equal(pageDialogClosed, 1);
  const importAttempts = [], importPrompts = [], importWarnings = []; let importedCount = 2;
  const importSession = { getPages: () => Array.from({ length: importedCount }), async insertPdf(bytes, options) {
    importAttempts.push({ at: options.at, password: options.password, value: bytes[0] });
    if (bytes[0] === 1 && options.password !== "right") throw Object.assign(new Error("Encrypted fixture"), { code: "encrypted", details: { reason: options.password ? "password-incorrect" : "password-required" } });
    if (bytes[0] === 2) options.onDiagnostic?.({ code: "pages.bookmarks-not-merged", severity: "warning", message: "Imported document bookmarks were not merged." });
    importedCount += bytes[0];
  } };
  const importedFiles = [new File([Uint8Array.of(1)], "locked.pdf"), new File([Uint8Array.of(2)], "other.pdf")];
  await insertEditorPdfFiles(importSession, importedFiles, 1, { signal: new AbortController().signal,
    onDiagnostic: value => importWarnings.push(value),
    requestPassword: async prompt => { importPrompts.push(prompt); return importPrompts.length === 1 ? "wrong" : "right"; } });
  assert.deepEqual(importAttempts.map(item => item.at), [1, 1, 1, 2]); assert.deepEqual(importPrompts.map(item => item.retry), [false, true]);
  assert.equal(importAttempts.at(-1).password, undefined, "an inserted document's password is never reused for the next PDF");
  assert.equal(importWarnings[0].message, "other.pdf: Imported document bookmarks were not merged.", "native import diagnostics carry the filename to the stock UI");
  importedCount = 2; await assert.rejects(insertEditorPdfFiles(importSession, importedFiles, 0, { signal: new AbortController().signal, requestPassword: async () => null }), { name: "AbortError" });
  assert.equal(importedCount, 2, "cancelling an encrypted import leaves that file uninserted");
  await assert.rejects(insertEditorPdfFiles(importSession, [...importedFiles].reverse(), 0, { signal: new AbortController().signal, requestPassword: async () => null }), { name: "AbortError" });
  assert.equal(importedCount, 4, "cancelling a later file preserves earlier completed imports");
  const protectionState = createEditorPdfProtectionState();
  assert.equal(protectionState.hasChanges(), false); assert.deepEqual(protectionState.get(), { mode: "preserve" });
  protectionState.set({ mode: "remove" }); assert.equal(protectionState.hasChanges(), true);
  protectionState.set({ mode: "preserve" }); assert.equal(protectionState.hasChanges(), false, "reverting PDF protection clears only its own pending changes");
  protectionState.set({ mode: "password", password: "test password" }); const exportedProtection = protectionState.get();
  protectionState.set({ mode: "remove" }); protectionState.markSaved(exportedProtection);
  assert.equal(protectionState.hasChanges(), true, "an older async PDF export cannot clear newer protection settings");
  protectionState.set(exportedProtection); assert.equal(protectionState.hasChanges(), false);
  const returnedProtection = protectionState.get(); returnedProtection.password = "changed copy";
  assert.equal(protectionState.get().password, "test password", "export settings are snapshots");
  assert.throws(() => editorPdfPasswordDraft("password", "", ""), /cannot be empty/);
  assert.throws(() => editorPdfPasswordDraft("password", "one", "two"), /do not match/);
  assert.throws(() => editorPdfPasswordDraft("password", "é", "e\u0301"), /do not match/, "confirmation matches raw input before Unicode normalization");
  assert.deepEqual(editorPdfPasswordDraft("password", "  exact spaces  ", "  exact spaces  "), { mode: "password", password: "  exact spaces  " });
  for (const value of ["a".repeat(128), "é".repeat(64), "🙂".repeat(32), "ﬃ".repeat(43)]) {
    assert.throws(() => editorPdfPasswordDraft("password", value, value), /127 UTF-8 bytes/, "Apply shares Save's normalized byte limit");
  }
  for (const value of ["a".repeat(127), "é".repeat(63), "🙂".repeat(31), "Ａ".repeat(127), " "]) {
    assert.equal(editorPdfPasswordDraft("password", value, value).password, value, "valid Unicode and whitespace stay unchanged until encryption normalization");
  }
  const passwordModals = [], passwordDocument = { createElement: tag => new Element(tag), body: { append: dialog => passwordModals.push(dialog) } };
  const appliedProtection = []; let passwordDialogCloses = 0;
  const passwordModal = showEditorPdfPasswordDialog(passwordDocument, { mode: "preserve" }, value => appliedProtection.push(value), () => passwordDialogCloses++);
  const modalElement = passwordModals[0], modeInput = modalElement.children[2].children[0], passwordFields = modalElement.children[3];
  const passwordInput = passwordFields.children[0].children[0], confirmationInput = passwordFields.children[1].children[0];
  assert.equal(passwordModal.hasDraftChanges(), false); assert.equal(passwordFields.hidden, true);
  assert.equal(passwordInput.type, "password"); assert.equal(confirmationInput.type, "password");
  assert.match(modalElement.children[1].textContent, /HEP files remain unencrypted/);
  modeInput.value = "password"; modeInput.dispatchEvent(new Event("change")); assert.equal(passwordFields.hidden, false);
  passwordInput.value = "new test password"; confirmationInput.value = "different";
  assert.equal(passwordModal.hasDraftChanges(), true); assert.equal(passwordModal.apply(), false); assert.equal(appliedProtection.length, 0);
  passwordInput.value = confirmationInput.value = "a".repeat(128);
  assert.equal(passwordModal.apply(), false); assert.equal(appliedProtection.length, 0, "oversized passwords cannot be applied to export settings");
  assert.match(modalElement.children[5].textContent, /127 UTF-8 bytes/);
  passwordInput.value = "new test password";
  confirmationInput.value = passwordInput.value; assert.equal(passwordModal.apply(), true);
  assert.deepEqual(appliedProtection, [{ mode: "password", password: "new test password" }]);
  assert.equal(passwordInput.value, ""); assert.equal(confirmationInput.value, ""); assert.equal(modalElement.removed, true); assert.equal(passwordDialogCloses, 1);
  const canceledPasswordModal = showEditorPdfPasswordDialog(passwordDocument, exportedProtection, value => appliedProtection.push(value), () => passwordDialogCloses++);
  assert.equal(canceledPasswordModal.hasDraftChanges(), false, "opening unchanged protection settings is clean");
  canceledPasswordModal.close(); assert.equal(appliedProtection.length, 1, "Cancel does not change the active export policy");
  protectionState.dispose(); assert.equal(protectionState.hasChanges(), false); assert.deepEqual(protectionState.get(), { mode: "preserve" });
  assert.equal(validateEditorOpacity(0), 0); assert.equal(validateEditorOpacity(1), 1); assert.equal(validateEditorOpacity(.375), .375);
  for (const value of [-.1, 1.1, NaN, Infinity]) assert.throws(() => validateEditorOpacity(value), /from 0 through 1/);
  const opacityModels = Object.fromEntries(["text", "shape", "ink", "signature", "image"].map(kind => [kind, { id: kind, kind, opacity: 1 }]));
  opacityModels.source = { id: "source", kind: "source" };
  opacityModels.group = { id: "group", kind: "group", children: Object.keys(opacityModels) };
  let opacityTransactions = 0;
  const opacitySession = { getSelection: () => ["group", "text"], getObject: id => opacityModels[id],
    transaction(_label, apply) { opacityTransactions++; apply(); }, updateObject(id, patch) { Object.assign(opacityModels[id], patch); } };
  assert.deepEqual(editorStyledSelection(opacitySession), ["text", "shape", "ink", "signature", "image"]);
  applyEditorOpacity(opacitySession, .375);
  assert.equal(opacityTransactions, 1); assert(Object.values(opacityModels).filter(object => object.kind !== "source" && object.kind !== "group").every(object => object.opacity === .375));
  assert.equal(opacityModels.source.opacity, undefined, "original source appearance remains transform-only");
  assert.equal(normalizeEditorTextColor("rgb(255, 0, 0)"), "#ff0000");
  assert.equal(normalizeEditorTextColor("rgb(100% 50% 0%)"), "#ff8000");
  const { editorPageAtPoint, remapEditorPagePoint, pickEditorMetadataAnnotation, transformEditorAnnotationText, editorBoundsClickHit, editorFieldClientGeometry } = await import("../src/editorCoordinates.ts");
  const widget = { ...annotation("Tx"), pageIndex: 3, pdfGeometry: { rect: [20, 30, 60, 50] } };
  // Crop [10,20,110,220], UserUnit 2, composed page origin [30,40].
  for (const [rotation, pdfToScene, origin, basis, opposite] of [
    [0, [2, 0, 0, 2, 10, 0], { x: 175, y: 750 }, [3, 0, 0, 3, 0, 0], { x: 295, y: 810 }],
    [90, [0, -2, 2, 0, -10, 260], { x: 235, y: 570 }, [0, 3, -3, 0, 0, 0], { x: 175, y: 690 }],
    [180, [-2, 0, 0, -2, 250, 480], { x: 415, y: 330 }, [-3, 0, 0, -3, 0, 0], { x: 295, y: 270 }],
    [270, [0, 2, -2, 0, 470, 20], { x: 655, y: 810 }, [0, -3, 3, 0, 0, 0], { x: 715, y: 690 }]
  ]) {
    const geometry = editorFieldClientGeometry(widget, [{ pageIndex: 0, pdfToScene: [1, 0, 0, 1, 0, 0] }, { pageIndex: 3, pdfToScene }], (point, pageIndex) => {
      assert.equal(pageIndex, 3); return { x: 100 + point.x * 1.5, y: 900 - point.y * 1.5 };
    });
    assert.deepEqual(geometry, { origin, width: 40, height: 20, transform: basis }, `widget axes retain ${rotation}-degree page rotation, crop, UserUnit and host zoom`);
    assert.deepEqual({ x: geometry.origin.x + geometry.width * basis[0] + geometry.height * basis[2],
      y: geometry.origin.y + geometry.width * basis[1] + geometry.height * basis[3] }, opposite);
  }
  const mappedWidgetPages = [{ pageIndex: 3, pdfToScene: [2, 0, 0, 2, 10, 0] }];
  const skewedWidget = editorFieldClientGeometry(widget, mappedWidgetPages, point => ({ x: 2 * point.x + .25 * point.y + 5, y: .5 * point.x - 3 * point.y + 7 }));
  assert.deepEqual(skewedWidget, { origin: { x: 130, y: -268 }, width: 40, height: 20, transform: [4, 1, -.5, 6, 0, 0] }, "field axes follow the complete host projection");
  assert.equal(editorFieldClientGeometry(widget, undefined, point => point), null, "legacy metadata uses the axis-bounds fallback");
  assert.equal(editorFieldClientGeometry({ ...widget, pdfGeometry: undefined }, mappedWidgetPages, point => point), null);
  assert.equal(editorFieldClientGeometry({ ...widget, pdfGeometry: { rect: [0, 0, NaN, 1] } }, mappedWidgetPages, point => point), null);
  assert.equal(editorFieldClientGeometry({ ...widget, pdfGeometry: { rect: [0, 0, 0, 1] } }, mappedWidgetPages, point => point), null);
  assert.equal(editorFieldClientGeometry(widget, [{ pageIndex: 3, pdfToScene: [0, 0, 0, 0, 0, 0] }], point => point), null);
  assert.equal(editorFieldClientGeometry(widget, mappedWidgetPages, () => null), null);
  assert.equal(editorFieldClientGeometry(widget, mappedWidgetPages, () => ({ x: Infinity, y: 0 })), null);
  for (const scale of [.25, 1, 8]) {
    const project = point => ({ x: point.x * scale + 100, y: point.y * scale + 50 });
    const horizontal = { minX: 10, minY: 20, maxX: 90, maxY: 20 }, vertical = { minX: 20, minY: 10, maxX: 20, maxY: 90 };
    assert.equal(editorBoundsClickHit(horizontal, { x: 50, y: 20 + 3.5 / scale }, { x: 50 * scale + 100, y: 20 * scale + 53.5 }, project), true, `horizontal hairline has a CSS-pixel tolerance at scale ${scale}`);
    assert.equal(editorBoundsClickHit(horizontal, { x: 50, y: 20 + 4.5 / scale }, { x: 50 * scale + 100, y: 20 * scale + 54.5 }, project), false);
    assert.equal(editorBoundsClickHit(vertical, { x: 20 + 3.5 / scale, y: 50 }, { x: 20 * scale + 103.5, y: 50 * scale + 50 }, project), true, `vertical hairline has a CSS-pixel tolerance at scale ${scale}`);
  }
  assert.equal(editorBoundsClickHit({ minX: 10, minY: 20, maxX: 90, maxY: 20 }, { x: 50, y: 16.5 }, { x: -16.5, y: 50 }, point => ({ x: -point.y, y: point.x })), true, "click tolerance follows rotated projected bounds");
  const grid = Float32Array.of(20, 30, 120, 230, 150, 30, 250, 230), reader = Float32Array.of(0, 220, 100, 420, 0, 0, 100, 200);
  assert.equal(editorPageAtPoint(grid, { x: 240, y: 220 }), 1, "page rectangles store maxima, not width/height");
  assert.equal(editorPageAtPoint(grid, { x: 300, y: 220 }), -1);
  assert.deepEqual(remapEditorPagePoint({ x: 180, y: 80 }, grid, reader), { x: 30, y: 50 });
  assert.deepEqual(remapEditorPagePoint({ x: 30, y: 50 }, reader, grid), { x: 180, y: 80 }, "Reader/grid round trip keeps page-local position");
  const metadata = [{ id: "empty-widget", subtype: "Widget", visibleInDefaultView: true, hasAppearance: false, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }];
  const currentBounds = () => ({ minX: 30, minY: 40, maxX: 50, maxY: 60 });
  assert.equal(pickEditorMetadataAnnotation(metadata, { x: 35, y: 45 }, currentBounds), "empty-widget", "blank widgets are pickable at their transformed bounds");
  assert.equal(pickEditorMetadataAnnotation(metadata, { x: 5, y: 5 }, currentBounds), null, "old widget bounds are not reused after moving");
  assert.equal(pickEditorMetadataAnnotation([{ ...metadata[0], visibleInDefaultView: false }], { x: 35, y: 45 }, currentBounds), null);
  assert.equal(pickEditorMetadataAnnotation([{ ...metadata[0], hasAppearance: true }], { x: 35, y: 45 }, currentBounds, () => false), "empty-widget", "an explicitly empty AP stream is still a movable widget");
  assert.deepEqual(transformEditorAnnotationText([1, 0, 0, 1, 0, 0], [0, 1, -1, 0, 0, 0], 100, 200), [0, 1, -1, 0, -300, -100], "in-session source annotation transforms are conjugated into page-local text coordinates");
  const changes = [];
  const field = createEditorFieldControl(document, annotation("Tx", { maxLength: 8, flags: 4096 }), "Alice", value => changes.push(value));
  assert.equal(field.tagName, "TEXTAREA"); assert.equal(field.value, "Alice"); assert.equal(field.maxLength, 8);
  assert.equal(field.attributes.get("aria-label"), "Field label");
  field.value = "Bob"; field.dispatchEvent(new Event("change")); assert.deepEqual(changes, ["Bob"]);
  assert.equal(createEditorFieldControl(document, annotation("Tx", { flags: 1 }), undefined, () => {}), null, "read-only fields have no editable overlay");
  assert.equal(createEditorFieldControl(document, { ...annotation("Tx"), visibleInDefaultView: false }, undefined, () => {}), null);
  assert.equal(createEditorFieldControl(document, annotation("Btn", { flags: 65536 }), undefined, () => {}), null, "push-button actions are not executed");
  const checkbox = createEditorFieldControl(document, annotation("Btn", { onValue: "Accepted" }), "Accepted", value => changes.push(value));
  assert.equal(checkbox.checked, true); checkbox.checked = false; checkbox.dispatchEvent(new Event("change")); assert.equal(changes.at(-1), "Off");
  const radio = createEditorFieldControl(document, annotation("Btn", { flags: 32768, onValue: "OptionB" }), "OptionA", value => changes.push(value));
  assert.equal(radio.type, "radio"); assert.equal(radio.checked, false); radio.checked = true; radio.dispatchEvent(new Event("change")); assert.equal(changes.at(-1), "OptionB");
  const choice = createEditorFieldControl(document, annotation("Ch", { flags: 2097152, options: [{ label: "First", value: "a" }, { label: "Second", value: "b" }] }), ["b"], value => changes.push(value));
  assert.equal(choice.multiple, true); assert.equal(choice.children[1].textContent, "Second");
  choice.children[0].selected = true; choice.dispatchEvent(new Event("change")); assert.deepEqual(changes.at(-1), ["a", "b"]);
  const singleList = createEditorFieldControl(document, annotation("Ch", { options: [{ label: "First", value: "a" }, { label: "Second", value: "b" }] }), "b", value => changes.push(value));
  assert.equal(singleList.tagName, "SELECT"); assert.equal(singleList.multiple, false); assert.equal(singleList.size, 2, "single-choice list fields retain list presentation");
  const largeOptions = Array.from({ length: 257 }, (_, i) => ({ label: `Choice ${i}`, value: `v${i}` }));
  const largeList = createEditorFieldControl(document, annotation("Ch", { options: largeOptions }), "v256", () => {});
  assert.equal(largeList.size, 257); assert.equal(largeList.options.length, 257, "list presentation has no application option-count cap");
  const combo = createEditorFieldControl(document, annotation("Ch", { flags: 131072, options: largeOptions }), "v1", () => {});
  assert.equal(combo.size, 1, "non-editable combo fields remain collapsed dropdowns");
  const editableAnnotation = annotation("Ch", { flags: 262144 | 131072, options: [{ label: "Friendly first", value: "export-a" }, { label: "Friendly second", value: "export-b" }] });
  const editableChoice = createEditorFieldControl(document, editableAnnotation, "Custom", value => changes.push(value));
  assert.equal(editableChoice.tagName, "INPUT"); assert.equal(editableChoice.value, "Custom");
  const suggestions = createEditorFieldOptions(document, editableAnnotation, editableChoice);
  assert.equal(suggestions.tagName, "DATALIST"); assert.equal(editableChoice.attributes.get("list"), suggestions.id);
  assert.deepEqual(suggestions.children.map(option => [option.value, option.label]), [["export-a", "Friendly first"], ["export-b", "Friendly second"]], "editable combo suggestions offer display labels and PDF export values");
  editableChoice.value = "export-b"; editableChoice.dispatchEvent(new Event("change")); assert.equal(changes.at(-1), "export-b");
  editableChoice.value = "Custom choice"; editableChoice.dispatchEvent(new Event("change")); assert.equal(changes.at(-1), "Custom choice", "editable combos still accept custom values");
  const otherSuggestions = createEditorFieldOptions(document, editableAnnotation, createEditorFieldControl(document, editableAnnotation, "", () => {}));
  assert.notEqual(otherSuggestions.id, suggestions.id, "separate widgets receive unique choice-list associations");
  setEditorFieldControlValue(choice, annotation("Ch"), ["b"]); assert.deepEqual(choice.selectedOptions.map(option => option.value), ["b"]);
  setEditorFieldControlValue(checkbox, annotation("Btn", { onValue: "Accepted" }), "Off"); assert.equal(checkbox.checked, false);
  const draftCommits = [], draftField = createEditorFieldControl(document, annotation("Tx"), "Alice", value => {
    draftCommits.push(value); fieldDrafts.set(draftField, editorFieldDraftSignature(draftField));
  });
  const fieldDrafts = new Map([[draftField, editorFieldDraftSignature(draftField)]]);
  draftField.value = "Bob"; assert.equal(hasPendingEditorFields(fieldDrafts), true, "focused typing is detected before blur/change");
  draftField.value = "Alice"; assert.equal(hasPendingEditorFields(fieldDrafts), false, "reverting focused typing restores the clean baseline");
  const multiDrafts = new Map([[choice, editorFieldDraftSignature(choice)]]); choice.children[0].selected = true;
  assert.equal(hasPendingEditorFields(multiDrafts), true); choice.children[0].selected = false; assert.equal(hasPendingEditorFields(multiDrafts), false);
  const checkDrafts = new Map([[checkbox, editorFieldDraftSignature(checkbox)]]); checkbox.checked = true;
  assert.equal(hasPendingEditorFields(checkDrafts), true);
  const firstRadio = new Element("input"), secondRadio = new Element("input");
  Object.assign(firstRadio, { type: "radio", name: "choice", value: "First", checked: false }); Object.assign(secondRadio, { type: "radio", name: "choice", value: "Second", checked: true });
  const radioDrafts = new Map([[firstRadio, editorFieldDraftSignature(firstRadio)], [secondRadio, editorFieldDraftSignature(secondRadio)]]), radioCommits = [];
  firstRadio.addEventListener("change", () => radioCommits.push("First")); secondRadio.addEventListener("change", () => radioCommits.push("Off"));
  firstRadio.checked = true; secondRadio.checked = false; flushEditorFieldDrafts(radioDrafts);
  assert.deepEqual(radioCommits, ["First"], "flushing radio controls cannot overwrite the checked choice with an unchecked sibling");
  const firstDraft = new Element("input"), secondDraft = new Element("input"), allDrafts = new Map([[firstDraft, "a"], [secondDraft, "b"]]), allCommits = [];
  firstDraft.value = "A"; secondDraft.value = "B";
  firstDraft.addEventListener("change", () => { allCommits.push("A"); allDrafts.clear(); }); secondDraft.addEventListener("change", () => allCommits.push("B"));
  flushEditorFieldDrafts(allDrafts); assert.deepEqual(allCommits, ["A", "B"], "a first field's rerender cannot discard other pending fields during save");

  const root = new Element("div"), bold = new Element("b", { fontWeight: "700", fontSize: "18px" });
  bold.append(text("Bold")); root.append(text("Normal "), bold, new Element("br"));
  const second = new Element("span", { fontFamily: "\"font-b\"", color: "rgb(255, 0, 0)", fontStyle: "italic", textDecorationLine: "underline line-through" });
  second.append(text("mixed")); root.append(second);
  const fonts = [{ id: "font-a", family: "Custom A" }, { id: "font-b", family: "Custom B" }];
  const runs = readRichTextRuns(root, { getComputedStyle: element => element.computedStyle }, fonts, "font-a", "Custom A");
  assert.equal(runs.map(run => run.text).join(""), "Normal Bold\nmixed");
  assert.equal(runs[1].fontSize, 18); assert.equal(runs[1].fontWeight, 700);
  assert.equal(runs.at(-1).fontId, "font-b"); assert.equal(runs.at(-1).fontFamily, "Custom B");
  assert.equal(runs.at(-1).color, "#ff0000", "computed CSS colors become portable colors supported by the compiler");
  assert.equal(runs.at(-1).fontStyle, "italic"); assert.equal(runs.at(-1).underline, true); assert.equal(runs.at(-1).strikethrough, true);
  const paragraphs = new Element("div"), first = new Element("div"), last = new Element("div"); first.append(text("one")); last.append(text("two")); paragraphs.append(first, last);
  assert.equal(readRichTextRuns(paragraphs, { getComputedStyle: element => element.computedStyle }, fonts).map(run => run.text).join(""), "one\ntwo", "block boundaries produce one newline");
  const injected = new Element("span"); injected.append(text("<script>alert(1)</script>"));
  assert.equal(readRichTextRuns(injected, { getComputedStyle: element => element.computedStyle }, fonts)[0].text, "<script>alert(1)</script>", "text remains inert data");

  const editingEvents = [], textSession = {
    transaction(label, apply) { editingEvents.push(["transaction", label]); apply(); },
    selectAnnotations(ids) { editingEvents.push(["annotations", ids]); }, deleteSelection() { editingEvents.push(["delete"]); },
    addObject(object) { editingEvents.push(["add", object]); return "new-text"; },
    updateObject(id, object) { editingEvents.push(["update", id, object]); }, select(ids) { editingEvents.push(["select", ids]); }
  };
  const newText = { kind: "text", pageIndex: 0, text: "Revised", x: 1, y: 2, width: 80, height: 30, fontSize: 12 };
  assert.equal(commitEditorText(textSession, newText, { sourceAnnotationId: "saved-FreeText" }), "new-text");
  assert.deepEqual(editingEvents.map(event => event[0]), ["transaction", "annotations", "delete", "add", "select"], "saved textbox edits replace the source annotation in one undo transaction");
  editingEvents.length = 0;
  commitEditorText(textSession, null, { objectId: "existing-text" });
  assert.deepEqual(editingEvents.map(event => event[0]), ["transaction", "select", "delete", "select"], "clearing an existing textbox deletes it");
  editingEvents.length = 0; commitEditorText(textSession, null, {});
  assert.deepEqual(editingEvents, [], "an empty new textbox does not modify the document");

  const uiSource = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
  const sourceLifecycle = [], changedScene = { id: "new-source" }, changedPdf = Uint8Array.of(9);
  const sourceHost = vm.createContext({ currentSourceScene: { id: "old-source" }, latestScene: null, picker: { dispose: () => sourceLifecycle.push("dispose picker") },
    picking: { abort: () => sourceLifecycle.push("cancel pick") }, session: { sourceScene: changedScene, sourcePdf: changedPdf },
    host: { documentChanged: async (scene, value) => { assert.equal(scene, changedScene); assert.equal(value.pdf, changedPdf); sourceLifecycle.push("document changed"); } },
    source: { password: "primary password", label: "primary.pdf" }, tool: "form", renderFields: () => sourceLifecycle.push("fields"), pagesDialog: { refresh: () => sourceLifecycle.push("pages") } });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "synchronizeDocumentSource"), sourceHost);
  await sourceHost.synchronizeDocumentSource(); await sourceHost.synchronizeDocumentSource();
  assert.deepEqual(sourceLifecycle, ["cancel pick", "dispose picker", "document changed", "fields", "pages"]);
  assert.equal(sourceHost.latestScene, changedScene); assert.equal(sourceHost.picker, null, "structural source swaps invalidate the old primitive picker exactly once");
  const structuralEvents = [], structuralWarnings = [], structuralStatuses = []; let finishPageChange;
  const structuralHost = vm.createContext({ running: false, structuralRunning: false, fieldDrafts: new Map(), hasPendingEditorFields: () => false,
    flushEditorFieldDrafts: () => structuralEvents.push("fields"), activeText: {}, finishText: async () => structuralEvents.push("text"),
    toolbar: { inert: false }, overlay: { inert: false, dataset: {}, style: {} }, host: {}, isSceneSettling: () => false, pointer: {}, polygon: {}, textRequest: 0, picking: { abort: () => structuralEvents.push("cancel pick") }, pendingPick: { canceled: false },
    clearPreview: () => structuralEvents.push("cancel gesture"), operation: null, lifetime: new AbortController(), AbortController, AbortSignal, LoadProgressReporter,
    query: () => ({ hidden: false }), setStatus: text => structuralStatuses.push(text), disposed: false,
    refreshScene: async signal => { assert.equal(signal.aborted, false); structuralEvents.push("refresh"); },
    pagesDialog: { refresh: () => structuralEvents.push("pages"), setWarnings: values => structuralWarnings.push([...values]), setStatus() {} }, updateState: () => structuralEvents.push("state"), session: { getState: () => ({}) },
    report: error => assert.fail(String(error)) });
  for (const name of ["updatePointerCursor", "cancelPointerGesture", "runPageOperation", "commit"]) vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), name), structuralHost);
  const structuralPending = structuralHost.runPageOperation(async options => {
    structuralEvents.push("change"); assert.equal(options.signal.aborted, false);
    options.onDiagnostic({ code: "pages.navigation-detached", severity: "warning", message: "An imported named destination was detached." });
    options.onDiagnostic({ code: "pages.navigation-detached", severity: "warning", message: "An imported named destination was detached." });
    options.onDiagnostic({ code: "test.info", severity: "info", message: "Synthetic progress detail" });
    options.onProgress({ value: .75, stage: "pdf-page" });
    await new Promise(resolve => { finishPageChange = resolve; });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(structuralHost.structuralRunning, true); assert.equal(structuralHost.toolbar.inert, true); assert.equal(structuralHost.overlay.inert, true);
  structuralHost.commit(() => assert.fail("document edits must be blocked while structural work is pending"));
  finishPageChange(); await structuralPending;
  assert.deepEqual(structuralEvents, ["fields", "text", "cancel pick", "cancel gesture", "change", "refresh", "pages", "state"]);
  assert.equal(structuralHost.structuralRunning, false); assert.equal(structuralHost.toolbar.inert, false); assert.equal(structuralHost.overlay.inert, false);
  assert.deepEqual(structuralWarnings, [[], ["An imported named destination was detached."]], "the runner forwards actual diagnostic warnings once");
  assert.equal(structuralStatuses.at(-1), "An imported named destination was detached.", "completion retains the native page warning in toolbar status");
  const focusedField = new Element("input"); focusedField.value = "initial"; focusedField.selectionStart = 2; focusedField.selectionEnd = 4;
  const focusedDocument = { activeElement: focusedField }; let finishCompile;
  const compilePending = new Promise(resolve => { finishCompile = resolve; });
  const refreshHost = vm.createContext({ renderRevision: 0, operation: null, AbortController, disposed: false, tool: "form", latestScene: { id: "before" },
    scenePreparation: null, sceneApplication: null, lifetime: new AbortController(), AbortSignal, active: false, requestedPreview: null, presented: null, updatePointerCursor() {},
    synchronizeDocumentSource: async () => {}, updateFieldPaint() {},
    session: { getState: () => ({ revision: 0, selection: [], previewing: false }), getSelectionFrame: () => null, getScene: () => compilePending }, host: { applyScene: async () => {} },
    renderFields: () => assert.fail("an async compile must not replace another field's focused draft"), report: error => assert.fail(String(error)) });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "refreshScene"), refreshHost);
  const refreshing = refreshHost.refreshScene(); focusedField.value = "typed while another field compiles"; finishCompile({ id: "after" }); await refreshing;
  assert.equal(focusedField.value, "typed while another field compiles"); assert.equal(focusedDocument.activeElement, focusedField);
  assert.equal(focusedField.selectionStart, 2); assert.equal(focusedField.selectionEnd, 4); assert.equal(refreshHost.latestScene.id, "after");
  let assignments = 0, focusedValue = focusedField.value;
  Object.defineProperty(focusedField, "value", { get: () => focusedValue, set: value => { assignments++; focusedValue = value; focusedField.selectionStart = 0; }, configurable: true });
  setEditorFieldControlValue(focusedField, annotation("Tx"), focusedValue); assert.equal(assignments, 0); assert.equal(focusedField.selectionStart, 2, "syncing an unchanged widget preserves its focused caret");
  const historyEvents = [], historyHost = vm.createContext({ tool: "form", session: { undo: () => historyEvents.push("undo"), redo: () => historyEvents.push("redo") },
    commit: apply => apply(), renderFields: () => historyEvents.push("render") });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "changeHistory"), historyHost); historyHost.changeHistory(false); historyHost.changeHistory(true);
  assert.deepEqual(historyEvents, ["undo", "render", "redo", "render"], "explicit history actions refresh field values synchronously");
  const guardState = { dirty: false }, draftElement = { innerHTML: "Original", style: { textAlign: "left" } };
  let discardPrompts = 0, unloadPrompts = 0;
  const guardProtection = createEditorPdfProtectionState();
  const guards = vm.createContext({ session: { getState: () => guardState }, hasPendingEditorTextChanges, hasPendingEditorFields, fieldDrafts, pdfProtection: guardProtection, passwordDialog: null, structuralRunning: false,
    activeText: { element: draftElement, opacity: 1, baseline: { html: "Original", align: "left", opacity: 1 } },
    window: { confirm() { discardPrompts++; return false; } } });
  for (const name of ["hasUnsavedChanges", "confirmDocumentChange", "beforeUnload"]) vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), name), guards);
  assert.equal(guards.hasUnsavedChanges(), false); assert.equal(guards.confirmDocumentChange(), true); assert.equal(discardPrompts, 0, "opening unchanged saved text does not trigger discard prompts");
  guards.beforeUnload({ preventDefault() { unloadPrompts++; } }); assert.equal(unloadPrompts, 0);
  draftElement.innerHTML = "Original <b>edited</b>";
  assert.equal(guards.hasUnsavedChanges(), true); assert.equal(guards.confirmDocumentChange(), false); assert.equal(discardPrompts, 1);
  const unload = { returnValue: undefined, preventDefault() { unloadPrompts++; } }; guards.beforeUnload(unload);
  assert.equal(unloadPrompts, 1); assert.equal(unload.returnValue, "", "uncommitted textbox changes guard tab closing");
  draftElement.innerHTML = "Original"; draftElement.style.textAlign = "center";
  assert.equal(guards.hasUnsavedChanges(), true, "pending alignment changes guard navigation");
  draftElement.style.textAlign = "left"; guards.activeText.opacity = .5;
  assert.equal(guards.hasUnsavedChanges(), true, "pending opacity changes guard navigation");
  guards.activeText.opacity = 1; assert.equal(guards.hasUnsavedChanges(), false);
  guards.activeText = null; guardState.dirty = true; assert.equal(guards.hasUnsavedChanges(), true, "committed session changes remain guarded");
  guardState.dirty = false; assert.equal(guards.hasUnsavedChanges(), false);
  draftField.value = "Bob"; assert.equal(guards.hasUnsavedChanges(), true); assert.equal(guards.confirmDocumentChange(), false, "focused form drafts guard document replacement");
  const fieldUnload = { preventDefault() { unloadPrompts++; } }; guards.beforeUnload(fieldUnload); assert.equal(fieldUnload.returnValue, "", "focused form drafts guard tab closing");
  draftField.value = "Alice"; assert.equal(guards.hasUnsavedChanges(), false);
  guardProtection.set({ mode: "remove" }); assert.equal(guards.hasUnsavedChanges(), true); assert.equal(guards.confirmDocumentChange(), false, "pending PDF protection guards document replacement");
  const protectionUnload = { preventDefault() {} }; guards.beforeUnload(protectionUnload); assert.equal(protectionUnload.returnValue, "");
  guardProtection.set({ mode: "preserve" }); assert.equal(guards.hasUnsavedChanges(), false);
  guards.passwordDialog = { hasDraftChanges: () => true }; assert.equal(guards.hasUnsavedChanges(), true, "unapplied password dialog drafts guard tab closing");
  guards.passwordDialog = null;
  guards.structuralRunning = true; assert.equal(guards.hasUnsavedChanges(), true, "a pending structural operation guards document replacement"); guards.structuralRunning = false;
  const savedFromFocus = [], keyHost = vm.createContext({ active: true, structuralRunning: false, inputTarget: () => true, save: kind => savedFromFocus.push(kind) });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "keydown"), keyHost);
  let preventedSave = 0;
  keyHost.keydown({ key: "s", ctrlKey: true, metaKey: false, target: draftField, preventDefault() { preventedSave++; } });
  keyHost.keydown({ key: "s", ctrlKey: false, metaKey: true, target: { isContentEditable: true }, preventDefault() { preventedSave++; } });
  assert.deepEqual(savedFromFocus, ["pdf", "pdf"]); assert.equal(preventedSave, 2, "Ctrl/Cmd+S works while a form or textbox is focused");
  keyHost.keydown({ key: "Escape", isComposing: true });
  keyHost.keydown({ key: "s", ctrlKey: true, isComposing: true });
  keyHost.keydown({ key: "Escape", keyCode: 229 });
  assert.deepEqual(savedFromFocus, ["pdf", "pdf"], "IME owns composition keys without canceling drafts or saving incomplete text");
  keyHost.inputTarget = () => false;
  for (const key of ["Delete", "Backspace", "ArrowLeft", "d"]) keyHost.keydown({ key, ctrlKey: key === "d",
    target: { closest: selector => selector === "dialog" ? {} : null },
    preventDefault() { assert.fail("Modal controls must not edit objects behind the dialog"); } });
  keyHost.inputTarget = () => true;
  let cancelledStructure = 0; keyHost.structuralRunning = true; keyHost.operation = { abort() { cancelledStructure++; } };
  keyHost.keydown({ key: "s", ctrlKey: true, preventDefault() {} }); keyHost.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(cancelledStructure, 1); assert.deepEqual(savedFromFocus, ["pdf", "pdf"], "structural work blocks keyboard exports and allows cancellation");
  const created = [], creationHost = vm.createContext({ objectOpacity: .375, tool: "rectangle", pendingPick: null, pointer: null,
    appendEditorInkSamples, editorInkCaptureTolerance, host: { clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }) },
    Math, clearPreview() {}, updatePointerCursor() {}, overlay: { releasePointerCapture() {} }, property: name => ({ value: name === "color" ? "#123456" : "2", checked: false }),
    pageAt: () => 0, pageLocal: point => [point.x, point.y], setTool() {}, commit: apply => apply(),
    signature: { width: 20, height: 10, paths: [[0, 0, 10, 10, 20, 0]] },
    pendingImage: { kind: "image", imageWidth: 1, imageHeight: 1, data: Uint8Array.of(1, 2, 3, 255) },
    session: { sourceScene: { pageRects: Float32Array.of(0, 0, 200, 300) }, addObject(object) { created.push(object); return "created"; }, select() {} }
  });
  for (const name of ["placeImage", "placeSignature", "pointerUp"]) vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), name), creationHost);
  creationHost.placeImage({ x: 20, y: 60 }); creationHost.placeSignature({ x: 20, y: 60 });
  for (const tool of ["rectangle", "ink"]) {
    creationHost.tool = tool; creationHost.pointer = { id: 1, start: { x: 10, y: 20 }, last: { x: 40, y: 50 }, startClient: { x: 10, y: 20 },
      points: [[10, 20], [20, 40], [40, 50]], bounds: null, action: "draw", additive: false };
    creationHost.pointerUp({ pointerId: 1, clientX: 40, clientY: 50 });
  }
  assert.deepEqual(created.map(object => object.kind), ["image", "signature", "shape", "ink"]);
  assert(created.every(object => object.opacity === .375), "creation tools carry the selected opacity into their editable objects");
  creationHost.tool = "ink";
  creationHost.pointer = { id: 2, start: { x: 10, y: 10 }, last: { x: 10, y: 10 }, startClient: { x: 10, y: 10 },
    points: [[10, 10], [20, 10], [20, 20], [10, 10]], bounds: null, action: "draw" };
  creationHost.pointerUp({ pointerId: 2, clientX: 10, clientY: 10, getCoalescedEvents: () => [] });
  assert.equal(created.at(-1).paths[0].length, 4, "a pencil loop survives a release back at its start");
  assert(created.at(-1).smoothing > 0 && created.at(-1).smoothing < .35);
  creationHost.pointer = { id: 3, start: { x: 7, y: 8 }, last: { x: 7, y: 8 }, startClient: { x: 7, y: 8 },
    points: [[7, 8]], bounds: null, action: "draw" };
  creationHost.pointerUp({ pointerId: 3, clientX: 7, clientY: 8 });
  assert.deepEqual(Array.from(created.at(-1).paths[0][0]), [7, 8], "a pencil tap creates a vector dot");
  creationHost.pointer = { id: 4, start: { x: 0, y: 0 }, last: { x: 2, y: 2 }, startClient: { x: 0, y: 0 },
    points: [[0, 0], [2, 2]], bounds: null, action: "draw" };
  creationHost.pointerUp({ pointerId: 4, clientX: 9, clientY: 11, getCoalescedEvents: () => [] });
  assert.deepEqual(Array.from(created.at(-1).paths[0].at(-1)), [9, 11], "pencil release appends the actual final pen location");
  const textCreationHost = vm.createContext({ disposed: false, textRequest: 0,
    activeText: { element: { innerText: "Opacity", scrollHeight: 20 }, pageIndex: 0, x: 5, y: 5, width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0], opacity: .375 },
    selectedFont: async () => ({ id: "font", family: "Test" }), editorServices: { fonts: { list: () => [] } }, window: {},
    readRichTextRuns: () => [{ text: "Opacity", fontSize: 12 }], styleEnabled: () => false,
    property: name => ({ value: name === "font-size" ? "12" : "#123456" }), query: () => ({ value: "left" }),
    cancelText() {}, commit: apply => apply(), commitEditorText,
    session: { transaction(_label, apply) { apply(); }, addObject(object) { created.push(object); return "text-created"; }, select() {} }
  });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "finishText"), textCreationHost);
  await textCreationHost.finishText(); assert.equal(created.at(-1).kind, "text"); assert.equal(created.at(-1).opacity, .375);
  const statuses = [], downloads = [], cancellationButton = { hidden: true };
  draftField.value = "Bob";
  const savedProtection = createEditorPdfProtectionState(); savedProtection.set({ mode: "remove" });
  const pdfSaveOptions = [];
  const saveHost = vm.createContext({ activeText: null, running: false, structuralRunning: false, operation: null, AbortController, fieldDrafts, flushEditorFieldDrafts, hasPendingEditorFields, LoadProgressReporter,
    pdfProtection: savedProtection, passwordDialog: null, hasUnsavedChanges: () => savedProtection.hasChanges(),
    query: () => cancellationButton, setStatus: value => statuses.push(value), source: { label: "sample.pdf" },
    sourceFunction, finishText: async () => {}, host: {}, pointer: null, pendingPick: null, picking: null, overlay: { dataset: {}, style: {} }, isSceneSettling: () => false, clearPreview() {},
    session: { getState: () => ({ previewing: false }), async savePdf(options) { pdfSaveOptions.push(options); assert.equal(draftCommits.at(-1), "Bob", "saving flushes the focused field before creating PDF output"); options.onWarning("Preserved export warning"); return new Blob(["PDF"], { type: "application/pdf" }); },
      async saveHep() { return new Blob(["HEP"]); }, markSaved: () => assert.fail("UI must not clear a newer revision's unsaved state") },
    formatPdfDownloadFilename: label => label, triggerBrowserDownload: (blob, name) => downloads.push(name),
    report: error => assert.fail(String(error)), printPdfBlob: () => assert.fail("Save must not print"), document: {}
  });
  for (const name of ["updatePointerCursor", "cancelPointerGesture", "save"]) vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), name), saveHost);
  await saveHost.save("pdf");
  assert.deepEqual(downloads, ["sample-edited.pdf"]);
  assert.equal(statuses.at(-1), "Preserved export warning", "successful download retains fidelity diagnostics");
  assert.equal(cancellationButton.hidden, true, "export cancellation control returns to its idle state");
  assert.deepEqual(pdfSaveOptions[0].protection, { mode: "remove" }); assert.equal(savedProtection.hasChanges(), false);
  savedProtection.set({ mode: "password", password: "test opening password" }); await saveHost.save("hep");
  assert.equal(savedProtection.hasChanges(), true, "HEP output does not clear pending PDF-only protection settings");
  await saveHost.save("flatten"); assert.equal(pdfSaveOptions.at(-1).flatten, true);
  assert.equal(pdfSaveOptions.at(-1).protection.mode, "password"); assert.equal(savedProtection.hasChanges(), false);
  let finishPasswordSave;
  saveHost.session.savePdf = async options => { pdfSaveOptions.push(options); return new Promise(resolve => { finishPasswordSave = () => resolve(new Blob(["PDF"])); }); };
  savedProtection.set({ mode: "remove" }); const pendingPasswordSave = saveHost.save("pdf");
  savedProtection.set({ mode: "password", password: "newer password" }); finishPasswordSave(); await pendingPasswordSave;
  assert.equal(savedProtection.hasChanges(), true); assert.equal(statuses.at(-1), "Unsaved changes", "a successful older export keeps newer protection changes visible");
  const failedSaves = []; saveHost.report = error => failedSaves.push(error.message);
  saveHost.session.savePdf = async () => { throw new Error("Synthetic export failure"); }; await saveHost.save("pdf");
  assert.equal(savedProtection.hasChanges(), true); assert.deepEqual(failedSaves, ["Synthetic export failure"]);
  saveHost.passwordDialog = { apply: () => false }; const downloadsBeforeInvalidPassword = downloads.length;
  await saveHost.save("pdf"); assert.equal(downloads.length, downloadsBeforeInvalidPassword, "invalid dialog passwords prevent export");
  saveHost.passwordDialog = null;
  const viewStatuses = [], viewStatus = { textContent: "" }, statusHost = vm.createContext({ active: false, status: viewStatus,
    host: { onStatus: text => viewStatuses.push(text) } });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "setStatus"), statusHost);
  statusHost.setStatus("Preparing print…"); statusHost.setStatus("Print failed");
  assert.deepEqual(viewStatuses, ["Preparing print…", "Print failed"], "View-mode operations expose progress and failures outside the hidden editor toolbar");
  statusHost.active = true; statusHost.setStatus("Editing text");
  assert.equal(viewStatus.textContent, "Editing text"); assert.equal(viewStatuses.length, 2);
  let resolveFont, fontLoads = 0, installedFonts = 0;
  const fontLoad = new Promise(resolve => { resolveFont = resolve; });
  const fontHost = vm.createContext({ fontFaces: new Map(), fontFaceLoads: new Map(), disposed: false, DOMException,
    FontFace: class { load() { fontLoads++; return fontLoad; } }, document: { fonts: { add() { installedFonts++; } } } });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "activateFont"), fontHost);
  const typingFont = { id: "shared-field-font", bytes: Uint8Array.of(1, 2), fontWeight: 400, fontStyle: "normal" };
  const fieldFontLoads = Array.from({ length: 58 }, () => fontHost.activateFont(typingFont));
  assert.equal(fontLoads, 1, "fields using one font share its in-flight browser font load");
  resolveFont(); await Promise.all(fieldFontLoads); assert.equal(installedFonts, 1);
  await fontHost.activateFont(typingFont); assert.equal(fontLoads, 1);
  const paintedControl = { dataset: { fieldId: "new-appearance" }, value: "focused draft", selectionStart: 4 };
  const paintHost = vm.createContext({ latestScene: { annotations: [{ id: "new-appearance", hasAppearance: false }] },
    fieldDrafts: new Map([[paintedControl, "draft"]]), getSceneAnnotationRuns: () => new Map() });
  vm.runInContext(sourceFunction(uiSource.replace(/^ {2}/gm, ""), "updateFieldPaint"), paintHost);
  paintHost.updateFieldPaint(); assert.equal(paintedControl.dataset.pdfAppearance, undefined);
  paintHost.getSceneAnnotationRuns = () => new Map([["new-appearance", [{ kind: "fill", count: 1 }]]]);
  paintHost.updateFieldPaint(); assert.equal(paintedControl.dataset.pdfAppearance, "true", "newly generated field paint replaces the native control's duplicate visual");
  assert.equal(paintedControl.value, "focused draft"); assert.equal(paintedControl.selectionStart, 4);
  console.log("Editor form controls and rich text tests passed.");
} finally { hooks.deregister(); }
