import type { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter, pdfNameValue, pdfNumberValue, pdfStreamValue } from "./pdf/nativeWriter";
import { isPdfDictionary, isPdfRef, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import { NativePdfFormAppearanceRegistry, type NativePdfAnnotationAppearance } from "./pdf/nativeForms";
import { NativePdfAppearanceSynthesizer, resolveNativePdfAnnotationAppearanceWithSynthesis } from "./pdf/nativeAppearanceSynthesis";
import { computeNativePdfAnnotationPlacement } from "./pdf/nativeFormGeometry";
import { createNativeOptionalContentRegistry } from "./pdf/nativeOptionalContent";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import { PdfError, type PdfDiagnostic } from "./pdf/nativeTypes";
import { importNativePdfLayers, importNativePdfValue } from "./pdfNativeImport";
import { joinPdfBytes } from "./editorPdfBytes";
import { NativePdfAnnotationMetadataRegistry } from "./pdf/nativeAnnotations";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import { resolvePdfLinkUrl } from "./viewerLinkNavigation";

export interface CompositionSourceImportOptions {
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  missingFontResolver?: NativeMissingFontResolver;
}

/** Copy native page programs, then bake annotation appearances below subsequent artwork. */
export async function prepareCompositionSourcePage(source: NativePdfDocument, pageIndex: number,
  writer: NativePdfWriter, refs: Map<string, PdfRef>, options: CompositionSourceImportOptions = {}): Promise<{
    dictionary: PdfDictionary; content: Uint8Array; resources: PdfDictionary;
  }> {
  options.signal?.throwIfAborted();
  const page = source.getPage(pageIndex), encode = (text: string) => new TextEncoder().encode(text);
  await importNativePdfLayers(source, writer, refs, options.signal);
  const rawResources = await source.resolveValue(page.resources, options.signal);
  const importedResources = await importNativePdfValue(isPdfDictionary(rawResources) ? rawResources : new Map(), source, writer, options.signal, refs);
  const resources: PdfDictionary = new Map(isPdfDictionary(importedResources) ? importedResources : []);
  const dictionary: PdfDictionary = new Map<string, PdfValue>([["Type", pdfNameValue("Page")],
    ["MediaBox", [...page.mediaBox]], ["CropBox", [...page.cropBox]], ["Rotate", page.rotation], ["UserUnit", page.userUnit]]);
  for (const [key, value] of [["BleedBox", page.bleedBox], ["TrimBox", page.trimBox], ["ArtBox", page.artBox]] as const)
    if (value) dictionary.set(key, [...value]);
  const group = page.dictionary.get("Group");
  if (group !== undefined) dictionary.set("Group", await importNativePdfValue(group, source, writer, options.signal, refs));
  const chunks: Uint8Array[] = [encode("q\n")];
  for (const content of await source.getDecodedPageContents(pageIndex, options.signal)) chunks.push(content, encode("\n"));
  chunks.push(encode("Q\n"));
  const optionalContent = await createNativeOptionalContentRegistry(source, options);
  const registry = new NativePdfFormAppearanceRegistry(source, { ...options, optionalContent });
  const synthesizer = new NativePdfAppearanceSynthesizer(source, { ...options, optionalContent });
  const resolveOutput = async (value: PdfValue | undefined) => isPdfRef(value)
    ? writer.get(value) ?? await writer.document.resolveValue(value, options.signal) : value;
  const rawObjects = await resolveOutput(resources.get("XObject"));
  const objects: PdfDictionary = new Map(isPdfDictionary(rawObjects) ? rawObjects : []);
  let count = 0;
  for (const annotation of await registry.listPageAnnotations(pageIndex, options.signal)) {
    options.signal?.throwIfAborted();
    if (!annotation.visibleInDefaultView || annotation.subtype === "Popup") continue;
    if (annotation.optionalContent !== undefined) {
      const membership = await optionalContent.resolvePropertyValue(annotation.optionalContent, options.signal);
      if (membership && !membership.defaultVisible) continue;
    }
    try {
      let appearance;
      try { appearance = await resolveNativePdfAnnotationAppearanceWithSynthesis(registry, synthesizer, annotation, options.signal); }
      catch (error) {
        rethrowProcessingFailure(error, options.signal);
        const repairedDictionary = new Map(annotation.dictionary); repairedDictionary.delete("AP");
        appearance = await synthesizer.synthesize({ ...annotation, dictionary: repairedDictionary, hasAppearanceDictionary: false }, options.signal);
        options.onDiagnostic?.({ code: "composition.annotation-approximated", severity: "warning", pageIndex,
          message: "An unusable source annotation appearance was regenerated from its visible annotation properties.",
          details: { annotationIndex: annotation.annotationIndex, subtype: annotation.subtype,
            reason: error instanceof Error ? error.message : String(error) } });
      }
      if (!appearance) continue;
      const form = appearance.normalAppearance.form;
      const formDictionary = await importNativePdfValue(form.dictionary, source, writer, options.signal, refs) as PdfDictionary;
      for (const key of ["Filter", "DecodeParms", "Length"]) formDictionary.delete(key);
      formDictionary.set("Type", pdfNameValue("XObject")); formDictionary.set("Subtype", pdfNameValue("Form"));
      formDictionary.set("BBox", [...form.bbox]); formDictionary.set("Matrix", [...form.matrix]);
      formDictionary.set("Resources", await importNativePdfValue(form.resources, source, writer, options.signal, refs));
      const content = synthesizer.getDecodedFormContent(form) ?? await registry.decodeFormContent(form, options.signal);
      const reference = writer.add(pdfStreamValue(content, formDictionary));
      let name = `HEPRBackgroundAnnotation${++count}`; while (objects.has(name)) name += "_";
      objects.set(name, reference);
      const placement = computeNativePdfAnnotationPlacement(annotation, form, [1, 0, 0, 1, 0, 0]);
      chunks.push(encode(`q ${placement.invocationMatrix.map(pdfNumberValue).join(" ")} cm /${name} Do Q\n`));
      if ((annotation.flags & (8 | 16)) !== 0) options.onDiagnostic?.({ code: "composition.annotation-page-scaled", severity: "warning", pageIndex,
        message: "A source annotation with NoZoom or NoRotate was baked into page geometry.", details: { annotationIndex: annotation.annotationIndex } });
    } catch (error) {
      rethrowProcessingFailure(error, options.signal);
      // A damaged appearance must remain visibly represented in the static copy.
      chunks.push(encode(annotationPlaceholder(annotation)));
      options.onDiagnostic?.({ code: "composition.annotation-approximated", severity: "warning", pageIndex,
        message: "A source annotation appearance could not be copied; a bounded outline marks its visible area.",
        details: { annotationIndex: annotation.annotationIndex, subtype: annotation.subtype,
          reason: error instanceof Error ? error.message : String(error) } });
    }
  }
  if (objects.size) resources.set("XObject", objects);
  dictionary.set("Resources", resources);
  return { dictionary, content: joinPdfBytes(chunks), resources };
}

function rethrowProcessingFailure(error: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (error instanceof PdfError && ["resource-limit", "aborted", "closed", "source-changed", "source-read"].includes(error.code)) throw error;
}

function annotationPlaceholder(annotation: NativePdfAnnotationAppearance): string {
  const [x, y, right, top] = annotation.rectangle, width = right - x, height = top - y;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return "";
  return `q 0.5 G 0.5 w ${[x, y, width, height].map(pdfNumberValue).join(" ")} re S Q\n`;
}

export interface CompositionSourceLink {
  /** Displayed page coordinates, including source crop, rotation, and UserUnit. */
  rect: { x: number; y: number; width: number; height: number };
  quadPoints?: readonly number[];
  target: { type: "url"; url: string } | {
    type: "page"; pageIndex: number;
    /** Native source destination parameters, retained when importing the target page unchanged. */
    fit?: string; parameters?: readonly (number | null)[];
    /** Displayed coordinates for fully specified XYZ destinations. */
    x?: number; y?: number;
  };
}

/** Inert navigation only; action chains and source active actions are never copied. */
export async function collectCompositionSourceLinks(source: NativePdfDocument, pageIndex: number,
  options: CompositionSourceImportOptions = {}): Promise<readonly CompositionSourceLink[]> {
  options.signal?.throwIfAborted();
  const optionalContent = await createNativeOptionalContentRegistry(source, options);
  const forms = new NativePdfFormAppearanceRegistry(source, { ...options, optionalContent });
  const metadata = new NativePdfAnnotationMetadataRegistry(source, forms, optionalContent, diagnostic => options.onDiagnostic?.(diagnostic));
  const links: CompositionSourceLink[] = [];
  for (const annotation of await metadata.getPageAnnotations(pageIndex, options.signal)) {
    if (annotation.subtype !== "Link" || !annotation.visibleInDefaultView) continue;
    options.signal?.throwIfAborted();
    let target: CompositionSourceLink["target"] | undefined;
    if (annotation.action?.type === "URI" && annotation.action.uri && !/[\u0000-\u001f\u007f]/.test(annotation.action.uri)) {
      const url = resolvePdfLinkUrl(annotation.action.uri, undefined, annotation.action.uriBase);
      if (url) target = { type: "url", url };
    } else {
      const destination = annotation.action ? annotation.action.type === "GoTo" ? annotation.action.destination : undefined : annotation.destination;
      const counts: Record<string, number> = { Fit: 0, FitB: 0, FitH: 1, FitBH: 1, FitV: 1, FitBV: 1, FitR: 4, XYZ: 3 };
      const fit = destination?.fit ?? "Fit", parameters = [...destination?.parameters ?? []], count = counts[fit];
      if (destination?.sourcePageIndex !== undefined && count !== undefined && parameters.length <= count &&
          parameters.every(value => value === null || Number.isFinite(value))) {
        while (parameters.length < count) parameters.push(null);
        if (fit !== "FitR" || parameters.every(value => value !== null) && parameters[2]! > parameters[0]! && parameters[3]! > parameters[1]!) {
          target = { type: "page", pageIndex: destination.sourcePageIndex, fit, parameters };
          if (fit === "XYZ" && parameters[0] !== null && parameters[1] !== null) {
            const [a, b, c, d, e, f] = computeNativePdfPageGeometry(source.getPage(destination.sourcePageIndex)).pageMatrix;
            target.x = a * parameters[0]! + c * parameters[1]! + e; target.y = b * parameters[0]! + d * parameters[1]! + f;
          }
        }
      }
    }
    if (!target) {
      options.onDiagnostic?.({ code: "composition.source-link-omitted", severity: "warning", pageIndex,
        message: "A source link with an unsupported or unresolved destination was omitted from the exported copy.", details: { annotationIndex: annotation.annotationIndex } });
      continue;
    }
    const bounds = annotation.bounds;
    links.push({ rect: { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY },
      ...(annotation.quadPoints ? { quadPoints: [...annotation.quadPoints] } : {}), target });
  }
  return links;
}
