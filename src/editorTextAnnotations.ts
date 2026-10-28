import type { EditorTextObject, EditorTextRun, EditorColor, EditorMatrix } from "./editorTypes";
import type { EditorFont, EditorFontRegistry } from "./editorFonts";
import { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfFormAppearanceRegistry, decodePdfString } from "./pdf/nativeForms";
import { isPdfDictionary, isPdfName, isPdfStream, isPdfString, type PdfDictionary, type PdfStream, type PdfValue } from "./pdf/nativeCos";
import { normalizePrimitiveColor } from "./colorInput";

export interface ReadEditorTextAnnotationOptions { readonly password?: string; readonly signal?: AbortSignal }

/** Read inert textbox metadata and its portable fonts from a saved PDF annotation. */
export async function readEditorTextAnnotation(sourcePdf: Uint8Array, annotationId: string, fonts: EditorFontRegistry,
  options: ReadEditorTextAnnotationOptions = {}): Promise<EditorTextObject | null> {
  options.signal?.throwIfAborted();
  const document = await NativePdfDocument.open({ kind: "bytes", bytes: sourcePdf }, options);
  try {
    const registry = new NativePdfFormAppearanceRegistry(document);
    for (const page of document.pages) for (const annotation of await registry.listPageAnnotations(page.sourcePageIndex, options.signal, true)) {
      if (annotation.id !== annotationId || annotation.subtype !== "FreeText") continue;
      const raw = await document.resolveValue(annotation.dictionary.get("HEPRText"), options.signal);
      if (!isPdfString(raw)) return null;
      let model: EditorTextObject | null;
      try { model = readTextModel(JSON.parse(decodePdfString(raw, page.sourcePageIndex, annotation.annotationIndex))); }
      catch { return null; }
      if (!model) return null;
      const styles = [model, ...(model.runs ?? []).map(run => ({ ...model, ...run }))];
      const registered: EditorFont[] = [], seenFonts = new Set<PdfDictionary>(), seenForms = new Set<PdfStream>();
      const resolve = (value: PdfValue | undefined) => document.resolveValue(value, options.signal);
      const registerFont = async (stream: PdfStream, descriptor: PdfDictionary): Promise<void> => {
        options.signal?.throwIfAborted();
        const bytes = await document.decodeStream(stream, options.signal);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
        const id = `font-${Array.from(digest, value => value.toString(16).padStart(2, "0")).join("")}`;
        const storedStyle = styles.find(style => style.fontId === id);
        const familyValue = await resolve(descriptor.get("FontFamily"));
        const family = storedStyle?.fontFamily || (isPdfString(familyValue)
          ? decodePdfString(familyValue, page.sourcePageIndex, annotation.annotationIndex) : undefined);
        const weight = await resolve(descriptor.get("FontWeight")), angle = await resolve(descriptor.get("ItalicAngle"));
        let font: EditorFont;
        try { font = await fonts.register(bytes, { ...(family ? { family } : {}),
          ...(typeof weight === "number" && Number.isFinite(weight) ? { fontWeight: weight } : {}),
          ...(typeof angle === "number" && Number.isFinite(angle) ? { fontStyle: angle === 0 ? "normal" : "italic" } : {}) }); }
        catch (error) {
          options.signal?.throwIfAborted();
          // An appearance can also reference legacy Type1/CFF fonts used by
          // decoration. Only portable OpenType faces can enter this editor.
          if (storedStyle) throw error;
          return;
        }
        if (!registered.some(candidate => candidate.id === font.id)) registered.push(font);
      };
      const visitFont = async (value: PdfValue): Promise<void> => {
        const font = await resolve(value); if (!isPdfDictionary(font) || seenFonts.has(font)) return;
        seenFonts.add(font);
        const descriptor = await resolve(font.get("FontDescriptor"));
        if (isPdfDictionary(descriptor)) for (const name of ["FontFile2", "FontFile3", "FontFile"]) {
          const file = await resolve(descriptor.get(name));
          if (isPdfStream(file)) await registerFont(file, descriptor);
        }
        const descendants = await resolve(font.get("DescendantFonts"));
        if (Array.isArray(descendants)) for (const descendant of descendants) await visitFont(descendant);
      };
      const visitResources = async (value: PdfValue | undefined): Promise<void> => {
        const resources = await resolve(value); if (!isPdfDictionary(resources)) return;
        const fontResources = await resolve(resources.get("Font"));
        if (isPdfDictionary(fontResources)) for (const font of fontResources.values()) await visitFont(font);
        const xObjects = await resolve(resources.get("XObject"));
        if (isPdfDictionary(xObjects)) for (const value of xObjects.values()) {
          const form = await resolve(value);
          if (!isPdfStream(form) || !isPdfName(form.dictionary.get("Subtype"), "Form") || seenForms.has(form)) continue;
          seenForms.add(form); await visitResources(form.dictionary.get("Resources") ?? resources);
        }
      };
      const appearances = await resolve(annotation.dictionary.get("AP"));
      if (isPdfDictionary(appearances)) for (const key of ["N", "R", "D"]) {
        const value = await resolve(appearances.get(key));
        const forms = isPdfDictionary(value) ? [...value.values()] : [value];
        for (const entry of forms) {
          const form = await resolve(entry);
          if (isPdfStream(form)) { seenForms.add(form); await visitResources(form.dictionary.get("Resources") ?? page.resources); }
        }
      }
      const known = (id?: string): boolean => {
        if (!id) return false;
        try { fonts.get(id); return true; } catch { return false; }
      };
      const choose = (style: EditorTextObject | (EditorTextRun & { fontWeight?: number | "normal" | "bold" })): string | undefined => {
        if (known(style.fontId)) return style.fontId;
        const family = style.fontFamily?.trim().toLowerCase();
        let candidates = family ? registered.filter(font => font.family.trim().toLowerCase() === family) : registered;
        if (!candidates.length && new Set(registered.map(font => font.family.trim().toLowerCase())).size === 1) candidates = registered;
        if (!candidates.length) {
          if (!model!.text && !(model!.runs?.some(run => run.text))) return undefined;
          throw new Error("The saved textbox's embedded font could not be restored.");
        }
        const weight = style.fontWeight === "bold" ? 700 : typeof style.fontWeight === "number" ? style.fontWeight : 400;
        const italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
        return candidates.reduce((best, font) => {
          const score = (candidate: EditorFont) => Math.abs(candidate.fontWeight - weight) + ((candidate.fontStyle === "italic") === italic ? 0 : 1000);
          return score(font) < score(best) ? font : best;
        }).id;
      };
      const original = { ...model }, fontId = choose(model);
      if (fontId) model.fontId = fontId; else delete model.fontId;
      if (model.runs) model.runs = model.runs.map(run => {
        const fontId = choose({ ...original, ...run });
        return fontId ? { ...run, fontId } : { ...run, fontId: undefined };
      });
      options.signal?.throwIfAborted();
      return model;
    }
    return null;
  } finally { await document.close(); }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Return only known data fields; no saved string is interpreted as code or HTML. */
function readTextModel(value: unknown): EditorTextObject | null {
  if (!record(value) || value.version !== 1 || !record(value.object)) return null;
  const input = value.object;
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value));
  if (input.kind !== "text" || typeof input.id !== "string" || !input.id || !Number.isSafeInteger(input.pageIndex) || (input.pageIndex as number) < 0 ||
      typeof input.text !== "string" || !finite(input.x) || !finite(input.y) || !finite(input.width) || !finite(input.height) ||
      input.width <= 0 || input.height <= 0 || !finite(input.fontSize) || input.fontSize <= 0 ||
      !Array.isArray(input.transform) || input.transform.length !== 6 || !input.transform.every(finite)) return null;
  const determinant = input.transform[0] * input.transform[3] - input.transform[1] * input.transform[2];
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const model: EditorTextObject = { kind: "text", id: input.id, pageIndex: input.pageIndex as number, text: input.text,
    x: input.x, y: input.y, width: input.width, height: input.height, fontSize: input.fontSize,
    transform: input.transform.slice() as unknown as EditorMatrix };
  const style = (input: Record<string, unknown>, target: EditorTextRun | EditorTextObject): boolean => {
    for (const key of ["fontFamily", "fontId"] as const) if (input[key] !== undefined) {
      if (typeof input[key] !== "string") return false;
      target[key] = input[key];
    }
    if (input.fontSize !== undefined) {
      if (!finite(input.fontSize) || input.fontSize <= 0) return false; target.fontSize = input.fontSize;
    }
    if (input.fontWeight !== undefined) {
      if (input.fontWeight !== "normal" && input.fontWeight !== "bold" && !finite(input.fontWeight)) return false;
      target.fontWeight = input.fontWeight as EditorTextRun["fontWeight"];
    }
    if (input.fontStyle !== undefined) {
      if (typeof input.fontStyle !== "string" || !["normal", "italic", "oblique"].includes(input.fontStyle)) return false;
      target.fontStyle = input.fontStyle as EditorTextRun["fontStyle"];
    }
    for (const key of ["underline", "strikethrough"] as const) if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") return false; target[key] = input[key];
    }
    if (input.color !== undefined) {
      if (!(typeof input.color === "string" || typeof input.color === "number" || Array.isArray(input.color))) return false;
      try { normalizePrimitiveColor(input.color as EditorColor); } catch { return false; }
      target.color = Array.isArray(input.color) ? [...input.color] as [number, number, number] : input.color;
    }
    return true;
  };
  if (!style(input, model)) return null;
  if (input.opacity !== undefined) {
    if (!finite(input.opacity) || input.opacity < 0 || input.opacity > 1) return null; model.opacity = input.opacity;
  }
  if (input.align !== undefined) {
    if (typeof input.align !== "string" || !["left", "center", "right"].includes(input.align)) return null; model.align = input.align as EditorTextObject["align"];
  }
  if (input.lineHeight !== undefined) {
    if (!finite(input.lineHeight) || input.lineHeight <= 0) return null; model.lineHeight = input.lineHeight;
  }
  if (input.runs !== undefined) {
    if (!Array.isArray(input.runs)) return null;
    const runs: EditorTextRun[] = [];
    for (const inputRun of input.runs) {
      if (!record(inputRun) || typeof inputRun.text !== "string") return null;
      const run: EditorTextRun = { text: inputRun.text }; if (!style(inputRun, run)) return null; runs.push(run);
    }
    model.runs = runs;
  }
  return model;
}
