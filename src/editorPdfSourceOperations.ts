import type { VectorScene } from "./pdfVectorExtractor";
import type { EditorMatrix, EditorSession, EditorPdfSaveOptions } from "./editorTypes";
import { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter, pdfNameValue, pdfNumberValue, pdfStreamValue, serializePdfValue } from "./pdf/nativeWriter";
import { isPdfDictionary, isPdfName, isPdfStream, type PdfDictionary, type PdfStream, type PdfValue, type PdfRef } from "./pdf/nativeCos";
import { scanDensePdfResourceReferences } from "./pdf/nativeContentCompiler";
import { prepareNativeInlineImages } from "./pdf/nativeInlineImage";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import type { NativeEditorSourceGlyph, NativeEditorTextState } from "./pdf/nativeText";
import { openPdf, type NativeVectorPdfSession } from "./pdfSession";
import { EDITOR_IDENTITY, editorPoint, editorTransformBounds, invertEditorMatrix, multiplyEditorMatrices, transformWholeEditorScene, compactEditorScene,
  editorSourceClipTransformOwnership, retainEditorAnnotationPlacements } from "./editorScene";
import { ScenePageViews, PAGE_PRIMITIVE_KINDS } from "./scenePageViews";
import { getPrimitiveMarkedContent, getSceneAnnotationRuns, getScenePrimitive, getPrimitiveClipChain, type PrimitiveRef } from "./scenePrimitives";
import { editorPaintIdentity } from "./editorPaintIdentity";

const TAG = "HEPRSourceOperation";
const PAINT = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "Tj", "TJ", "'", '"', "Do", "sh", "BI"]);
const PATH_PAINT = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
const PATH = new Set(["m", "l", "c", "v", "y", "h", "re"]);
const encoder = new TextEncoder();
const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;
const matrixText = (matrix: readonly number[]): string => matrix.map(pdfNumberValue).join(" ");
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b));
const sameMatrix = (a: readonly number[], b: readonly number[]): boolean => a.every((value, index) => close(value, b[index]));

interface TextCapture { before: NativeEditorTextState; after: NativeEditorTextState; glyphs: readonly NativeEditorSourceGlyph[] }
interface Scope { start: number; end: number; matrix: EditorMatrix; inText: boolean; clip: boolean; mask: boolean; textMode: number;
  pathOpen?: boolean; endInText?: boolean; signature: number;
  marked: readonly MarkedScope[]; operations: Operation[]; parent?: Scope }
interface MarkedScope { raw: Uint8Array; optional: boolean; actualText: boolean; property?: string }
interface State { matrix: EditorMatrix; clip: boolean; mask: boolean; inText: boolean; textMode: number; signature: number }
interface PathCommand { operator: string; points: readonly number[] }
interface Operation {
  id: number; operator: string; operands: readonly unknown[]; start: number; end: number; operatorStart: number;
  state: State; node: Program; scopes: readonly Scope[]; marked: readonly MarkedScope[];
  pathStart?: number; pathPure?: boolean; pendingClip?: boolean; path?: readonly PathCommand[];
  child?: Program; refs: PrimitiveRef[]; text?: TextCapture;
}
interface Program {
  bytes: Uint8Array; resources: PdfDictionary; dictionary?: PdfDictionary; initial: State; operations: Operation[]; scopes: Scope[];
  parent?: Operation; name: string;
}
interface PreparedPage {
  root: Program; operations: Map<number, Operation>; byPrimitive: Map<string, Operation>; sceneToPdf: EditorMatrix;
  pdfToScene: EditorMatrix; nativeToScene: EditorMatrix; sourceIndex: number;
}
interface Patch { start: number; end: number; bytes: Uint8Array }
const preparedPages = new WeakMap<VectorScene, Map<number, PreparedPage>>();

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function applyPatches(bytes: Uint8Array, patches: readonly Patch[]): Uint8Array {
  const sorted = [...patches].sort((a, b) => a.start - b.start || b.end - a.end), parts: Uint8Array[] = []; let offset = 0;
  for (const patch of sorted) {
    if (patch.start < offset || patch.start < 0 || patch.end > bytes.length) throw new Error("Overlapping PDF source-operation edits.");
    parts.push(bytes.subarray(offset, patch.start), Uint8Array.of(10), patch.bytes, Uint8Array.of(10)); offset = patch.end;
  }
  parts.push(bytes.subarray(offset)); return concatenate(parts);
}
function finiteMatrix(value: PdfValue | undefined): EditorMatrix {
  if (value === undefined) return EDITOR_IDENTITY;
  if (!Array.isArray(value) || value.length !== 6 || !value.every(item => typeof item === "number" && Number.isFinite(item))) throw new Error("A source Form has an invalid matrix.");
  return value as unknown as EditorMatrix;
}
function operand(value: unknown): PdfValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return pdfNameValue(value);
  if (value instanceof Uint8Array) return { kind: "string", bytes: value, hex: true };
  if (Array.isArray(value)) return value.map(operand);
  if (value instanceof Map) return new Map([...value].map(([name, item]) => [String(name), operand(item)]));
  throw new Error("Unsupported source PDF operand.");
}
function serializeOperator(operator: string, operands: readonly unknown[]): Uint8Array {
  return concatenate([...operands.flatMap(value => [serializePdfValue(operand(value)), encoder.encode(" ")]), encoder.encode(`${operator}\n`)]);
}
function streamDictionary(dictionary: PdfDictionary): PdfDictionary {
  const result = new Map(dictionary); for (const name of ["Length", "Filter", "DecodeParms"]) result.delete(name); return result;
}
/** The PDF page still owns its CropBox. Do not permanently bake that viewport
 * into a replacement for otherwise unclipped native source paint. */
function removeSourcePageViewport(scene: VectorScene): VectorScene {
  const box = scene.pageRects, sameBox = (values: readonly number[] | Float32Array): boolean =>
    [box[0], box[1], box[2], box[3]].every((value, index) => close(value, values[index]));
  const clips = scene.clipPaths?.slice(), remapped = new Map<number, number>();
  const clip = (index: number): number => {
    if (index < 0 || !clips) return -1;
    const known = remapped.get(index); if (known !== undefined) return known;
    const source = scene.clipPaths![index], parent = clip(source.parent), edges = source.edges;
    const rectangular = edges.length === 16 && Array.from({ length: 4 }, (_, index) => index * 4).every(offset =>
      (close(edges[offset], edges[offset + 2]) || close(edges[offset + 1], edges[offset + 3])) &&
      [offset, offset + 2].every(i => close(edges[i], box[0]) || close(edges[i], box[2])) &&
      [offset + 1, offset + 3].every(i => close(edges[i], box[1]) || close(edges[i], box[3])));
    const next = rectangular ? parent : parent === source.parent ? index : clips.push({ ...source, parent }) - 1;
    remapped.set(index, next); return next;
  };
  const result: VectorScene = { ...scene, clipPaths: clips, drawRuns: scene.drawRuns?.map(run => ({ ...run,
    ...(run.clipIndex === undefined ? {} : { clipIndex: clip(run.clipIndex) < 0 ? undefined : clip(run.clipIndex) }) })) };
  for (const kind of ["stroke", "gradient-stroke"] as const) {
    const meta = kind === "stroke" ? scene.primitiveMeta : scene.gradientStrokePrimitiveMeta,
      bounds = kind === "stroke" ? scene.primitiveBounds : scene.gradientStrokePrimitiveBounds;
    let changed: Float32Array | undefined;
    for (let offset = 0; offset < meta.length; offset += 4) {
      const flags = Math.floor(meta[offset + 3] / 2), alpha = meta[offset + 3] - flags * 2;
      if ((flags & 4) && sameBox(bounds.subarray(offset, offset + 4))) { changed ??= meta.slice(); changed[offset + 3] = (flags & ~4) * 2 + alpha; }
    }
    if (changed) { if (kind === "stroke") result.primitiveMeta = changed; else result.gradientStrokePrimitiveMeta = changed; }
  }
  if (scene.textClipRects) for (let index = 0; index < scene.textInstanceCount; index++) {
    const offset = index * 4, rect = Math.round(scene.textInstanceB[offset + 3]) - 1;
    if (rect >= 0 && sameBox(scene.textClipRects.subarray(rect * 4, rect * 4 + 4))) {
      if (result.textInstanceB === scene.textInstanceB) result.textInstanceB = scene.textInstanceB.slice(); result.textInstanceB[offset + 3] = 0;
    }
  }
  retainEditorAnnotationPlacements(scene, result); return result;
}
function cloneState(state: State): State { return { ...state, matrix: [...state.matrix] as unknown as EditorMatrix }; }

/** Exact lexer addresses, including binary inline images; used only for source-edit preparation. */
function readProgram(bytes: Uint8Array, resources: PdfDictionary, initial: State, register: (operation: Operation) => void,
  signal?: AbortSignal, dictionary?: PdfDictionary, parent?: Operation, name = "page", maskStates: ReadonlyMap<string, boolean> = new Map()): Program {
  const program: Program = { bytes, resources, dictionary, initial, operations: [], scopes: [], parent, name };
  const stack: { state: State; scope: Scope }[] = [], marked: MarkedScope[] = [];
  let state = cloneState(initial), pathStart: number | undefined, pathPure = true, pendingClip = false;
  let signature = initial.signature;
  let path: PathCommand[] = [], pen: readonly number[] = [0, 0], subpath: readonly number[] = [0, 0];
  const append = (operator: string, operands: readonly unknown[], start: number, end: number, operatorStart: number): void => {
    signal?.throwIfAborted();
    const scopes = stack.map(item => item.scope);
    const operation: Operation = { id: -1, operator, operands, start, end, operatorStart, state: cloneState(state), node: program,
      scopes, marked: [...marked], refs: [], ...(pathStart === undefined ? {} : { pathStart, pathPure }), pendingClip,
      ...(PATH_PAINT.has(operator) && path.length ? { path: [...path] } : {}) };
    program.operations.push(operation);
    if (PAINT.has(operator)) { register(operation); for (const scope of scopes) scope.operations.push(operation); }
    if (operator === "q") {
      const scope: Scope = { start, end: bytes.length, matrix: state.matrix, inText: state.inText, clip: state.clip, mask: state.mask,
        textMode: state.textMode, signature: state.signature,
        marked: [...marked], operations: [], parent: stack.at(-1)?.scope };
      program.scopes.push(scope); stack.push({ state: cloneState(state), scope });
    } else if (operator === "Q") {
      const saved = stack.pop(); if (!saved) throw new Error("Unbalanced source PDF graphics state.");
      saved.scope.end = end; saved.scope.pathOpen = pathStart !== undefined; saved.scope.endInText = state.inText; state = saved.state;
    } else if (operator === "cm") state.matrix = multiplyEditorMatrices(state.matrix, operands as readonly number[]);
    else if (operator === "BT") state.inText = true;
    else if (operator === "ET") state.inText = false;
    else if (operator === "Tr") state.textMode = Number(operands[0]);
    else if (operator === "gs" && maskStates.has(String(operands[0]))) state.mask = maskStates.get(String(operands[0]))!;
    else if (operator === "W" || operator === "W*") pendingClip = true;
    else if (operator === "BMC" || operator === "BDC") {
      const tag = String(operands[0]), property = operands[1];
      marked.push({ raw: bytes.subarray(start, end), optional: tag === "OC", actualText: property instanceof Map && property.has("ActualText"),
        ...(typeof property === "string" ? { property } : {}) });
    } else if (operator === "EMC") marked.pop();
    if (PATH.has(operator)) {
      if (pathStart === undefined) { pathStart = start; pathPure = true; }
      const values = operands as readonly number[], point = (offset: number): [number, number] => editorPoint(state.matrix, values[offset], values[offset + 1]);
      if (operator === "m" || operator === "l") { pen = point(0); if (operator === "m") subpath = pen; path.push({ operator, points: pen }); }
      else if (operator === "h") { path.push({ operator, points: [] }); pen = subpath; }
      else if (operator === "re") {
        const [x, y, w, h] = values, points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([x, y]) => editorPoint(state.matrix, x, y));
        path.push(...points.map((points, index) => ({ operator: index ? "l" : "m", points })), { operator: "h", points: [] }); pen = subpath = points[0];
      } else {
        const end = point(operator === "c" ? 4 : 2), controls = operator === "v" ? [...pen, ...point(0)] : operator === "y" ? [...point(0), ...end] : [...point(0), ...point(2)];
        path.push({ operator: "c", points: [...controls, ...end] }); pen = end;
      }
    }
    else if (["n", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*"].includes(operator)) {
      if (pendingClip) state.clip = true; pendingClip = false; pathStart = undefined; pathPure = true; path = [];
    } else if (pathStart !== undefined) pathPure = false;
    if (!PATH.has(operator) && !PAINT.has(operator) && !["q", "Q", "BT", "ET", "BMC", "BDC", "EMC", "MP", "DP"].includes(operator))
      state.signature = ++signature;
  };
  const prepared = prepareNativeInlineImages(bytes, { signal });
  for (const segment of prepared.segments) {
    if (segment.kind === "image") append("BI", [], segment.sourceOffset, segment.sourceOffset + segment.sourceLength, segment.sourceOffset);
    else scanDensePdfResourceReferences(segment.bytes, { signal, onOperatorSource(operator, operands, start, end, operatorStart) {
      append(operator, operands, segment.sourceOffset + start, segment.sourceOffset + end, segment.sourceOffset + operatorStart);
    } });
  }
  return program;
}

async function instrumentPage(document: NativePdfDocument, sourceIndex: number, signal?: AbortSignal): Promise<{
  bytes: Uint8Array; root: Program; operations: Map<number, Operation>
}> {
  const writer = new NativePdfWriter(document), operations = new Map<number, Operation>(); let nextId = 1;
  const register = (operation: Operation): void => { operation.id = nextId++; operations.set(operation.id, operation); };
  const active = new Set<PdfStream>();
  const visit = async (bytes: Uint8Array, resources: PdfDictionary, initial: State, dictionary?: PdfDictionary, parent?: Operation,
    name = "page"): Promise<{ program: Program; bytes: Uint8Array; resources: PdfDictionary }> => {
    const maskStates = new Map<string, boolean>(), rawStates = await document.resolveValue(resources.get("ExtGState"), signal);
    if (isPdfDictionary(rawStates)) for (const [name, raw] of rawStates) {
      const state = await document.resolveValue(raw, signal); if (!isPdfDictionary(state) || !state.has("SMask")) continue;
      maskStates.set(name, !isPdfName(await document.resolveValue(state.get("SMask"), signal), "None"));
    }
    const program = readProgram(bytes, resources, initial, register, signal, dictionary, parent, name, maskStates), patches: Patch[] = [];
    const rawProperties = await document.resolveValue(resources.get("Properties"), signal);
    if (isPdfDictionary(rawProperties)) for (const scope of new Set(program.operations.flatMap(operation => operation.marked))) if (scope.property) {
      const property = await document.resolveValue(rawProperties.get(scope.property), signal);
      if (isPdfDictionary(property) && property.has("ActualText")) scope.actualText = true;
    }
    const rawXObjects = await document.resolveValue(resources.get("XObject"), signal), xObjects = new Map(isPdfDictionary(rawXObjects) ? rawXObjects : []);
    for (const operation of program.operations) if (operation.id >= 0) {
      signal?.throwIfAborted(); let raw = bytes.subarray(operation.start, operation.end);
      if (operation.operator === "Do") {
        const resourceName = String(operation.operands[0]), value = await document.resolveValue(xObjects.get(resourceName), signal);
        if (isPdfStream(value) && isPdfName(value.dictionary.get("Subtype"), "Form")) {
          if (active.has(value)) throw new Error("Recursive source Form invocation.");
          active.add(value);
          const own = await document.resolveValue(value.dictionary.get("Resources"), signal), alias = `HEPRProvenance${operation.id}`;
          const nested = await visit(await document.decodeStream(value, signal), isPdfDictionary(own) ? own : resources,
            { ...operation.state, matrix: multiplyEditorMatrices(operation.state.matrix, finiteMatrix(value.dictionary.get("Matrix"))) }, value.dictionary, operation, alias);
          active.delete(value); operation.child = nested.program;
          const dictionary = streamDictionary(value.dictionary); dictionary.set("Resources", nested.resources);
          xObjects.set(alias, writer.add(pdfStreamValue(nested.bytes, dictionary)));
          raw = encoder.encode(`/${alias} Do\n`);
        }
      }
      patches.push({ start: operation.start, end: operation.end,
        bytes: concatenate([encoder.encode(`\n/${TAG} <</MCID ${operation.id}>> BDC\n`), raw, encoder.encode("\nEMC\n")]) });
    }
    const updatedResources = new Map(resources); if (xObjects.size) updatedResources.set("XObject", xObjects);
    return { program, bytes: applyPatches(bytes, patches), resources: updatedResources };
  };
  const page = document.getPage(sourceIndex), resources = page.resources ? await document.resolveDictionary(page.resources, signal) : new Map();
  const content = concatenate((await document.getDecodedPageContents(sourceIndex, signal)).flatMap(bytes => [bytes, Uint8Array.of(10)]));
  const result = await visit(content, resources, { matrix: EDITOR_IDENTITY, clip: false, mask: false, inText: false, textMode: 0, signature: 0 });
  if (!page.ref) throw new Error("Direct source page cannot carry editor provenance safely.");
  const dictionary = new Map(page.dictionary); dictionary.set("Contents", writer.add(pdfStreamValue(result.bytes))); dictionary.set("Resources", result.resources);
  dictionary.delete("Annots"); writer.set(page.ref, dictionary);
  return { bytes: await writer.save(signal), root: result.program, operations };
}

function samePrimitive(a: VectorScene, first: PrimitiveRef, b: VectorScene, second: PrimitiveRef): boolean {
  const x = getScenePrimitive(a, first), y = getScenePrimitive(b, second), ax = x.bounds, by = y.bounds;
  // Page composition can retain clip-tight bounds while affine projection
  // recomputes conservative contour bounds. Match the actual contours rather
  // than rejecting identical cropped artwork because its metadata is tighter.
  if (x.segmentCount !== y.segmentCount || (x.color === null) !== (y.color === null) || x.color?.some((value, index) => !close(value, y.color![index]))) return false;
  if (!x.segmentCount && ![ax.minX, ax.minY, ax.maxX, ax.maxY].every((value, index) => close(value, [by.minX, by.minY, by.maxX, by.maxY][index]))) return false;
  for (let segment = 0; segment < x.segmentCount; segment++) {
    const sx = x.getSegment(segment), sy = y.getSegment(segment);
    if (![sx.start.x, sx.start.y, sx.end.x, sx.end.y].every((value, index) => close(value, [sy.start.x, sy.start.y, sy.end.x, sy.end.y][index])) ||
        Boolean(sx.control) !== Boolean(sy.control) || sx.control && (!close(sx.control.x, sy.control!.x) || !close(sx.control.y, sy.control!.y))) return false;
  }
  return true;
}

async function preparePage(document: NativePdfDocument, session: EditorSession, pageIndex: number,
  options: { signal?: AbortSignal; password?: string; missingFontResolver?: NativeMissingFontResolver }): Promise<PreparedPage> {
  const cached = preparedPages.get(session.sourceScene)?.get(pageIndex); if (cached) return cached;
  const { signal } = options, source = session.sourceScene, sourceIndex = source.pdfPages?.find(page => page.pageIndex === pageIndex)?.sourcePageIndex ?? pageIndex;
  const instrumented = await instrumentPage(document, sourceIndex, signal);
  const parser = await openPdf({ kind: "bytes", bytes: instrumented.bytes },
    { signal, password: options.password, missingFontResolver: options.missingFontResolver }) as NativeVectorPdfSession;
  let captured: VectorScene;
  try {
    captured = await parser.compileVectorPage(sourceIndex, { signal, optimization: "none", retainOptionalContent: true, editorSourceProvenance: true,
      onEditorSourceText(mcid, before, after, glyphs) { const operation = instrumented.operations.get(mcid); if (operation) operation.text = { before, after, glyphs }; } });
  } finally { await parser.close(); }
  const page = document.getPage(sourceIndex), nativeMatrix = computeNativePdfPageGeometry(page).pageMatrix;
  const pdfToScene = source.pdfPages?.find(page => page.pageIndex === pageIndex)?.pdfToScene ??
    multiplyEditorMatrices([1, 0, 0, 1, source.pageRects[pageIndex * 4], source.pageRects[pageIndex * 4 + 1]], nativeMatrix);
  const placement = multiplyEditorMatrices(pdfToScene, invertEditorMatrix(nativeMatrix));
  const projected = sameMatrix(placement, EDITOR_IDENTITY) ? captured : transformWholeEditorScene(captured, placement, signal);
  const view = new ScenePageViews(source).extract(pageIndex), annotationRefs = new Set([...getSceneAnnotationRuns(source).values()]
    .flatMap(runs => runs.flatMap(run => Array.from({ length: run.count }, (_, index) => `${run.kind}:${run.first + index}`))));
  const byPrimitive = new Map<string, Operation>();
  for (const kind of PAGE_PRIMITIVE_KINDS) {
    const ids = [...view.primitives[kind]].filter(index => !annotationRefs.has(`${kind}:${index}`));
    const count = kind === "stroke" ? projected.segmentCount : kind === "fill" ? projected.fillPathCount : kind === "text" ? projected.textInstanceCount
      : kind === "raster" ? projected.rasterLayers.length : kind === "gradient-fill" ? projected.gradientFillPathCount : projected.gradientStrokeRunCount;
    if (ids.length !== count) throw new Error(`Source ${kind} ownership differs after provenance preparation.`);
    for (let index = 0; index < ids.length; index++) {
      signal?.throwIfAborted(); const ref = { kind, index: ids[index] }, local = { kind, index };
      if (!samePrimitive(source, ref, projected, local)) throw new Error(`Source ${kind} geometry differs after provenance preparation (primitive ${ids[index]}).`);
      const item = getPrimitiveMarkedContent(projected, local), operation = item?.tag === TAG ? instrumented.operations.get(item.mcid) : undefined;
      if (operation) { byPrimitive.set(key(ref), operation); operation.refs.push(ref); }
    }
  }
  const collect = (program: Program): PrimitiveRef[] => program.operations.filter(operation => operation.id >= 0).flatMap(operation => {
    if (operation.child) operation.refs.push(...collect(operation.child)); return operation.refs;
  });
  collect(instrumented.root);
  const prepared: PreparedPage = { root: instrumented.root, operations: instrumented.operations, byPrimitive, sourceIndex, pdfToScene,
    nativeToScene: placement, sceneToPdf: invertEditorMatrix(pdfToScene) };
  let cache = preparedPages.get(source); if (!cache) preparedPages.set(source, cache = new Map()); cache.set(pageIndex, prepared); return prepared;
}

export interface EditorPdfSourceRewriteOptions {
  signal?: AbortSignal;
  password?: string;
  missingFontResolver?: NativeMissingFontResolver;
}

/** Internal test hook for the lazy, recovery-rebuildable source map. */
export async function prepareEditorPdfSourceOperations(document: NativePdfDocument, session: EditorSession, pageIndex: number,
  options: EditorPdfSourceRewriteOptions = {}): Promise<{ count: number; primitiveCount: number }> {
  const page = await preparePage(document, session, pageIndex, options);
  return { count: page.operations.size, primitiveCount: page.byPrimitive.size };
}

type Layers = { groupReference(id: string | null | undefined): PdfRef | undefined };
interface Change { transform: EditorMatrix; deleted: boolean; layer?: string | null }
const unchanged: Change = { transform: EDITOR_IDENTITY, deleted: false };
const sameChange = (a: Change, b: Change): boolean => a.deleted === b.deleted && a.layer === b.layer && sameMatrix(a.transform, b.transform);
const changed = (change: Change): boolean => change.deleted || change.layer !== undefined || !sameMatrix(change.transform, EDITOR_IDENTITY);

function textPrefix(operation: Operation): Uint8Array {
  if (operation.operator === "'") return encoder.encode("T*\n");
  if (operation.operator === '"') return encoder.encode(`${pdfNumberValue(Number(operation.operands[0]))} Tw ${pdfNumberValue(Number(operation.operands[1]))} Tc T*\n`);
  return new Uint8Array();
}
function textBody(operation: Operation): Uint8Array {
  return operation.operator === "'" || operation.operator === '"'
    ? serializeOperator("Tj", [operation.operands.at(-1)]) : operation.node.bytes.subarray(operation.start, operation.end);
}
/** Restore both text matrices without retaining deleted strings as invisible searchable text. */
function textEnd(capture: TextCapture): Uint8Array {
  const state = capture.after, delta = multiplyEditorMatrices(invertEditorMatrix(state.lineMatrix), state.matrix), vertical = state.font.font.writingMode === 1;
  if (!sameMatrix(delta.slice(0, 4), EDITOR_IDENTITY.slice(0, 4)) || !close(delta[vertical ? 4 : 5], 0))
    throw new Error("The source text advance cannot be represented independently.");
  const divisor = state.fontSize * (vertical ? 1 : state.horizontalScale), amount = delta[vertical ? 5 : 4];
  if (!divisor && amount) throw new Error("The source text uses a zero-size advance.");
  return encoder.encode(`${matrixText(state.lineMatrix)} Tm\n${amount ? `[${pdfNumberValue(-amount / divisor * 1000)}] TJ\n` : ""}`);
}
function transformed(page: PreparedPage, operation: Operation, matrix: EditorMatrix, bytes: Uint8Array): Uint8Array {
  if (sameMatrix(matrix, EDITOR_IDENTITY)) return bytes;
  const pdfDelta = multiplyEditorMatrices(page.sceneToPdf, multiplyEditorMatrices(matrix, page.pdfToScene));
  const relative = multiplyEditorMatrices(invertEditorMatrix(operation.state.matrix), multiplyEditorMatrices(pdfDelta, operation.state.matrix));
  return concatenate([encoder.encode(`q ${matrixText(relative)} cm\n`), bytes, encoder.encode("\nQ\n")]);
}
function pathBody(operation: Operation): Uint8Array {
  if (!operation.path?.length) throw new Error("The source path has no independent construction.");
  const inverse = invertEditorMatrix(operation.state.matrix);
  return encoder.encode(operation.path.map(command => {
    const points: number[] = [];
    for (let index = 0; index < command.points.length; index += 2) points.push(...editorPoint(inverse, command.points[index], command.points[index + 1]));
    return `${matrixText(points)} ${command.operator}\n`;
  }).join("") + operation.operator + "\n");
}
function partialText(page: PreparedPage, operation: Operation, source: VectorScene, changes: ReadonlyMap<string, Change>): Uint8Array {
  const capture = operation.text; if (!capture) throw new Error("The source text state is unavailable.");
  if (capture.after.renderingMode >= 4 || capture.after.font.type3) throw new Error("Clipping or self-painting source text is an inseparable paint unit.");
  const strings = operation.operator === "TJ" ? operation.operands[0] : [operation.operands.at(-1)];
  if (!Array.isArray(strings)) throw new Error("Invalid source text array.");
  const state = capture.after, font = state.font.font, codes: { bytes: Uint8Array; origin: readonly number[] }[] = [];
  for (const item of strings) if (item instanceof Uint8Array) for (let offset = 0; offset < item.length;) {
    const mapped = font.decode(item, offset), size = mapped.codeByteLength;
    if (!size || offset + size > item.length) throw new Error("Invalid source text character code.");
    const metric = mapped.verticalMetric ?? { originX: mapped.width / 2, originY: 880 };
    codes.push({ bytes: item.slice(offset, offset + size), origin: font.writingMode === 1
      ? [-metric.originX / 1000 * state.fontSize * state.horizontalScale, state.rise - metric.originY / 1000 * state.fontSize] : [0, state.rise] });
    offset += size;
  }
  if (codes.length !== capture.glyphs.length) throw new Error("The source text character ownership is ambiguous.");
  const glyphChanges = new Map<number, Change>(), used = new Set<number>();
  for (const ref of operation.refs) {
    if (ref.kind !== "text") throw new Error("An outlined source glyph requires its complete paint unit.");
    const offset = ref.index * 4, actual = [source.textInstanceA[offset], source.textInstanceA[offset + 1], source.textInstanceA[offset + 2], source.textInstanceA[offset + 3], source.textInstanceB[offset], source.textInstanceB[offset + 1]];
    const glyph = capture.glyphs.findIndex((item, index) => !used.has(index) && sameMatrix(actual, multiplyEditorMatrices(page.nativeToScene, item.matrix)));
    if (glyph < 0) throw new Error("A source glyph cannot be assigned to its original character code.");
    used.add(glyph); glyphChanges.set(glyph, changes.get(key(ref)) ?? unchanged);
  }
  if ([...glyphChanges.values()].some(change => change.deleted) && operation.marked.some(scope => scope.actualText))
    throw new Error("Deleting part of an ActualText replacement requires its inseparable marked-content scope.");
  const scale: EditorMatrix = [state.fontSize * state.horizontalScale / font.unitsPerEm, 0, 0, state.fontSize / font.unitsPerEm, 0, 0];
  const parts: Uint8Array[] = [textPrefix(operation)];
  for (let index = 0; index < codes.length; index++) {
    const change = glyphChanges.get(index) ?? unchanged; if (change.deleted) continue;
    if (change.layer !== undefined) throw new Error("A partial source text-show layer assignment requires separate paint units.");
    const { bytes, origin } = codes[index], glyph = capture.glyphs[index];
    const matrix = multiplyEditorMatrices(invertEditorMatrix(state.transform), multiplyEditorMatrices(glyph.matrix,
      multiplyEditorMatrices(invertEditorMatrix(scale), [1, 0, 0, 1, -origin[0], -origin[1]])));
    const body = concatenate([encoder.encode(`${matrixText(matrix)} Tm\n`), serializeOperator("Tj", [bytes])]);
    parts.push(transformed(page, operation, change.transform, body));
  }
  parts.push(textEnd(capture)); return concatenate(parts);
}

/** Rewrite only owned source paint. Original streams and shared resources remain immutable. */
export async function rewriteEditorPdfSourcePage(writer: NativePdfWriter, session: EditorSession, pageIndex: number, layers: Layers,
  options: EditorPdfSaveOptions & EditorPdfSourceRewriteOptions = {}): Promise<{ content: Uint8Array; resources: PdfDictionary }> {
  const page = await preparePage(writer.document, session, pageIndex, options), edits = new Map(session.getSourceEdits().map(edit => [key(edit.ref), edit]));
  const assignments = new Map(session.getLayerEdits().sourceAssignments.map(item => [key(item.ref), item.layerId]));
  const layerEdits = session.getLayerEdits(), removed = new Set(layerEdits.removedLayerIds), forced = new Set<string>();
  const changes = new Map<string, Change>();
  for (const [identity] of page.byPrimitive) {
    const edit = edits.get(identity), layer = assignments.get(identity);
    changes.set(identity, { transform: edit?.transform ?? EDITOR_IDENTITY, deleted: edit?.deleted ?? false, ...(assignments.has(identity) ? { layer } : {}) });
  }
  for (const [identity, operation] of page.byPrimitive) {
    const ref = operation.refs.find(ref => key(ref) === identity)!;
    const ids = getScenePrimitive(session.sourceScene, ref).optionalContent.layerIds;
    if (ids.some(id => removed.has(id) || id.startsWith("direct:") && layerEdits.catalogChanged)) forced.add(identity);
  }
  const sourceOwners = new ScenePageViews(session.sourceScene).owners;
  for (const edit of edits.values()) if (sourceOwners[edit.ref.kind][edit.ref.index] === pageIndex && !page.byPrimitive.has(key(edit.ref)) &&
    !getScenePrimitive(session.sourceScene, edit.ref).annotationId) throw new Error("A source primitive has no reliable operation owner.");
  const uniform = (refs: readonly PrimitiveRef[]): Change | null => {
    const values = refs.map(ref => changes.get(key(ref)) ?? unchanged), first = values[0] ?? unchanged;
    return values.every(value => sameChange(value, first)) ? first : null;
  };
  const clipPolicies = new Map<string, ReturnType<typeof editorSourceClipTransformOwnership>>();
  const movesOwnedClip = (ref: PrimitiveRef): boolean => {
    const transform = changes.get(key(ref))?.transform ?? EDITOR_IDENTITY; if (sameMatrix(transform, EDITOR_IDENTITY)) return false;
    const identity = matrixText(transform); let policy = clipPolicies.get(identity);
    if (!policy) { policy = editorSourceClipTransformOwnership(session.sourceScene, session.getSourceEdits(), transform); clipPolicies.set(identity, policy); }
    const clip = getPrimitiveClipChain(session.sourceScene, ref);
    if (clip.rect && policy.rectangle(clip.rect)) return true;
    for (let index = clip.clipIndex; index >= 0; index = session.sourceScene.clipPaths![index].parent) if (policy.path(index)) return true;
    return false;
  };
  let currentPage: Promise<VectorScene> | undefined;
  const getCurrentPage = (): Promise<VectorScene> => currentPage ??= session.getScene({ signal: options.signal, preview: false, includeObjects: false })
    .then(scene => new ScenePageViews(scene).extract(pageIndex).scene);
  const bounded = async (operation: Operation, objects: PdfDictionary, resources: PdfDictionary, reason: string): Promise<Uint8Array> => {
    if (operation.pendingClip || operation.state.clip || operation.state.textMode >= 4 || operation.marked.some(scope => scope.actualText))
      throw new Error(`${reason} Its ancestor clipping or semantic replacement prevents isolated appearance replacement.`);
    const current = await getCurrentPage(), identity = editorPaintIdentity(current), originalIdentity = editorPaintIdentity(session.sourceScene),
      wanted = new Set(operation.refs.map(originalIdentity));
    const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveRef["kind"], Set<number>>;
    const view = new ScenePageViews(current).extract(0);
    for (const kind of PAGE_PRIMITIVE_KINDS) for (const index of view.primitives[kind]) if (wanted.has(identity({ kind, index }))) keep[kind].add(index);
    let partial = compactEditorScene(current, keep);
    if (operation.refs.every(ref => { const original = page.byPrimitive.get(key(ref)); return original?.node === page.root && !original.state.clip; })) partial = removeSourcePageViewport(partial);
    const nativePage = writer.document.getPage(page.sourceIndex), box = nativePage.mediaBox;
    const media = editorTransformBounds({ minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] }, page.pdfToScene);
    partial = { ...partial, pageRects: Float32Array.of(media.minX, media.minY, media.maxX, media.maxY) };
    const { writeScenePdf } = await import("./editorPdfWriter"), { importEditorPdfPage } = await import("./editorNativePdf");
    const bytes = new Uint8Array(await (await writeScenePdf(partial, { signal: options.signal })).arrayBuffer());
    const imported = await importEditorPdfPage(bytes, writer, options.signal);
    const origin: EditorMatrix = [1, 0, 0, 1, partial.pageRects[0], partial.pageRects[1]];
    imported.form.set("Matrix", [...multiplyEditorMatrices(invertEditorMatrix(operation.state.matrix), multiplyEditorMatrices(page.sceneToPdf, origin))]);
    let alias = `HEPRAppearance${operation.id}`; while (objects.has(alias)) alias += "_";
    objects.set(alias, writer.add(pdfStreamValue(imported.content, imported.form)));
    const rawStates = await writer.document.resolveValue(resources.get("ExtGState"), options.signal), states = new Map(isPdfDictionary(rawStates) ? rawStates : []);
    let reset = "HEPRResetAppearance"; while (states.has(reset)) reset += "_";
    states.set(reset, new Map<string, PdfValue>([["CA", 1], ["ca", 1], ["BM", pdfNameValue("Normal")], ["SMask", pdfNameValue("None")],
      ["AIS", false], ["OP", false], ["op", false], ["OPM", 0], ["TR2", pdfNameValue("Default")]])); resources.set("ExtGState", states);
    options.onDiagnostic?.({ code: "editor.pdf-source-operation-appearance", severity: "warning", pageIndex,
      message: `A source paint operation was replaced with its edited vector appearance: ${reason}`,
      details: { fallback: "operation-vectors", operator: operation.operator, primitiveCount: operation.refs.length, reason } });
    const restore = operation.text ? concatenate([textPrefix(operation), textEnd(operation.text)]) : new Uint8Array();
    return concatenate([encoder.encode(`${operation.path ? "n\n" : ""}q /${reset} gs /${alias} Do Q\n`), restore]);
  };
  const visit = async (program: Program): Promise<{ content: Uint8Array; resources: PdfDictionary; changed: boolean }> => {
    const patches: Patch[] = [], resources = new Map(program.resources), rawObjects = await writer.document.resolveValue(resources.get("XObject"), options.signal);
    const objects = new Map(isPdfDictionary(rawObjects) ? rawObjects : []), rawProperties = await writer.document.resolveValue(resources.get("Properties"), options.signal);
    const properties = new Map(isPdfDictionary(rawProperties) ? rawProperties : []);
    const covered = new Set<Operation>();
    // A complete graphics-state scope owns its clips, masks and text state. Move
    // that scope together rather than leaving its clipping program behind.
    for (const scope of program.scopes) {
      if (scope.operations.some(operation => covered.has(operation))) continue;
      const refs = scope.operations.flatMap(operation => operation.refs), change = uniform(refs);
      if (!refs.length || scope.clip || scope.mask || scope.pathOpen || scope.operations.some(operation => operation.pathStart !== undefined && operation.pathStart < scope.start) ||
          !change || refs.some(ref => forced.has(key(ref))) || change.deleted || change.layer !== undefined || sameMatrix(change.transform, EDITOR_IDENTITY)) continue;
      const representative = scope.operations[0], scoped = { ...representative, state: { ...representative.state, matrix: scope.matrix } };
      patches.push({ start: scope.start, end: scope.end, bytes: transformed(page, scoped, change.transform, program.bytes.subarray(scope.start, scope.end)) });
      for (const operation of scope.operations) covered.add(operation);
    }
    for (const operation of program.operations) if (operation.id >= 0 && !covered.has(operation)) {
      options.signal?.throwIfAborted(); const change = uniform(operation.refs);
      let previousRank = -1, internalOrder = false;
      for (const ref of operation.refs) { const rank = session.getPrimitivePaintRank(ref); if (rank < 0 || changes.get(key(ref))?.deleted) continue;
        if (rank < previousRank) internalOrder = true; previousRank = rank; }
      const any = internalOrder || operation.refs.some(ref => forced.has(key(ref)) || changed(changes.get(key(ref)) ?? unchanged));
      if (!any) continue;
      let body: Uint8Array, prefix: Uint8Array = new Uint8Array(), transform = change?.transform ?? EDITOR_IDENTITY;
      let detached = false;
      try {
      if (operation.state.clip && operation.refs.some(movesOwnedClip))
        throw new Error("The selected source paint owns an inseparable clipping program.");
      if (!change?.deleted && operation.state.mask && operation.refs.some(ref => !sameMatrix(changes.get(key(ref))?.transform ?? EDITOR_IDENTITY, EDITOR_IDENTITY)))
        throw new Error("The source soft mask must be transformed with its owned paint.");
      if (operation.text && operation.state.textMode >= 4) throw new Error("Source text clipping requires its complete content scope.");
      if (operation.refs.some(ref => forced.has(key(ref)))) throw new Error("Source optional-content resources require a new canonical membership appearance.");
      if (operation.child && operation.refs.some(ref => changes.get(key(ref))?.layer !== undefined))
        throw new Error("Layer reassignment crosses a Form invocation's inherited optional-content scope.");
      if (operation.child && (!change || change.layer !== undefined || internalOrder) && !change?.deleted) {
        const nested = await visit(operation.child); if (!nested.changed) continue;
        const dictionary = streamDictionary(operation.child.dictionary!); dictionary.set("Resources", nested.resources);
        let alias = `HEPREdit${operation.id}`; while (objects.has(alias)) alias += "_";
        objects.set(alias, writer.add(pdfStreamValue(nested.content, dictionary))); body = encoder.encode(`/${alias} Do\n`); transform = EDITOR_IDENTITY;
      } else if (["Tj", "TJ", "'", '"'].includes(operation.operator)) {
        if (!operation.text) throw new Error("The source text program was not retained.");
        if (change?.deleted) {
          if (operation.state.textMode >= 4 || operation.marked.some(scope => scope.actualText)) throw new Error("Source text clipping or ActualText requires its complete content scope.");
          body = concatenate([textPrefix(operation), textEnd(operation.text)]); transform = EDITOR_IDENTITY;
        } else if (change) { prefix = textPrefix(operation); body = textBody(operation); }
        else { body = partialText(page, operation, session.sourceScene, changes); transform = EDITOR_IDENTITY; }
      } else if (change?.deleted) body = encoder.encode(operation.path ? "n\n" : "");
      else if (operation.path) {
        if (!change) throw new Error("A partial path selection requires bounded geometry replacement.");
        if (operation.pendingClip) throw new Error("A path that also changes clipping requires its graphics-state scope.");
        prefix = encoder.encode("n\n"); body = pathBody(operation);
      } else {
        if (!change) throw new Error("An inseparable source paint has incompatible primitive edits.");
        body = program.bytes.subarray(operation.start, operation.end);
        if (operation.operator === "Do" && change.layer !== undefined) {
          const resource = await writer.document.resolveValue(objects.get(String(operation.operands[0])), options.signal);
          if (isPdfStream(resource) && resource.dictionary.has("OC")) {
            const dictionary = new Map(resource.dictionary); dictionary.delete("OC");
            let alias = `HEPRMembership${operation.id}`; while (objects.has(alias)) alias += "_";
            objects.set(alias, writer.add({ ...resource, dictionary })); body = encoder.encode(`/${alias} Do\n`);
          }
        }
      }
      body = transformed(page, operation, transform, body);
      } catch (error) {
        options.signal?.throwIfAborted(); prefix = new Uint8Array(); detached = true;
        const reason = error instanceof Error ? error.message : String(error);
        try { body = await bounded(operation, objects, resources, reason); }
        catch (isolatedError) {
          options.signal?.throwIfAborted();
          const scope = [...operation.scopes].reverse().find(scope => !scope.clip && !scope.inText && !scope.endInText && !scope.pathOpen &&
            !scope.operations.some(item => item.pathStart !== undefined && item.pathStart < scope.start) && !scope.marked.some(mark => mark.actualText));
          if (!scope) throw isolatedError;
          const refs = [...new Map(scope.operations.flatMap(item => item.refs).map(ref => [key(ref), ref])).values()];
          const representative: Operation = { ...operation, operator: "q", refs, path: undefined, pendingClip: false, text: undefined, marked: scope.marked,
            state: { ...operation.state, clip: false, matrix: scope.matrix, textMode: scope.textMode, mask: scope.mask } };
          const replacement = await bounded(representative, objects, resources, `${reason} Its owning graphics-state scope was replaced together.`);
          const nonOptional = scope.marked.filter(mark => !mark.optional);
          const bytes = concatenate([encoder.encode("EMC\n".repeat(scope.marked.length)), ...nonOptional.map(mark => mark.raw), replacement,
            encoder.encode("EMC\n".repeat(nonOptional.length)), ...scope.marked.map(mark => mark.raw)]);
          for (let index = patches.length - 1; index >= 0; index--) if (patches[index].start >= scope.start && patches[index].end <= scope.end) patches.splice(index, 1);
          patches.push({ start: scope.start, end: scope.end, bytes });
          for (const item of scope.operations) covered.add(item);
          continue;
        }
      }
      if (detached || change?.layer !== undefined && !change.deleted) {
        if (operation.marked.some(scope => scope.actualText)) throw new Error("Layer reassignment inside ActualText requires its complete semantic scope.");
        const reference = detached ? undefined : layers.groupReference(change!.layer), nonOptional = operation.marked.filter(scope => !scope.optional);
        const closeScopes = encoder.encode("EMC\n".repeat(operation.marked.length));
        const reopenNonOptional = concatenate(nonOptional.map(scope => scope.raw));
        let layerStart = new Uint8Array(), layerEnd = new Uint8Array();
        if (reference) { let alias = `HEPRLayer${operation.id}`; while (properties.has(alias)) alias += "_";
          properties.set(alias, reference); layerStart = encoder.encode(`/OC /${alias} BDC\n`); layerEnd = encoder.encode("EMC\n"); }
        body = concatenate([closeScopes, reopenNonOptional, layerStart, body, layerEnd, encoder.encode("EMC\n".repeat(nonOptional.length)), ...operation.marked.map(scope => scope.raw)]);
      }
      patches.push({ start: operation.start, end: operation.end, bytes: concatenate([prefix, body]) });
    }
    const paints = program.operations.filter(operation => operation.id >= 0 && operation.refs.some(ref => !changes.get(key(ref))?.deleted));
    const rank = (refs: readonly PrimitiveRef[]): number[] => refs.filter(ref => !changes.get(key(ref))?.deleted)
      .map(ref => session.getPrimitivePaintRank(ref)).filter(rank => rank >= 0);
    const needsOrder = (items: readonly { refs: readonly PrimitiveRef[] }[]): boolean => {
      let previous = -1;
      for (const item of items) { const ranks = rank(item.refs); if (!ranks.length) continue;
        if (Math.min(...ranks) < previous) return true; previous = Math.max(previous, ...ranks); }
      return false;
    };
    if (needsOrder(paints)) {
      let firstPaint = paints.length, lastPaint = -1;
      for (let index = 1; index < paints.length; index++) {
        const ranks = rank(paints[index].refs); if (!ranks.length) continue;
        const minimum = Math.min(...ranks);
        for (let before = 0; before < index; before++) if (rank(paints[before].refs).some(value => value > minimum)) {
          firstPaint = Math.min(firstPaint, before); lastPaint = index; break;
        }
      }
      const affectedPaints = new Set(paints.slice(firstPaint, lastPaint + 1));
      // Graphics-state scopes are movable source units: their clips, masks,
      // resources and original operators travel with them. Never split a Form
      // invocation or an inseparable compositing scope to satisfy a paint rank.
      const units = program.scopes.filter(scope => !scope.parent && scope.operations.some(operation => affectedPaints.has(operation))).map(scope => ({ scope,
        refs: scope.operations.flatMap(operation => operation.refs) }));
      const first = units[0]?.scope;
      const independent = first && ![...affectedPaints].some(operation => !units.some(unit => unit.scope.operations.includes(operation))) &&
          !units.some(({ scope }) => scope.inText || scope.endInText || scope.pathOpen || scope.signature !== first.signature || !sameMatrix(scope.matrix, first.matrix) ||
            scope.marked.some(mark => !mark.optional) || scope.operations.some(operation => !affectedPaints.has(operation) || operation.pathStart !== undefined && operation.pathStart < scope.start));
      if (!independent) {
        const intervals: [number, number][] = [];
        for (let index = 1; index < paints.length; index++) {
          const ranks = rank(paints[index].refs); if (!ranks.length) continue;
          const minimum = Math.min(...ranks); let first = index;
          for (let before = 0; before < index; before++) if (rank(paints[before].refs).some(value => value > minimum)) { first = before; break; }
          if (first < index) {
            const previous = intervals.at(-1); if (previous && previous[1] >= first) previous[1] = index; else intervals.push([first, index]);
          }
        }
        for (const [firstIndex, lastIndex] of intervals) {
          const affected = paints.slice(firstIndex, lastIndex + 1), anchor = affected[0], affectedSet = new Set(affected);
          if (affected.some(operation => operation.pendingClip || operation.marked.some(mark => mark.actualText)))
            throw new Error("Source paint reordering crosses a clipping or ActualText scope.");
          for (let index = patches.length - 1; index >= 0; index--) {
            const patch = patches[index], touched = paints.filter(operation => operation.start >= patch.start && operation.end <= patch.end);
            if (!touched.some(operation => affectedSet.has(operation))) continue;
            if (touched.some(operation => !affectedSet.has(operation))) throw new Error("Source paint reordering splits a transformed graphics-state scope.");
            patches.splice(index, 1);
          }
          const representative = { ...anchor, refs: [...new Map(affected.flatMap(operation => operation.refs).map(ref => [key(ref), ref])).values()] };
          const replacement = await bounded(representative, objects, resources, "Reordered source operations share implicit graphics state.");
          const nonOptional = anchor.marked.filter(mark => !mark.optional);
          const body = concatenate([encoder.encode("EMC\n".repeat(anchor.marked.length)), ...nonOptional.map(mark => mark.raw), replacement,
            encoder.encode("EMC\n".repeat(nonOptional.length)), ...anchor.marked.map(mark => mark.raw)]);
          patches.push({ start: anchor.start, end: anchor.end, bytes: body });
          for (const operation of affected.slice(1)) patches.push({ start: operation.start, end: operation.end,
            bytes: operation.text ? concatenate([textPrefix(operation), textEnd(operation.text)]) : encoder.encode(operation.path ? "n\n" : "") });
        }
      } else {
      const sorted = [...units].sort((a, b) => Math.min(...rank(a.refs)) - Math.min(...rank(b.refs)));
      if (needsOrder(sorted)) throw new Error("Requested source order splits an inseparable graphics-state scope.");
      const originals = new Map(units.map(unit => [unit, applyPatches(program.bytes.subarray(unit.scope.start, unit.scope.end),
        patches.filter(patch => patch.start >= unit.scope.start && patch.end <= unit.scope.end)
          .map(patch => ({ ...patch, start: patch.start - unit.scope.start, end: patch.end - unit.scope.start })))]));
      for (let index = patches.length - 1; index >= 0; index--) if (units.some(unit => patches[index].start >= unit.scope.start && patches[index].end <= unit.scope.end)) patches.splice(index, 1);
      for (let index = 0; index < units.length; index++) {
        const destination = units[index].scope, source = sorted[index].scope;
        const sameMarks = destination.marked.length === source.marked.length && destination.marked.every((item, i) =>
          new TextDecoder().decode(item.raw) === new TextDecoder().decode(source.marked[i].raw));
        const content = originals.get(sorted[index])!;
        const body = sameMarks ? content : concatenate([encoder.encode("EMC\n".repeat(destination.marked.length)),
          ...source.marked.map(mark => mark.raw), content, encoder.encode("EMC\n".repeat(source.marked.length)), ...destination.marked.map(mark => mark.raw)]);
        patches.push({ start: destination.start, end: destination.end, bytes: body });
      }
      }
    }
    if (objects.size) resources.set("XObject", objects); if (properties.size) resources.set("Properties", properties);
    return { content: applyPatches(program.bytes, patches), resources, changed: patches.length > 0 };
  };
  const result = await visit(page.root);
  return result;
}
