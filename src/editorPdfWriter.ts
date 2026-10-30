import type { Bounds, RasterLayer, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { PdfBlendMode } from "./heprDocumentData";
import type { ScenePaintGroup, ScenePaintMask, ScenePaintNode } from "./scenePaintGraph";
import { validateScenePaintGraph } from "./scenePaintGraph";
import { ScenePageViews } from "./scenePageViews";
import { defaultVectorDrawRuns, validateVectorDrawRuns } from "./vectorDrawOrder";
import { EditorPdfLayers } from "./editorPdfLayers";
import { rasterRepeatBounds, rasterRepeatMatrix } from "./rasterRepeat";
import { GRADIENT_LUT_WIDTH } from "./orderedGradientPaint";
import { PdfByteWriter, pdfNumber, pdfRef, pdfUtf16Hex } from "./editorPdfBytes";
import { createLoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import { validatePdfOutputProtection, type PdfOutputProtection } from "./pdf/pdfProtection";
import { writeScenePdfLinks } from "./editorPdfLinks";

export interface ScenePdfWriteOptions {
  readonly signal?: AbortSignal;
  readonly onWarning?: (message: string) => void;
  readonly onProgress?: LoadProgressCallback;
  /** Bake the default layer visibility into content instead of retaining PDF layers. */
  readonly flatten?: boolean;
  readonly protection?: PdfOutputProtection;
}

type Category = "Font" | "XObject" | "ExtGState" | "Shading" | "Pattern" | "Properties";
class Resources {
  private readonly entries = new Map<Category, Map<number, string>>();
  use(category: Category, reference: number): string {
    let entries = this.entries.get(category);
    if (!entries) { entries = new Map(); this.entries.set(category, entries); }
    let name = entries.get(reference);
    if (!name) { name = `${category[0]}${entries.size + 1}`; entries.set(reference, name); }
    return `/${name}`;
  }
  dictionary(): string {
    return `<< ${Array.from(this.entries, ([category, entries]) => `/${category} << ${Array.from(entries,
      ([reference, name]) => `/${name} ${pdfRef(reference)}`).join(" ")} >>`).join(" ")} >>`;
  }
}

type Matrix = readonly number[];
const numbers = (values: ArrayLike<number>): string => Array.from(values, pdfNumber).join(" ");
const box = (bounds: Bounds): string => numbers([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
const rectangle = (bounds: Bounds): string => `${numbers([bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY])} re\n`;
function inverse(matrix: Matrix): number[] {
  const [a, b, c, d, e, f] = matrix, determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) throw new RangeError("Cannot write a singular PDF paint transform.");
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

/** Rebuild a PDF from canonical rendering data; the source PDF is never required. */
export async function writeScenePdf(scene: VectorScene, options: ScenePdfWriteOptions = {}): Promise<Blob> {
  options = { ...options, protection: validatePdfOutputProtection(options.protection) };
  options.signal?.throwIfAborted();
  const outputProgress = createLoadProgressReporter(options.onProgress);
  const encrypt = options.protection?.mode === "password";
  const progress = encrypt ? outputProgress.child(0, .85) : outputProgress;
  progress.report(0, { stage: "compile", sourceType: "scene", unit: "pages", processed: 0, total: scene.pageCount, pageCount: scene.pageCount });
  validateVectorDrawRuns(scene); validateScenePaintGraph(scene);
  const writer = new PdfByteWriter(options), catalog = writer.reserve(), pages = writer.reserve();
  const layers = new EditorPdfLayers(writer, scene.optionalContent, options.flatten);
  const views = new ScenePageViews(scene), pageReferences = Array.from({ length: views.pageCount }, () => writer.reserve());
  const links = writeScenePdfLinks(writer, scene, pageReferences, { ...options,
    condition: index => layers.annotationCondition(scene.optionalContent, index) });
  for (let index = 0; index < views.pageCount; index++) {
    options.signal?.throwIfAborted();
    progress.report(.95 * index / views.pageCount, { stage: "pdf-page", sourceType: "scene", unit: "pages",
      processed: index, total: views.pageCount, pageIndex: index, pageCount: views.pageCount });
    const page = views.extract(index).scene;
    const exportPage = new ScenePdfPageWriter(writer, page, options, layers);
    const resources = new Resources();
    await exportPage.prepareText();
    progress.report(.95 * (index + .2) / views.pageCount, { stage: "pdf-text", sourceType: "scene", unit: "pages",
      processed: index, total: views.pageCount, pageIndex: index, pageCount: views.pageCount });
    const content = await exportPage.content(resources);
    const bounds = exportPage.bounds;
    const stream = await writer.stream(`q\n1 0 0 1 ${numbers([-bounds.minX, -bounds.minY])} cm\n${rectangle(bounds)}W n\n${content}Q\n`);
    const annotations = links.annotations.get(index);
    writer.set(pageReferences[index], `<< /Type /Page /Parent ${pdfRef(pages)} /MediaBox [0 0 ${numbers([bounds.maxX - bounds.minX, bounds.maxY - bounds.minY])}] ` +
      `/Resources ${resources.dictionary()} /Group << /S /Transparency /CS /DeviceRGB /I false /K false >> /Contents ${pdfRef(stream)} ${annotations?.length ? `/Annots [${annotations.map(pdfRef).join(" ")}]` : ""} >>`);
    progress.report(.95 * (index + 1) / views.pageCount, { stage: "pdf-page", sourceType: "scene", unit: "pages",
      processed: index + 1, total: views.pageCount, pageIndex: index, pageCount: views.pageCount });
  }
  writer.set(pages, `<< /Type /Pages /Count ${pageReferences.length} /Kids [${pageReferences.map(pdfRef).join(" ")}] >>`);
  writer.set(catalog, `<< /Type /Catalog /Pages ${pdfRef(pages)} ${layers.catalog()} ${links.names} >>`);
  let bytes = writer.build(catalog);
  if (encrypt) {
    progress.report(1, { stage: "compile", sourceType: "scene" });
    const { rewritePdfProtection } = await import("./editorPdfProtection"), protectionProgress = outputProgress.child(.85, 1);
    bytes = await rewritePdfProtection(bytes, options.protection, { signal: options.signal,
      onProgress: event => protectionProgress.report(event.value, { ...event, stage: event.stage === "complete" ? "compile" : event.stage }) });
  }
  outputProgress.complete({ sourceType: "scene", unit: "pages", processed: views.pageCount, total: views.pageCount, pageCount: views.pageCount });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

interface GlyphCode { font: number; code: number; scale: number }
interface GlyphDefinition { glyph: number; unicode: string; width: number; invisible?: boolean }
class ScenePdfPageWriter {
  readonly bounds: Bounds;
  private readonly runs: readonly VectorDrawRun[];
  private readonly glyphCodes = new Map<number, GlyphCode>();
  private readonly separatorAfter = new Set<number>();
  private separatorCode?: GlyphCode;
  private readonly fallbackCodes = new Map<number, GlyphCode>();
  private readonly fallbackStrings = new Map<number, string>();
  private readonly stateCache = new Map<string, number>();
  private readonly imageCache = new Map<RasterLayer, number>();
  private readonly gradientCache = new Map<string, number>();
  private readonly gradientMaskCache = new Map<string, number>();
  private readonly glyphPaths = new Map<string, number>();
  private readonly writer: PdfByteWriter;
  private readonly scene: VectorScene;
  private readonly options: ScenePdfWriteOptions;
  private readonly layers: EditorPdfLayers;
  private work = 0;
  private lastYield = performance.now();

  constructor(writer: PdfByteWriter, scene: VectorScene, options: ScenePdfWriteOptions, layers: EditorPdfLayers) {
    this.layers = layers;
    this.writer = writer; this.scene = scene; this.options = options;
    const rect = scene.pageRects;
    this.bounds = { minX: Math.min(rect[0], rect[2]), minY: Math.min(rect[1], rect[3]),
      maxX: Math.max(rect[0], rect[2]), maxY: Math.max(rect[1], rect[3]) };
    if (![...Object.values(this.bounds)].every(Number.isFinite) || this.bounds.maxX <= this.bounds.minX || this.bounds.maxY <= this.bounds.minY) {
      throw new RangeError("Cannot export a PDF page with invalid dimensions.");
    }
    this.runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
  }

  private async checkpoint(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (++this.work % 256 === 0 && performance.now() - this.lastYield > 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.lastYield = performance.now(); this.options.signal?.throwIfAborted();
    }
  }
  private conditional(content: string, condition: number | undefined, resources: Resources): string {
    return this.layers.wrap(content, this.scene.optionalContent, condition, reference => resources.use("Properties", reference));
  }

  async prepareText(): Promise<void> {
    const scene = this.scene, text = scene.textIndex?.pages[0], strings = new Map<number, string>(), advances = new Map<number, number>();
    if (text) for (let index = 0; index < text.text.length;) {
      const reference = text.charInstance[index];
      let end = index + 1;
      while (end < text.text.length && (text.charInstance[end] === reference || (reference <= -2 && text.charInstance[end] <= -2 &&
        sameQuad(text.fallbackQuads, -reference - 2, -text.charInstance[end] - 2)))) end++;
      if (reference >= 0 && !strings.has(reference)) strings.set(reference, text.text.slice(index, end));
      if (reference <= -2) this.fallbackStrings.set(-reference - 2,
        (this.fallbackStrings.get(-reference - 2) ?? "") + text.text.slice(index, end));
      index = end;
    }
    if (text) for (let index = 0; index < text.text.length;) {
      const reference = text.charInstance[index];
      let end = index + 1;
      while (end < text.text.length && text.charInstance[end] === reference) end++;
      let next = end;
      while (next < text.text.length && text.charInstance[next] === -1) next++;
      if (reference >= 0 && next > end) this.separatorAfter.add(reference);
      const following = text.charInstance[next];
      if (reference >= 0 && following >= 0 && following !== reference) {
        const offset = reference * 4, matrix = scene.textInstanceA.subarray(offset, offset + 4), determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        const dx = scene.textInstanceB[following * 4] - scene.textInstanceB[offset], dy = scene.textInstanceB[following * 4 + 1] - scene.textInstanceB[offset + 1];
        const advance = (matrix[3] * dx - matrix[2] * dy) / determinant, perpendicular = (matrix[0] * dy - matrix[1] * dx) / determinant;
        const glyph = Math.round(scene.textInstanceB[offset + 2]) * 4, height = scene.textGlyphMetaB[glyph + 1] - scene.textGlyphMetaA[glyph + 3];
        if (Number.isFinite(advance) && Number.isFinite(perpendicular) && Math.abs(perpendicular) <= Math.max(1, height) * .02) {
          // The compact scene retains exact pen positions and semantic word
          // boundaries. Use both rather than substituting outline ink width
          // for an advance or asking readers to guess every original space.
          advances.set(reference, advance);
        }
      }
      index = end;
    }
    const definitions: GlyphDefinition[] = [], definitionMap = new Map<string, number>(), instanceDefinitions: number[] = [];
    for (let instance = 0; instance < scene.textInstanceCount; instance++) {
      await this.checkpoint();
      const glyph = Math.round(scene.textInstanceB[instance * 4 + 2]), unicode = strings.get(instance) ?? "";
      // Some visual glyphs have no semantic character (for example, a second
      // outline in one shaped cluster). A PDF text code without ToUnicode can
      // acquire a replacement character in other readers. Paint those outlines
      // directly rather than inventing extraction data.
      if (!unicode) { instanceDefinitions.push(-1); continue; }
      const width = advances.get(instance) ?? Math.max(.000001, scene.textGlyphMetaB[glyph * 4] - scene.textGlyphMetaA[glyph * 4 + 2]);
      const key = `${glyph}:${width}:${unicode}`;
      if (!definitionMap.has(key)) { definitionMap.set(key, definitions.length); definitions.push({ glyph, unicode, width }); }
      instanceDefinitions.push(definitionMap.get(key)!);
    }
    const fallbackDefinitions = new Map<number, number>();
    for (const [reference, unicode] of this.fallbackStrings) {
      fallbackDefinitions.set(reference, definitions.length); definitions.push({ glyph: -1, unicode, width: 1, invisible: true });
    }
    const separatorDefinition = this.separatorAfter.size ? definitions.length : -1;
    if (separatorDefinition >= 0) definitions.push({ glyph: -1, unicode: " ", width: 1, invisible: true });
    const codes = new Map<number, GlyphCode>();
    for (let first = 0; first < definitions.length; first += 255) {
      const group = definitions.slice(first, first + 255), procedures: string[] = [], widths: string[] = [];
      const mappings: string[] = [];
      let minX = 0, minY = 0, maxX = 1, maxY = 1;
      for (let index = 0; index < group.length; index++) {
        await this.checkpoint();
        const definition = group[index], glyph = definition.glyph, offset = glyph * 4;
        const glyphBounds = glyph < 0 ? [0, 0, 1, 1] : [scene.textGlyphMetaA[offset + 2], scene.textGlyphMetaA[offset + 3],
          scene.textGlyphMetaB[offset], scene.textGlyphMetaB[offset + 1]];
        minX = Math.min(minX, glyphBounds[0]); minY = Math.min(minY, glyphBounds[1]);
        maxX = Math.max(maxX, glyphBounds[2]); maxY = Math.max(maxY, glyphBounds[3]);
        const width = definition.width, pathKey = `${glyph}:${width}`;
        let procedure = this.glyphPaths.get(pathKey);
        if (procedure === undefined) {
          const path = glyph < 0 ? "" : segmentPath(scene.textGlyphSegmentsA, scene.textGlyphSegmentsB,
            Math.round(scene.textGlyphMetaA[offset]), Math.round(scene.textGlyphMetaA[offset + 1]), true);
          procedure = await this.writer.stream(`${pdfNumber(width)} 0 ${numbers(glyphBounds)} d1\n${path}${path ? "f\n" : ""}`);
          this.glyphPaths.set(pathKey, procedure);
        }
        const code = index + 1;
        procedures.push(`/g${code} ${pdfRef(procedure)}`); widths.push(pdfNumber(width));
        if (definition.unicode) mappings.push(`<${code.toString(16).padStart(2, "0")}> ${pdfUtf16Hex(definition.unicode).replace("<feff", "<")}`);
      }
      const unicode = await this.writer.stream(`begincmap\n/CIDSystemInfo << /Registry (HEPR) /Ordering (Unicode) /Supplement 0 >> def\n/CMapName /HEPRUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <ff>\nendcodespacerange\n${cmapMappings(mappings)}endcmap\n`);
      // Retained outlines use their source font's design units. Normalize the
      // Type3 em as well as its paint transform: an identity FontMatrix makes
      // a 2048-unit glyph look correct, but tells readers its em is one unit,
      // causing ordinary sidebearings to become inferred word boundaries.
      const scale = Math.max(1, Math.ceil(Math.max(maxX - minX, maxY - minY, ...group.map(definition => Math.abs(definition.width)))));
      const font = this.writer.add(`<< /Type /Font /Subtype /Type3 /Name /HEPROutlines /FontBBox [${numbers([minX, minY, maxX, maxY])}] ` +
        `/FontMatrix [${pdfNumber(1 / scale)} 0 0 ${pdfNumber(1 / scale)} 0 0] /CharProcs << ${procedures.join(" ")} >> /Encoding << /Type /Encoding /Differences [1 ${group.map((_, index) => `/g${index + 1}`).join(" ")}] >> ` +
        `/FirstChar 1 /LastChar ${group.length} /Widths [${widths.join(" ")}] /Resources << >> /ToUnicode ${pdfRef(unicode)} >>`);
      group.forEach((_, index) => codes.set(first + index, { font, code: index + 1, scale }));
    }
    instanceDefinitions.forEach((definition, instance) => { if (definition >= 0) this.glyphCodes.set(instance, codes.get(definition)!); });
    for (const [reference, definition] of fallbackDefinitions) this.fallbackCodes.set(reference, codes.get(definition)!);
    this.separatorCode = codes.get(separatorDefinition);
  }

  async content(resources: Resources): Promise<string> {
    const nodes = this.scene.paintGraph?.roots ?? this.runs.map((_, runIndex): ScenePaintNode => ({ kind: "draw", runIndex }));
    return `${await this.nodes(nodes, resources)}${this.invisibleText(resources)}`;
  }

  private async nodes(nodes: readonly ScenePaintNode[], resources: Resources): Promise<string> {
    const chunks: string[] = [];
    for (const node of nodes) {
      await this.checkpoint();
      let content: string;
      if (node.kind === "group") content = await this.group(node, resources);
      else if (node.kind === "draw") content = await this.run(this.runs[node.runIndex], resources);
      else {
        // These pixels already include the renderer's selective compositing
        // correction. Replaying the whole retained page would duplicate paints.
        const run = this.runs.find(value => value.kind === "raster" && value.first === node.rasterIndex && value.count === 1);
        if (!run) throw new Error("A retained PDF island has no canonical raster run.");
        content = await this.run(run, resources);
      }
      chunks.push(this.conditional(content, node.optionalContent, resources));
    }
    return chunks.join("");
  }

  private async run(run: VectorDrawRun, resources: Resources): Promise<string> {
    if (run.pdfRepresentation && !run.pdfRepresentation.detail) return "";
    const chunks = ["q\n", this.clip(run.clipIndex)];
    for (let index = run.first; index < run.first + run.count; index++) {
      await this.checkpoint();
      if (run.kind === "fill") chunks.push(await this.fill(index, false, run.blendMode, resources));
      else if (run.kind === "stroke") chunks.push(await this.stroke(index, false, run.blendMode, resources));
      else if (run.kind === "text") chunks.push(this.text(index, run.blendMode, resources));
      else if (run.kind === "raster") chunks.push(await this.image(index, run.blendMode, resources));
      else if (run.kind === "gradient-fill") chunks.push(await this.fill(index, true, run.blendMode, resources));
      else chunks.push(await this.gradientStroke(index, resources));
    }
    chunks.push("Q\n"); return this.conditional(chunks.join(""), run.optionalContent, resources);
  }

  private clip(index?: number): string {
    if (index === undefined || index < 0) return "";
    const result: string[] = [], visited = new Set<number>();
    for (let current = index; current >= 0;) {
      if (visited.has(current)) throw new Error("Cyclic PDF clip chain.");
      visited.add(current);
      const clip = this.scene.clipPaths?.[current];
      if (!clip) throw new RangeError("Unknown PDF clip path.");
      result.push(`${edgePath(clip.edges)}${clip.fillRule ? "W*" : "W"} n\n`); current = clip.parent;
    }
    return result.join("");
  }

  private state(resources: Resources, alpha = 1, blend: PdfBlendMode = "Normal", extra = ""): string {
    const key = `${alpha}:${blend}:${extra}`;
    let reference = this.stateCache.get(key);
    if (reference === undefined) {
      reference = this.writer.add(`<< /Type /ExtGState /ca ${pdfNumber(alpha)} /CA ${pdfNumber(alpha)} /BM /${blend} ${extra} >>`);
      this.stateCache.set(key, reference);
    }
    return `${resources.use("ExtGState", reference)} gs\n`;
  }

  private async fill(index: number, gradient: boolean, blend: PdfBlendMode | undefined, resources: Resources): Promise<string> {
    const scene = this.scene, offset = index * 4;
    const a = gradient ? scene.gradientFillPathMetaA : scene.fillPathMetaA,
      b = gradient ? scene.gradientFillPathMetaB : scene.fillPathMetaB,
      c = gradient ? scene.gradientFillPathMetaC : scene.fillPathMetaC;
    const path = segmentPath(gradient ? scene.gradientFillSegmentsA : scene.fillSegmentsA,
      gradient ? scene.gradientFillSegmentsB : scene.fillSegmentsB, Math.round(a[offset]), Math.round(a[offset + 1]), true);
    const paint = gradient ? scene.gradientFillPaintMeta[offset] : -1,
      mask = gradient ? scene.gradientFillPaintMeta[offset + 1] : -1;
    const maskState = await this.gradientMasks(paint, mask);
    return `q\n${this.state(resources, c[offset + 3], blend, maskState)}${paint < 0
      ? `${numbers([b[offset + 2], b[offset + 3], c[offset + 2]])} rg\n`
      : `/Pattern cs ${resources.use("Pattern", await this.gradientPattern(paint))} scn\n`}${path}${c[offset] >= .5 ? "f*" : "f"}\nQ\n`;
  }

  private async stroke(index: number, gradient: boolean, blend: PdfBlendMode | undefined, resources: Resources,
    paint = -1, mask = -1): Promise<string> {
    const scene = this.scene, offset = index * 4,
      a = gradient ? scene.gradientStrokeEndpoints : scene.endpoints,
      b = gradient ? scene.gradientStrokePrimitiveMeta : scene.primitiveMeta,
      styles = gradient ? scene.gradientStrokeStyles : scene.styles;
    const flags = Math.floor(b[offset + 3] / 2 + 1e-6), alpha = Math.max(0, Math.min(1, b[offset + 3] - flags * 2));
    const bounds = gradient ? scene.gradientStrokePrimitiveBounds : scene.primitiveBounds;
    const maskState = await this.gradientMasks(paint, mask);
    return `q\n${(flags & 4) ? `${numbers([bounds[offset], bounds[offset + 1], bounds[offset + 2] - bounds[offset], bounds[offset + 3] - bounds[offset + 1]])} re W n\n` : ""}` +
      `${this.state(resources, alpha, blend, maskState)}${paint < 0 ? `${numbers([styles[offset + 1], styles[offset + 2], styles[offset + 3]])} RG\n`
        : `/Pattern CS ${resources.use("Pattern", await this.gradientPattern(paint))} SCN\n`}` +
      `${pdfNumber(styles[offset] * 2)} w ${(flags & 2) ? 1 : 0} J 1 j\n${segmentPath(a, b, index, 1, false)}S\nQ\n`;
  }

  private async gradientStroke(index: number, resources: Resources): Promise<string> {
    const offset = index * 4, meta = this.scene.gradientStrokeRunMetaA, chunks: string[] = [];
    for (let segment = meta[offset]; segment < meta[offset] + meta[offset + 1]; segment++) {
      await this.checkpoint(); chunks.push(await this.stroke(segment, true, undefined, resources, meta[offset + 2], meta[offset + 3]));
    }
    return chunks.join("");
  }

  private text(index: number, blend: PdfBlendMode | undefined, resources: Resources): string {
    const scene = this.scene, offset = index * 4, code = this.glyphCodes.get(index);
    const clip = Math.round(scene.textInstanceB[offset + 3]) - 1, rect = scene.textClipRects;
    const matrix = [...scene.textInstanceA.subarray(offset, offset + 4), scene.textInstanceB[offset], scene.textInstanceB[offset + 1]];
    const glyph = Math.round(scene.textInstanceB[offset + 2]) * 4;
    const separator = this.separatorAfter.has(index) ? this.separatorCode : undefined;
    return `q\n${clip >= 0 && rect ? `${numbers([rect[clip * 4], rect[clip * 4 + 1], rect[clip * 4 + 2] - rect[clip * 4], rect[clip * 4 + 3] - rect[clip * 4 + 1]])} re W n\n` : ""}` +
      `${this.state(resources, scene.textInstanceC[offset + 3], blend)}${numbers(scene.textInstanceC.subarray(offset, offset + 3))} rg\n` +
      (code ? `BT ${resources.use("Font", code.font)} ${pdfNumber(code.scale)} Tf ${numbers(matrix)} Tm <${code.code.toString(16).padStart(2, "0")}> Tj ET\n`
        : `${numbers(matrix)} cm\n${segmentPath(scene.textGlyphSegmentsA, scene.textGlyphSegmentsB,
          Math.round(scene.textGlyphMetaA[glyph]), Math.round(scene.textGlyphMetaA[glyph + 1]), true)}f\n`) +
      (separator ? `BT ${resources.use("Font", separator.font)} ${pdfNumber(separator.scale)} Tf 3 Tr ${numbers(matrix)} Tm <${separator.code.toString(16).padStart(2, "0")}> Tj ET\n` : "") + "Q\n";
  }

  private invisibleText(resources: Resources): string {
    const text = this.scene.textIndex?.pages[0];
    if (!text) return "";
    const chunks: string[] = [];
    for (const [reference, code] of this.fallbackCodes) {
      const offset = reference * 4, quads = text.fallbackQuads;
      if (offset + 3 >= quads.length) continue;
      const width = Math.max(.000001, quads[offset + 2] - quads[offset]), height = Math.max(.000001, quads[offset + 3] - quads[offset + 1]);
      chunks.push(`q BT ${resources.use("Font", code.font)} ${pdfNumber(code.scale)} Tf 3 Tr ${numbers([width, 0, 0, height, quads[offset], quads[offset + 1]])} Tm <${code.code.toString(16).padStart(2, "0")}> Tj ET Q\n`);
    }
    return chunks.join("");
  }

  private async image(index: number, blend: PdfBlendMode | undefined, resources: Resources): Promise<string> {
    const layer = this.scene.rasterLayers[index], reference = await this.imageObject(layer);
    // Scene pixels are top-down; PDF image coordinates place the first row at
    // v=1. Convert the UV transform without copying or reversing pixel rows.
    const [a, b, c, d, e, f] = layer.matrix;
    if (!layer.repeat) return `q\n${this.state(resources, layer.opacity ?? 1, blend)}${numbers([a, b, -c, -d, e + c, f + d])} cm ${resources.use("XObject", reference)} Do\nQ\n`;
    const repeat = layer.repeat, matrix = rasterRepeatMatrix(repeat, 0, 0);
    // The pattern repeats one stored image, retaining gaps without expanding
    // large CAD hatches into one PDF image invocation per cell.
    const cellResources = new Resources(), imageName = cellResources.use("XObject", reference), cellBounds = repeat.bounds;
    const pattern = await this.writer.stream(`q ${numbers([cellBounds[2] - cellBounds[0], 0, 0, cellBounds[3] - cellBounds[1], cellBounds[0], cellBounds[1]])} cm ${imageName} Do Q\n`,
      `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [${numbers(cellBounds)}] /XStep ${pdfNumber(repeat.xStep)} /YStep ${pdfNumber(repeat.yStep)} ` +
      `/Matrix [${numbers([...repeat.transform.subarray(0, 4), matrix[4] - repeat.transform[0] * cellBounds[0] - repeat.transform[2] * cellBounds[3],
        matrix[5] - repeat.transform[1] * cellBounds[0] - repeat.transform[3] * cellBounds[3]])}] /Resources ${cellResources.dictionary()}`);
    return `q\n${this.state(resources, layer.opacity ?? 1, blend)}/Pattern cs ${resources.use("Pattern", pattern)} scn\n${rectangle(rasterRepeatBounds(repeat))}f\nQ\n`;
  }

  private async imageObject(layer: RasterLayer): Promise<number> {
    const cached = this.imageCache.get(layer); if (cached !== undefined) return cached;
    const { width, height } = layer;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new RangeError("Invalid PDF image dimensions.");
    let color: Uint8Array, alpha: Uint8Array | undefined, colorSpace = "/DeviceRGB", bits = 8;
    if (layer.monochrome) {
      const mono = layer.monochrome, stride = Math.ceil(width / 8);
      if (mono.data.length !== stride * height || mono.colors.length !== 8) throw new RangeError("Invalid packed PDF image pixels.");
      color = mono.data; bits = 1;
      const palette = [mono.colors[0], mono.colors[1], mono.colors[2], mono.colors[4], mono.colors[5], mono.colors[6]];
      colorSpace = `[/Indexed /DeviceRGB 1 <${palette.map(value => value.toString(16).padStart(2, "0")).join("")}>]`;
      if (mono.colors[3] !== 255 || mono.colors[7] !== 255) {
        alpha = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          await this.checkpoint();
          for (let x = 0; x < width; x++) alpha[y * width + x] = mono.colors[((mono.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) * 4 + 3];
        }
      }
    } else {
      const pixels = layer.data;
      if (pixels.length !== width * height * 4) throw new RangeError("PDF image pixels do not match their dimensions.");
      color = new Uint8Array(width * height * 3);
      let hasAlpha = false;
      for (let y = 0; y < height; y++) {
        await this.checkpoint();
        for (let x = 0; x < width; x++) {
          const pixel = y * width + x, offset = pixel * 4;
          color.set(pixels.subarray(offset, offset + 3), pixel * 3); hasAlpha ||= pixels[offset + 3] !== 255;
        }
      }
      if (hasAlpha) { alpha = new Uint8Array(width * height); for (let index = 0; index < alpha.length; index++) alpha[index] = pixels[index * 4 + 3]; }
    }
    const mask = alpha ? await this.writer.stream(alpha, `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`) : undefined;
    const reference = await this.writer.stream(color, `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent ${bits} /Interpolate ${layer.interpolate !== false}${mask ? ` /SMask ${pdfRef(mask)}` : ""}`);
    this.imageCache.set(layer, reference); return reference;
  }

  private async group(group: ScenePaintGroup, resources: Resources): Promise<string> {
    const childResources = new Resources(), content = await this.nodes(group.children, childResources);
    const form = await this.writer.stream(content, `/Type /XObject /Subtype /Form /BBox [${box(this.bounds)}] /Resources ${childResources.dictionary()} ` +
      `/Group << /S /Transparency ${group.isolated ? "/CS /DeviceRGB " : ""}/I ${group.isolated} /K ${group.knockout} >>`);
    const mask = group.softMask ? await this.mask(group.softMask) : "";
    return `q\n${this.state(resources, group.alpha, group.blendMode, `${mask} /AIS ${group.alphaIsShape === true}`)}${resources.use("XObject", form)} Do\nQ\n`;
  }

  private async mask(mask: ScenePaintMask): Promise<string> {
    const resources = new Resources(), content = await this.nodes(mask.children, resources);
    const form = await this.writer.stream(content, `/Type /XObject /Subtype /Form /BBox [${box(this.bounds)}] /Resources ${resources.dictionary()} ` +
      `/Group << /S /Transparency /CS /DeviceRGB /I true /K false >>`);
    let transfer = "";
    if (mask.transfer) {
      const values = new Uint8Array(mask.transfer.length * 2), view = new DataView(values.buffer);
      mask.transfer.forEach((value, index) => view.setUint16(index * 2, Math.round(Math.max(0, Math.min(1, value)) * 65535)));
      transfer = ` /TR ${pdfRef(await this.writer.stream(values, `/FunctionType 0 /Domain [0 1] /Range [0 1] /Size [${mask.transfer.length}] /BitsPerSample 16`))}`;
    }
    return `/SMask << /S /${mask.subtype} /G ${pdfRef(form)}${mask.backdrop ? ` /BC [${numbers(mask.backdrop)}]` : ""}${transfer} >>`;
  }

  private async gradientPattern(index: number, alpha = false): Promise<number> {
    const key = `${index}:${alpha}`, cached = this.gradientCache.get(key); if (cached !== undefined) return cached;
    const scene = this.scene, offset = index * 4;
    const matrix = inverse([scene.gradientMetaB[offset], scene.gradientMetaB[offset + 1], scene.gradientMetaB[offset + 2], scene.gradientMetaB[offset + 3], scene.gradientMetaC[offset], scene.gradientMetaC[offset + 1]]);
    const shading = scene.gradientMetaA[offset] === 2 ? await this.meshShading(index, alpha) : await this.analyticShading(index, alpha);
    const pattern = this.writer.add(`<< /Type /Pattern /PatternType 2 /Matrix [${numbers(matrix)}] /Shading ${pdfRef(shading)} >>`);
    this.gradientCache.set(key, pattern); return pattern;
  }

  private async analyticShading(index: number, alpha: boolean): Promise<number> {
    const scene = this.scene, offset = index * 4, radial = scene.gradientMetaA[offset] >= .5, flags = Math.round(scene.gradientMetaA[offset + 2]);
    const samples = new Uint8Array(GRADIENT_LUT_WIDTH * (alpha ? 1 : 3));
    for (let sample = 0; sample < GRADIENT_LUT_WIDTH; sample++) {
      const source = (index * GRADIENT_LUT_WIDTH + sample) * 4;
      if (alpha) samples[sample] = scene.gradientLut[source + 3];
      else samples.set(scene.gradientLut.subarray(source, source + 3), sample * 3);
    }
    const range = alpha ? "0 1" : "0 1 0 1 0 1", functionRef = await this.writer.stream(samples,
      `/FunctionType 0 /Domain [0 1] /Range [${range}] /Size [${GRADIENT_LUT_WIDTH}] /BitsPerSample 8 /Order 1 /Encode [0 ${GRADIENT_LUT_WIDTH - 1}] /Decode [${range}]`);
    const c = scene.gradientMetaC, d = scene.gradientMetaD;
    const coordinates = radial ? [c[offset + 2], c[offset + 3], d[offset + 2], d[offset], d[offset + 1], d[offset + 3]] : [c[offset + 2], c[offset + 3], d[offset], d[offset + 1]];
    return this.writer.add(`<< /ShadingType ${radial ? 3 : 2} /ColorSpace /${alpha ? "DeviceGray" : "DeviceRGB"} /Coords [${numbers(coordinates)}] /Function ${pdfRef(functionRef)} ` +
      `/Extend [${(flags & 1) === 0} ${(flags & 2) === 0}]${this.shadingBounds(index)}${this.shadingBackground(index, alpha)} >>`);
  }

  private shadingBounds(index: number): string {
    const offset = index * 4;
    return this.scene.gradientMetaA[offset + 1] >= .5 ? ` /BBox [${numbers(this.scene.gradientMetaE.subarray(offset, offset + 4))}]` : "";
  }
  private shadingBackground(index: number, alpha: boolean): string {
    const value = Math.round(this.scene.gradientMetaA[index * 4 + 3]) - 1;
    return value >= 0 ? ` /Background [${alpha ? "1" : numbers([(value >>> 16) / 255, ((value >>> 8) & 255) / 255, (value & 255) / 255])}]` : "";
  }

  private async meshShading(index: number, alpha: boolean): Promise<number> {
    const scene = this.scene, ranges = scene.gradientMeshRanges, positions = scene.gradientMeshPositions,
      colors = scene.gradientMeshColors, indices = scene.gradientMeshIndices;
    if (!ranges || !positions || !colors || !indices) throw new Error("A PDF mesh gradient is missing its geometry.");
    const first = ranges[index * 2], count = ranges[index * 2 + 1];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let at = first; at < first + count; at++) {
      const vertex = indices[at]; minX = Math.min(minX, positions[vertex * 2]); maxX = Math.max(maxX, positions[vertex * 2]);
      minY = Math.min(minY, positions[vertex * 2 + 1]); maxY = Math.max(maxY, positions[vertex * 2 + 1]);
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("A PDF mesh gradient has no vertices.");
    if (minX === maxX) maxX = minX + 1;
    if (minY === maxY) maxY = minY + 1;
    const components = alpha ? 1 : 3, stride = 9 + components * 2, bytes = new Uint8Array(count * stride), view = new DataView(bytes.buffer);
    for (let at = 0; at < count; at++) {
      await this.checkpoint();
      const vertex = indices[first + at], offset = at * stride;
      bytes[offset] = 0;
      view.setUint32(offset + 1, Math.round((positions[vertex * 2] - minX) / (maxX - minX) * 0xffffffff));
      view.setUint32(offset + 5, Math.round((positions[vertex * 2 + 1] - minY) / (maxY - minY) * 0xffffffff));
      for (let channel = 0; channel < components; channel++) view.setUint16(offset + 9 + channel * 2, Math.round(colors[vertex * 4 + (alpha ? 3 : channel)] * 65535));
    }
    return this.writer.stream(bytes, `/ShadingType 4 /ColorSpace /${alpha ? "DeviceGray" : "DeviceRGB"} /BitsPerCoordinate 32 /BitsPerComponent 16 /BitsPerFlag 8 ` +
      `/Decode [${numbers([minX, maxX, minY, maxY])} ${alpha ? "0 1" : "0 1 0 1 0 1"}]${this.shadingBounds(index)}${this.shadingBackground(index, alpha)}`);
  }

  private gradientNeedsMask(index: number): boolean {
    if (index < 0) return false;
    const scene = this.scene, offset = index * 4;
    if (scene.gradientMetaA[offset + 1] >= .5 || scene.gradientMetaA[offset + 2] !== 0) return true;
    if (scene.gradientMetaA[offset] === 2) return true;
    for (let sample = 0; sample < GRADIENT_LUT_WIDTH; sample++) if (scene.gradientLut[(index * GRADIENT_LUT_WIDTH + sample) * 4 + 3] !== 255) return true;
    return false;
  }

  private async gradientMasks(source: number, mask: number): Promise<string> {
    const indices = [source, mask].filter(index => this.gradientNeedsMask(index));
    if (!indices.length) return "";
    const key = indices.join(":"), cached = this.gradientMaskCache.get(key);
    if (cached !== undefined) return `/SMask << /S /Luminosity /G ${pdfRef(cached)} >>`;
    let form: number | undefined;
    for (const index of indices) {
      const resources = new Resources();
      let content: string;
      if (form === undefined) content = `/Pattern cs ${resources.use("Pattern", await this.gradientPattern(index, true))} scn\n${rectangle(this.bounds)}f\n`;
      else {
        const maskResources = new Resources(), pattern = await this.gradientPattern(index, true);
        const maskForm = await this.writer.stream(`/Pattern cs ${maskResources.use("Pattern", pattern)} scn ${rectangle(this.bounds)}f\n`,
          `/Type /XObject /Subtype /Form /BBox [${box(this.bounds)}] /Resources ${maskResources.dictionary()} /Group << /S /Transparency /CS /DeviceGray /I true >>`);
        content = `${this.state(resources, 1, "Normal", `/SMask << /S /Luminosity /G ${pdfRef(maskForm)} >>`)}${resources.use("XObject", form)} Do\n`;
      }
      form = await this.writer.stream(content, `/Type /XObject /Subtype /Form /BBox [${box(this.bounds)}] /Resources ${resources.dictionary()} /Group << /S /Transparency /CS /DeviceGray /I true >>`);
    }
    this.gradientMaskCache.set(key, form!); return `/SMask << /S /Luminosity /G ${pdfRef(form!)} >>`;
  }
}

function cmapMappings(mappings: readonly string[]): string {
  const chunks: string[] = [];
  for (let first = 0; first < mappings.length; first += 100) {
    const group = mappings.slice(first, first + 100); chunks.push(`${group.length} beginbfchar\n${group.join("\n")}\nendbfchar\n`);
  }
  return chunks.join("");
}

function sameQuad(quads: Float32Array, first: number, second: number): boolean {
  return first * 4 + 3 < quads.length && second * 4 + 3 < quads.length &&
    [0, 1, 2, 3].every(offset => quads[first * 4 + offset] === quads[second * 4 + offset]);
}

/** Preserve stored contour order, starting another subpath at a discontinuity. */
function segmentPath(a: Float32Array, b: Float32Array, first: number, count: number, close: boolean): string {
  const commands: string[] = [];
  let x = NaN, y = NaN, startX = NaN, startY = NaN;
  for (let index = first; index < first + count; index++) {
    const offset = index * 4, x0 = a[offset], y0 = a[offset + 1], x1 = b[offset], y1 = b[offset + 1];
    if (x !== x0 || y !== y0) {
      if (close && Number.isFinite(x)) commands.push("h\n");
      commands.push(`${numbers([x0, y0])} m\n`); startX = x0; startY = y0;
    }
    if (b[offset + 2] >= .5) {
      const cx = a[offset + 2], cy = a[offset + 3];
      commands.push(`${numbers([x0 + (cx - x0) * 2 / 3, y0 + (cy - y0) * 2 / 3,
        x1 + (cx - x1) * 2 / 3, y1 + (cy - y1) * 2 / 3, x1, y1])} c\n`);
    } else commands.push(`${numbers([x1, y1])} l\n`);
    x = x1; y = y1;
    if (close && x === startX && y === startY) { commands.push("h\n"); x = NaN; y = NaN; }
  }
  if (close && Number.isFinite(x)) commands.push("h\n");
  return commands.join("");
}

function edgePath(edges: Float32Array): string {
  if (!edges.length) return "0 0 0 0 re\n";
  const commands: string[] = [];
  let x = NaN, y = NaN;
  for (let offset = 0; offset < edges.length; offset += 4) {
    if (x !== edges[offset] || y !== edges[offset + 1]) commands.push(`${numbers([edges[offset], edges[offset + 1]])} m\n`);
    x = edges[offset + 2]; y = edges[offset + 3]; commands.push(`${numbers([x, y])} l\n`);
  }
  return commands.join("");
}
