import type { EditorFieldValue, EditorObject, EditorSessionOptions, EditorTextObject } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { composeOverlappingVectorScenes, nativeVectorMissingFontResolver } from "./pdfVectorExtractor";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import { createBundledStandardFontResolver } from "./standardFontResolver";
import { createEditorFontRegistry } from "./editorFonts";
import { editorTextPdf } from "./editorText";
import { compileEditorObjectGeometry } from "./editorSceneObjects";
import { openPdf, type NativeVectorPdfSession } from "./pdfSession";
import { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter } from "./pdf/nativeWriter";
import { applyEditorPdfFields, readEditorFieldFrame, saveEditorNativePdf } from "./editorNativePdf";
import { transformWholeEditorScene, getEditorAnnotationTransform, getEditorAnnotationSource, getEditorAnnotationFrameTransform,
  multiplyEditorMatrices, invertEditorMatrix, editorTransformBounds, retainEditorAnnotationPlacements, setEditorAnnotationSource } from "./editorScene";
import { ScenePageViews } from "./scenePageViews";
import { remapEditorPaintIdentity, composeEditorPaintIdentity } from "./editorPaintIdentity";
import { extractEditorFieldAppearance, replaceEditorFieldAppearances } from "./editorFieldPaintOrder";
import { NativePdfFormAppearanceRegistry } from "./pdf/nativeForms";
import { NativePdfAnnotationMetadataRegistry } from "./pdf/nativeAnnotations";
import { createNativeOptionalContentRegistry } from "./pdf/nativeOptionalContent";
import { AnnotationLayerBuilder } from "./annotationLayers";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { createEditorFieldAppearanceReader } from "./editorFormAppearance";
import { createLoadYielder, waitForLoad } from "./loadCancellation";

export interface EditorAppServicesOptions {
  sourcePdf?: Uint8Array;
  password?: string;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  loadFontAsset?: (url: URL) => Promise<Uint8Array>;
  /** Completed source-page/widget preparation, normalized within this phase. */
  onPrepareProgress?: (value?: number) => void;
}
export interface EditorAppServices {
  sessionOptions: EditorSessionOptions;
  fonts: ReturnType<typeof createEditorFontRegistry>;
  /** Cached source protection metadata; also covers empty-password PDFs. */
  isSourceProtected(signal?: AbortSignal): Promise<boolean>;
  readTextAnnotation(annotationId: string, scene: VectorScene, signal?: AbortSignal,
    source?: { pdf?: Uint8Array; password?: string }): Promise<EditorTextObject | null>;
  dispose(): void;
}
/** Optional complete editing services. Import only after entering Edit mode. */
export async function createEditorAppServices(options: EditorAppServicesOptions = {}, sharedFonts?: EditorAppServices["fonts"]): Promise<EditorAppServices> {
  const nodeRuntime = typeof globalThis === "object" && !!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
  const fonts = sharedFonts ?? createEditorFontRegistry({ loadAsset: options.loadFontAsset ?? (nodeRuntime ? async url => {
    const moduleName = "node:fs/promises";
    const { readFile } = await import(/* @vite-ignore */ moduleName) as { readFile(url: URL): Promise<Uint8Array> };
    try { return new Uint8Array(await readFile(url)); }
    catch (error) {
      if ((error as { code?: string }).code !== "ENOENT" || new URL(import.meta.url).pathname.endsWith(".ts")) throw error;
      // SSR chunks can be relocated away from the published font assets.
      const name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
      const assetUrl = new URL(name, import.meta.resolve("@soadzoor/hepr/node"));
      return new Uint8Array(await readFile(assetUrl));
    }
  } : undefined) });
  let missingFontResolver: Promise<NativeMissingFontResolver> | undefined;
  const getMissingFontResolver = () => missingFontResolver ??= options.loadFontAsset
    ? Promise.resolve(createBundledStandardFontResolver({ loadAsset: async (asset, signal) => {
      signal?.throwIfAborted(); return options.loadFontAsset!(asset.url);
    } }))
    : nativeVectorMissingFontResolver();
  let disposed = false;
  const servicesLifetime = new AbortController();
  let sourceProtected: boolean | undefined = options.sourcePdf ? undefined : false, protectionProbe: Promise<boolean> | undefined;
  type FieldAppearancePages = Map<number, Map<string, VectorScene>>;
  let fieldAppearanceCache: { key: string; sourcePdf: Uint8Array; password?: string; controller: AbortController;
    waiters: number; promise: Promise<FieldAppearancePages> } | undefined;
  const sourceServices = new Set<EditorAppServices>();
  const diagnostic = (message: string) => options.onDiagnostic?.({ code: "editor.appearance-regenerated", severity: "warning", message });
  const compileObject = async (object: EditorObject, signal?: AbortSignal): Promise<VectorScene> => {
    signal?.throwIfAborted();
    if (object.kind !== "text") return compileEditorObjectGeometry(object, signal);
    const bytes = await editorTextPdf(object, fonts, signal);
    const parser = await openPdf({ kind: "bytes", bytes }, { signal });
    try { return await (parser as NativeVectorPdfSession).compileVectorPage(0, { signal,
      optimization: "none" }); }
    finally { await parser.close(); }
  };
  const compileFields = async (scene: VectorScene, values: ReadonlyMap<string, EditorFieldValue>, signal?: AbortSignal): Promise<VectorScene> => {
    signal = signal ? AbortSignal.any([signal, servicesLifetime.signal]) : servicesLifetime.signal;
    signal?.throwIfAborted();
    values = new Map([...values].map(([name, value]) => [name, Array.isArray(value) ? value.slice() : value]));
    const targets = (scene.annotations ?? []).filter(annotation => annotation.field?.name && values.has(annotation.field.name));
    const partition = new ScenePageViews(scene);
    const pages = Array.from({ length: scene.pageCount }, (_, i) => {
      const view = partition.extract(i); remapEditorPaintIdentity(scene, view.scene, view.primitives); return view.scene;
    });
    const additions: Map<string, VectorScene | null>[] = Array.from({ length: scene.pageCount }, () => new Map());
    let appearances: FieldAppearancePages | undefined;
    if (options.sourcePdf) {
      const requests = new Map<number, Set<string>>();
      for (const annotation of targets) {
        const sourceIndex = scene.pdfPages?.find(page => page.pageIndex === annotation.pageIndex)?.sourcePageIndex ?? annotation.pageIndex;
        let ids = requests.get(sourceIndex); if (!ids) requests.set(sourceIndex, ids = new Set()); ids.add(annotation.id);
      }
      const key = JSON.stringify([[...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => [name, typeof value, value]),
        [...requests].sort(([a], [b]) => a - b).map(([page, ids]) => [page, [...ids].sort()])]);
      const sourcePdf = options.sourcePdf, password = options.password;
      if (!fieldAppearanceCache || fieldAppearanceCache.key !== key || fieldAppearanceCache.sourcePdf !== sourcePdf || fieldAppearanceCache.password !== password) {
        // Cache only canonical appearances. Each consumer still applies its
        // current field transforms, page placement, clipping and paint slots.
        const previous = fieldAppearanceCache, controller = new AbortController(), capturedValues = values;
        const sharedSignal = AbortSignal.any([servicesLifetime.signal, controller.signal]);
        const promise = (async (): Promise<FieldAppearancePages> => {
          const document = await NativePdfDocument.open({ kind: "bytes", bytes: sourcePdf }, { password, signal: sharedSignal });
          let bytes: Uint8Array;
          try { const writer = new NativePdfWriter(document); await applyEditorPdfFields(writer, capturedValues, fonts,
            { signal: sharedSignal, onWarning: diagnostic }); bytes = await writer.save(sharedSignal); }
          finally { await document.close(); }
          // Regenerated appearances can still reference nonembedded source fonts.
          const parser = await openPdf({ kind: "bytes", bytes }, { password, signal: sharedSignal,
            missingFontResolver: await getMissingFontResolver(), onDiagnostic: options.onDiagnostic }) as NativeVectorPdfSession;
          try {
            const result: FieldAppearancePages = new Map();
            for (const [page, ids] of requests) {
              sharedSignal.throwIfAborted();
              const updated = await parser.compileVectorPage(page, { signal: sharedSignal, optimization: "none" });
              result.set(page, new Map([...ids].map(id => [id, extractEditorFieldAppearance(updated, id, sharedSignal)])));
            }
            return result;
          } finally { await parser.close(); }
        })();
        fieldAppearanceCache = { key, sourcePdf, password, controller, waiters: 0, promise };
        if (previous && !previous.waiters) previous.controller.abort();
        void promise.catch(() => { if (fieldAppearanceCache?.promise === promise) fieldAppearanceCache = undefined; });
      }
      const entry = fieldAppearanceCache; entry.waiters++;
      try { appearances = await waitForLoad(entry.promise, signal); }
      finally { if (!--entry.waiters && entry !== fieldAppearanceCache) entry.controller.abort(); }
    }
    for (let index = 0; index < pages.length; index++) {
      signal?.throwIfAborted();
      const annotations = targets.filter(annotation => annotation.pageIndex === index); if (!annotations.length) continue;
      const origin = [scene.pageRects[index * 4], scene.pageRects[index * 4 + 1]] as const;
      if (appearances) {
        const sourceIndex = scene.pdfPages?.find(page => page.pageIndex === index)?.sourcePageIndex ?? index;
        for (const annotation of annotations) {
          const appearance = appearances.get(sourceIndex)!.get(annotation.id)!;
          const delta = getEditorAnnotationTransform(scene, annotation.id) ?? [1, 0, 0, 1, 0, 0];
          additions[index].set(annotation.id, transformWholeEditorScene(appearance, multiplyEditorMatrices(delta, [1, 0, 0, 1, ...origin]), signal));
        }
      } else for (const annotation of annotations) {
        if (annotation.flags & (1 | 2 | 32)) { additions[index].set(annotation.id, null); continue; }
        const source = getEditorAnnotationSource(scene, annotation.id) ?? annotation;
        const delta = getEditorAnnotationFrameTransform(scene, annotation.id) ?? [1, 0, 0, 1, 0, 0];
        const field = annotation.field!, value = values.get(field.name!)!, r = source.bounds;
        const x = r.minX - origin[0], y = r.minY - origin[1], width = r.maxX - r.minX, height = r.maxY - r.minY;
        let object: EditorObject;
        if (field.type === "Btn") {
          const selected = value === true || String(value) === (field.onValue ?? "Yes");
          if (!selected) { additions[index].set(annotation.id, null); continue; }
          object = { kind: "shape", shape: field.flags & (1 << 15) ? "ellipse" : "line", id: annotation.id, pageIndex: index,
            transform: [1, 0, 0, 1, 0, 0], x: x + width * .2, y: y + height * .2, width: width * .6, height: height * .6,
            fill: 0, color: 0, strokeWidth: 1 };
        } else object = { kind: "text", id: annotation.id, pageIndex: index, transform: [1, 0, 0, 1, 0, 0],
          x: x + 2, y: y + 2, width: Math.max(1, width - 4), height: Math.max(1, height - 4),
          text: Array.isArray(value) ? value.join("\n") : String(value ?? ""), fontSize: Math.min(12, height * .6) };
        const geometry = await compileObject(object, signal);
        const layers = new AnnotationLayerBuilder(geometry.optionalContent, [...(geometry.optionalContent?.conditions ?? [])]);
        geometry.drawRuns = (geometry.drawRuns ?? defaultVectorDrawRuns(geometry)).map(run => ({ ...run,
          optionalContent: layers.condition(run.optionalContent, annotation.id) }));
        geometry.optionalContent = layers.build();
        additions[index].set(annotation.id, transformWholeEditorScene(geometry, multiplyEditorMatrices(delta, [1, 0, 0, 1, ...origin]), signal));
      }
    }
    const preserveNonText = !options.sourcePdf ? new Set(targets.filter(annotation => annotation.field?.type === "Tx").map(annotation => annotation.id)) : undefined;
    const updatedPages = pages.map((page, index) => replaceEditorFieldAppearances(page, additions[index], { preserveNonText, signal }));
    const result = composeOverlappingVectorScenes(updatedPages); composeEditorPaintIdentity(updatedPages, result);
    result.annotations = scene.annotations?.map(annotation => annotation.field?.name && values.has(annotation.field.name)
      ? { ...annotation, field: { ...annotation.field, value: values.get(annotation.field.name)! } } : annotation);
    result.pdfPages = scene.pdfPages; result.sourcePdfByteLength = scene.sourcePdfByteLength; result.pagesPerRow = scene.pagesPerRow;
    retainEditorAnnotationPlacements(scene, result);
    return result;
  };
  const sessionOptions: EditorSessionOptions = {
    sourcePdf: options.sourcePdf, password: options.password, loadFontAsset: options.loadFontAsset,
    compileObject, compileFields, onDiagnostic: options.onDiagnostic,
    captureRecoveryFonts: async () => fonts.list().map(font => ({ ...font, bytes: font.bytes.slice() })),
    restoreRecoveryFonts: async (assets, signal) => {
      for (const asset of assets) { signal?.throwIfAborted(); const registered = await fonts.register(asset.bytes, asset);
        if (registered.id !== asset.id) throw new Error("A recovered font does not match its recorded bytes."); }
      signal?.throwIfAborted();
    },
    createSourceOptions: async (sourcePdf, password) => {
      if (disposed) throw new Error("Editor services are disposed.");
      const services = await createEditorAppServices({ ...options, sourcePdf, password }, fonts);
      if (disposed) { services.dispose(); throw new Error("Editor services are disposed."); }
      sourceServices.add(services);
      return { ...services.sessionOptions, disposeSource: () => {
        sourceServices.delete(services); services.dispose();
      } };
    },
    prepareScene: async (scene, signal) => {
      signal?.throwIfAborted();
      options.onPrepareProgress?.(0);
      if (!options.sourcePdf || !scene.annotations?.some(annotation => annotation.field)) { options.onPrepareProgress?.(1); return scene; }
      const yieldProgress = options.onPrepareProgress ? createLoadYielder(signal) : undefined;
      const document = await NativePdfDocument.open({ kind: "bytes", bytes: options.sourcePdf }, { password: options.password, signal });
      sourceProtected = Boolean(document.getWriterState().protection);
      try {
        const forms = new NativePdfFormAppearanceRegistry(document);
        const optional = await createNativeOptionalContentRegistry(document, { signal });
        const registry = new NativePdfAnnotationMetadataRegistry(document, forms, optional, options.onDiagnostic ?? (() => {}), true);
        const fields = new Map<string, NonNullable<NonNullable<VectorScene["annotations"]>[number]["field"]>>();
        const frames = new Map<string, NonNullable<Awaited<ReturnType<typeof readEditorFieldFrame>>>>();
        const sourcePages = new Set(scene.annotations.filter(annotation => annotation.field).map(annotation => annotation.sourcePageIndex));
        const styles = createEditorFieldAppearanceReader(document, fonts, await getMissingFontResolver(), options.onDiagnostic);
        let completedPages = 0;
        for (const page of sourcePages) {
          for (const annotation of await registry.getPageAnnotations(page, signal)) if (annotation.field) fields.set(annotation.id, annotation.field);
          const widgets = (await forms.listPageAnnotations(page, signal)).filter(annotation => fields.has(annotation.id));
          for (let index = 0; index < widgets.length; index++) {
            const annotation = widgets[index], field = fields.get(annotation.id)!;
            const frame = await readEditorFieldFrame(document, annotation, signal);
            const textStyle = await styles.read(frame ? { ...annotation, rectangle: frame.rect } : annotation, signal);
            if (field && textStyle) fields.set(annotation.id, { ...field, textStyle });
            if (frame) frames.set(annotation.id, frame);
            options.onPrepareProgress?.((completedPages + (index + 1) / widgets.length) / sourcePages.size);
            if (yieldProgress) await yieldProgress();
          }
          completedPages++;
          options.onPrepareProgress?.(completedPages / sourcePages.size);
          if (yieldProgress) await yieldProgress();
        }
        const result = { ...scene, annotations: scene.annotations.map(annotation => fields.has(annotation.id)
          ? { ...annotation, field: fields.get(annotation.id) } : annotation) };
        retainEditorAnnotationPlacements(scene, result);
        for (const annotation of result.annotations) {
          const frame = frames.get(annotation.id), mapping = scene.pdfPages?.find(page => page.pageIndex === annotation.pageIndex)?.pdfToScene;
          if (!frame || !mapping) continue;
          const [minX, minY, maxX, maxY] = frame.rect;
          const original = { ...annotation, pdfGeometry: { ...annotation.pdfGeometry, rect: frame.rect },
            bounds: editorTransformBounds({ minX, minY, maxX, maxY }, mapping) };
          setEditorAnnotationSource(result, original, multiplyEditorMatrices(mapping, multiplyEditorMatrices(frame.transform, invertEditorMatrix(mapping))));
        }
        options.onPrepareProgress?.(1);
        return result;
      } finally { await document.close(); }
    },
    savePdf: async (scene, session, saveOptions) => saveEditorNativePdf(scene, session, saveOptions,
      { fonts, password: options.password, missingFontResolver: await getMissingFontResolver(), compileObject })
  };
  return { sessionOptions, fonts,
    async isSourceProtected(signal) {
      if (disposed) throw new Error("Editor services are disposed.");
      signal?.throwIfAborted();
      if (sourceProtected !== undefined) return sourceProtected;
      if (!protectionProbe) {
        protectionProbe = (async () => {
          const document = await NativePdfDocument.open({ kind: "bytes", bytes: options.sourcePdf! }, { password: options.password, signal: servicesLifetime.signal });
          try { return sourceProtected = Boolean(document.getWriterState().protection); }
          finally { await document.close(); }
        })();
        void protectionProbe.catch(() => { protectionProbe = undefined; });
      }
      return waitForLoad(protectionProbe, signal);
    },
    async readTextAnnotation(annotationId: string, scene: VectorScene, signal?: AbortSignal,
      source?: { pdf?: Uint8Array; password?: string }) {
      const sourcePdf = source ? source.pdf : options.sourcePdf, password = source ? source.password : options.password;
      if (!sourcePdf) return null;
      const { readEditorTextAnnotation } = await import("./editorTextAnnotations");
      const object = await readEditorTextAnnotation(sourcePdf, annotationId, fonts, { password, signal });
      const annotation = scene.annotations?.find(item => item.id === annotationId);
      return object && annotation ? { ...object, pageIndex: annotation.pageIndex } : null;
    },
    dispose() {
      if (disposed) return; disposed = true;
      servicesLifetime.abort(); fieldAppearanceCache = undefined;
      for (const services of sourceServices) services.dispose(); sourceServices.clear();
      if (!sharedFonts) fonts.dispose();
    } };
}
