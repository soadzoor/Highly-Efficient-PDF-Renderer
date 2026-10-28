import type { AnnotationFieldTextStyle } from "./annotationData";
import type { EditorFont, EditorFontRegistry } from "./editorFonts";
import { convertDeviceCmykToSrgb } from "./pdf/deviceCmyk";
import { parseDefaultAppearance } from "./pdf/nativeAppearanceSynthesis";
import { isPdfDictionary, isPdfName, isPdfStream, type PdfDictionary, type PdfValue } from "./pdf/nativeCos";
import type { NativePdfDocument } from "./pdf/nativeDocument";
import { parseNativePdfFont, type NativeMissingFontResolution, type NativeMissingFontResolver, type NativePdfFont } from "./pdf/nativeFont";
import type { NativePdfAnnotationAppearance } from "./pdf/nativeForms";
import { throwIfAborted, type PdfDiagnostic } from "./pdf/nativeTypes";

type FieldFont = Pick<AnnotationFieldTextStyle, "fontFamily" | "fontWeight" | "fontStyle" | "ascent" | "descent">;

/** Resolve typing fonts only when editing, retaining font programs in the session registry. */
export function createEditorFieldAppearanceReader(document: NativePdfDocument, fonts: EditorFontRegistry,
  missingFontResolver: NativeMissingFontResolver, onDiagnostic?: (diagnostic: PdfDiagnostic) => void): {
    read(annotation: NativePdfAnnotationAppearance, signal?: AbortSignal): Promise<AnnotationFieldTextStyle | undefined>;
  } {
  const cache = new WeakMap<PdfDictionary, Map<string, Promise<FieldFont>>>();
  const warning = (annotation: NativePdfAnnotationAppearance, message: string): void => onDiagnostic?.({
    code: "editor.field-font-approximated", severity: "warning", pageIndex: annotation.pageIndex,
    message, details: { annotationIndex: annotation.annotationIndex }
  });
  const fallback = async (font?: NativePdfFont): Promise<EditorFont> => fonts.loadBundled(
    font?.style.fixedPitch ? "Liberation Mono" : font?.style.serif ? "Liberation Serif" : font?.style.family ?? font?.baseFont ?? "Liberation Sans",
    { fontWeight: font?.style.weight ?? 400, fontStyle: font?.style.italic ? "italic" : "normal" });
  const contentInset = async (annotation: NativePdfAnnotationAppearance, signal?: AbortSignal): Promise<number> => {
    const mk = await document.resolveValue(annotation.dictionary.get("MK"), signal);
    if (!isPdfDictionary(mk)) return 1;
    const color = await document.resolveValue(mk.get("BC"), signal);
    if (!Array.isArray(color) || ![1, 3, 4].includes(color.length)) return 1;
    const components = await Promise.all(color.map(component => document.resolveValue(component, signal)));
    if (components.some(component => typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 1)) return 1;
    const bs = await document.resolveValue(annotation.dictionary.get("BS"), signal);
    let width: PdfValue | undefined = 1;
    if (bs !== undefined && bs !== null) {
      if (!isPdfDictionary(bs)) return 1;
      const style = await document.resolveValue(bs.get("S"), signal);
      if (style !== undefined && style !== null && (!isPdfName(style) || !["S", "D", "U"].includes(style.value))) return 1;
      width = await document.resolveValue(bs.get("W"), signal) ?? 1;
    } else {
      const border = await document.resolveValue(annotation.dictionary.get("Border"), signal);
      if (border !== undefined && border !== null) {
        if (!Array.isArray(border) || ![3, 4].includes(border.length)) return 1;
        const horizontal = await document.resolveValue(border[0], signal), vertical = await document.resolveValue(border[1], signal);
        if (horizontal !== 0 || vertical !== 0) return 1;
        width = await document.resolveValue(border[2], signal);
      }
    }
    if (typeof width !== "number" || !Number.isFinite(width) || width < 0) return 1;
    const [left, bottom, right, top] = annotation.rectangle;
    const limit = Math.min(Math.abs(right - left), Math.abs(top - bottom));
    return Math.max(1, Math.min(width, Math.max(0, limit)) + 1);
  };
  const embeddedProgram = async (rawFont: PdfValue, signal?: AbortSignal): Promise<Uint8Array | undefined> => {
    let dictionary = await document.resolveValue(rawFont, signal);
    if (!isPdfDictionary(dictionary)) return undefined;
    if (isPdfName(dictionary.get("Subtype"), "Type0")) {
      const descendants = await document.resolveValue(dictionary.get("DescendantFonts"), signal);
      dictionary = Array.isArray(descendants) && descendants.length ? await document.resolveValue(descendants[0], signal) : undefined;
      if (!isPdfDictionary(dictionary)) return undefined;
    }
    const descriptor = await document.resolveValue(dictionary.get("FontDescriptor"), signal);
    if (!isPdfDictionary(descriptor)) return undefined;
    for (const key of ["FontFile2", "FontFile3"]) {
      const stream = await document.resolveValue(descriptor.get(key), signal);
      if (isPdfStream(stream)) return document.decodeStream(stream, signal);
    }
    return undefined;
  };
  const prepareFont = async (annotation: NativePdfAnnotationAppearance, resources: PdfDictionary,
    resourceName: string, signal?: AbortSignal): Promise<FieldFont> => {
    const fontResources = await document.resolveDictionary(resources.get("Font"), signal);
    const rawFont = fontResources.get(resourceName);
    if (!rawFont) throw new Error(`AcroForm font /${resourceName} is missing.`);
    let resolution: NativeMissingFontResolution | null = null;
    const parsed = await parseNativePdfFont(rawFont, document, { signal, onDiagnostic,
      missingFontResolver: async (request, loadSignal) => resolution = await missingFontResolver(request, loadSignal) });
    let registered: EditorFont | undefined;
    try {
      const replacement = resolution as NativeMissingFontResolution | null;
      const bytes = replacement instanceof Uint8Array ? replacement : replacement?.sfntBytes ?? await embeddedProgram(rawFont, signal);
      if (replacement && !(replacement instanceof Uint8Array) && replacement.faceIndex) throw new Error("A collection font face cannot be used directly by form inputs.");
      if (bytes) registered = await fonts.register(bytes, { family: parsed.baseFont || parsed.style.family || undefined,
        fontWeight: parsed.style.weight, fontStyle: parsed.style.italic ? "italic" : "normal" });
    } catch (error) {
      throwIfAborted(signal);
      warning(annotation, `Form font ${parsed.baseFont || resourceName} cannot be used by browser inputs; a bundled face is used: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!registered) {
      registered = await fallback(parsed);
      if (!parsed.substitution) warning(annotation, `Form font ${parsed.baseFont || resourceName} is approximated by ${registered.family} while typing.`);
    }
    throwIfAborted(signal);
    const ascent = parsed.descriptor.ascent / 1000, descent = parsed.descriptor.descent / 1000;
    return { fontFamily: registered.family, fontWeight: Math.max(1, Math.min(1000, parsed.style.weight)),
      fontStyle: parsed.style.italic ? "italic" : "normal",
      ascent: Number.isFinite(ascent) && Number.isFinite(descent) && ascent > descent ? ascent : .8,
      descent: Number.isFinite(ascent) && Number.isFinite(descent) && ascent > descent ? descent : -.2 };
  };
  return { async read(annotation, signal) {
    throwIfAborted(signal);
    const widget = annotation.widget;
    if (!widget || !["Tx", "Ch"].includes(widget.fieldType ?? "") || !widget.defaultAppearance) return undefined;
    try {
      const appearance = parseDefaultAppearance(widget.defaultAppearance.bytes, annotation);
      const resources = widget.acroForm?.defaultResources, name = appearance.fontResourceName;
      let font: FieldFont;
      if (resources && name) {
        let entries = cache.get(resources);
        if (!entries) { entries = new Map(); cache.set(resources, entries); }
        let pending = entries.get(name);
        if (!pending) {
          pending = prepareFont(annotation, resources, name, signal).catch(error => { entries!.delete(name); throw error; });
          entries.set(name, pending);
        }
        font = await pending;
      } else {
        const face = await fallback();
        font = { fontFamily: face.family, fontWeight: face.fontWeight, fontStyle: face.fontStyle, ascent: .8, descent: -.2 };
        warning(annotation, "The field's default appearance has no usable font resource; a bundled sans-serif face is used while typing.");
      }
      throwIfAborted(signal);
      const components = appearance.color.components;
      const color = components.length === 1 ? [components[0], components[0], components[0]]
        : components.length === 4 ? convertDeviceCmykToSrgb(components[0], components[1], components[2], components[3]) : [...components];
      return { ...font, fontSize: appearance.fontSize, color, contentInset: await contentInset(annotation, signal) };
    } catch (error) {
      throwIfAborted(signal);
      warning(annotation, `The field's typing style could not be recovered: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  } };
}
