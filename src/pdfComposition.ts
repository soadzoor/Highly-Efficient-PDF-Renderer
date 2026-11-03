import type { EditorMatrix } from "./editorTypes";
import type * as T from "./pdfCompositionTypes";
import { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter, pdfNameValue, pdfTextValue, pdfAsciiValue, pdfStreamValue, serializePdfValue } from "./pdf/nativeWriter";
import { isPdfDictionary, isPdfRef, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import { createEditorAppServices } from "./editorAppServices";
import { createBundledStandardFontResolver } from "./standardFontResolver";
import { nativeVectorMissingFontResolver } from "./pdfVectorExtractor";
import { createLoadProgressReporter } from "./loadProgress";
import { PdfByteWriter, pdfNumber as n } from "./editorPdfBytes";
import { normalizePrimitiveColor } from "./colorInput";
import { decodeRasterImageToRgba } from "./rasterImageCodec";
import { pdfPathOperators, pdfRectanglePath, pdfEllipsePath, parseSvgPath } from "./pdfCompositionPath";
import { prepareCompositionSourcePage, collectCompositionSourceLinks, type CompositionSourceLink } from "./pdfCompositionImport";
import { importNativePdfValue } from "./pdfNativeImport";
import { prepareCompositionText, compositionTextPdf, compositionOpacity, validateCompositionText } from "./pdfCompositionText";
import { writeScenePdf } from "./editorPdfWriter";
import { resolvePdfLinkUrl } from "./viewerLinkNavigation";
import { waitForLoad } from "./loadCancellation";

const IDENTITY: EditorMatrix = [1, 0, 0, 1, 0, 0];
type ImageData = { handle: T.PdfCompositionImage; data: Uint8Array };
type SourceData = { handle: T.PdfCompositionSource; document: NativePdfDocument };
type Command = { kind: "raw"; operators: string }
  | { kind: "path"; operators: string; paint: T.PdfCompositionPaint }
  | { kind: "image"; image: ImageData; options: T.PdfCompositionRectangle & { opacity?: number; transform?: EditorMatrix } }
  | { kind: "text"; text: string; options: T.PdfCompositionTextOptions | T.PdfCompositionTextBox; box: boolean };
type Link = { points: number[]; target: T.PdfCompositionLink | CompositionSourceLink["target"]; source?: SourceData };
type PageData = { width: number; height: number; source?: SourceData; sourceIndex?: number; background: boolean;
  toNative: EditorMatrix; commands: Command[]; links: Link[]; viewport?: T.PdfCompositionRectangle; depth: number };

function finite(values: readonly number[]): void {
  if (!values.every(Number.isFinite)) throw new RangeError("PDF geometry must be finite.");
}
function matrix(input: EditorMatrix = IDENTITY): EditorMatrix {
  if (!Array.isArray(input) || input.length !== 6) throw new TypeError("A transform requires six numbers.");
  finite(input); const determinant = input[0] * input[3] - input[1] * input[2];
  if (!Number.isFinite(determinant) || determinant === 0) throw new RangeError("A transform must be invertible.");
  return [...input] as unknown as EditorMatrix;
}
function multiply(a: EditorMatrix, b: EditorMatrix): EditorMatrix {
  return matrix([a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]);
}
function inverse(m: EditorMatrix): EditorMatrix {
  const d = m[0] * m[3] - m[1] * m[2];
  return matrix([m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]);
}
function transformPoints(points: readonly number[], m: EditorMatrix): number[] {
  const result: number[] = [];
  for (let i = 0; i < points.length; i += 2) result.push(m[0] * points[i] + m[2] * points[i + 1] + m[4], m[1] * points[i] + m[3] * points[i + 1] + m[5]);
  finite(result); return result;
}
function rectangle(input: T.PdfCompositionRectangle): T.PdfCompositionRectangle {
  const { x, y, width, height } = input; finite([x, y, width, height, x + width, y + height]);
  if (width <= 0 || height <= 0) throw new RangeError("PDF rectangle dimensions must be positive.");
  return { x, y, width, height };
}
function corners(r: T.PdfCompositionRectangle): number[] {
  return [r.x, r.y + r.height, r.x + r.width, r.y + r.height, r.x, r.y, r.x + r.width, r.y];
}
function bounds(points: readonly number[]): number[] {
  let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
  for (let i = 0; i < points.length; i += 2) { left = Math.min(left, points[i]); right = Math.max(right, points[i]); bottom = Math.min(bottom, points[i + 1]); top = Math.max(top, points[i + 1]); }
  return [left, bottom, right, top];
}
function cm(m: EditorMatrix = IDENTITY): string { return `${m.map(n).join(" ")} cm`; }
function rule(value: T.PdfCompositionPaint["fillRule"]): void {
  if (value !== undefined && value !== "nonzero" && value !== "evenodd") throw new TypeError("Unknown fill rule.");
}
function paint(input: T.PdfCompositionPaint): T.PdfCompositionPaint {
  const result = structuredClone(input);
  if (result.fill != null) result.fill = normalizePrimitiveColor(result.fill);
  if (result.stroke != null) result.stroke = normalizePrimitiveColor(result.stroke);
  compositionOpacity(result.fillOpacity); compositionOpacity(result.strokeOpacity); rule(result.fillRule);
  if (result.strokeWidth !== undefined && (!Number.isFinite(result.strokeWidth) || result.strokeWidth < 0)) throw new RangeError("Stroke width must be nonnegative.");
  if (result.miterLimit !== undefined && (!Number.isFinite(result.miterLimit) || result.miterLimit < 1)) throw new RangeError("Miter limit must be at least one.");
  if (result.lineCap !== undefined && !["butt", "round", "square"].includes(result.lineCap)) throw new TypeError("Unknown line cap.");
  if (result.lineJoin !== undefined && !["miter", "round", "bevel"].includes(result.lineJoin)) throw new TypeError("Unknown line join.");
  if (result.dashArray !== undefined && (!Array.isArray(result.dashArray) || !result.dashArray.every(value => Number.isFinite(value) && value >= 0) || result.dashArray.length > 0 && !result.dashArray.some(value => value > 0))) throw new RangeError("Dash lengths must be nonnegative with at least one positive length.");
  if (result.dashPhase !== undefined) finite([result.dashPhase]);
  if (result.transform) result.transform = matrix(result.transform);
  return result;
}
function seedPdf(metadata: NonNullable<T.PdfCompositionOptions["metadata"]>): Uint8Array {
  const writer = new PdfByteWriter(), root = writer.reserve(), pages = writer.reserve();
  writer.set(root, `<< /Type /Catalog /Pages ${pages} 0 R >>`); writer.set(pages, "<< /Type /Pages /Kids [] /Count 0 >>");
  const info = new Map<string, PdfValue>();
  for (const key of ["title", "author", "subject", "keywords", "creator", "producer"] as const)
    if (metadata[key] !== undefined) info.set(key[0].toUpperCase() + key.slice(1), pdfTextValue(metadata[key]!));
  for (const key of ["creationDate", "modificationDate"] as const) if (metadata[key]) {
    const date = metadata[key]!;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError("PDF dates must be valid Date objects.");
    info.set(key === "creationDate" ? "CreationDate" : "ModDate", pdfAsciiValue(`D:${date.toISOString().slice(0, 19).replace(/[-:T]/g, "")}Z`));
  }
  const reference = writer.add(serializePdfValue(info));
  return writer.build(root, `/Info ${reference} 0 R`);
}
/** Headless, ordered page composition; no canvas, renderer, or editor models are created. */
export async function createPdfDocument(options: T.PdfCompositionOptions = {}): Promise<T.PdfDocumentComposer> {
  const settings = { ...options, metadata: structuredClone({ producer: "HEPR", creationDate: new Date(), ...options.metadata }) };
  settings.signal?.throwIfAborted(); seedPdf(settings.metadata);
  const services = await createEditorAppServices({ loadFontAsset: settings.loadFontAsset, onDiagnostic: settings.onDiagnostic });
  if (settings.signal?.aborted) { services.dispose(); settings.signal.throwIfAborted(); }
  const lifetime = new AbortController(), pending = new Set<Promise<unknown>>();
  const sources = new Map<T.PdfCompositionSource, SourceData>(), images = new Map<T.PdfCompositionImage, ImageData>(), imageKeys = new Map<string, T.PdfCompositionImage>();
  const pages: PageData[] = []; let disposed = false, disposal: Promise<void> | undefined;
  const live = () => { if (disposed) throw new Error("The PDF composer is disposed."); settings.signal?.throwIfAborted(); };
  const operation = <R>(work: (signal: AbortSignal) => Promise<R>, signal?: AbortSignal): Promise<R> => {
    live(); const combined = AbortSignal.any([lifetime.signal, ...(settings.signal ? [settings.signal] : []), ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const result = waitForLoad(Promise.resolve().then(() => { combined.throwIfAborted(); return work(combined); }), combined);
    pending.add(result); void result.then(() => pending.delete(result), () => pending.delete(result)); return result;
  };
  const sourceHandle = (document: NativePdfDocument): T.PdfCompositionSource => {
    const dimensions = document.pages.map(page => { const { pageBounds: b } = computeNativePdfPageGeometry(page); return Object.freeze({ width: b.maxX - b.minX, height: b.maxY - b.minY }); });
    const handle = Object.freeze({ id: `pdf-source-${sources.size + 1}`, pages: Object.freeze(dimensions) });
    sources.set(handle, { handle, document }); return handle;
  };
  const makePage = (data: PageData): T.PdfCompositionPage => {
    const pageIndex = pages.length; pages.push(data); let current: EditorMatrix = IDENTITY; const stack: EditorMatrix[] = [];
    const raw = (operators: string) => { live(); data.commands.push({ kind: "raw", operators }); };
    const api: T.PdfCompositionPage = {
      pageIndex, width: data.width, height: data.height,
      drawPath(commands, style) { live(); const operators = pdfPathOperators(commands), normalized = paint(style); data.commands.push({ kind: "path", operators, paint: normalized }); },
      drawSvgPath(d, style) {
        if (style.svgYAxis !== undefined && style.svgYAxis !== "up" && style.svgYAxis !== "down") throw new TypeError("Unknown SVG Y axis.");
        api.drawPath(parseSvgPath(d), { ...style, transform: style.svgYAxis === "up" ? style.transform : multiply(matrix(style.transform), [1, 0, 0, -1, 0, 0]) });
      },
      drawRectangle(style) { const r = rectangle(style); api.drawPath(pdfRectanglePath(r.x, r.y, r.width, r.height), style); },
      drawEllipse(style) { const r = rectangle(style); api.drawPath(pdfEllipsePath(r.x, r.y, r.width, r.height), style); },
      drawText(text, style) {
        live(); validateCompositionText(text, style); finite([style.x, style.y]); if (style.transform) matrix(style.transform);
        data.commands.push({ kind: "text", text, options: structuredClone(style), box: false });
      },
      drawTextBox(style) {
        live(); rectangle(style); validateCompositionText(style.text, style); if (style.transform) matrix(style.transform);
        if (style.align !== undefined && !["left", "center", "right"].includes(style.align)) throw new TypeError("Unknown text alignment.");
        if (style.verticalAlignment !== undefined && !["top", "middle", "bottom"].includes(style.verticalAlignment)) throw new TypeError("Unknown vertical alignment.");
        data.commands.push({ kind: "text", text: style.text, options: structuredClone(style), box: true });
      },
      drawImage(handle, style) {
        live(); const image = images.get(handle); if (!image) throw new TypeError("Use an image registered with this composer.");
        rectangle(style); compositionOpacity(style.opacity); if (style.transform) matrix(style.transform);
        data.commands.push({ kind: "image", image, options: structuredClone(style) });
      },
      saveState() { raw("q"); stack.push(current); data.depth++; },
      restoreState() { live(); if (!stack.length) throw new Error("No saved PDF graphics state to restore."); current = stack.pop()!; data.depth--; raw("Q"); },
      transform(input) { const next = matrix(input); raw(cm(next)); current = multiply(current, next); },
      clipPath(commands, fillRule) { rule(fillRule); raw(`${pdfPathOperators(commands)}${fillRule === "evenodd" ? "W*" : "W"} n`); },
      clipRectangle(input) { const r = rectangle(input); api.clipPath(pdfRectanglePath(r.x, r.y, r.width, r.height)); },
      addLink(input, target) {
        live(); const r = rectangle(input);
        if (target.type === "url") {
          const url = typeof target.url === "string" ? resolvePdfLinkUrl(target.url) : null;
          if (!url) throw new TypeError("Use an absolute HTTP, HTTPS, mailto or tel link.");
          target = { type: "url", url };
        }
        else if (target.type !== "page" || !Number.isSafeInteger(target.pageIndex) || target.pageIndex < 0) throw new TypeError("Invalid PDF link target.");
        else { if (target.x !== undefined) finite([target.x]); if (target.y !== undefined) finite([target.y]); }
        data.links.push({ points: transformPoints(corners(r), current), target: structuredClone(target) });
      },
      setViewport(input) { live(); data.viewport = rectangle(input); }
    };
    return Object.freeze(api);
  };
  const composer: T.PdfDocumentComposer = {
    fonts: services.fonts,
    registerImage(input) {
      live(); const snapshot = "encoding" in input ? { ...input, bytes: input.bytes.slice() } : { ...input, data: new Uint8Array(input.data) };
      return operation(async signal => {
        const decoded = "encoding" in snapshot ? await decodeRasterImageToRgba(snapshot.encoding, snapshot.bytes) : snapshot;
        signal.throwIfAborted();
        if (!decoded || !Number.isSafeInteger(decoded.width) || !Number.isSafeInteger(decoded.height) || decoded.width <= 0 || decoded.height <= 0 || !Number.isSafeInteger(decoded.width * decoded.height * 4) || decoded.data.length !== decoded.width * decoded.height * 4) throw new TypeError("Supply a valid PNG, JPEG or complete RGBA image.");
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", decoded.data.slice().buffer)); signal.throwIfAborted();
        const key = `${decoded.width}:${decoded.height}:` + [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("");
        const previous = imageKeys.get(key); if (previous) return previous;
        const handle = Object.freeze({ id: `pdf-image-${images.size + 1}`, width: decoded.width, height: decoded.height });
        images.set(handle, { handle, data: decoded.data }); imageKeys.set(key, handle); return handle;
      });
    },
    importPdf(bytes, input = {}) {
      live(); const snapshot = bytes.slice(), password = input.password;
      return operation(async signal => {
        const document = await NativePdfDocument.open({ kind: "bytes", bytes: snapshot }, { password, signal, onDiagnostic: settings.onDiagnostic });
        try { signal.throwIfAborted(); return sourceHandle(document); } catch (error) { await document.close(); throw error; }
      }, input.signal);
    },
    importScene(scene, input = {}) {
      return operation(async signal => {
        const blob = await writeScenePdf(scene, { ...input, signal, onDiagnostic: input.onDiagnostic ?? settings.onDiagnostic });
        const document = await NativePdfDocument.open({ kind: "bytes", bytes: new Uint8Array(await blob.arrayBuffer()) }, { signal });
        try { signal.throwIfAborted(); return sourceHandle(document); } catch (error) { await document.close(); throw error; }
      }, input.signal);
    },
    addPage(size) {
      live(); const r = rectangle({ x: 0, y: 0, ...size });
      return makePage({ width: r.width, height: r.height, background: false, toNative: IDENTITY, commands: [], links: [], depth: 0 });
    },
    addSourcePage(handle, index, input = {}) {
      live(); const source = sources.get(handle); if (!source) throw new TypeError("Use a PDF source imported by this composer.");
      if (!Number.isSafeInteger(index) || index < 0 || index >= handle.pages.length) throw new RangeError("Source page index is outside the document.");
      const { width, height } = handle.pages[index], { pageMatrix, pageBounds } = computeNativePdfPageGeometry(source.document.getPage(index));
      const toNative = inverse(multiply([1, 0, 0, 1, -pageBounds.minX, -pageBounds.minY], pageMatrix));
      return makePage({ width, height, source, sourceIndex: index, background: input.background !== false, toNative, commands: [], links: [], depth: 0 });
    },
    measureText(text, input) {
      live(); const style = structuredClone(input); validateCompositionText(text, style);
      return operation(async signal => (await prepareCompositionText(text, style, services.fonts, signal, settings.onDiagnostic)).metrics);
    },
    save(input = {}) {
      live(); const snapshot = pages.map(page => ({ ...page, commands: page.commands.slice(), links: page.links.slice(), viewport: page.viewport && { ...page.viewport } }));
      if (!snapshot.length) return Promise.reject(new RangeError("Add at least one page before saving."));
      if (snapshot.some(page => page.depth)) return Promise.reject(new Error("Restore every saved graphics state before saving."));
      return operation(signal => saveComposition(snapshot, settings, input, services.fonts, signal), input.signal);
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true; lifetime.abort(new DOMException("The PDF composer was disposed.", "AbortError"));
      disposal = (async () => { await Promise.allSettled([...pending]); await Promise.all([...sources.values()].map(source => source.document.close()));
        services.dispose(); sources.clear(); images.clear(); imageKeys.clear(); pages.length = 0; })();
      return disposal;
    }
  };
  return composer;
}

async function packedStream(writer: NativePdfWriter, data: Uint8Array, dictionary: PdfDictionary, signal: AbortSignal): Promise<PdfRef> {
  signal.throwIfAborted();
  if (data.length && typeof CompressionStream === "function") {
    const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new CompressionStream("deflate"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer()); signal.throwIfAborted();
    if (packed.length < data.length) return writer.add(pdfStreamValue(packed, new Map([...dictionary, ["Filter", pdfNameValue("FlateDecode")]])));
  }
  return writer.add(pdfStreamValue(data, dictionary));
}

async function saveComposition(pages: PageData[], settings: T.PdfCompositionOptions, input: T.PdfCompositionSaveOptions,
  fonts: T.PdfDocumentComposer["fonts"], signal: AbortSignal): Promise<Blob> {
  const progress = createLoadProgressReporter(input.onProgress ?? settings.onProgress), onDiagnostic = input.onDiagnostic ?? settings.onDiagnostic;
  progress.report(0, { stage: "compile", sourceType: "scene", pageCount: pages.length });
  const seed = await NativePdfDocument.open({ kind: "bytes", bytes: seedPdf(settings.metadata ?? {}) }, { signal });
  try {
    const writer = new NativePdfWriter(seed), root = seed.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef)!;
    const tree = writer.add(null), refs = pages.map(() => writer.add(null)), imports = new Map<SourceData, Map<string, PdfRef>>();
    const imageRefs = new Map<ImageData, PdfRef>(), alphas = new Map<string, PdfRef>();
    const missingFontResolver = settings.loadFontAsset ? createBundledStandardFontResolver({ loadAsset: asset => settings.loadFontAsset!(asset.url) })
      : await nativeVectorMissingFontResolver();
    const alpha = (fill = 1, stroke = 1) => {
      const key = `${fill}:${stroke}`; let ref = alphas.get(key);
      if (!ref) { ref = writer.add(new Map<string, PdfValue>([["Type", pdfNameValue("ExtGState")], ["ca", fill], ["CA", stroke]])); alphas.set(key, ref); } return ref;
    };
    const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value) ? writer.get(value) ?? seed.resolveValue(value, signal) : value;
    for (let index = 0; index < pages.length; index++) {
      signal.throwIfAborted(); const page = pages[index]; let dictionary: PdfDictionary, resources: PdfDictionary, background: Uint8Array | undefined;
      let links = page.links.slice();
      if (page.source && page.background) {
        let shared = imports.get(page.source); if (!shared) { shared = new Map(); imports.set(page.source, shared); }
        const imported = await prepareCompositionSourcePage(page.source.document, page.sourceIndex!, writer, shared, { signal, onDiagnostic, missingFontResolver });
        dictionary = imported.dictionary; resources = imported.resources; background = imported.content;
        const sourceLinks = await collectCompositionSourceLinks(page.source.document, page.sourceIndex!, { signal, onDiagnostic });
        links = [...sourceLinks.map(link => ({ points: [...link.quadPoints ?? corners(link.rect)], target: link.target, source: page.source })), ...links];
      } else {
        dictionary = new Map<string, PdfValue>([["Type", pdfNameValue("Page")], ["MediaBox", [0, 0, page.width, page.height]]]); resources = new Map();
        if (page.source) {
          const original = page.source.document.getPage(page.sourceIndex!);
          for (const [key, value] of [["MediaBox", original.mediaBox], ["CropBox", original.cropBox], ["BleedBox", original.bleedBox], ["TrimBox", original.trimBox], ["ArtBox", original.artBox]] as const)
            if (value) dictionary.set(key, [...value]);
          dictionary.set("Rotate", original.rotation); dictionary.set("UserUnit", original.userUnit);
        }
      }
      const resourceNames = new Map<string, string>(); let resourceCount = 0;
      const attach = async (kind: string, reference: PdfRef): Promise<string> => {
        const key = `${kind}:${reference.objectNumber}`; const known = resourceNames.get(key); if (known) return known;
        const raw = await resolve(resources.get(kind)), entries = new Map(isPdfDictionary(raw) ? raw : []);
        let name = `HEPRComposition${++resourceCount}`; while (entries.has(name)) name += "_";
        entries.set(name, reference); resources.set(kind, entries); resourceNames.set(key, name); return name;
      };
      const ops = ["q", cm(page.toNative)];
      for (let commandIndex = 0; commandIndex < page.commands.length; commandIndex++) {
        signal.throwIfAborted(); const command = page.commands[commandIndex];
        if (command.kind === "raw") ops.push(command.operators);
        else if (command.kind === "path") {
          const style = command.paint, fill = style.fill != null, stroke = style.stroke != null;
          if (!command.operators || !fill && !stroke) continue;
          ops.push("q", cm(style.transform), `/${await attach("ExtGState", alpha(style.fillOpacity, style.strokeOpacity))} gs`);
          if (fill) ops.push(`${normalizePrimitiveColor(style.fill!).map(n).join(" ")} rg`);
          if (stroke) ops.push(`${normalizePrimitiveColor(style.stroke!).map(n).join(" ")} RG`, `${n(style.strokeWidth ?? 1)} w`,
            `${["butt", "round", "square"].indexOf(style.lineCap ?? "butt")} J`, `${["miter", "round", "bevel"].indexOf(style.lineJoin ?? "miter")} j`,
            `${n(style.miterLimit ?? 10)} M`, `[${(style.dashArray ?? []).map(n).join(" ")}] ${n(style.dashPhase ?? 0)} d`);
          ops.push(command.operators, fill && stroke ? style.fillRule === "evenodd" ? "B*" : "B" : fill ? style.fillRule === "evenodd" ? "f*" : "f" : "S", "Q");
        } else if (command.kind === "image") {
          let reference = imageRefs.get(command.image);
          if (!reference) {
            const { width, height } = command.image.handle, data = command.image.data, rgb = new Uint8Array(width * height * 3), mask = new Uint8Array(width * height); let hasAlpha = false;
            for (let p = 0; p < mask.length; p++) { if (p % 16384 === 0) signal.throwIfAborted(); rgb.set(data.subarray(p * 4, p * 4 + 3), p * 3); mask[p] = data[p * 4 + 3]; hasAlpha ||= mask[p] !== 255; }
            const imageDictionary: PdfDictionary = new Map<string, PdfValue>([["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Image")], ["Width", width], ["Height", height], ["ColorSpace", pdfNameValue("DeviceRGB")], ["BitsPerComponent", 8]]);
            if (hasAlpha) imageDictionary.set("SMask", await packedStream(writer, mask, new Map([...imageDictionary, ["ColorSpace", pdfNameValue("DeviceGray")]]), signal));
            reference = await packedStream(writer, rgb, imageDictionary, signal); imageRefs.set(command.image, reference);
          }
          const o = command.options;
          ops.push("q", cm(o.transform), `/${await attach("ExtGState", alpha(o.opacity, o.opacity))} gs`, cm([o.width, 0, 0, o.height, o.x, o.y]), `/${await attach("XObject", reference)} Do`, "Q");
        } else {
          const o = command.options, box = command.box ? o as T.PdfCompositionTextBox : undefined;
          const prepared = await prepareCompositionText(command.text, o, fonts, signal, onDiagnostic, box);
          const bytes = await compositionTextPdf(prepared, fonts, signal, command.box), textSource = await NativePdfDocument.open({ kind: "bytes", bytes }, { signal });
          try {
            const sourcePage = textSource.getPage(0), shared = new Map<string, PdfRef>();
            const textResources = await importNativePdfValue(await textSource.resolveValue(sourcePage.resources, signal) ?? new Map(), textSource, writer, signal, shared);
            const chunks = await textSource.getDecodedPageContents(0, signal);
            const reference = writer.add(pdfStreamValue(chunks.map(chunk => new TextDecoder().decode(chunk)).join("\n"), new Map<string, PdfValue>([["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", prepared.bounds], ["Resources", textResources]])));
            ops.push("q", cm(o.transform), cm([1, 0, 0, 1, o.x, o.y]), `/${await attach("XObject", reference)} Do`, "Q");
          } finally { await textSource.close(); }
        }
        if (commandIndex % 64 === 63) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      ops.push("Q");
      const content: PdfValue[] = []; if (background) content.push(await packedStream(writer, background, new Map(), signal));
      content.push(await packedStream(writer, new TextEncoder().encode(ops.join("\n")), new Map(), signal));
      dictionary.set("Contents", content); dictionary.set("Resources", resources); dictionary.set("Parent", tree);
      if (page.viewport) {
        const box = bounds(transformPoints(corners(page.viewport), page.toNative));
        for (const name of ["CropBox", "TrimBox", "BleedBox", "ArtBox"]) dictionary.set(name, box);
      }
      const annotations: PdfValue[] = [];
      for (const link of links) {
        const points = transformPoints(link.points, page.toNative), target = link.target; let action: PdfValue;
        if (target.type === "url") action = new Map<string, PdfValue>([["S", pdfNameValue("URI")], ["URI", pdfAsciiValue(encodeURI(target.url).replace(/%25([0-9a-f]{2})/gi, "%$1"))]]);
        else {
          const targetIndex = link.source ? pages.findIndex(candidate => candidate.source === link.source && candidate.sourceIndex === target.pageIndex) : target.pageIndex;
          if (targetIndex < 0 || targetIndex >= pages.length) { onDiagnostic?.({ code: "composition.link-target-missing", severity: "warning", pageIndex: index, message: "A link target page is absent from the output; its hotspot was omitted." }); continue; }
          const original = target as Extract<CompositionSourceLink["target"], { type: "page" }>;
          const point = transformPoints([target.x ?? 0, target.y ?? 0], pages[targetIndex].toNative);
          const destination: PdfValue[] = original.fit ? [refs[targetIndex], pdfNameValue(original.fit), ...original.parameters ?? []]
            : [refs[targetIndex], pdfNameValue("XYZ"), point[0], point[1], null];
          action = new Map<string, PdfValue>([["S", pdfNameValue("GoTo")], ["D", destination]]);
        }
        annotations.push(writer.add(new Map<string, PdfValue>([["Type", pdfNameValue("Annot")], ["Subtype", pdfNameValue("Link")], ["Rect", bounds(points)], ["QuadPoints", points], ["Border", [0, 0, 0]], ["F", 4], ["A", action]])));
      }
      if (annotations.length) dictionary.set("Annots", annotations);
      writer.set(refs[index], dictionary);
      progress.report(.95 * (index + 1) / pages.length, { stage: "pdf-page", sourceType: "scene", unit: "pages", pageIndex: index, pageCount: pages.length, processed: index + 1, total: pages.length });
    }
    writer.set(tree, new Map<string, PdfValue>([["Type", pdfNameValue("Pages")], ["Kids", refs], ["Count", pages.length]]));
    const current = writer.get(root), catalog = new Map(isPdfDictionary(current) ? current : seed.catalog); catalog.set("Pages", tree); writer.set(root, catalog);
    const bytes = await writer.save(signal, { rewrite: true }); signal.throwIfAborted();
    progress.complete({ sourceType: "scene", unit: "pages", processed: pages.length, total: pages.length, pageCount: pages.length });
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  } finally { await seed.close(); }
}
