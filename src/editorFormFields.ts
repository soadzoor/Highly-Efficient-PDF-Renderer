import type { SceneAnnotation } from "./annotationData";
import type { VectorScene } from "./pdfVectorExtractor";
import type { EditorFieldObject, EditorFieldType, EditorFieldValue, EditorObject, EditorShapeObject } from "./editorTypes";
import { normalizePrimitiveColor } from "./colorInput";
import { composeEditorPage, EDITOR_IDENTITY, setEditorAnnotationSource } from "./editorScene";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { AnnotationLayerBuilder } from "./annotationLayers";
import { setEditorPaintRole } from "./editorPaintIdentity";
import type { EditorTextLayoutOptions } from "./editorText";

export const EDITOR_FIELD_TYPES: readonly EditorFieldType[] = ["text", "number", "date", "email", "tel", "url", "checkbox", "radio", "dropdown", "list"];
export function validateEditorFieldValue(object: EditorFieldObject, value: EditorFieldValue | undefined): void {
  if (value === undefined || value === null) return;
  if (!(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ||
      Array.isArray(value) && value.every(item => typeof item === "string"))) throw new TypeError("Invalid form field value.");
  const text = String(value), blank = value === "";
  if (object.fieldType === "checkbox") {
    if (typeof value !== "boolean" && value !== (object.onValue ?? "Yes") && value !== "Off" && !blank) throw new TypeError("A checkbox requires a boolean or its export value.");
    return;
  }
  if (object.fieldType === "radio") { if (typeof value !== "string") throw new TypeError("A radio group requires a selected export value."); return; }
  if (object.fieldType === "dropdown" || object.fieldType === "list") {
    const selected = Array.isArray(value) ? value : blank ? [] : [text];
    if ((!object.multiSelect || object.fieldType === "dropdown") && selected.length > 1) throw new RangeError("This field allows one selected value.");
    if (selected.some(item => !object.options?.some(option => option.value === item))) throw new RangeError("Select an available field option.");
    return;
  }
  if (typeof value !== "string" && typeof value !== "number") throw new TypeError("A text field requires text or a number.");
  if (object.maxLength !== undefined && text.length > object.maxLength) throw new RangeError(`This field allows at most ${object.maxLength} characters.`);
  if (blank) return;
  if (object.fieldType === "number" && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text)))) throw new TypeError("Enter a valid finite number.");
  if (object.fieldType === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text)) throw new TypeError("Enter a valid date in YYYY-MM-DD format.");
}
export function validateEditorFieldObject(object: EditorFieldObject): void {
  if (!EDITOR_FIELD_TYPES.includes(object.fieldType)) throw new TypeError("Unknown form field type.");
  if (!(object.width > 0 && object.height > 0)) throw new RangeError("A form field requires positive width and height.");
  if (typeof object.name !== "string" || !object.name.trim() || object.name.includes("\0") || object.name.includes(".")) throw new TypeError("A form field requires a nonempty name without periods or null characters.");
  for (const key of ["readOnly", "required", "multiline", "multiSelect"] as const) if (object[key] !== undefined && typeof object[key] !== "boolean") throw new TypeError(`${key} must be true or false.`);
  if (object.multiline && object.fieldType !== "text") throw new TypeError("Only text fields can contain multiple lines.");
  if (object.multiSelect && object.fieldType !== "list") throw new TypeError("Only list fields allow multiple selections.");
  const button = object.fieldType === "checkbox" || object.fieldType === "radio", choice = object.fieldType === "dropdown" || object.fieldType === "list";
  if (object.maxLength !== undefined && (button || choice)) throw new TypeError("Only text inputs have a maximum length.");
  if (object.onValue !== undefined && !button) throw new TypeError("Only buttons have a checked export value.");
  if (object.options !== undefined && !choice) throw new TypeError("Only choice fields have options.");
  if (object.maxLength !== undefined && (!Number.isSafeInteger(object.maxLength) || object.maxLength < 1)) throw new RangeError("Maximum length must be a positive integer.");
  if (object.fontSize !== undefined && (!Number.isFinite(object.fontSize) || object.fontSize < 0)) throw new RangeError("Field font size must be nonnegative.");
  if (object.strokeWidth !== undefined && (!Number.isFinite(object.strokeWidth) || object.strokeWidth < 0)) throw new RangeError("Field border width must be nonnegative.");
  if (object.tooltip !== undefined && typeof object.tooltip !== "string") throw new TypeError("A field tooltip must be text.");
  if (object.onValue !== undefined && (typeof object.onValue !== "string" || !object.onValue || object.onValue === "Off")) throw new TypeError("A button export value must be nonempty and differ from Off.");
  if (object.align !== undefined && !["left", "center", "right"].includes(object.align)) throw new TypeError("Unknown field alignment.");
  if (object.options !== undefined && (!Array.isArray(object.options) || object.options.some(option => !option || typeof option.value !== "string" || typeof option.label !== "string") ||
      new Set(object.options.map(option => option.value)).size !== object.options.length)) throw new TypeError("Field options require unique text values and labels.");
  for (const color of [object.color, object.borderColor, object.fill]) if (color !== undefined && color !== null) normalizePrimitiveColor(color);
  validateEditorFieldValue(object, object.value); validateEditorFieldValue(object, object.defaultValue);
}
export function editorFieldAnnotation(object: EditorFieldObject): SceneAnnotation {
  const button = object.fieldType === "checkbox" || object.fieldType === "radio", choice = object.fieldType === "dropdown" || object.fieldType === "list";
  const flags = (object.readOnly ? 1 : 0) | (object.required ? 2 : 0) | (object.multiline ? 1 << 12 : 0) |
    (object.fieldType === "radio" ? (1 << 14) | (1 << 15) : 0) | (object.fieldType === "dropdown" ? 1 << 17 : 0) | (object.multiSelect ? 1 << 21 : 0);
  const onValue = object.onValue ?? "Yes", value = object.value !== undefined ? object.value : object.defaultValue ?? (button ? object.fieldType === "checkbox" ? false : "Off" : "");
  const checked = value === true || value === onValue;
  return { id: object.id, name: object.id, pageIndex: 0, sourcePageIndex: object.pageIndex, annotationIndex: 0, subtype: "Widget",
    pdfGeometry: { rect: [object.x, object.y, object.x + object.width, object.y + object.height] },
    bounds: { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height },
    flags: 4, visibleInDefaultView: true, hasAppearance: true, tooltip: object.tooltip,
    border: { width: object.strokeWidth ?? 1, style: "S" }, color: normalizePrimitiveColor(object.borderColor ?? "#777777"),
    field: { type: button ? "Btn" : choice ? "Ch" : "Tx", name: object.name, flags, value,
      ...(object.defaultValue !== undefined ? { defaultValue: object.defaultValue } : {}),
      ...(!button && !choice ? { inputType: object.fieldType as "text" | "number" | "date" | "email" | "tel" | "url" } : {}),
      ...(object.maxLength === undefined ? {} : { maxLength: object.maxLength }), ...(object.options ? { options: object.options } : {}),
      alignment: object.align === "center" ? 1 : object.align === "right" ? 2 : 0,
      ...(button ? { onValue, appearanceState: checked ? onValue : "Off", buttonMark: object.fieldType === "radio" ? "circle" as const : "check" as const } : {}),
      textStyle: { fontFamily: object.fontFamily ?? "Liberation Sans", fontSize: object.fontSize ?? 0,
        fontWeight: object.fontWeight === "bold" ? 700 : typeof object.fontWeight === "number" ? object.fontWeight : 400,
        fontStyle: object.fontStyle === "italic" || object.fontStyle === "oblique" ? "italic" : "normal", color: normalizePrimitiveColor(object.color ?? 0),
        ascent: .8, descent: -.2, contentInset: Math.min(Math.max(1, (object.strokeWidth ?? 1) + 1), Math.min(object.width, object.height) * .2) } } };
}

/** Compile ordinary vectors and shaped text, then attach standard widget ownership. */
export async function compileEditorFieldGeometry(object: EditorFieldObject,
  compile: (object: EditorObject, signal?: AbortSignal, textLayout?: EditorTextLayoutOptions) => Promise<VectorScene>, signal?: AbortSignal): Promise<VectorScene> {
  validateEditorFieldObject(object); signal?.throwIfAborted();
  const annotation = editorFieldAnnotation(object), button = annotation.field!.type === "Btn", radio = object.fieldType === "radio";
  const borderWidth = Math.min(object.strokeWidth ?? 1, object.width, object.height), half = borderWidth / 2;
  const base: EditorShapeObject = { kind: "shape", shape: radio ? "ellipse" : "rectangle", id: object.id, pageIndex: 0, transform: EDITOR_IDENTITY,
    x: object.x + half, y: object.y + half, width: object.width - borderWidth, height: object.height - borderWidth,
    color: object.borderColor ?? "#777777", fill: object.fill === undefined ? "#ffffff" : object.fill,
    strokeWidth: borderWidth, opacity: borderWidth === 0 ? 0 : object.opacity, fillOpacity: object.opacity ?? 1 };
  const parts = [await compile(base, signal)], inset = Math.min(Math.max(1, (object.strokeWidth ?? 1) + 1), Math.min(object.width, object.height) * .2);
  setEditorPaintRole(parts[0], ref => ref.kind === "fill" || ref.kind === "gradient-fill" ? "fill" : null);
  if (button && annotation.field!.appearanceState !== "Off") {
    const mark = await compile(radio ? { ...base, x: object.x + object.width * .25, y: object.y + object.height * .25,
      width: object.width * .5, height: object.height * .5, color: object.color ?? 0, fill: object.color ?? 0, strokeWidth: 0, opacity: object.opacity, fillOpacity: object.opacity ?? 1 }
      : { ...base, shape: "polyline", points: [[object.x + object.width * .2, object.y + object.height * .5],
        [object.x + object.width * .43, object.y + object.height * .25], [object.x + object.width * .82, object.y + object.height * .78]],
        fill: null, color: object.color ?? 0, strokeWidth: Math.min(object.width, object.height) * .1, opacity: object.opacity }, signal);
    setEditorPaintRole(mark, ref => ref.kind === "raster" ? null : "color"); parts.push(mark);
  } else if (!button) {
    const value = annotation.field!.value, values = Array.isArray(value) ? value : [String(value ?? "")];
    let text = values.map(value => object.options?.find(option => option.value === value)?.label ?? value).join("");
    const availableWidth = Math.max(.01, object.width - inset * 2), availableHeight = Math.max(.01, object.height - inset * 2);
    const list = object.fieldType === "list", size = object.fontSize || (list ? Math.min(12, availableHeight) : 12), leading = size * 1.2;
    const selectedRows = new Set<number>();
    const visibleOptions = list ? (object.options ?? []).slice(0, Math.max(1, Math.ceil(availableHeight / leading))) : [];
    if (list) {
      text = visibleOptions.map(option => option.label).join("\n");
      for (const [index, option] of visibleOptions.entries()) if (values.includes(option.value)) {
        selectedRows.add(index);
        const highlight = await compile({ ...base, shape: "rectangle", x: object.x + inset, y: Math.max(object.y + inset, object.y + object.height - inset - (index + 1) * leading),
          width: availableWidth, height: Math.min(leading, availableHeight - index * leading), fill: [0.153, 0.376, 0.616], strokeWidth: 0, opacity: 0, fillOpacity: object.opacity ?? 1 }, signal);
        setEditorPaintRole(highlight, () => null); parts.push(highlight);
      }
    } else if (!object.multiline) text = text.replace(/[\r\n]/g, "");
    if (text) {
      const geometry = await compile({ kind: "text", id: object.id, pageIndex: 0, transform: EDITOR_IDENTITY,
      x: object.x + inset, y: object.y + inset, width: availableWidth, height: availableHeight,
      text, fontSize: size, fontFamily: object.fontFamily, fontId: object.fontId, fontWeight: object.fontWeight,
        ...(list ? { runs: visibleOptions.map((option, index) => ({ text: option.label + (index + 1 < visibleOptions.length ? "\n" : ""), color: selectedRows.has(index) ? "#ffffff" : object.color ?? 0 })) } : {}),
        fontStyle: object.fontStyle, color: object.color, align: object.align, opacity: object.opacity, lineHeight: 1.2 }, signal,
      { wrap: Boolean(object.multiline), verticalAlignment: list || object.multiline ? "top" : "middle", autoFontSize: !list && !object.fontSize,
        onFontMetrics: metrics => Object.assign(annotation.field!.textStyle!, metrics) });
      setEditorPaintRole(geometry, ref => ref.kind === "raster" || list && ref.kind === "text" && selectedRows.has(Math.floor((object.y + object.height - inset - geometry.textInstanceB[ref.index * 4 + 1]) / leading)) ? null : "color");
      parts.push(geometry);
    }
  }
  const first = parts.shift()!, scene = composeEditorPage(first, parts);
  scene.pageRects = Float32Array.of(object.x, object.y, object.x + object.width, object.y + object.height);
  scene.bounds = scene.pageBounds = { ...annotation.bounds };
  const layers = new AnnotationLayerBuilder(scene.optionalContent, [...(scene.optionalContent?.conditions ?? [])]);
  const clips = scene.clipPaths = [...(scene.clipPaths ?? [])], clipFor = new Map<number, number>();
  const edges = Float32Array.of(object.x, object.y, object.x + object.width, object.y,
    object.x + object.width, object.y, object.x + object.width, object.y + object.height,
    object.x + object.width, object.y + object.height, object.x, object.y + object.height,
    object.x, object.y + object.height, object.x, object.y);
  scene.drawRuns = (scene.drawRuns ?? defaultVectorDrawRuns(scene)).map(run => {
    const parent = run.clipIndex ?? -1;
    let clipIndex = clipFor.get(parent);
    if (clipIndex === undefined) { clipIndex = clips.push({ parent, fillRule: 0, edges }) - 1; clipFor.set(parent, clipIndex); }
    return { ...run, clipIndex, optionalContent: layers.condition(run.optionalContent, object.id) };
  });
  scene.optionalContent = layers.build(); scene.annotations = [annotation];
  scene.pdfPages = [{ pageIndex: 0, sourcePageIndex: object.pageIndex, pdfToScene: [1, 0, 0, 1, 0, 0] }];
  setEditorAnnotationSource(scene, annotation); return scene;
}
